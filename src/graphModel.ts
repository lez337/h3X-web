import type { Case } from './Investigations';
import {phoneKeys,preferredPhones} from './phoneIdentity.ts';
export type Vec3 = {
    x: number;
    y: number;
    z: number;
};
export type GraphPin = {
    id: string;
    name: string;
    lat: number;
    lng: number;
    note: string;
    caseId?: string;
};
export type GraphLink = {
    id: string;
    from: string;
    to: string;
    label: string;
    note?: string;
    confidence?: 'unverified' | 'supported' | 'verified';
};
export const entityKinds = ['Person', 'Organization', 'Account', 'Email', 'Phone', 'Domain', 'Note'] as const;
export type EntityKind = typeof entityKinds[number];
export type CustomEntity = {
    caseId?: string;
    id: string;
    label: string;
    kind: EntityKind;
    note: string;
    color?: string;
};
export type GraphWorkspace = {
    investigationId?: string;
    detailMode?: 'details' | 'people' | 'investigations';
    nodes: CustomEntity[];
    positions: Record<string, Vec3>;
    hidden: string[];
    colors?: Record<string, string>;
};
export type GraphRecord = {
    cases: Case[];
    pins: GraphPin[];
    links: GraphLink[];
    graph: GraphWorkspace;
};
export type GraphNode = {
    caseId?: string;
    personId?: string;
    derived?: boolean;
    id: string;
    label: string;
    kind: string;
    note: string;
    source: 'case' | 'pin' | 'custom';
    color: string;
};
export type GraphTarget = {
    kind: 'node' | 'link';
    id: string;
} | null;
export type Camera = {
    yaw: number;
    pitch: number;
    zoom: number;
    panX: number;
    panY: number;
};
export const defaultCamera: Camera = { yaw: 0.35, pitch: -0.22, zoom: 1, panX: 0, panY: 0 };
export const emptyGraph: GraphWorkspace = { nodes: [], positions: {}, hidden: [], colors: {} };
export const palette = ['#dedede', '#ffffff', '#bdbdbd', '#a3a3a3', '#929292', '#808080'];
// Keep saved graph accents consistent with the workspace's monochrome theme.
const legacyAccents: Record<string, string> = Object.fromEntries(
    ['#dedee5', '#93b7d4', '#a8bfa5', '#c4acd4', '#d8bb8e', '#d3a0a0'].map((color, index) => [color, palette[index]])
);
export const kindGlyph: Record<string, string> = { Investigation: 'IN', Place: 'PL', Person: 'PE', Organization: 'OR', Account: '@', Email: 'EM', Phone: 'PH', Domain: 'DO', Note: 'N' };
const graphText=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const nameKey=(value:string)=>graphText(value).split(' ').sort().join(' ');
// Only recognized identity/contact facts become automatic nodes. Metadata and
// arbitrary provider fields remain available in the investigation itself.
const importantCategories:Record<string,[string,string]>={
    phone:['Phone','Phone'], 'phone number':['Phone','Phone'], telephone:['Phone','Phone'],
    email:['Email','Email'], 'email address':['Email','Email'],
    username:['Username','Account'], user:['Username','Account'],
    address:['Address','Place'], 'home address':['Address','Place'],
    city:['City','Place'], country:['Country','Place'], nationality:['Nationality','Note'],
    occupation:['Occupation','Note'], job:['Occupation','Note'],
    company:['Company','Organization'], employer:['Company','Organization'], organization:['Company','Organization'],
};
function redundantCases(record:GraphRecord):Map<string,string>{
    if(record.graph.detailMode==='investigations')return new Map();
    return new Map(record.cases.filter(c=>c.people?.length===1&&nameKey(c.title)===nameKey(c.people[0].name||[c.people[0].firstName,c.people[0].lastName].filter(Boolean).join(' '))).map(c=>[c.id,'person:'+JSON.stringify([c.id,c.people![0].id])]));
}
export function investigationGraph(record: GraphRecord): {nodes: GraphNode[]; links: GraphLink[]} {
    const nodes: GraphNode[]=[],links: GraphLink[]=[];
    if(record.graph.detailMode==='investigations')return {nodes,links};
    for(const c of record.cases)for(const p of c.people||[]){
        const id='person:'+JSON.stringify([c.id,p.id]);
        nodes.push({id,label:p.name||[p.firstName,p.lastName].filter(Boolean).join(' ')||'Unnamed person',kind:'Person',note:p.notes,source:'case',caseId:c.id,personId:p.id,derived:true,color:palette[0]});
        links.push({id:'auto:'+id,from:c.id,to:id,label:'Person',confidence:'supported'});
        if(record.graph.detailMode==='people')continue;
        const fields:[string,string,string|undefined][]=[['Phone','Phone',p.phone],['Phone','Phone',p.altPhone],['Email','Email',p.email],['Username','Account',p.username],['Date of birth','Note',p.dateOfBirth],['Age','Note',p.dateOfBirth?'':p.age],['Address','Place',p.address],['Postal code','Place',p.address?.includes(p.postalCode||'')?'':p.postalCode],['Tax code','Note',p.taxCode],['Shipping','Place',p.shipping],...(p.customCategories||[]).flatMap(f=>{const category=importantCategories[graphText(f.label).replace(/[_-]+/g,' ')];return category?[[...category,f.value] as [string,string,string]]:[]})];
        const phones=phoneKeys(fields.filter(([,kind])=>kind==='Phone').flatMap(([, ,raw])=>(raw||'').split(/[,;\n]+/).map(v=>v.trim()).filter(Boolean)));
        const preferred=preferredPhones([...phones.keys()]);
        const seen=new Set<string>();
        for(const [label,kind,raw] of fields)for(const value of (raw||'').split(['Phone','Email','Account'].includes(kind)?/[,;\n]+/:/\n+/).map(v=>v.trim()).filter(Boolean)){
            if(/^(?:unknown|undefined|null|n\/a|none|not available|-)$/i.test(value))continue;
            if(nameKey(value)===nameKey(p.name||[p.firstName,p.lastName].filter(Boolean).join(' ')))continue;
            const normalized=kind==='Phone'?phones.get(value)||'':graphText(value);
            const key=JSON.stringify([kind==='Note'?label:kind,normalized]);if(!normalized||seen.has(key))continue;seen.add(key);
            const fieldId='detail:'+JSON.stringify([c.id,p.id,label,normalized]);
            nodes.push({id:fieldId,label:kind==='Phone'?preferred.get(normalized)||value:value,kind,note:label+' · '+(p.name||'Unnamed person'),source:'case',caseId:c.id,personId:p.id,derived:true,color:palette[0]});
            links.push({id:'auto:'+fieldId,from:id,to:fieldId,label,confidence:'supported'});
        }
    }
    return {nodes,links};
}
export function graphLinks(record: GraphRecord): GraphLink[]{
    const aliases=redundantCases(record);
    return [...record.links,...investigationGraph(record).links].filter(l=>!record.graph.hidden.includes(l.id)).map(l=>({...l,from:aliases.get(l.from)||l.from,to:aliases.get(l.to)||l.to})).filter(l=>l.from!==l.to);
}
export function graphNodes(record: GraphRecord): GraphNode[] {
    const aliases=redundantCases(record);
    return [
        ...record.cases.filter(c=>!aliases.has(c.id)).map(c => ({ id: c.id, label: c.title, kind: 'Investigation', note: c.summary, source: 'case' as const, color: palette[0] })),
        ...record.pins.map(p => ({ id: p.id, label: p.name, kind: 'Place', note: p.note, source: 'pin' as const, color: palette[0] })),
        ...investigationGraph(record).nodes,
        ...record.graph.nodes.map(n => ({ ...n, source: 'custom' as const, color: n.color || palette[0] }))
    ].map(n => {
        const color = record.graph.colors?.[n.id] || n.color;
        return { ...n, color: legacyAccents[color] || color };
    });
}
// Scope legacy connected entities as well as saved people to one investigation.
// Never traverse into records owned by another investigation.
export function investigationView(record: GraphRecord, caseId?: string) {
    const full = {...record, graph: {...record.graph, detailMode: 'details' as const}};
    const nodes = graphNodes(full), links = graphLinks(full);
    if (!caseId) return {nodes, links};
    const pinCases = new Map(record.pins.map(p => [p.id, p.caseId]));
    const allowed = nodes.filter(n => {
        const owner = n.caseId || (n.kind === 'Investigation' ? n.id : pinCases.get(n.id));
        return !owner || owner === caseId;
    });
    const ids = new Set(allowed.filter(n => n.id === caseId || n.caseId === caseId || pinCases.get(n.id) === caseId ||
        // Legacy unconnected entities belong to the sole investigation.
        (record.cases.length === 1 && n.source === 'custom')).map(n => n.id));
    const allowedIds = new Set(allowed.map(n => n.id));
    let changed = true;
    while (changed) {
        changed = false;
        for (const l of links) if (allowedIds.has(l.from) && allowedIds.has(l.to) && (ids.has(l.from) || ids.has(l.to))) {
            if (!ids.has(l.from) || !ids.has(l.to)) changed = true;
            ids.add(l.from); ids.add(l.to);
        }
    }
    return {nodes: allowed.filter(n => ids.has(n.id)), links: links.filter(l => ids.has(l.from) && ids.has(l.to))};
}

export function expandedPersonNodes(nodes: GraphNode[], expanded: ReadonlySet<string>) {
    const people = new Map(nodes.filter(n => n.kind === 'Person' && n.personId).map(n => [JSON.stringify([n.caseId, n.personId]), n.id]));
    return nodes.filter(n => !n.derived || n.kind === 'Person' || expanded.has(people.get(JSON.stringify([n.caseId, n.personId])) || ''));
}
export function rotate(p: Vec3, c: Camera): Vec3 {
    const x = p.x * Math.cos(c.yaw) + p.z * Math.sin(c.yaw), z = -p.x * Math.sin(c.yaw) + p.z * Math.cos(c.yaw);
    return { x, y: p.y * Math.cos(c.pitch) - z * Math.sin(c.pitch), z: p.y * Math.sin(c.pitch) + z * Math.cos(c.pitch) };
}
export function unrotate(p: Vec3, c: Camera): Vec3 {
    const y = p.y * Math.cos(c.pitch) + p.z * Math.sin(c.pitch), z = -p.y * Math.sin(c.pitch) + p.z * Math.cos(c.pitch);
    return { x: p.x * Math.cos(c.yaw) - z * Math.sin(c.yaw), y, z: p.x * Math.sin(c.yaw) + z * Math.cos(c.yaw) };
}
export function project(p: Vec3, c: Camera, width: number, height: number, flat = false) {
    const r = flat ? { ...p, z: 0 } : rotate(p, c), scale = 1000 / Math.max(250, 1000 + r.z) * c.zoom;
    return { x: width / 2 + c.panX + r.x * scale, y: height / 2 + c.panY + r.y * scale, z: r.z, scale };
}
export function screenToWorld(x: number, y: number, c: Camera, width: number, height: number, flat = false): Vec3 {
    const p = { x: (x - width / 2 - c.panX) / c.zoom, y: (y - height / 2 - c.panY) / c.zoom, z: 0 };
    return flat ? p : unrotate(p, c);
}
export function layoutGraph(ids: string[], links: GraphLink[], flat = false): Record<string, Vec3> {
    const n = ids.length, radius = Math.max(135, Math.sqrt(n) * 60), golden = Math.PI * (3 - Math.sqrt(5));
    const points = ids.map((_, i) => { const y = n === 1 ? 0 : 1 - 2 * (i + .5) / n, r = Math.sqrt(1 - y * y); return flat ? { x: Math.cos(i * golden) * Math.sqrt((i + 1) / Math.max(n, 1)) * radius, y: Math.sin(i * golden) * Math.sqrt((i + 1) / Math.max(n, 1)) * radius, z: 0 } : { x: Math.cos(i * golden) * r * radius, y: y * radius * .8, z: Math.sin(i * golden) * r * radius }; });
    const index = new Map(ids.map((id, i) => [id, i])), edges = links.map(l => [index.get(l.from), index.get(l.to)]).filter((e): e is [
        number,
        number
    ] => e[0] !== undefined && e[1] !== undefined && e[0] !== e[1]);
    // Bound pair work for large workspaces; every node still participates in link forces.
    const steps = n > 350 ? 28 : 75, stride = Math.max(1, Math.ceil(n / 350));
    for (let step = 0; step < steps; step++) {
        const force = points.map(() => ({ x: 0, y: 0, z: 0 }));
        for (let i = 0; i < n; i++)
            for (let j = i + 1 + step % stride; j < n; j += stride) {
                const a = points[i], b = points[j], dx = a.x - b.x, dy = a.y - b.y, dz = flat ? 0 : a.z - b.z, d2 = Math.max(100, dx * dx + dy * dy + dz * dz), f = 1800 / d2;
                force[i].x += dx * f;
                force[i].y += dy * f;
                force[i].z += dz * f;
                force[j].x -= dx * f;
                force[j].y -= dy * f;
                force[j].z -= dz * f;
            }
        for (const [a, b] of edges) {
            const dx = points[b].x - points[a].x, dy = points[b].y - points[a].y, dz = flat ? 0 : points[b].z - points[a].z, d = Math.hypot(dx, dy, dz) || 1, f = (d - 150) * .018;
            for (const key of ['x', 'y', 'z'] as const) {
                const amount = ({ x: dx, y: dy, z: dz })[key] / d * f;
                force[a][key] += amount;
                force[b][key] -= amount;
            }
        }
        points.forEach((p, i) => { for (const key of ['x', 'y', 'z'] as const)
            p[key] += Math.max(-10, Math.min(10, force[i][key] - p[key] * .003)) * (1 - step / steps * .7); });
    }
    return Object.fromEntries(ids.map((id, i) => [id, points[i]]));
}
