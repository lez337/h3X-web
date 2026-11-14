import type {IpcMainInvokeEvent} from 'electron';

// Add your own H3X custom domain here if you do not use workers.dev.
const CUSTOM_HOSTS: string[] = [];
export async function search(_event: IpcMainInvokeEvent, site: string, key: string, userId: string, username: string) {
    const url = new URL(site);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !(url.hostname.endsWith('.workers.dev') || CUSTOM_HOSTS.includes(url.hostname)))
        throw new Error('Use your HTTPS workers.dev URL, or add your H3X domain to CUSTOM_HOSTS in native.ts.');
    if (!/^h3x_[a-f0-9]{64}_[a-f0-9]{64}$/.test(key)) throw new Error('Set your H3X account API key in plugin settings.');
    if (!/^\d{14,20}$/.test(userId) || typeof username !== 'string' || !/^\S{2,32}$/.test(username)) throw new Error('Invalid Discord user.');
    const response = await fetch(new URL('/api/v1/discord/search', url.origin), {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(50000),
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${key}`},
        body: JSON.stringify({userId, username})
    });
    // Bound data returned over IPC, including HTML error pages from a wrong server URL.
    const reader = response.body?.getReader();
    if (!reader) throw new Error('H3X returned an empty response.');
    const decoder = new TextDecoder(); let text = '', bytes = 0;
    try {
        while (true) {
            const part = await reader.read(); if (part.done) break;
            bytes += part.value.length;
            if (bytes > 4 * 1024 * 1024) { await reader.cancel(); throw new Error('H3X response too large.'); }
            text += decoder.decode(part.value, {stream: true});
        }
        text += decoder.decode();
    } finally { reader.releaseLock(); }
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('H3X returned an invalid response. Check the site URL and deployment.'); }
    if (!response.ok) throw new Error(data.error || `H3X returned HTTP ${response.status}.`);
    return data;
}
