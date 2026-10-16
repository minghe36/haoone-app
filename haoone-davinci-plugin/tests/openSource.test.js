const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');

test('public package has no cloud publishing entry points or dependency', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert(!Object.keys(pkg.scripts).some(name => name.startsWith('release')));
  assert(!pkg.devDependencies.qiniu);
  assert(!fs.existsSync(path.join(root, 'scripts/release.js')));
  const lock = fs.readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8');
  assert(!/qiniu/i.test(lock));
});

test('private environment and generated artifacts are ignored', () => {
  const rules = fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split(/\r?\n/);
  for (const rule of ['.env', '.env.*', 'dist/', 'node_modules/', '*.zip', '/native/**/*.node']) {
    assert(rules.includes(rule), `Missing ignore rule: ${rule}`);
  }
});
