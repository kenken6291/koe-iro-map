// GAS との通信。Content-Type を付けない（text/plain になる）ことで
// CORS のプリフライトを発生させずに doPost を呼び出します。
const CFG = window.APP_CONFIG;
const TOKEN_KEY = 'koeiro_token';

export const session = {
  get token() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } },
  set token(v) {
    try { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); } catch (e) { /* 無視 */ }
  }
};

export class ApiError extends Error {
  constructor(message, code) { super(message); this.code = code || ''; }
}

export async function call(action, params = {}) {
  if (!CFG.GAS_URL || CFG.GAS_URL.includes('XXXX')) {
    throw new ApiError('config.js の GAS_URL を設定してください。');
  }
  let res;
  try {
    res = await fetch(CFG.GAS_URL, {
      method: 'POST',
      body: JSON.stringify({ action, token: session.token, ...params }),
      redirect: 'follow'
    });
  } catch (e) {
    throw new ApiError('サーバーにつながりません。通信環境を確認してください。');
  }
  let data;
  try { data = await res.json(); } catch (e) { throw new ApiError('サーバーの応答を読み取れませんでした。'); }
  if (!data.ok) throw new ApiError(data.error || 'エラーが発生しました。', data.code);
  return data;
}
