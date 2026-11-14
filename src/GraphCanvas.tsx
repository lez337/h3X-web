import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { defaultCamera, kindGlyph, project, rotate, screenToWorld, unrotate, type Camera, type GraphLink, type GraphNode, type GraphTarget, type Vec3 } from './graphModel';
export type GraphCanvasHandle = {
    fit: () => void;
    focus: (id: string) => void;
    zoom: (factor: number) => void;
    exportImage: () => void;
};
type Props = {
    nodes: GraphNode[];
    links: GraphLink[];
    positions: Record<string, Vec3>;
    selected: GraphTarget;
    flat: boolean;
    labels: boolean;
    spinning: boolean;
    connecting: string | null;
    onSelect: (target: GraphTarget) => void;
    onMove: (id: string, position: Vec3) => void;
    onContext: (x: number, y: number, target: GraphTarget, position: Vec3) => void;
    onActivate: (target: GraphTarget) => void;
    onConnect: (id: string) => void;
};
type ScreenNode = {
    node: GraphNode;
    x: number;
    y: number;
    z: number;
    scale: number;
    radius: number;
};
type ScreenEdge = {
    link: GraphLink;
    ax: number;
    ay: number;
    bx: number;
    by: number;
    cx: number;
    cy: number;
};
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
function pointOn(e: ScreenEdge, t: number) { const s = 1 - t; return { x: s * s * e.ax + 2 * s * t * e.cx + t * t * e.bx, y: s * s * e.ay + 2 * s * t * e.cy + t * t * e.by }; }
function segmentDistance(x: number, y: number, a: {
    x: number;
    y: number;
}, b: {
    x: number;
    y: number;
}) { const dx = b.x - a.x, dy = b.y - a.y, t = clamp(((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1); return Math.hypot(x - a.x - t * dx, y - a.y - t * dy); }
const GraphCanvas = forwardRef<GraphCanvasHandle, Props>(function GraphCanvas(props, ref) {
    const canvas = useRef<HTMLCanvasElement>(null), latest = useRef(props);
    latest.current = props;
    const engine = useRef({ camera: { ...defaultCamera }, width: 1, height: 1, dirty: true, hover: null as GraphTarget, nodes: [] as ScreenNode[], edges: [] as ScreenEdge[], drag: null as null | {
            pointer: number;
            x: number;
            y: number;
            lastX: number;
            lastY: number;
            moved: boolean;
            mode: 'node' | 'orbit' | 'pan';
            id?: string;
            start?: Vec3;
            position?: Vec3;
            camera: Camera;
        }, fitted: false });
    function fit() {
        const e = engine.current, p = latest.current, visible = p.nodes.map(n => p.positions[n.id]).filter(Boolean);
        if (!visible.length) {
            e.camera = { ...defaultCamera };
            e.dirty = true;
            return;
        }
        const base = { ...e.camera, panX: 0, panY: 0, zoom: 1 }, points = visible.map(v => project(v, base, e.width, e.height, p.flat));
        const left = Math.min(...points.map(v => v.x)), right = Math.max(...points.map(v => v.x)), top = Math.min(...points.map(v => v.y)), bottom = Math.max(...points.map(v => v.y));
        const zoom = clamp(Math.min((e.width - 160) / Math.max(160, right - left), (e.height - 180) / Math.max(160, bottom - top), 1.45), .05, 3);
        e.camera = { ...base, zoom, panX: (e.width / 2 - (left + right) / 2) * zoom, panY: (e.height / 2 - (top + bottom) / 2) * zoom };
        e.dirty = true;
    }
    useImperativeHandle(ref, () => ({ fit, focus(id) { const e = engine.current, p = latest.current.positions[id]; if (!p)
            return; const v = project(p, { ...e.camera, panX: 0, panY: 0 }, e.width, e.height, latest.current.flat); e.camera.panX = e.width / 2 - v.x; e.camera.panY = e.height / 2 - v.y; e.dirty = true; }, zoom(factor) { engine.current.camera.zoom = clamp(engine.current.camera.zoom * factor, .05, 4); engine.current.dirty = true; }, exportImage() {
            const el = canvas.current;
            if (!el)
                return;
            el.toBlob(blob => { if (!blob)
                return; const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'H3X-link-graph.png'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }, 'image/png');
        } }));
    useEffect(() => { engine.current.dirty = true; if (props.nodes.length && !engine.current.fitted) {
        fit();
        engine.current.fitted = true;
    } }, [props]);
    useEffect(() => { engine.current.camera = { ...defaultCamera }; fit(); }, [props.flat]);
    useEffect(() => {
        const el = canvas.current;
        if (!el)
            return;
        const ctx = el.getContext('2d');
        if (!ctx)
            return;
        const e = engine.current, resize = new ResizeObserver(() => { const box = el.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2); e.width = box.width; e.height = box.height; el.width = Math.round(box.width * dpr); el.height = Math.round(box.height * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); fit(); e.dirty = true; });
        resize.observe(el);
        const wheel = (event: WheelEvent) => { event.preventDefault(); const r = el.getBoundingClientRect(), x = event.clientX - r.left, y = event.clientY - r.top, old = e.camera.zoom, next = clamp(old * Math.exp(-clamp(event.deltaY, -160, 160) * .0015), .05, 4); e.camera.panX = (e.camera.panX + e.width / 2 - x) * (next / old) - e.width / 2 + x; e.camera.panY = (e.camera.panY + e.height / 2 - y) * (next / old) - e.height / 2 + y; e.camera.zoom = next; e.dirty = true; };
        el.addEventListener('wheel', wheel, { passive: false });
        let frame = 0, last = 0;
        const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
        function draw(time: number) {
            frame = requestAnimationFrame(draw);
            const p = latest.current, dt = Math.min(50, time - last || 16);
            last = time;
            if (p.spinning && !p.flat && !e.drag && !motion.matches) {
                e.camera.yaw += dt * .00012;
                e.dirty = true;
            }
            if (!e.dirty || !ctx)
                return;
            e.dirty = false;
            const w = e.width, h = e.height, c = e.camera;
            ctx.clearRect(0, 0, w, h);
            ctx.fillStyle = '#0a0a0a';
            ctx.fillRect(0, 0, w, h);
            const bg = ctx.createRadialGradient(w * .48, h * .4, 0, w * .48, h * .4, w * .65);
            bg.addColorStop(0, '#1f1f1f66');
            bg.addColorStop(1, '#0a0a0a00');
            ctx.fillStyle = bg;
            ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = '#98989813';
            for (let x = 20; x < w; x += 28)
                for (let y = 20; y < h; y += 28)
                    ctx.fillRect(x, y, 1, 1);
            if (!p.flat) {
                ctx.save();
                ctx.strokeStyle = '#b3b3b314';
                ctx.lineWidth = .7;
                for (let i = -600; i <= 600; i += 100)
                    for (const direction of [0, 1]) {
                        const a = project({ x: direction ? i : -600, y: 240, z: direction ? -600 : i }, c, w, h), b = project({ x: direction ? i : 600, y: 240, z: direction ? 600 : i }, c, w, h);
                        ctx.beginPath();
                        ctx.moveTo(a.x, a.y);
                        ctx.lineTo(b.x, b.y);
                        ctx.stroke();
                    }
                ctx.restore();
            }
            const nodes = p.nodes.map(node => { const pos = e.drag?.id === node.id && e.drag.position ? e.drag.position : p.positions[node.id] || { x: 0, y: 0, z: 0 }, s = project(pos, c, w, h, p.flat); return { node, ...s, radius: clamp(23 * s.scale, 15, 36) }; }).sort((a, b) => b.z - a.z);
            e.nodes = nodes;
            const byId = new Map(nodes.map(n => [n.node.id, n])), selectedNode = p.selected?.kind === 'node' ? p.selected.id : null, selectedLink = p.selected?.kind === 'link' ? p.links.find(l => l.id === p.selected?.id) : null;
            // Prioritize nearby and selected labels; hide collisions instead of stacking text.
            type LabelBox = {
                x: number;
                y: number;
                width: number;
                height: number;
            };
            const labelBoxes: LabelBox[] = [], nodeLabels = new Map<string, {
                text: string;
                box: LabelBox;
                active: boolean;
            }>();
            const overlaps = (a: LabelBox, b: LabelBox) => a.x < b.x + b.width + 4 && a.x + a.width + 4 > b.x && a.y < b.y + b.height + 3 && a.y + a.height + 3 > b.y;
            const touchesNode = (box: LabelBox) => nodes.some(n => n.x + n.radius > box.x && n.x - n.radius < box.x + box.width && n.y + n.radius > box.y && n.y - n.radius < box.y + box.height);
            const labelPriority = (s: ScreenNode) => s.node.id === selectedNode || e.hover?.kind === 'node' && e.hover.id === s.node.id;
            for (const s of [...nodes].sort((a, b) => Number(labelPriority(b)) - Number(labelPriority(a)) || a.z - b.z)) {
                const active = labelPriority(s);
                if (!p.labels && !active)
                    continue;
                const text = s.node.label.length > 28 ? s.node.label.slice(0, 26) + '…' : s.node.label;
                ctx.font = `${s.node.id === selectedNode ? '600' : '400'} 12px "Segoe UI", sans-serif`;
                const width = ctx.measureText(text).width + 10;
                const candidates = [{ x: s.x - width / 2, y: s.y + s.radius + 8, width, height: 20 }, { x: s.x - width / 2, y: s.y - s.radius - 28, width, height: 20 }];
                const box = active ? candidates[0] : candidates.find(box => box.x > 2 && box.x + box.width < w - 2 && box.y > 35 && box.y + box.height < h - 35 && !labelBoxes.some(other => overlaps(box, other)) && !touchesNode(box));
                if (box) {
                    nodeLabels.set(s.node.id, { text, box, active: s.node.id === selectedNode });
                    labelBoxes.push(box);
                }
            }
            const neighborhood = new Set<string>(selectedNode ? [selectedNode] : selectedLink ? [selectedLink.from, selectedLink.to] : []);
            if (selectedNode)
                for (const l of p.links) {
                    if (l.from === selectedNode)
                        neighborhood.add(l.to);
                    if (l.to === selectedNode)
                        neighborhood.add(l.from);
                }
            const edgeGroups = new Map<string, GraphLink[]>();
            for (const link of p.links) {
                const key = [link.from, link.to].sort().join('|');
                edgeGroups.set(key, [...(edgeGroups.get(key) || []), link]);
            }
            e.edges = [];
            for (const l of p.links) {
                const a = byId.get(l.from), b = byId.get(l.to);
                if (!a || !b)
                    continue;
                const group = edgeGroups.get([l.from, l.to].sort().join('|'))!, offset = (group.indexOf(l) - (group.length - 1) / 2) * 40, d = Math.hypot(b.x - a.x, b.y - a.y) || 1, sign = l.from < l.to ? 1 : -1;
                const edge = { link: l, ax: a.x, ay: a.y, bx: b.x, by: b.y, cx: (a.x + b.x) / 2 - (b.y - a.y) / d * offset * sign, cy: (a.y + b.y) / 2 + (b.x - a.x) / d * offset * sign };
                e.edges.push(edge);
                const active = selectedLink?.id === l.id || l.from === selectedNode || l.to === selectedNode || e.hover?.kind === 'link' && e.hover.id === l.id;
                ctx.globalAlpha = neighborhood.size && !active ? 0.22 : 1;
                ctx.strokeStyle = active ? '#e6e6e6' : '#78787880';
                ctx.lineWidth = active ? 1.7 : 1;
                ctx.setLineDash(l.confidence === 'verified' ? [] : [4, 5]);
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.quadraticCurveTo(edge.cx, edge.cy, b.x, b.y);
                ctx.stroke();
                ctx.setLineDash([]);
                const t = clamp(1 - (b.radius + 8) / d, .55, .94), tip = pointOn(edge, t), prev = pointOn(edge, t - .025), angle = Math.atan2(tip.y - prev.y, tip.x - prev.x);
                ctx.fillStyle = active ? '#e6e6e6' : '#929292';
                ctx.beginPath();
                ctx.moveTo(tip.x, tip.y);
                ctx.lineTo(tip.x - 7 * Math.cos(angle - .38), tip.y - 7 * Math.sin(angle - .38));
                ctx.lineTo(tip.x - 7 * Math.cos(angle + .38), tip.y - 7 * Math.sin(angle + .38));
                ctx.closePath();
                ctx.fill();
                if (p.labels || active) {
                    const text = l.label.length > 30 ? l.label.slice(0, 28) + '…' : l.label;
                    ctx.font = '10px "Segoe UI", sans-serif';
                    const tw = ctx.measureText(text).width, candidates = [.5, .38, .62].map(t => { const v = pointOn(edge, t); return { x: v.x - tw / 2 - 7, y: v.y - 10, width: tw + 14, height: 20 }; }), box = active ? candidates[0] : candidates.find(box => !labelBoxes.some(other => overlaps(box, other)) && !touchesNode(box));
                    if (box) {
                        labelBoxes.push(box);
                        ctx.fillStyle = '#101010ed';
                        ctx.beginPath();
                        ctx.roundRect(box.x, box.y, box.width, box.height, 5);
                        ctx.fill();
                        ctx.fillStyle = active ? '#e5e5e5' : '#a2a2a2';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(text, box.x + box.width / 2, box.y + 10);
                    }
                }
                ctx.globalAlpha = 1;
            }
            for (const s of nodes) {
                const { node: n, x, y, radius: r } = s, active = selectedNode === n.id, hover = e.hover?.kind === 'node' && e.hover.id === n.id, connected = neighborhood.has(n.id);
                ctx.globalAlpha = neighborhood.size && !connected ? 0.3 : clamp(1 - s.z / 1800, .5, 1);
                if (active || hover || p.connecting === n.id) {
                    const halo = ctx.createRadialGradient(x, y, r, x, y, r * 2.5);
                    halo.addColorStop(0, n.color + '28');
                    halo.addColorStop(1, n.color + '00');
                    ctx.fillStyle = halo;
                    ctx.beginPath();
                    ctx.arc(x, y, r * 2.5, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.beginPath();
                    ctx.arc(x, y, r + 6, 0, Math.PI * 2);
                    ctx.strokeStyle = n.color + '70';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
                const fill = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
                fill.addColorStop(0, '#333333');
                fill.addColorStop(1, '#131313');
                ctx.fillStyle = fill;
                ctx.strokeStyle = active ? n.color : hover ? '#cbcbcb' : n.color + '90';
                ctx.lineWidth = active ? 1.8 : 1;
                ctx.beginPath();
                if (n.kind === 'Note' || n.kind === 'Organization' || n.kind === 'Investigation')
                    ctx.roundRect(x - r, y - r, r * 2, r * 2, clamp(r * .35, 4, 10));
                else
                    ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                ctx.fillStyle = n.color;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.font = `600 ${clamp(r * .46, 10, 16)}px "Segoe UI", sans-serif`;
                ctx.fillText(kindGlyph[n.kind] || '•', x, y);
                const label = nodeLabels.get(n.id);
                if (label) {
                    ctx.font = `${label.active ? '600' : '400'} 12px "Segoe UI", sans-serif`;
                    ctx.fillStyle = '#0a0a0ae6';
                    ctx.beginPath();
                    ctx.roundRect(label.box.x, label.box.y, label.box.width, label.box.height, 4);
                    ctx.fill();
                    ctx.fillStyle = label.active ? '#ffffff' : '#c9c9c9';
                    ctx.fillText(label.text, label.box.x + label.box.width / 2, label.box.y + 10);
                }
                ctx.globalAlpha = 1;
            }
            // Orientation indicator rotates with the same camera as the graph.
            if (!p.flat) {
                const ox = w - 40, oy = h - 43;
                ctx.font = '9px "Segoe UI", sans-serif';
                ctx.textAlign = 'center';
                for (const [label, v] of [['X', { x: 21, y: 0, z: 0 }], ['Y', { x: 0, y: 21, z: 0 }], ['Z', { x: 0, y: 0, z: 21 }]] as const) {
                    const r = rotate(v, c);
                    ctx.strokeStyle = '#747474';
                    ctx.beginPath();
                    ctx.moveTo(ox, oy);
                    ctx.lineTo(ox + r.x, oy + r.y);
                    ctx.stroke();
                    ctx.fillStyle = '#a5a5a5';
                    ctx.fillText(label, ox + r.x * 1.45, oy + r.y * 1.45);
                }
            }
        }
        frame = requestAnimationFrame(draw);
        return () => { cancelAnimationFrame(frame); resize.disconnect(); el.removeEventListener('wheel', wheel); };
    }, []);
    function local(event: {
        clientX: number;
        clientY: number;
    }) { const r = canvas.current!.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; }
    function hit(x: number, y: number): GraphTarget {
        const e = engine.current;
        for (let i = e.nodes.length - 1; i >= 0; i--) {
            const n = e.nodes[i];
            if (Math.hypot(n.x - x, n.y - y) < n.radius + 7)
                return { kind: 'node', id: n.node.id };
        }
        let closest: GraphTarget = null, distance = 8;
        for (const edge of e.edges)
            for (let t = 0; t < 1; t += .1) {
                const d = segmentDistance(x, y, pointOn(edge, t), pointOn(edge, Math.min(1, t + .1)));
                if (d < distance) {
                    distance = d;
                    closest = { kind: 'link', id: edge.link.id };
                }
            }
        return closest;
    }
    return <canvas ref={canvas} className="graph-canvas" tabIndex={0} role="img" aria-label={`${props.flat ? '2D' : '3D'} relationship graph. ${props.nodes.length} entities and ${props.links.length} connections. Drag a node to move it. Drag the background to orbit, Shift-drag to pan, scroll to zoom. Right-click to add or edit. Use the entity list for keyboard access.`} onPointerDown={event => { if (event.button !== 0 && event.button !== 1)
        return; const { x, y } = local(event), e = engine.current, target = hit(x, y); canvas.current!.focus(); canvas.current!.setPointerCapture(event.pointerId); e.drag = { pointer: event.pointerId, x, y, lastX: x, lastY: y, moved: false, mode: event.shiftKey || event.button === 1 ? 'pan' : target?.kind === 'node' ? 'node' : props.flat ? 'pan' : 'orbit', id: target?.kind === 'node' ? target.id : undefined, start: target?.kind === 'node' ? props.positions[target.id] : undefined, camera: { ...e.camera } }; }} onPointerMove={event => { const e = engine.current, { x, y } = local(event), d = e.drag; if (d) {
        if (Math.hypot(x - d.x, y - d.y) > 4)
            d.moved = true;
        if (d.moved) {
            if (d.mode === 'node' && d.start) {
                const rotated = props.flat ? d.start : rotate(d.start, d.camera), scale = 1000 / Math.max(250, 1000 + rotated.z) * d.camera.zoom, p = { x: rotated.x + (x - d.x) / scale, y: rotated.y + (y - d.y) / scale, z: rotated.z };
                d.position = props.flat ? { ...p, z: d.start.z } : unrotate(p, d.camera);
            }
            else if (d.mode === 'pan') {
                e.camera.panX = d.camera.panX + x - d.x;
                e.camera.panY = d.camera.panY + y - d.y;
            }
            else {
                e.camera.yaw = d.camera.yaw + (x - d.x) * .006;
                e.camera.pitch = clamp(d.camera.pitch + (y - d.y) * .006, -1.35, 1.35);
            }
            e.dirty = true;
        }
    }
    else {
        const next = hit(x, y);
        if (next?.id !== e.hover?.id || next?.kind !== e.hover?.kind) {
            e.hover = next;
            e.dirty = true;
        }
        canvas.current!.style.cursor = next ? 'pointer' : props.flat ? 'grab' : 'move';
    } if (d?.moved)
        canvas.current!.style.cursor = d.mode === 'node' ? 'grabbing' : 'move'; }} onPointerUp={event => { const e = engine.current, d = e.drag; if (!d || d.pointer !== event.pointerId)
        return; const { x, y } = local(event); if (d.moved && d.id && d.position)
        props.onMove(d.id, d.position); if (!d.moved) {
        const target = hit(x, y);
        if (props.connecting && target?.kind === 'node')
            props.onConnect(target.id);
        else
            props.onSelect(target);
    } e.drag = null; e.dirty = true; if (canvas.current!.hasPointerCapture(event.pointerId))
        canvas.current!.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { engine.current.drag = null; engine.current.dirty = true; }} onLostPointerCapture={() => { engine.current.drag = null; engine.current.dirty = true; }} onPointerLeave={() => { engine.current.hover = null; engine.current.dirty = true; }} onDoubleClick={event => { const { x, y } = local(event); props.onActivate(hit(x, y)); }} onContextMenu={event => { event.preventDefault(); const e = engine.current, { x, y } = local(event); props.onContext(event.clientX, event.clientY, hit(x, y), screenToWorld(x, y, e.camera, e.width, e.height, props.flat)); }} onKeyDown={event => { const e = engine.current; if (event.key === 'Escape') {
        props.onSelect(null);
        return;
    } if (event.key.toLowerCase() === 'f') {
        fit();
        event.preventDefault();
    } if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        if (props.flat || event.shiftKey) {
            e.camera.panX += event.key === 'ArrowLeft' ? 25 : event.key === 'ArrowRight' ? -25 : 0;
            e.camera.panY += event.key === 'ArrowUp' ? 25 : event.key === 'ArrowDown' ? -25 : 0;
        }
        else {
            e.camera.yaw += event.key === 'ArrowLeft' ? -.1 : event.key === 'ArrowRight' ? .1 : 0;
            e.camera.pitch = clamp(e.camera.pitch + (event.key === 'ArrowUp' ? -.1 : event.key === 'ArrowDown' ? .1 : 0), -1.35, 1.35);
        }
        e.dirty = true;
    } if (event.key === '+' || event.key === '=') {
        e.camera.zoom = clamp(e.camera.zoom * 1.15, .05, 4);
        e.dirty = true;
        event.preventDefault();
    } if (event.key === '-') {
        e.camera.zoom = clamp(e.camera.zoom / 1.15, .05, 4);
        e.dirty = true;
        event.preventDefault();
    } }}/>;
});
export default GraphCanvas;
