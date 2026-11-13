// データベースの出し入れ
// データベースの場所（'classes/…' など。docs/superpowers/specs/2026-11-13-jugyo-log-1a-data.md の 3 章）を
// 知っているのはこのモジュールだけ。通信は引数の net（js/net.js の createNet、または js/dev/memory-net.js）で行う。
// 読んだデータは形を確かめてから返す（欠けや型の違いがあっても落ちない）。
import { formatStudentId } from './ids.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// パスの一部に使うキーを確かめる（空や、Firebase のキーに使えない文字があれば例外）
function key(s) {
  if (typeof s !== 'string' || s === '' || /[.#$\[\]/]/.test(s)) {
    throw new TypeError(`データベースのキーに使えない値です: ${String(s)}`);
  }
  return s;
}

// 読んだ値を { キー: 値 } の形にそろえる（null や数などは空のオブジェクトにする）。
// 実物は、キーが数字だけだと配列で返すことがあるので、配列もオブジェクトに戻す
function entriesOf(v) {
  if (Array.isArray(v)) return v.map((x, i) => [String(i), x]).filter(([, x]) => x !== null && x !== undefined);
  return isObj(v) ? Object.entries(v) : [];
}

// 組の値をそろえる（name が文字でなければ ''、year・createdAt が数でなければ 0）
function toClass(id, v) {
  const c = isObj(v) ? v : {};
  return {
    id,
    year: isNum(c.year) ? c.year : 0,
    name: typeof c.name === 'string' ? c.name : '',
    createdAt: isNum(c.createdAt) ? c.createdAt : 0,
  };
}

// 年度の新しい順、同じ年度は名前順
const byYearThenName = (a, b) => (b.year - a.year) || a.name.localeCompare(b.name, 'ja');

// reserveIds が、ほかの画面と連番が重なったときにやり直す回数
const RESERVE_TRIES = 3;

export function createRepo(net) {
  return {
    // teacherList/<uid> が true なら先生
    async isTeacher(uid) {
      return (await net.get(`teacherList/${key(uid)}`)) === true;
    },

    // その生徒 ID の「今は何回目か」。ログイン前に読むので getPublic を使う。数でなければ null
    async getGeneration(studentId) {
      const v = await net.getPublic(`gen/${key(studentId)}`);
      return isNum(v) ? v : null;
    },

    // ログインしたアカウントの生徒 ID。対応が無ければ null
    async getMyStudentId(uid) {
      const v = await net.get(`accounts/${key(uid)}`);
      return typeof v === 'string' ? v : null;
    },

    // 組の一覧（年度の新しい順、同じ年度は名前順）
    async listClasses() {
      return entriesOf(await net.get('classes'))
        .map(([id, v]) => toClass(id, v))
        .sort(byYearThenName);
    },

    async createClass(id, { year, name }, now) {
      await net.set(`classes/${key(id)}`, { year, name, createdAt: now });
    },

    async renameClass(id, name) {
      await net.set(`classes/${key(id)}/name`, name);
    },

    // 発行した生徒 ID の台帳（ID 順）。uid が無ければ null
    async listStudents() {
      return entriesOf(await net.get('students'))
        .map(([id, v]) => {
          const s = isObj(v) ? v : {};
          return {
            id,
            uid: typeof s.uid === 'string' ? s.uid : null,
            createdAt: isNum(s.createdAt) ? s.createdAt : 0,
          };
        })
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    },

    // 入学年度の下 2 けた yy で、count 人分の生徒 ID を取る。
    // counters/<yy> を進め、students/<id> を作る（1 回のルート update）。
    // count が 1 以上の整数でないときや、連番が 999 をこえるときは、書く前に例外
    //
    // 2 つの画面で同時に発行しても、同じ ID を 2 回取らない:
    // 規則が「students/<id>/createdAt は、すでにあれば書けない」としているので、同じ連番を取ろうとした
    // あとの書きこみは、まるごと断られる（複数パスの update は、全部通るか全部断られるか）。
    // 断られたら、連番を読み直してやり直す
    async reserveIds(yy, count, now) {
      if (!Number.isInteger(count) || count < 1) throw new RangeError('人数は 1 以上の整数です');
      const counterPath = `counters/${String(yy).padStart(2, '0')}`;
      formatStudentId(yy, 1); // 年度の形をここで確かめる
      for (let attempt = 1; ; attempt++) {
        const last = await net.get(counterPath);
        const start = isNum(last) ? last : 0;
        const ids = [];
        for (let i = 1; i <= count; i++) ids.push(formatStudentId(yy, start + i)); // 999 をこえれば RangeError
        const patch = { [counterPath]: start + count };
        // 生徒の場所をまるごと置きかえない（すでにある uid を消さないように、createdAt だけを書く）
        for (const id of ids) patch[`students/${id}/createdAt`] = now;
        try {
          await net.update('', patch);
          return ids;
        } catch (e) {
          if (!(e && e.code === 'denied') || attempt >= RESERVE_TRIES) throw e;
        }
      }
    },

    // 作ったアカウントを生徒 ID に結びつける（1 回のルート update）。
    // oldUid があれば、古いアカウントの対応を消す（古いアカウントでは何も読めなくなる）
    async linkAccount(studentId, { uid, generation, password }, oldUid = null) {
      const sid = key(studentId);
      const patch = {
        [`accounts/${key(uid)}`]: sid,
        [`gen/${sid}`]: generation,
        [`initialPw/${sid}`]: password,
        [`students/${sid}/uid`]: uid,
      };
      if (oldUid !== null && oldUid !== undefined && oldUid !== uid) patch[`accounts/${key(oldUid)}`] = null;
      await net.update('', patch);
    },

    // 最初のパスワード（印刷用）。文字のものだけ返す
    async getInitialPasswords() {
      const out = {};
      for (const [sid, pw] of entriesOf(await net.get('initialPw'))) {
        if (typeof pw === 'string') out[sid] = pw;
      }
      return out;
    },

    async clearInitialPassword(studentId) {
      await net.remove(`initialPw/${key(studentId)}`);
    },

    // 組の名簿（出席番号順。同じ番号なら生徒 ID 順）
    async getMembers(classId) {
      return entriesOf(await net.get(`members/${key(classId)}`))
        .filter(([, n]) => isNum(n))
        .map(([studentId, number]) => ({ studentId, number }))
        .sort((a, b) => (a.number - b.number) || (a.studentId < b.studentId ? -1 : 1));
    },

    // その年度の組に入っている生徒（{ 生徒 ID: { classId, number } }）
    async getMembersOfYear(year) {
      const [classes, members] = await Promise.all([net.get('classes'), net.get('members')]);
      const ofYear = new Set(entriesOf(classes)
        .filter(([id, v]) => toClass(id, v).year === year)
        .map(([id]) => id));
      const out = {};
      for (const [classId, list] of entriesOf(members)) {
        if (!ofYear.has(classId)) continue;
        for (const [sid, number] of entriesOf(list)) {
          if (isNum(number)) out[sid] = { classId, number };
        }
      }
      return out;
    },

    // 名簿を変える。members と memberOf を 1 回のルート update で一緒に変える。
    // set: { 生徒 ID: 出席番号 } を置き、remove: [生徒 ID] を外す。変えるものが無ければ書かない
    async saveMembers(classId, { set = {}, remove = [] }) {
      const cid = key(classId);
      const patch = {};
      for (const [sid, number] of Object.entries(set)) {
        patch[`members/${cid}/${key(sid)}`] = number;
        patch[`memberOf/${key(sid)}/${cid}`] = true;
      }
      for (const sid of remove) {
        patch[`members/${cid}/${key(sid)}`] = null;
        patch[`memberOf/${key(sid)}/${cid}`] = null;
      }
      if (Object.keys(patch).length === 0) return;
      await net.update('', patch);
    },

    // 生徒が入っている組（年度の新しい順）。生徒が読める場所（memberOf/<自分>、classes/<組>、
    // members/<組>/<自分>）だけを読む。classes に無い組（消えた組）は入れない
    async myClasses(studentId) {
      const sid = key(studentId);
      const ids = entriesOf(await net.get(`memberOf/${sid}`))
        .filter(([, v]) => v === true)
        .map(([id]) => id);
      const list = await Promise.all(ids.map(async (id) => {
        const [c, number] = await Promise.all([
          net.get(`classes/${key(id)}`),
          net.get(`members/${key(id)}/${sid}`),
        ]);
        if (!isObj(c)) return null;
        const { year, name } = toClass(id, c);
        return { id, year, name, number: isNum(number) ? number : null };
      }));
      return list.filter((x) => x !== null).sort(byYearThenName);
    },
  };
}
