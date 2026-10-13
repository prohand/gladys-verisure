// -----------------------------------------------------------------------------
// The changelog step of the Release workflow (.github/scripts/
// changelog-release.mjs): the release commit is pushed straight to main, so
// what it writes must stay Prettier-clean.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';
import { rollChangelog } from '../.github/scripts/changelog-release.mjs';

const changelogPath = fileURLToPath(new URL('../CHANGELOG.md', import.meta.url));

test('the real changelog rolls under the version and stays Prettier-clean', async () => {
  const text = await readFile(changelogPath, 'utf8');
  const rolled = rollChangelog(text, '9.8.7', '2026-01-02');
  assert.notEqual(rolled, text, 'CHANGELOG.md needs a "## [Unreleased]" section');
  assert.match(rolled, /^## \[Unreleased\]\n\n## \[9\.8\.7\] - 2026-01-02\n/m);
  const options = { ...(await prettier.resolveConfig(changelogPath)), filepath: changelogPath };
  assert.equal(await prettier.format(rolled, options), rolled);
});

test('a first release links to its tag, the next ones compare', () => {
  const first = rollChangelog(
    '# Changelog\n\n## [Unreleased]\n\n- Thing.\n\n[Unreleased]: https://github.com/o/r/commits/main\n',
    '1.0.0',
    '2026-01-02',
  );
  assert.match(first, /\[Unreleased\]: https:\/\/github\.com\/o\/r\/compare\/v1\.0\.0\.\.\.HEAD/);
  assert.match(first, /\[1\.0\.0\]: https:\/\/github\.com\/o\/r\/releases\/tag\/v1\.0\.0/);
  const second = rollChangelog(
    first.replace('## [Unreleased]\n', '## [Unreleased]\n\n- Fix.\n'),
    '1.0.1',
    '2026-02-03',
  );
  assert.match(second, /\[1\.0\.1\]: https:\/\/github\.com\/o\/r\/compare\/v1\.0\.0\.\.\.v1\.0\.1/);
});

test('an empty Unreleased section still names the version', () => {
  const rolled = rollChangelog('# Changelog\n\n## [Unreleased]\n', '1.0.1', '2026-01-02');
  assert.match(rolled, /## \[1\.0\.1\] - 2026-01-02\n\n- Maintenance release/);
});

test('the same version is never released twice', () => {
  const text = '# Changelog\n\n## [Unreleased]\n\n## [1.0.1] - 2026-01-02\n\n- Thing.\n';
  assert.equal(rollChangelog(text, '1.0.1', '2026-01-03'), text);
});
