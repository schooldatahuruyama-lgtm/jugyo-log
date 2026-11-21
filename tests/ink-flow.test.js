import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { saveInkFlow, loadInkFlow, inkLoadReason, resendInkDrafts } from '../js/ink-flow.js';
import { emptyInk, isEmptyInk, serializeInk, serverInkTime } from '../js/ink-logic.js';
import { createInkSaver } from '../js/ink-saver.js';
import { CONFIG } from '../js/config.js';
import { normalizeRecord } from '../js/record-logic.js';
import { createRepo } from '../js/repo.js';
import { createMemoryNet } from '../js/dev/memory-net.js';
import { createRecordQueue } from '../js/record-queue.js';
import { NetError } from '../js/errors.js';
import { createDemoGas } from '../js/dev/demo-gas.js';
import { createFiles } from '../js/files.js';

const ink = { v: 1, h: 400, s: [{ c: 0, w: 0, p: [0, 0, 10, 10] }] };
function setup(record = { ink: { memo: { fileId: 'old', updatedAt: 10 } } }) {
  const calls = [];
  const repo = {
    async getRecord(...args) { calls.push(['get', ...args]); return record; },
    async setInk(...args) { calls.push(['set', ...args]); },
    async removeInk(...args) { calls.push(['remove', ...args]); },
  };
  const files = {
    async uploadInk(args) { calls.push(['upload', args]); return { fileId: 'new', bytes: 42 }; },
    async trashStudent(id) { calls.push(['trash', id]); },
  };
  return { calls, repo, files, classId: 'c1', lessonId: 'l1', studentId: 's26-001', field: 'memo',
    ink, key: 'ink-test-1', thumb: 'data:image/png;base64,AQID', editedAt: 20 };
}

function pictureSetup(field = 'a1', photo = { type: 'image', fileId: 'photo' }) {
  const record = { attachments: photo ? [{ slot: field, ...photo }] : [],
    ink: { [field]: { fileId: 'old', updatedAt: 10, on: 'previous-photo' } } };
  const s = setup(record);
  s.repo.getLesson = async () => { s.calls.push(['lesson']); return { materials: photo ? { [field]: photo } : {} }; };
  return { ...s, field, on: 'photo', ink: { ...ink, k: 'pic', h: 601 }, record };
}

function pageSetup(place = 'a1', pdf = { type: 'pdf', fileId: 'photo' }) {
  const s = pictureSetup(place, pdf);
  s.field = `${place}#p999`;
  s.record.ink = { [s.field]: s.record.ink[place] };
  return s;
}

test('PDF の保存: 元の添付・資料を確認し、ページの目録を保存・全消去する', async () => {
  for (const place of ['a1', 'Abc123Def456']) {
    for (const clear of [false, true]) {
      const s = pageSetup(place);
      if (clear) s.ink = { ...s.ink, s: [] };
      const result = await saveInkFlow(s);
      assert.equal(result.superseded, false);
      assert.deepEqual(s.calls.filter(([name]) => name === 'trash'), [['trash', 'old']]);
      const call = s.calls.find(([name]) => name === (clear ? 'remove' : 'set'));
      assert.equal(call[4], `${place}#p999`);
      if (clear) assert.equal(result.index, null);
      else {
        assert.equal(call[5].on, 'photo');
        assert.deepEqual(JSON.parse(s.calls.find(([name]) => name === 'upload')[1].text), s.ink);
      }
    }
  }
});

test('PDF の保存: 消失・別 PDF・写真は gone。同じ時刻以降の目録・削除時刻はサーバーを残す', async () => {
  for (const place of ['a1', 'Abc123Def456']) {
    for (const pdf of [null, { type: 'image', fileId: 'photo' }, { type: 'pdf', fileId: 'other' }]) {
      const s = pageSetup(place, pdf);
      assert.deepEqual(await saveInkFlow(s), { index: null, superseded: true, gone: true, record: s.record });
      assert.equal(s.calls.some(([name]) => ['upload', 'set', 'remove'].includes(name)), false);
    }
    for (const time of [20, 30]) {
      for (const clear of [false, true]) {
        const s = pageSetup(place);
        if (clear) { s.record.ink = {}; s.record.inkCleared = { [s.field]: time }; }
        else Object.assign(s.record.ink[s.field], { on: s.on, updatedAt: time });
        assert.deepEqual(await saveInkFlow(s), { index: s.record.ink[s.field] ?? null, superseded: true, record: s.record });
        assert.equal(s.calls.some(([name]) => name === 'upload'), false);
      }
    }
  }
});

test('PDF の保存: denied 後に読み直し、消失・入れ替え・競合・応答の消失を区別する', async () => {
  for (const place of ['a1', 'Abc123Def456']) {
    for (const outcome of ['gone', 'image', 'replaced', 'newer', 'saved', 'wrong-on', 'read-failed']) {
      const s = pageSetup(place);
      const index = { fileId: outcome === 'newer' ? 'server' : 'new', bytes: 42, strokes: 1,
        on: outcome === 'wrong-on' ? 'other' : s.on, updatedAt: outcome === 'newer' ? 30 : 20 };
      const pdf = outcome === 'gone' ? null : { type: outcome === 'image' ? 'image' : 'pdf',
        fileId: outcome === 'replaced' ? 'other' : s.on };
      const latest = { attachments: pdf ? [{ slot: place, ...pdf }] : [], ink: { [s.field]: index } };
      if (['gone', 'image', 'replaced'].includes(outcome)) latest.ink = {};
      s.repo.setInk = async () => {
        s.repo.getRecord = async () => { if (outcome === 'read-failed') throw new NetError('network'); return latest; };
        s.repo.getLesson = async () => ({ materials: pdf ? { [place]: pdf } : {} });
        throw new NetError('denied');
      };
      if (outcome === 'read-failed') {
        await assert.rejects(saveInkFlow(s), (e) => e.code === 'network');
        assert.equal(s.calls.some(([name]) => name === 'trash'), false);
        continue;
      }
      const result = await saveInkFlow(s);
      if (['gone', 'image', 'replaced'].includes(outcome)) assert.deepEqual(result, { index: null, superseded: true, gone: true, record: latest });
      else if (outcome === 'saved') assert.deepEqual(result, { index, superseded: false });
      else assert.deepEqual(result, { index: outcome === 'wrong-on' ? null : index, superseded: true, record: latest });
      assert.deepEqual(s.calls.filter(([name]) => name === 'trash'), [['trash', outcome === 'saved' ? 'old' : 'new']]);
    }
  }
});

test('練習モード: PDF の複数ページを代役の GAS と DB に保存し、読み直し・消去できる', async () => {
  const net = createMemoryNet({ initial: { accounts: { 'demo-user': 's26-001' }, memberOf: { 's26-001': { c1: true } },
    lessons: { c1: { l1: { createdAt: 1, materials: { Abc123Def456: { type: 'pdf', fileId: 'material-pdf' } } } } } } });
  const repo = createRepo(net);
  const gas = createDemoGas({ net, getUser: () => ({ uid: 'demo-user' }) });
  const cache = new Map();
  const files = createFiles({ gas, cache: { get: (id) => cache.get(id), put: (id, value) => cache.set(id, value), remove: (id) => cache.delete(id) } });
  await repo.addAttachment('c1', 'l1', 's26-001', 'a1', { type: 'pdf', fileId: 'pdf', bytes: 42 }, null, 1);
  for (const [place, on] of [['a1', 'pdf'], ['Abc123Def456', 'material-pdf']]) {
    for (const page of [1, 999]) {
      const field = `${place}#p${page}`;
      const value = { ...ink, k: 'pic', h: 1131 };
      const args = { repo, files, classId: 'c1', lessonId: 'l1', studentId: 's26-001', field, on,
        ink: value, key: `pdf-${place}-${page}`, editedAt: 20 };
      const saved = await saveInkFlow(args);
      assert.equal(saved.superseded, false);
      assert.deepEqual((await repo.getRecord('c1', 'l1', 's26-001')).ink[field], saved.index);
      assert.deepEqual((await repo.listRecords('c1', 'l1'))['s26-001'].ink[field], saved.index);
      assert.deepEqual(await loadInkFlow({ files, fileId: saved.index.fileId }), value);
      assert.equal((await saveInkFlow(args)).superseded, true);
      await saveInkFlow({ ...args, ink: { ...value, s: [] }, editedAt: 30 });
      assert.equal((await repo.getRecord('c1', 'l1', 's26-001')).inkCleared[field], 30);
    }
  }
});

test('PDF の再送: ページと on を送り、PDF 消失なら捨て、失敗なら下書きを残す', async () => {
  for (const place of ['a1', 'Abc123Def456']) {
    for (const outcome of ['saved', 'gone', 'failed']) {
      const s = resendSetup();
      const page = pageSetup(place, outcome === 'gone' ? null : { type: 'pdf', fileId: 'photo' });
      s.repo = page.repo;
      if (outcome === 'failed') s.repo.setInk = async () => { throw new NetError('network'); };
      s.add('l1', { field: page.field, on: page.on, ink: page.ink });
      s.makeThumb = () => assert.fail('PDF の小さい画像は作らない');
      assert.deepEqual(await resendInkDrafts(s), { sent: outcome === 'saved' ? 1 : 0,
        kept: outcome === 'failed' ? 1 : 0, dropped: outcome === 'gone' ? 1 : 0,
        sentLessons: outcome === 'saved' ? [{ classId: 'c1', lessonId: 'l1' }] : [] });
      assert.equal(s.pending.size, outcome === 'failed' ? 1 : 0);
      if (outcome === 'saved') {
        const set = page.calls.find(([name]) => name === 'set');
        assert.equal(set[4], page.field);
        assert.equal(set[5].on, page.on);
        assert.equal(set[6], undefined);
      }
    }
  }
});

test('写真の保存: 添付と資料に on を渡し、前の写真の書きこみファイルも片付ける', async () => {
  for (const field of ['a1', 'Abc123Def456']) {
    const s = pictureSetup(field);
    const saved = await saveInkFlow(s);
    assert.deepEqual(saved, { index: { fileId: 'new', bytes: 42, strokes: 1, updatedAt: 20, on: 'photo' }, superseded: false });
    assert.deepEqual(s.calls.find((call) => call[0] === 'set')[5], { fileId: 'new', bytes: 42, strokes: 1, on: 'photo' });
    assert.deepEqual(s.calls.at(-1), ['trash', 'old']);
    assert.deepEqual(JSON.parse(s.calls.find((call) => call[0] === 'upload')[1].text), s.ink);
  }
});

test('写真の保存: 写真や資料がない・別の写真・PDF は gone で、空の保存もアップロードしない', async () => {
  for (const field of ['a1', 'Abc123Def456']) {
    for (const photo of [null, { type: 'image', fileId: 'other' }, { type: 'pdf', fileId: 'photo' }]) {
      for (const empty of [false, true]) {
        const s = pictureSetup(field, photo);
        if (empty) s.ink.s = [];
        assert.deepEqual(await saveInkFlow(s), { index: null, superseded: true, gone: true, record: s.record });
        assert.deepEqual(s.calls.map((call) => call[0]), field === 'a1' ? ['get'] : ['get', 'lesson']);
      }
    }
  }
});

test('写真の保存: 不正な場所と on は通信する前に断る', async () => {
  const s = pictureSetup();
  for (const field of [null, 1, '', 'other', 'a7', 'bad/place']) await assert.rejects(saveInkFlow({ ...s, field }), TypeError);
  for (const field of ['a1', 'Abc123Def456']) {
    for (const on of [null, undefined, 1, {}, []]) await assert.rejects(saveInkFlow({ ...s, field, on }), TypeError);
  }
  assert.deepEqual(s.calls, []);
});

test('写真の保存: 同じ・新しい時刻はサーバーを残すが、別の写真の目録は返さない', async () => {
  for (const field of ['a1', 'Abc123Def456']) {
    for (const time of [20, 30]) {
      for (const on of ['photo', 'previous-photo']) {
        const s = pictureSetup(field);
        Object.assign(s.record.ink[field], { updatedAt: time, on });
        assert.deepEqual(await saveInkFlow(s), { index: on === 'photo' ? s.record.ink[field] : null, superseded: true, record: s.record });
        assert.equal(s.calls.some((call) => call[0] === 'upload'), false);
      }
    }
  }
});

test('写真の保存: denied 後に写真の消去・入れ替え・PDF 化が分かれば gone で今回のファイルを片付ける', async () => {
  for (const field of ['a1', 'Abc123Def456']) {
    for (const photo of [null, { type: 'image', fileId: 'replaced' }, { type: 'pdf', fileId: 'photo' }]) {
      const s = pictureSetup(field);
      const latest = { attachments: photo ? [{ slot: field, ...photo }] : [], ink: s.record.ink };
      s.repo.setInk = async () => {
        s.repo.getRecord = async () => latest;
        s.repo.getLesson = async () => ({ materials: photo ? { [field]: photo } : {} });
        throw new NetError('denied');
      };
      assert.deepEqual(await saveInkFlow(s), { index: null, superseded: true, gone: true, record: latest });
      assert.deepEqual(s.calls.at(-1), ['trash', 'new']);
      assert.equal(s.calls.some((call) => call[0] === 'trash' && call[1] === 'old'), false);
    }
  }
});

test('写真の保存: denied 後の成功判定は on も比較し、別の写真の目録は返さない', async () => {
  for (const field of ['a1', 'Abc123Def456']) {
    for (const on of ['photo', 'previous-photo']) {
      const s = pictureSetup(field);
      const index = { fileId: 'new', bytes: 42, strokes: 1, updatedAt: 20, on };
      const latest = { ...s.record, ink: { [field]: index } };
      s.repo.setInk = async () => { s.repo.getRecord = async () => latest; throw new NetError('denied'); };
      const result = await saveInkFlow(s);
      assert.deepEqual(result, on === 'photo' ? { index, superseded: false } : { index: null, superseded: true, record: latest });
      assert.deepEqual(s.calls.filter((call) => call[0] === 'trash'), [['trash', on === 'photo' ? 'old' : 'new']]);
    }
  }
});

test('写真の保存: アップロード中に写真・資料が消え、新しい消去時刻があっても gone にする', async () => {
  for (const field of ['a1', 'Abc123Def456']) {
    for (const time of [20, 30]) {
      const s = pictureSetup(field);
      const latest = { attachments: [], ink: {}, inkCleared: { [field]: time } };
      const upload = s.files.uploadInk;
      s.files.uploadInk = async (args) => {
        const uploaded = await upload(args);
        s.repo.getRecord = async () => latest;
        s.repo.getLesson = async () => ({ materials: {} });
        return uploaded;
      };
      let denied = false;
      s.repo.setInk = async () => { denied = true; throw new NetError('denied'); };
      assert.deepEqual(await saveInkFlow(s), { index: null, superseded: true, gone: true, record: latest });
      assert.equal(denied, true);
      assert.deepEqual(s.calls.filter((call) => call[0] === 'trash'), [['trash', 'new']]);
    }
  }
});

test('練習モード: 写真の手書きを代役の GAS とデータベースへ保存して読み直せる', async () => {
  const net = createMemoryNet();
  await net.set('accounts/demo-user', 's26-001');
  await net.set('memberOf/s26-001/c1', true);
  await net.set('lessons/c1/l1', { createdAt: 1, materials: { Abc123Def456: { type: 'image', fileId: 'material-photo' } } });
  const repo = createRepo(net);
  const gas = createDemoGas({ net, getUser: () => ({ uid: 'demo-user' }) });
  const cached = new Map();
  const files = createFiles({ gas, cache: { get: (id) => cached.get(id), put: (id, value) => cached.set(id, value), remove: (id) => cached.delete(id) } });
  await repo.addAttachment('c1', 'l1', 's26-001', 'a1', { type: 'image', fileId: 'photo', bytes: 42 }, null, 1);
  for (const [field, on] of [['a1', 'photo'], ['Abc123Def456', 'material-photo']]) {
    const value = { ...ink, k: 'pic', h: 601 };
    const saved = await saveInkFlow({ repo, files, classId: 'c1', lessonId: 'l1', studentId: 's26-001',
      field, on, ink: value, key: `picture-${field}`, editedAt: 20 });
    assert.equal(saved.superseded, false);
    assert.deepEqual((await repo.getRecord('c1', 'l1', 's26-001')).ink[field], saved.index);
    assert.deepEqual(await loadInkFlow({ files, fileId: saved.index.fileId }), value);
  }
});

test('手書き保存: アップロード → 目録と画像 → 古いファイルの順', async () => {
  const s = setup();
  assert.deepEqual(await saveInkFlow(s), { index: { fileId: 'new', bytes: 42, strokes: 1, updatedAt: 20 }, superseded: false });
  assert.deepEqual(s.calls, [
    ['get', 'c1', 'l1', 's26-001'],
    ['upload', { key: s.key, classId: 'c1', lessonId: 'l1', text: serializeInk(ink) }],
    ['set', 'c1', 'l1', 's26-001', 'memo', { fileId: 'new', bytes: 42, strokes: 1 }, s.thumb, 20],
    ['trash', 'old'],
  ]);
});

test('手書き保存: 空なら目録・画像の削除が済んでから片付ける。もともと無くても成功', async () => {
  for (const previous of [null, { fileId: 'old' }]) {
    const s = setup({ ink: { memo: previous } });
    assert.deepEqual(await saveInkFlow({ ...s, ink: emptyInk() }), { index: null, superseded: false });
    assert.deepEqual(s.calls, [['get', 'c1', 'l1', 's26-001'],
      ['remove', 'c1', 'l1', 's26-001', 'memo', 20], ...(previous ? [['trash', 'old']] : [])]);
  }
});

test('手書き保存: denied のときだけ上げたファイルを片付け、元のエラーを返す', async () => {
  for (const code of ['denied', 'network']) {
    const s = setup();
    const error = new NetError(code);
    s.repo.setInk = async () => { s.calls.push(['set']); throw error; };
    s.files.trashStudent = async (id) => { s.calls.push(['trash', id]); throw new NetError('network'); };
    await assert.rejects(saveInkFlow(s), (e) => e === error);
    assert.deepEqual(s.calls.map((c) => c[0]), code === 'denied' ? ['get', 'upload', 'set', 'get', 'trash'] : ['get', 'upload', 'set']);
    if (code === 'denied') assert.equal(s.calls[4][1], 'new');
  }
});

// B の保存は実際に記録し、A の書きこみだけ規則に断られる順番を作る。
async function raceSetup() {
  const s = setup();
  const server = createRepo(createMemoryNet());
  await server.setInk(s.classId, s.lessonId, s.studentId, s.field,
    { fileId: 'old', bytes: 42, strokes: 1 }, null, 10);
  s.repo = {
    async getRecord(...args) { s.calls.push(['get', ...args]); return server.getRecord(...args); },
    async setInk(...args) { s.calls.push(['set', ...args]); throw new NetError('denied'); },
    async removeInk(...args) { s.calls.push(['remove', ...args]); throw new NetError('denied'); },
  };
  return { ...s, server };
}

test('手書き保存: A のアップロード中に B が保存・全消去すると、拒否後に B を残し A のファイルを片付ける', async () => {
  for (const clear of [false, true]) {
    for (const time of [20, 30]) {
      for (const failTrash of [false, true]) {
        const s = await raceSetup();
        let latest;
        const upload = s.files.uploadInk;
        s.files.uploadInk = async (args) => {
          const uploaded = await upload(args);
          if (clear) await s.server.removeInk(s.classId, s.lessonId, s.studentId, s.field, time);
          else await s.server.setInk(s.classId, s.lessonId, s.studentId, s.field,
            { fileId: 'device-b', bytes: 43, strokes: 1 }, null, time);
          latest = await s.server.getRecord(s.classId, s.lessonId, s.studentId);
          return uploaded;
        };
        if (failTrash) s.files.trashStudent = async (id) => { s.calls.push(['trash', id]); throw new NetError('network'); };
        const saved = await saveInkFlow(s);
        assert.deepEqual(saved, { index: latest.ink.memo ?? null, superseded: true, record: latest });
        assert.deepEqual(await s.server.getRecord(s.classId, s.lessonId, s.studentId), latest);
        if (clear) assert.equal(latest.inkCleared.memo, time);
        assert.deepEqual(s.calls.map((c) => c[0]), ['get', 'upload', 'set', 'get', 'trash']);
        assert.deepEqual(s.calls.at(-1), ['trash', 'new']);
      }
    }
  }
});

test('手書き保存: A の古い全消去が B の新しい保存の後に届いても B の目録を残す', async () => {
  const s = await raceSetup();
  const remove = s.repo.removeInk;
  let latest;
  s.repo.removeInk = async (...args) => {
    await s.server.setInk(s.classId, s.lessonId, s.studentId, s.field,
      { fileId: 'device-b', bytes: 43, strokes: 1 }, null, 30);
    latest = await s.server.getRecord(s.classId, s.lessonId, s.studentId);
    return remove(...args);
  };
  assert.deepEqual(await saveInkFlow({ ...s, ink: emptyInk() }), { index: latest.ink.memo, superseded: true, record: latest });
  assert.deepEqual(await s.server.getRecord(s.classId, s.lessonId, s.studentId), latest);
  assert.deepEqual(s.calls.map((c) => c[0]), ['get', 'remove', 'get']);
});

test('手書き保存: 拒否後の読み直しで同じファイル・時刻の保存が届いていれば成功。全消去も同じ', async () => {
  for (const clear of [false, true]) {
    const s = await raceSetup();
    if (clear) {
      const remove = s.repo.removeInk;
      s.repo.removeInk = async (...args) => { await s.server.removeInk(...args); return remove(...args); };
    } else {
      const set = s.repo.setInk;
      s.repo.setInk = async (...args) => { await s.server.setInk(...args); return set(...args); };
    }
    const index = clear ? null : { fileId: 'new', bytes: 42, strokes: 1, updatedAt: 20 };
    assert.deepEqual(await saveInkFlow({ ...s, ink: clear ? emptyInk() : ink }), { index, superseded: false });
    const latest = await s.server.getRecord(s.classId, s.lessonId, s.studentId);
    assert.deepEqual(latest.ink.memo ?? null, index);
    if (clear) assert.equal(latest.inkCleared.memo, 20);
    assert.deepEqual(s.calls.map((c) => c[0]), clear
      ? ['get', 'remove', 'get', 'trash'] : ['get', 'upload', 'set', 'get', 'trash']);
    assert.deepEqual(s.calls.at(-1), ['trash', 'old']);
  }
});

test('手書き保存: 同じファイルでも時刻が違えば、自分の保存の成功とはしない', async () => {
  const s = await raceSetup();
  s.files.uploadInk = async () => {
    await s.server.setInk(s.classId, s.lessonId, s.studentId, s.field,
      { fileId: 'new', bytes: 42, strokes: 1 }, null, 10);
    return { fileId: 'new', bytes: 42 };
  };
  await assert.rejects(saveInkFlow(s), (e) => e.code === 'denied');
  assert.deepEqual(s.calls.at(-1), ['trash', 'new']);
});

test('手書き保存: 全消去が本当に拒否されたら元のエラーを返し、前のファイルは残す', async () => {
  const s = setup();
  const error = new NetError('denied');
  s.repo.removeInk = async () => { s.calls.push(['remove']); throw error; };
  await assert.rejects(saveInkFlow({ ...s, ink: emptyInk() }), (e) => e === error);
  assert.deepEqual(s.calls.map((c) => c[0]), ['get', 'remove', 'get']);
});

test('手書き保存: 拒否後の読み直しに失敗したらそのエラーを返し、アップロード済みファイルを残す', async () => {
  for (const value of [ink, emptyInk()]) {
    const s = await raceSetup();
    const get = s.repo.getRecord;
    const error = new NetError('network');
    let reads = 0;
    s.repo.getRecord = async (...args) => {
      if (++reads === 1) return get(...args);
      s.calls.push(['get', ...args]);
      throw error;
    };
    await assert.rejects(saveInkFlow({ ...s, ink: value }), (e) => e === error);
    assert.deepEqual(s.calls.map((c) => c[0]), value === ink
      ? ['get', 'upload', 'set', 'get'] : ['get', 'remove', 'get']);
  }
});

test('手書き保存: 古いファイルの片付け失敗は無視し、同じ fileId は片付けない', async () => {
  for (const value of [ink, emptyInk()]) {
    const s = setup();
    s.files.trashStudent = async () => { throw new NetError('network'); };
    await assert.doesNotReject(saveInkFlow({ ...s, ink: value }));
  }
  const s = setup({ ink: { memo: { fileId: 'new', updatedAt: 10 } } });
  await saveInkFlow({ ...s, thumb: undefined });
  assert.deepEqual(s.calls.map((c) => c[0]), ['get', 'upload', 'set']);
  assert.equal(s.calls[2][6], undefined);
});

test('手書き保存: アップロード・削除の失敗を返し、無効な欄は通信前に断る', async () => {
  const s = setup();
  for (const field of ['other', undefined, 'memo/x']) await assert.rejects(saveInkFlow({ ...s, field }), TypeError);
  assert.deepEqual(s.calls, []);
  const error = new NetError('network');
  s.files.uploadInk = async () => { throw error; };
  await assert.rejects(saveInkFlow(s), (e) => e === error);
  s.repo.removeInk = async () => { throw error; };
  await assert.rejects(saveInkFlow({ ...s, ink: emptyInk() }), (e) => e === error);
  assert.deepEqual(s.calls, [['get', 'c1', 'l1', 's26-001'], ['get', 'c1', 'l1', 's26-001']]);
});

test('サーバーの手書き時刻: 目録と消した時刻の大きいほう。記録なしは 0', () => {
  for (const record of [null, undefined, {}, { ink: {}, inkCleared: {} }]) assert.equal(serverInkTime(record, 'memo'), 0);
  for (const [updatedAt, cleared, expected] of [[10, 20, 20], [30, 20, 30], [20, 20, 20], [undefined, 20, 20],
    [10, undefined, 10], ['30', NaN, 0], [Infinity, '20', 0]]) {
    assert.equal(serverInkTime({ ink: { memo: { updatedAt } }, inkCleared: { memo: cleared } }, 'memo'), expected);
  }
});

test('手書き保存: サーバーが新しい・同じ時刻・消した時刻なら、ファイルも目録も変えない', async () => {
  for (const time of [20, 21]) {
    for (const record of [{ ink: { memo: { fileId: 'server', updatedAt: time } } }, { inkCleared: { memo: time } }]) {
      for (const value of [ink, emptyInk()]) {
        const s = setup(record);
        s.onUploaded = () => assert.fail('アップロードしない');
        assert.deepEqual(await saveInkFlow({ ...s, ink: value }), { index: record.ink?.memo ?? null, superseded: true, record });
        assert.deepEqual(s.calls, [['get', 'c1', 'l1', 's26-001']]);
      }
    }
  }
});

test('手書き保存: 確認の読み取り失敗は保存失敗とし、上げない', async () => {
  const s = setup();
  const error = new NetError('network');
  s.repo.getRecord = async () => { throw error; };
  await assert.rejects(saveInkFlow(s), (e) => e === error);
  assert.deepEqual(s.calls, []);
});

test('手書き保存: onUploaded はアップロード直後、目録の保存前に呼ぶ。保存失敗でも ID が残る', async () => {
  for (const fail of [false, true]) {
    const s = setup(null);
    s.onUploaded = (id) => s.calls.push(['uploaded', id]);
    if (fail) s.repo.setInk = async () => { s.calls.push(['set']); throw new NetError('network'); };
    if (fail) await assert.rejects(saveInkFlow(s), (e) => e.code === 'network');
    else await saveInkFlow(s);
    assert.deepEqual(s.calls.map((c) => c[0]), ['get', 'upload', 'uploaded', 'set']);
    assert.deepEqual(s.calls[2], ['uploaded', 'new']);
  }
});

test('手書き保存: A が失敗 → B が保存 → A のやり直しでも B の内容が残る', async () => {
  const s = setup();
  const mem = createMemoryNet();
  const repo = createRepo(mem);
  s.repo = { ...repo, setInk: async () => { throw new NetError('network'); } };
  s.files.uploadInk = async ({ key }) => { s.calls.push(['upload', key]); return { fileId: key, bytes: 42 }; };
  await assert.rejects(saveInkFlow(s), (e) => e.code === 'network');
  s.repo = repo;
  const b = await saveInkFlow({ ...s, key: 'device-b', editedAt: 30 });
  assert.equal(b.superseded, false);
  const a = await saveInkFlow(s);
  assert.equal(a.superseded, true);
  assert.deepEqual((await repo.getRecord('c1', 'l1', 's26-001')).ink.memo, b.index);
  assert.deepEqual(s.calls, [['upload', 'ink-test-1'], ['upload', 'device-b']]);
});

test('手書きの失敗理由: NetError の種類を決まった文にし、エラーの中身は出さない', () => {
  for (const [code, reason] of [
    ['network', '通信できませんでした'],
    ['auth', 'ログインが切れています'],
    ['denied', '見ることが許されていません'],
    ['toobig', 'ファイルが大きすぎます'],
    ['bad-data', '中身を読めませんでした'],
    ['unknown', '保存の仕組みが断りました'],
    ['notfound', '見つかりませんでした'],
    ['unexpected-code', '保存の仕組みが断りました'],
  ]) {
    const error = new NetError(code, '画面に出さないテスト用の詳細');
    error.fileId = 'test-file';
    assert.equal(inkLoadReason(error), reason);
  }
});

test('手書きの失敗理由: NetError 以外やおかしい入力は端末で開けなかった文にする', () => {
  for (const error of [null, undefined, 'network', 0, false, {}, [], new Error('test error'), new TypeError('test error'),
    { code: 'unexpected-code' }, { name: 'NetError', code: 'network' },
    ...['network', 'auth', 'denied', 'toobig', 'bad-data', 'unknown', 'notfound'].map((code) => ({ code }))]) {
    assert.equal(inkLoadReason(error), 'この端末では開けませんでした');
  }
});

test('手書き読みこみ: 正しい JSON は読み、壊れた JSON は bad-data。通信失敗も返す', async () => {
  assert.deepEqual(await loadInkFlow({ files: { loadInk: async () => serializeInk(ink) }, fileId: 'file' }), ink);
  for (const text of ['{', 'null', '[]', '{"v":2}', '']) {
    await assert.rejects(loadInkFlow({ files: { loadInk: async () => text }, fileId: 'file' }),
      (e) => e instanceof NetError && e.code === 'bad-data');
  }
  const error = new NetError('network');
  await assert.rejects(loadInkFlow({ files: { loadInk: async () => { throw error; } }, fileId: 'file' }), (e) => e === error);
});

function resendSetup() {
  const s = setup();
  const pending = new Map();
  const add = (lessonId, extra = {}) => pending.set(lessonId, { classId: 'c1', lessonId, field: 'memo', ink, editedAt: 20, key: `ink-${lessonId}`, ...extra });
  const inkDrafts = {
    list: () => [...pending.values()], get: (_, __, lid) => pending.get(lid) ?? null,
    remove: (_, __, lid) => pending.delete(lid),
  };
  return { ...s, pending, add, inkDrafts, queue: createRecordQueue() };
}

test('手書き再送: 同じ授業の複数欄は sentLessons に 1 件、別クラスは別件で返す', async () => {
  const s = resendSetup();
  const pending = new Map();
  const key = (classId, lessonId, field) => `${classId}/${lessonId}/${field}`;
  for (const [classId, field] of [['c1', 'memo'], ['c1', 'learned'], ['c2', 'memo']]) {
    pending.set(key(classId, 'l1', field), { classId, lessonId: 'l1', field, ink, editedAt: 20, key: 'test-key' });
  }
  s.inkDrafts = {
    list: () => [...pending.values()],
    get: (_, classId, lessonId, field) => pending.get(key(classId, lessonId, field)),
    remove: (_, classId, lessonId, field) => pending.delete(key(classId, lessonId, field)),
  };
  s.repo.getRecord = async () => null;
  assert.deepEqual(await resendInkDrafts(s), { sent: 3, kept: 0, dropped: 0,
    sentLessons: [{ classId: 'c1', lessonId: 'l1' }, { classId: 'c2', lessonId: 'l1' }] });
  assert.equal(pending.size, 0);
});

test('写真の再送: on を送り、画像を作らず、写真がなければ下書きを捨てる', async () => {
  for (const field of ['a1', 'Abc123Def456']) {
    for (const gone of [false, true]) {
      const s = resendSetup();
      const pic = pictureSetup(field, gone ? null : { type: 'image', fileId: 'photo' });
      s.repo = pic.repo;
      s.add('l1', { field, on: 'photo', ink: pic.ink });
      s.makeThumb = () => assert.fail('写真の小さい画像は作らない');
      assert.deepEqual(await resendInkDrafts(s), { sent: gone ? 0 : 1, kept: 0, dropped: gone ? 1 : 0,
        sentLessons: gone ? [] : [{ classId: 'c1', lessonId: 'l1' }] });
      assert.equal(s.pending.size, 0);
      if (!gone) {
        const set = pic.calls.find((call) => call[0] === 'set');
        assert.equal(set[5].on, 'photo');
        assert.equal(set[6], undefined);
      } else assert.equal(s.calls.length, 0);
    }
  }
});

test('写真の再送: 待機中・送信中に on だけ変わった下書きも送信や削除をしない', async () => {
  for (const when of ['queue', 'save']) {
    const s = resendSetup();
    const pic = pictureSetup();
    s.repo = pic.repo;
    const draft = { field: 'a1', on: 'photo', ink: pic.ink };
    s.add('l1', draft);
    if (when === 'queue') s.queue = { async run(_, task) { s.add('l1', { ...draft, on: 'replaced' }); await task(); } };
    else s.repo.setInk = async () => s.add('l1', { ...draft, on: 'replaced' });
    assert.deepEqual(await resendInkDrafts(s), { sent: when === 'save' ? 1 : 0, kept: when === 'queue' ? 1 : 0, dropped: 0,
      sentLessons: when === 'save' ? [{ classId: 'c1', lessonId: 'l1' }] : [] });
    assert.equal(s.pending.get('l1').on, 'replaced');
    if (when === 'queue') assert.equal(s.calls.length, 0);
  }
});

test('手書き再送: アップロード中に B が全消去したら、拒否後の読み直しで古い下書きを捨てる', async () => {
  const s = resendSetup();
  const race = await raceSetup();
  s.repo = race.repo;
  s.add('l1');
  const upload = s.files.uploadInk;
  s.files.uploadInk = async (args) => {
    await race.server.removeInk(s.classId, s.lessonId, s.studentId, s.field, 30);
    return upload(args);
  };
  assert.deepEqual(await resendInkDrafts(s), { sent: 0, kept: 0, dropped: 1, sentLessons: [] });
  assert.equal(s.pending.size, 0);
  const record = await race.server.getRecord(s.classId, s.lessonId, s.studentId);
  assert.deepEqual(record.ink, {});
  assert.equal(record.inkCleared.memo, 30);
  assert.deepEqual(s.calls.at(-1), ['trash', 'new']);
});

test('手書き再送: 古いサーバーには送信、新しい・同じ時刻は捨て、失敗は残して次へ', async () => {
  const s = resendSetup();
  for (const lid of ['send', 'newer', 'equal', 'denied', 'network', 'last']) s.add(lid);
  s.repo.getRecord = async (_, lid) => ({ ink: { memo: { fileId: 'old', updatedAt: lid === 'newer' ? 21 : lid === 'equal' ? 20 : 19 } } });
  s.repo.setInk = async (...args) => {
    s.calls.push(['set', ...args]);
    if (['denied', 'network'].includes(args[1])) throw new NetError(args[1]);
    assert.equal(args[5], undefined);
  };
  assert.deepEqual(await resendInkDrafts(s), { sent: 2, kept: 2, dropped: 2,
    sentLessons: [{ classId: 'c1', lessonId: 'send' }, { classId: 'c1', lessonId: 'last' }] });
  assert.deepEqual([...s.pending.keys()], ['denied', 'network']);
  assert.deepEqual(s.calls.filter((c) => c[0] === 'upload').map((c) => c[1].lessonId), ['send', 'denied', 'network', 'last']);
});

test('手書き再送: B が全部消す → A の古い下書きでも復活しない。読み取り失敗は残す', async () => {
  const s = resendSetup();
  const repo = createRepo(createMemoryNet());
  s.repo = repo;
  await repo.setInk('c1', 'l1', 's26-001', 'memo', { fileId: 'device-b', bytes: 42, strokes: 1 }, null, 25);
  await saveInkFlow({ ...s, ink: emptyInk(), editedAt: 30 });
  s.calls.length = 0;
  s.add('l1');
  assert.deepEqual(await resendInkDrafts(s), { sent: 0, kept: 0, dropped: 1, sentLessons: [] });
  const record = await repo.getRecord('c1', 'l1', 's26-001');
  assert.deepEqual(record.ink, {});
  assert.deepEqual(record.inkCleared, { memo: 30 });
  assert.deepEqual(s.calls, []);
  assert.equal(s.pending.size, 0);
  s.add('l1');
  s.repo = { getRecord: async () => { throw new NetError('network'); } };
  assert.deepEqual(await resendInkDrafts(s), { sent: 0, kept: 1, dropped: 0, sentLessons: [] });
  assert.equal(s.pending.size, 1);
});

test('手書き再送: 送信中に時刻・キー・内容が変わった下書きは消さない', async () => {
  for (const change of [{ editedAt: 21 }, { key: 'changed-key' }, { ink: emptyInk() }]) {
    const s = resendSetup();
    s.add('l1');
    s.repo.getRecord = async () => null;
    s.repo.setInk = async () => s.add('l1', change);
    assert.deepEqual(await resendInkDrafts(s), { sent: 1, kept: 0, dropped: 0, sentLessons: [{ classId: 'c1', lessonId: 'l1' }] });
    assert.equal(s.pending.size, 1);
    assert.deepEqual(s.pending.get('l1'), { classId: 'c1', lessonId: 'l1', field: 'memo', ink, editedAt: 20, key: 'ink-l1', ...change });
  }
});

test('手書き再送: learned・question は作り直した画像を送り、memo は画像を作らない', async () => {
  for (const field of ['learned', 'question', 'memo']) {
    const s = resendSetup();
    s.add('l1', { field });
    s.repo.getRecord = async () => null;
    const made = [];
    s.makeThumb = (value) => { made.push(value); return s.thumb; };
    assert.deepEqual(await resendInkDrafts(s), { sent: 1, kept: 0, dropped: 0, sentLessons: [{ classId: 'c1', lessonId: 'l1' }] });
    assert.equal(s.calls.find((call) => call[0] === 'set')[6], field === 'memo' ? undefined : s.thumb);
    assert.deepEqual(made, field === 'memo' ? [] : [ink]);
    assert.equal(s.pending.size, 0);
  }
});

test('手書き再送: 画像作成の例外・null は null を送り、線の保存は続ける', async () => {
  for (const field of ['learned', 'question']) {
    for (const fails of [true, false]) {
      const s = resendSetup();
      s.add('l1', { field });
      s.repo.getRecord = async () => null;
      s.makeThumb = () => { if (fails) throw new Error('画像を作れない'); return null; };
      assert.deepEqual(await resendInkDrafts(s), { sent: 1, kept: 0, dropped: 0, sentLessons: [{ classId: 'c1', lessonId: 'l1' }] });
      assert.equal(s.calls.find((call) => call[0] === 'set')[6], null);
      assert.equal(s.pending.size, 0);
    }
  }
});

test('手書き再送: 画像作成を渡さない場合は、どの欄も画像を変更しない', async () => {
  for (const field of ['learned', 'question', 'memo']) {
    const s = resendSetup();
    s.add('l1', { field });
    s.repo.getRecord = async () => null;
    assert.deepEqual(await resendInkDrafts(s), { sent: 1, kept: 0, dropped: 0, sentLessons: [{ classId: 'c1', lessonId: 'l1' }] });
    assert.equal(s.calls.find((call) => call[0] === 'set')[6], undefined);
  }
});

test('手書き再送: 読み取りも授業ごとの順番待ちの中。待つ間・読む間の変更は送らない', async () => {
  for (const when of ['queue', 'read']) {
    const s = resendSetup();
    s.add('l1');
    let running = false;
    s.queue = { async run(key, task) {
      assert.equal(key, 'c1/l1');
      running = true;
      if (when === 'queue') s.add('l1', { editedAt: 21 });
      await task();
      running = false;
    } };
    s.repo.getRecord = async () => {
      assert.equal(running, true);
      if (when === 'read') s.add('l1', { key: 'changed-key' });
      return { ink: { memo: { updatedAt: 100 } } };
    };
    assert.deepEqual(await resendInkDrafts(s), { sent: 0, kept: 1, dropped: 0, sentLessons: [] });
    assert.equal(s.pending.size, 1);
    assert.deepEqual(s.calls, []);
  }
});

// 保存・読み直しの連携を、通信・紙・DOM だけ代役にして試す。画面の分岐は実物を使う。
function viewFunction(path, name, dependencies) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    .replace(/^import .*?;\r?\n/gm, '').replace('export function ', 'function ');
  return new Function(...Object.keys(dependencies), `${source}\nreturn ${name};`)(...Object.values(dependencies));
}

function viewNode(tag, props = {}, ...children) {
  const node = { tag, ...props, hidden: props.hidden ?? false, textContent: props.text ?? '', children: [],
    classList: { toggle() {} },
    append(...values) {
      for (const child of values.flat().filter(Boolean)) { child.parent = this; this.children.push(child); }
    },
    replaceChildren(...values) { this.children = []; this.append(...values); },
    remove() { this.parent.children = this.parent.children.filter((child) => child !== this); },
  };
  node.append(...children);
  return node;
}

function fieldSetup({ record = null, draft = null } = {}) {
  const s = setup(record);
  const pads = [];
  const states = [];
  let savedDraft = draft;
  let time = 20;
  let key = 0;
  const ctx = { repo: s.repo, files: s.files, recordQueue: createRecordQueue(), now: () => time,
    timers: { setTimeout: () => 1, clearTimeout() {} },
    inkDrafts: { get: () => savedDraft, put: (_, __, ___, ____, value) => { savedDraft = value; return true; },
      remove: () => { savedDraft = null; } } };
  ctx.files.loadInk = async () => serializeInk(ink);
  const inkField = viewFunction('../js/views/parts/ink-field.js', 'inkField', {
    el: viewNode, confirmDialog: async () => false, CONFIG, newId: () => `test-${++key}`,
    emptyInk, isEmptyInk, serverInkTime, saveInkFlow, loadInkFlow, inkLoadReason, createInkSaver,
    inkThumb: () => null,
    inkPad: (options) => {
      const pad = { ...options, node: viewNode('paper'), destroyed: false, setLocked() {}, destroy() { this.destroyed = true; } };
      pads.push(pad);
      return pad;
    },
  });
  const field = inkField({ ...s, ctx, label: 'メモ', index: record?.ink?.memo, cleared: record?.inkCleared?.memo,
    onState: (state) => states.push(state) });
  return { ...s, ctx, field, pads, states, get draft() { return savedDraft; }, setTime: (value) => { time = value; } };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('手書き欄: 失敗の理由を alert に出し、再試行で入れかえ、成功したら消す', async () => {
  const s = fieldSetup({ record: { ink: { memo: { fileId: 'test-ink', updatedAt: 10 } } } });
  const area = s.field.node.children[0];
  s.ctx.files.loadInk = async () => { throw new NetError('network', '画面に出さないテスト用の詳細'); };
  await s.field.show();
  assert.equal(area.children[0].role, 'alert');
  assert.equal(area.children[0].textContent, '手書きを読みこめませんでした。（理由: 通信できませんでした）');
  assert.equal(s.pads.length, 0);
  s.ctx.files.loadInk = async () => '{';
  area.children.find((node) => node.text === 'もう一度').onclick(); await settle();
  assert.equal(area.children[0].role, 'alert');
  assert.equal(area.children[0].textContent, '手書きを読みこめませんでした。（理由: 中身を読めませんでした）');
  s.ctx.files.loadInk = async () => { throw new NetError('notfound'); };
  area.children.find((node) => node.text === 'もう一度').onclick(); await settle();
  assert.equal(area.children[0].textContent, '前に書いた手書きが見つかりませんでした。');
  assert.equal(area.children.some((node) => node.text === '新しく書く'), true);
  s.ctx.files.loadInk = async () => serializeInk(ink);
  area.children.find((node) => node.text === 'もう一度').onclick(); await settle();
  assert.equal(area.children.some((node) => node.role === 'alert'), false);
  assert.deepEqual(s.pads.map((pad) => pad.ink), [ink]);
  s.field.destroy();
});

test('手書き欄: 削除時刻以上に古い下書きは捨て、新しい下書きだけ復元する', async () => {
  for (const editedAt of [19, 20, 21]) {
    const s = fieldSetup({ record: { inkCleared: { memo: 20 } }, draft: { ink, editedAt, key: 'draft' } });
    await s.field.show();
    assert.deepEqual(s.pads[0].ink, editedAt > 20 ? ink : emptyInk());
    assert.equal(s.field.dirty, editedAt > 20);
    assert.equal(s.draft !== null, editedAt > 20);
    s.field.destroy();
  }
});

test('手書き欄: 新しいサーバーに入れかえ、削除も反映し、下書きを消して saved と知らせを出す', async () => {
  for (const cleared of [false, true]) {
    const s = fieldSetup({ draft: { ink, editedAt: 20, key: 'draft' } });
    await s.field.show();
    const original = s.pads[0];
    const record = cleared ? { inkCleared: { memo: 30 } } : { ink: { memo: { fileId: 'server', updatedAt: 30 } } };
    s.ctx.repo.getRecord = async () => record;
    assert.equal(await s.field.flush(), true);
    await settle();
    assert.equal(original.destroyed, true);
    assert.deepEqual(s.pads.at(-1).ink, cleared ? emptyInk() : ink);
    assert.equal(s.field.state, 'saved');
    assert.equal(s.draft, null);
    const notice = s.field.node.children.at(-1);
    assert.equal(notice.role, 'status');
    assert.equal(notice.hidden, false);
    assert.equal(notice.textContent, 'ほかの端末で書いたほうが新しいので、そちらを出しました。');
    assert.equal(s.calls.some(([name]) => name === 'upload'), false);
    s.field.destroy();
  }
});

test('手書き欄: superseded の待ち時間に書き足した線は入れかえず、次の保存へ送る', async () => {
  const s = fieldSetup({ draft: { ink, editedAt: 20, key: 'draft' } });
  await s.field.show();
  let finishRead;
  s.ctx.repo.getRecord = () => new Promise((resolve) => { finishRead = resolve; });
  const saving = s.field.flush();
  await settle();
  const newer = { ...ink, s: [...ink.s, { c: 1, w: 1, p: [20, 20, 30, 30] }] };
  s.setTime(40);
  s.pads[0].onChange(newer);
  const record = { ink: { memo: { fileId: 'server', updatedAt: 30 } } };
  s.ctx.repo.getRecord = async () => record;
  finishRead(record);
  assert.equal(await saving, true);
  assert.equal(s.pads.length, 1);
  assert.equal(s.pads[0].destroyed, false);
  assert.equal(s.field.node.children.at(-1).hidden, true);
  assert.equal(s.calls.find(([name]) => name === 'upload')[1].text, serializeInk(newer));
  assert.equal(s.calls.find(([name]) => name === 'set').at(-1), 40);
  assert.equal(s.field.state, 'saved');
  s.field.destroy();
});

test('手書き欄: refresh は新しい削除を空の紙に反映し、保存待ちの線や古い目録で置きかえない', async () => {
  const s = fieldSetup({ record: { ink: { memo: { fileId: 'old', updatedAt: 10 } } } });
  await s.field.show();
  s.field.refresh(null, 20);
  assert.deepEqual(s.pads.at(-1).ink, emptyInk());
  s.field.refresh({ fileId: 'older', updatedAt: 19 });
  assert.equal(s.pads.length, 2);
  s.pads.at(-1).onChange(ink);
  s.field.refresh(null, 40);
  assert.equal(s.pads.length, 2);
  assert.equal(s.field.dirty, true);
  s.field.destroy();
});

test('手書き欄: 読み取り失敗は保存失敗。未確定ファイルは次の成功・superseded で片付ける', async () => {
  for (const superseded of [false, true]) {
    const s = fieldSetup({ draft: { ink, editedAt: 20, key: 'draft' } });
    await s.field.show();
    s.ctx.repo.getRecord = async () => { throw new NetError('network'); };
    assert.equal(await s.field.flush(), false);
    assert.equal(s.field.state, 'failed');
    assert.deepEqual(s.calls, []);
    s.ctx.repo.getRecord = async () => null;
    const setInk = s.ctx.repo.setInk;
    s.ctx.repo.setInk = async () => { throw new NetError('network'); };
    s.ctx.files.uploadInk = async () => ({ fileId: 'orphan', bytes: 42 });
    assert.equal(await s.field.retry(), false);
    assert.equal(s.draft !== null, true);
    s.ctx.repo.setInk = setInk;
    s.ctx.files.uploadInk = async () => ({ fileId: 'current', bytes: 42 });
    if (superseded) s.ctx.repo.getRecord = async () => ({ ink: { memo: { fileId: 'server', updatedAt: 30 } } });
    else { s.setTime(40); s.pads[0].onChange(ink); }
    s.ctx.files.trashStudent = async (id) => { s.calls.push(['trash', id]); throw new NetError('network'); };
    assert.equal(await s.field.flush(), true);
    assert.deepEqual(s.calls.filter(([name]) => name === 'trash'), [['trash', 'orphan']]);
    assert.equal(s.draft, null);
    s.ctx.repo.getRecord = async () => null;
    await settle();
    s.setTime(50);
    s.pads.at(-1).onChange(ink);
    await s.field.flush();
    assert.equal(s.calls.filter(([name, id]) => name === 'trash' && id === 'orphan').length, 1);
    s.field.destroy();
  }
});

function teacherSetup(text = '') {
  const nodes = [];
  const pads = [];
  const calls = [];
  const el = (...args) => { const node = viewNode(...args); nodes.push(node); return node; };
  const pane = () => ({ node: el('div'), destroy() {} });
  const mount = viewFunction('../js/views/teacher-record.js', 'mount', {
    el, CONFIG, dateLabel: () => '', normalizeRecord, loadInkFlow, inkLoadReason,
    reviewPeople: (_, records) => [{ studentId: 's26-001', number: 1, inRoster: true, record: records['s26-001'] }],
    neighbors: () => ({ prev: null, next: null }), levelLabel: () => '',
    teacherNav: () => el('nav'), materialPane: pane, attachmentPane: pane, termRow: pane, headingIcon: () => el('span'),
    replyBox: () => ({ ...pane(), dirty: false, okToLeave: () => true }),
    window: { addEventListener() {}, removeEventListener() {} },
    inkPad: (options) => { pads.push(options); return { node: el('paper'), destroy() {} }; },
  });
  const ctx = { params: { classId: 'c1', lessonId: 'l1', studentId: 's26-001' }, navigate() {},
    repo: {
      getLesson: async () => ({}), getMembers: async () => [],
      listRecords: async () => ({ 's26-001': { memo: text, ink: { memo: { fileId: 'old', updatedAt: 10 } } } }),
      getRecord: async () => { calls.push(['get']); return { ink: { memo: { fileId: 'new', updatedAt: 20 } } }; },
    },
    files: { loadInk: async (id) => { calls.push(['load', id]);
      if (id === 'old') throw new NetError('notfound');
      return serializeInk(ink);
    } },
  };
  return { ctx, calls, nodes, pads, start: () => mount(el('root'), ctx) };
}

test('先生の手書き: 最初の notfound は目録を 1 回読み直し、新しいファイルを出す', async () => {
  const s = teacherSetup();
  const destroy = s.start();
  await settle();
  assert.deepEqual(s.calls, [['load', 'old'], ['get'], ['load', 'new']]);
  assert.deepEqual(s.pads.map((p) => p.ink), [ink]);
  destroy();
});

test('先生の手書き: 自動読み直しは 1 回だけ。「もう一度」はさらに最新の目録を読む', async () => {
  for (const [error, message] of [
    ['notfound', '手書きが見つかりませんでした。'],
    ['network', '手書きを読みこめませんでした。（理由: 通信できませんでした）'],
    ['bad-data', '手書きを読みこめませんでした。（理由: 中身を読めませんでした）'],
  ]) {
    const s = teacherSetup();
    s.ctx.files.loadInk = async (id) => { s.calls.push(['load', id]); throw new NetError(error); };
    const destroy = s.start();
    await settle();
    assert.deepEqual(s.calls, error === 'notfound' ? [['load', 'old'], ['get'], ['load', 'new']] : [['load', 'old']]);
    const area = s.nodes.find((node) => node.class === 'record-ink');
    assert.equal(area.children[0].role, 'alert');
    assert.equal(area.children[0].textContent, message);
    s.ctx.files.loadInk = async () => { throw new NetError('auth'); };
    area.children.find((node) => node.text === 'もう一度').onclick(); await settle();
    assert.equal(area.children[0].role, 'alert');
    assert.equal(area.children[0].textContent, '手書きを読みこめませんでした。（理由: ログインが切れています）');
    s.ctx.repo.getRecord = async () => { s.calls.push(['get']); return { ink: { memo: { fileId: 'latest', updatedAt: 30 } } }; };
    s.ctx.files.loadInk = async (id) => { s.calls.push(['load', id]); return serializeInk(ink); };
    s.nodes.findLast((node) => node.text === 'もう一度').onclick();
    await settle();
    assert.deepEqual(s.calls.slice(-2), [['get'], ['load', 'latest']]);
    assert.equal(s.pads.length, 1);
    assert.equal(area.children.some((node) => node.role === 'alert'), false);
    destroy();
  }
});

test('先生の手書き: 読み直して目録がなければ手書きを外し、文章なしだけ未記入と出す', async () => {
  for (const text of ['', '残す文章']) {
    for (const automatic of [true, false]) {
      const s = teacherSetup(text);
      s.ctx.repo.getRecord = async () => { s.calls.push(['get']); return { inkCleared: { memo: 20 } }; };
      if (!automatic) s.ctx.files.loadInk = async (id) => { s.calls.push(['load', id]); throw new NetError('network'); };
      const destroy = s.start();
      await settle();
      const area = s.nodes.find((node) => node.class === 'record-ink').parent;
      if (!automatic) { s.nodes.findLast((node) => node.text === 'もう一度').onclick(); await settle(); }
      assert.deepEqual(s.calls, [['load', 'old'], ['get']]);
      assert.equal(area.children.some((node) => node.class === 'record-ink'), false);
      assert.equal(area.children[0].textContent, text || '（まだ書いていません）');
      assert.equal(s.pads.length, 0);
      destroy();
    }
  }
});
