# H3XSearch for Equicord desktop

1. Deploy the updated H3X Worker (`npm run deploy` in the H3X project, or push through your Cloudflare build setup).
2. Sign into H3X, click your account at bottom left, and choose **Generate API key** in Account information. Copy it before closing. This is separate from your eight-digit login code.
3. Copy the entire `h3xSearch` folder into your Equicord source checkout at `src/userplugins/h3xSearch` (both `index.tsx` and `native.ts`).
4. In the Equicord checkout run `pnpm build`, then fully quit and restart Discord. Enable **H3XSearch** in Equicord Plugins.
5. Open H3XSearch settings. Set **siteUrl** to your H3X HTTPS website URL, and **apiKey** to the copied key.
6. Right-click a user and choose **Search user on H3X**, directly under **Copy User ID**. The popup lets you choose **Also search usernames of linked accounts on this Discord profile**. Leave it unchecked to search only the Discord ID and username. When checked, it loads the selected profile's visible linked accounts and previews their names. Press **Search on H3X** to start; closing this window does not run an H3X search.

The optional search includes up to 10 unique linked account names, excluding repeats of the Discord username. Those names are searched with BrixHub and both OathNet datasets and their matches are labeled on the cards. Hidden connections are not available. Some services show a display name instead of a unique username; treat name matches as candidates. If connections cannot be loaded, uncheck the option to continue with the Discord identity alone. Search requests run with at most four provider calls at once; including connected names may take longer.

The native helper supports `*.workers.dev`. For a custom domain, add its exact hostname to `CUSTOM_HOSTS` in `native.ts`, then rebuild and restart Equicord. Redirects are rejected so credentials cannot be forwarded to another host. Native helpers require desktop Equicord; this package is not a browser extension plugin.

Keys are stored in Equicord's local plugin settings; treat settings exports as sensitive. H3X stores only the key hash. **Replace API key** disables the previous key; **Revoke API key** disables access immediately. The key cannot read or edit your investigations, manage reports, or sign into your account. Signing out does not revoke the integration key.

The API checks BrixHub by exact search fields `discord_id` and `nom_utilisateur`. It also searches OathNet's breach and stealer datasets for both the selected Discord ID and username, plus the OathNet Discord profile lookup. Configure `OATHNET_API_KEY` as a Worker secret to enable these five OathNet calls. Without it, the popup explicitly reports that OathNet was skipped. Browser-only provider keys are not used by this integration. Results contain the first provider page (20 rows per search), with duplicate cards removed and sensitive credential fields redacted. It does not search saved investigations or perform exhaustive pagination. Username matches may be unrelated people; verify them. Provider failures appear separately from no matches.

To configure OathNet, run this in the H3X project and paste your OathNet provider key when prompted (not your H3X integration key):

```powershell
npx wrangler@4 secret put OATHNET_API_KEY
```

Redeploy the updated Worker. Existing plugin installations will receive the added OathNet cards from the API without changing their H3X API key. OathNet calls use the server's configured provider subscription and its limits.

There is no H3X request quota or expiry for this key. Cloudflare service quotas, costs and upstream provider restrictions still apply; this does not grant unlimited third-party API calls.

## API

`POST /api/v1/discord/search`

Headers: `Authorization: Bearer <H3X API key>` and `Content-Type: application/json`.

```json
{"userId":"123456789012345678","username":"fictional.user"}
```

Keep `userId` a string to preserve precision. The JSON response includes `items` (cards with `source`, `fields`, `matchedBy`, `matchNote`), `providerStatus`, `notice`, and `quota`. Provider errors can return HTTP 200 with partial or empty results; inspect `providerStatus`. Authentication failures return 401, invalid inputs 400. Only this endpoint accepts the integration key. Browser CORS is intentionally not enabled; the desktop plugin uses a bounded native request instead.

Optional request property `connectedUsernames` accepts up to 10 strings, each 1-100 characters without control characters. Omit it or send an empty array for the standard search. These names come from the plugin's selected public profile; the API treats them as user-supplied search terms. Connected-name cards include `matchedBy: "connected"` and `matchedQuery`. Update both plugin files and redeploy the Worker to use this option.

Account management uses session-authenticated `GET /api/account/api-key` for status and `POST /api/account/api-key` with `{"action":"create"}` or `{"action":"revoke"}`. Create returns the plaintext key once, and replaces any existing integration key.

Official Equicord references: [custom plugins](https://docs.equicord.org/installing/custom-plugin/), [plugin API](https://docs.equicord.org/plugins/common/), [native helpers](https://docs.equicord.org/plugins/native/).

H3X tests cover API authentication and lookups using fictional fixtures. The plugin must still be built and smoke-tested inside your Equicord installation.
