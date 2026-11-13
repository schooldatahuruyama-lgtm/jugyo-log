// ログイン画面（設計書 7.1）。生徒は ID、先生はメールアドレス（@ があれば先生）
import { el } from '../ui.js';
import { signIn } from '../session.js';
import { CONFIG } from '../config.js';

// 失敗の文は code で決める
function messageFor(e) {
  const code = e && e.code;
  if (code === 'bad-credentials') return 'ID かパスワードがちがいます。';
  if (code === 'not-teacher') return 'このメールアドレスは、先生として登録されていません。';
  if (code === 'network') return 'つながりません。電波を確かめて、もう一度ためしてください。';
  return 'ログインできませんでした。';
}

export function mount(root, ctx) {
  let alive = true;
  let busy = false;

  const idInput = el('input', {
    id: 'login-id', type: 'text', autocomplete: 'username',
    autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
  });
  const password = el('input', { id: 'login-password', type: 'password', autocomplete: 'current-password' });
  const error = el('div', { class: 'error', role: 'alert', hidden: true });
  const submit = el('button', { type: 'submit', class: 'btn btn-primary', text: 'ログイン' });
  const form = el('form', { class: 'login-form', novalidate: true },
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'login-id', text: 'ID またはメールアドレス' }), idInput),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'login-password', text: 'パスワード' }), password),
    error,
    el('p', {}, submit));

  // 送っている間は、ボタンも入力欄も使えなくする
  function setBusy(v) {
    busy = v;
    for (const n of [submit, idInput, password]) n.disabled = v;
    submit.textContent = v ? 'ログインしています…' : 'ログイン';
  }

  function showError(text) {
    error.textContent = text;
    error.hidden = false;
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (busy) return;
    error.hidden = true;
    if (!idInput.value.trim() || !password.value) {
      showError('ID（またはメールアドレス）とパスワードを入れてください。');
      return;
    }
    setBusy(true);
    let result;
    try {
      result = await signIn({
        input: idInput.value, password: password.value,
        auth: ctx.auth, repo: ctx.repo, domain: CONFIG.emailDomain,
        isCurrent: () => alive,
      });
    } catch (e) {
      if (!alive) return;
      setBusy(false);
      password.value = ''; // 失敗したら、パスワードの欄は空にする
      showError(messageFor(e));
      password.focus();
      return;
    }
    // 画面が替わったあとの結果は使わない（後始末は signIn が isCurrent を見て済ませている）
    if (!alive) return;
    password.value = '';
    await ctx.navigate(result.role === 'teacher' ? 't-classes' : 'home');
    if (alive) setBusy(false); // 画面がそのまま残ったとき（つながらなかったなど）だけ元に戻す
  });

  root.replaceChildren(el('main', { class: 'center-page' },
    el('h1', { text: '授業ログ' }),
    el('div', { class: 'card' }, form),
    el('p', { class: 'login-hint muted small', text: 'ID とパスワードは、先生からもらった紙に書いてあります。' })));
  idInput.focus();
  return () => { alive = false; };
}
