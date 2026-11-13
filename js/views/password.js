// 生徒が自分のパスワードを変える画面（設計書 5.4）。手順は js/password-flow.js
// パスワードは、console・エラーの文・端末の保存に出さない
import { el, toast } from '../ui.js';
import { changeMyPassword } from '../password-flow.js';

// 失敗の文は code で決める
function messageFor(e) {
  const code = e && e.code;
  if (code === 'short') return '8 文字以上にしてください。';
  if (code === 'has-id') return '自分の ID を入れないでください。';
  if (code === 'mismatch') return '2 つの新しいパスワードがちがいます。';
  if (code === 'same') return '今のパスワードと同じです。';
  if (code === 'bad-credentials') return '今のパスワードがちがいます。';
  if (code === 'network') return 'つながりません。電波を確かめて、もう一度ためしてください。';
  if (code === 'rate') return '何回もためしたので、しばらく待ってから、もう一度ためしてください。';
  if (code === 'auth' || code === 'reauth') return 'ログインし直してから、もう一度ためしてください。';
  return 'パスワードを変えられませんでした。';
}

export function mount(root, ctx) {
  let alive = true;
  let busy = false;

  const current = el('input', { id: 'pw-current', type: 'password', autocomplete: 'current-password' });
  const next = el('input', { id: 'pw-next', type: 'password', autocomplete: 'new-password' });
  const again = el('input', { id: 'pw-again', type: 'password', autocomplete: 'new-password' });
  const error = el('div', { class: 'error', role: 'alert', hidden: true });
  const submit = el('button', { type: 'submit', class: 'btn btn-primary', text: '変える' });
  const cancel = el('button', { type: 'button', class: 'btn', text: 'やめる', onclick: () => ctx.navigate('home') });

  const form = el('form', { class: 'password-form', novalidate: true },
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'pw-current', text: '今のパスワード' }), current),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'pw-next', text: '新しいパスワード' }), next),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'pw-again', text: '新しいパスワード（もう一度）' }), again),
    error,
    el('div', { class: 'password-actions' }, cancel, submit));

  // 送っている間は、ボタンも入力欄も使えなくする
  function setBusy(v) {
    busy = v;
    for (const n of [submit, cancel, current, next, again]) n.disabled = v;
    submit.textContent = v ? '変えています…' : '変える';
  }

  function showError(text) {
    error.textContent = text;
    error.hidden = false;
  }

  // 終わったら（成功でも失敗でも）、3 つの欄を空にする
  function clearFields() {
    for (const n of [current, next, again]) n.value = '';
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (busy) return;
    error.hidden = true;
    if (!current.value) {
      clearFields();
      showError('今のパスワードを入れてください。');
      current.focus();
      return;
    }
    setBusy(true);
    try {
      await changeMyPassword({
        auth: ctx.auth, repo: ctx.repo, studentId: ctx.session.studentId,
        current: current.value, next: next.value, again: again.value,
      });
    } catch (e) {
      clearFields();
      if (!alive) return; // 画面を離れたあとに届いた結果では、画面を動かさない
      setBusy(false);
      showError(messageFor(e));
      current.focus();
      return;
    }
    clearFields();
    if (!alive) return;
    toast('パスワードを変えました。');
    await ctx.navigate('home');
    if (alive) setBusy(false); // 画面がそのまま残ったとき（つながらなかったなど）だけ元に戻す
  });

  root.replaceChildren(el('main', { class: 'center-page' },
    el('h1', { text: 'パスワードを変える' }),
    el('div', { class: 'card' },
      el('div', { class: 'password-rules' },
        el('p', { text: '新しいパスワードの決まり' }),
        el('ul', {},
          el('li', { text: '8 文字以上' }),
          el('li', { text: '自分の ID を入れない' }))),
      form)));
  current.focus();
  return () => { alive = false; };
}
