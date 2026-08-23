/*
 * hosted/oauth-proxy/worker.js — a deliberately dumb CORS relay.
 *
 * WHY THIS EXISTS
 * ---------------
 * GitHub's OAuth device-flow endpoints (github.com/login/device/code and
 * github.com/login/oauth/access_token) do not serve CORS headers, so a browser
 * cannot call them directly: the request is made, the response comes back, and
 * the browser refuses to let the page read it. Everything else the Latch console
 * does talks straight to api.github.com, which does serve CORS. This relay
 * exists only to add the CORS headers to those two endpoints, and it is
 * deliberately as dumb as a thing can be:
 *
 *   - it relays EXACTLY two paths and 404s everything else;
 *   - it holds NO client secret (device flow does not use one);
 *   - it holds NO state and NO storage — nothing to leak, nothing to breach;
 *   - it NEVER logs a request or response body, because those bodies carry a
 *     device code and, on the last hop, an access token;
 *   - it never sees a single byte of anyone's repository.
 *
 * If this relay is down, the console's fine-grained-token path still works. It
 * is a convenience on the sign-in step, not a dependency of the product.
 *
 * Zero dependencies. Deploy with wrangler; see DEPLOY.md.
 */

const GITHUB_DEVICE_CODE = 'https://github.com/login/device/code';
const GITHUB_ACCESS_TOKEN = 'https://github.com/login/oauth/access_token';

const ROUTES = {
  '/login/device/code': GITHUB_DEVICE_CODE,
  '/login/oauth/access_token': GITHUB_ACCESS_TOKEN
};

const DEFAULT_ORIGINS = ['https://latchgate.dev'];

function allowedOrigins(env) {
  const configured = (env && env.ALLOWED_ORIGINS ? String(env.ALLOWED_ORIGINS) : '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '');
  return configured.length ? configured : DEFAULT_ORIGINS;
}

// An exact match against the allow-list, plus any http://localhost:<port> so a
// developer can run the site locally without redeploying the worker.
function resolveOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  if (allowedOrigins(env).indexOf(origin) !== -1) return origin;
  if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return origin;
  if (/^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) return origin;
  return null;
}

function corsHeaders(origin) {
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  });
  if (origin) headers.set('Access-Control-Allow-Origin', origin);
  return headers;
}

function json(body, status, origin) {
  const headers = corsHeaders(origin);
  headers.set('Content-Type', 'application/json');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const target = Object.prototype.hasOwnProperty.call(ROUTES, url.pathname) ? ROUTES[url.pathname] : null;
    const origin = resolveOrigin(request, env);

    // Preflight. Answered for the two real paths only, and only for an origin
    // on the allow-list — an unknown origin gets no Allow-Origin header, so the
    // browser blocks it, which is the point.
    if (request.method === 'OPTIONS') {
      if (!target) return new Response(null, { status: 404 });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (!target) return new Response('not found', { status: 404 });
    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405, origin);
    }
    if (!origin) {
      return json({ error: 'origin_not_allowed', error_description: 'This relay only answers the origins in ALLOWED_ORIGINS.' }, 403, null);
    }

    let body;
    try {
      body = await request.text();
    } catch (error) {
      return json({ error: 'invalid_request', error_description: 'The request body could not be read.' }, 400, origin);
    }

    let upstream;
    try {
      upstream = await fetch(target, {
        method: 'POST',
        headers: {
          // GitHub defaults these endpoints to form encoding; ask for JSON so
          // the browser gets JSON either way.
          Accept: 'application/json',
          'Content-Type': request.headers.get('Content-Type') || 'application/json',
          'User-Agent': 'latch-oauth-relay'
        },
        body
      });
    } catch (error) {
      // No body, no token, no device code in the log line.
      return json({ error: 'upstream_unreachable', error_description: 'GitHub did not answer the device-flow endpoint.' }, 502, origin);
    }

    const text = await upstream.text();
    const headers = corsHeaders(origin);
    headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
    headers.set('Cache-Control', 'no-store');
    return new Response(text, { status: upstream.status, headers });
  }
};
