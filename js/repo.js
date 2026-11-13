// データベースの出し入れ
// データベースの場所（'classes/…' など。docs/superpowers/specs/2026-11-13-jugyo-log-1a-data.md の 3 章）を
// 知っているのはこのモジュールだけ。通信は引数の net（js/net.js の createNet、または js/dev/memory-net.js）で行う。
// 読んだデータは形を確かめてから返す（欠けや型の違いがあっても落ちない）。
import { formatStudentId } from './ids.js';
import { sortLessons, sortUnits } from './lesson-logic.js';

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

function toUnit(id, v) {
  const u = isObj(v) ? v : {};
  return {
    id,
    year: isNum(u.year) ? u.year : 0,
    name: typeof u.name === 'string' ? u.name : '',
    order: isNum(u.order) ? u.order : 0,
  };
}

// 資料の目録は生のオブジェクトで返す（表示のための選別は lesson-logic で行う）
function toLesson(classId, id, v) {
  const l = isObj(v) ? v : {};
  return {
    id,
    classId,
    date: typeof l.date === 'string' ? l.date : '',
    title: typeof l.title === 'string' ? l.title : '',
    unitId: typeof l.unitId === 'string' ? l.unitId : '',
    materials: isObj(l.materials) ? l.materials : {},
    createdAt: isNum(l.createdAt) ? l.createdAt : 0,
    updatedAt: isNum(l.updatedAt) ? l.updatedAt : 0,
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

    // その年度の単元（順番が同じなら名前順）
    async listUnits(year) {
      return sortUnits(entriesOf(await net.get('units'))
        .map(([id, v]) => toUnit(id, v))
        .filter((u) => u.year === year));
    },

    async createUnit(id, { year, name, order }) {
      await net.set(`units/${key(id)}`, { year, name, order });
    },

    async renameUnit(id, name) {
      await net.set(`units/${key(id)}/name`, name);
    },

    async setUnitOrders(orders) {
      const patch = {};
      for (const [id, order] of Object.entries(orders)) patch[`units/${key(id)}/order`] = order;
      if (Object.keys(patch).length === 0) return;
      await net.update('', patch);
    },

    // 授業の一覧（日付の新しい順、同じ日付は作成日時の新しい順）
    async listLessons(classId) {
      const cid = key(classId);
      return sortLessons(entriesOf(await net.get(`lessons/${cid}`))
        .map(([id, v]) => toLesson(cid, id, v)));
    },

    async getLesson(classId, lessonId) {
      const cid = key(classId);
      const lid = key(lessonId);
      const v = await net.get(`lessons/${cid}/${lid}`);
      return isObj(v) ? toLesson(cid, lid, v) : null;
    },

    // 共有ファイルの参照を調べるための全授業。先生だけが読める規則を使う
    async listAllLessons() {
      return Object.fromEntries(entriesOf(await net.get('lessons')));
    },

    // 複数クラスの授業を、1 回のルート update で一緒に作る
    async createLessons(items, now) {
      const patch = {};
      for (const { classId, lessonId, date, title, unitId } of items) {
        const lesson = { date, title, createdAt: now, updatedAt: now };
        if (unitId) lesson.unitId = unitId;
        patch[`lessons/${key(classId)}/${key(lessonId)}`] = lesson;
      }
      if (Object.keys(patch).length === 0) return;
      await net.update('', patch);
    },

    // 資料と作成日時は残し、編集した項目だけを書く。空の単元は外す
    async updateLesson(classId, lessonId, { date, title, unitId }, now) {
      const path = `lessons/${key(classId)}/${key(lessonId)}`;
      await net.update('', {
        [`${path}/date`]: date,
        [`${path}/title`]: title,
        [`${path}/unitId`]: unitId || null,
        [`${path}/updatedAt`]: now,
      });
    },

    // 記録の本文を受け取らず、生徒 ID の数だけを数える
    async countRecords(classId, lessonId) {
      const records = await net.get(`records/${key(classId)}/${key(lessonId)}`, { shallow: true });
      return entriesOf(records).length;
    },

    // 呼ぶ側で、記録が無いことと資料の共有参照を先に確かめる
    async deleteLesson(classId, lessonId) {
      const cid = key(classId);
      const lid = key(lessonId);
      await net.update('', { [`lessons/${cid}/${lid}`]: null, [`thumbs/${cid}/${lid}`]: null });
    },

    // 同じ資料を複数の授業に付ける。授業ごとの順番・画像・更新日時も一緒に書く
    async addMaterial(targets, materialId, material, thumb, now) {
      const mid = key(materialId);
      const patch = {};
      for (const { classId, lessonId, order } of targets) {
        const cid = key(classId);
        const lid = key(lessonId);
        patch[`lessons/${cid}/${lid}/materials/${mid}`] = { ...material, order };
        if (typeof thumb === 'string') patch[`thumbs/${cid}/${lid}/${mid}`] = thumb;
        patch[`lessons/${cid}/${lid}/updatedAt`] = now;
      }
      if (Object.keys(patch).length === 0) return;
      await net.update('', patch);
    },

    // この授業からだけ外す。ファイル本体を消せるかは、呼ぶ側で全授業の参照を調べる
    async removeMaterial(classId, lessonId, materialId, now) {
      const cid = key(classId);
      const lid = key(lessonId);
      const mid = key(materialId);
      await net.update('', {
        [`lessons/${cid}/${lid}/materials/${mid}`]: null,
        [`thumbs/${cid}/${lid}/${mid}`]: null,
        [`lessons/${cid}/${lid}/updatedAt`]: now,
      });
    },

    async setMaterialOrders(classId, lessonId, orders, now) {
      const path = `lessons/${key(classId)}/${key(lessonId)}`;
      const patch = {};
      for (const [id, order] of Object.entries(orders)) patch[`${path}/materials/${key(id)}/order`] = order;
      if (Object.keys(patch).length === 0) return;
      patch[`${path}/updatedAt`] = now;
      await net.update('', patch);
    },

    async getThumbs(classId, lessonId) {
      return Object.fromEntries(entriesOf(await net.get(`thumbs/${key(classId)}/${key(lessonId)}`))
        .filter(([, v]) => typeof v === 'string'));
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
