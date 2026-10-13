// -----------------------------------------------------------------------------
// A fake `fetch`: tests never touch the network. Each test routes the requests
// to a handler that answers like the Verisure cloud would.
// -----------------------------------------------------------------------------

/**
 * Replace globalThis.fetch for the duration of a test.
 * @param {import('node:test').TestContext} t
 * @param {(call: { url: URL, method: string, headers: Record<string, string>, body: any }) =>
 *   { status?: number, json?: any, text?: string, cookies?: string[] } | Promise<...>} handler
 * @returns {{ calls: object[] }} every request received, in order
 */
export function fakeFetch(t, handler) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    let body;
    if (typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call = {
      url: new URL(url),
      method: init.method ?? 'GET',
      headers: Object.fromEntries(
        Object.entries(init.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
      ),
      body,
    };
    calls.push(call);
    const answer = (await handler(call)) ?? { status: 404, text: 'not found' };
    const headers = new Headers();
    for (const cookie of answer.cookies ?? []) {
      headers.append('set-cookie', cookie);
    }
    const text = answer.text ?? (answer.json === undefined ? '' : JSON.stringify(answer.json));
    return new Response(text, { status: answer.status ?? 200, headers });
  });
  return { calls };
}

/** An unsigned JWT whose payload is `payload` (the clients never verify it). */
export function fakeJwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.signature`;
}
