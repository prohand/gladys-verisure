import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSessionStore } from '../src/store.js';
import { accountKey, createVerisureClient } from '../src/verisure/index.js';
import { cookieHeader, decodeJwt, mergeCookies } from '../src/verisure/http.js';
import { normalizeConfig } from '../src/config.js';
import { memoryStore } from './helpers/fakeClient.js';
import { fakeJwt } from './helpers/fakeFetch.js';

test('the session survives a restart, readable by the container user only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verisure-'));
  createSessionStore(dir).save({ account: 'a', session: { refreshToken: 'r' } });
  assert.deepEqual(createSessionStore(dir).load(), {
    account: 'a',
    session: { refreshToken: 'r' },
  });
  const file = join(dir, 'verisure-session.json');
  assert.equal(statSync(file).mode & 0o077, 0, 'no access for group and others');
  assert.doesNotMatch(readFileSync(file, 'utf8'), /password/);
});

test('clear forgets the session', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verisure-'));
  const store = createSessionStore(dir);
  store.save({ account: 'a' });
  store.clear();
  assert.deepEqual(createSessionStore(dir).load(), {});
});

test('without a writable directory, the session lives in memory', () => {
  // A directory "inside" a regular file can never be created (ENOTDIR).
  const dir = mkdtempSync(join(tmpdir(), 'verisure-'));
  writeFileSync(join(dir, 'file'), '');
  const store = createSessionStore(join(dir, 'file', 'data'));
  store.save({ account: 'a' });
  assert.deepEqual(store.load(), { account: 'a' });
  const none = createSessionStore(null);
  assert.deepEqual(none.load(), {});
});

test('a session saved for another account is not reused', () => {
  const config = normalizeConfig({ username: 'Jean@Example.fr', password: 'pw' });
  assert.equal(accountKey(config), 'owa:FR:jean@example.fr');
  const store = memoryStore({
    account: 'owa:FR:paul@example.fr',
    session: { deviceId: 'abcdabcdabcdabcd', refreshToken: 'r' },
  });
  createVerisureClient(config, store);
  // A fresh identity was created and saved for the new account.
  assert.equal(store.data.account, 'owa:FR:jean@example.fr');
  assert.notEqual(store.data.session.deviceId, 'abcdabcdabcdabcd');
  assert.equal(store.data.session.refreshToken, '');
});

test('cookies: merged from Set-Cookie, deleted when emptied, filtered on send', () => {
  const jar = mergeCookies({}, ['vid=V1; Path=/; HttpOnly', 'vs-access=A1; Secure', 'bad']);
  assert.deepEqual(jar, { vid: 'V1', 'vs-access': 'A1' });
  mergeCookies(jar, ['vs-access=; Max-Age=0']);
  assert.deepEqual(jar, { vid: 'V1' });
  assert.equal(
    cookieHeader({ a: '1', b: '2' }, (name) => name === 'b'),
    'b=2',
  );
});

test('decodeJwt reads the payload and tolerates garbage', () => {
  assert.deepEqual(decodeJwt(fakeJwt({ exp: 42 })), { exp: 42 });
  assert.equal(decodeJwt('not-a-token'), null);
});
