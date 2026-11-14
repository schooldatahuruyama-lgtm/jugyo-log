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
    'classes', 'members', 'memberOf', 'units', 'lessons', 'thumbs', 'records', 'recThumbs', 'marks',
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

test('lessons の全体は先生だけが読め、組ごとの読み取りの規則はそのまま', () => {
  const teacher = "auth != null && root.child('teacherList').child(auth.uid).val() === true";
  assert.equal(rules.lessons['.read'], teacher);
  assert.equal(rules.lessons.$classId['.read'], "auth != null && (root.child('teacherList').child(auth.uid).val() === true || root.child('memberOf').child(root.child('accounts').child(auth.uid).val()).child($classId).val() === true)");
  assert.equal(rules.lessons['.write'], undefined);
  assert.equal(rules.thumbs['.read'], undefined);
});

test('lessons は組全体への書きこみを許さず、記録がある授業はまるごと消せない', () => {
  assert.equal(rules.lessons.$classId['.write'], undefined);
  const write = rules.lessons.$classId.$lessonId['.write'];
  assert.equal(typeof write, 'string');
  assert.ok(write.includes('teacherList'));
  assert.ok(write.includes('newData.exists()'));
  assert.ok(write.includes("root.child('records').child($classId).child($lessonId).exists()"));
  assert.equal(write, "auth != null && root.child('teacherList').child(auth.uid).val() === true && (newData.exists() || !root.child('records').child($classId).child($lessonId).exists())");
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
  assert.deepEqual(fields, ['$other', 'attachments', 'learned', 'level', 'memo', 'question', 'updatedAt']);
  assert.equal(sid.$other['.validate'], false);
});

test('添付は a1〜a6 の置き場所に、決まった 4 項目だけを保存する', () => {
  const attachments = rules.records.$classId.$lessonId.$sid.attachments;
  assert.equal(attachments['.validate'], 'newData.hasChildren()');
  const aid = attachments.$aid;
  assert.equal(aid['.validate'], "$aid.matches(/^a[1-6]$/) && newData.hasChildren(['type', 'fileId', 'bytes', 'addedAt']) && (!data.exists() || newData.child('fileId').val() === data.child('fileId').val())");
  assert.deepEqual(Object.keys(aid).filter((k) => !k.startsWith('.')).sort(), ['$other', 'addedAt', 'bytes', 'fileId', 'type']);
  assert.equal(aid.type['.validate'], "newData.isString() && (newData.val() === 'image' || newData.val() === 'pdf')");
  assert.equal(aid.fileId['.validate'], 'newData.isString() && newData.val().length >= 1 && newData.val().length <= 200');
  assert.equal(aid.bytes['.validate'], 'newData.isNumber() && newData.val() >= 0');
  assert.equal(aid.addedAt['.validate'], 'newData.isNumber()');
  assert.equal(aid.$other['.validate'], false);
});

test('recThumbs は先生と本人だけが読み、所属と授業を確かめて本人だけが書く', () => {
  const records = rules.records.$classId.$lessonId.$sid;
  assert.equal(rules.recThumbs['.read'], undefined);
  assert.equal(rules.recThumbs.$classId['.read'], "auth != null && root.child('teacherList').child(auth.uid).val() === true");
  const sid = rules.recThumbs.$classId.$lessonId.$sid;
  assert.equal(sid['.read'], records['.read']);
  assert.equal(sid['.write'], records['.write']);
  assert.equal(sid['.validate'], 'newData.hasChildren()');
  for (const name of ['accounts', 'memberOf', 'lessons']) assert.ok(sid['.write'].includes(name));
  assert.equal(sid.$aid['.validate'], '$aid.matches(/^a[1-6]$/) && newData.isString() && newData.val().length <= 20000');
  assert.deepEqual(rulesIn(rules.recThumbs).filter(([, k]) => k === '.write'), [['$classId/$lessonId/$sid', '.write', records['.write']]]);
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
