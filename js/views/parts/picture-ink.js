// 写真・PDF のページごとの手書き。大きな表示を閉じても、保存待ちと戻す履歴を残す。
import { inkPlaceKind, inkPagePlace, splitInkPlace, hasPageInk, pictureIndex, serverInkTime } from '../../ink-logic.js';
import { inkField } from './ink-field.js';

export function canUsePictureInk(photo) {
  return typeof photo?.fileId === 'string' && !!photo.fileId
    && (photo.type === 'image' && ['attachment', 'material'].includes(inkPlaceKind(photo.place))
      || photo.type === 'pdf' && ['attachment-page', 'material-page'].includes(inkPlaceKind(photo.place)));
}

function isPdf(photo) {
  return photo?.type === 'pdf' && typeof photo.fileId === 'string' && !!photo.fileId
    && ['attachment', 'material'].includes(inkPlaceKind(photo.place));
}

export function hasPictureInk(photo, ink, inkCleared, draft) {
  if (!canUsePictureInk(photo)) return false;
  const index = pictureIndex({ ink }, photo.place, photo.fileId);
  const time = serverInkTime({ ink: { [photo.place]: index }, inkCleared }, photo.place);
  if (draft?.on === photo.fileId && draft.editedAt > time) return draft.ink.s.length > 0;
  return !!index;
}

// 削除の間だけ、写真のタイマーと新しい送信を止める。送信済みの順番待ちはそのまま終わらせる。
function pausableInkField(options) {
  const { ctx } = options;
  let paused = false;
  let disposed = false;
  const timers = new Set();
  const waiting = new Set();
  function schedule(timer) {
    const id = ctx.timers.setTimeout(() => {
      if (paused || timer.id !== id || !timers.delete(timer)) return;
      timer.fn();
    }, Math.max(0, timer.due - ctx.now()));
    timer.id = id;
  }
  function release() {
    for (const resolve of waiting) resolve();
    waiting.clear();
  }
  const field = inkField({ ...options, ctx: { ...ctx,
    timers: {
      setTimeout(fn, ms) {
        const timer = { fn, due: ctx.now() + ms, id: null };
        timers.add(timer);
        if (!paused) schedule(timer);
        return timer;
      },
      clearTimeout(timer) {
        ctx.timers.clearTimeout(timer.id);
        timer.id = null;
        timers.delete(timer);
      },
    },
    recordQueue: {
      async run(key, save) {
        // flush の直後に削除が始まった場合も、削除の列をふさがず再開を待つ。
        while (paused && !disposed) await new Promise((resolve) => waiting.add(resolve));
        if (!disposed) return ctx.recordQueue.run(key, save);
      },
    },
  } });
  for (const method of ['flush', 'retry']) {
    const send = field[method];
    field[method] = () => paused ? Promise.resolve(!field.dirty) : send();
  }
  const destroy = field.destroy;
  field.destroy = (options) => {
    disposed = true;
    destroy(options);
    release();
  };
  return {
    field,
    get paused() { return paused; },
    pause() {
      paused = true;
      field.setLocked(true);
      for (const timer of timers) {
        ctx.timers.clearTimeout(timer.id);
        timer.id = null;
      }
    },
    resume(locked) {
      if (!paused || disposed) return;
      paused = false;
      field.setLocked(locked);
      for (const timer of timers) schedule(timer);
      release();
    },
  };
}

export function pictureInks({ ctx, classId, lessonId, studentId, ink = {}, inkCleared = {},
  readOnly = true, onState = () => {}, onChange = () => {} }) {
  let alive = true;
  let locked = false;
  const entries = new Map();
  const key = (photo) => `${photo.place}/${photo.fileId}`;
  const draftFor = (photo) => readOnly ? null : ctx.inkDrafts.get(studentId, classId, lessonId, photo.place);
  const indexFor = (photo) => pictureIndex({ ink }, photo.place, photo.fileId);
  const priority = { idle: 0, saved: 1, dirty: 2, saving: 2, retrying: 3, failed: 4 };
  const state = () => [...entries.values()].reduce((worst, entry) =>
    priority[entry.field.state] > priority[worst] ? entry.field.state : worst, 'idle');
  const changed = () => { if (alive) { onState(state()); onChange(); } };

  function pagesFor(photo) {
    if (!isPdf(photo)) return [photo];
    const drafts = readOnly ? [] : ctx.inkDrafts.list(studentId).filter((draft) =>
      draft.classId === classId && draft.lessonId === lessonId && draft.on === photo.fileId);
    const places = new Set([...Object.keys(ink ?? {}), ...drafts.map((draft) => draft.field),
      ...[...entries.values()].filter((entry) => entry.photo.fileId === photo.fileId).map((entry) => entry.photo.place)]);
    return [...places].filter((place) => splitInkPlace(place)?.place === photo.place)
      .map((place) => ({ ...photo, place }));
  }

  function has(photo) {
    if (isPdf(photo)) {
      // 開いているページや新しい下書きの全消去は、古い目録より優先する。
      const current = {};
      for (const page of pagesFor(photo)) if (has(page)) current[page.place] = { on: photo.fileId };
      return hasPageInk({ ink: current }, photo.place, photo.fileId);
    }
    if (!canUsePictureInk(photo)) return false;
    return entries.get(key(photo))?.field.hasInk() ?? hasPictureInk(photo, ink, inkCleared, draftFor(photo));
  }

  function get(photo) {
    if (!alive || !studentId || !canUsePictureInk(photo)) return null;
    const id = key(photo);
    if (!entries.has(id)) {
      const entry = pausableInkField({ ctx, classId, lessonId, studentId, field: photo.place,
        label: photo.label || (photo.type === 'pdf' ? 'PDF' : '写真'),
        index: indexFor(photo), cleared: inkCleared?.[photo.place], picture: { on: photo.fileId, type: photo.type }, readOnly,
        async reloadIndex() {
          const record = await ctx.repo.getRecord(classId, lessonId, studentId);
          if (alive) {
            ink = record?.ink ?? {};
            inkCleared = record?.inkCleared ?? {};
            changed();
          }
          return { index: indexFor(photo), cleared: inkCleared?.[photo.place] };
        },
        onState: changed, onChange: changed });
      entry.photo = photo;
      entries.set(id, entry);
      entry.field.setLocked(locked);
      changed();
    }
    return entries.get(id).field;
  }

  return {
    get,
    getPage(photo, page) {
      if (!isPdf(photo) || !Number.isInteger(page) || page < 1 || page > 999) return null;
      return get({ ...photo, place: inkPagePlace(photo.place, page), label: photo.label || 'PDF' });
    },
    has,
    restore(photos) {
      if (readOnly) return;
      for (const photo of photos.flatMap(pagesFor)) {
        if (!canUsePictureInk(photo)) continue;
        const draft = draftFor(photo);
        if (draft?.on === photo.fileId) get(photo);
      }
    },
    pause(photo) { for (const page of pagesFor(photo)) entries.get(key(page))?.pause(); },
    resume(photo) { for (const page of pagesFor(photo)) entries.get(key(page))?.resume(locked); },
    stop(photo) {
      for (const page of pagesFor(photo)) {
        const entry = entries.get(key(page));
        entry?.field.destroy({ discard: true });
        entries.delete(key(page));
        if (!readOnly && draftFor(page)?.on === page.fileId) ctx.inkDrafts.remove(studentId, classId, lessonId, page.place);
      }
      changed();
    },
    get dirty() { return [...entries.values()].some(({ field }) => field.dirty); },
    get state() { return state(); },
    async flush() { return (await Promise.all([...entries.values()].map(({ field }) => field.flush()))).every(Boolean); },
    async retry() { return (await Promise.all([...entries.values()].map(({ field }) => field.retry()))).every(Boolean); },
    setLocked(value) {
      locked = !!value;
      for (const entry of entries.values()) entry.field.setLocked(locked || entry.paused);
    },
    refreshInk(next, cleared) {
      ink = next ?? {};
      inkCleared = cleared ?? {};
      for (const { photo, field } of entries.values()) field.refresh(indexFor(photo), inkCleared[photo.place]);
      changed();
    },
    destroy() {
      alive = false;
      for (const { field } of entries.values()) field.destroy();
      entries.clear();
    },
  };
}
