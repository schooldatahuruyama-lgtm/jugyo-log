// 記録の書き出しの選び方と数え方。通信や画面の操作はしない。
import { sortUnits } from './lesson-logic.js';
import { cleanInk, inkBounds, splitInkPlace } from './ink-logic.js';

const listOf = (value) => Array.isArray(value) ? value : [];
const text = (value) => typeof value === 'string' ? value : '';
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function exportScopes(lessons, units) {
  const ordered = listOf(lessons).filter((lesson) => lesson && typeof lesson.id === 'string')
    .slice().sort((a, b) => compare(text(a.date), text(b.date))
      || (Number.isFinite(a.createdAt) ? a.createdAt : 0) - (Number.isFinite(b.createdAt) ? b.createdAt : 0)
      || compare(a.id, b.id));
  const known = sortUnits(listOf(units).filter((unit) => unit && typeof unit.id === 'string' && unit.id
    && typeof unit.name === 'string'));
  const ids = new Set(known.map((unit) => unit.id));
  return [...known.map((unit) => ({ id: unit.id, label: unit.name, lessons: ordered.filter((lesson) => lesson.unitId === unit.id) })),
    { id: '', label: '単元に入っていない授業', lessons: ordered.filter((lesson) => !ids.has(lesson.unitId)) }]
    .filter((scope) => scope.lessons.length > 0);
}

export function defaultScope(scopes) {
  let chosen = null, newest = '';
  for (const scope of listOf(scopes)) {
    for (const lesson of listOf(scope?.lessons)) {
      const date = text(lesson?.date);
      if (chosen === null || date > newest) { chosen = scope.id; newest = date; }
    }
  }
  return chosen;
}

export function checkSelection(ids, scope, { maxLessons }) {
  const allowed = new Set(listOf(scope?.lessons).map((lesson) => lesson.id));
  const count = new Set(listOf(ids).filter((id) => allowed.has(id))).size;
  const reason = count === 0 ? 'none' : count > maxLessons ? 'many' : null;
  return { ok: reason === null, count, reason };
}

export function pdfPagesToShow(pageCount, inkPages, limit) {
  if (!Number.isInteger(pageCount) || pageCount <= 0) return { pages: [], skipped: 0 };
  const end = Number.isInteger(limit) && limit > 0 ? Math.min(pageCount, limit) : 0;
  const pages = [...new Set([...Array.from({ length: end }, (_, i) => i + 1),
    ...listOf(inkPages).filter((page) => Number.isInteger(page) && page >= 1 && page <= pageCount)])].sort((a, b) => a - b);
  return { pages, skipped: pageCount - pages.length };
}

export function pageInkPlaces(record, place, fileId) {
  return Object.entries(record?.ink ?? {}).flatMap(([name, index]) => {
    const part = splitInkPlace(name);
    return part?.place === place && index?.on === fileId ? [{ page: part.page, index }] : [];
  }).sort((a, b) => a.page - b.page);
}

export function inkCrop(ink) {
  const value = cleanInk(ink);
  const bounds = inkBounds(value);
  if (!bounds) return null;
  const height = Number.isFinite(ink?.h) && ink.h >= 1 ? ink.h : value.h;
  const top = Math.min(height - 1, Math.max(0, bounds.y - 12));
  const bottom = Math.min(height, bounds.y + bounds.h + 12);
  return { top, height: Math.max(1, bottom - top) };
}

export function exportDateLabel(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime())) return '';
  return `${String(date.getFullYear()).padStart(4, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}

export function countProblems(lessons) {
  let count = 0;
  for (const lesson of listOf(lessons)) {
    count += Number(!!lesson.recordProblem) + Number(!!lesson.replyProblem);
    for (const file of [...listOf(lesson.materials), ...listOf(lesson.attachments)]) {
      if (file.problem) count += 1;
      count += listOf(file.pictures).filter((picture) => picture.problem === 'ink').length;
    }
    count += Object.values(lesson.inks ?? {}).filter((picture) => picture?.problem === 'ink').length;
  }
  return count;
}
