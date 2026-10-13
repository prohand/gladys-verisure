// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The store indexer validates the manifest, but nothing there knows which
// handlers the code registers: these tests keep both sides in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACTIONS } from '../src/actions.js';
import { DEFAULT_CONFIG, OWA_COUNTRIES, PLATFORMS } from '../src/config.js';
import { SCENE_TRIGGER_KEYS } from '../src/events.js';
import { LANGUAGES } from '../src/i18n.js';
import { STATUS } from '../src/hub.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { MODE_ORDER } from '../src/verisure/modes.js';
import { WIDGETS } from '../src/widgets.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const declaration = (list, key) => manifest[list].find((entry) => entry.key === key);
const optionValues = (field) => field.options.map((option) => option.value);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

// Every text of the manifest: what the store requires of a multi-language one.
function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [index, item] of node.entries()) {
      yield* texts(item, `${path}[${index}]`);
    }
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (['label', 'description', 'placeholder'].includes(key)) {
        yield [`${path}.${key}`, value];
      }
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('every manifest action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), Object.keys(ACTIONS).sort());
});

test('every scene_actions key has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
});

test('every widgets key has a content handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets).sort(), Object.keys(WIDGETS).sort());
  for (const widget of Object.values(WIDGETS)) {
    assert.equal(typeof widget.get, 'function');
  }
});

test('every scene trigger the code fires is declared, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), [...SCENE_TRIGGER_KEYS].sort());
});

test('the mode options of the scenes are exactly the modes of the integration', () => {
  const trigger = declaration('scene_triggers', 'alarm_mode_changed');
  assert.deepEqual(optionValues(trigger.fields.find((f) => f.key === 'mode')), MODE_ORDER);
  const action = declaration('scene_actions', 'set_alarm_mode');
  assert.deepEqual(optionValues(action.fields.find((f) => f.key === 'mode')), MODE_ORDER);
});

test('the connection_lost reasons are the statuses the hub reports', () => {
  const trigger = declaration('scene_triggers', 'connection_lost');
  const reasons = optionValues(trigger.fields.find((f) => f.key === 'reason'));
  const lost = Object.values(STATUS).filter((s) => s !== STATUS.OK && s !== STATUS.NOT_CONFIGURED);
  assert.deepEqual(reasons.sort(), lost.sort());
});

test('the platform and country options are the ones the code knows', () => {
  const field = (key) => manifest.config_schema.find((f) => f.key === key);
  assert.deepEqual(optionValues(field('platform')).sort(), Object.values(PLATFORMS).sort());
  assert.deepEqual(optionValues(field('country')).sort(), [...OWA_COUNTRIES].sort());
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `default of ${field.key}`);
    }
    if (field.type !== 'section') {
      assert.ok(field.key in DEFAULT_CONFIG, `${field.key} must have a default in the code`);
    }
  }
});

test('the credentials are secret fields, never stored in clear in the form', () => {
  const field = (key) => manifest.config_schema.find((f) => f.key === key);
  assert.equal(field('password').type, 'secret');
  assert.equal(field('alarm_code').type, 'secret');
});

test('section fields are purely presentational', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const language of LANGUAGES) {
      assert.ok(section.description[language].length <= 1000, `section ${language}`);
    }
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  for (const field of allFields.filter((f) => f.source !== undefined)) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined, `field "${field.key}"`);
  }
});

test('every text is a multi-language object in English, French, German and Spanish', () => {
  for (const [path, value] of texts(manifest)) {
    assert.equal(typeof value, 'object', `${path} must be { en, fr, de, es }`);
    for (const language of LANGUAGES) {
      assert.ok(value[language], `${path}.${language}`);
    }
  }
});

test('the catalog description is written in every language', () => {
  assert.deepEqual(Object.keys(manifest.description).sort(), [...LANGUAGES].sort());
});

test('widget labels and descriptions fit the store bounds in every language', () => {
  for (const widget of manifest.widgets) {
    for (const language of LANGUAGES) {
      const label = widget.label[language];
      assert.ok(label.length >= 3 && label.length <= 30, `${widget.key} label.${language}`);
      assert.ok(
        widget.description[language].length <= 100,
        `${widget.key} description.${language}`,
      );
    }
  }
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});

test('the integration is a cloud one: the manifest says so', () => {
  assert.deepEqual(manifest.transports, ['cloud']);
});

test('categories and capability fields fit the declared Gladys version', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.ok(isAtLeast(minGladysVersion(), [4, 86, 0]), 'categories need Gladys >= 4.86.0');
  assert.ok(
    isAtLeast(minGladysVersion(), [5, 1, 0]),
    'scene_triggers, scene_actions and widgets need Gladys >= 5.1.0',
  );
});

test('timeouts stay in the range the core accepts', () => {
  for (const item of [...manifest.actions, ...manifest.scene_actions]) {
    if (item.timeout_seconds !== undefined) {
      assert.ok(item.timeout_seconds >= 5 && item.timeout_seconds <= 120, item.key);
    }
  }
  for (const widget of manifest.widgets) {
    assert.ok(widget.action_timeout_seconds >= 5 && widget.action_timeout_seconds <= 120);
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`), manifest.docker_image);
});
