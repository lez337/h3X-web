import {definePluginSettings} from '@api/Settings';
import type {NavContextMenuPatchCallback} from '@api/ContextMenu';
import {ModalRoot, ModalHeader, ModalContent, ModalCloseButton, openModal, type ModalProps} from '@utils/modal';
import definePlugin, {OptionType, type PluginNative} from '@utils/types';
import {Menu, React, useEffect, useState} from '@webpack/common';

const Native = VencordNative.pluginHelpers.H3XSearch as PluginNative<typeof import('./native')>;
const settings = definePluginSettings({
    siteUrl: {type: OptionType.STRING, description: 'Your H3X HTTPS website URL', default: ''},
    apiKey: {type: OptionType.STRING, description: 'Private H3X API key (Account information → Generate API key). Stored in local Equicord settings.', default: ''}
});
type User = {id: string; username: string};
type Result = {items: {id: string; source: string; fields: Record<string, unknown>; matchNote: string}[]; notice: string; providerStatus: {source: string; status: string; count: number}[]};
function SearchModal({user, ...props}: ModalProps & {user: User}) {
    const [result, setResult] = useState<Result | null>(null);
    const [error, setError] = useState('');
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        let active = true; setError(''); setResult(null);
        (async () => {
            try {
                if (!Native?.search) throw new Error('H3XSearch requires desktop Equicord with native plugin helpers.');
                if (!settings.store.siteUrl) throw new Error('Set your H3X site URL in H3XSearch settings.');
                const data = await Native.search(settings.store.siteUrl.trim(), settings.store.apiKey.trim(), user.id, user.username);
                if (active) setResult(data);
            } catch (error) { if (active) setError(error instanceof Error ? error.message : 'H3X search failed.'); }
        })();
        return () => { active = false; };
    }, [user.id, user.username, attempt]);
    return <ModalRoot {...props}>
        <ModalHeader><h2 style={{flex: 1, color: 'var(--text-normal)'}}>Search user on H3X</h2><ModalCloseButton onClick={props.onClose}/></ModalHeader>
        <ModalContent><div style={{color: 'var(--text-normal)', padding: '16px 0'}}>
            <p><strong>{user.username}</strong> · <code>{user.id}</code></p>
            {!result && !error && <p role="status">Searching ID and username…</p>}
            {error && <div role="alert"><p>{error}</p><button onClick={() => setAttempt(attempt + 1)}>Retry</button></div>}
            {result && <><p>{result.notice}</p><p>{result.items.length} cards found</p>
                {!result.items.length && <p>{result.providerStatus.every(p => p.status === 'error') ? 'Search unavailable. Providers failed; try again later.' : 'No matches found in the completed searches.'}</p>}
                {result.providerStatus.map(p => <p key={p.source}>{p.source}: {p.status} ({p.count})</p>)}
                {result.items.map(item => <article key={item.id} style={{background: 'var(--background-secondary)', border: '1px solid var(--background-modifier-accent)', borderRadius: 12, padding: 16, margin: '12px 0'}}>
                    <h3>{item.source}</h3><small>{item.matchNote}</small>
                    <dl>{Object.entries(item.fields).map(([key, value]) => <div key={key} style={{marginTop: 8}}><dt style={{fontWeight: 600}}>{key.replaceAll('_', ' ')}</dt><dd style={{margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>{typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? '')}</dd></div>)}</dl>
                </article>)}
            </>}
        </div></ModalContent>
    </ModalRoot>;
}
const userMenu: NavContextMenuPatchCallback = (children, {user}: {user?: User}) => {
    if (!user) return;
    children.push(<Menu.MenuGroup key="h3x-search"><Menu.MenuItem id="h3x-search-user" label="Search user on H3X" action={() => openModal(props => <SearchModal {...props} user={{id: user.id, username: user.username}}/>)}/></Menu.MenuGroup>);
};
export default definePlugin({
    name: 'H3XSearch', description: 'Search a selected Discord user ID and username on your H3X account and display result cards.',
    authors: [{name: 'H3X', id: 0n}], settings, contextMenus: {'user-context': userMenu}
});
