// 本番のデータベース規則（docs/setup/rules.json）の書きまちがいを見つける。
// 規則そのものの動きは Node では確かめられない（規則の確認画面で確かめる）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const at = (p) => join(root, p);

const { rules } = JSON.parse(readFileSync(at('docs/setup/rules.json'), 'utf8'));
const check = JSON.parse(readFileSync(at('docs/setup/rules-check.json'), 'utf8')).rules.check;

// 木をたどり、規則の式（キーが '.' で始まるもの）を [場所, キー, 値] で集める
function rulesIn(node, path = []) {
  const out = [];
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith('.')) out.push([path.join('/'), k, v]);
    else if (v !== null && typeof v === 'object') out.push(...rulesIn(v, [...path, k]));
  }
  return out;
}

test('ルートでは、だれも読めず、だれも書けない', () => {
  assert.equal(rules['.read'], false);
  assert.equal(rules['.write'], false);
});

test('最上位の場所が決まりどおり', () => {
  const keys = Object.keys(rules).filter((k) => !k.startsWith('.')).sort();
  assert.deepEqual(keys, [
    'check', 'teacherList', 'gen', 'accounts', 'students', 'counters', 'initialPw',
    'classes', 'members', 'memberOf', 'units', 'lessons', 'thumbs', 'records', 'marks',
  ].sort());
});

test('check は段階 0 の規則と同じ', () => {
  assert.deepEqual(rules.check, check);
});

test('teacherList のどこにも .write がない（コンソールでだけ書く）', () => {
  assert.deepEqual(rulesIn(rules.teacherList).filter(([, k]) => k === '.write'), []);
});

test('だれでも読めるのは check/ping と gen/$sid だけ', () => {
  const open = rulesIn(rules).filter(([, k, v]) => k === '.read' && v === true).map(([p]) => p).sort();
  assert.deepEqual(open, ['check/ping', 'gen/$sid']);
});

test('auth.uid を使う式は、すべて auth != null を含む', () => {
  for (const [p, k, v] of rulesIn(rules)) {
    if (typeof v === 'string' && v.includes('auth.uid')) {
      assert.ok(v.includes('auth != null'), `${p} の ${k} に auth != null がありません`);
    }
  }
});

test('式はすべて true・false か文字', () => {
  for (const [p, k, v] of rulesIn(rules)) {
    assert.ok(typeof v === 'boolean' || typeof v === 'string', `${p} の ${k} の値が不正です`);
  }
});

test('先生は生徒の記録を書けない（records/$sid の .write に teacherList が出てこない）', () => {
  const sid = rules.records.$classId.$lessonId.$sid;
  assert.equal(typeof sid['.write'], 'string');
  assert.equal(sid['.write'].includes('teacherList'), false);
  for (const [p, k, v] of rulesIn(rules.records)) {
    if (k === '.write') assert.equal(String(v).includes('teacherList'), false, `records/${p} に teacherList があります`);
  }
});

test('records の中身は決まった項目だけ', () => {
  const sid = rules.records.$classId.$lessonId.$sid;
  const fields = Object.keys(sid).filter((k) => !k.startsWith('.')).sort();
  assert.deepEqual(fields, ['$other', 'learned', 'level', 'memo', 'question', 'updatedAt']);
  assert.equal(sid.$other['.validate'], false);
});

test('理解度（records の level と marks）は 1〜4 の整数だけ（小数を受けつけない）', () => {
  const rules = JSON.parse(readFileSync(new URL('../docs/setup/rules.json', import.meta.url), 'utf8')).rules;
  const level = rules.records.$classId.$lessonId.$sid.level['.validate'];
  const mark = rules.marks.$sid.$classId.$lessonId['.validate'];
  for (const expr of [level, mark]) {
    assert.match(expr, /newData\.isNumber\(\)/);
    assert.match(expr, /newData\.val\(\) >= 1/);
    assert.match(expr, /newData\.val\(\) <= 4/);
    assert.match(expr, /newData\.val\(\) % 1 === 0/);
  }
});
