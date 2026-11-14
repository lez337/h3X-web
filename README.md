# H3X v2 Web for Cloudflare

This is a standalone browser port of **H3X Searcher v0.2.9**. The original React interface, investigation models, graph, map, search adapters, scanner and report exporters are reused here. All source files needed to build the web version are included in this repository; no sibling desktop checkout is required.

## Run locally

Requires Node.js 22 or newer, npm, and a Cloudflare account for deployment.

```powershell
npm ci
npm test
npm run build
Copy-Item .dev.vars.example .dev.vars
```

Provider secrets in `.dev.vars` are optional. Start the local Worker:

```powershell
npm run preview
```

Open the URL Wrangler prints, normally `http://localhost:8787`, and choose **Create an account**. Choose a name, copy the generated 8-digit key, check **I saved the key**, then open your account. Future logins require that name and key. Wrangler is fetched with `npx wrangler@4`; the first run requires internet access. Login creates a revocable eight-hour HttpOnly, SameSite session cookie; HTTPS also sets Secure. Local Wrangler accounts are separate from deployed accounts.

For frontend development, leave `npm run dev:worker` running in one terminal and run `npm run dev` in another. Open `http://127.0.0.1:5173`. Rebuild after Worker source changes because Wrangler uses the compiled Worker.

## Deploy to your Cloudflare account

```powershell
npm run deploy:check
npx wrangler@4 login
npm run deploy
```

The included Durable Object migrations provision persistent account and report storage. No shared workspace access key is required. Optionally configure an OathNet fallback key on the Worker:

```powershell
npx wrangler@4 secret put OATHNET_API_KEY
```

The deployment uses the Worker name in `wrangler.jsonc`. It serves `dist/client` as static assets and `dist/server/index.js` as an ES module Worker. `/api/*` runs through the Worker; application routes fall back to the React entry page. No D1, R2, Queues, desktop process or Discord application is required. Shared investigation links use the Durable Object binding included in this configuration.

## Automatic deployments from GitHub

The source repository is [lez337/h3X-web](https://github.com/lez337/h3X-web). Connect it using **Cloudflare Workers Builds** so pushes to `main` automatically update the website.

1. In the [Cloudflare dashboard](https://dash.cloudflare.com/), open **Workers & Pages**, choose **Create application**, then import the GitHub repository `lez337/h3X-web`. For an existing Worker, open **Settings > Builds > Connect** instead.
2. Authorize the Cloudflare GitHub app to access this repository if prompted.
3. Use the following settings, then save and deploy:

| Setting | Value |
| --- | --- |
| Worker name | `h3x-v2-web` (must match `wrangler.jsonc`) |
| Production branch | `main` |
| Root directory | `/` (repository root) |
| Build command | `npm ci && npm test && npm run build` |
| Deploy command | `npx wrangler@4 deploy` |
| Node.js version | 22 or newer |

4. Optional provider keys belong in **runtime secrets** under the Worker's **Settings > Variables and Secrets**, not build variables. Accounts use the `H3X_ACCOUNTS` binding and migration in `wrangler.jsonc`.
5. Push future changes to `main`. Cloudflare builds, tests and deploys the updated project; build status and logs are available in the Worker's Builds tab. Local edits alone do not trigger a deployment.

Deploy the whole Worker project using `wrangler.jsonc`; `dist/client` alone cannot provide search APIs. Never put access/provider keys in `VITE_*` variables, source code or the hosting configuration. Cloudflare's GitHub connection and runtime secrets are account settings and must be configured separately from the repository.

To publish local changes after the initial setup:

```powershell
git add .
git commit -m "Describe your changes"
git push origin main
```

See Cloudflare's [Workers Builds setup](https://developers.cloudflare.com/workers/ci-cd/builds/) and [build configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

## What works

| Feature | Web behavior |
| --- | --- |
| Dashboard, investigations, people, evidence, graph, map pins, shortcuts and search history | Original interface; automatically saved to the signed-in account on the Worker |
| BrixHub, OathNet, account profiles, GitHub, RDAP and the 31 public APIs | Shared adapters through authenticated, same-origin Worker requests; compatible selected providers receive the query |
| Username checks | Shared Maigret rules and missing-account controls; five sites per API request, two concurrent site checks; 100 sites by default, optional larger or all-site scans |
| Deep search | Shared validation and review; one bounded task per request, combined in the browser; OathNet bulk polling and BrixHub pagination; completed streamed records survive Stop |
| File search | Local Web Worker; TXT, LOG, CSV, TSV, JSON, JSONL, NDJSON and ZIP; file contents are not uploaded |
| HTML investigations | Hosted UUID links with a four-digit code by default, or optional public access with no code |
| TXT investigations, result exports, log exports and imports | Browser file picker and downloads |
| Complete workspace backup and restore | Settings → Search → Browser workspace; accepts the desktop workspace JSON schema |
| Provider credentials entered in Settings | Memory only for the current page session; cleared by refresh, close or sign-out |
| Optional provider credentials on the Worker | `OATHNET_API_KEY` or `PROVIDER_<UPPERCASE_CATALOG_ID>` secrets; status returns booleans, never keys |

Sign in with the same account name and 8-digit key on another browser or device to load the saved workspace. Reload before continuing work that was edited elsewhere. Activity logs stay in account-scoped browser storage. The Windows application and Discord bot do not sync with web accounts. Your API requests and provider responses pass through Cloudflare; only the requested provider receives each lookup. Worker observability is disabled by default.

## Accounts and saved investigations

- Names use 3–32 ASCII letters, numbers, dots, underscores or hyphens and are unique without regard to case.
- Each account receives a cryptographically generated eight-digit key, including leading zeros. It appears once during creation with **Copy key** and **I saved the key**. There is no key recovery.
- Login requires the name and key. Keys are stored only as salted PBKDF2 hashes. Session tokens are random, stored as hashes, expire after eight hours, and are revoked on sign-out.
- Five wrong keys lock the account for 15 minutes across all clients. Per-IP limits also bound login and account creation attempts.
- Investigations save automatically to the account. The header shows save status. Sign-out waits for pending edits to save. A failed save shows a backup button; concurrent edits from a stale tab or device are rejected instead of overwriting newer work.
- Existing browser-only investigations are retained. After logging in, use **Settings → Search → Account workspace → Import previous browser workspace** to deliberately move them into the account, or restore a downloaded backup.
- The `H3X_ACCOUNTS` SQLite-backed Durable Object binding isolates each normalized account name. Workspace data is validated, limited to 8 MB, and stored in chunks using an atomic revision update. Retain both migration entries in `wrangler.jsonc` when deploying.

Deploy the full updated Worker configuration for accounts to become available on the live website. Existing shared access-key cookies do not sign into accounts. The old `H3X_ACCESS_KEY` secret is no longer used.

### Desktop differences

GHunt/local executables, Windows Telegram account sessions, automatic filesystem exports, installer updates and stealer file-tree browsing require the desktop app. The web interface explains or disables these functions. Username catalog updates ship with deployments rather than writing a server-side catalog cache. Provider keys stored by Windows are not imported.

Text files are limited to 20 MB each, selected batches to 100 MB/100 files, ZIP expansion to 100 MB/2,000 entries, scanned entries to 1,000 and matches to 3,000. ZIP decompression is bounded as bytes arrive. Large files are scanned off the main UI thread and Stop terminates that worker.

Deep search supports 100 or 300 records per BrixHub task, up to 84 tasks in a reviewed plan and 5,000 retained records per run. Unbounded desktop long searches are disabled. OathNet bulk tasks poll at five-second intervals and cap outgoing requests. Stopping disconnects the stream and aborts local provider work; a remote job already submitted may continue. Cloudflare runtime quotas and upstream provider quotas still apply. Live provider credentials and upstream reachability need verification in your account.

## Investigation links

Click **Export HTML link** on an investigation. H3X creates a snapshot at `/reports/<uuid>` and shows an automatically generated four-digit access code, including any leading zeros.

1. Use **Copy code** to save the code. It is shown only in the creation dialog.
2. Check **I saved the key**.
3. Click **Create link** to activate the report, then copy or open its link.

For a public report, choose **Public - no code**, then **Create public link**. The code and saved-key checkbox are hidden. Anyone with that UUID link can open the report immediately, without a code or account. Protected access remains the default; existing protected reports keep their code requirement. Access is fixed when a link is activated, so export again to create a link with different access.

Before activation, the link cannot be opened, even with the correct code. Cancel deletes the pending report; abandoned pending reports are removed after one hour. Activated reports remain stored independently of browser data and do not change when you edit the original investigation. Export again to create a new snapshot and UUID.

To delete a hosted export, sign in as its creator and click **My HTML links** beside **Sign out**. Choose **Delete HTML** and confirm. This removes the hosted HTML and disables its link and viewer sessions; the saved investigation in your workspace remains. Both public and protected exports can be deleted. For a link created before the list was added, paste its URL into **Delete an older HTML link**. Ownership is checked on the server; a report code alone cannot authorize deletion.

For protected reports, visitors see a code form without needing the workspace access key. Report HTML is served only after the server verifies the correct code. Five wrong attempts lock that report for 15 minutes across all clients. Codes are stored as salted PBKDF2 hashes, never plaintext. A successful code entry creates a report-specific, HttpOnly one-hour viewer session. **Lock view** revokes that viewer session. Neither the code nor the viewer token is put in the URL.

This feature uses the `INVESTIGATION_REPORTS` SQLite-backed Durable Object binding and migration in `wrangler.jsonc`. Deploy the updated full Worker configuration with `npm run deploy`; Wrangler provisions the namespace during deployment. No separate database ID or new secret is needed. Retain the migration entry in future deployments. The four-digit code protects a single report, not the rest of the workspace. Report HTML is limited to 4 MB and preserves export field exclusions.

## Validation and implementation

`npm run build` checks TypeScript, builds the browser application, and bundles the Worker without Electron, filesystem APIs or child processes. `npm test` runs inherited adapter/model/export/scanner tests plus web authentication, request limits, streaming cancellation, client orchestration, session-key clearing and browser file-worker tests with fictional fixtures. It makes no paid or live lookups.

The browser bridge is `src/web/bridge.ts`; authenticated API routing is `worker/index.mjs`. `scripts/prepare-shared.mjs` bundles the shared browser-compatible code and derives username rule logic from the original engine. The generated `src/web/shared.js` and `worker/username-core.cjs` are reproducible and ignored. `electron/` contains retained shared source and regression tests, not an Electron runtime dependency. The Worker build substitutes `worker/desktop.cjs` for the desktop executable integration.

The local fixture harness (`node tests/serve-fixture.mjs`, after a build) uses synthetic records and in-memory accounts. It is for QA and is never part of the Cloudflare deployment. Do not use it as a production server.

Local verification covers the production build and automated regression tests. A Cloudflare deployment, Wrangler runtime validation, browser visual check and live upstream smoke test remain to be performed in the deployment account.

Source attribution: [lez337/H3X-v2](https://github.com/lez337/H3X-v2). Username catalog rules are adapted from [Maigret](https://github.com/soxoj/maigret) under MIT; the original notice is retained in `electron/MAIGRET-LICENSE.txt`.

Cloudflare references: [Static Assets](https://developers.cloudflare.com/workers/static-assets/), [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/), [Secrets](https://developers.cloudflare.com/workers/configuration/secrets/).
