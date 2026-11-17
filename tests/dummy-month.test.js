import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { LEVELS } from '../js/record-logic.js';
import { summarize } from '../js/summary-logic.js';

const month = JSON.parse(readFileSync(new URL('../tools/dummy/month.json', import.meta.url), 'utf8'));
const source = readFileSync(new URL('../tools/dummy/boards.js', import.meta.url), 'utf8');
const expected = [
  ['2026-10-19', '光の進み方', 'light-sound'],
  ['2026-10-21', '光の反射', 'light-sound'],
  ['2026-10-23', '鏡にうつる像', 'light-sound'],
  ['2026-10-26', '光の屈折', 'light-sound'],
  ['2026-10-28', '凸レンズのはたらき', 'light-sound'],
  ['2026-10-30', '凸レンズと像', 'light-sound'],
  ['2026-11-02', '音の伝わり方', 'light-sound'],
  ['2026-11-04', '音の速さ', 'light-sound'],
  ['2026-11-06', '音の大きさと高さ', 'light-sound'],
  ['2026-11-09', '力のはたらき', 'force'],
  ['2026-11-11', '力の表し方', 'force'],
  ['2026-11-13', '重さと質量', 'force'],
  ['2026-11-16', '力のつり合い', 'force'],
];
const figures = ['reflection', 'refraction', 'lens', 'wave', 'force-arrow', 'balance'];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function checkText(value, label, min = 1, max = 2000) {
  assert.equal(typeof value, 'string', label);
  assert.ok(value.length >= min && value.length <= max, `${label}: ${value.length} 文字`);
}

test('dummy month: 単元・13回の日付と授業名が指示書どおりで、日付が重複しない', () => {
  assert.deepEqual(month.units, [{ key: 'light-sound', name: '光と音' }, { key: 'force', name: '力' }]);
  assert.equal(month.lessons.length, 13);
  assert.deepEqual(month.lessons.map(({ date, title, unit }) => [date, title, unit]), expected);
  assert.equal(new Set(month.lessons.map(({ date }) => date)).size, 13);
});

test('dummy month: 理解度の説明は既存アプリの全ラベルと一致し、一行で書く', () => {
  checkText(month.levelNote, 'levelNote');
  assert.doesNotMatch(month.levelNote, /[\r\n]/);
  for (const { value, label } of LEVELS) assert.ok(month.levelNote.includes(`${value}＝${label}`));
  assert.equal(LEVELS.find(({ label }) => label === 'よく分かった').value, 4);
});

for (const lesson of month.lessons) {
  test(`dummy month: ${lesson.date} の用語・板書・3人の記録が指定の形と上限に収まる`, () => {
    assert.ok(isObj(lesson));
    assert.ok(Array.isArray(lesson.terms));
    assert.ok(lesson.terms.length >= 2 && lesson.terms.length <= 4);
    for (const term of lesson.terms) checkText(term, '重要用語', 1, 20);

    const board = lesson.board;
    assert.ok(isObj(board));
    assert.deepEqual(Object.keys(board).sort(), ['aim', 'blocks', 'summary', 'title']);
    assert.equal(board.title, lesson.title);
    checkText(board.aim, 'めあて');
    checkText(board.summary, 'まとめ');
    assert.equal(board.aim.match(/。/g)?.length, 1);
    const sentences = board.summary.match(/。/g)?.length || 0;
    assert.ok(sentences >= 1 && sentences <= 2);
    assert.ok(Array.isArray(board.blocks));
    assert.ok(board.blocks.length >= 2 && board.blocks.length <= 3);
    for (const block of board.blocks) {
      assert.ok(isObj(block));
      assert.deepEqual(Object.keys(block).sort(), ['figure', 'heading', 'lines']);
      checkText(block.heading, '見出し');
      assert.ok(Array.isArray(block.lines));
      assert.ok(block.lines.length >= 1 && block.lines.length <= 6);
      for (const line of block.lines) {
        checkText(line, `${block.heading} の行`, 1, 22);
        assert.doesNotMatch(line, /[\r\n]/);
      }
      assert.ok(block.figure === null || figures.includes(block.figure), `図の名前: ${block.figure}`);
    }

    assert.ok(isObj(lesson.records));
    assert.deepEqual(Object.keys(lesson.records).sort(), ['1', '2', '3']);
    for (const [number, record] of Object.entries(lesson.records)) {
      if (record === null) continue;
      assert.ok(isObj(record));
      assert.deepEqual(Object.keys(record).sort(), ['learned', 'level', 'memo', 'question']);
      checkText(record.memo, `${number}番のメモ`);
      checkText(record.learned, `${number}番の分かったこと`);
      checkText(record.question, `${number}番の疑問`, 0);
      const lines = record.memo.split(/\r?\n/);
      assert.ok(lines.length >= 1 && lines.length <= 4);
      assert.ok(lines.every((line) => line.trim().length > 0));
      assert.ok(Number.isInteger(record.level) && record.level >= 1 && record.level <= 4);
    }
  });
}

test('dummy month: 1番はほぼ毎回高理解度、2番の低理解度は4〜5回、3番の未記入は4回', () => {
  const recordsOf = (number) => month.lessons.map((lesson) => lesson.records[number]);
  const first = recordsOf('1').filter(Boolean);
  const second = recordsOf('2').filter(Boolean);
  const third = recordsOf('3');
  assert.ok(first.length >= 12);
  assert.ok(first.every(({ level }) => level >= 3));
  assert.ok(first.filter(({ level }) => level === 4).length >= 10);
  assert.ok(second.length >= 10);
  const low = second.filter(({ level }) => level <= 2);
  assert.ok(low.length >= 4 && low.length <= 5);
  assert.ok(low.every(({ question }) => question.length > 0));
  assert.equal(third.filter((record) => record === null).length, 4);
  assert.ok(new Set(third.filter(Boolean).map(({ level }) => level)).size >= 3);
});

test('dummy month: 3回以上で、同じ用語への2人のつまずきが実際の自動まとめに現れる', () => {
  const students = [1, 2, 3].map((number) => ({ studentId: `dummy-${number}`, number }));
  const shared = month.lessons.filter((lesson) => {
    const records = Object.fromEntries(students.filter(({ number }) => lesson.records[number] !== null)
      .map(({ studentId, number }) => [studentId, lesson.records[number]]));
    const result = summarize({ students, records, terms: lesson.terms });
    const lowIds = new Set(result.low.items.map(({ student }) => student.studentId));
    return result.terms.some(({ question }) => question.filter(({ studentId }) => lowIds.has(studentId)).length >= 2);
  });
  assert.ok(shared.length >= 3, `共通のつまずきがある授業: ${shared.length} 回`);
});

function loadDrawer() {
  const sandbox = vm.createContext({});
  vm.runInContext(source, sandbox, { filename: 'boards.js' });
  return sandbox;
}

test('dummy boards: DOMや通信なしで読みこめ、公開される関数はdrawDummyBoardだけ', () => {
  const sandbox = loadDrawer();
  assert.equal(typeof sandbox.drawDummyBoard, 'function');
  assert.deepEqual(Object.keys(sandbox), ['drawDummyBoard']);
});

test('dummy boards: boardがオブジェクトでなければcanvasを作る前にTypeError', async () => {
  const { drawDummyBoard } = loadDrawer();
  for (const board of [undefined, null, [], '板書', 1, true, () => {}]) {
    await assert.rejects(drawDummyBoard(board), { name: 'TypeError' });
  }
});

test('dummy boards: width・heightが正の有限な数でなければTypeError', async () => {
  const { drawDummyBoard } = loadDrawer();
  for (const name of ['width', 'height']) {
    for (const value of [0, -1, NaN, Infinity, -Infinity, '1600', null, true, {}]) {
      await assert.rejects(drawDummyBoard({}, { [name]: value }), { name: 'TypeError' });
    }
  }
});

test('dummy boards: 範囲外の画質とnullのオプションはTypeError', async () => {
  const { drawDummyBoard } = loadDrawer();
  for (const quality of [-0.1, 1.1, NaN, Infinity, '0.85', null]) {
    await assert.rejects(drawDummyBoard({}, { quality }), { name: 'TypeError' });
  }
  await assert.rejects(drawDummyBoard({}, null), { name: 'TypeError' });
});
