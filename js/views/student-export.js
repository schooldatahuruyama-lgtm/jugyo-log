// 生徒の記録を、印刷して残せる読み物にする。内容はこの画面の間だけ持つ。
import { el } from '../ui.js';
import { CONFIG } from '../config.js';
import { classLabel } from '../student-list-logic.js';
import { dateLabel } from '../lesson-logic.js';
import { levelLabel } from '../review-logic.js';
import { pendingLessonCount } from '../record-flow.js';
import { exportScopes, defaultScope, checkSelection, exportDateLabel, countProblems } from '../export-logic.js';
import { exportLessons } from '../export-flow.js';
import { createExportDraw } from '../export-draw.js';
import { openPdf } from '../pdf.js';

const problemText = {
  image: '！ この写真は読みこめませんでした', pdf: '！ この PDF は読みこめませんでした',
  ink: '！ この手書きは読みこめませんでした',
  overlay: '！ この書きこみは読みこめませんでした（絵だけ出しています）',
  budget: '！ 絵が多いので、この絵は入っていません',
  record: '！ この授業の記録は読みこめませんでした', reply: '！ 先生の返事は読みこめませんでした',
};
const problem = (kind) => el('p', { class: 'export-problem', text: problemText[kind] });
const paragraph = (text) => el('p', { class: 'export-text', text });

function pictureNode(picture, label) {
  if (!picture) return null;
  return el('div', { class: 'export-picture' },
    picture.url ? el('img', { src: picture.url, width: picture.width, height: picture.height,
      alt: `${label}${picture.page ? `（${picture.page} ページ）` : ''}`, loading: 'eager', decoding: 'async' }) : null,
    picture.problem ? problem(picture.problem === 'ink' && picture.url ? 'overlay' : picture.problem) : null);
}

function fileNode(file, label) {
  return el('section', { class: 'export-file' }, el('h4', { text: label }),
    file.pictures.map((picture) => pictureNode(picture, label)),
    file.problem ? problem(file.problem) : null,
    file.skipped > 0 ? paragraph(`残り ${file.skipped} ページは入っていません。`) : null);
}

function fieldNode(label, text, ink) {
  return el('section', {}, el('h3', { text: label }),
    text ? paragraph(text) : !ink ? paragraph('（書いていません）') : null,
    pictureNode(ink, `${label}の手書き`));
}

function lessonNode(lesson) {
  const contents = [el('h2', { text: `${dateLabel(lesson.date)}　${lesson.title || '（授業名なし）'}` })];
  if (lesson.terms.length) contents.push(el('section', {}, el('h3', { text: '重要用語' }), paragraph(lesson.terms.join('、'))));
  if (lesson.materials !== null) {
    contents.push(el('section', {}, el('h3', { text: '先生の資料' }),
      lesson.materials.map((file, i) => fileNode(file, `${file.name || `資料 ${i + 1}`}（${file.kind === 'board' ? '板書' : '配布資料'}）`)),
      lesson.links.map((link) => el('div', { class: 'export-link' }, paragraph(link.label), paragraph(link.url))),
      !lesson.materials.length && !lesson.links.length ? paragraph('（資料はありません）') : null));
  }
  if (lesson.recordProblem) contents.push(problem('record'));
  else if (!lesson.record) contents.push(paragraph('この授業は、まだ何も書いていません。'));
  else {
    contents.push(fieldNode('メモ', lesson.record.memo, lesson.inks.memo));
    if (lesson.attachments.length) contents.push(el('section', {}, el('h3', { text: '自分の写真・PDF' }),
      lesson.attachments.map((file) => fileNode(file, file.label))));
    contents.push(el('section', {}, el('h3', { text: '振り返り' }),
      paragraph(`理解度: ${levelLabel(lesson.record.level)}`),
      fieldNode('分かったこと・学んだこと', lesson.record.learned, lesson.inks.learned),
      fieldNode('疑問・まだ分からないこと', lesson.record.question, lesson.inks.question)));
  }
  if (lesson.replyProblem) contents.push(problem('reply'));
  else if (lesson.reply?.text || lesson.reply?.seen) contents.push(el('section', {}, el('h3', { text: '先生の返事' }),
    lesson.reply.text ? paragraph(lesson.reply.text) : null,
    lesson.reply.seen ? paragraph('✓ 先生が見ました') : null));
  return el('section', { class: 'export-lesson' }, contents);
}

export function mount(root, ctx) {
  let alive = true, loadId = 0, busy = false;
  let controller = null, draw = null;
  let current = null, scopes = [], scope = null, myTerms = {}, selected = new Set();
  const studentId = ctx.session.studentId, classId = ctx.params.classId;
  const body = el('main', { class: 'page-main export-main' });
  const back = () => { stop(); ctx.navigate('home', { classId }); };
  const bar = el('header', { class: 'topbar no-print' },
    el('div', { class: 'topbar-title' }, el('span', { class: 'topbar-brand', text: '授業ログ' }),
      el('span', { class: 'topbar-sub', text: '記録をまとめて保存' })),
    el('button', { type: 'button', class: 'btn', text: '‹ 一覧へ', onclick: back }));
  root.replaceChildren(el('div', { class: 'export-page' }, bar, body));

  const yearSelect = el('select', { 'aria-label': '年度', onchange: () => {
    if (yearSelect.value !== classId) { stop(); ctx.navigate('export', { classId: yearSelect.value }); }
  } });
  const scopeSelect = el('select', { 'aria-label': '単元', onchange: () => {
    if (busy) return;
    scope = scopes.find((entry) => entry.id === scopeSelect.value) ?? null;
    selected = new Set(scope?.lessons.map((lesson) => lesson.id) ?? []);
    renderLessons();
  } });
  const lessonsArea = el('div', { class: 'export-choices' });
  const withMaterials = el('input', { type: 'checkbox', checked: true });
  const count = el('p', { role: 'status' });
  const selectionError = el('p', { class: 'error', role: 'alert', hidden: true });
  const make = el('button', { type: 'button', class: 'btn btn-primary', text: '読み物を作る', onclick: build });
  const controls = el('fieldset', { class: 'export-controls no-print' }, el('legend', { text: 'えらぶ' }),
    el('label', { class: 'field' }, el('span', { class: 'label', text: '年度' }), yearSelect),
    el('label', { class: 'field' }, el('span', { class: 'label', text: '単元' }), scopeSelect),
    el('div', { class: 'export-actions' },
      el('button', { type: 'button', class: 'btn', text: '全部えらぶ', onclick: () => selectAll(true) }),
      el('button', { type: 'button', class: 'btn', text: '全部はずす', onclick: () => selectAll(false) })),
    lessonsArea, el('label', { class: 'export-check' }, withMaterials, '先生の資料も入れる'), count, selectionError, make);
  const notices = el('div', { class: 'no-print' });
  const progress = el('div', { class: 'no-print' });
  const output = el('div');

  function stop() {
    loadId += 1;
    controller?.abort(); controller = null;
    draw?.dispose(); draw = null;
    busy = false;
  }
  function syncControls() {
    controls.disabled = busy;
    for (const tag of ['button', 'input', 'select']) {
      for (const node of controls.querySelectorAll(tag)) node.disabled = busy;
    }
    const selection = checkSelection([...selected], scope, CONFIG.export);
    make.disabled = busy || !selection.ok;
    count.textContent = `えらんだ授業: ${selection.count} 個`;
    selectionError.hidden = selection.reason !== 'many';
    selectionError.textContent = selection.reason === 'many'
      ? `一度に作れるのは ${CONFIG.export.maxLessons} 個までです。授業をへらしてください。` : '';
  }
  function selectAll(checked) {
    if (busy) return;
    selected = new Set(checked ? scope?.lessons.map((lesson) => lesson.id) ?? [] : []);
    renderLessons();
  }
  function renderLessons() {
    lessonsArea.replaceChildren(...(scope?.lessons.map((lesson) => {
      const checkbox = el('input', { type: 'checkbox', checked: selected.has(lesson.id), onchange: () => {
        if (busy) return;
        if (checkbox.checked) selected.add(lesson.id); else selected.delete(lesson.id);
        syncControls();
      } });
      return el('label', { class: 'export-check' }, checkbox, `${dateLabel(lesson.date)}　${lesson.title || '（授業名なし）'}`);
    }) ?? [el('p', { text: 'まだ授業がありません。' })]));
    syncControls();
  }
  function chooseAgain() {
    stop(); output.replaceChildren(); progress.replaceChildren();
    controls.hidden = false; notices.hidden = false; syncControls();
  }
  function showReading(lessons) {
    controls.hidden = true; notices.hidden = false;
    progress.replaceChildren();
    const issues = countProblems(lessons);
    const omitted = lessons.flatMap((lesson) => [
      ...Object.values(lesson.inks),
      ...[...(lesson.materials ?? []), ...lesson.attachments].flatMap((file) => file.pictures),
    ]).filter((picture) => picture?.problem === 'budget').length;
    const actions = el('div', { class: 'export-tools no-print' },
      el('div', { class: 'export-actions' },
        el('button', { type: 'button', class: 'btn btn-primary', text: 'PDF にして保存する', onclick: () => window.print() }),
        el('button', { type: 'button', class: 'btn', text: 'えらび直す', onclick: chooseAgain })),
      el('ol', { class: 'export-steps' },
        el('li', { text: '「PDF にして保存する」を押す' }),
        el('li', { text: '印刷の画面で、紙の絵を 2 本の指で広げる' }),
        el('li', { text: '右上の共有のボタンを押す' }),
        el('li', { text: '「ファイルに保存」か「ドライブ」をえらび、自分の Google ドライブに保存する' })),
      el('p', { text: 'パソコンでは、印刷の画面で「PDF に保存」をえらびます。' }),
      issues ? el('p', { class: 'error', role: 'alert', text: `読みこめなかったものが ${issues} 件あります。その場所に印を出しています。` }) : null,
      issues ? el('button', { type: 'button', class: 'btn', text: 'もう一度読みこむ', onclick: build }) : null,
      omitted ? el('p', { class: 'error', role: 'alert', text: `絵が多いので、${omitted} 枚は入っていません。授業をへらして、分けて作ってください。` }) : null);
    output.replaceChildren(actions, el('article', { class: 'export-reading' },
      el('header', { class: 'export-cover' }, el('h1', { text: '授業ログの記録' }),
        paragraph(classLabel(current)),
        current.number != null ? paragraph(`出席番号: ${current.number}`) : null,
        paragraph(`生徒 ID: ${studentId}`), paragraph(scope.label),
        paragraph(`授業の数: ${lessons.length} 個`), paragraph(`作った日: ${exportDateLabel(ctx.now())}`)),
      lessons.map(lessonNode)));
  }
  async function build() {
    if (!alive || busy || !checkSelection([...selected], scope, CONFIG.export).ok) return;
    stop();
    const id = ++loadId;
    controller = new AbortController();
    const signal = controller.signal;
    const stale = () => !alive || id !== loadId || signal.aborted;
    busy = true; controls.hidden = false; output.replaceChildren(); syncControls();
    const status = el('p', { role: 'status' });
    progress.replaceChildren(status, el('button', { type: 'button', class: 'btn', text: 'やめる', onclick: chooseAgain }));
    try {
      const factory = ctx.createExportDraw ?? createExportDraw;
      draw = factory({ document, URL: globalThis.URL, createImageBitmap: globalThis.createImageBitmap, openPdf, config: CONFIG });
      const lessons = await exportLessons({ repo: ctx.repo, files: ctx.files, classId, studentId,
        lessons: scope.lessons.filter((lesson) => selected.has(lesson.id)), myTerms,
        withMaterials: withMaterials.checked, draw, budget: { left: CONFIG.export.maxPictures }, signal,
        onProgress: (done, total) => {
          if (!stale()) status.textContent = `${Math.min(done + 1, total)} / ${total} 個めの授業を読みこんでいます…`;
        } });
      if (stale()) return;
      busy = false; syncControls(); showReading(lessons);
    } catch (error) {
      if (stale()) return;
      stop(); syncControls();
      progress.replaceChildren(el('p', { class: 'error', role: 'alert', text: 'つながりません。電波を確かめて、もう一度ためしてください。' }),
        el('button', { type: 'button', class: 'btn', text: 'もう一度ためす', onclick: build }));
    }
  }
  async function load() {
    const id = ++loadId;
    const stale = () => !alive || id !== loadId;
    body.replaceChildren(el('p', { class: 'loading no-print', role: 'status', text: '読みこんでいます…' }));
    try {
      const classes = await ctx.repo.myClasses(studentId);
      if (stale()) return;
      current = /^[A-Za-z0-9]+$/.test(classId ?? '') ? classes.find((cls) => cls.id === classId) : null;
      if (!current) {
        body.replaceChildren(el('p', { class: 'error no-print', role: 'alert', text: 'このクラスは見つかりません。' }),
          el('button', { type: 'button', class: 'btn', text: '一覧へ', onclick: back }));
        return;
      }
      const [lessonResult, unitResult, termResult] = await Promise.allSettled([
        ctx.repo.listLessons(classId), ctx.repo.listUnits(current.year), ctx.repo.getMyTerms(studentId, classId),
      ]);
      if (stale()) return;
      if (lessonResult.status === 'rejected') throw lessonResult.reason;
      scopes = exportScopes(lessonResult.value, unitResult.status === 'fulfilled' ? unitResult.value : null);
      scope = scopes.find((entry) => entry.id === defaultScope(scopes)) ?? null;
      myTerms = termResult.status === 'fulfilled' ? termResult.value : {};
      selected = new Set(scope?.lessons.map((lesson) => lesson.id) ?? []);
      yearSelect.replaceChildren(...classes.map((cls) => el('option', { value: cls.id, text: classLabel(cls) })));
      yearSelect.value = classId;
      scopeSelect.replaceChildren(...scopes.map((entry) => el('option', { value: entry.id, text: entry.label })));
      scopeSelect.value = scope?.id ?? '';
      notices.replaceChildren();
      const notice = (text) => notices.append(el('p', { class: 'notice', text }));
      if (unitResult.status === 'rejected') notice('単元を読みこめませんでした。授業は全部ここに出しています。');
      if (termResult.status === 'rejected') notice('自分で足した重要用語を読みこめませんでした。その分は、読み物に入りません。');
      const pending = pendingLessonCount(ctx.drafts, studentId, ctx.inkDrafts);
      if (pending > 0) notice(`まだ保存できていない記録が ${pending} 件あります。その分は、読み物に入りません。一覧にもどって、送れてから作ってください。`);
      body.replaceChildren(notices, controls, progress, output);
      renderLessons();
    } catch {
      if (stale()) return;
      body.replaceChildren(el('p', { class: 'error no-print', role: 'alert', text: 'つながりません。電波を確かめて、もう一度ためしてください。' }),
        el('button', { type: 'button', class: 'btn', text: 'もう一度ためす', onclick: load }));
    }
  }
  load();
  return () => { alive = false; stop(); };
}
