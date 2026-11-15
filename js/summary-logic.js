// 文字の記録を人数でまとめる。通信・DOM・外部の辞書は使わない。
import { reviewPeople } from './review-logic.js';
import { cleanTerm, termKey } from './term-logic.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const listOf = (v) => (Array.isArray(v) ? v : []);
const fields = ['question', 'learned'];
const labels = { question: '疑問', learned: '分かったこと' };
const ignored = new Set(['今日', '授業', '自分', '先生', '疑問', '理解', '勉強', '学習', '感想', '最初', '最後',
  '今回', '次回', '時間', '内容', '部分', '場合', '必要', '大切', '大事']);
const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function normalizeText(text) {
  return typeof text === 'string' ? text.normalize('NFKC').toLowerCase().replace(/\s/g, '') : '';
}

export function extractWords(text, terms = []) {
  const excluded = new Set(listOf(terms).map(normalizeText));
  const words = normalizeText(text).match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u{20000}-\u{2fa1f}]{2,}|[\u30a1-\u30faー]{3,}/gu) || [];
  return [...new Set(words)].filter((word) => !ignored.has(word) && !excluded.has(word));
}

export function summarize(input) {
  const { students, records, terms } = isObj(input) ? input : {};
  // 一覧と同じ処理で、文章の上限と手書きの目録を確かめる。
  const saved = new Map(reviewPeople([], records).map((person) => [person.studentId, person.record]));
  const seenStudents = new Set();
  const people = listOf(students).filter((student) => {
    if (!isObj(student) || typeof student.studentId !== 'string' || !student.studentId || seenStudents.has(student.studentId)) return false;
    seenStudents.add(student.studentId);
    return true;
  });
  const seenTerms = new Set();
  const termList = listOf(terms).map(cleanTerm).filter((term) => {
    const key = termKey(term);
    if (!key || seenTerms.has(key)) return false;
    seenTerms.add(key);
    return true;
  }).map((term) => ({ term, question: [], learned: [] }));
  const counts = { question: { text: 0, ink: 0, none: 0 }, learned: { text: 0, ink: 0, none: 0 } };
  const wordMaps = { question: new Map(), learned: new Map() };
  const low = { items: [], ink: 0 };
  for (const student of people) {
    const record = saved.get(student.studentId);
    for (const field of fields) {
      const text = record?.[field] || '';
      const normalized = normalizeText(text);
      counts[field][normalized ? 'text' : record?.ink?.[field] ? 'ink' : 'none'] += 1;
      if (normalized) {
        for (const item of termList) {
          if (normalized.includes(normalizeText(item.term))) item[field].push(student);
        }
        for (const word of extractWords(text, terms)) {
          if (!wordMaps[field].has(word)) wordMaps[field].set(word, []);
          wordMaps[field].get(word).push(student);
        }
      }
    }
    if (record?.level === 1 || record?.level === 2) {
      if (normalizeText(record.question)) low.items.push({ student, text: record.question });
      else if (record.ink?.question) low.ink += 1;
    }
  }
  const numberOf = (student) => Number.isFinite(student.number) ? student.number : Infinity;
  low.items.sort((a, b) => Number(a.student.inRoster === false) - Number(b.student.inRoster === false)
    || numberOf(a.student) - numberOf(b.student));
  const words = Object.fromEntries(fields.map((field) => [field, [...wordMaps[field]]
    .map(([word, students]) => ({ word, students }))
    .filter((item) => item.students.length >= 2)
    .sort((a, b) => b.students.length - a.students.length || byCode(a.word, b.word)).slice(0, 10)]));
  termList.sort((a, b) => b.question.length - a.question.length || b.learned.length - a.learned.length);
  return { counts, terms: termList, words, low };
}

export function summaryText(summary, labelOf) {
  const value = isObj(summary) ? summary : summarize();
  const lines = ['書いた人数'];
  for (const field of fields) {
    const counts = value.counts?.[field];
    lines.push(`${labels[field]}: 文字 ${counts?.text ?? 0} 人・手書き ${counts?.ink ?? 0} 人・まだ ${counts?.none ?? 0} 人`);
  }
  if (listOf(value.terms).length) {
    lines.push('', '重要用語ごとの人数', '用語 / 疑問に出てきた人数 / 分かったことに出てきた人数');
    for (const item of value.terms) {
      if (isObj(item) && typeof item.term === 'string') lines.push(`${item.term}: ${listOf(item.question).length} 人 / ${listOf(item.learned).length} 人`);
    }
  }
  for (const field of fields) {
    lines.push('', `よく出てくる言葉（${labels[field]}）`);
    const words = listOf(value.words?.[field]).filter((item) => isObj(item) && typeof item.word === 'string');
    lines.push(words.length ? words.map((item) => `${item.word}（${listOf(item.students).length} 人）`).join('・')
      : '（2 人以上が書いた言葉は、ありません）');
  }
  lines.push('', '理解度が低い生徒の疑問');
  const items = listOf(value.low?.items).filter((item) => isObj(item) && typeof item.text === 'string');
  if (!items.length) lines.push('（ありません）');
  for (const { student, text } of items) lines.push(`${typeof labelOf === 'function' ? labelOf(student) : '名簿にいない'}: ${text}`);
  if (value.low?.ink > 0) lines.push(`ほかに、手書きの人が ${value.low.ink} 人います。`);
  return lines.join('\n');
}
