export type CardItem = {id: string; source: string; fields: Record<string, unknown>; matchNote: string};
export type CardField = {label: string; value: string; group: 'Identity' | 'Contact' | 'Location' | 'Details'};
const hidden = /password|passwd|secret|token|cookie|session|auth|api.?key|credit.?card|ssn|social.?security/i;
export function cardFields(fields: Record<string, unknown>): CardField[] {
    const rows: CardField[] = [];
    function visit(value: unknown, path: string[], depth: number) {
        if (depth > 5 || rows.length >= 120 || value == null || value === '' || value === '[redacted]' || path.some(key => hidden.test(key))) return;
        if (typeof value === 'object') {
            Object.entries(value).slice(0, 120).forEach(([key, entry]) => visit(entry, [...path, key], depth + 1));
            return;
        }
        const key = path.join('_').toLowerCase();
        const group = /email|phone|telephone|mobile|website|profile_url/.test(key) ? 'Contact'
            : /address|adresse|city|ville|country|pays|postal|region|location/.test(key) ? 'Location'
            : /username|user_name|utilisateur|display_name|nom_affichage|first_name|last_name|prenom|nom_famille|real_name|^name$|discord_id|user_id/.test(key) ? 'Identity' : 'Details';
        rows.push({label: path.join(' · ').replace(/_/g, ' '), value: String(value).slice(0, 2000), group});
    }
    Object.entries(fields).forEach(([key, value]) => visit(value, [key], 0));
    return rows;
}
export function cardTitle(fields: Record<string, unknown>): string {
    for (const key of ['display_name', 'nom_affichage', 'real_name', 'name', 'username', 'nom_utilisateur', 'email', 'discord_id', 'user_id']) {
        if (typeof fields[key] === 'string' && fields[key].trim() && fields[key] !== '[redacted]') return fields[key].slice(0, 100);
    }
    return 'Search record';
}
