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

// 規則の式を評価するための小さい代役。parent は書きこむ前の同じ木をたどる。
function snapshot(value, parent = null) {
  const node = {
    exists: () => value !== undefined && value !== null,
    val: () => value ?? null,
    isString: () => typeof value === 'string',
    isNumber: () => typeof value === 'number' && Number.isFinite(value),
    hasChildren: (keys) => keys.every((key) => Object.hasOwn(value, key)),
    child: (key) => snapshot(value?.[key], node),
    parent: () => parent,
  };
  return node;
}

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
    'classes', 'members', 'memberOf', 'units', 'lessons', 'thumbs', 'records', 'recThumbs', 'inkThumbs', 'marks', 'terms',
  ].sort());
});

test('check は段階 0 の規則と同じ', () => {
  assert.deepEqual(rules.check, check);
});

test('terms は先生と本人が読み、所属する本人だけが実在する授業に 8 個・20 文字まで書ける', () => {
  assert.ok(rules.terms);
  const sid = rules.terms.$sid;
  const cls = sid.$classId;
  assert.deepEqual(rulesIn(rules.terms).filter(([, k]) => k === '.read'), [
    ['$sid', '.read', rules.marks.$sid['.read']],
  ]);
  assert.deepEqual(rulesIn(rules.terms).filter(([, k]) => k === '.write'), [
    ['$sid/$classId', '.write', rules.marks.$sid.$classId['.write']],
  ]);
  for (const name of ['teacherList', 'accounts']) assert.ok(sid['.read'].includes(name));
  for (const name of ['accounts', 'memberOf']) assert.ok(cls['.write'].includes(name));
  assert.equal(cls['.write'].includes('teacherList'), false);
  assert.equal(cls['.validate'], 'newData.hasChildren()');
  assert.equal(cls.$lessonId['.validate'], "newData.hasChildren() && root.child('lessons').child($classId).child($lessonId).exists()");
  assert.equal(cls.$lessonId.$tid['.validate'], '$tid.matches(/^t[1-8]$/) && newData.isString() && newData.val().length >= 1 && newData.val().length <= 20');
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
  assert.deepEqual(fields, ['$other', 'attachments', 'ink', 'inkCleared', 'learned', 'level', 'memo', 'question', 'updatedAt']);
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

test('手書き目録は 3 つの欄と 4 項目だけ。bytes と strokes の上限を含み、不正値は拒否する', () => {
  const ink = rules.records.$classId.$lessonId.$sid.ink;
  const field = ink.$field;
  assert.equal(ink['.validate'], 'newData.hasChildren()');
  assert.equal(field['.validate'], "($field === 'memo' || $field === 'learned' || $field === 'question') && newData.hasChildren(['fileId', 'bytes', 'strokes', 'updatedAt']) && (!data.exists() || newData.child('updatedAt').val() > data.child('updatedAt').val()) && (!data.parent().parent().child('inkCleared').child($field).exists() || newData.child('updatedAt').val() > data.parent().parent().child('inkCleared').child($field).val())");
  assert.deepEqual(Object.keys(field).filter((k) => !k.startsWith('.')).sort(), ['$other', 'bytes', 'fileId', 'strokes', 'updatedAt']);
  assert.equal(field.fileId['.validate'], 'newData.isString() && newData.val().length >= 1 && newData.val().length <= 200');
  assert.equal(field.bytes['.validate'], 'newData.isNumber() && newData.val() >= 0 && newData.val() <= 400000');
  assert.equal(field.strokes['.validate'], 'newData.isNumber() && newData.val() >= 1 && newData.val() <= 2000 && newData.val() % 1 === 0');
  assert.equal(field.updatedAt['.validate'], 'newData.isNumber()');
  assert.equal(field.$other['.validate'], false);
  assert.deepEqual(rulesIn(ink).filter(([, k]) => k === '.read' || k === '.write'), []);
  // 形の式を小さい代役で評価する。権限の実動作は公開後の規則の確認で試す。
  const accepts = (rule, value, name = 'memo') => new Function('newData', '$field', 'data', `return (${rule});`)(
    snapshot(value), name, snapshot({}).child('ink').child(name));
  const index = { fileId: 'file', bytes: 400000, strokes: 2000, updatedAt: 1 };
  for (const name of ['memo', 'learned', 'question']) assert.equal(accepts(field['.validate'], index, name), true);
  assert.equal(accepts(field['.validate'], index, 'other'), false);
  const { strokes, ...missing } = index;
  assert.equal(accepts(field['.validate'], missing), false);
  for (const value of [0, 400000]) assert.equal(accepts(field.bytes['.validate'], value), true);
  for (const value of [-1, 400001, '1', null]) assert.equal(accepts(field.bytes['.validate'], value), false);
  for (const value of [1, 2000]) assert.equal(accepts(field.strokes['.validate'], value), true);
  for (const value of [0, 1.5, 2001, '1', null]) assert.equal(accepts(field.strokes['.validate'], value), false);
  for (const value of ['', 'x'.repeat(201), 1]) assert.equal(accepts(field.fileId['.validate'], value), false);
});

test('手書きの削除時刻は 3 欄の数だけ。権限は records から引き継ぐ', () => {
  const cleared = rules.records.$classId.$lessonId.$sid.inkCleared;
  assert.equal(cleared['.validate'], 'newData.hasChildren()');
  assert.deepEqual(Object.keys(cleared).sort(), ['.validate', '$field'].sort());
  assert.equal(cleared.$field['.validate'], "($field === 'memo' || $field === 'learned' || $field === 'question') && newData.isNumber() && (!data.exists() || newData.val() > data.val()) && (!data.parent().parent().child('ink').child($field).exists() || newData.val() > data.parent().parent().child('ink').child($field).child('updatedAt').val())");
  assert.deepEqual(rulesIn(cleared).filter(([, k]) => k === '.read' || k === '.write'), []);
  const accepts = (field, value) => new Function('$field', 'newData', 'data', `return (${cleared.$field['.validate']});`)(
    field, snapshot(value), snapshot({}).child('inkCleared').child(field));
  for (const field of ['memo', 'learned', 'question']) {
    for (const value of [0, 20]) assert.equal(accepts(field, value), true);
    for (const value of ['20', false, {}, [], null, NaN, Infinity]) assert.equal(accepts(field, value), false);
  }
  assert.equal(accepts('other', 20), false);
});

test('手書きと全消去は、書きこむ前の目録・削除時刻の両方より新しい時刻だけを受けつける', () => {
  const sid = rules.records.$classId.$lessonId.$sid;
  const index = { fileId: 'file', bytes: 42, strokes: 1 };
  for (const field of ['memo', 'learned', 'question']) {
    for (const [inkTime, clearedTime] of [[undefined, undefined], [20, undefined], [undefined, 20], [20, 30], [30, 20]]) {
      const record = snapshot({
        ink: inkTime === undefined ? {} : { [field]: { ...index, updatedAt: inkTime } },
        inkCleared: clearedTime === undefined ? {} : { [field]: clearedTime },
      });
      for (const time of [-1, 0, 19, 20, 21, 29, 30, 31]) {
        const expected = (inkTime === undefined || time > inkTime) && (clearedTime === undefined || time > clearedTime);
        for (const kind of ['ink', 'inkCleared']) {
          const accepts = new Function('$field', 'newData', 'data', `return (${sid[kind].$field['.validate']});`);
          const next = snapshot(kind === 'ink' ? { ...index, updatedAt: time } : time);
          assert.equal(accepts(field, next, record.child(kind).child(field)), expected,
            `${kind}/${field}: 目録 ${inkTime}, 削除 ${clearedTime}, 書きこみ ${time}`);
        }
      }
    }
  }
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
  assert.equal(sid.$aid['.validate'], "$aid.matches(/^a[1-6]$/) && newData.isString() && newData.val().length <= 20000");
  assert.deepEqual(rulesIn(rules.recThumbs).filter(([, k]) => k === '.write'), [['$classId/$lessonId/$sid', '.write', records['.write']]]);
});

test('inkThumbs は欄ごとに先生が読み、本人だけが所属と授業を確かめて書く。画像は 20000 文字まで', () => {
  const records = rules.records.$classId.$lessonId.$sid;
  const field = rules.inkThumbs.$classId.$lessonId.$field;
  assert.deepEqual(rulesIn(rules.inkThumbs).filter(([, k]) => k === '.read'), [
    ['$classId/$lessonId/$field', '.read', "auth != null && root.child('teacherList').child(auth.uid).val() === true"],
    ['$classId/$lessonId/$field/$sid', '.read', records['.read']],
  ]);
  assert.deepEqual(rulesIn(rules.inkThumbs).filter(([, k]) => k === '.write'), [
    ['$classId/$lessonId/$field/$sid', '.write', records['.write']],
  ]);
  assert.equal(field['.validate'], "$field === 'learned' || $field === 'question'");
  assert.equal(field.$sid['.validate'], 'newData.isString() && newData.val().length <= 20000');
  const acceptsField = new Function('$field', `return (${field['.validate']});`);
  for (const name of ['learned', 'question']) assert.equal(acceptsField(name), true);
  for (const name of ['memo', 'other', '', null]) assert.equal(acceptsField(name), false);
  const accepts = (value) => new Function('newData', `return (${field.$sid['.validate']});`)({
    isString: () => typeof value === 'string', val: () => value,
  });
  assert.equal(accepts('x'.repeat(20000)), true);
  for (const value of ['x'.repeat(20001), 1, false, {}, [], null]) assert.equal(accepts(value), false);
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
