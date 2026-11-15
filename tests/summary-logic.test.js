import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, extractWords, summarize, summaryText } from '../js/summary-logic.js';
import { reviewPeople } from '../js/review-logic.js';

const ink = { fileId: 'TestInk', bytes: 100, strokes: 1, updatedAt: 1 };
const members = [1, 2, 3, 4].map((number) => ({ studentId: `s26-00${number}`, number }));
const run = (records, terms = [], roster = members) => summarize({ students: reviewPeople(roster, records), records, terms });
const ids = (students) => students.map((student) => student.studentId);

test('normalizeText: 全角・半角・大文字・空白と改行をそろえる', () => {
  assert.equal(normalizeText(' ＡＢＣ １２３\nﾊﾝｼｬ\t　反 射\r\n'), 'abc123ハンシャ反射');
  assert.equal(normalizeText('が ガ ｶﾞ'), 'がガガ');
  for (const value of [null, undefined, 12, {}, [], true]) assert.equal(normalizeText(value), '');
});

test('extractWords: 漢字 2 字・カタカナ 3 字の境界、長音、重複', () => {
  assert.deepEqual(extractWords('光、反射と屈折。ア、アイ、アイウとモーター。反射、ﾓｰﾀｰ'), ['反射', '屈折', 'アイウ', 'モーター']);
  assert.deepEqual(extractWords('𠮷野、反 射、ｶﾞﾗｽ'), ['𠮷野', '反射', 'ガラス']);
});

test('extractWords: 指定の除外語と、正規化後に同じ重要用語を除く', () => {
  const ignored = '今日・授業・自分・先生・疑問・理解・勉強・学習・感想・最初・最後・今回・次回・時間・内容・部分・場合・必要・大切・大事';
  assert.deepEqual(extractWords(ignored), []);
  assert.deepEqual(extractWords('反射とガラスと反射角', [' 反 射 ', 'ｶﾞﾗｽ']), ['反射角']);
  assert.deepEqual(extractWords(null, null), []);
});

test('summarize: 文字・手書き・まだを欄別に数え、両方ある人は文字にする', () => {
  const result = run({
    's26-001': { question: '反射', learned: '　\n', ink: { question: ink, learned: ink } },
    's26-002': { question: '\t', learned: '光', ink: { question: ink } },
    's26-003': { question: null, learned: 3 },
    's26-005': { question: 'ガラス', learned: '屈折' },
  });
  assert.deepEqual(result.counts, { question: { text: 2, ink: 1, none: 2 }, learned: { text: 2, ink: 1, none: 2 } });
});

test('summarize: 用語を人数で数え、疑問・分かったこと・元の順で並べる。0 人も残す', () => {
  const result = run({
    's26-001': { question: '屈折と反射と反射と入射', learned: '反射と入射と屈折' },
    's26-002': { question: '屈折と反射と入射', learned: '入射と反射' },
  }, ['屈折', '入射', '反射', '光', '音']);
  assert.deepEqual(result.terms.map(({ term, question, learned }) => [term, question.length, learned.length]),
    [['入射', 2, 2], ['反射', 2, 2], ['屈折', 2, 1], ['光', 0, 0], ['音', 0, 0]]);
  assert.deepEqual(result.words, { question: [], learned: [] });
});

test('summarize: 用語の重複は既存の規則でまとめ、記号は文字のまま探す', () => {
  const result = run({ 's26-001': { question: 'Ａ（＊）と A.* とガラス', learned: 'a ( * )' } },
    ['Ａ（＊）', 'a(*)', 'A.*', 'ｶﾞﾗｽ', 'がらす', ' ', null, 1]);
  assert.deepEqual(result.terms.map(({ term, question, learned }) => [term, question.length, learned.length]),
    [['Ａ（＊）', 1, 1], ['A.*', 1, 0], ['ｶﾞﾗｽ', 1, 0]]);
});

test('summarize: 言葉は生徒ごとに 1 回、ちょうど 2 人を含め、人数と文字コード順', () => {
  const result = run({
    's26-001': { question: '反射、反射と屈折と入射と電流', learned: 'ガラス' },
    's26-002': { question: '反射と屈折と入射', learned: 'ガラス' },
    's26-003': { question: '屈折' },
  });
  assert.deepEqual(result.words.question.map(({ word, students }) => [word, students.length]), [['屈折', 3], ['入射', 2], ['反射', 2]]);
  assert.deepEqual(ids(result.words.question[2].students), ['s26-001', 's26-002']);
  assert.deepEqual(result.words.learned.map(({ word, students }) => [word, students.length]), [['ガラス', 2]]);
});

test('summarize: 言葉はそれぞれ 10 個まで。同じ生徒が重複しても増えない', () => {
  const words = ['反射', '屈折', '入射', '電流', '電圧', '抵抗', '磁界', '圧力', '温度', '湿度', '露点'];
  const records = Object.fromEntries(members.slice(0, 2).map(({ studentId }) => [studentId, { question: words.join('と'), learned: words.join('と') }]));
  const students = reviewPeople(members, records);
  const result = summarize({ students: [...students, students[0]], records });
  for (const field of ['question', 'learned']) {
    assert.deepEqual(result.words[field].map(({ word }) => word), [...words].sort().slice(0, 10));
    assert.ok(result.words[field].every((item) => item.students.length === 2));
    assert.equal(result.counts[field].text, 2);
  }
});

test('summarize: 理解度 1・2 の文字と手書き。番号順で、名簿外は最後', () => {
  const records = {
    's26-001': { level: 2, question: '反射', ink: { question: ink } },
    's26-002': { level: 1, question: '屈折' },
    's26-003': { level: 2, question: '　', ink: { question: ink } },
    's26-004': { level: 3, question: '入射' },
    's26-005': { level: 1, question: '電流' },
  };
  const students = reviewPeople(members, records).reverse();
  const result = summarize({ students, records });
  assert.deepEqual(result.low.items.map(({ student, text }) => [student.number, student.inRoster, text]),
    [[1, true, '反射'], [2, true, '屈折'], [null, false, '電流']]);
  assert.equal(result.low.ink, 1);
});

test('summarize: 理解度なし・範囲外は低い生徒に含めず、2000 字を残す', () => {
  for (const level of [null, undefined, '1', 0, 5, 1.5, NaN]) {
    assert.deepEqual(run({ 's26-001': { level, question: '反射', ink: { question: ink } } }).low, { items: [], ink: 0 });
  }
  const text = 'あ'.repeat(2000);
  assert.equal(run({ 's26-001': { level: 1, question: text + '反射' } }).low.items[0].text, text);
});

test('summarize: おかしい入力を空として扱い、不正な目録や対象外の記録は数えない', () => {
  const empty = { counts: { question: { text: 0, ink: 0, none: 0 }, learned: { text: 0, ink: 0, none: 0 } },
    terms: [], words: { question: [], learned: [] }, low: { items: [], ink: 0 } };
  for (const value of [undefined, null, 1, '文字', [], true]) {
    assert.deepEqual(summarize(value), empty);
    assert.deepEqual(summarize({ students: value, records: value, terms: value }), empty);
  }
  assert.deepEqual(summarize({ students: [null, {}, [], { studentId: 3 }], records: { outsider: { question: '反射' } } }), empty);
  for (const index of [null, true, {}, [], { ...ink, bytes: -1 }]) {
    const result = run({ 's26-001': { question: {}, learned: [], level: 1, ink: { question: index } } });
    assert.deepEqual(result.counts.question, { text: 0, ink: 0, none: 4 });
    assert.deepEqual(result.low, { items: [], ink: 0 });
  }
});

test('summarize: 元の名簿・記録・用語を変えない', () => {
  const records = { 's26-001': { question: '反射', level: 1 } };
  const input = { students: reviewPeople(members, records), records, terms: ['反射', '屈折'] };
  const before = structuredClone(input);
  summarize(input);
  assert.deepEqual(input, before);
});

test('summaryText: 人数・用語・言葉・低理解度の文をコピーし、ID を付けない', () => {
  const result = run({
    's26-001': { level: 1, question: '反射とガラス\n続き', learned: '屈折' },
    's26-002': { level: 2, ink: { question: ink } },
    's26-005': { level: 2, question: 'ガラス', learned: '屈折' },
  }, ['反射']);
  const text = summaryText(result, (student) => student.inRoster ? `${student.number} 番` : '名簿にいない');
  assert.match(text, /疑問: 文字 2 人・手書き 1 人・まだ 2 人/);
  assert.match(text, /反射: 1 人 \/ 0 人/);
  assert.match(text, /ガラス（2 人）/);
  assert.match(text, /屈折（2 人）/);
  assert.match(text, /1 番: 反射とガラス\n続き/);
  assert.match(text, /名簿にいない: ガラス/);
  assert.match(text, /ほかに、手書きの人が 1 人います。/);
  assert.doesNotMatch(text, /s26-/);
});

test('summaryText: 用語がないと表の節はなく、言葉と低理解度の空表示を残す', () => {
  const text = summaryText(summarize());
  assert.doesNotMatch(text, /重要用語ごとの人数/);
  assert.equal(text.split('（2 人以上が書いた言葉は、ありません）').length - 1, 2);
  assert.match(text, /理解度が低い生徒の疑問\n（ありません）/);
  for (const value of [null, {}, [], 3]) assert.doesNotThrow(() => summaryText(value));
});
