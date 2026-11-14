// 重要用語の計算。通信や画面の操作はしない。
import { CONFIG } from './config.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const entriesOf = (v) => (isObj(v) ? Object.entries(v) : []);
const listOf = (v) => (Array.isArray(v) ? v : []);
const termsFor = (v, lesson) => (isObj(v) && isObj(lesson) ? v[lesson.id] : null);
const validLimit = (v) => Number.isInteger(v) && v > 0;

export function cleanTerm(text) {
  return typeof text === 'string' ? text.trim().replace(/\s+/g, ' ') : '';
}

export function checkTerm(text, options) {
  const cleaned = cleanTerm(text);
  if (!cleaned) return 'empty';
  const max = isObj(options) && Number.isFinite(options.max) ? options.max : CONFIG.termMax;
  return cleaned.length > max ? 'long' : null;
}

export function termKey(text) {
  return cleanTerm(text).normalize('NFKC').toLowerCase()
    .replace(/[\u30a1-\u30f6\u30fd-\u30fe]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/\s/g, '');
}

export function lessonTerms(lesson) {
  const terms = isObj(lesson) && isObj(lesson.terms) ? lesson.terms : {};
  return Object.keys(terms).sort()
    .map((id) => ({ id, text: cleanTerm(terms[id]) }))
    .filter((t) => t.text !== '');
}

export function myTermList(value) {
  return entriesOf(value)
    .filter(([slot]) => CONFIG.myTermSlots.includes(slot))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([slot, text]) => ({ slot, text: cleanTerm(text) }))
    .filter((t) => t.text !== '');
}

export function freeTermSlot(myTerms, slots) {
  const terms = isObj(myTerms) ? myTerms : {};
  // 表示できない値が保存されていても、空きとして上書きしない。
  return listOf(slots).find((slot) => CONFIG.myTermSlots.includes(slot)
    && (!Object.hasOwn(terms, slot) || terms[slot] === null || terms[slot] === undefined)) ?? null;
}

export function mergedTerms(lesson, myTerms) {
  const seen = new Set();
  return [
    ...lessonTerms(lesson).map(({ text }) => ({ text, own: false })),
    ...myTermList(myTerms).map(({ slot, text }) => ({ text, own: true, slot })),
  ].filter(({ text }) => {
    const key = termKey(text);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function hasTerm(lesson, myTerms, text) {
  const key = termKey(text);
  return key !== '' && mergedTerms(lesson, myTerms).some((t) => termKey(t.text) === key);
}

export function matchLessons(lessons, myTermsByLesson, query) {
  const list = listOf(lessons);
  const key = termKey(query);
  if (!key) return list;
  return list.filter((lesson) => isObj(lesson) && (termKey(lesson.title).includes(key)
    || mergedTerms(lesson, termsFor(myTermsByLesson, lesson)).some((t) => termKey(t.text).includes(key))));
}

export function frequentTerms(lessons, myTermsByLesson, limit) {
  if (!validLimit(limit)) return [];
  const counts = new Map();
  for (const lesson of listOf(lessons)) {
    for (const { text } of mergedTerms(lesson, termsFor(myTermsByLesson, lesson))) {
      const key = termKey(text);
      if (!counts.has(key)) counts.set(key, { text, count: 0, order: counts.size });
      counts.get(key).count += 1;
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.order - b.order)
    .slice(0, limit).map((t) => t.text);
}

export function suggestTerms(allLessons, current, limit) {
  if (!isObj(current) || !cleanTerm(current.unitId) || !validLimit(limit)) return [];
  const { classId, lessonId, unitId } = current;
  const classes = isObj(allLessons) ? allLessons : {};
  const lessons = isObj(classes[classId]) ? classes[classId] : {};
  const seen = new Set(lessonTerms(lessons[lessonId]).map((t) => termKey(t.text)));
  const out = [];
  for (const [cid, list] of entriesOf(classes)) {
    for (const [lid, lesson] of entriesOf(list)) {
      if ((cid === classId && lid === lessonId) || !isObj(lesson) || lesson.unitId !== unitId) continue;
      for (const { text } of lessonTerms(lesson)) {
        const key = termKey(text);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(text);
        if (out.length === limit) return out;
      }
    }
  }
  return out;
}
