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

Edit `.dev.vars` and replace `H3X_ACCESS_KEY` with a unique random value of at least 24 characters. Then:

```powershell
npm run preview
```

Open the URL Wrangler prints, normally `http://localhost:8787`, and sign in with that access key. Wrangler is fetched with `npx wrangler@4`; the first run requires internet access. The access key gates the API and is exchanged for an eight-hour HttpOnly, SameSite session cookie. HTTPS deployments also set Secure. An unconfigured Worker denies API access.

For frontend development, leave `npm run dev:worker` running in one terminal and run `npm run dev` in another. Open `http://127.0.0.1:5173`. Rebuild after Worker source changes because Wrangler uses the compiled Worker.

## Deploy to your Cloudflare account

```powershell
npm run deploy:check
npx wrangler@4 login
npm run deploy
npx wrangler@4 secret put H3X_ACCESS_KEY
```

Enter your access key at Wrangler's hidden prompt. Until the secret is configured the deployed API remains locked. Optionally configure an OathNet fallback key on the Worker:

```powershell
npx wrangler@4 secret put OATHNET_API_KEY
```

The deployment uses the Worker name in `wrangler.jsonc`. It serves `dist/client` as static assets and `dist/server/index.js` as an ES module Worker. `/api/*` runs through the Worker; application routes fall back to the React entry page. No D1, R2, Queues, desktop process or Discord application is required.

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

4. Add `H3X_ACCESS_KEY` as a **runtime secret** under the Worker's **Settings > Variables and Secrets**, using a unique random value of at least 24 characters. The API stays locked until this is configured. Optional provider secrets also belong here, not in build variables.
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
| Dashboard, investigations, people, evidence, graph, map pins, shortcuts and history | Original interface; saved in IndexedDB in this browser |
| BrixHub, OathNet, account profiles, GitHub, RDAP and the 31 public APIs | Shared adapters through authenticated, same-origin Worker requests; compatible selected providers receive the query |
| Username checks | Shared Maigret rules and missing-account controls; five sites per API request, two concurrent site checks; 100 sites by default, optional larger or all-site scans |
| Deep search | Shared validation and review; one bounded task per request, combined in the browser; OathNet bulk polling and BrixHub pagination; completed streamed records survive Stop |
| File search | Local Web Worker; TXT, LOG, CSV, TSV, JSON, JSONL, NDJSON and ZIP; file contents are not uploaded |
| TXT/HTML investigations, result exports, log exports and imports | Browser file picker and downloads |
| Complete workspace backup and restore | Settings → Search → Browser workspace; accepts the desktop workspace JSON schema |
| Provider credentials entered in Settings | Memory only for the current page session; cleared by refresh, close or sign-out |
| Optional provider credentials on the Worker | `OATHNET_API_KEY` or `PROVIDER_<UPPERCASE_CATALOG_ID>` secrets; status returns booleans, never keys |

Workspace data does not automatically sync between browsers, devices, the Windows application or the Discord bot. Download backups before clearing browser data. Your API requests and provider responses pass through Cloudflare; only the requested provider receives each lookup. Worker observability is disabled by default, and the application does not log queries or credentials.

### Desktop differences

GHunt/local executables, Windows Telegram account sessions, automatic filesystem exports, installer updates and stealer file-tree browsing require the desktop app. The web interface explains or disables these functions. Username catalog updates ship with deployments rather than writing a server-side catalog cache. Provider keys stored by Windows are not imported.

Text files are limited to 20 MB each, selected batches to 100 MB/100 files, ZIP expansion to 100 MB/2,000 entries, scanned entries to 1,000 and matches to 3,000. ZIP decompression is bounded as bytes arrive. Large files are scanned off the main UI thread and Stop terminates that worker.

Deep search supports 100 or 300 records per BrixHub task, up to 84 tasks in a reviewed plan and 5,000 retained records per run. Unbounded desktop long searches are disabled. OathNet bulk tasks poll at five-second intervals and cap outgoing requests. Stopping disconnects the stream and aborts local provider work; a remote job already submitted may continue. Cloudflare runtime quotas and upstream provider quotas still apply. Live provider credentials and upstream reachability need verification in your account.

## Validation and implementation

`npm run build` checks TypeScript, builds the browser application, and bundles the Worker without Electron, filesystem APIs or child processes. `npm test` runs inherited adapter/model/export/scanner tests plus web authentication, request limits, streaming cancellation, client orchestration, session-key clearing and browser file-worker tests with fictional fixtures. It makes no paid or live lookups.

The browser bridge is `src/web/bridge.ts`; authenticated API routing is `worker/index.mjs`. `scripts/prepare-shared.mjs` bundles the shared browser-compatible code and derives username rule logic from the original engine. The generated `src/web/shared.js` and `worker/username-core.cjs` are reproducible and ignored. `electron/` contains retained shared source and regression tests, not an Electron runtime dependency. The Worker build substitutes `worker/desktop.cjs` for the desktop executable integration.

The local fixture harness (`node tests/serve-fixture.mjs`, after a build) uses synthetic records and a test-only access key. It is for QA and is never part of the Cloudflare deployment. Do not use it as a production server.

Local verification on 2026-11-14 passed the production build and all 138 automated tests. A Cloudflare deployment, Wrangler runtime validation, browser visual check and live upstream smoke test remain to be performed in the deployment account.

Source attribution: [lez337/H3X-v2](https://github.com/lez337/H3X-v2). Username catalog rules are adapted from [Maigret](https://github.com/soxoj/maigret) under MIT; the original notice is retained in `electron/MAIGRET-LICENSE.txt`.

Cloudflare references: [Static Assets](https://developers.cloudflare.com/workers/static-assets/), [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/), [Secrets](https://developers.cloudflare.com/workers/configuration/secrets/).
