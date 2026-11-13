// 名簿の計算（出席番号の確かめ、変わったところ、まだクラスにいない生徒、印刷の行、年度）
// 通信はしない。画面（js/views/teacher-roster.js など）から呼ぶ。
import { isStudentId } from './ids.js';

// 入力された出席番号を数にする。全角の数字と前後の空白は受けつける。
// 空なら ''、整数の形でなければ NaN、そうでなければ数を返す
function parseNumber(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : NaN;
  const s = String(v ?? '').normalize('NFKC').trim();
  if (s === '') return '';
  if (!/^\d+$/.test(s)) return NaN;
  return Number(s);
}

const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// 名簿の表の行を確かめる。rows = [{ studentId, number }]（number は入力のままの文字）。
// elsewhere = { 生徒 ID: クラス名 }（同じ年度の、ほかのクラスにいる生徒）。
// 1 行に 1 つ、次の順で code を決める:
// 'bad-id' → 'dup-id' → 'no-number' → 'bad-number' → 'dup-number' → 'elsewhere'。
// 戻り値は [{ index, code }]（index の順）。まちがいが無ければ空の配列
export function checkRows(rows, { maxNumber, elsewhere = {} } = {}) {
  const nums = rows.map((r) => parseNumber(r.number));
  const okNum = (n) => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= maxNumber;

  // 同じ生徒 ID・同じ出席番号が何行あるか
  const idCount = new Map();
  const numCount = new Map();
  rows.forEach((r, i) => {
    idCount.set(r.studentId, (idCount.get(r.studentId) || 0) + 1);
    if (okNum(nums[i])) numCount.set(nums[i], (numCount.get(nums[i]) || 0) + 1);
  });

  const errs = [];
  rows.forEach((r, i) => {
    const n = nums[i];
    let code = null;
    if (!isStudentId(r.studentId)) code = 'bad-id';
    else if (idCount.get(r.studentId) > 1) code = 'dup-id';
    else if (n === '') code = 'no-number';
    else if (!okNum(n)) code = 'bad-number';
    else if (numCount.get(n) > 1) code = 'dup-number';
    else if (Object.prototype.hasOwnProperty.call(elsewhere, r.studentId)) code = 'elsewhere';
    if (code) errs.push({ index: i, code });
  });
  return errs;
}

// 前の名簿 prev と、表の名簿 next の違い。
// set: { 生徒 ID: 出席番号（数） }（足すものと番号が変わったもの）、remove: [生徒 ID]（外すもの）。
// next は checkRows でまちがいが無いことを確かめてから渡す
export function diffMembers(prev, next) {
  const before = new Map(prev.map((m) => [m.studentId, parseNumber(m.number)]));
  const after = new Set();
  const set = {};
  for (const m of next) {
    const n = parseNumber(m.number);
    after.add(m.studentId);
    if (before.get(m.studentId) !== n) set[m.studentId] = n;
  }
  const remove = prev.map((m) => m.studentId).filter((id) => !after.has(id));
  return { set, remove };
}

// 規則の確認（js/rules-probe.js）で使う確認用の生徒 ID か（s00- で始まるもの）。
// 名簿の「生徒を足す」や「続きを発行する」の数には出さない
export function isProbeId(studentId) {
  return typeof studentId === 'string' && studentId.startsWith('s00-');
}

// その年度のどのクラスにもいない生徒 ID（ID 順）。確認用の ID（isProbeId）は除く。
// students は repo.listStudents() の結果（[{ id, … }]）か、生徒 ID の配列。
// membersOfYear は { 生徒 ID: … }（repo.getMembersOfYear の結果など）
export function unassigned(students, membersOfYear) {
  const taken = membersOfYear || {};
  return students
    .map((s) => (typeof s === 'string' ? s : s.id))
    .filter((id) => !isProbeId(id) && !Object.prototype.hasOwnProperty.call(taken, id))
    .sort(byId);
}

// 同じ年度の、このクラス（classId）のほかのクラスにいる生徒 → そのクラス名（checkRows の elsewhere に渡す形）。
// membersOfYear は repo.getMembersOfYear の結果（{ 生徒 ID: { classId, number } }）、classes は [{ id, name }]
export function elsewhereOf(membersOfYear, classes, classId) {
  const names = new Map(classes.map((c) => [c.id, c.name]));
  const out = {};
  for (const [sid, m] of Object.entries(membersOfYear || {})) {
    if (m && m.classId !== classId) out[sid] = names.get(m.classId) || '（名前なし）';
  }
  return out;
}

// 前の年度のクラスの生徒 ID を、出席番号を空にして引きつぐ（ID 順）
export function carryOver(prevMembers) {
  return prevMembers
    .map((m) => ({ studentId: m.studentId, number: '' }))
    .sort((a, b) => byId(a.studentId, b.studentId));
}

// ID の一覧（印刷）の行。passwords に無い ID の password は null（変更済み）
export function sheetRows(members, passwords) {
  const pw = passwords || {};
  return members.map((m) => ({
    number: m.number,
    studentId: m.studentId,
    password: typeof pw[m.studentId] === 'string' ? pw[m.studentId] : null,
  }));
}

// その時刻の年度（4 月はじまり）。2027 年 3 月 31 日 → 2026
export function schoolYear(dateMs) {
  const d = new Date(dateMs);
  return d.getMonth() < 3 ? d.getFullYear() - 1 : d.getFullYear();
}

// 年度の下 2 桁（生徒 ID の頭に使う）
export function entryYY(year) {
  return year % 100;
}
