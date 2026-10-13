// -----------------------------------------------------------------------------
// The one place that calls `fetch`.
//
// Node 22 ships `fetch`: no HTTP dependency. Every call has a timeout (a cloud
// that never answers must not freeze the refresh loop), and the answer is read
// once as text so an error body (HTML from a WAF, JSON from GraphQL) can still
// be inspected by the caller.
// -----------------------------------------------------------------------------

import { VerisureError } from './errors.js';

export const REQUEST_TIMEOUT_MS = 20_000;

/**
 * @param {string} url
 * @param {{ method?: string, headers?: Record<string, string>, body?: unknown,
 *   timeoutMs?: number }} [options] `body` is JSON-encoded unless it is a string
 * @returns {Promise<{ status: number, text: string, json: any, cookies: string[],
 *   headers: Headers }>}
 */
export async function request(url, { method = 'GET', headers = {}, body, timeoutMs } = {}) {
  const init = {
    method,
    headers: { ...headers },
    signal: AbortSignal.timeout(timeoutMs ?? REQUEST_TIMEOUT_MS),
  };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    // DNS, refused connection, timeout: the host is the useful part, never the
    // headers (they carry the session).
    throw new VerisureError(`Cannot reach ${new URL(url).host}: ${err.message}`, { cause: err });
  }
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return {
    status: response.status,
    text,
    json,
    cookies: readSetCookies(response.headers),
    headers: response.headers,
  };
}

function readSetCookies(headers) {
  if (!headers) {
    return [];
  }
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }
  const raw = typeof headers.get === 'function' ? headers.get('set-cookie') : null;
  // Without getSetCookie the values arrive joined: split on the commas that
  // start a new `name=` pair, not on the ones inside an `Expires` date.
  return raw ? raw.split(/,(?=\s*[^;,=\s]+=)/) : [];
}

/**
 * Merge `Set-Cookie` headers into a jar (`{ name: value }`). A cookie set to an
 * empty value is a deletion.
 * @param {Record<string, string>} jar
 * @param {string[]} setCookies
 * @returns {Record<string, string>} the same jar, updated
 */
export function mergeCookies(jar, setCookies) {
  for (const header of setCookies ?? []) {
    const [pair] = String(header).split(';');
    const index = pair.indexOf('=');
    if (index <= 0) {
      continue;
    }
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (value === '' || value === '""') {
      delete jar[name];
    } else {
      jar[name] = value;
    }
  }
  return jar;
}

/**
 * `Cookie` header from a jar, optionally limited to some cookie names.
 * @param {Record<string, string>} jar
 * @param {(name: string) => boolean} [keep]
 */
export function cookieHeader(jar, keep = () => true) {
  return Object.entries(jar)
    .filter(([name]) => keep(name))
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

/**
 * Payload of a JWT, WITHOUT verifying its signature: the token comes from the
 * Verisure HTTPS endpoint, the integration only reads its expiry and claims.
 * @param {string} token
 * @returns {Record<string, any> | null}
 */
export function decodeJwt(token) {
  try {
    const [, payload] = String(token).split('.');
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
