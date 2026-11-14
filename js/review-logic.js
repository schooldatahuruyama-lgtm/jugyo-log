// 先生が読む記録の集計・並び順・コピー。通信や現在時刻の取得はしない。
import { CONFIG } from './config.js';
import { normalizeRecord, LEVELS } from './record-logic.js';
import { sortLessons, todayString } from './lesson-logic.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const listOf = (v) => (Array.isArray(v) ? v.filter(isObj) : []);
const recordOf = (v) => normalizeRecord(v, { max: CONFIG.recordTextMax });
const byId = (a, b) => (a.studentId < b.studentId ? -1 : a.studentId > b.studentId ? 1 : 0);

export function reviewPeople(members, records) {
  const saved = new Map((isObj(records) ? Object.entries(records) : [])
    .filter(([, v]) => isObj(v))
    .map(([id, v]) => [id, { ...recordOf(v), updatedAt: isNum(v.updatedAt) ? v.updatedAt : 0 }]));
  const roster = listOf(members)
    .filter((m) => typeof m.studentId === 'string' && m.studentId !== '')
    .map((m) => ({
      studentId: m.studentId,
      number: isNum(m.number) ? m.number : null,
      inRoster: true,
      record: saved.get(m.studentId) ?? null,
    }))
    .sort((a, b) => {
      if (a.number === null && b.number !== null) return 1;
      if (a.number !== null && b.number === null) return -1;
      return (a.number - b.number) || byId(a, b);
    });
  const ids = new Set(roster.map((p) => p.studentId));
  const outside = [...saved]
    .filter(([id]) => !ids.has(id))
    .map(([studentId, record]) => ({ studentId, number: null, inRoster: false, record }))
    .sort(byId);
  return [...roster, ...outside];
}

export function levelCounts(people) {
  const counts = { 4: 0, 3: 0, 2: 0, 1: 0, none: 0, total: 0 };
  for (const person of listOf(people)) {
    const { level } = recordOf(person.record);
    counts[level ?? 'none'] += 1;
    counts.total += 1;
  }
  return counts;
}

export function levelShares(counts) {
  const shares = [4, 3, 2, 1, 'none'].map((key) => ({
    key, count: isNum(counts?.[key]) ? Math.max(0, counts[key]) : 0, percent: 0,
  }));
  if (!isNum(counts?.total) || counts.total <= 0) return shares;
  // 不正な人数を 0 にした場合も、残った人数の合計で割合をそろえる。
  const total = shares.reduce((sum, item) => sum + item.count, 0);
  if (total === 0) return shares;
  const remainders = shares.map((item, index) => {
    const scaled = item.count * 100;
    const exact = scaled / total;
    item.percent = Math.floor(exact);
    return { item, index, remainder: scaled % total };
  }).filter(({ item }) => item.count > 0)
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const left = 100 - shares.reduce((sum, item) => sum + item.percent, 0);
  for (let i = 0; i < left; i += 1) remainders[i].item.percent += 1;
  return shares;
}

export function filterRows(rows, levelKey) {
  if (!Array.isArray(rows)) return [];
  if (levelKey === 'none') return rows.filter((row) => row?.level == null);
  return [4, 3, 2, 1].includes(levelKey) ? rows.filter((row) => row?.level === levelKey) : rows;
}

export function reviewRows(people, options = {}) {
  const field = options?.field === 'learned' ? 'learned' : 'question';
  const rows = listOf(people).map(({ studentId, number, inRoster, record }) => {
    const value = recordOf(record);
    return { studentId, number, inRoster, level: value.level, text: value[field] };
  });
  // 同じ理解度なら、名簿の順番をそのまま残す
  return options?.sort === 'number' ? rows : rows.sort((a, b) => (a.level ?? 5) - (b.level ?? 5));
}

export function copyText(rows) {
  const lines = listOf(rows)
    .map((r) => (typeof r.text === 'string' ? r.text.trim().replace(/\s*[\r\n\u2028\u2029]\s*/g, ' ') : ''))
    .filter((text) => text !== '');
  return { text: lines.join('\n'), count: lines.length };
}

export function neighbors(people, studentId) {
  const list = listOf(people);
  const index = list.findIndex((p) => p.studentId === studentId);
  if (index < 0) return { prev: null, next: null };
  return { prev: list[index - 1]?.studentId ?? null, next: list[index + 1]?.studentId ?? null };
}

export function defaultLesson(lessons, todayMs) {
  const sorted = sortLessons(listOf(lessons)
    .filter((l) => typeof l.id === 'string' && l.id !== '' && typeof l.date === 'string')
    .map((l) => ({ ...l, createdAt: isNum(l.createdAt) ? l.createdAt : 0 })));
  const today = isNum(todayMs) ? todayString(todayMs) : '';
  return (sorted.find((l) => l.date !== '' && l.date <= today) ?? sorted[0])?.id ?? null;
}

export function levelLabel(level) {
  return LEVELS.find((item) => item.value === level)?.label ?? 'まだ入力なし';
}
