// js/net.js の createNet と同じ形のメモリ上の代役（テストと、画面の練習モードで使う）。
// スライドアプリの js/dev/memory-net.js を写し、購読（subscribe）を取りのぞき、getPublic を足した。
// 規則は見ない（だれでも全部を読み書きできる）。
// 実物と同じにしてあること: update の複数パス（ルートへの 'a/b' の形のキー）、null での削除、
// 空のオブジェクトと空の配列を保存しない、{ '.sv': 'timestamp' } を now() に置きかえる。
// 読み出す値は常に写し。
import { NetError } from '../errors.js';

const isObj = (v) => v !== null && typeof v === 'object';

// 書く値を整える: サーバーの時刻を置きかえ、null と空の入れ物を落とす（全部落ちたら null）
function normalize(v, now) {
  if (v === null || v === undefined) return null;
  if (!isObj(v)) return v;
  if (!Array.isArray(v) && v['.sv'] === 'timestamp') return now();
  // 配列は「添字を文字にしたキーのオブジェクト」で保存する（null の要素は落とす）。実物と同じ
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    const n = normalize(x, now);
    if (n !== null) out[k] = n;
  }
  return Object.keys(out).length === 0 ? null : out;
}

// 読み出し用: 実物の規則で配列に戻す。キーが全部 0 以上の整数で、0〜最大キーのうち
// 最大キーが個数の 2 倍より小さければ（Firebase SDK の規則）、最大キー+1 の長さの配列（欠けは null）。そうでなければオブジェクト。写しを返す
function view(v) {
  if (!isObj(v)) return v === undefined ? null : v;
  const keys = Object.keys(v);
  const out = {};
  for (const k of keys) out[k] = view(v[k]);
  if (keys.length > 0 && keys.every((k) => /^(0|[1-9]\d*)$/.test(k))) {
    const max = Math.max(...keys.map(Number));
    if (max < 2 * keys.length) {
      return Array.from({ length: max + 1 }, (_, i) => (i in out ? out[i] : null));
    }
  }
  return out;
}

const segs = (path) => String(path).split('/').filter((s) => s !== '');

// initial: 最初の中身（整えて取り込む）、onChange(root, writes): 書きこみのたびに呼ぶ（練習モードの保存用）。
// onChange が例外を投げたら、その書きこみは取り消して呼び出し元へ失敗を返す。
// deny(op, path, value) が true を返すと denied で失敗する（テストで失敗を起こす用）
export function createMemoryNet({ now = Date.now, deny = () => false, initial = null, onChange = () => {} } = {}) {
  let root = normalize(initial, now);
  let online = true;

  function read(path) {
    let node = root;
    for (const k of segs(path)) {
      if (!isObj(node)) return null;
      node = node[k];
      if (node === undefined) return null;
    }
    return node === undefined ? null : node;
  }

  // node の keys[i] 以下に value を書いた「新しい」入れ物を返す（元の入れ物は書きかえない。空になったら null）
  function written(node, keys, i, value) {
    if (i === keys.length) return value;
    const out = isObj(node) ? { ...node } : {};
    const child = written(out[keys[i]], keys, i + 1, value);
    if (child === null) delete out[keys[i]];
    else out[keys[i]] = child;
    return Object.keys(out).length === 0 ? null : out;
  }

  // 1 か所に書く（値は整えたもの。null なら削除）。空になった親は取り除く。
  // 通った道の入れ物は写しを作って置きかえる（前の root をそのまま残せば、保存に失敗したときに戻せる）
  function write(path, value) {
    root = written(root, segs(path), 0, value);
  }

  // 書きこみを保存先に渡す。保存に失敗したら（練習モードの容量不足など）、書く前の中身に戻して失敗を伝える
  function persist(before, writes) {
    if (!onChange) return;
    try {
      onChange(root, writes);
    } catch (e) {
      root = before;
      throw e;
    }
  }

  function guard(op, path, value) {
    if (!online) throw new NetError('network', 'ネットワークにつながりません');
    if (deny(op, path, value)) throw new NetError('denied', '権限がありません');
  }

  return {
    async get(path, { shallow = false } = {}) {
      guard('get', path);
      const value = read(path);
      if (shallow && isObj(value)) return Object.fromEntries(Object.keys(value).map((k) => [k, true]));
      return view(value);
    },
    // ログインなしの読み出し。規則を見ないので get と同じ
    async getPublic(path) {
      guard('getPublic', path);
      return view(read(path));
    },
    async set(path, value) {
      guard('set', path, value);
      const before = root;
      const v = normalize(value, now);
      write(path, v);
      persist(before, [[path, v]]);
    },
    // path が '' ならルートへの複数パスの書きこみ。キーごとに、その場所へ置く（null は消す）
    async update(path, patch) {
      guard('update', path, patch);
      const before = root;
      const writes = [];
      for (const [k, v] of Object.entries(patch)) {
        const full = [...segs(path), ...segs(k)].join('/');
        const n = normalize(v, now);
        write(full, n);
        writes.push([full, n]);
      }
      persist(before, writes);
    },
    async remove(path) {
      guard('remove', path);
      const before = root;
      write(path, null);
      persist(before, [[path, null]]);
    },
    serverTimestamp() { return { '.sv': 'timestamp' }; },

    // 全体の写し
    dump() { return view(root); },

    // 中身を空にする（onChange は呼ばない）
    clear() { root = null; },

    // つながらない状態をまねる（false のあいだは、すべて network で失敗する）
    setOnline(value) { online = Boolean(value); },
  };
}
