# Deploying the OAuth relay

`worker.js` is a stateless CORS pass-through for the two GitHub OAuth
**device-flow** endpoints. GitHub does not serve CORS headers on those, so a
browser cannot call them directly; this relay adds the headers and nothing else.
It holds no client secret, keeps no state, stores nothing, and never logs a
request or response body.

**Until an owner completes these four steps, the console's fine-grained-token
path is the only sign-in.** The "Sign in with GitHub" button renders disabled
with an inline note saying exactly that. That is the intended fallback, not a
broken state — the token path needs no hosted piece at all.

## 1. Register the GitHub OAuth App

<https://github.com/settings/developers> → **OAuth Apps** → **New OAuth App**.

- **Application name:** `Latch Console`
- **Homepage URL:** `https://latchgate.dev`
- **Authorization callback URL:** `https://latchgate.dev/console/` (the device
  flow never redirects, but the field is required)
- Create the app, then on its settings page tick **Enable Device Flow** and save.

Copy the **Client ID**. Do **not** generate a client secret: the device flow does
not use one, and a secret you never create cannot leak from a static page.

The console asks for the `repo workflow` scopes — `repo` reaches Actions
variables and secret *metadata* (names only), `workflow` is what lets the install
PR commit files under `.github/workflows/`.

## 2. Deploy the worker

Wrangler needs a `wrangler.toml` next to `worker.js`. Do not commit one — it is
per-deployment. Create it locally:

```toml
name = "latch-oauth-relay"
main = "worker.js"
compatibility_date = "2026-01-01"

[vars]
ALLOWED_ORIGINS = "https://latchgate.dev"
```

Then:

```sh
cd hosted/oauth-proxy
npx wrangler deploy
```

Note the deployed URL (e.g. `https://latch-oauth-relay.<subdomain>.workers.dev`).

## 3. Set `ALLOWED_ORIGINS`

Comma-separated exact origins. Defaults to `https://latchgate.dev` when unset.
`http://localhost:<port>` and `http://127.0.0.1:<port>` are always allowed so the
site can be run locally without a redeploy.

```sh
npx wrangler deploy --var ALLOWED_ORIGINS:"https://latchgate.dev,https://nishantkumar1292.github.io"
```

An origin that is not on the list gets no `Access-Control-Allow-Origin` header
and the browser blocks it. That is the whole access control, and it is enough:
the relay carries no secret and no state.

## 4. Wire the console

Fill in `CONSOLE_CONFIG` at the top of `site/console/latch-console.js`:

```js
var CONSOLE_CONFIG = {
  OAUTH_CLIENT_ID: "Iv1.xxxxxxxxxxxxxxxx",
  OAUTH_PROXY_URL: "https://latch-oauth-relay.example.workers.dev",
  TEMPLATE_BASE: "https://raw.githubusercontent.com/nishantkumar1292/latch/master/"
};
```

Commit and publish the site. The sign-in button enables itself: the console
treats a blank or placeholder value as "not configured".

## Verifying it

```sh
curl -i -X POST "https://<worker-url>/login/device/code" \
  -H "Origin: https://latchgate.dev" \
  -H "Content-Type: application/json" \
  -d '{"client_id":"<client-id>","scope":"repo workflow"}'
```

Expect `200`, an `Access-Control-Allow-Origin: https://latchgate.dev` header, and
a JSON body with `device_code` and `user_code`. Then check the guards:

```sh
curl -i "https://<worker-url>/anything-else"                     # expect 404
curl -i -X POST "https://<worker-url>/login/device/code" \
  -H "Origin: https://evil.example" -d '{}'                      # expect 403
```

## What it does not do

- No client secret, no state, no KV, no D1, no durable object.
- No path other than `/login/device/code` and `/login/oauth/access_token`.
- No logging of request or response bodies — they carry a device code and, on
  the final hop, an access token.
- No contact with `api.github.com`, and no visibility into any repository. The
  console talks to the GitHub API directly from the browser; the relay is only
  in the sign-in handshake.
