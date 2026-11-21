// 生徒の読み取りだけを取り置く。書きこみの失敗は、そのまま呼び出し元へ返す。
import { NetError } from './errors.js';

export function createOfflineNet({ net, store, scope, generation = () => 0 }) {
  let stale = false;
  let staleScope = null;
  let staleGeneration = null;
  const pendingReads = new Set();
  const listeners = new Set();
  function change(value) {
    const previous = stale && staleScope === scope() && staleGeneration === generation();
    stale = value;
    staleScope = scope();
    staleGeneration = generation();
    if (previous === value) return;
    for (const listener of listeners) {
      try { listener(stale); } catch { /* 表示の失敗で通信の結果を変えない */ }
    }
  }

  function affected(key, paths) {
    const read = key.replace(/\?shallow$/, '');
    return paths.some((written) => read === written || read === '' || written === ''
      || read.startsWith(`${written}/`) || written.startsWith(`${read}/`));
  }

  function invalidateReads(owner, epoch, paths) {
    for (const read of pendingReads) {
      if (read.owner === owner && read.epoch === epoch && affected(read.key, paths)) read.invalidated = true;
    }
  }

  async function write(method, path, value) {
    const owner = scope();
    const epoch = generation();
    const paths = method === 'update' ? Object.keys(value).map((key) => path ? `${path}/${key}` : key) : [path];
    invalidateReads(owner, epoch, paths);
    const result = await (method === 'remove' ? net.remove(path) : net[method](path, value));
    invalidateReads(owner, epoch, paths);
    if (scope() !== owner || generation() !== epoch) return result;
    change(false);
    if (owner !== null) {
      await store.removeWhere(owner, (key) => affected(key, paths));
    }
    return result;
  }

  return {
    async get(path, opts) {
      const owner = scope();
      const epoch = generation();
      const current = () => scope() === owner && generation() === epoch;
      if (owner === null) return net.get(path, opts);
      const key = opts?.shallow ? `${path}?shallow` : path;
      const read = { key, owner, epoch, invalidated: false };
      pendingReads.add(read);
      try {
        let value;
        try {
          value = await net.get(path, opts);
        } catch (e) {
          if (!(e instanceof NetError && e.code === 'network') || !current()) throw e;
          const found = await store.get(owner, key);
          if (!found || !current()) throw e;
          change(true);
          return found.value;
        }
        if (current() && !read.invalidated) {
          await store.put(owner, key, value);
          if (current() && !read.invalidated) change(false);
        }
        return value;
      } finally { pendingReads.delete(read); }
    },
    getPublic: (...args) => net.getPublic(...args),
    set: (path, value) => write('set', path, value),
    update: (path, patch) => write('update', path, patch),
    remove: (path) => write('remove', path),
    serverTimestamp: () => net.serverTimestamp(),
    get stale() { return stale && staleScope === scope() && staleGeneration === generation(); },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
