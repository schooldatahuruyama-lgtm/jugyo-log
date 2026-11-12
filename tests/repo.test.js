// リポジトリの土台（開発ルール、道具、設定）がそろっているかを確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const at = (p) => join(root, p);

test('リポジトリの土台がそろっている', () => {
  for (const p of [
    'CLAUDE.md',
    'AGENTS.md',
    'docs/requirements.md',
    'tools/codex-review.ps1',
    'tools/codex-implement.ps1',
    'tools/pages-branch.ps1',
  ]) {
    assert.ok(existsSync(at(p)), `${p} がありません`);
  }
  const pkg = JSON.parse(readFileSync(at('package.json'), 'utf8'));
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.scripts.test, 'node --test "tests/*.test.js"');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  const ignore = readFileSync(at('.gitignore'), 'utf8').split(/\r?\n/);
  assert.ok(ignore.includes('.superpowers/'), '.gitignore に .superpowers/ がありません');
});
