import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATUS_MESSAGES } from '../src/hub.js';
import { LANGUAGES, localize, supportedLanguage, textsOf } from '../src/i18n.js';
import { MODE_LABELS, modeLabel } from '../src/verisure/modes.js';

test('textsOf() builds one text per language', () => {
  assert.deepEqual(
    textsOf((language) => `[${language}]`),
    { en: '[en]', fr: '[fr]', de: '[de]', es: '[es]' },
  );
});

test('localize() falls back on English for a language the integration does not speak', () => {
  const texts = { en: 'Hello', fr: 'Bonjour', de: 'Hallo', es: 'Hola' };
  assert.equal(localize(texts, 'de'), 'Hallo');
  assert.equal(localize(texts, 'es'), 'Hola');
  assert.equal(localize(texts, 'it'), 'Hello');
  assert.equal(localize(texts), 'Hello');
});

test('supportedLanguage() keeps the four languages and falls back on English', () => {
  for (const language of LANGUAGES) {
    assert.equal(supportedLanguage(language), language);
  }
  assert.equal(supportedLanguage('nl'), 'en');
  assert.equal(supportedLanguage(undefined), 'en');
});

test('every status message and mode label is written in every language', () => {
  for (const texts of [...Object.values(STATUS_MESSAGES), ...Object.values(MODE_LABELS)]) {
    assert.deepEqual(Object.keys(texts).sort(), [...LANGUAGES].sort());
  }
  // A transport message holds 200 characters at most.
  for (const text of Object.values(STATUS_MESSAGES).flatMap(Object.values)) {
    assert.ok(text.length <= 200, text);
  }
});

test('modeLabel() speaks German and Spanish', () => {
  assert.equal(modeLabel('armed_away', 'de'), 'Vollscharf');
  assert.equal(modeLabel('disarmed', 'es'), 'Desconectada');
  assert.equal(modeLabel('nope', 'es'), 'Desconocido');
});
