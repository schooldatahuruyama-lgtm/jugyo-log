// 通信やログインの失敗を表す共通のエラー
// code: 'network'（つながらない・時間切れ）, 'denied'（規則が拒否）, 'auth'（ログインが無効）,
//       'notfound'（資料が見つからない）, 'toobig'（ファイルが大きすぎる）,
//       'bad-credentials'（ID かパスワードが違う）, 'not-teacher'（先生として登録されていない）,
//       'email-exists'（そのアカウントはもうある）, 'rate'（短い時間に作りすぎた）,
//       'weak-password'（パスワードが弱い）, 'reauth'（ログインし直しが必要）, 'unknown'
export class NetError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.name = 'NetError';
    this.code = code;
  }
}

// 入力の誤り（通信をする前に分かるもの）。文にパスワードを入れない
// code: 'short'（短すぎる）, 'has-id'（自分の ID を含む）, 'mismatch'（2 つの新しいパスワードがちがう）,
//       'same'（今のパスワードと同じ）
export class InputError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.name = 'InputError';
    this.code = code;
  }
}
