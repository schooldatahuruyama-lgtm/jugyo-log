// 生徒一人の記録を、先生が読む画面。入力欄や保存の操作は置かない。
import { el } from '../ui.js';
import { CONFIG } from '../config.js';
import { dateLabel } from '../lesson-logic.js';
import { normalizeRecord } from '../record-logic.js';
import { reviewPeople, neighbors, levelLabel } from '../review-logic.js';
import { teacherNav } from './parts/teacher-nav.js';
import { materialPane } from './parts/material-pane.js';
import { attachmentPane } from './parts/attachment-pane.js';
import { headingIcon } from './parts/heading-icon.js';
import { termRow } from './parts/term-row.js';

function updatedLabel(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function mount(root, ctx) {
  const { classId, lessonId, studentId } = ctx.params;
  let alive = true;
  let loading = false;
  let loadId = 0;
  let materials = null;
  let attachments = null;
  let terms = null;
  let adjacent = { prev: null, next: null };
  const goList = () => ctx.navigate('t-review', { classId, lessonId });
  const move = (id) => { if (alive && !loading && id) void ctx.navigate('t-record', { classId, lessonId, studentId: id }); };
  const previous = el('button', { type: 'button', class: 'btn', text: '前の人', disabled: true, onclick: () => move(adjacent.prev) });
  const next = el('button', { type: 'button', class: 'btn', text: '次の人', disabled: true, onclick: () => move(adjacent.next) });
  const heading = el('h1');
  const date = el('p', { class: 'student-lesson-date' });
  const personHeading = el('h2');
  const identity = el('p', { class: 'small' });
  const titleArea = el('div', { class: 'record-heading', hidden: true }, date, heading, personHeading, identity);
  const pageMessage = el('div', { class: 'page-message', role: 'status', 'aria-live': 'polite' });
  const materialsArea = el('div');
  const recordArea = el('div');
  const termsArea = el('div');
  const reflectionArea = el('div');
  const reflectionStatus = el('span', { class: 'reflection-status', role: 'status' });
  const content = el('div', { class: 'student-lesson-columns', hidden: true },
    el('section', { class: 'student-lesson-teacher', 'aria-labelledby': 'record-teacher-heading' },
      el('header', { class: 'lesson-section-band' },
        el('h2', { id: 'record-teacher-heading' }, headingIcon('teacher'), el('span', { text: '先生の資料' }))),
      el('div', { class: 'lesson-section-body' }, materialsArea)),
    el('section', { class: 'student-lesson-mine', 'aria-labelledby': 'record-mine-heading' },
      el('header', { class: 'lesson-section-band' },
        el('h2', { id: 'record-mine-heading' }, headingIcon('mine'), el('span', { text: 'この生徒の記録' }))),
      el('div', { class: 'lesson-section-body' },
        el('div', { class: 'term-heading' }, el('h3', { text: '重要用語' })), termsArea, recordArea)),
    el('section', { class: 'student-lesson-reflection', 'aria-labelledby': 'record-reflection-heading' },
      el('header', { class: 'lesson-section-band' },
        el('h2', { id: 'record-reflection-heading' }, headingIcon('reflect'), el('span', { text: '振り返り' })), reflectionStatus),
      el('div', { class: 'lesson-section-body' }, reflectionArea)));
  root.replaceChildren(teacherNav(ctx, 'review'),
    el('div', { class: 'student-page' }, el('main', { class: 'student-lesson-page teacher-record-page' },
      el('div', { class: 'page-actions' },
        el('button', { type: 'button', class: 'btn', text: '‹ 一覧へ', onclick: goList }), previous, next),
      titleArea, pageMessage, content)));

  function showRecord(person, savedAttachments) {
    const record = normalizeRecord(person.record, { max: CONFIG.recordTextMax });
    reflectionStatus.classList.toggle('is-complete', record.level !== null);
    reflectionStatus.textContent = record.level !== null ? '✓ 記入済み' : '！ 未記入';
    const text = (value) => value.trim() ? value : '（まだ書いていません）';
    const updated = updatedLabel(person.record?.updatedAt);
    attachments?.destroy();
    attachments = attachmentPane({ ctx, classId, lessonId, studentId,
      attachments: Array.isArray(savedAttachments) ? savedAttachments : [], readOnly: true });
    recordArea.replaceChildren(
      ...(person.record === null ? [el('p', { class: 'notice', text: 'この生徒は、まだ何も書いていません。' })] : []),
      el('dl', { class: 'record-values' },
        el('dt', { text: 'メモ' }), el('dd', { class: 'review-text', text: text(record.memo) }),
        el('dt', { text: '写真・PDF' }), el('dd', {}, attachments.node)));
    reflectionArea.replaceChildren(
      el('dl', { class: 'record-values' },
        el('dt', { text: '理解度' }), el('dd', { text: levelLabel(record.level) })),
      el('div', { class: 'student-reflection-fields' },
        el('dl', { class: 'record-values' },
          el('dt', { text: '分かったこと・学んだこと' }), el('dd', { class: 'review-text', text: text(record.learned) })),
        el('dl', { class: 'record-values' },
          el('dt', { text: '疑問・まだ分からないこと' }), el('dd', { class: 'review-text', text: text(record.question) }))),
      ...(updated ? [el('p', { class: 'small', text: `最後に書いた日時：${updated}` })] : []));
  }

  async function load() {
    if (!alive || loading) return;
    const current = ++loadId;
    const stale = () => !alive || current !== loadId;
    loading = true;
    previous.disabled = true;
    next.disabled = true;
    titleArea.hidden = true;
    content.hidden = true;
    pageMessage.textContent = '読みこんでいます…';
    try {
      const [lessonResult, membersResult, recordsResult] = await Promise.allSettled([
        ctx.repo.getLesson(classId, lessonId), ctx.repo.getMembers(classId), ctx.repo.listRecords(classId, lessonId),
      ]);
      if (stale()) return;
      if (lessonResult.status === 'fulfilled' && !lessonResult.value) {
        pageMessage.textContent = 'この授業は見つかりません。';
        return;
      }
      if ([lessonResult, membersResult, recordsResult].some((result) => result.status === 'rejected')) throw new Error('読みこめませんでした');
      const people = reviewPeople(membersResult.value, recordsResult.value);
      const person = people.find((p) => p.studentId === studentId);
      if (!person) {
        pageMessage.replaceChildren(el('p', { text: 'この生徒は見つかりません。' }),
          el('button', { type: 'button', class: 'btn', text: '一覧へ', onclick: goList }));
        return;
      }
      const lesson = lessonResult.value;
      adjacent = neighbors(people, studentId);
      date.textContent = dateLabel(lesson.date);
      heading.textContent = lesson.title || '（授業名なし）';
      const label = !person.inRoster ? '名簿にいない生徒' : person.number === null ? '出席番号なしの生徒' : `${person.number} 番`;
      personHeading.textContent = `${label}の記録（読み取り専用）`;
      identity.textContent = `生徒 ID：${person.studentId}`;
      showRecord(person, recordsResult.value?.[studentId]?.attachments);
      materials?.destroy();
      materials = materialPane({ ctx, classId, lessonId, lesson });
      materialsArea.replaceChildren(materials.node);
      terms?.destroy();
      terms = termRow({ ctx, classId, lessonId, studentId, lesson, readOnly: true });
      termsArea.replaceChildren(terms.node);
      pageMessage.replaceChildren();
      titleArea.hidden = false;
      content.hidden = false;
    } catch {
      if (!stale()) pageMessage.replaceChildren(
        el('p', { class: 'error', text: 'つながりません。もう一度ためしてください。' }),
        el('button', { type: 'button', class: 'btn', text: 'もう一度ためす', onclick: load }));
    } finally {
      if (!stale()) {
        loading = false;
        previous.disabled = content.hidden || !adjacent.prev;
        next.disabled = content.hidden || !adjacent.next;
      }
    }
  }

  void load();
  return () => { alive = false; loadId += 1; materials?.destroy(); attachments?.destroy(); terms?.destroy(); };
}
