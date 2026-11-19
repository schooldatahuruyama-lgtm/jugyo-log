// 生徒一人の記録を先生が読み、記録とは別に返事を書く画面。
import { el } from '../ui.js';
import { isStudentId } from '../ids.js';
import { CONFIG } from '../config.js';
import { dateLabel } from '../lesson-logic.js';
import { normalizeRecord } from '../record-logic.js';
import { loadInkFlow, inkLoadReason } from '../ink-flow.js';
import { reviewPeople, neighbors, levelLabel } from '../review-logic.js';
import { teacherNav } from './parts/teacher-nav.js';
import { materialPane } from './parts/material-pane.js';
import { linkPane } from './parts/link-pane.js';
import { attachmentPane } from './parts/attachment-pane.js';
import { headingIcon } from './parts/heading-icon.js';
import { termRow } from './parts/term-row.js';
import { inkPad } from './parts/ink-pad.js';
import { replyBox } from './parts/reply-box.js';

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
  let links = null;
  let attachments = null;
  let terms = null;
  let reply = null;
  let inkQueue = Promise.resolve();
  const inkPads = new Set();
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
  const linksArea = el('div', { hidden: true });
  const recordArea = el('div');
  const termsArea = el('div');
  const reflectionArea = el('div');
  const reflectionStatus = el('span', { class: 'reflection-status', role: 'status' });
  const content = el('div', { class: 'student-lesson-columns', hidden: true },
    el('section', { class: 'student-lesson-teacher', 'aria-labelledby': 'record-teacher-heading' },
      el('header', { class: 'lesson-section-band' },
        el('h2', { id: 'record-teacher-heading' }, headingIcon('teacher'), el('span', { text: '先生の資料' }))),
      el('div', { class: 'lesson-section-body' }, materialsArea, linksArea)),
    el('section', { class: 'student-lesson-mine', 'aria-labelledby': 'record-mine-heading' },
      el('header', { class: 'lesson-section-band' },
        el('h2', { id: 'record-mine-heading' }, headingIcon('mine'), el('span', { text: 'この生徒の記録' }))),
      el('div', { class: 'lesson-section-body' },
        el('div', { class: 'term-heading' }, el('h3', { text: '重要用語' })), termsArea, recordArea)),
    el('section', { class: 'student-lesson-reflection', 'aria-labelledby': 'record-reflection-heading' },
      el('header', { class: 'lesson-section-band' },
        el('h2', { id: 'record-reflection-heading' }, headingIcon('reflect'), el('span', { text: '振り返り' })), reflectionStatus),
      el('div', { class: 'lesson-section-body' }, reflectionArea)));
  root.replaceChildren(teacherNav({ ...ctx, okToLeave }, 'review'),
    el('div', { class: 'student-page' }, el('main', { class: 'student-lesson-page teacher-record-page' },
      el('div', { class: 'page-actions' },
        el('button', { type: 'button', class: 'btn', text: '‹ 一覧へ', onclick: goList }), previous, next),
      titleArea, pageMessage, content)));

  function okToLeave() { return reply ? reply.okToLeave() : true; }
  const onBeforeUnload = (event) => {
    if (!reply?.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  };
  ctx.setLeaveGuard?.(okToLeave);
  window.addEventListener('beforeunload', onBeforeUnload);

  function destroyInk() {
    for (const pad of inkPads) pad.destroy();
    inkPads.clear();
  }

  function recordField(value, index, field, label, stale) {
    const area = el('dd', {}, value.trim() || !index
      ? el('div', { class: 'review-text', text: value.trim() ? value : '（まだ書いていません）' }) : null);
    if (!index) return area;
    const inkArea = el('div', { class: 'record-ink' });
    area.append(inkArea);
    let pending = false;
    async function reloadIndex() {
      const record = await ctx.repo.getRecord(classId, lessonId, studentId);
      if (!stale()) index = record?.ink?.[field] ?? null;
    }
    function loadInk(refresh = false) {
      if (stale() || pending) return;
      pending = true;
      inkArea.replaceChildren(el('p', { class: 'small', role: 'status', text: '手書きを読みこんでいます…' }));
      // 再試行も同じ列に並べ、3 つの欄の GAS を同時に呼ばない。
      inkQueue = inkQueue.then(async () => {
        if (stale()) return;
        try {
          if (refresh) await reloadIndex();
          if (stale()) return;
          let ink;
          if (index) {
            try {
              ink = await loadInkFlow({ files: ctx.files, fileId: index.fileId });
            } catch (error) {
              if (refresh || error?.code !== 'notfound' || stale()) throw error;
              // 最初の読みこみで入れかわったファイルは、目録から 1 回だけ読み直す。
              await reloadIndex();
              if (stale()) return;
              if (index) ink = await loadInkFlow({ files: ctx.files, fileId: index.fileId });
            }
          }
          if (stale()) return;
          if (!index) {
            inkArea.remove();
            if (!value.trim()) area.append(el('div', { class: 'review-text', text: '（まだ書いていません）' }));
            return;
          }
          const pad = inkPad({ ink, readOnly: true, label: `${label}の手書き` });
          inkPads.add(pad);
          inkArea.replaceChildren(pad.node);
        } catch (error) {
          if (stale()) return;
          inkArea.replaceChildren(el('p', { class: 'error', role: 'alert', text: error?.code === 'notfound'
            ? '手書きが見つかりませんでした。' : `手書きを読みこめませんでした。（理由: ${inkLoadReason(error)}）` }),
            el('button', { type: 'button', class: 'btn', text: 'もう一度', onclick: () => loadInk(true) }));
        } finally { pending = false; }
      });
    }
    loadInk();
    return area;
  }

  function showRecord(person, savedRecord, stale) {
    const record = normalizeRecord(person.record, { max: CONFIG.recordTextMax });
    reflectionStatus.classList.toggle('is-complete', record.level !== null);
    reflectionStatus.textContent = record.level !== null ? '✓ 記入済み' : '！ 未記入';
    const field = (name, label) => recordField(record[name], person.record?.ink?.[name], name, label, stale);
    const updated = updatedLabel(person.record?.updatedAt);
    attachments?.destroy();
    attachments = attachmentPane({ ctx, classId, lessonId, studentId,
      attachments: Array.isArray(savedRecord?.attachments) ? savedRecord.attachments : [], readOnly: true,
      ink: savedRecord?.ink, inkCleared: savedRecord?.inkCleared });
    recordArea.replaceChildren(
      ...(person.record === null ? [el('p', { class: 'notice', text: 'この生徒は、まだ何も書いていません。' })] : []),
      el('dl', { class: 'record-values' },
        el('dt', { text: 'メモ' }), field('memo', 'メモ'),
        el('dt', { text: '写真・PDF' }), el('dd', {}, attachments.node)));
    reflectionArea.replaceChildren(
      el('dl', { class: 'record-values' },
        el('dt', { text: '理解度' }), el('dd', { text: levelLabel(record.level) })),
      el('div', { class: 'student-reflection-fields' },
        el('dl', { class: 'record-values' },
          el('dt', { text: '分かったこと・学んだこと' }), field('learned', '分かったこと')),
        el('dl', { class: 'record-values' },
          el('dt', { text: '疑問・まだ分からないこと' }), field('question', '疑問'))),
      ...(updated ? [el('p', { class: 'small', text: `最後に書いた日時：${updated}` })] : []));
  }

  async function load() {
    if (!alive || loading) return;
    links?.destroy();
    const current = ++loadId;
    const stale = () => !alive || current !== loadId;
    destroyInk();
    loading = true;
    previous.disabled = true;
    next.disabled = true;
    titleArea.hidden = true;
    content.hidden = true;
    pageMessage.textContent = '読みこんでいます…';
    try {
      const [lessonResult, membersResult, recordsResult, repliesResult] = await Promise.allSettled([
        ctx.repo.getLesson(classId, lessonId), ctx.repo.getMembers(classId), ctx.repo.listRecords(classId, lessonId),
        Promise.resolve().then(() => ctx.repo.listReplies(classId, lessonId)),
      ]);
      if (stale()) return;
      if (lessonResult.status === 'fulfilled' && !lessonResult.value) {
        pageMessage.textContent = 'この授業は見つかりません。';
        return;
      }
      if ([lessonResult, membersResult, recordsResult].some((result) => result.status === 'rejected')) throw new Error('読みこめませんでした');
      let people = reviewPeople(membersResult.value, recordsResult.value);
      const knownIds = new Set(people.map((person) => person.studentId));
      const replies = repliesResult.status === 'fulfilled' ? repliesResult.value : {};
      const outside = people.filter((person) => !person.inRoster);
      for (const studentId of Object.keys(replies)) {
        if (isStudentId(studentId) && !knownIds.has(studentId)) {
          outside.push({ studentId, number: null, inRoster: false, record: null });
        }
      }
      outside.sort((a, b) => a.studentId < b.studentId ? -1 : a.studentId > b.studentId ? 1 : 0);
      people = [...people.filter((person) => person.inRoster), ...outside];
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
      const savedRecord = recordsResult.value?.[studentId];
      showRecord(person, savedRecord, stale);
      materials?.destroy();
      materials = materialPane({ ctx, classId, lessonId, lesson, studentId, readOnly: true,
        ink: savedRecord?.ink, inkCleared: savedRecord?.inkCleared });
      materialsArea.replaceChildren(materials.node);
      links = linkPane({ lesson });
      linksArea.replaceChildren(links.node);
      linksArea.hidden = links.node.hidden;
      terms?.destroy();
      terms = termRow({ ctx, classId, lessonId, studentId, lesson, readOnly: true });
      termsArea.replaceChildren(terms.node);
      reply?.destroy();
      reply?.node.remove();
      reply = replyBox({ ctx, classId, lessonId, studentId });
      content.append(reply.node);
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
  return () => {
    alive = false; loadId += 1;
    destroyInk(); materials?.destroy(); links?.destroy(); attachments?.destroy(); terms?.destroy(); reply?.destroy();
    ctx.setLeaveGuard?.(null);
    window.removeEventListener('beforeunload', onBeforeUnload);
  };
}
