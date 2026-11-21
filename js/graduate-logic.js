// 卒業した学年の分け方と、もどせる期限（通信はしない）。
const DAY = 86400000;
const isRemoved = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && Number.isFinite(v.removedAt) && (v.uid == null || typeof v.uid === 'string');

export function cohortOf(studentId) {
  return typeof studentId === 'string' && /^s\d{2}-\d{3}$/.test(studentId)
    && studentId.length === 7 ? studentId.slice(1, 3) : null;
}

export function cohorts({ students, removed, now, graceDays, exclude = [] }) {
  const groups = new Map();
  const excluded = new Set(Array.isArray(exclude) ? exclude : []);
  const all = new Map(students.map((s) => [s.id, s]));
  // 台帳を消した直後に通信が止まった場合も、最後の removed を片付けられるようにする。
  for (const [id, value] of Object.entries(removed)) {
    if (!all.has(id) && isRemoved(value)) all.set(id, { id, uid: value.uid ?? null });
  }
  for (const student of all.values()) {
    if (excluded.has(student.id)) continue;
    const yy = cohortOf(student.id);
    if (yy === null) continue;
    if (!groups.has(yy)) groups.set(yy, { yy, year: 2000 + Number(yy), total: 0,
      active: [], removed: [], restorable: [], purgeable: [], restoreUntil: null, state: 'active' });
    const group = groups.get(yy);
    group.total += 1;
    const value = removed[student.id];
    if (!isRemoved(value)) { group.active.push(student); continue; }
    const item = { ...student, uid: value.uid ?? student.uid ?? null, removedAt: value.removedAt, purging: value.purging === true };
    group.removed.push(item);
    const until = value.removedAt + graceDays * DAY;
    if (item.purging || until <= now) group.purgeable.push(item);
    else {
      group.restorable.push(item);
      group.restoreUntil = group.restoreUntil === null ? until : Math.min(group.restoreUntil, until);
    }
    group.state = group.purgeable.length ? 'purging' : 'removed';
  }
  return [...groups.values()].sort((a, b) => b.year - a.year);
}

export function daysLeft(removedAt, now, graceDays) {
  return Math.max(0, Math.ceil((removedAt + graceDays * DAY - now) / DAY));
}

export function matchesYear(input, year) {
  return typeof input === 'string' && input.trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)) === String(year);
}

export function fileIdsOf(record) {
  const values = [...Object.values(record?.attachments ?? {}), ...Object.values(record?.ink ?? {})];
  return [...new Set(values.map((v) => v?.fileId).filter((id) => typeof id === 'string' && id.trim()))];
}
