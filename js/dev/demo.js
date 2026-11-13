// 練習モード: Firebase の代わりに、このパソコンの中だけで動く net と auth を作る。
// データは createMemoryNet に入れ、storage（localStorage）に保存する（作り直しても残る）。
// 練習モードは手動で試すための道具。規則は見ない（だれでも全部を読み書きできる）。2 つのタブの同時の書きこみは守っていない。
// ブラウザのものは引数で受け取る（Node のテストでも動かせる）。
import { createMemoryNet } from './memory-net.js';
import { createDemoGas } from './demo-gas.js';
import { NetError } from '../errors.js';
import { CONFIG } from '../config.js';
import { newId } from '../ids.js';

// 保存のキーは、どれも 'jugyolog:demo:' で始める
const DB_KEY = 'jugyolog:demo:db';             // データベースの中身
const ACCOUNTS_KEY = 'jugyolog:demo:accounts'; // 作った生徒のアカウント { email: { uid, pw } }（pw はパスワードそのものではない）
const AUTH_KEY = 'jugyolog:demo:auth';         // 今のログイン { uid, email }
const ALL_KEYS = [DB_KEY, ACCOUNTS_KEY, AUTH_KEY];

export const DEMO_TEACHER_UID = 'demo-teacher';

// Firebase と同じく、6 文字より短いパスワードではアカウントを作れない
const MIN_FIREBASE_PASSWORD = 6;

// 練習モードにしてよい場所か。localhost 系で、URL に ?demo=1 があるときだけ
export function isDemoAllowed(hostname, search) {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return false;
  return new URLSearchParams(search || '').get('demo') === '1';
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// 保存先から JSON を読む。無い・壊れているときは null
function readJson(storage, key) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// 保存する。できない（容量不足など）ときは失敗にする
function writeJson(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    throw new NetError('unknown', '練習モードの保存先がいっぱいで保存できませんでした');
  }
}

// パスワードを、そのまま保存しないための印（FNV-1a）。
// 練習モードの中だけで比べるためのもので、守りのための仕組みではない
function pwMark(uid, password) {
  let h = 0x811c9dc5;
  const s = `${uid}:${password}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `fnv1a:${h.toString(16)}`;
}

// 先生の登録だけが入った最初の中身
const seedDb = () => ({ teacherList: { [DEMO_TEACHER_UID]: true } });

export function createDemoBackend({ storage, now = Date.now, random }) {
  // データベース: 保存してある中身に、先生の登録を入れておく
  const saved = readJson(storage, DB_KEY);
  const initial = isObj(saved) ? saved : {};
  initial.teacherList = { ...(isObj(initial.teacherList) ? initial.teacherList : {}), [DEMO_TEACHER_UID]: true };

  const net = createMemoryNet({
    now,
    initial,
    onChange: (root) => writeJson(storage, DB_KEY, root),
  });
  writeJson(storage, DB_KEY, net.dump());

  // 生徒のアカウント: { email: { uid, pw } }
  function readAccounts() {
    const a = readJson(storage, ACCOUNTS_KEY);
    return isObj(a) ? a : {};
  }

  function readUser() {
    const u = readJson(storage, AUTH_KEY);
    if (!isObj(u) || typeof u.uid !== 'string' || !u.uid) return null;
    return typeof u.email === 'string' ? { uid: u.uid, email: u.email } : { uid: u.uid };
  }

  function setUser(user) {
    writeJson(storage, AUTH_KEY, user);
    return { ...user };
  }

  const auth = {
    // 作った生徒のアカウントなら、パスワードを比べる。
    // それ以外で @ を含むもの（生徒用のドメインを除く）は先生として、どのパスワードでも入れる
    async signIn(email, password) {
      const mail = String(email ?? '');
      const acc = readAccounts()[mail];
      if (acc) {
        if (acc.pw !== pwMark(acc.uid, String(password ?? ''))) throw new NetError('bad-credentials', 'ID かパスワードが違います');
        return setUser({ uid: acc.uid, email: mail });
      }
      if (mail.includes('@') && !mail.endsWith(`@${CONFIG.emailDomain}`)) {
        return setUser({ uid: DEMO_TEACHER_UID, email: mail });
      }
      throw new NetError('bad-credentials', 'ID かパスワードが違います');
    },

    // 新しいアカウントを作る。今のログインは変えない
    async createAccount(email, password) {
      const mail = String(email ?? '');
      const pw = String(password ?? '');
      const accounts = readAccounts();
      if (accounts[mail]) throw new NetError('email-exists', 'そのアカウントはもうあります');
      if (pw.length < MIN_FIREBASE_PASSWORD) throw new NetError('weak-password', 'パスワードが短すぎます');
      let uid;
      const used = new Set(Object.values(accounts).map((a) => a && a.uid));
      do { uid = `demo-s-${newId(random, 12)}`; } while (used.has(uid));
      accounts[mail] = { uid, pw: pwMark(uid, pw) };
      writeJson(storage, ACCOUNTS_KEY, accounts);
      return { uid };
    },

    // 今ログインしているアカウントのパスワードを変える（先生は、どのパスワードでも入れるので変えるものが無い）
    async changePassword(newPassword) {
      const user = readUser();
      if (!user) throw new NetError('auth', 'ログインしていません');
      const pw = String(newPassword ?? '');
      if (pw.length < MIN_FIREBASE_PASSWORD) throw new NetError('weak-password', 'パスワードが短すぎます');
      const accounts = readAccounts();
      const entry = Object.entries(accounts).find(([, a]) => a && a.uid === user.uid);
      if (!entry) return;
      accounts[entry[0]] = { uid: user.uid, pw: pwMark(user.uid, pw) };
      writeJson(storage, ACCOUNTS_KEY, accounts);
    },

    async restore() {
      return readUser();
    },

    async getToken() {
      if (!readUser()) throw new NetError('auth', 'ログインしていません');
      return 'demo-token';
    },

    forceRefresh() {
      return auth.getToken();
    },

    signOut() {
      storage.removeItem(AUTH_KEY);
    },

    get user() {
      return readUser();
    },
  };

  // 練習モードのデータを全部消す（データ・アカウント・ログイン）。先生の登録だけは入れ直す
  async function reset() {
    for (const k of ALL_KEYS) storage.removeItem(k);
    net.clear();
    await net.update('', seedDb());
  }

  const gas = createDemoGas({ net, getUser: () => auth.user, random });
  return { net, auth, gas, reset };
}
