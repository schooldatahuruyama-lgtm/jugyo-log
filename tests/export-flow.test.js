import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';
import { gatherLesson, exportLessons } from '../js/export-flow.js';

const ink = { v: 1, h: 400, s: [{ c: 0, w: 0, p: [0, 0, 20, 20] }] };
const material = (type, fileId, order = 0) => ({ type, fileId, kind: 'board', name: '確認用資料', bytes: 10, order });
const attachment = (slot, type, fileId, addedAt = 0) => ({ slot, type, fileId, bytes: 10, addedAt });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 150; i++) await Promise.resolve(); };

function setup() {
  const calls = [], rendered = [], closed = [];
  let active = 0, maximum = 0, serial = 0;
  const read = (name, value) => async (...args) => {
    calls.push([name, ...args]); active++; maximum = Math.max(maximum, active);
    await Promise.resolve(); active--; return typeof value === 'function' ? value(...args) : value;
  };
  const result = (label, value) => { rendered.push([label, value]); return { url: `blob:test${++serial}`, width: 800, height: 400 }; };
  const args = {
    repo: { getRecord: async () => ({ memo: 'メモ', learned: '分かった', question: '', level: 3,
      attachments: [attachment('a1', 'image', 'ownPhoto'), attachment('a2', 'pdf', 'ownPdf', 1)],
      ink: { memo: { fileId: 'memoInk' }, learned: { fileId: 'learnedInk' },
        Abcdef123456: { fileId: 'photoInk', on: 'photo' }, 'Zbcdef123456#p21': { fileId: 'pageInk', on: 'pdf' },
        a1: { fileId: 'ownInk', on: 'ownPhoto' } } }), getReply: async () => ({ text: '先生の返事', seen: true }) },
    files: {
      loadImages: read('images', (_, __, sources) => Object.fromEntries(sources.map((source) => [source.id, source.fileId]))),
      loadFile: read('pdf', (_, __, source) => source.fileId), loadStudentFile: read('student', (file) => file),
      loadInk: read('ink', JSON.stringify(ink)),
    },
    draw: { picture: async (blob, value) => result(blob, value), ink: async (value) => result('handwriting', value),
      openPdf: async (blob) => ({ pageCount: 22, page: async (number, value) => result(`${blob}/${number}`, value), close: () => { closed.push(blob); } }) },
    classId: 'c1', studentId: 'TestStudent',
    lesson: { id: 'l1', date: '2026-01-02', title: '確認用授業', terms: { t1: '光' },
      materials: { Zbcdef123456: material('pdf', 'pdf', 0), Abcdef123456: material('image', 'photo', 1) },
      links: { l1: { title: '確認用リンク', url: 'https://example.com/', order: 0 } } },
    myTerms: { t1: '反射' }, withMaterials: true, budget: { left: 150 }, signal: new AbortController().signal,
  };
  return { args, calls, rendered, closed, maximum: () => maximum };
}

test('全項目の入れ物と順番。ファイルごとに書きこみを読み、GAS は同時に呼ばない', async () => {
  const h = setup();
  const value = await gatherLesson(h.args);
  assert.deepEqual(value.record, { memo: 'メモ', learned: '分かった', question: '', level: 3 });
  assert.deepEqual(value.terms, ['光', '反射']);
  assert.deepEqual(value.links, [{ label: '確認用リンク', url: 'https://example.com/' }]);
  assert.deepEqual(value.reply, { text: '先生の返事', seen: true });
  assert.equal(value.recordProblem, false); assert.equal(value.replyProblem, false);
  assert.deepEqual(value.materials.map((file) => file.id), ['Zbcdef123456', 'Abcdef123456']);
  assert.deepEqual(value.attachments.map((file) => file.label), ['写真 1', 'PDF 1']);
  assert.equal(value.materials[0].pictures.length, 21); assert.equal(value.materials[0].skipped, 1);
  assert.equal(value.attachments[1].pictures.length, 20); assert.equal(value.attachments[1].skipped, 2);
  assert.equal(value.inks.memo.page, null); assert.equal(value.inks.question, null);
  assert.equal(h.args.budget.left, 105);
  assert.deepEqual(h.calls.map(([name]) => name), ['images', 'ink', 'pdf', 'ink', 'student', 'ink', 'student', 'ink', 'ink']);
  assert.equal(h.maximum(), 1);
  assert.deepEqual(h.closed, ['pdf', 'ownPdf']);
  assert.deepEqual(h.rendered.find(([name]) => name === 'pdf/21')[1], ink);
});

test('3 つの PDF は同時に 1 つだけ開き、閉じ終わるまで次のファイルを読まない', async () => {
  const h = setup(), events = [], gate = deferred(), closing = deferred();
  let active = 0, maximum = 0;
  h.args.lesson.materials = {
    Abcdef123456: material('pdf', 'secondPdf', 1), Zbcdef123456: material('pdf', 'firstPdf', 0),
  };
  h.args.repo.getRecord = async () => ({ attachments: [attachment('a2', 'pdf', 'ownPdf')],
    ink: { 'Zbcdef123456#p2': { fileId: 'secondInk', on: 'firstPdf' },
      'Zbcdef123456#p1': { fileId: 'firstInk', on: 'firstPdf' },
      'Abcdef123456#p1': { fileId: 'materialInk', on: 'secondPdf' },
      'a2#p2': { fileId: 'ownInk', on: 'ownPdf' } } });
  const loadFile = h.args.files.loadFile, loadStudentFile = h.args.files.loadStudentFile, loadInk = h.args.files.loadInk;
  h.args.files.loadFile = (...args) => { events.push(`read:${args[2].fileId}`); return loadFile(...args); };
  h.args.files.loadStudentFile = (id) => { events.push(`read:${id}`); return loadStudentFile(id); };
  h.args.files.loadInk = (id) => { events.push(`ink:${id}`); return loadInk(id); };
  const open = h.args.draw.openPdf;
  h.args.draw.openPdf = async (blob) => {
    events.push(`open:${blob}`); active++; maximum = Math.max(maximum, active);
    const pdf = await open(blob);
    return { pageCount: 2,
      page: (number, ink) => { events.push(`page:${blob}/${number}`); return pdf.page(number, ink); },
      close: async () => {
        events.push(`closing:${blob}`);
        if (blob === 'firstPdf') { closing.resolve(); await gate.promise; }
        await pdf.close(); active--; events.push(`closed:${blob}`);
      } };
  };
  const pending = gatherLesson(h.args);
  await closing.promise; await settle();
  assert.equal(active, 1);
  assert.deepEqual(events, ['read:firstPdf', 'open:firstPdf', 'ink:firstInk', 'page:firstPdf/1',
    'ink:secondInk', 'page:firstPdf/2', 'closing:firstPdf']);
  gate.resolve();
  const value = await pending;
  assert.equal(maximum, 1); assert.equal(active, 0); assert.equal(h.maximum(), 1);
  assert.deepEqual(events, ['read:firstPdf', 'open:firstPdf', 'ink:firstInk', 'page:firstPdf/1',
    'ink:secondInk', 'page:firstPdf/2', 'closing:firstPdf', 'closed:firstPdf',
    'read:secondPdf', 'open:secondPdf', 'ink:materialInk', 'page:secondPdf/1', 'page:secondPdf/2', 'closing:secondPdf', 'closed:secondPdf',
    'read:ownPdf', 'open:ownPdf', 'page:ownPdf/1', 'ink:ownInk', 'page:ownPdf/2', 'closing:ownPdf', 'closed:ownPdf']);
  assert.deepEqual(value.materials.map(({ id }) => id), ['Zbcdef123456', 'Abcdef123456']);
  for (const file of [...value.materials, ...value.attachments]) {
    assert.deepEqual(file.pictures.map(({ page }) => page), [1, 2]); assert.equal(file.problem, null);
  }
  assert.deepEqual(h.closed, ['firstPdf', 'secondPdf', 'ownPdf']);
});

test('写真は 1 枚ずつ書きこみと描画を済ませてから次へ進む', async () => {
  const h = setup(), events = [], gate = deferred(), started = deferred();
  h.args.lesson.materials = {
    Zbcdef123456: material('image', 'secondPhoto', 1), Abcdef123456: material('image', 'firstPhoto', 0),
  };
  h.args.repo.getRecord = async () => ({
    attachments: [attachment('a1', 'image', 'secondOwn', 1), attachment('a2', 'image', 'firstOwn', 0)],
    ink: { Abcdef123456: { fileId: 'firstInk', on: 'firstPhoto' }, Zbcdef123456: { fileId: 'secondInk', on: 'secondPhoto' },
      a2: { fileId: 'firstOwnInk', on: 'firstOwn' }, a1: { fileId: 'secondOwnInk', on: 'secondOwn' } },
  });
  const loadInk = h.args.files.loadInk, loadStudentFile = h.args.files.loadStudentFile, picture = h.args.draw.picture;
  h.args.files.loadInk = (id) => { events.push(`ink:${id}`); return loadInk(id); };
  h.args.files.loadStudentFile = (id) => { events.push(`read:${id}`); return loadStudentFile(id); };
  h.args.draw.picture = async (blob, ink) => {
    events.push(`draw:${blob}`);
    if (blob === 'firstPhoto') { started.resolve(); await gate.promise; }
    const value = await picture(blob, ink); events.push(`done:${blob}`); return value;
  };
  const pending = gatherLesson(h.args);
  await started.promise; await settle();
  assert.deepEqual(events, ['ink:firstInk', 'draw:firstPhoto']);
  gate.resolve();
  const value = await pending;
  assert.deepEqual(events, ['ink:firstInk', 'draw:firstPhoto', 'done:firstPhoto', 'ink:secondInk', 'draw:secondPhoto', 'done:secondPhoto',
    'read:firstOwn', 'ink:firstOwnInk', 'draw:firstOwn', 'done:firstOwn', 'read:secondOwn', 'ink:secondOwnInk', 'draw:secondOwn', 'done:secondOwn']);
  assert.deepEqual(value.materials.map(({ id }) => id), ['Abcdef123456', 'Zbcdef123456']);
  assert.deepEqual(value.attachments.map(({ slot }) => slot), ['a2', 'a1']);
  assert.equal(h.maximum(), 1); assert.equal(h.args.budget.left, 146);
});

for (const method of ['getRecord', 'getReply']) {
  test(`${method} が失敗しても資料と他の情報を出す`, async () => {
    const h = setup(); h.args.repo[method] = async () => { throw new Error('確認用'); };
    const value = await gatherLesson(h.args);
    assert.equal(value[method === 'getRecord' ? 'recordProblem' : 'replyProblem'], true);
    assert.equal(value.materials[0].pictures.length, 20 + Number(method === 'getReply'));
    assert.ok(method === 'getRecord' ? value.reply : value.record);
  });
}

test('写真 1 枚の欠落、壊れた PDF、手書きと書きこみの失敗をそれぞれ残す', async () => {
  const h = setup();
  h.args.lesson.materials.Mbcdef123456 = material('image', 'missing', 2);
  h.args.files.loadImages = async () => ({ Abcdef123456: 'photo' });
  const open = h.args.draw.openPdf;
  h.args.draw.openPdf = async (blob) => { if (blob === 'pdf') throw new Error('確認用'); return open(blob); };
  h.args.files.loadInk = async (id) => ['memoInk', 'photoInk'].includes(id) ? 'broken' : JSON.stringify(ink);
  const value = await gatherLesson(h.args);
  assert.equal(value.materials[0].problem, 'pdf');
  assert.equal(value.materials[1].pictures[0].problem, 'ink'); assert.ok(value.materials[1].pictures[0].url);
  assert.equal(value.materials[2].problem, 'image');
  assert.deepEqual(value.inks.memo, { url: null, problem: 'ink' });
  assert.ok(value.inks.learned.url); assert.ok(value.attachments[0].pictures[0].url);
  assert.deepEqual(h.closed, ['ownPdf']);
});

test('0 ページの PDF も閉じ、次の添付を出す', async () => {
  const h = setup(), open = h.args.draw.openPdf;
  h.args.draw.openPdf = async (blob) => ({ ...await open(blob), ...(blob === 'pdf' ? { pageCount: 0 } : {}) });
  const value = await gatherLesson(h.args);
  assert.equal(value.materials[0].problem, 'pdf'); assert.deepEqual(value.materials[0].pictures, []);
  assert.equal(value.attachments[1].pictures.length, 20); assert.ok(value.inks.memo.url);
  assert.deepEqual(h.closed, ['pdf', 'ownPdf']);
});

test('写真と PDF の書きこみを重ねられないときは元の絵を残し、枠は 1 枚だけ使う', async () => {
  const h = setup(), get = h.args.repo.getRecord, picture = h.args.draw.picture, open = h.args.draw.openPdf;
  h.args.repo.getRecord = async () => { const record = await get(); record.ink['a2#p1'] = { fileId: 'ownPageInk', on: 'ownPdf' }; return record; };
  h.args.draw.picture = (blob, ink) => { if (ink) throw new Error('確認用'); return picture(blob, ink); };
  h.args.draw.openPdf = async (blob) => {
    const pdf = await open(blob), page = pdf.page;
    pdf.page = (number, ink) => { if (ink) throw new Error('確認用'); return page(number, ink); };
    return pdf;
  };
  const value = await gatherLesson(h.args);
  for (const file of [...value.materials, ...value.attachments]) {
    const picture = file.pictures.find(({ problem }) => problem === 'ink');
    assert.ok(picture.url); assert.equal(file.problem, null);
  }
  assert.equal(h.args.budget.left, 105); assert.equal(h.rendered.length, 45);
  assert.deepEqual(h.closed, ['pdf', 'ownPdf']);
});

test('描けない写真、PDF の一部ページでも残りを止めず PDF を閉じる', async () => {
  const h = setup();
  const picture = h.args.draw.picture;
  h.args.draw.picture = async (blob, ink) => { if (blob === 'photo') throw new Error('確認用'); return picture(blob, ink); };
  const open = h.args.draw.openPdf;
  h.args.draw.openPdf = async (blob) => { const pdf = await open(blob); const page = pdf.page;
    pdf.page = async (number, ink) => { if (number === 2) throw new Error('確認用'); return page(number, ink); }; return pdf; };
  const value = await gatherLesson(h.args);
  assert.equal(value.materials[1].problem, 'image');
  assert.equal(value.materials[0].problem, 'pdf'); assert.equal(value.materials[0].pictures.length, 20);
  assert.deepEqual(value.materials[0].pictures.map(({ page }) => page), [1, ...Array.from({ length: 19 }, (_, i) => i + 3)]);
  assert.equal(value.attachments[1].problem, 'pdf'); assert.equal(value.attachments[1].pictures.length, 19);
  assert.equal(h.args.budget.left, 108);
  assert.ok(value.inks.memo.url); assert.equal(h.closed.length, 2);
});

test('on がちがう古い書きこみは読みこまない。20 と 21 ページの境目', async () => {
  const h = setup(), get = h.args.repo.getRecord;
  h.args.repo.getRecord = async () => { const record = await get(); record.ink.Abcdef123456.on = 'old';
    record.ink['Zbcdef123456#p21'].on = 'old'; return record; };
  const value = await gatherLesson(h.args);
  assert.equal(value.materials[0].pictures.length, 20); assert.equal(value.materials[0].skipped, 2);
  assert.equal(h.rendered.find(([name]) => name === 'photo')[1], null);
  assert.ok(!h.calls.some(([name, id]) => name === 'ink' && ['photoInk', 'pageInk'].includes(id)));
  for (const count of [20, 21]) {
    const h2 = setup(), open = h2.args.draw.openPdf;
    h2.args.draw.openPdf = async (blob) => ({ ...await open(blob), pageCount: count });
    const result = await gatherLesson(h2.args);
    assert.equal(result.materials[0].pictures.length, count); assert.equal(result.materials[0].skipped, 0);
  }
});

for (const left of [0, 1, 2]) {
  test(`絵の枠が ${left} 枚なら以降のファイルも手書きも読まない`, async () => {
    const h = setup(); h.args.budget.left = left;
    const value = await gatherLesson(h.args);
    assert.equal(h.args.budget.left, 0);
    assert.equal(h.rendered.length, left);
    assert.equal(value.inks.memo.problem, 'budget');
    assert.equal(value.attachments[0].pictures[0].problem, 'budget');
    assert.ok(!h.calls.some(([name]) => name === 'student'));
    if (!left) assert.deepEqual(h.calls, []);
    if (left === 1) assert.ok(!h.calls.some(([name]) => name === 'pdf'));
  });
}

for (const withMaterials of [true, false]) {
  test(`${withMaterials ? '資料' : '添付'}の PDF の途中で上限になったら省略は 1 つにし、次のファイルは読まない`, async () => {
    const h = setup(), open = h.args.draw.openPdf;
    h.args.withMaterials = withMaterials; h.args.budget.left = 4;
    h.args.lesson.materials = { Zbcdef123456: material('pdf', 'pdf'), Abcdef123456: material('pdf', 'nextPdf', 1) };
    h.args.repo.getRecord = async () => ({
      attachments: [attachment('a1', 'pdf', 'ownPdf'), attachment('a2', 'image', 'ownPhoto', 1), attachment('a3', 'pdf', 'nextOwnPdf', 2)],
      ink: { 'Zbcdef123456#p5': { fileId: 'pageInk', on: 'pdf' }, 'a1#p5': { fileId: 'ownInk', on: 'ownPdf' } },
    });
    h.args.draw.openPdf = async (blob) => ({ ...await open(blob), pageCount: 8 });
    const value = await gatherLesson(h.args);
    const [first, ...remaining] = [...(value.materials ?? []), ...value.attachments];
    assert.deepEqual(first.pictures.map(({ page }) => page), [1, 2, 3, 4, 5]);
    assert.equal(first.pictures.filter(({ url }) => url).length, 4);
    assert.deepEqual(first.pictures.filter(({ problem }) => problem === 'budget'), [{ url: null, page: 5, problem: 'budget' }]);
    for (const file of remaining) assert.deepEqual(file.pictures, [{ url: null, page: null, problem: 'budget' }]);
    assert.equal(h.args.budget.left, 0); assert.equal(h.rendered.length, 4);
    assert.deepEqual(h.calls.map(([name]) => name), [withMaterials ? 'pdf' : 'student']);
    assert.deepEqual(h.closed, [withMaterials ? 'pdf' : 'ownPdf']);
  });
}

test('失敗した PDF のページは枠を使わず、残りの枠で後のページを作る', async () => {
  const h = setup(), open = h.args.draw.openPdf;
  h.args.budget.left = 3; h.args.repo.getRecord = async () => null;
  h.args.lesson.materials = { Zbcdef123456: material('pdf', 'pdf') };
  h.args.draw.openPdf = async (blob) => {
    const pdf = await open(blob), page = pdf.page;
    return { ...pdf, pageCount: 5, page: (number, ink) => { if (number === 2) throw new Error('確認用'); return page(number, ink); } };
  };
  const value = await gatherLesson(h.args);
  assert.equal(value.materials[0].problem, 'pdf');
  assert.deepEqual(value.materials[0].pictures.map(({ page }) => page), [1, 3, 4, 5]);
  assert.deepEqual(value.materials[0].pictures[3], { url: null, page: 5, problem: 'budget' });
  assert.equal(h.args.budget.left, 0); assert.equal(h.rendered.length, 3);
  assert.deepEqual(h.closed, ['pdf']);
});

test('先生の資料なしではリンクも含めず、先生のファイルを読まない', async () => {
  const h = setup(); h.args.withMaterials = false;
  const value = await gatherLesson(h.args);
  assert.equal(value.materials, null); assert.equal(value.links, null);
  assert.ok(!h.calls.some(([name]) => ['images', 'pdf'].includes(name)));
  assert.ok(value.attachments[0].pictures[0].url);
});

test('授業をまたいで 150 枚の上限を共有し、上限後の授業の PDF は読まない', async () => {
  const h = setup();
  h.args.repo.getRecord = async () => null;
  const lessons = Array.from({ length: 9 }, (_, i) => ({ ...h.args.lesson, id: `l${i}`,
    materials: { Zbcdef123456: material('pdf', 'pdf') } }));
  const values = await exportLessons({ ...h.args, lessons });
  assert.equal(h.rendered.length, 150); assert.equal(h.args.budget.left, 0);
  assert.equal(h.calls.filter(([name]) => name === 'pdf').length, 8);
  assert.deepEqual(values[7].materials[0].pictures.filter((picture) => picture.problem === 'budget'),
    [{ url: null, page: 11, problem: 'budget' }]);
  assert.deepEqual(values[8].materials[0].pictures, [{ url: null, page: null, problem: 'budget' }]);
  assert.equal(h.closed.length, 8);
});

test('不正な記録を正規化し、不正な資料・添付・リンクは除く。記録なしも区別する', async () => {
  const h = setup();
  h.args.repo.getRecord = async () => ({ memo: '<b>' + 'あ'.repeat(3000), learned: 123, question: null, level: 99,
    attachments: [attachment('a1', 'image', 'valid'), attachment('a9', 'image', 'invalid'), { slot: 'a2' }] });
  h.args.lesson.materials.invalid = {};
  h.args.lesson.links.invalid = { url: 'javascript:alert(1)', title: '不正', order: 1 };
  const value = await gatherLesson(h.args);
  assert.equal(value.record.memo.length, CONFIG.recordTextMax); assert.equal(value.record.learned, '');
  assert.equal(value.record.level, null); assert.equal(value.attachments.length, 1);
  assert.equal(value.materials.length, 2); assert.equal(value.links.length, 1);
  h.args.repo.getRecord = async () => null; h.args.repo.getReply = async () => null;
  const empty = await gatherLesson(h.args);
  assert.equal(empty.record, null); assert.equal(empty.recordProblem, false); assert.equal(empty.reply, null);
});

test('中止ですぐ AbortError。開いた PDF は閉じ、後の通信は行わない', async () => {
  const h = setup(), gate = deferred(), started = deferred(), controller = new AbortController();
  h.args.signal = controller.signal; h.args.files.loadStudentFile = () => { started.resolve(); return gate.promise; };
  const pending = gatherLesson(h.args);
  await started.promise; controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual(h.closed, ['pdf']);
  gate.resolve('late'); await settle();
  assert.deepEqual(h.calls.filter(([name]) => name === 'ink').map(([, id]) => id), ['photoInk', 'pageInk']);
  assert.ok(!h.rendered.some(([name]) => name === 'late'));
});

test('中止のあとに開いた PDF も閉じる', async () => {
  const h = setup(), gate = deferred(), controller = new AbortController();
  h.args.signal = controller.signal; h.args.draw.openPdf = () => gate.promise;
  const pending = gatherLesson(h.args);
  await settle(); controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  gate.resolve({ close: () => h.closed.push('late') }); await settle();
  assert.deepEqual(h.closed, ['late']);
});

for (const stage of ['page', 'close']) {
  test(`PDF の ${stage} を待っている間もすぐ中止し、開いている PDF を閉じる`, async () => {
    const h = setup(), gate = deferred(), started = deferred(), controller = new AbortController();
    h.args.signal = controller.signal;
    const open = h.args.draw.openPdf;
    h.args.draw.openPdf = async (blob) => {
      const pdf = await open(blob);
      if (stage === 'page') {
        const page = pdf.page;
        pdf.page = (number, ink) => {
          if (number === 2) { started.resolve(); return gate.promise; }
          return page(number, ink);
        };
      } else pdf.close = () => { h.closed.push(blob); started.resolve(); return gate.promise; };
      return pdf;
    };
    const pending = gatherLesson(h.args);
    await started.promise;
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.deepEqual(h.closed, ['pdf']);
    if (stage === 'page') assert.deepEqual(h.rendered.map(([name]) => name), ['photo', 'pdf/1']);
    gate.resolve({ url: 'blob:late', width: 1, height: 1 }); await settle();
    assert.ok(!h.calls.some(([name]) => name === 'student'));
    assert.deepEqual(h.closed, ['pdf']);
  });
}

test('作り直しても中止した GAS と重ならず、授業も順に読んで進み具合を返す', async () => {
  const h = setup(), gate = deferred(), controller = new AbortController();
  h.args.signal = controller.signal;
  let reads = 0;
  h.args.files.loadImages = async () => { reads++; return gate.promise; };
  const pending = gatherLesson(h.args);
  await settle(); controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
  const next = gatherLesson({ ...h.args, signal: new AbortController().signal });
  await settle(); assert.equal(reads, 1);
  gate.resolve({ Abcdef123456: 'photo' }); await next;
  assert.equal(reads, 2);
  const order = [], progress = [];
  h.args.repo.getRecord = async (_, id) => { order.push(id); return null; };
  const values = await exportLessons({ ...h.args, signal: undefined, withMaterials: false,
    lessons: [{ id: 'first', terms: {} }, { id: 'second', terms: {} }], myTerms: { second: { t1: '自分の用語' } },
    onProgress: (...args) => progress.push(args) });
  assert.deepEqual(order, ['first', 'second']); assert.deepEqual(progress, [[0, 2], [1, 2], [2, 2]]);
  assert.deepEqual(values[1].terms, ['自分の用語']);
  await assert.rejects(exportLessons({ ...h.args, lessons: [] }), { name: 'AbortError' });
});
