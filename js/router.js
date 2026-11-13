// ハッシュ（#/...）と画面名の対応。ブラウザの物は使わない
// name → [ハッシュ, 画面のファイル（js/views/ の中）, だれの画面か]
const ROUTES = {
  login: ['#/login', 'login', 'public'],
  home: ['#/', 'student-home', 'student'],
  password: ['#/password', 'password', 'student'],
  't-classes': ['#/t', 'teacher-classes', 'teacher'],
  't-roster': [null, 'teacher-roster', 'teacher'],
  't-sheet': [null, 'teacher-sheet', 'teacher'],
  't-rules': ['#/t/rules', 'teacher-rules', 'teacher'],
  'not-found': [null, null, 'public'],
};

// ID を持たない画面: ハッシュ → name
const SIMPLE = {
  '#/login': 'login',
  '#/password': 'password',
  '#/t': 't-classes',
  '#/t/rules': 't-rules',
};

const NOT_FOUND = () => ({ name: 'not-found', params: {} });

// classId として使える文字: 英数字だけ（%… の形や / を含むものは受けつけない）
const CLASS_ID = /^[A-Za-z0-9]+$/;

export function parseRoute(hash) {
  const h = String(hash ?? '');
  if (h === '' || h === '#' || h === '#/') return { name: 'home', params: {} };
  if (SIMPLE[h]) return { name: SIMPLE[h], params: {} };
  // #/t/class/<classId> と #/t/class/<classId>/sheet
  const parts = h.split('/');
  if (parts[0] === '#' && parts[1] === 't' && parts[2] === 'class' && CLASS_ID.test(parts[3] ?? '')) {
    if (parts.length === 4) return { name: 't-roster', params: { classId: parts[3] } };
    if (parts.length === 5 && parts[4] === 'sheet') return { name: 't-sheet', params: { classId: parts[3] } };
  }
  return NOT_FOUND();
}

export function routeHash(name, params = {}) {
  if (name === 't-roster') return `#/t/class/${encodeURIComponent(params.classId)}`;
  if (name === 't-sheet') return `#/t/class/${encodeURIComponent(params.classId)}/sheet`;
  return (ROUTES[name] && ROUTES[name][0]) || '#/';
}

// 画面の名前 → 画面のファイル（js/views/ の中。拡張子なし）。not-found は main.js が文を出すので無い
export function viewFile(name) {
  return (ROUTES[name] && ROUTES[name][1]) || undefined;
}

// その画面をだれが開けるか: 'public'（だれでも）・'student'・'teacher'
export function roleFor(name) {
  return (ROUTES[name] && ROUTES[name][2]) || 'public';
}
