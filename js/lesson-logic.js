// 単元・授業・資料の計算。通信や現在時刻の取得はしない。
import { CONFIG } from './config.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const entriesOf = (v) => (isObj(v) ? Object.entries(v) : []);

// 日付の形だけでなく、うるう年と月ごとの日数も確かめる
export function checkLesson({ date, title }, { titleMax }) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'bad-date';
  const [year, month, day] = date.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) return 'bad-date';
  if (typeof title !== 'string' || title.trim() === '') return 'no-title';
  if (title.length > titleMax) return 'long-title';
  return null;
}

export function checkUnitName(name, { max }) {
  if (typeof name !== 'string' || name.trim() === '') return 'empty';
  return name.length > max ? 'long' : null;
}

export function sortLessons(lessons) {
  return [...lessons].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}

export function sortUnits(units) {
  return [...units].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ja'));
}

// 入れかえたあとの全員の順番を、0 から振り直す
export function moveInOrder(items, id, dir) {
  const index = items.findIndex((x) => x.id === id);
  const next = index + dir;
  if ((dir !== -1 && dir !== 1) || index < 0 || next < 0 || next >= items.length) return {};
  const moved = [...items];
  [moved[index], moved[next]] = [moved[next], moved[index]];
  return Object.fromEntries(moved.map((x, order) => [x.id, order]));
}

// 読める形の資料だけを、順番に返す
export function materialList(materials) {
  return entriesOf(materials)
    .filter(([, m]) => isObj(m)
      && (m.kind === 'board' || m.kind === 'handout')
      && (m.type === 'image' || m.type === 'pdf')
      && typeof m.fileId === 'string' && m.fileId.trim() !== ''
      && typeof m.name === 'string'
      && isNum(m.order) && m.order >= 0
      && isNum(m.bytes) && m.bytes >= 0)
    .map(([id, m]) => ({ id, kind: m.kind, type: m.type, fileId: m.fileId, name: m.name, order: m.order, bytes: m.bytes }))
    .sort((a, b) => a.order - b.order);
}

export function thumbOrder(materials) {
  const rank = (m) => (m.type === 'pdf' ? 2 : m.kind === 'board' ? 0 : 1);
  return materialList(materials)
    .sort((a, b) => rank(a) - rank(b) || a.order - b.order)
    .map((m) => m.id);
}

export function nextOrder(materials) {
  let max = -1;
  for (const [, m] of entriesOf(materials)) {
    if (isObj(m) && isNum(m.order) && m.order >= 0) max = Math.max(max, m.order);
  }
  return max + 1;
}

// ほかの項目が欠けた資料も、ファイルへの参照があれば数える
export function fileRefs(allLessons, fileId) {
  const out = [];
  for (const [classId, lessons] of entriesOf(allLessons)) {
    for (const [lessonId, lesson] of entriesOf(lessons)) {
      for (const [materialId, m] of entriesOf(isObj(lesson) ? lesson.materials : null)) {
        if (isObj(m) && m.fileId === fileId) out.push({ classId, lessonId, materialId });
      }
    }
  }
  return out;
}

export function todayString(dateMs) {
  const date = new Date(dateMs);
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function dateLabel(value) {
  if (checkLesson({ date: value, title: '授業' }, { titleMax: CONFIG.lessonTitleMax }) === 'bad-date') return '日付なし';
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  return `${month}/${day}（${'日月火水木金土'[date.getDay()]}）`;
}
