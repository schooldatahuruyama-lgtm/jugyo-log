// 生徒の授業一覧と、タイルの指の動きの計算。通信はしない。
import { CONFIG } from './config.js';
import { checkLesson, sortLessons } from './lesson-logic.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function classLabel({ year, name }) {
  return `${year}年度　${name}`;
}

// 日付が文字でない授業も残し、元の授業を変えずに並べる
function sorted(lessons) {
  return sortLessons(lessons.map((lesson) => ({
    date: typeof lesson.date === 'string' ? lesson.date : '',
    createdAt: lesson.createdAt,
    lesson,
  }))).map((item) => item.lesson);
}

function lessonDate(value) {
  if (checkLesson({ date: value, title: '授業' }, { titleMax: CONFIG.lessonTitleMax }) === 'bad-date') return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  return date;
}

// 印を読めなかったときは数えない。今日の授業も含め、受け取った順を保つ。
export function todoLessons(lessons, marks, todayMs) {
  if (!Array.isArray(lessons) || marks === null || typeof marks !== 'object' || Array.isArray(marks) || !isNum(todayMs)) return [];
  const today = new Date(todayMs);
  if (!Number.isFinite(today.getTime())) return [];
  today.setHours(0, 0, 0, 0);
  return lessons.filter((lesson) => {
    const date = lessonDate(lesson?.date);
    if (date === null || date > today) return false;
    const level = marks[lesson.id];
    return !Number.isInteger(level) || level < 1 || level > 4;
  });
}

export function groupByDate(lessons, todayMs) {
  const today = new Date(todayMs);
  today.setHours(0, 0, 0, 0);
  const monday = new Date(today.getTime());
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
  const lastMonday = new Date(monday.getTime());
  lastMonday.setDate(lastMonday.getDate() - 7);
  const future = [];
  const thisWeek = [];
  const lastWeek = [];
  const months = new Map();
  const undated = [];
  for (const lesson of lessons) {
    const date = lessonDate(lesson.date);
    if (date === null) undated.push(lesson);
    else if (date > today) future.push(lesson);
    else if (date >= monday) thisWeek.push(lesson);
    else if (date >= lastMonday) lastWeek.push(lesson);
    else {
      const month = lesson.date.slice(0, 7);
      if (!months.has(month)) months.set(month, []);
      months.get(month).push(lesson);
    }
  }
  const groups = [
    { label: 'これから', lessons: future },
    { label: '今週', lessons: thisWeek },
    { label: '先週', lessons: lastWeek },
    ...[...months.keys()].sort().reverse().map((month) => {
      const [year, number] = month.split('-').map(Number);
      return { label: `${year}年${number}月`, lessons: months.get(month) };
    }),
    { label: '日付なし', lessons: undated },
  ];
  return groups.filter((group) => group.lessons.length > 0)
    .map((group) => ({ label: group.label, lessons: sorted(group.lessons) }));
}

// units は、呼ぶ側で sortUnits の順に並べたものを受け取る
export function groupByUnit(lessons, units) {
  const byUnit = new Map(units.filter((unit) => unit.id).map((unit) => [unit.id, []]));
  const others = [];
  for (const lesson of lessons) {
    const list = byUnit.get(lesson.unitId) ?? others;
    list.push(lesson);
  }
  const groups = units.filter((unit) => byUnit.get(unit.id)?.length > 0)
    .map((unit) => ({ label: unit.name, lessons: sorted(byUnit.get(unit.id)) }));
  if (others.length > 0) groups.push({ label: 'その他', lessons: sorted(others) });
  return groups;
}

export function swipeDecision({ dx, dy }, { tapMax, swipeMin }) {
  if (!isNum(dx) || !isNum(dy)) return 'none';
  const x = Math.abs(dx);
  const y = Math.abs(dy);
  if (x <= tapMax && y <= tapMax) return 'tap';
  if (x >= swipeMin && x > y) return dx < 0 ? 'next' : 'prev';
  return 'none';
}

export function stepIndex(index, dir, count) {
  if (!Number.isInteger(count) || count <= 0) return 0;
  const current = Number.isInteger(index) ? index : 0;
  const step = dir === -1 || dir === 1 ? dir : 0;
  return Math.max(0, Math.min(count - 1, current + step));
}
