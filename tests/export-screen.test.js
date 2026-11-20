import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';
import { mount } from '../js/views/student-export.js';
import { mount as homeMount } from '../js/views/student-home.js';
import { createExportDraw } from '../js/export-draw.js';
import { createMemoryNet } from '../js/dev/memory-net.js';
import { createDemoGas } from '../js/dev/demo-gas.js';
import { createRepo } from '../js/repo.js';
import { createFiles } from '../js/files.js';
import { installDom, all, byClass, buttons, settle } from './helpers/picture-dom.js';

const classes = [{ id: 'c1', year: 2026, name: '確認用クラス', number: 2 }, { id: 'c2', year: 2025, name: '前年度', number: null }];
const lesson = (id, date = '2026-01-02', unitId = 'u1') => ({ id, date, unitId, title: `授業 ${id}`, createdAt: 1 });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const select = (root, label) => all(root, (node) => node.tagName === 'select' && node.getAttribute('aria-label') === label)[0];
const change = (node, value) => { node.value = value; node.fire('change'); };
const checked = (node, value) => { node.checked = value; node.fire('change'); };
const chooseBoxes = (root) => all(byClass(root, 'export-choices')[0], (node) => node.tagName === 'input');
const visible = (node) => !node.hidden && (!node.parentNode || visible(node.parentNode));

function setup(t, { repo = {}, params = { classId: 'c1' }, home = false, pending = [], inkPending = [], files = {}, studentId = 'TestStudent', drawFactory } = {}) {
  const dom = installDom(), root = document.createElement('div'); document.body.append(root);
  const h = { root, disposed: 0, creates: 0, reads: [], moves: [], printed: 0 };
  window.print = () => h.printed++;
  h.repo = {
    myClasses: async () => classes, listLessons: async () => [lesson('l1')],
    listUnits: async () => [{ id: 'u1', name: '光', order: 1 }, { id: 'u2', name: '音', order: 2 }],
    getMyTerms: async () => ({}), getMarks: async () => ({}), getReplyMarks: async () => ({}),
    getRecord: async (_, id) => { h.reads.push(id); return { memo: '<b>そのまま</b>\n次の行', learned: '光の進み方', question: '', level: 3 }; },
    getReply: async () => ({ text: '確認用の返事', seen: true }), ...repo,
  };
  const ctx = { repo: h.repo, params, session: { studentId }, files,
    drafts: { list: () => pending }, inkDrafts: { list: () => inkPending },
    thumbs: { load: async () => ({}) }, now: () => new Date(2026, 10, 21).getTime(),
    setLeaveGuard: () => {}, navigate: (name, params) => { h.moves.push([name, params]); },
    createExportDraw: (options) => {
      h.creates++;
      if (drawFactory) {
        const draw = drawFactory(options);
        return { ...draw, dispose: () => { h.disposed++; draw.dispose(); } };
      }
      return { dispose: () => h.disposed++, picture: async () => ({ url: 'blob:test', width: 800, height: 400 }),
        ink: async () => ({ url: 'blob:ink', width: 800, height: 100 }) };
    },
  };
  h.destroy = (home ? homeMount : mount)(root, ctx);
  h.remount = (params = ctx.params) => { h.destroy(); ctx.params = params; h.destroy = mount(root, ctx); };
  t.after(() => { h.destroy(); root.remove(); dom.restore(); });
  return h;
}

test('一覧の年度のところから今のクラスの書き出しへ進む', async (t) => {
  const h = setup(t, { home: true, params: { classId: 'c2' } }); await settle();
  const button = buttons(h.root, '記録をまとめて保存')[0];
  assert.ok(visible(button)); assert.ok(byClass(h.root, 'student-filters')[0].contains(button));
  button.click(); await settle();
  assert.deepEqual(h.moves, [['export', { classId: 'c2' }]]);
});

test('クラスに入っていなければ書き出しのボタンは見せない', async (t) => {
  const h = setup(t, { home: true, repo: { myClasses: async () => [] } }); await settle();
  assert.equal(buttons(h.root, '記録をまとめて保存').filter(visible).length, 0);
});

test('単元順、未所属、最新の授業の選び、日付順、最初の印、年度と一覧への移動', async (t) => {
  const h = setup(t, { repo: { listLessons: async () => [lesson('old', '2026-01-01'), lesson('new', '2026-01-03'),
    lesson('sound', '2026-01-02', 'u2'), lesson('orphan', '2026-01-01', 'removed')] } }); await settle();
  assert.deepEqual(select(h.root, '単元').children.map((node) => node.textContent), ['光', '音', '単元に入っていない授業']);
  assert.equal(select(h.root, '単元').value, 'u1');
  assert.ok(chooseBoxes(h.root).every((box) => box.checked));
  assert.match(byClass(h.root, 'export-choices')[0].textContent, /授業 old.*授業 new/);
  change(select(h.root, '単元'), ''); assert.equal(chooseBoxes(h.root).length, 1); assert.ok(chooseBoxes(h.root)[0].checked);
  change(select(h.root, '年度'), 'c2');
  assert.deepEqual(h.moves.at(-1), ['export', { classId: 'c2' }]);
  buttons(h.root, '‹ 一覧へ')[0].click();
  assert.deepEqual(h.moves.at(-1), ['home', { classId: 'c1' }]);
});

test('16 個は作れず 15 個に減らすと作れる。全部はずす・全部えらぶ', async (t) => {
  const h = setup(t, { repo: { listLessons: async () => Array.from({ length: 16 }, (_, i) => lesson(`l${i}`)) } }); await settle();
  const make = buttons(h.root, '読み物を作る')[0];
  assert.equal(make.disabled, true); assert.match(h.root.textContent, /一度に作れるのは 15 個までです。授業をへらしてください。/);
  assert.ok(all(h.root, (node) => node.getAttribute('role') === 'alert' && node.textContent.includes('15 個')).length);
  checked(chooseBoxes(h.root)[0], false); assert.equal(make.disabled, false); assert.match(h.root.textContent, /えらんだ授業: 15 個/);
  buttons(h.root, '全部はずす')[0].click(); assert.equal(make.disabled, true); assert.match(h.root.textContent, /えらんだ授業: 0 個/);
  buttons(h.root, '全部えらぶ')[0].click(); assert.equal(make.disabled, true); assert.equal(chooseBoxes(h.root).filter((box) => box.checked).length, 16);
});

test('授業 0 個は作れない', async (t) => {
  const h = setup(t, { repo: { listLessons: async () => [] } }); await settle();
  assert.match(h.root.textContent, /まだ授業がありません。/); assert.equal(buttons(h.root, '読み物を作る')[0].disabled, true);
});

test('作る・進み具合・文字の読み物・印刷。二度押ししても一度だけ', async (t) => {
  const gate = deferred();
  const h = setup(t, { repo: { getRecord: () => gate.promise } }); await settle();
  const make = buttons(h.root, '読み物を作る')[0]; make.click(); make.click(); await settle();
  assert.equal(h.creates, 1); assert.equal(make.disabled, true);
  assert.ok(all(h.root, (node) => node.getAttribute('role') === 'status' && /1 \/ 1 個め/.test(node.textContent)).length);
  assert.ok(chooseBoxes(h.root).every((box) => box.disabled)); assert.equal(select(h.root, '年度').disabled, true);
  gate.resolve({ memo: '<b>そのまま</b>\n次の行', level: 3, learned: '光の進み方' }); await settle();
  const reading = byClass(h.root, 'export-reading')[0];
  assert.match(reading.textContent, /2026年度.*出席番号: 2.*生徒 ID: TestStudent.*作った日: 2026\/11\/21/);
  assert.match(reading.textContent, /1\/2.*授業 l1/); assert.match(reading.textContent, /理解度: 分かった/);
  assert.match(reading.textContent, /確認用の返事.*✓ 先生が見ました/);
  assert.ok(byClass(reading, 'export-text').some((node) => node.textContent === '<b>そのまま</b>\n次の行'));
  assert.equal(all(reading, (node) => node.tagName === 'b' || node.tagName === 'button').length, 0);
  assert.equal(all(h.root, (node) => node.tagName === 'ol')[0].children.length, 4);
  buttons(h.root, 'PDF にして保存する')[0].click(); assert.equal(h.printed, 1);
  buttons(h.root, 'えらび直す')[0].click(); assert.equal(h.disposed, 1);
  assert.equal(byClass(h.root, 'export-reading').length, 0); assert.equal(make.disabled, false);
});

test('全記録と返事の読みこみが失敗しても印と件数を出し、同じ選びで作り直す', async (t) => {
  const fail = async () => { throw new Error('確認用'); };
  const h = setup(t, { repo: { listLessons: async () => [lesson('l1'), lesson('l2')], getRecord: fail, getReply: fail } }); await settle();
  buttons(h.root, '読み物を作る')[0].click(); await settle();
  assert.equal(byClass(h.root, 'export-problem').length, 4); assert.match(h.root.textContent, /読みこめなかったものが 4 件あります/);
  assert.match(h.root.textContent, /！ この授業の記録は読みこめませんでした/);
  h.repo.getRecord = async () => ({ memo: '読み直せた' }); h.repo.getReply = async () => null;
  buttons(h.root, 'もう一度読みこむ')[0].click(); await settle();
  assert.equal(h.disposed, 1); assert.equal(h.creates, 2); assert.equal(byClass(h.root, 'export-problem').length, 0);
  assert.equal(byClass(h.root, 'export-lesson').length, 2); assert.match(h.root.textContent, /読み直せた/);
});

for (const action of ['やめる', '離れる', '年度変更']) {
  test(`${action}で片付け、遅れて届いた結果で書きかえない`, async (t) => {
    const gate = deferred();
    const h = setup(t, { repo: { getRecord: () => gate.promise } }); await settle();
    buttons(h.root, '読み物を作る')[0].click(); await settle();
    if (action === 'やめる') buttons(h.root, 'やめる')[0].click();
    else if (action === '離れる') h.destroy();
    else change(select(h.root, '年度'), 'c2');
    const before = h.root.textContent; assert.equal(h.disposed, 1);
    gate.resolve({ memo: '遅い応答' }); await settle();
    assert.equal(h.root.textContent, before); assert.equal(byClass(h.root, 'export-reading').length, 0);
    if (action === 'やめる') assert.equal(buttons(h.root, '読み物を作る')[0].disabled, false);
  });
}

for (const action of ['やめる', 'えらび直す', '年度変更', '離れてもどる']) {
  test(`${action}のあとすぐ作っても、前の PDF の終了を待ち、同時に 1 つまでにする`, async (t) => {
    const opening = deferred(), closing = deferred();
    t.after(() => { opening.resolve(); closing.resolve(); });
    let opened = 0, closed = 0, active = 0, maximum = 0;
    const h = setup(t, {
      repo: { listLessons: async () => [{ ...lesson('l1'), materials: {
        Abcdef123456: { type: 'pdf', kind: 'handout', name: '確認用 PDF', fileId: 'pdf', bytes: 1, order: 0 },
      } }] },
      files: { loadFile: async () => new Blob(['test']) },
      drawFactory: (options) => createExportDraw({ ...options,
        URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
        openPdf: async () => {
          const number = ++opened;
          active++; maximum = Math.max(maximum, active);
          if (number === 1) await opening.promise;
          return { pageCount: 1,
            renderPage: async () => ({ width: 1200, height: 900, toBlob: (done) => done(new Blob(['page'])) }),
            close: async () => {
              closed++;
              if (number === 1) await closing.promise;
              active--;
            },
          };
        },
      }),
    });
    await settle(); buttons(h.root, '読み物を作る')[0].click(); await settle();
    assert.equal(opened, 1);
    if (action === 'やめる') buttons(h.root, 'やめる')[0].click();
    else if (action === 'えらび直す') {
      opening.resolve(); closing.resolve(); await settle();
      assert.equal(byClass(h.root, 'export-reading').length, 1);
      buttons(h.root, 'えらび直す')[0].click();
    } else if (action === '年度変更') {
      change(select(h.root, '年度'), 'c2');
      assert.deepEqual(h.moves.at(-1), ['export', { classId: 'c2' }]);
      h.remount({ classId: 'c2' });
    } else { h.destroy(); h.remount(); }
    await settle();
    const make = buttons(h.root, '読み物を作る')[0];
    assert.equal(make.disabled, false);
    make.click(); await settle(); assert.equal(h.creates, 2);
    if (action !== 'えらび直す') {
      assert.equal(opened, 1); assert.equal(byClass(h.root, 'export-reading').length, 0);
      opening.resolve(); await settle();
      assert.equal(closed, 1); assert.equal(opened, 1);
      closing.resolve(); await settle();
    }
    assert.equal(opened, 2); assert.equal(closed, 2); assert.equal(active, 0); assert.equal(maximum, 1);
    assert.equal(byClass(h.root, 'export-reading').length, 1);
    assert.equal(byClass(h.root, 'export-problem').length, 0);
    assert.equal(all(h.root, (node) => node.tagName === 'img').length, 1);
  });
}

test('読み物が完成してから離れても片付ける', async (t) => {
  const h = setup(t); await settle(); buttons(h.root, '読み物を作る')[0].click(); await settle();
  assert.equal(h.disposed, 0); h.destroy(); assert.equal(h.disposed, 1);
});

test('単元・自分の用語の失敗と、送れていない記録を知らせる', async (t) => {
  const h = setup(t, { repo: { listUnits: async () => { throw new Error(); }, getMyTerms: async () => { throw new Error(); } },
    pending: [{ classId: 'c1', lessonId: 'l1' }], inkPending: [{ classId: 'c1', lessonId: 'l1' }, { classId: 'c1', lessonId: 'l2' }] }); await settle();
  const notices = byClass(h.root, 'notice').map((node) => node.textContent).join('\n');
  assert.match(notices, /単元を読みこめませんでした。授業は全部ここに出しています。/);
  assert.match(notices, /自分で足した重要用語を読みこめませんでした。/);
  assert.match(notices, /まだ保存できていない記録が 2 件あります。/);
  assert.equal(select(h.root, '単元').value, ''); assert.equal(buttons(h.root, '読み物を作る')[0].disabled, false);
});

for (const classId of ['foreign', 'bad-id']) {
  test(`自分のクラスでない・不正な id (${classId}) では授業を読まない`, async (t) => {
    let reads = 0;
    const h = setup(t, { params: { classId }, repo: { listLessons: async () => { reads++; return []; } } }); await settle();
    assert.equal(reads, 0); assert.match(h.root.textContent, /このクラスは見つかりません。/);
    assert.equal(buttons(h.root, '読み物を作る').length, 0);
  });
}

test('授業の読みこみは再試行できる。離れたあとの読みこみは反映しない', async (t) => {
  const gate = deferred();
  const h = setup(t, { repo: { listLessons: async () => { throw new Error(); } } }); await settle();
  assert.match(h.root.textContent, /つながりません。/);
  h.repo.listLessons = async () => [lesson('retry')]; buttons(h.root, 'もう一度ためす')[0].click(); await settle();
  assert.match(h.root.textContent, /授業 retry/);
  h.destroy();
  const h2 = setup(t, { repo: { myClasses: () => gate.promise } });
  const before = h2.root.textContent; h2.destroy(); gate.resolve(classes); await settle();
  assert.equal(h2.root.textContent, before);
});

test('記録なし・返事なし、出席番号なしを余計な欄なしで表示する', async (t) => {
  const h = setup(t, { params: { classId: 'c2' }, repo: { getRecord: async () => null, getReply: async () => null } }); await settle();
  buttons(h.root, '読み物を作る')[0].click(); await settle();
  const reading = byClass(h.root, 'export-reading')[0];
  assert.match(reading.textContent, /この授業は、まだ何も書いていません。/);
  assert.match(reading.textContent, /（資料はありません）/);
  assert.doesNotMatch(reading.textContent, /出席番号|名前|先生の返事|理解度/);
});

test('絵の alt と大きさ、上限の件数、資料を入れない選び', async (t) => {
  const before = CONFIG.export.maxPictures; CONFIG.export.maxPictures = 1; t.after(() => { CONFIG.export.maxPictures = before; });
  const h = setup(t, { repo: {
    listLessons: async () => [{ ...lesson('l1'), materials: { Abcdef123456: { type: 'image', kind: 'board', name: '板書 1', fileId: 'photo', bytes: 1, order: 0 } } }],
    getRecord: async () => ({ ink: { memo: { fileId: 'ink' } } }),
  }, files: { loadImages: async () => ({ Abcdef123456: 'blob' }), loadInk: async () => JSON.stringify({ v: 1, h: 400, s: [{ c: 0, w: 0, p: [0, 0, 20, 20] }] }) } });
  await settle(); buttons(h.root, '読み物を作る')[0].click(); await settle();
  const img = all(h.root, (node) => node.tagName === 'img')[0];
  assert.match(img.getAttribute('alt'), /板書 1/); assert.equal(img.getAttribute('width'), '800');
  assert.equal(img.getAttribute('loading'), 'eager'); assert.equal(img.getAttribute('decoding'), 'async');
  assert.match(h.root.textContent, /絵が多いので、1 枚は入っていません/);
  assert.match(h.root.textContent, /！ 絵が多いので、この絵は入っていません/);
  assert.equal(buttons(h.root, 'もう一度読みこむ').length, 0);
  buttons(h.root, 'えらび直す')[0].click();
  const materialBox = all(h.root, (node) => node.tagName === 'label' && node.textContent === '先生の資料も入れる')[0].children[0];
  checked(materialBox, false); buttons(h.root, '読み物を作る')[0].click(); await settle();
  assert.doesNotMatch(byClass(h.root, 'export-reading')[0].textContent, /先生の資料/);
  assert.equal(all(h.root, (node) => node.tagName === 'img')[0].getAttribute('alt'), 'メモの手書き');
});

test('練習モードの repo・files・GAS をそのまま使い、本文・写真・書きこみ・手書き・返事を出す', async (t) => {
  let user = { uid: 'teacher' };
  const net = createMemoryNet({ now: () => 1000, initial: {
    teacherList: { teacher: true }, accounts: { student: 's26-001' },
  } });
  const repo = createRepo(net), gas = createDemoGas({ net, getUser: () => user });
  const files = createFiles({ gas, cache: { get: async () => null, put: async () => {} } });
  await repo.createClass('c1', { year: 2026, name: '確認用クラス' }, 1000);
  await repo.saveMembers('c1', { set: { 's26-001': 1 } });
  await repo.createLessons([{ classId: 'c1', lessonId: 'l1', date: '2026-01-02', title: '練習用の授業' }], 1000);
  const photo = await files.upload({ key: 'export-photo-1', mime: 'image/jpeg', name: '板書 1', dataB64: 'AQID' });
  await net.set('lessons/c1/l1/materials/Abcdef123456', { ...photo, type: 'image', kind: 'board', name: '板書 1', order: 0 });
  await repo.setReply('c1', 'l1', 's26-001', { text: '練習用の返事', seen: true }, 1000);
  user = { uid: 'student' };
  const own = await files.uploadStudent({ key: 'export-own-1', classId: 'c1', lessonId: 'l1', mime: 'image/jpeg', dataB64: 'AQID' });
  const handwriting = await files.uploadInk({ key: 'export-ink-1', classId: 'c1', lessonId: 'l1',
    text: JSON.stringify({ v: 1, h: 400, s: [{ c: 0, w: 0, p: [10, 10, 20, 20] }] }) });
  const index = { ...handwriting, strokes: 1, updatedAt: 1000 };
  await net.set('records/c1/l1/s26-001', { memo: '練習モードのメモ', level: 4,
    attachments: { a1: { ...own, type: 'image', addedAt: 1000 } },
    ink: { memo: index, Abcdef123456: { ...index, on: photo.fileId }, a1: { ...index, on: own.fileId } } });
  const before = net.dump();
  const h = setup(t, { repo, files, studentId: 's26-001' }); await settle();
  buttons(h.root, '読み物を作る')[0].click();
  for (let i = 0; i < 4; i++) await settle();
  const reading = byClass(h.root, 'export-reading')[0];
  assert.ok(reading); assert.match(reading.textContent, /練習モードのメモ/);
  assert.match(reading.textContent, /理解度: よく分かった/); assert.match(reading.textContent, /練習用の返事/);
  assert.equal(byClass(reading, 'export-problem').length, 0);
  assert.equal(all(reading, (node) => node.tagName === 'img').length, 3);
  assert.deepEqual(net.dump(), before);
});

function canvasHarness({ bitmap, pdf, delayedBlob } = {}) {
  const canvases = [], made = [], revoked = [], lines = [];
  const document = { createElement: () => {
    const canvas = { width: 0, height: 0, getContext: () => ({ fillRect() {}, drawImage() {}, beginPath() {}, stroke() {},
      moveTo: (...point) => lines.push(point), lineTo: (...point) => lines.push(point) }),
    toBlob: (done, mime, quality) => { assert.equal(mime, 'image/jpeg'); assert.equal(quality, 0.8);
      if (delayedBlob) delayedBlob.push(done); else done(new Blob(['test'])); } };
    canvases.push(canvas); return canvas;
  } };
  const draw = createExportDraw({ document, config: CONFIG, createImageBitmap: bitmap ?? (async () => ({ width: 2400, height: 1200, close() {} })),
    URL: { createObjectURL: () => { const url = `blob:test${made.length}`; made.push(url); return url; }, revokeObjectURL: (url) => revoked.push(url) },
    openPdf: pdf ?? (async () => ({ pageCount: 1, renderPage: async () => { const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 600; return canvas; }, close() {} })),
  });
  return { draw, canvases, made, revoked, lines };
}

test('描画: 写真を縮め、同じ比で線を重ね、手書きを切り出し、canvas と URL を片付ける', async () => {
  const h = canvasHarness();
  const ink = { v: 1, h: 400, s: [{ c: 0, w: 0, p: [100, 100, 200, 200] }] };
  const picture = await h.draw.picture(new Blob(['test']), ink);
  assert.equal(picture.width, 1200); assert.equal(picture.height, 600); assert.deepEqual(h.lines[0], [150, 150]);
  const hand = await h.draw.ink(ink); assert.equal(hand.width, 800); assert.equal(hand.height, 127);
  assert.equal(await h.draw.ink({ v: 1, h: 400, s: [] }), null);
  assert.ok(h.canvases.every((canvas) => canvas.width === 0 && canvas.height === 0));
  h.draw.dispose(); h.draw.dispose(); assert.deepEqual(h.revoked, h.made);
});

test('描画: PDF のページも JPEG にして、開いた PDF は dispose で一度だけ閉じる', async () => {
  let closed = 0;
  const h = canvasHarness({ pdf: async () => ({ pageCount: 1, close: () => closed++, renderPage: async () => {
    const canvas = { width: 1200, height: 600, toBlob: (done) => done(new Blob(['test'])) }; return canvas;
  } }) });
  const pdf = await h.draw.openPdf(new Blob(['pdf']));
  const page = await pdf.page(1, null); assert.equal(page.width, 1200);
  h.draw.dispose(); await pdf.close(); assert.equal(closed, 1); assert.deepEqual(h.revoked, h.made);
});

test('描画: dispose のあとにできた JPEG・画像・PDF を残さない', async () => {
  const delayed = [], h = canvasHarness({ delayedBlob: delayed });
  const pending = h.draw.picture(new Blob(['test']), null); await settle();
  h.draw.dispose(); delayed[0](new Blob(['late'])); await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual(h.made, []); assert.ok(h.canvases.every((canvas) => canvas.width === 0));
  const gate = deferred(); let closed = 0;
  const h2 = canvasHarness({ bitmap: () => gate.promise });
  const pending2 = h2.draw.picture(new Blob(['test']), null); h2.draw.dispose();
  gate.resolve({ width: 800, height: 400, close: () => closed++ });
  await assert.rejects(pending2, { name: 'AbortError' }); assert.equal(closed, 1);
  const pdfGate = deferred(), h3 = canvasHarness({ pdf: () => pdfGate.promise });
  const pending3 = h3.draw.openPdf(new Blob(['test'])); await settle(); h3.draw.dispose();
  pdfGate.resolve({ close: () => closed++ }); await assert.rejects(pending3, { name: 'AbortError' }); assert.equal(closed, 2);
});
