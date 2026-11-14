import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDownLeft, ArrowUpRight, Box, Check, ChevronRight, Download, Edit3, Eye, EyeOff, Focus, FolderOpen, HelpCircle, Link2, List, Maximize2, Minus, MoreHorizontal, MousePointer2, Network, Plus, Redo2, RotateCw, Search, Shuffle, Tag, Trash2, Undo2, X } from 'lucide-react';
import GraphCanvas, { type GraphCanvasHandle } from './GraphCanvas';
import { emptyGraph, entityKinds, graphNodes, investigationView, expandedPersonNodes, kindGlyph, layoutGraph, palette, type CustomEntity, type GraphLink, type GraphNode, type GraphRecord, type GraphTarget, type GraphWorkspace, type Vec3 } from './graphModel';
import './graph.css';
type Props = Omit<GraphRecord, 'graph'> & {
    graph?: GraphWorkspace;
    onChange: (value: GraphRecord) => void;
    onOpen: (source: 'case' | 'pin', id: string, personId?: string) => void;
};
type NodeEditor = {
    type: 'node';
    id?: string;
    label: string;
    kind: string;
    note: string;
    color: string;
    position?: Vec3;
    source?: GraphNode['source'];
};
type LinkEditor = {
    type: 'link';
    id?: string;
    from: string;
    to: string;
    label: string;
    note: string;
    confidence: NonNullable<GraphLink['confidence']>;
};
type Editor = NodeEditor | LinkEditor;
type Menu = {
    x: number;
    y: number;
    target: GraphTarget;
    position?: Vec3;
};
function EditorDialog({ title, children, onClose }: {
    title: string;
    children: ReactNode;
    onClose: () => void;
}) {
    const ref = useRef<HTMLDialogElement>(null);
    useEffect(() => { const previous = document.activeElement as HTMLElement | null; ref.current?.showModal(); return () => { ref.current?.close(); previous?.focus(); }; }, []);
    return <dialog ref={ref} className="graph-dialog" aria-labelledby="graph-dialog-title" onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === ref.current) {
        const r = ref.current.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
            onClose();
    } }}><div className="graph-dialog-heading"><div><span className="graph-kicker">GRAPH WORKSPACE</span><h2 id="graph-dialog-title">{title}</h2></div><button className="graph-icon-button" type="button" aria-label="Close editor" onClick={onClose}><X size={18}/></button></div>{children}</dialog>;
}
export default function LinkGraph(props: Props) {
    const record: GraphRecord = { cases: props.cases, pins: props.pins, links: props.links, graph: { ...emptyGraph, ...props.graph } }, latest = useRef(record);
    latest.current = record;
    const scene = useRef<GraphCanvasHandle>(null), root = useRef<HTMLDivElement>(null), menuRef = useRef<HTMLDivElement>(null);
    const [selected, setSelected] = useState<GraphTarget>(null), [query, setQuery] = useState(''), [filter, setFilter] = useState('All'), [flat, setFlat] = useState(false), [labels, setLabels] = useState(true), [spinning, setSpinning] = useState(false), [listOpen, setListOpen] = useState(true), [help, setHelp] = useState(false), [menu, setMenu] = useState<Menu | null>(null), [editor, setEditor] = useState<Editor | null>(null), [error, setError] = useState(''), [status, setStatus] = useState(''), [connecting, setConnecting] = useState<string | null>(null), [expanded, setExpanded] = useState(false);
    const history = useRef<{
        past: GraphRecord[];
        future: GraphRecord[];
    }>({ past: [], future: [] }), [, refreshHistory] = useState(0);
    const [expandedPeople, setExpandedPeople] = useState<Set<string>>(() => new Set());
    const investigationId = props.cases.some(c => c.id === record.graph.investigationId) ? record.graph.investigationId : props.cases[0]?.id;
    const scoped = useMemo(() => investigationView(record, investigationId), [props.cases, props.pins, props.links, props.graph, investigationId]);
    const allNodes = scoped.nodes, allLinks = scoped.links;
    const visibleNodes = useMemo(() => expandedPersonNodes(allNodes, expandedPeople).filter(n => !record.graph.hidden.includes(n.id) && (filter === 'All' || n.kind === filter) && (!query || [n.label, n.kind, n.note].join(' ').toLowerCase().includes(query.toLowerCase()))), [allNodes, expandedPeople, record.graph.hidden, filter, query]);
    useEffect(() => { setExpandedPeople(new Set()); setSelected(null); setQuery(''); setFilter('All'); setConnecting(null); setMenu(null); }, [investigationId]);
    const visibleTopology = visibleNodes.map(n => n.id).join('|');
    useEffect(() => { scene.current?.fit(); }, [visibleTopology]);
    const visibleIds = new Set(visibleNodes.map(n => n.id)), visibleLinks = allLinks.filter(l => visibleIds.has(l.from) && visibleIds.has(l.to));
    const topology = allNodes.map(n => n.id).join('|') + '::' + allLinks.map(l => l.from + '>' + l.to).join('|');
    const generated = useMemo(() => layoutGraph(allNodes.map(n => n.id), allLinks), [topology]);
    const positions = useMemo(() => ({ ...generated, ...record.graph.positions }), [generated, record.graph.positions]);
    const activeNode = selected?.kind === 'node' ? allNodes.find(n => n.id === selected.id) : undefined, activeLink = selected?.kind === 'link' ? allLinks.find(l => l.id === selected.id) : undefined;
    const activeConnections = activeNode ? allLinks.filter(l => l.from === activeNode.id || l.to === activeNode.id) : [];
    const nodeName = (id: string) => allNodes.find(n => n.id === id)?.label || 'Unavailable entity';
    const hiddenCount = record.graph.hidden.length;
    function commit(next: GraphRecord, message: string) {
        const ids = new Set(graphNodes({...next,graph:{...next.graph,detailMode:'details'}}).map(n => n.id));
        next = { ...next, graph: { ...next.graph, positions: Object.fromEntries(Object.entries({ ...positions, ...next.graph.positions }).filter(([id]) => ids.has(id))) } };
        history.current.past.push(latest.current);
        if (history.current.past.length > 50)
            history.current.past.shift();
        history.current.future = [];
        latest.current = next;
        props.onChange(next);
        refreshHistory(n => n + 1);
        setStatus(message);
    }
    function changeGraph(graph: GraphWorkspace, message: string) { commit({ ...latest.current, graph }, message); }
    function undo() { const previous = history.current.past.pop(); if (!previous)
        return; history.current.future.push(latest.current); latest.current = previous; props.onChange(previous); refreshHistory(n => n + 1); setStatus('Change undone.'); setMenu(null); setConnecting(null); }
    function redo() { const next = history.current.future.pop(); if (!next)
        return; history.current.past.push(latest.current); latest.current = next; props.onChange(next); refreshHistory(n => n + 1); setStatus('Change restored.'); setMenu(null); }
    function togglePerson(id: string) {
        setExpandedPeople(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    }
    function select(target: GraphTarget) {
        if (target?.kind === 'node' && allNodes.some(n => n.id === target.id && n.kind === 'Person' && n.derived)) togglePerson(target.id);
        setSelected(target); setMenu(null);
    }
    function addNode(position?: Vec3) { setError(''); setMenu(null); setEditor({ type: 'node', label: '', kind: 'Person', note: '', color: palette[0], position }); }
    function addLink(from = activeNode?.id || '', to = '') { setError(''); setMenu(null); setConnecting(null); setEditor({ type: 'link', from, to, label: 'related to', note: '', confidence: 'unverified' }); }
    function edit(target: GraphTarget) {
        setMenu(null);
        setError('');
        if (target?.kind === 'node') {
            const n = allNodes.find(n => n.id === target.id);
            if(n?.derived){props.onOpen('case',n.caseId!,n.personId);return;}
            if (n)
                setEditor({ type: 'node', id: n.id, label: n.label, kind: n.kind, note: n.note, color: n.color, source: n.source });
        }
        if (target?.kind === 'link') {
            if(target.id.startsWith('auto:')){setStatus('This connection comes from saved person details. Open the investigation to edit them.');return;}
            const l = record.links.find(l => l.id === target.id);
            if (l)
                setEditor({ type: 'link', id: l.id, from: l.from, to: l.to, label: l.label, note: l.note || '', confidence: l.confidence || 'unverified' });
        }
    }
    function remove(target: GraphTarget) {
        if (!target)
            return;
        const r = latest.current;
        if(target.kind==='link'&&target.id.startsWith('auto:')){changeGraph({...r.graph,hidden:[...r.graph.hidden,target.id]},'Detail connection hidden.');setSelected(null);setMenu(null);return;}
        if (target.kind === 'link')
            commit({ ...r, links: r.links.filter(l => l.id !== target.id) }, 'Connection removed.');
        else {
            const n = allNodes.find(n => n.id === target.id);
            if (!n)
                return;
            if (n.source === 'custom') {
                const positions = { ...r.graph.positions }, colors = { ...r.graph.colors };
                delete positions[n.id];
                delete colors[n.id];
                commit({ ...r, links: r.links.filter(l => l.from !== n.id && l.to !== n.id), graph: { ...r.graph, nodes: r.graph.nodes.filter(x => x.id !== n.id), positions, colors, hidden: r.graph.hidden.filter(id => id !== n.id) } }, 'Entity and its connections removed. Undo is available.');
            }
            else
                changeGraph({ ...r.graph, hidden: [...r.graph.hidden, n.id] }, 'Entity hidden from the graph. Its saved record is retained.');
        }
        setSelected(null);
        setMenu(null);
        setConnecting(null);
    }
    function saveEditor() {
        if (!editor)
            return;
        const r = latest.current;
        if (editor.type === 'node') {
            if (!editor.label.trim()) {
                setError('Enter an entity name.');
                return;
            }
            const id = editor.id || crypto.randomUUID(), label = editor.label.trim(), note = editor.note.trim(), graph = { ...r.graph, colors: { ...r.graph.colors, [id]: editor.color } };
            let cases = r.cases, pins = r.pins;
            if (editor.source === 'case')
                cases = cases.map(c => c.id === id ? { ...c, title: label, summary: note, updatedAt: new Date().toISOString() } : c);
            else if (editor.source === 'pin')
                pins = pins.map(p => p.id === id ? { ...p, name: label, note } : p);
            else {
                const node: CustomEntity = { caseId: editor.id ? r.graph.nodes.find(n => n.id === id)?.caseId : investigationId, id, label, note, kind: editor.kind as CustomEntity['kind'], color: editor.color };
                graph.nodes = editor.id ? graph.nodes.map(n => n.id === id ? node : n) : [...graph.nodes, node];
                if (editor.position)
                    graph.positions = { ...graph.positions, [id]: editor.position };
            }
            commit({ ...r, cases, pins, graph }, editor.id ? 'Entity updated.' : 'Entity added.');
            setSelected({ kind: 'node', id });
        }
        else {
            const ids = new Set(allNodes.map(n => n.id));
            if (!ids.has(editor.from) || !ids.has(editor.to) || editor.from === editor.to) {
                setError('Choose two different entities.');
                return;
            }
            if (!editor.label.trim()) {
                setError('Enter a relationship label.');
                return;
            }
            if (r.links.some(l => l.id !== editor.id && l.from === editor.from && l.to === editor.to && l.label.toLowerCase() === editor.label.trim().toLowerCase())) {
                setError('This connection already exists.');
                return;
            }
            if (!editor.id && r.links.length >= 1000) {
                setError('The workspace supports up to 1,000 connections.');
                return;
            }
            const link: GraphLink = { id: editor.id || crypto.randomUUID(), from: editor.from, to: editor.to, label: editor.label.trim(), note: editor.note.trim(), confidence: editor.confidence };
            commit({ ...r, links: editor.id ? r.links.map(l => l.id === editor.id ? link : l) : [...r.links, link] }, editor.id ? 'Connection updated.' : 'Connection added.');
            setSelected({ kind: 'link', id: link.id });
        }
        setEditor(null);
        setError('');
    }
    function beginConnect(id: string) { setConnecting(id); setMenu(null); setSelected({ kind: 'node', id }); setStatus('Select another node in the graph or entity list to connect it.'); }
    function connectTo(id: string) { if (!connecting)
        return; if (id === connecting) {
        setStatus('Choose a different entity to complete the connection.');
        return;
    } addLink(connecting, id); }
    function context(x: number, y: number, target: GraphTarget, position?: Vec3) { setSelected(target); setMenu({ x: Math.min(x, window.innerWidth - 245), y: Math.max(10, Math.min(y, window.innerHeight - 330)), target, position }); }
    function autoLayout() { changeGraph({ ...record.graph, positions: { ...record.graph.positions, ...layoutGraph(allNodes.map(n => n.id), allLinks, flat) } }, 'Layout arranged.'); requestAnimationFrame(() => scene.current?.fit()); }
    function focusNode(id: string) {
        const node = allNodes.find(n => n.id === id);
        const owner = node?.personId ? allNodes.find(n => n.kind === 'Person' && n.caseId === node.caseId && n.personId === node.personId) : undefined;
        if (owner) setExpandedPeople(previous => new Set([...previous, owner.id]));
        setQuery(''); setFilter('All'); if (record.graph.hidden.includes(id))
        changeGraph({ ...record.graph, hidden: record.graph.hidden.filter(x => x !== id) }, 'Entity shown.'); setSelected({ kind: 'node', id }); requestAnimationFrame(() => scene.current?.focus(id)); }
    useEffect(() => { if (!menu)
        return; menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus(); const dismiss = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node))
        setMenu(null); }, scroll = () => setMenu(null); document.addEventListener('pointerdown', dismiss); window.addEventListener('resize', scroll); window.addEventListener('scroll', scroll, true); return () => { document.removeEventListener('pointerdown', dismiss); window.removeEventListener('resize', scroll); window.removeEventListener('scroll', scroll, true); }; }, [menu]);
    useEffect(() => { if (selected?.kind === 'node' && !allNodes.some(n => n.id === selected.id) || selected?.kind === 'link' && !allLinks.some(l => l.id === selected.id))
        setSelected(null); }, [allNodes, record.links, selected]);
    useEffect(() => { const change = () => setExpanded(document.fullscreenElement === root.current); document.addEventListener('fullscreenchange', change); return () => document.removeEventListener('fullscreenchange', change); }, []);
    return <div className="content relationship-page" ref={root} onKeyDown={event => {
            if (event.target instanceof HTMLElement && event.target.closest('input,textarea,select,dialog'))
                return;
            if (event.key === 'Escape') {
                setMenu(null);
                setConnecting(null);
                setHelp(false);
                return;
            }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
                event.preventDefault();
                event.shiftKey ? redo() : undo();
            }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
                event.preventDefault();
                redo();
            }
            if (event.key === 'Delete' && selected) {
                event.preventDefault();
                remove(selected);
            }
        }}>
  <div className="relationship-heading"><div><div className="eyebrow">RELATIONSHIP EXPLORER</div><h1>Link graph<span className="graph-beta">{flat ? '2D' : '3D'} SPACE</span></h1></div><div className="graph-heading-actions"><button onClick={() => scene.current?.exportImage()} disabled={!visibleNodes.length}><Download size={15}/> Export PNG</button><button className="primary" onClick={() => addNode()}><Plus size={16}/> Add entity</button></div></div>
  <section className="graph-workspace" aria-label="Relationship workspace">
   <div className="graph-command-bar"><div className="graph-search"><Search size={15}/><input aria-label="Find graph entities" placeholder="Find an entity…" value={query} onChange={e => setQuery(e.target.value)}/>{query && <button aria-label="Clear entity search" onClick={() => setQuery('')}><X size={13}/></button>}</div><select aria-label="Filter entity type" value={filter} onChange={e => setFilter(e.target.value)}><option>All</option>{Array.from(new Set(allNodes.map(n => n.kind))).sort().map(kind => <option key={kind}>{kind}</option>)}</select><div className="graph-bar-divider"/><select aria-label="Select investigation" value={investigationId || ''} disabled={!props.cases.length} onChange={e => changeGraph({...record.graph, investigationId: e.target.value}, 'Investigation selected.')}><option value="" disabled>Select investigation</option>{props.cases.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select><div className="graph-view-switch" aria-label="Graph dimensions"><button aria-pressed={!flat} onClick={() => setFlat(false)}><Box size={14}/> 3D</button><button aria-pressed={flat} onClick={() => { setFlat(true); setSpinning(false); }}>2D</button></div><div className="graph-command-spacer"/><button className="graph-icon-button" title="Undo (Ctrl+Z)" aria-label="Undo graph change" disabled={!history.current.past.length} onClick={undo}><Undo2 size={16}/></button><button className="graph-icon-button" title="Redo (Ctrl+Shift+Z)" aria-label="Redo graph change" disabled={!history.current.future.length} onClick={redo}><Redo2 size={16}/></button><div className="graph-bar-divider"/><button className="graph-icon-button" aria-label="Toggle entity list" title="Entity list" aria-pressed={listOpen} onClick={() => setListOpen(!listOpen)}><List size={17}/></button><button className="graph-icon-button" aria-label={expanded ? 'Exit full screen' : 'Full screen graph'} title="Full screen" onClick={async () => { try {
        if (document.fullscreenElement)
            await document.exitFullscreen();
        else
            await root.current?.requestFullscreen();
    }
    catch {
        setStatus('Full screen is unavailable in this window.');
    } }}><Maximize2 size={16}/></button></div>
   <div className={'graph-body ' + (listOpen ? '' : 'graph-list-closed')}>
    {listOpen && <aside className="graph-entity-panel"><div className="graph-panel-title"><span>ENTITIES</span><b>{visibleNodes.length}<span> / {allNodes.length}</span></b></div><div className="graph-entity-list">{visibleNodes.map(node => <div className="graph-entity-row" key={node.id}><button className={selected?.kind === 'node' && selected.id === node.id ? 'selected' : ''} onClick={() => connecting ? connectTo(node.id) : select({ kind: 'node', id: node.id })} aria-expanded={node.derived && node.kind === 'Person' ? expandedPeople.has(node.id) : undefined} onDoubleClick={() => focusNode(node.id)} onContextMenu={e => { e.preventDefault(); context(e.clientX, e.clientY, { kind: 'node', id: node.id }); }}><span className="graph-entity-glyph" style={{ color: node.color }}>{kindGlyph[node.kind]}</span><span><b>{node.label}</b><small>{node.kind}{node.derived && node.kind === 'Person' ? (expandedPeople.has(node.id) ? ' � Click to collapse' : ' � Click to expand') : ''}</small></span></button><button className="graph-entity-more" aria-label={'Options for ' + node.label} onClick={e => { const r = e.currentTarget.getBoundingClientRect(); context(r.right, r.bottom, { kind: 'node', id: node.id }); }}><MoreHorizontal size={15}/></button></div>)}{!visibleNodes.length && <p className="graph-list-empty">{allNodes.length ? 'No matching entities.' : 'Your entities will appear here.'}</p>}</div><div className="graph-entity-footer"><button onClick={() => addNode()}><Plus size={14}/> Add entity</button>{hiddenCount > 0 && <button onClick={() => changeGraph({ ...record.graph, hidden: [] }, 'Hidden entities restored.')}><Eye size={13}/> Restore {hiddenCount} hidden</button>}</div></aside>}
    <div className="graph-stage">
     <GraphCanvas ref={scene} nodes={visibleNodes} links={visibleLinks} positions={positions} selected={selected} flat={flat} labels={labels} spinning={spinning} connecting={connecting} onSelect={select} onMove={(id, position) => changeGraph({ ...record.graph, positions: { ...positions, [id]: position } }, 'Entity position saved.')} onContext={context} onActivate={target => target ? edit(target) : addNode()} onConnect={connectTo}/>
     <div className="graph-scene-top"><span className="graph-live-dot"/>{flat ? 'PLANAR VIEW' : 'PERSPECTIVE VIEW'}<span className="graph-scene-line"/><span>{visibleLinks.length} connections</span></div>
     {!visibleNodes.length && <div className="graph-empty-state"><div className="graph-empty-icon"><Network size={35} strokeWidth={1}/></div><h2>{allNodes.length ? 'No entities in this view' : 'Every connection starts somewhere'}</h2><button className="primary" onClick={() => allNodes.length ? (setQuery(''), setFilter('All'), hiddenCount && changeGraph({ ...record.graph, hidden: [] }, 'Hidden entities restored.')) : addNode()}>{allNodes.length ? <><Eye size={15}/> Show all entities</> : <><Plus size={15}/> Add your first entity</>}</button></div>}
     {connecting && <div className="graph-connect-banner"><Link2 size={15}/><span>Connecting <b>{nodeName(connecting)}</b> · choose a second entity</span><button aria-label="Cancel connection" onClick={() => setConnecting(null)}><X size={15}/></button></div>}
     <div className="graph-scene-tools"><button className="graph-icon-button" title="Zoom in" aria-label="Zoom in graph" onClick={() => scene.current?.zoom(1.2)}><Plus size={17}/></button><button className="graph-icon-button" title="Zoom out" aria-label="Zoom out graph" onClick={() => scene.current?.zoom(1 / 1.2)}><Minus size={17}/></button><span /><button className="graph-icon-button" title="Fit all entities (F)" aria-label="Fit graph to view" onClick={() => scene.current?.fit()}><Focus size={17}/></button><button className="graph-icon-button" title="Arrange layout" aria-label="Arrange graph layout" disabled={!allNodes.length} onClick={autoLayout}><Shuffle size={16}/></button><button className="graph-icon-button" title="Entity and connection labels" aria-label="Toggle graph labels" aria-pressed={labels} onClick={() => setLabels(!labels)}><Tag size={16}/></button><button className="graph-icon-button" title="Auto-rotate" aria-label="Auto-rotate graph" aria-pressed={spinning} disabled={flat} onClick={() => setSpinning(!spinning)}><RotateCw size={16}/></button></div>
     <button className="graph-help-button" aria-label="Graph controls help" aria-expanded={help} onClick={() => setHelp(!help)}><HelpCircle size={16}/></button>
     {help && <div className="graph-help"><div><b>Move through your graph</b><button className="graph-icon-button" aria-label="Close graph help" onClick={() => setHelp(false)}><X size={14}/></button></div><p><span>Orbit</span>Drag background / arrow keys</p><p><span>Pan</span>Shift + drag / middle drag</p><p><span>Move entity</span>Drag a node</p><p><span>Zoom</span>Scroll / + and −</p><p><span>Fit view</span>F</p><p><span>Person details</span>Click person to expand / collapse</p><p><span>Edit</span>Double-click / right-click</p><p><span>Undo / redo</span>Ctrl + Z / Ctrl + Shift + Z</p><p><span>Remove</span>Delete selected element</p><small>Solid connections are marked verified. Dashed connections are working hypotheses.</small></div>}
    </div>
    <aside className="graph-inspector" aria-label="Graph selection details">
     <div className="graph-panel-title"><span>{activeNode ? 'ENTITY DETAILS' : activeLink ? 'CONNECTION DETAILS' : 'INSPECTOR'}</span>{selected && <button className="graph-icon-button" aria-label="Clear graph selection" onClick={() => select(null)}><X size={14}/></button>}</div>
     {activeNode ? <div className="graph-inspector-content"><span className="graph-detail-symbol" style={{ color: activeNode.color }}>{kindGlyph[activeNode.kind]}</span><span className="graph-kicker">{activeNode.kind}</span><h2>{activeNode.label}</h2><p className="graph-detail-note">{activeNode.note || 'Add a note to give this entity context.'}</p>{activeNode.derived && activeNode.kind === 'Person' && <button className="graph-wide-button" aria-expanded={expandedPeople.has(activeNode.id)} onClick={() => togglePerson(activeNode.id)}>{expandedPeople.has(activeNode.id) ? <Minus size={14}/> : <Plus size={14}/>} {expandedPeople.has(activeNode.id) ? 'Collapse details' : 'Expand details'}</button>}<div className="graph-inspector-actions"><button onClick={() => edit(selected)}><Edit3 size={14}/> Edit</button><button onClick={() => scene.current?.focus(activeNode.id)}><Focus size={14}/> Focus</button></div>{activeNode.source !== 'custom' && <button className="graph-open-record" onClick={() => props.onOpen(activeNode.source as 'case' | 'pin', activeNode.caseId||activeNode.id,activeNode.personId)}><FolderOpen size={14}/> Open {activeNode.source === 'case' ? 'investigation' : 'map pin'}<ChevronRight size={14}/></button>}<div className="graph-connections-heading"><h3>Connections <span>{activeConnections.length}</span></h3><button className="graph-icon-button" title="Connect this entity" aria-label="Connect selected entity" onClick={() => beginConnect(activeNode.id)}><Plus size={15}/></button></div><div className="graph-connection-list">{activeConnections.map(link => <button key={link.id} onClick={() => select({ kind: 'link', id: link.id })} onContextMenu={e => { e.preventDefault(); context(e.clientX, e.clientY, { kind: 'link', id: link.id }); }}>{link.from === activeNode.id ? <ArrowUpRight size={15}/> : <ArrowDownLeft size={15}/>}<span><small>{link.label}</small><b>{nodeName(link.from === activeNode.id ? link.to : link.from)}</b></span><ChevronRight size={13}/></button>)}{!activeConnections.length && <p className="graph-list-empty">No connections yet. Link this entity to another to start exploring.</p>}</div><button className="graph-wide-button" onClick={() => beginConnect(activeNode.id)}><Link2 size={14}/> Add connection</button><button className="graph-remove-button" onClick={() => remove(selected)}>{activeNode.source === 'custom' ? <Trash2 size={13}/> : <EyeOff size={13}/>} {activeNode.source === 'custom' ? 'Remove entity' : 'Hide from graph'}</button></div> : activeLink ? <div className="graph-inspector-content"><span className="graph-detail-symbol"><Link2 size={25}/></span><span className="graph-kicker">DIRECTED CONNECTION</span><h2>{activeLink.label}</h2><div className="graph-link-endpoints"><button onClick={() => focusNode(activeLink.from)}>{nodeName(activeLink.from)}</button><ArrowDownLeft size={16}/><button onClick={() => focusNode(activeLink.to)}>{nodeName(activeLink.to)}</button></div><span className={'graph-confidence ' + (activeLink.confidence || 'unverified')}>{activeLink.confidence === 'verified' && <Check size={12}/>} {activeLink.confidence || 'unverified'}</span><p className="graph-detail-note">{activeLink.note || 'No supporting notes added.'}</p><button className="graph-wide-button" onClick={() => edit(selected)}><Edit3 size={14}/> Edit connection</button><button className="graph-remove-button" onClick={() => remove(selected)}><Trash2 size={13}/> Remove connection</button></div> : <div className="graph-inspector-placeholder"><MousePointer2 size={26} strokeWidth={1}/><h3>A closer look</h3><div><span><i className="graph-legend-node"/> Entity</span><span><i className="graph-legend-link"/> Connection</span></div><button onClick={() => addLink()} disabled={allNodes.length < 2}><Link2 size={14}/> Add connection</button></div>}
    </aside>
   </div>
   <div className="graph-status-bar"><span><span className="graph-status-dot"/>{visibleNodes.length} entities<span className="graph-status-sep">/</span>{visibleLinks.length} connections</span><span className="graph-status-message" role="status">{status || 'Workspace changes save automatically'}</span><span className="graph-local-label">LOCAL WORKSPACE</span></div>
  </section>
  {menu && <div className="graph-context-menu" role="menu" aria-label="Graph actions" ref={menuRef} style={{ left: Math.max(8, menu.x), top: menu.y }} onKeyDown={e => { const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')), index = buttons.indexOf(document.activeElement as HTMLButtonElement); if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            buttons[(index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
        } if (e.key === 'Escape') {
            e.stopPropagation();
            setMenu(null);
            root.current?.querySelector<HTMLCanvasElement>('canvas')?.focus();
        } }}>
   <div className="graph-context-title">{menu.target?.kind === 'node' ? nodeName(menu.target.id) : menu.target?.kind === 'link' ? 'Connection' : 'Graph workspace'}</div>
   {menu.target ? <><button role="menuitem" onClick={() => edit(menu.target)}><Edit3 size={15}/> Edit {menu.target.kind === 'node' ? 'entity' : 'connection'}</button>{menu.target.kind === 'node' && <><button role="menuitem" onClick={() => beginConnect(menu.target!.id)}><Link2 size={15}/> Connect to another entity</button><button role="menuitem" onClick={() => { scene.current?.focus(menu.target!.id); setMenu(null); }}><Focus size={15}/> Focus entity</button></>}<div className="graph-menu-rule"/><button role="menuitem" className="graph-menu-remove" onClick={() => remove(menu.target)}><Trash2 size={15}/> {menu.target.kind === 'node' && allNodes.find(n => n.id === menu.target!.id)?.source !== 'custom' ? 'Hide from graph' : 'Remove ' + (menu.target.kind === 'node' ? 'entity' : 'connection')}</button></> : <><button role="menuitem" onClick={() => addNode(menu.position)}><Plus size={15}/> Add entity here</button><button role="menuitem" disabled={allNodes.length < 2} onClick={() => addLink()}><Link2 size={15}/> Add connection</button><div className="graph-menu-rule"/><button role="menuitem" onClick={() => { scene.current?.fit(); setMenu(null); }}><Focus size={15}/> Fit graph to view</button><button role="menuitem" disabled={!allNodes.length} onClick={() => { autoLayout(); setMenu(null); }}><Shuffle size={15}/> Arrange layout</button>{hiddenCount > 0 && <button role="menuitem" onClick={() => { changeGraph({ ...record.graph, hidden: [] }, 'Hidden entities restored.'); setMenu(null); }}><Eye size={15}/> Restore hidden entities</button>}</>}
  </div>}
  {editor && <EditorDialog title={editor.type === 'node' ? (editor.id ? 'Edit entity' : 'Add an entity') : (editor.id ? 'Edit connection' : 'Connect entities')} onClose={() => setEditor(null)}><form onSubmit={e => { e.preventDefault(); saveEditor(); }}>
   {editor.type === 'node' ? <><label>NAME<input autoFocus required maxLength={160} placeholder="Give this entity a name" value={editor.label} onChange={e => setEditor({ ...editor, label: e.target.value })}/></label><label>ENTITY TYPE<select value={editor.kind} disabled={editor.source === 'case' || editor.source === 'pin'} onChange={e => setEditor({ ...editor, kind: e.target.value })}>{editor.source && editor.source !== 'custom' ? <option>{editor.kind}</option> : entityKinds.map(kind => <option key={kind}>{kind}</option>)}</select></label><label>{editor.source === 'case' ? 'SUMMARY' : 'NOTES'}<textarea rows={4} maxLength={6000} placeholder="Context, sources, or useful details…" value={editor.note} onChange={e => setEditor({ ...editor, note: e.target.value })}/></label><fieldset className="graph-colors"><legend>ACCENT</legend>{palette.map((color, i) => <button type="button" key={color} style={{ '--swatch': color } as React.CSSProperties} aria-label={['Silver', 'White', 'Pearl', 'Ash', 'Stone', 'Gray'][i] + ' accent'} aria-pressed={editor.color === color} onClick={() => setEditor({ ...editor, color })}>{editor.color === color && <Check size={14}/>}</button>)}</fieldset></> : <><div className="graph-form-endpoints"><label>FROM<select autoFocus required value={editor.from} onChange={e => setEditor({ ...editor, from: e.target.value })}><option value="">Choose an entity</option>{allNodes.map(n => <option key={n.id} value={n.id} disabled={n.id === editor.to}>{n.label} · {n.kind}</option>)}</select></label><Link2 size={17}/><label>TO<select required value={editor.to} onChange={e => setEditor({ ...editor, to: e.target.value })}><option value="">Choose an entity</option>{allNodes.map(n => <option key={n.id} value={n.id} disabled={n.id === editor.from}>{n.label} · {n.kind}</option>)}</select></label></div><label>RELATIONSHIP<input required maxLength={120} placeholder="e.g. works at, owns, associated with" value={editor.label} onChange={e => setEditor({ ...editor, label: e.target.value })}/></label><label>CONFIDENCE<select value={editor.confidence} onChange={e => setEditor({ ...editor, confidence: e.target.value as LinkEditor['confidence'] })}><option value="unverified">Unverified · working hypothesis</option><option value="supported">Supported · some evidence</option><option value="verified">Verified · confirmed evidence</option></select></label><label>SUPPORTING NOTES<textarea rows={4} maxLength={6000} placeholder="Describe the source or evidence for this connection…" value={editor.note} onChange={e => setEditor({ ...editor, note: e.target.value })}/></label></>}
   {error && <p className="graph-form-error" role="alert">{error}</p>}<div className="graph-dialog-footer"><button type="button" onClick={() => setEditor(null)}>Cancel</button><button className="primary" type="submit"><Check size={15}/>{editor.id ? 'Save changes' : editor.type === 'node' ? 'Add entity' : 'Create connection'}</button></div>
  </form></EditorDialog>}
 </div>;
}
