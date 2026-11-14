import './style.css';
import {cardFields, cardTitle, type CardItem, type CardField} from './presentation';
import {definePluginSettings} from '@api/Settings';
import {findGroupChildrenByChildId, type NavContextMenuPatchCallback} from '@api/ContextMenu';
import {ModalRoot, ModalHeader, ModalContent, ModalCloseButton, openModal, type ModalProps} from '@utils/modal';
import definePlugin, {OptionType, type PluginNative} from '@utils/types';
import {fetchUserProfile} from '@utils/discord';
import {Menu, React, useEffect, useState, useStateFromStores, UserProfileStore} from '@webpack/common';

const Native = VencordNative.pluginHelpers.H3XSearch as PluginNative<typeof import('./native')>;
const settings = definePluginSettings({
    siteUrl: {type: OptionType.STRING, description: 'Your H3X HTTPS website URL', default: ''},
    apiKey: {type: OptionType.STRING, description: 'Private H3X API key (Account information → Generate API key). Stored in local Equicord settings.', default: ''}
});
type User = {id: string; username: string};
type Result = {items: CardItem[]; notice: string; providerStatus: {source: string; status: string; count: number; message?: string; httpStatus?: number}[]};
function FieldGrid({rows}: {rows: CardField[]}) {
    return <dl className="h3x-fields">{rows.map((row, index) => <div key={index}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>;
}
function ResultCard({item}: {item: CardItem}) {
    const fields = cardFields(item.fields);
    const details = fields.filter(field => field.group === 'Details');
    return <article className="h3x-card">
        <div className="h3x-card-header"><span className="h3x-source">{item.source}</span><h3>{cardTitle(item.fields)}</h3><p className="h3x-muted">{item.matchNote}</p></div>
        <div className="h3x-card-body">
            {(['Identity', 'Contact', 'Location'] as const).map(group => {
                const rows = fields.filter(field => field.group === group);
                return rows.length ? <section key={group}><h4>{group}</h4><FieldGrid rows={rows}/></section> : null;
            })}
            {!!details.length && <details className="h3x-details"><summary>More details · {details.length}</summary><FieldGrid rows={details}/></details>}
            {!fields.length && <p className="h3x-muted">No displayable fields in this record.</p>}
        </div>
    </article>;
}
function SearchModal({user, ...props}: ModalProps & {user: User}) {
    const [started, setStarted] = useState(false);
    const [includeConnections, setIncludeConnections] = useState(false);
    const [loadingConnections, setLoadingConnections] = useState(false);
    const [connectionsError, setConnectionsError] = useState('');
    const [queryNames, setQueryNames] = useState<string[]>([]);
    const profile = useStateFromStores([UserProfileStore], () => UserProfileStore.getUserProfile(user.id));
    const connections = ((profile?.connectedAccounts ?? []) as {name: string; type: string}[]).filter(account => typeof account.name === 'string' && account.name.trim() && account.name.length <= 100 && !/[\x00-\x1f\x7f]/.test(account.name));
    const names = [...new Map(connections.map(account => [account.name.trim().toLowerCase(), account.name.trim()])).values()].filter(name => name.toLowerCase() !== user.username.toLowerCase());
    const [result, setResult] = useState<Result | null>(null);
    const [error, setError] = useState('');
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        if (!includeConnections || started) return;
        let active = true; setLoadingConnections(true); setConnectionsError('');
        (async () => {
            try { await fetchUserProfile(user.id); }
            catch { if (active) setConnectionsError('Could not load this user’s linked accounts. Uncheck the option to search only their Discord ID and username.'); }
            finally { if (active) setLoadingConnections(false); }
        })();
        return () => { active = false; };
    }, [includeConnections, started, user.id]);
    useEffect(() => {
        if (!started) return;
        let active = true; setError(''); setResult(null);
        (async () => {
            try {
                if (!Native?.search) throw new Error('H3XSearch requires desktop Equicord with native plugin helpers.');
                if (!settings.store.siteUrl) throw new Error('Set your H3X site URL in H3XSearch settings.');
                const data = await Native.search(settings.store.siteUrl.trim(), settings.store.apiKey.trim(), user.id, user.username, queryNames);
                if (active) setResult(data);
            } catch (error) { if (active) setError(error instanceof Error ? error.message : 'H3X search failed.'); }
        })();
        return () => { active = false; };
    }, [user.id, user.username, attempt, started, queryNames]);
    return <ModalRoot {...props}>
        <ModalHeader><h2 style={{flex: 1, color: 'var(--text-normal)'}}>Search user on H3X</h2><ModalCloseButton onClick={props.onClose}/></ModalHeader>
        <ModalContent><div className="h3x-search">
            <div className="h3x-identity"><span className="h3x-monogram" aria-hidden="true">{user.username.slice(0, 1).toUpperCase()}</span><div><strong>{user.username}</strong><div className="h3x-muted">Discord · {user.id}</div></div></div>
            {!started && <div>
                <p>Search this user’s Discord ID and username with H3X.</p>
                <label style={{display: 'flex', gap: 10, alignItems: 'center', margin: '16px 0'}}><input type="checkbox" checked={includeConnections} onChange={event => setIncludeConnections(event.currentTarget.checked)}/>Also search usernames of linked accounts on this Discord profile</label>
                {includeConnections && <div>
                    {loadingConnections ? <p role="status">Loading visible linked accounts…</p> : connectionsError ? <p role="alert">{connectionsError}</p> : <>
                        {connections.length ? <ul>{connections.map((account, index) => <li key={index}>{account.type}: {account.name}</li>)}</ul> : <p>No visible linked accounts found. The search will use only the Discord ID and username.</p>}
                        <p>{Math.min(names.length, 10)} additional unique names will be searched with BrixHub and OathNet.</p>
                        {names.length > 10 && <p>The first 10 unique linked names will be included.</p>}
                    </>}
                </div>}
                <button className="h3x-primary" disabled={includeConnections && (loadingConnections || !!connectionsError)} onClick={() => { setQueryNames(includeConnections ? names.slice(0, 10) : []); setStarted(true); }}>Search on H3X</button>
            </div>}
            {started && !result && !error && <p role="status">Searching ID, username{queryNames.length ? ` and ${queryNames.length} linked account names` : ''}…</p>}
            {error && <div role="alert"><p>{error}</p><button onClick={() => setAttempt(attempt + 1)}>Retry</button></div>}
            {result && <><p className="h3x-muted">{result.notice}</p>
                <div className="h3x-summary"><strong>{result.items.length} {result.items.length === 1 ? 'record' : 'records'}</strong><button onClick={() => setStarted(false)}>Change search</button></div>
                <details className="h3x-providers" open={result.providerStatus.some(p => p.status !== 'complete')}><summary>Search sources · {result.providerStatus.filter(p => p.status === 'complete').length}/{result.providerStatus.length} completed</summary>
                    {result.providerStatus.map(p => <div className="h3x-provider" key={p.source}><div><strong>{p.source}</strong><span className={p.status === 'error' ? 'h3x-error' : 'h3x-muted'}>{p.status === 'complete' ? `${p.count} found` : p.status === 'skipped' ? 'Not configured' : `Failed${p.httpStatus ? ` · HTTP ${p.httpStatus}` : ''}`}</span></div>{p.status !== 'complete' && <p className="h3x-muted">{p.message || 'No error detail received. Redeploy the latest H3X Worker to enable provider diagnostics.'}</p>}</div>)}
                </details>
                {!result.items.length && <div className="h3x-empty"><strong>{result.providerStatus.every(p => p.status !== 'complete') ? 'Search unavailable' : 'No matching records'}</strong><p className="h3x-muted">{result.providerStatus.some(p => p.status === 'error') ? 'Some searches failed. Review the source errors above; this is not a complete result.' : 'No matches found in the completed searches.'}</p></div>}
                {result.providerStatus.some(p => p.status === 'error') && <button onClick={() => setAttempt(attempt + 1)}>Retry search</button>}
                {result.items.map(item => <ResultCard key={item.id} item={item}/>)}
            </>}
        </div></ModalContent>
    </ModalRoot>;
}
const userMenu: NavContextMenuPatchCallback = (children, {user}: {user?: User}) => {
    if (!user) return;
    const item = <Menu.MenuItem key="h3x-search-user" id="h3x-search-user" label="Search user on H3X" action={() => openModal(props => <SearchModal {...props} user={{id: user.id, username: user.username}}/>)}/>;
    const group = findGroupChildrenByChildId('devmode-copy-id', children);
    const copyIdIndex = group?.findIndex(child => React.isValidElement<{id?: string}>(child) && child.props.id === 'devmode-copy-id') ?? -1;
    if (group && copyIdIndex !== -1) group.splice(copyIdIndex + 1, 0, item);
    else children.push(<Menu.MenuGroup key="h3x-search">{item}</Menu.MenuGroup>);
};
export default definePlugin({
    name: 'H3XSearch', description: 'Search a selected Discord user ID and username on your H3X account and display result cards.',
    authors: [{name: 'H3X', id: 0n}], settings, contextMenus: {'user-context': userMenu}
});
