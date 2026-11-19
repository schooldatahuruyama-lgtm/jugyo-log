// 本番のデータベース規則（docs/setup/rules.json）の書きまちがいを見つける。
// 規則そのものの動きは Node では確かめられない（規則の確認画面で確かめる）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRepo } from '../js/repo.js';
import { createMemoryNet } from '../js/dev/memory-net.js';

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
    hasChildren: (keys) => value !== null && typeof value === 'object' && keys.every((key) => Object.hasOwn(value, key)),
    hasChild: (key) => value?.[key] !== undefined && value?.[key] !== null,
    child: (key) => snapshot(value?.[key], node),
    parent: () => parent,
  };
  return node;
}

function evaluateInkRule(rule, field, newData, data, root = snapshot({})) {
  const expression = rule.replaceAll('$field.matches(/^a[1-6]$/)', '/^a[1-6]$/.test($field)');
  return new Function('$field', 'newData', 'data', 'root', '$classId', '$lessonId', `return (${expression});`)(
    field, newData, data, root, 'c1', 'l1');
}

function evaluatePageRule(rule, place, page, newData, data, root = snapshot({})) {
  const expression = rule.replaceAll('$place.matches(/^a[1-6]$/)', '/^a[1-6]$/.test($place)')
    .replaceAll('$page.matches(/^p([1-9]|[1-9][0-9]|[1-9][0-9][0-9])$/)', '/^p([1-9]|[1-9][0-9]|[1-9][0-9][0-9])$/.test($page)');
  return new Function('$place', '$page', 'newData', 'data', 'root', '$classId', '$lessonId', `return (${expression});`)(
    place, page, newData, data, root, 'c1', 'l1');
}

test('PDF の規則: PDF・on・正しいページ名が必要。写真の規則と子の値・権限は同じ', () => {
  const sid = rules.records.$classId.$lessonId.$sid;
  const rule = sid.inkPages.$place.$page;
  for (const kind of ['inkPages', 'inkPagesCleared']) {
    assert.equal(sid[kind]['.validate'], 'newData.hasChildren()');
    assert.equal(sid[kind].$place['.validate'], 'newData.hasChildren()');
    assert.deepEqual(rulesIn(sid[kind]).filter(([, k]) => ['.read', '.write'].includes(k)), []);
  }
  assert.deepEqual(Object.keys(rule).sort(), ['.validate', '$other', 'on', 'fileId', 'bytes', 'strokes', 'updatedAt'].sort());
  for (const key of ['on', 'fileId', 'bytes', 'strokes', 'updatedAt', '$other']) assert.deepEqual(rule[key], sid.ink.$field[key]);
  const index = { fileId: 'page-ink', bytes: 42, strokes: 1, updatedAt: 20 };
  for (const place of ['a1', 'a6', 'Abc123Def456', 'a7', 'memo']) {
    for (const page of ['p1', 'p999', 'p0', 'p-1', 'p1.5', 'p1000', 'p01', '1', 'px']) {
      for (const pdf of [null, { type: 'pdf', fileId: 'pdf' }, { type: 'image', fileId: 'pdf' }, { type: 'pdf', fileId: 'other' }]) {
        for (const on of ['pdf', undefined, '', 1]) {
          const root = snapshot({ lessons: { c1: { l1: { materials: { Abc123Def456: pdf } } } } });
          const record = { attachments: { a1: pdf, a6: pdf }, inkPages: { [place]: { [page]: { ...index, ...(on === undefined ? {} : { on }) } } } };
          const next = snapshot(record).child('inkPages').child(place).child(page);
          const before = snapshot({}).child('inkPages').child(place).child(page);
          assert.equal(evaluatePageRule(rule['.validate'], place, page, next, before, root),
            ['a1', 'a6', 'Abc123Def456'].includes(place) && ['p1', 'p999'].includes(page) && pdf?.type === 'pdf' && pdf.fileId === on);
        }
      }
    }
  }
  const before = snapshot({ attachments: { a1: { type: 'pdf', fileId: 'pdf' } } }).child('inkPages').child('a1').child('p1');
  const next = snapshot({ inkPages: { a1: { p1: { ...index, on: 'pdf' } } } }).child('inkPages').child('a1').child('p1');
  assert.equal(evaluatePageRule(rule['.validate'], 'a1', 'p1', next, before), false);
});

test('PDF の規則: 同じページの目録・削除時刻の両方より新しい値だけが通る', () => {
  const sid = rules.records.$classId.$lessonId.$sid;
  const pdf = { type: 'pdf', fileId: 'pdf' };
  const root = snapshot({ lessons: { c1: { l1: { materials: { Abc123Def456: pdf } } } } });
  for (const place of ['a1', 'Abc123Def456']) {
    for (const [inkTime, clearedTime] of [[undefined, undefined], [20, undefined], [undefined, 20], [20, 30], [30, 20]]) {
      const record = { attachments: { a1: pdf }, inkPages: { [place]: { p2: { updatedAt: 1000 },
        ...(inkTime === undefined ? {} : { p1: { updatedAt: inkTime } }) } },
      inkPagesCleared: { [place]: { p2: 1000, ...(clearedTime === undefined ? {} : { p1: clearedTime }) } } };
      for (const time of [19, 20, 29, 30, 31]) {
        for (const kind of ['inkPages', 'inkPagesCleared']) {
          const value = kind === 'inkPages' ? { fileId: 'ink', bytes: 42, strokes: 1, updatedAt: time, on: 'pdf' } : time;
          const next = snapshot({ ...record, [kind]: { [place]: { p1: value } } }).child(kind).child(place).child('p1');
          assert.equal(evaluatePageRule(sid[kind].$place.$page['.validate'], place, 'p1', next,
            snapshot(record).child(kind).child(place).child('p1'), root),
          (inkTime === undefined || time > inkTime) && (clearedTime === undefined || time > clearedTime));
        }
      }
    }
  }
  for (const place of ['a1', 'a6', 'Abc123Def456', 'a7', 'memo', 'Missing00001']) {
    for (const page of ['p1', 'p999', 'p0', 'p01', 'p1000', '1']) {
      for (const time of [30, '30', Infinity, null]) {
        assert.equal(evaluatePageRule(sid.inkPagesCleared.$place.$page['.validate'], place, page, snapshot(time),
          snapshot({}).child('inkPagesCleared').child(place).child(page), root),
        ['a1', 'a6', 'Abc123Def456'].includes(place) && ['p1', 'p999'].includes(page) && time === 30);
      }
    }
  }
});

test('写真の手書き規則: 写真・on・所属する授業の資料を確かめ、同時削除後の写真では保存できない', () => {
  const sid = rules.records.$classId.$lessonId.$sid;
  const index = { fileId: 'ink-file', bytes: 42, strokes: 1, updatedAt: 20 };
  const fieldRule = sid.ink.$field;
  assert.equal(fieldRule.on['.validate'], 'newData.isString() && newData.val().length >= 1 && newData.val().length <= 200');
  for (const on of ['', 'x'.repeat(201), 1, null]) {
    assert.equal(evaluateInkRule(fieldRule.on['.validate'], 'a1', snapshot(on), snapshot(null)), false);
  }
  for (const on of ['x', 'x'.repeat(200)]) {
    assert.equal(evaluateInkRule(fieldRule.on['.validate'], 'a1', snapshot(on), snapshot(null)), true);
  }
  for (const field of ['a1', 'Abc123Def456']) {
    for (const photo of [null, { type: 'image', fileId: 'photo' }, { type: 'pdf', fileId: 'photo' }, { type: 'image', fileId: 'other' }]) {
      for (const on of ['photo', undefined, '']) {
        const root = snapshot({ lessons: { c1: { l1: { materials: { Abc123Def456: photo } } } } });
        const record = { attachments: { a1: photo }, ink: { [field]: { ...index, ...(on !== undefined ? { on } : {}) } } };
        const next = snapshot(record).child('ink').child(field);
        const before = snapshot({}).child('ink').child(field);
        assert.equal(evaluateInkRule(fieldRule['.validate'], field, next, before, root),
          photo?.type === 'image' && photo.fileId === on);
      }
    }
  }
  for (const field of ['memo', 'learned', 'question', 'other', 'a2', 'Missing00001']) {
    const next = snapshot({ ink: { [field]: { ...index, on: 'photo' } } }).child('ink').child(field);
    assert.equal(evaluateInkRule(fieldRule['.validate'], field, next, snapshot({}).child('ink').child(field)), false);
  }
  const before = snapshot({ attachments: { a1: { type: 'image', fileId: 'photo' } } }).child('ink').child('a1');
  const next = snapshot({ ink: { a1: { ...index, on: 'photo' } } }).child('ink').child('a1');
  assert.equal(evaluateInkRule(fieldRule['.validate'], 'a1', next, before), false);
});

test('写真の手書き規則: 目録・削除時刻の両方より新しい値だけ通り、資料の削除時刻は実在する資料だけ', () => {
  const sid = rules.records.$classId.$lessonId.$sid;
  const root = snapshot({ lessons: { c1: { l1: { materials: { Abc123Def456: { type: 'image', fileId: 'photo' } } } } } });
  for (const field of ['a1', 'Abc123Def456']) {
    for (const [inkTime, clearedTime] of [[20, 30], [30, 20], [undefined, undefined]]) {
      const record = { ink: inkTime === undefined ? {} : { [field]: { updatedAt: inkTime } },
        inkCleared: clearedTime === undefined ? {} : { [field]: clearedTime },
        attachments: { a1: { type: 'image', fileId: 'photo' } } };
      for (const time of [19, 20, 29, 30, 31]) {
        for (const kind of ['ink', 'inkCleared']) {
          const value = kind === 'ink' ? { fileId: 'ink', bytes: 42, strokes: 1, updatedAt: time, on: 'photo' } : time;
          const next = snapshot({ ...record, [kind]: { [field]: value } }).child(kind).child(field);
          assert.equal(evaluateInkRule(sid[kind].$field['.validate'], field, next, snapshot(record).child(kind).child(field), root),
            (inkTime === undefined || time > inkTime) && (clearedTime === undefined || time > clearedTime));
        }
      }
    }
  }
  for (const field of ['a1', 'a6', 'Abc123Def456', 'a7', 'Missing00001']) {
    assert.equal(evaluateInkRule(sid.inkCleared.$field['.validate'], field, snapshot(40),
      snapshot({}).child('inkCleared').child(field), root), ['a1', 'a6', 'Abc123Def456'].includes(field));
  }
});

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
    'check', 'teacherList', 'gen', 'accounts', 'students', 'counters', 'initialPw', 'aiSummaries',
    'classes', 'members', 'memberOf', 'units', 'lessons', 'thumbs', 'records', 'recThumbs', 'inkThumbs', 'marks', 'terms', 'replies', 'replyMarks', 'rika',
  ].sort());
});

test('check は段階 0 の規則と同じ', () => {
  assert.deepEqual(rules.check, check);
});

// Firebase そのものではなく、式と値の組み合わせをローカルの代役で確かめる。
function evaluateRikaRule(rule, { auth = null, uid = 'student', value = null, before = null, chunk = 'probe_01' } = {}) {
  const root = snapshot({ teacherList: { teacher: true }, accounts: { student: 's00-001', other: 's00-002', invalid: 1 } });
  const expression = String(rule).replace('$chunk.matches(/^[A-Za-z0-9_-]{8,40}$/)', '/^[A-Za-z0-9_-]{8,40}$/.test($chunk)');
  return new Function('auth', 'root', '$uid', 'newData', 'data', '$chunk', `return (${expression});`)(
    auth, root, uid, snapshot(value), snapshot(before), chunk);
}

test('理科クエストは本人と先生だけが読め、全体を読めるのは先生だけ', () => {
  assert.deepEqual(Object.keys(rules.rika).sort(), ['log', 'state']);
  for (const kind of ['state', 'log']) {
    const rule = rules.rika[kind];
    assert.equal(rule['.write'], undefined);
    assert.deepEqual(rulesIn(rule).filter(([, k]) => k === '.read').map(([p]) => p), ['', '$uid']);
    for (const uid of [null, 'teacher', 'student', 'other', 'unknown']) {
      const auth = uid === null ? null : { uid };
      const whole = evaluateRikaRule(rule['.read'], { auth });
      const own = evaluateRikaRule(rule.$uid['.read'], { auth });
      assert.equal(whole, uid === 'teacher');
      assert.equal(whole || own, uid === 'teacher' || uid === 'student');
    }
  }
});

test('理科クエストの state は登録済みの本人が書け、先生はほかの人の削除だけできる', () => {
  const rule = rules.rika.state.$uid;
  assert.deepEqual(rulesIn(rules.rika.state).filter(([, k]) => k === '.write').map(([p]) => p), ['$uid']);
  for (const uid of [null, 'student', 'teacher', 'other', 'unknown', 'invalid']) {
    const auth = uid === null ? null : { uid };
    for (const value of [null, { v: 1, updatedAt: 1, json: '{}' }]) {
      assert.equal(evaluateRikaRule(rule['.write'], { auth, value }),
        uid === 'student' || uid === 'teacher' && value === null);
      if (auth) assert.equal(evaluateRikaRule(rule['.write'], { auth, uid, value }), ['student', 'teacher', 'other'].includes(uid));
    }
  }
});

test('理科クエストの state は必須項目・型・文字数を検証し、知らない項目は拒む', () => {
  const rule = rules.rika.state.$uid;
  assert.deepEqual(Object.keys(rule).filter((key) => !key.startsWith('.')).sort(), ['$other', 'json', 'updatedAt', 'v']);
  const valid = { v: 1, updatedAt: 1, json: '{}' };
  const accepts = (value) => evaluateRikaRule(rule['.validate'], { value })
    && Object.entries(value).every(([key, v]) => evaluateRikaRule((rule[key] || rule.$other)['.validate'], { value: v }));
  for (const json of ['{}', 'あ'.repeat(500000)]) assert.equal(accepts({ ...valid, json }), true);
  for (const key of ['v', 'updatedAt', 'json']) {
    const value = { ...valid };
    delete value[key];
    assert.equal(accepts(value), false);
  }
  for (const value of [{ ...valid, v: 2 }, { ...valid, v: '1' }, { ...valid, updatedAt: '1' },
    { ...valid, json: 1 }, { ...valid, json: '' }, { ...valid, json: 'a' }, { ...valid, json: 'あ'.repeat(500001) },
    { ...valid, extra: true }]) assert.equal(accepts(value), false);
});

test('理科クエストの log は新規のかたまりだけ書け、同じ内容の上書きと生徒の削除を拒む', () => {
  const rule = rules.rika.log.$uid;
  assert.deepEqual(rulesIn(rules.rika.log).filter(([, k]) => k === '.write').map(([p]) => p), ['$uid', '$uid/$chunk']);
  for (const uid of [null, 'teacher', 'student', 'other', 'unknown', 'invalid']) {
    const auth = uid === null ? null : { uid };
    for (const value of [null, { probe_01: '[]' }]) {
      assert.equal(evaluateRikaRule(rule['.write'], { auth, value }), uid === 'teacher' && value === null);
    }
    for (const before of [null, '[]']) {
      assert.equal(evaluateRikaRule(rule.$chunk['.write'], { auth, value: '[]', before }), uid === 'student' && before === null);
      if (auth) assert.equal(evaluateRikaRule(rule.$chunk['.write'], { auth, uid, value: '[]', before }),
        ['teacher', 'student', 'other'].includes(uid) && before === null);
    }
    assert.equal(evaluateRikaRule(rule.$chunk['.write'], { auth, value: null, before: '[]' }), false);
  }
});

test('理科クエストの log は 8〜40 文字の id と 2〜200000 文字の文字列だけ通す', () => {
  const rule = rules.rika.log.$uid.$chunk;
  for (const chunk of ['aB0_-123', 'a'.repeat(40)]) {
    for (const value of ['[]', 'あ'.repeat(200000)]) assert.equal(evaluateRikaRule(rule['.validate'], { chunk, value }), true);
  }
  for (const chunk of ['a.b', '1234567', 'a'.repeat(41), '1234567.', '1234567/', '1234567あ']) {
    assert.equal(evaluateRikaRule(rule['.validate'], { chunk, value: '[]' }), false);
  }
  for (const value of [1, {}, [], '', 'a', 'あ'.repeat(200001)]) {
    assert.equal(evaluateRikaRule(rule['.validate'], { value }), false);
  }
});

test('AI のまとめは先生だけが読み書きでき、版・時刻・600 文字以内の概要が必要', () => {
  assert.equal(rules['.read'], false);
  assert.equal(rules['.write'], false);
  const cls = rules.aiSummaries.$classId;
  const teacher = rules.replies.$classId['.read'];
  assert.deepEqual(rulesIn(rules.aiSummaries).filter(([, k]) => ['.read', '.write'].includes(k)), [
    ['$classId', '.read', teacher], ['$classId', '.write', teacher],
  ]);
  const root = snapshot({ teacherList: { teacher: true }, accounts: { student: 's00-001' }, memberOf: { 's00-001': { c1: true } } });
  for (const permission of ['.read', '.write']) {
    const allows = new Function('auth', 'root', `return (${cls[permission]});`);
    assert.equal(allows({ uid: 'teacher' }, root), true);
    assert.equal(allows({ uid: 'student' }, root), false);
    assert.equal(allows(null, root), false);
  }
  const accepts = new Function('newData', `return (${cls.$lessonId['.validate']});`);
  const valid = { v: 1, createdAt: 1, overview: 'あ'.repeat(600) };
  assert.equal(accepts(snapshot(valid)), true);
  for (const value of [{ v: 1, createdAt: 1 }, { ...valid, v: 2 }, { ...valid, createdAt: '1' },
    { ...valid, overview: 3 }, { ...valid, overview: 'あ'.repeat(601) }]) assert.equal(accepts(snapshot(value)), false);
});

test('返事の規則: 先生だけが書き、先生はクラス全体、本人は自分の返事と目印だけ読める', () => {
  const cls = rules.replies.$classId;
  const sid = cls.$lessonId.$sid;
  const mark = rules.replyMarks.$sid;
  const teacher = rules.records.$classId['.read'];
  assert.deepEqual(rulesIn(rules.replies).filter(([, k]) => k === '.write'), [['$classId', '.write', teacher]]);
  assert.deepEqual(rulesIn(rules.replies).filter(([, k]) => k === '.read'), [
    ['$classId', '.read', teacher], ['$classId/$lessonId/$sid', '.read', rules.records.$classId.$lessonId.$sid['.read']],
  ]);
  assert.deepEqual(rulesIn(rules.replyMarks).filter(([, k]) => k === '.write'), [['$sid', '.write', teacher]]);
  assert.deepEqual(rulesIn(rules.replyMarks).filter(([, k]) => k === '.read'), [['$sid', '.read', rules.marks.$sid['.read']]]);
  const root = snapshot({ teacherList: { teacher: true }, accounts: { own: 's00-001', other: 's00-002' } });
  const evaluate = (rule, auth) => new Function('root', 'auth', '$sid', `return (${rule});`)(root, auth, 's00-001');
  for (const uid of [null, 'teacher', 'own', 'other', 'unknown']) {
    const auth = uid === null ? null : { uid };
    assert.equal(evaluate(cls['.write'], auth), uid === 'teacher');
    assert.equal(evaluate(mark['.write'], auth), uid === 'teacher');
    assert.equal(evaluate(cls['.read'], auth), uid === 'teacher');
    assert.equal(evaluate(sid['.read'], auth), uid === 'own');
    assert.equal(evaluate(mark['.read'], auth), uid === 'teacher' || uid === 'own');
  }
});

test('返事の規則: 文は 1〜400 文字、印は true、時刻は数。文か印が必要で余分な項目は拒否', () => {
  const reply = rules.replies.$classId.$lessonId.$sid;
  const evaluate = (rule, value) => new Function('newData', `return (${rule});`)(snapshot(value));
  assert.deepEqual(Object.keys(reply).sort(), ['.read', '.validate', 'text', 'seen', 'updatedAt', '$other'].sort());
  assert.equal(reply.$other['.validate'], false);
  for (const value of [{ text: '文', updatedAt: 0 }, { seen: true, updatedAt: 10 }, { text: '文', seen: true, updatedAt: 20 }]) {
    assert.equal(evaluate(reply['.validate'], value), true);
    for (const [key, child] of Object.entries(value)) assert.equal(evaluate(reply[key]['.validate'], child), true);
  }
  for (const value of [null, 1, '文', {}, { updatedAt: 10 }, { text: '文' }, { seen: true }]) {
    assert.equal(evaluate(reply['.validate'], value), false);
  }
  for (const text of ['あ', 'あ'.repeat(400), '😀'.repeat(200)]) assert.equal(evaluate(reply.text['.validate'], text), true);
  for (const text of ['', 'あ'.repeat(401), null, 1, true, [], {}]) assert.equal(evaluate(reply.text['.validate'], text), false);
  for (const seen of [false, 'true', 1, null, [], {}]) assert.equal(evaluate(reply.seen['.validate'], seen), false);
  const mark = rules.replyMarks.$sid.$classId.$lessonId;
  assert.equal(mark['.validate'], 'newData.isNumber()');
  for (const value of [0, 10, -1, 0.5]) {
    assert.equal(evaluate(reply.updatedAt['.validate'], value), true);
    assert.equal(evaluate(mark['.validate'], value), true);
  }
  for (const value of ['10', null, true, NaN, Infinity, [], {}]) {
    assert.equal(evaluate(reply.updatedAt['.validate'], value), false);
    assert.equal(evaluate(mark['.validate'], value), false);
  }
});

test('スタンプの更新と取り消しは規則が許す形になり、時刻だけの書きこみは拒否される', async () => {
  const reply = rules.replies.$classId.$lessonId.$sid;
  const evaluate = (rule, value) => new Function('newData', `return (${rule});`)(snapshot(value));
  const mem = createMemoryNet({ onChange: (root) => {
    for (const value of Object.values(root?.replies?.c1?.l1 ?? {})) {
      assert.equal(evaluate(reply['.validate'], value), true, '返事の規則の式が拒否');
      for (const [key, child] of Object.entries(value)) assert.equal(evaluate(reply[key]['.validate'], child), true);
    }
  } });
  const repo = createRepo(mem);
  await repo.stampReplies('c1', 'l1', ['s26-001'], 10);
  assert.deepEqual(await mem.get('replies/c1/l1/s26-001'), { seen: true, updatedAt: 10 });
  await repo.stampReplies('c1', 'l1', ['s26-001'], 20);
  assert.deepEqual(await mem.get('replies/c1/l1/s26-001'), { seen: true, updatedAt: 20 });
  await repo.unstampReply('c1', 'l1', 's26-001', 25);
  assert.equal(await mem.get('replies/c1/l1/s26-001'), null);
  assert.deepEqual(await repo.getReplyMarks('s26-001', 'c1'), {});
  await repo.setReply('c1', 'l1', 's26-001', { text: '残す文', seen: true }, 30);
  await repo.unstampReply('c1', 'l1', 's26-001', 40);
  assert.deepEqual(await mem.get('replies/c1/l1/s26-001'), { text: '残す文', updatedAt: 40 });
  // 返事が無く、目印だけ残っている場合も取り消せる。
  await mem.remove('replies/c1/l1/s26-001');
  assert.deepEqual(await repo.getReplyMarks('s26-001', 'c1'), { l1: 40 });
  await repo.unstampReply('c1', 'l1', 's26-001', 50);
  assert.equal(await mem.get('replies/c1/l1/s26-001'), null);
  assert.deepEqual(await repo.getReplyMarks('s26-001', 'c1'), {});
  assert.equal(evaluate(reply['.validate'], { updatedAt: 60 }), false);
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
  assert.deepEqual(fields, ['$other', 'attachments', 'ink', 'inkCleared', 'inkPages', 'inkPagesCleared', 'learned', 'level', 'memo', 'question', 'updatedAt']);
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

test('手書き目録は必須 4 項目と写真用の on。bytes と strokes の上限を含み、不正値は拒否する', () => {
  const ink = rules.records.$classId.$lessonId.$sid.ink;
  const field = ink.$field;
  assert.equal(ink['.validate'], 'newData.hasChildren()');
  assert.ok(field['.validate'].endsWith(" && newData.hasChildren(['fileId', 'bytes', 'strokes', 'updatedAt']) && (!data.exists() || newData.child('updatedAt').val() > data.child('updatedAt').val()) && (!data.parent().parent().child('inkCleared').child($field).exists() || newData.child('updatedAt').val() > data.parent().parent().child('inkCleared').child($field).val())"));
  assert.deepEqual(Object.keys(field).filter((k) => !k.startsWith('.')).sort(), ['$other', 'bytes', 'fileId', 'on', 'strokes', 'updatedAt']);
  assert.equal(field.fileId['.validate'], 'newData.isString() && newData.val().length >= 1 && newData.val().length <= 200');
  assert.equal(field.bytes['.validate'], 'newData.isNumber() && newData.val() >= 0 && newData.val() <= 400000');
  assert.equal(field.strokes['.validate'], 'newData.isNumber() && newData.val() >= 1 && newData.val() <= 2000 && newData.val() % 1 === 0');
  assert.equal(field.updatedAt['.validate'], 'newData.isNumber()');
  assert.equal(field.$other['.validate'], false);
  assert.deepEqual(rulesIn(ink).filter(([, k]) => k === '.read' || k === '.write'), []);
  // 形の式を小さい代役で評価する。権限の実動作は公開後の規則の確認で試す。
  const accepts = (rule, value, name = 'memo') => evaluateInkRule(rule, name, snapshot(value), snapshot({}).child('ink').child(name));
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

test('手書きの削除時刻は数だけ。権限は records から引き継ぐ', () => {
  const cleared = rules.records.$classId.$lessonId.$sid.inkCleared;
  assert.equal(cleared['.validate'], 'newData.hasChildren()');
  assert.deepEqual(Object.keys(cleared).sort(), ['.validate', '$field'].sort());
  assert.ok(cleared.$field['.validate'].endsWith(" && newData.isNumber() && (!data.exists() || newData.val() > data.val()) && (!data.parent().parent().child('ink').child($field).exists() || newData.val() > data.parent().parent().child('ink').child($field).child('updatedAt').val())"));
  assert.deepEqual(rulesIn(cleared).filter(([, k]) => k === '.read' || k === '.write'), []);
  const accepts = (field, value) => evaluateInkRule(cleared.$field['.validate'], field, snapshot(value), snapshot({}).child('inkCleared').child(field));
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
