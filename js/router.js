// ハッシュ（#/...）と画面名の対応。ブラウザの物は使わない
import { isStudentId } from './ids.js';

// name → [ハッシュ, 画面のファイル（js/views/ の中）, だれの画面か]
const ROUTES = {
  login: ['#/login', 'login', 'public'],
  home: ['#/', 'student-home', 'student'],
  lesson: [null, 'student-lesson', 'student'],
  password: ['#/password', 'password', 'student'],
  't-classes': ['#/t', 'teacher-classes', 'teacher'],
  't-units': ['#/t/units', 'teacher-units', 'teacher'],
  't-lessons': ['#/t/lessons', 'teacher-lessons', 'teacher'],
  't-lesson': [null, 'teacher-lesson', 'teacher'],
  't-review': ['#/t/review', 'teacher-review', 'teacher'],
  't-record': [null, 'teacher-record', 'teacher'],
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
  '#/t/units': 't-units',
  '#/t/lessons': 't-lessons',
  '#/t/review': 't-review',
  '#/t/rules': 't-rules',
};

const NOT_FOUND = () => ({ name: 'not-found', params: {} });

// classId・lessonId として使える文字: 英数字だけ（%… の形や / を含むものは受けつけない）
const CLASS_ID = /^[A-Za-z0-9]+$/;

export function parseRoute(hash) {
  const h = String(hash ?? '');
  if (h === '' || h === '#' || h === '#/') return { name: 'home', params: {} };
  if (h.startsWith('#/?c=') && CLASS_ID.test(h.slice(5))) {
    return { name: 'home', params: { classId: h.slice(5) } };
  }
  if (SIMPLE[h]) return { name: SIMPLE[h], params: {} };
  // #/t/class/<classId> と #/t/class/<classId>/sheet
  const parts = h.split('/');
  if (parts.length === 4 && parts[0] === '#' && parts[1] === 'lesson'
      && CLASS_ID.test(parts[2]) && CLASS_ID.test(parts[3])) {
    return { name: 'lesson', params: { classId: parts[2], lessonId: parts[3] } };
  }
  if (parts.length === 5 && parts[0] === '#' && parts[1] === 't' && parts[2] === 'lesson'
      && CLASS_ID.test(parts[3]) && CLASS_ID.test(parts[4])) {
    return { name: 't-lesson', params: { classId: parts[3], lessonId: parts[4] } };
  }
  if (parts[0] === '#' && parts[1] === 't' && parts[2] === 'review'
      && CLASS_ID.test(parts[3] ?? '') && CLASS_ID.test(parts[4] ?? '')) {
    const params = { classId: parts[3], lessonId: parts[4] };
    if (parts.length === 5) return { name: 't-review', params };
    if (parts.length === 6 && isStudentId(parts[5])) {
      return { name: 't-record', params: { ...params, studentId: parts[5] } };
    }
  }
  if (parts[0] === '#' && parts[1] === 't' && parts[2] === 'class' && CLASS_ID.test(parts[3] ?? '')) {
    if (parts.length === 4) return { name: 't-roster', params: { classId: parts[3] } };
    if (parts.length === 5 && parts[4] === 'sheet') return { name: 't-sheet', params: { classId: parts[3] } };
  }
  return NOT_FOUND();
}

export function routeHash(name, params = {}) {
  if (name === 'home' && params.classId) return `#/?c=${encodeURIComponent(params.classId)}`;
  if (name === 'lesson') return `#/lesson/${encodeURIComponent(params.classId)}/${encodeURIComponent(params.lessonId)}`;
  if (name === 't-lesson') return `#/t/lesson/${encodeURIComponent(params.classId)}/${encodeURIComponent(params.lessonId)}`;
  if (name === 't-review' && params.classId && params.lessonId) return `#/t/review/${encodeURIComponent(params.classId)}/${encodeURIComponent(params.lessonId)}`;
  if (name === 't-record') return `#/t/review/${encodeURIComponent(params.classId)}/${encodeURIComponent(params.lessonId)}/${encodeURIComponent(params.studentId)}`;
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
