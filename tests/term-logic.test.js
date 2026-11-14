// 重要用語の計算。通信を使わず、表記の違い・重なり・入力の欠けを確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';
import { cleanTerm, checkTerm, termKey, lessonTerms, myTermList, freeTermSlot,
  mergedTerms, hasTerm, matchLessons, frequentTerms, suggestTerms } from '../js/term-logic.js';

const slots = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'];

test('用語の定数: 20 文字、先生と自分は 8 個、よく使う用語は 8 個', () => {
  assert.equal(CONFIG.termMax, 20);
  assert.equal(CONFIG.termsPerLesson, 8);
  assert.deepEqual(CONFIG.myTermSlots, slots);
  assert.equal(CONFIG.frequentTerms, 8);
});

test('cleanTerm・checkTerm: 空白を整えてから、空・20 文字・21 文字を確かめる', () => {
  assert.equal(cleanTerm('　 光\r\n\t  の　反射 \n'), '光 の 反射');
  assert.equal(cleanTerm('ＡＢＣ ハンシャ'), 'ＡＢＣ ハンシャ');
  for (const value of [null, undefined, 3, {}, [], '', ' \t\n　']) {
    assert.equal(cleanTerm(value), '');
    assert.equal(checkTerm(value, { max: 20 }), 'empty');
  }
  assert.equal(checkTerm(`　${'光'.repeat(20)}\n`, { max: 20 }), null);
  assert.equal(checkTerm('光'.repeat(21), { max: 20 }), 'long');
  assert.equal(checkTerm('光\n\t反射', { max: 4 }), null);
  assert.equal(checkTerm('光の反射', { max: 3 }), 'long');
});

test('termKey: 全角・半角、大小文字、かな、空白をそろえる', () => {
  assert.equal(termKey('ハンシャ'), termKey('はんしゃ'));
  assert.equal(termKey('ＡＢＣ　'), termKey('abc'));
  assert.equal(termKey(' ﾊﾝｼｬ\t'), 'はんしゃ');
  assert.equal(termKey('ガラス　の\n反射'), 'がらすの反射');
  assert.equal(termKey('光 の 反射'), '光の反射');
  assert.equal(termKey(null), '');
});

test('lessonTerms・myTermList: 文字を整え、有効なものをキー順に返す', () => {
  assert.deepEqual(lessonTerms({ terms: { b: ' ハンシャ ', a: '光\n反射', c: 3, d: '　' } }), [
    { id: 'a', text: '光 反射' }, { id: 'b', text: 'ハンシャ' },
  ]);
  assert.deepEqual(myTermList({ t8: '鏡', t2: ' 光 ', t1: '反\n射', t3: 3, t4: ' ', t9: '外', t01: '外', 't1\n': '外' }), [
    { slot: 't1', text: '反 射' }, { slot: 't2', text: '光' }, { slot: 't8', text: '鏡' },
  ]);
});

test('freeTermSlot: 最初の空き、満杯、空の入力を扱い、保存済みの値は上書きしない', () => {
  assert.equal(freeTermSlot({ t1: '光', t3: '鏡' }, slots), 't2');
  assert.equal(freeTermSlot(Object.fromEntries(slots.map((s) => [s, '光'])), slots), null);
  assert.equal(freeTermSlot(null, slots), 't1');
  assert.equal(freeTermSlot({ t1: '', t2: 3, t3: null }, slots), 't3');
  assert.equal(freeTermSlot({}, ['t3', 't1']), 't3');
  assert.equal(freeTermSlot({}, null), null);
});

test('mergedTerms・hasTerm: 先生を先にし、表記違いの重複は最初だけ。元の値は消さない', () => {
  const lesson = { terms: { c: 'abc', b: 'ハンシャ', a: 'ＡＢＣ' } };
  const mine = { t1: 'はんしゃ', t2: ' 鏡 ', t3: '鏡', t4: '実験' };
  const before = structuredClone({ lesson, mine });
  assert.deepEqual(mergedTerms(lesson, mine), [
    { text: 'ＡＢＣ', own: false }, { text: 'ハンシャ', own: false },
    { text: '鏡', own: true, slot: 't2' }, { text: '実験', own: true, slot: 't4' },
  ]);
  assert.equal(hasTerm(lesson, mine, 'a b c'), true);
  assert.equal(hasTerm(lesson, mine, ' はんしゃ '), true);
  assert.equal(hasTerm(lesson, mine, '鏡'), true);
  assert.equal(hasTerm(lesson, mine, 'はん'), false);
  assert.equal(hasTerm(lesson, mine, ''), false);
  assert.deepEqual({ lesson, mine }, before);
});

test('matchLessons: 授業名・先生の用語・自分の用語の部分一致で、元の順と参照を保つ', () => {
  const lessons = [
    { id: 'l3', title: '光の実験', terms: { a: '光の反射' } },
    { id: 'l2', title: 'ハンシャの法則' },
    { id: 'l1', title: 'まとめ', terms: { a: 'ＡＢＣ' } },
  ];
  const mine = { l1: { t1: '鏡の実験' }, l2: { t1: '光の反射' } };
  assert.deepEqual(matchLessons(lessons, mine, '反射'), [lessons[0], lessons[1]]);
  assert.deepEqual(matchLessons(lessons, mine, 'はんしゃ'), [lessons[1]]);
  assert.deepEqual(matchLessons(lessons, mine, '鏡'), [lessons[2]]);
  assert.deepEqual(matchLessons(lessons, mine, 'abc'), [lessons[2]]);
  assert.deepEqual(matchLessons(lessons, mine, '実験'), [lessons[0], lessons[2]]);
  assert.deepEqual(matchLessons(lessons, mine, '電流'), []);
  assert.equal(matchLessons(lessons, mine, '　\n'), lessons);
  assert.equal(matchLessons(lessons, null, null), lessons);
  assert.equal(matchLessons(lessons, mine, '鏡')[0], lessons[2]);
});

test('frequentTerms: 授業内の重なりは 1 回、件数の次は先の授業、表示は最初の書き方', () => {
  const lessons = [
    { id: 'l3', terms: { a: 'ＡＢＣ', b: 'abc', c: '光', d: '鏡' } },
    { id: 'l2', terms: { a: '光', b: 'はんしゃ' } },
    { id: 'l1', terms: { a: 'ハンシャ', b: '古い用語' } },
  ];
  const mine = { l3: { t1: 'abc', t2: '新しい用語' }, l2: { t1: '鏡', t2: '鏡' }, l1: { t1: '光' } };
  assert.deepEqual(frequentTerms(lessons, mine, 8), ['光', '鏡', 'はんしゃ', 'ＡＢＣ', '新しい用語', '古い用語']);
  assert.deepEqual(frequentTerms(lessons, mine, 2), ['光', '鏡']);
  assert.deepEqual(frequentTerms(lessons, null, 2), ['光', 'はんしゃ']);
  for (const limit of [0, -1, null, NaN, '2']) assert.deepEqual(frequentTerms(lessons, mine, limit), []);
});

test('suggestTerms: 同じ単元のほかの授業から、現在の用語と重なりを除いて返す', () => {
  const all = {
    c1: { l1: { unitId: 'u1', terms: { a: 'ＡＢＣ', b: 'ハンシャ' } },
      l2: { unitId: 'u1', terms: { a: 'abc', b: 'はんしゃ', c: '光' } },
      l3: { unitId: 'u2', terms: { a: '電流' } } },
    c2: { l1: { unitId: 'u1', terms: { a: '光', b: '鏡' } }, bad: null },
    bad: [],
  };
  const current = { classId: 'c1', lessonId: 'l1', unitId: 'u1' };
  const before = structuredClone(all);
  assert.deepEqual(suggestTerms(all, current, 8), ['光', '鏡']);
  assert.deepEqual(suggestTerms(all, current, 1), ['光']);
  assert.deepEqual(suggestTerms(all, { ...current, unitId: '' }, 8), []);
  assert.deepEqual(suggestTerms(all, { ...current, unitId: ' ' }, 8), []);
  assert.deepEqual(suggestTerms(all, { ...current, lessonId: 'new' }, 8), ['ＡＢＣ', 'ハンシャ', '光', '鏡']);
  for (const limit of [0, -1, null, NaN]) assert.deepEqual(suggestTerms(all, current, limit), []);
  assert.deepEqual(all, before);
});

test('用語の計算: null・型違い・配列の入れ違いでも落ちない', () => {
  for (const value of [null, undefined, 3, '文字', [], ['光']]) {
    assert.deepEqual(lessonTerms(value), []);
    assert.deepEqual(lessonTerms({ terms: value }), []);
    assert.deepEqual(myTermList(value), []);
    assert.deepEqual(mergedTerms(value, value), []);
    assert.equal(hasTerm(value, value, '光'), false);
    assert.deepEqual(suggestTerms(value, null, 8), []);
    assert.deepEqual(suggestTerms(value, { unitId: 'u1' }, 8), []);
    if (!Array.isArray(value)) {
      assert.deepEqual(matchLessons(value, null, ''), []);
      assert.deepEqual(matchLessons(value, null, '光'), []);
      assert.deepEqual(frequentTerms(value, null, 8), []);
    }
    const lessons = [{ id: 'l1', title: '光', terms: { a: '鏡' } }, null, [], 3];
    assert.deepEqual(matchLessons(lessons, value, '光'), [lessons[0]]);
    assert.deepEqual(frequentTerms(lessons, value, 8), ['鏡']);
  }
});
