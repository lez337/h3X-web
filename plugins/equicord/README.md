# H3XSearch for Equicord desktop

1. Deploy the updated H3X Worker (`npm run deploy` in the H3X project, or push through your Cloudflare build setup).
2. Sign into H3X, click your account at bottom left, and choose **Generate API key** in Account information. Copy it before closing. This is separate from your eight-digit login code.
3. Copy the entire `h3xSearch` folder into your Equicord source checkout at `src/userplugins/h3xSearch` (both `index.tsx` and `native.ts`).
4. In the Equicord checkout run `pnpm build`, then fully quit and restart Discord. Enable **H3XSearch** in Equicord Plugins.
5. Open H3XSearch settings. Set **siteUrl** to your H3X HTTPS website URL, and **apiKey** to the copied key.
6. Right-click a user and choose **Search user on H3X**. A popup shows loading, result cards, no matches, or provider errors. It sends only the selected ID and username when clicked.

The native helper supports `*.workers.dev`. For a custom domain, add its exact hostname to `CUSTOM_HOSTS` in `native.ts`, then rebuild and restart Equicord. Redirects are rejected so credentials cannot be forwarded to another host. Native helpers require desktop Equicord; this package is not a browser extension plugin.

Keys are stored in Equicord's local plugin settings; treat settings exports as sensitive. H3X stores only the key hash. **Replace API key** disables the previous key; **Revoke API key** disables access immediately. The key cannot read or edit your investigations, manage reports, or sign into your account. Signing out does not revoke the integration key.

The API checks BrixHub by exact search fields `discord_id` and `nom_utilisateur`. When `OATHNET_API_KEY` is configured as a Worker secret, it also fetches the Discord profile. Browser-only provider keys are not used by this integration. Results contain the first provider page (20 rows per BrixHub query), with duplicate cards removed and sensitive credential fields redacted. It does not search saved investigations or perform exhaustive pagination. Username matches may be unrelated people; verify them. Provider failures appear separately from no matches.

There is no H3X request quota or expiry for this key. Cloudflare service quotas, costs and upstream provider restrictions still apply; this does not grant unlimited third-party API calls.

## API

`POST /api/v1/discord/search`

Headers: `Authorization: Bearer <H3X API key>` and `Content-Type: application/json`.

```json
{"userId":"123456789012345678","username":"fictional.user"}
```

Keep `userId` a string to preserve precision. The JSON response includes `items` (cards with `source`, `fields`, `matchedBy`, `matchNote`), `providerStatus`, `notice`, and `quota`. Provider errors can return HTTP 200 with partial or empty results; inspect `providerStatus`. Authentication failures return 401, invalid inputs 400. Only this endpoint accepts the integration key. Browser CORS is intentionally not enabled; the desktop plugin uses a bounded native request instead.

Account management uses session-authenticated `GET /api/account/api-key` for status and `POST /api/account/api-key` with `{"action":"create"}` or `{"action":"revoke"}`. Create returns the plaintext key once, and replaces any existing integration key.

Official Equicord references: [custom plugins](https://docs.equicord.org/installing/custom-plugin/), [plugin API](https://docs.equicord.org/plugins/common/), [native helpers](https://docs.equicord.org/plugins/native/).

H3X tests cover API authentication and lookups using fictional fixtures. The plugin must still be built and smoke-tested inside your Equicord installation.
