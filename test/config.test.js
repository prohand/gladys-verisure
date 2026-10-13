import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, hasCredentials, normalizeConfig, PLATFORMS } from '../src/config.js';

test('normalizeConfig returns the defaults when called with no argument', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
});

test('normalizeConfig keeps user values and cleans them', () => {
  const config = normalizeConfig({
    platform: 'mypages',
    country: ' es ',
    username: ' jean@example.com ',
    password: 'secret ',
    alarm_code: ' 1234 ',
  });
  assert.equal(config.platform, PLATFORMS.MYPAGES);
  assert.equal(config.country, 'ES');
  assert.equal(config.username, 'jean@example.com');
  assert.equal(config.password, 'secret ', 'a password is never trimmed');
  assert.equal(config.alarm_code, '1234');
});

test('an unknown platform or country falls back to the default', () => {
  const config = normalizeConfig({ platform: 'other', country: 'XX' });
  assert.equal(config.platform, DEFAULT_CONFIG.platform);
  assert.equal(config.country, DEFAULT_CONFIG.country);
});

test('the refresh interval is a number of seconds kept between 60 and 3600', () => {
  assert.equal(normalizeConfig({ poll_interval: '300' }).poll_interval, 300);
  assert.equal(normalizeConfig({ poll_interval: 5 }).poll_interval, 60);
  assert.equal(normalizeConfig({ poll_interval: 99999 }).poll_interval, 3600);
  assert.equal(normalizeConfig({ poll_interval: 'abc' }).poll_interval, 120);
});

test('only an explicit true turns the detailed logs on', () => {
  assert.equal(normalizeConfig({ debug_logs: true }).debug_logs, true);
  assert.equal(normalizeConfig({ debug_logs: 'true' }).debug_logs, false);
});

test('hasCredentials needs both the username and the password', () => {
  assert.equal(hasCredentials(normalizeConfig({ username: 'a', password: 'b' })), true);
  assert.equal(hasCredentials(normalizeConfig({ username: 'a' })), false);
  assert.equal(hasCredentials(normalizeConfig({ password: 'b' })), false);
});
