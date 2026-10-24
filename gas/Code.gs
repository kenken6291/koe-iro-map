/**
 * こえいろマップ～マッチングサイト（koe-iro-map）バックエンド
 * Google Apps Script（V8）／ Webアプリとしてデプロイ
 *
 * スクリプトプロパティ（setup() 実行後に GEMINI_API_KEY だけ手動設定）
 *   GEMINI_API_KEY        : Gemini APIキー（必須）
 *   GEMINI_MODEL          : 音声解析モデル（既定 gemini-2.5-flash）
 *   GEMINI_TTS_MODEL      : 読み上げモデル（既定 gemini-2.5-flash-preview-tts）
 *   TTS_VOICE             : 読み上げ音声名（既定 Kore）
 *   SPREADSHEET_ID        : setup() が自動設定
 *   FOLDER_READINGS_ID    : setup() が自動設定（音読データ）
 *   FOLDER_INTROS_ID      : setup() が自動設定（ひとことボイス）
 *   FOLDER_TTS_ID         : setup() が自動設定（TTSキャッシュ）
 *   APP_NAME              : メール件名などに使うサイト名（既定 こえいろマップ～マッチングサイト）
 *   APP_URL               : メール本文に載せる公開URL
 */

const APP_VERSION = 'v1.1.2-beta';
const DEFAULT_APP_NAME = 'こえいろマップ～マッチングサイト';
const TTS_PROMPT_VER = 'v2'; // 読み上げ指示を変えたら更新（古いキャッシュを使わない）
const PROPS = PropertiesService.getScriptProperties();
const HASH_ROUNDS = 300;
const SESSION_DAYS = 7;
const MAX_FAIL = 5;
const LOCK_MINUTES = 15;
const MAX_READING_B64 = 8 * 1024 * 1024;   // 約6MB（16kHz WAVで3分強）
const MAX_INTRO_B64 = 2 * 1024 * 1024;     // 約1.5MB
const REACTION_TYPES = ['talk', 'voice', 'dialect', 'smile'];
// 利用上の注意の版。文面を変えたら更新すると、全員に再同意を求めます（index.html の data-terms と合わせる）
const TERMS_VERSION = '2026-10-25';
const TERMS_CHECKS = ['notice', 'disclaimer', 'parties', 'selfResponsibility'];
const MAX_LINKS = 8;
// 連絡先の種類。kind: url＝https:// のURL、handle＝英数字のID、text＝自由なID文字列
const CONTACT_TYPES = {
  standfm: { kind: 'url' },
  discord: { kind: 'text' },
  spaces: { kind: 'handle' },
  zoom: { kind: 'url' },
  meet: { kind: 'url' },
  line: { kind: 'text' },
  openchat: { kind: 'url' },
  x: { kind: 'handle' },
  instagram: { kind: 'handle' },
  facebook: { kind: 'url' },
  threads: { kind: 'handle' },
  other: { kind: 'url' }
};
const REGION_KEYS = ['hokkaido', 'tohoku', 'kanto', 'chubu', 'kansai', 'chugoku', 'shikoku', 'kyushu', 'okinawa', 'standard', 'unknown'];

const SHEET_DEFS = {
  Users: ['userId', 'email', 'nickname', 'passHash', 'salt', 'mustChange', 'failCount', 'lockedUntil', 'status', 'createdAt', 'lastLoginAt', 'termsVersion', 'termsAgreedAt'],
  Sessions: ['token', 'userId', 'expiresAt', 'createdAt'],
  Profiles: ['userId', 'toneScore', 'dialectScore', 'tempoScore', 'detectedDialect', 'regionKey', 'badge', 'summary', 'tags', 'bio', 'readingFileId', 'introFileId', 'promptId', 'diagnosedAt', 'updatedAt'],
  Reactions: ['reactionId', 'fromUserId', 'toUserId', 'type', 'message', 'createdAt', 'readAt'],
  Contacts: ['userId', 'links', 'updatedAt'],
  Approvals: ['fromUserId', 'toUserId', 'createdAt', 'revokedAt']
};

const PROMPTS = [
  { id: 'p01', text: 'きょうは朝から晴れていたので、近所の公園まで散歩に行きました。ベンチでコーヒーを飲みながら、ぼんやり空を眺めていました。' },
  { id: 'p02', text: 'すみません、駅までの道を教えてもらえますか。この先の信号を右に曲がって、まっすぐ行けばいいんですよね。' },
  { id: 'p03', text: 'この前の旅行、ほんまに楽しかったなあ。また行きたいって話してたら、もう次の計画を立て始めてるんです。' },
  { id: 'p04', text: '結論から申し上げますと、この方法がいちばん効率的です。理由は三つあります。まず、時間が短く済むこと。' },
  { id: 'p05', text: '雨の日は、窓の外の音を聞きながら本を読むのが好きです。気がつくと、いつのまにか眠ってしまっています。' },
  { id: 'p06', text: 'えっ、ほんとに？それはすごいですね！今度ぜひ、その話をくわしく聞かせてください。楽しみにしています。' },
  { id: 'p07', text: '晩ごはんは何にしようかな。冷蔵庫に野菜が少し残っているから、あたたかいお味噌汁でも作ろうと思います。' },
  { id: 'p08', text: '子どものころ、夏休みになると毎年おばあちゃんの家に泊まりに行っていました。夜は虫の声がにぎやかでした。' },
  { id: 'p09', text: 'お待たせしました。本日のおすすめは、地元でとれた魚を使った煮付けです。ごはんとよく合いますよ。' },
  { id: 'p10', text: 'まあ、そんなに急がなくても大丈夫ですよ。ゆっくりいきましょう。のんびりやるのも、たまにはいいものです。' },
  { id: 'p11', text: '週末は自転車で川沿いを走ってきました。風が気持ちよくて、気がついたら隣の町まで来ていました。' },
  { id: 'p12', text: 'はじめまして。好きなことは、おいしいものを食べることと、知らない町を歩くことです。よろしくお願いします。' }
];

/* =========================================================
 * エントリポイント
 * ======================================================= */
function doGet() {
  return json_({ ok: true, app: prop_('APP_NAME', DEFAULT_APP_NAME), version: APP_VERSION, time: new Date().toISOString() });
}

function doPost(e) {
  let req = {};
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'リクエストの形式が正しくありません。' });
  }
  try {
    const handler = HANDLERS[req.action];
    if (!handler) throw appErr_('不明な操作です: ' + req.action);
    const data = handler(req) || {};
    return json_(Object.assign({ ok: true, version: APP_VERSION }, data));
  } catch (err) {
    if (err && err.isApp) return json_({ ok: false, error: err.message, code: err.code || '' });
    console.error(err && err.stack ? err.stack : err);
    return json_({ ok: false, error: 'サーバーで問題が起きました。時間をおいてもう一度お試しください。' });
  }
}

const HANDLERS = {
  register: register_,
  login: login_,
  logout: logout_,
  changePassword: changePassword_,
  forgotPassword: forgotPassword_,
  me: me_,
  getPrompt: getPrompt_,
  tts: tts_,
  analyzeVoice: analyzeVoice_,
  uploadIntro: uploadIntro_,
  deleteIntro: deleteIntro_,
  getVoice: getVoice_,
  updateProfile: updateProfile_,
  listProfiles: listProfiles_,
  sendReaction: sendReaction_,
  getInbox: getInbox_,
  agreeTerms: agreeTerms_,
  getMyContacts: getMyContacts_,
  saveContacts: saveContacts_,
  getConnections: getConnections_,
  approveContact: approveContact_,
  revokeContact: revokeContact_
};

/* =========================================================
 * 認証
 * ======================================================= */
function register_(req) {
  const email = normEmail_(req.email);
  const nickname = clean_(req.nickname, 20);
  if (!isEmail_(email)) throw appErr_('メールアドレスの形式を確認してください。');
  if (!nickname) throw appErr_('ニックネームを入力してください（20文字まで）。');

  return withLock_(() => {
    if (findUserByEmail_(email)) throw appErr_('このメールアドレスはすでに登録されています。ログインするか、パスワード再発行をご利用ください。');
    const temp = genTempPassword_(10);
    const salt = Utilities.getUuid();
    const now = new Date().toISOString();
    appendRow_('Users', {
      userId: 'u_' + Utilities.getUuid().replace(/-/g, '').slice(0, 16),
      email: email,
      nickname: nickname,
      passHash: hash_(temp, salt),
      salt: salt,
      mustChange: true,
      failCount: 0,
      lockedUntil: '',
      status: 'active',
      createdAt: now,
      lastLoginAt: ''
    });
    sendMail_(email, '仮パスワードのお知らせ',
      nickname + ' さん\n\nご登録ありがとうございます。\n仮パスワード：' + temp +
      '\n\nログイン後、ご自身のパスワードに変更してください。');
    return { message: '仮パスワードをメールで送りました。メールを確認してログインしてください。' };
  });
}

function login_(req) {
  const email = normEmail_(req.email);
  const password = String(req.password || '');
  const generic = 'メールアドレスまたはパスワードが違います。';

  return withLock_(() => {
    const user = findUserByEmail_(email);
    if (!user) throw appErr_(generic);
    if (user.status !== 'active') throw appErr_('このアカウントは現在ご利用いただけません。');
    const now = Date.now();
    if (user.lockedUntil && new Date(user.lockedUntil).getTime() > now) {
      throw appErr_('ログインに続けて失敗したため、' + LOCK_MINUTES + '分間ロックしています。しばらくしてからお試しください。');
    }
    if (hash_(password, user.salt) !== user.passHash) {
      const fail = Number(user.failCount || 0) + 1;
      const patch = { failCount: fail };
      if (fail >= MAX_FAIL) {
        patch.failCount = 0;
        patch.lockedUntil = new Date(now + LOCK_MINUTES * 60000).toISOString();
      }
      updateRow_('Users', user._row, patch);
      throw appErr_(fail >= MAX_FAIL ? 'ログインに' + MAX_FAIL + '回失敗したため、' + LOCK_MINUTES + '分間ロックしました。' : generic);
    }
    updateRow_('Users', user._row, { failCount: 0, lockedUntil: '', lastLoginAt: new Date().toISOString() });
    const token = createSession_(user.userId);
    return { token: token, user: publicUser_(user), profile: profileOut_(findProfile_(user.userId)) };
  });
}

function logout_(req) {
  const token = String(req.token || '');
  if (!token) return {};
  withLock_(() => {
    const rows = readAll_('Sessions');
    const s = rows.find(r => r.token === token);
    if (s) getSheet_('Sessions').deleteRow(s._row);
  });
  CacheService.getScriptCache().remove('sess_' + token);
  return {};
}

function changePassword_(req) {
  const user = auth_(req.token, true);
  const cur = String(req.currentPassword || '');
  const next = String(req.newPassword || '');
  if (hash_(cur, user.salt) !== user.passHash) throw appErr_('現在のパスワード（仮パスワード）が違います。');
  if (!isStrongPassword_(next)) throw appErr_('新しいパスワードは8文字以上で、英字と数字をどちらも含めてください。');
  if (cur === next) throw appErr_('今と違うパスワードを設定してください。');
  const salt = Utilities.getUuid();
  withLock_(() => updateRow_('Users', user._row, { passHash: hash_(next, salt), salt: salt, mustChange: false }));
  return { message: 'パスワードを変更しました。' };
}

function forgotPassword_(req) {
  const email = normEmail_(req.email);
  const done = { message: '登録済みのメールアドレスであれば、仮パスワードを送りました。メールを確認してください。' };
  if (!isEmail_(email)) throw appErr_('メールアドレスの形式を確認してください。');
  withLock_(() => {
    const user = findUserByEmail_(email);
    if (!user || user.status !== 'active') return;
    const temp = genTempPassword_(10);
    const salt = Utilities.getUuid();
    updateRow_('Users', user._row, { passHash: hash_(temp, salt), salt: salt, mustChange: true, failCount: 0, lockedUntil: '' });
    sendMail_(email, '仮パスワード再発行のお知らせ',
      user.nickname + ' さん\n\n仮パスワードを再発行しました。\n仮パスワード：' + temp +
      '\n\nログイン後、新しいパスワードに変更してください。\n心当たりがない場合は、このメールを破棄してください。');
  });
  return done;
}

function me_(req) {
  const user = auth_(req.token, true);
  const unread = readAll_('Reactions').filter(r => r.toUserId === user.userId && !r.readAt).length;
  return { user: publicUser_(user), profile: profileOut_(findProfile_(user.userId)), unread: unread };
}

/* =========================================================
 * 連絡先交換（相互マッチ＋相互承認）
 * ======================================================= */
function agreeTerms_(req) {
  const user = auth_(req.token);
  if (req.version !== TERMS_VERSION) throw appErr_('利用上の注意が更新されています。画面を再読み込みしてから、もう一度お読みください。');
  const c = req.checks || {};
  if (!TERMS_CHECKS.every(k => c[k] === true)) throw appErr_('すべての項目にチェックしてください。');
  withLock_(() => updateRow_('Users', user._row, { termsVersion: "'" + TERMS_VERSION, termsAgreedAt: new Date().toISOString() }));
  return { message: '同意を記録しました。', termsAgreed: true };
}

/**
 * 同意した版が最新か判定する。
 * スプレッドシートは「2026-10-25」を日付に自動変換するため、
 * 日付として読まれた値も東京時間の yyyy-MM-dd に戻して比べる。
 * （新しく書き込むときは先頭に ' を付けて文字列として保存）
 */
function termsOk_(v) {
  if (v === '' || v == null) return false;
  let s = String(v).replace(/^'/, '').trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) s = Utilities.formatDate(new Date(s), 'Asia/Tokyo', 'yyyy-MM-dd');
  return s === TERMS_VERSION;
}

function requireTerms_(user) {
  if (!termsOk_(user.termsVersion)) throw appErr_('先に、利用上の注意への同意が必要です。', 'TERMS');
}

function getMyContacts_(req) {
  const user = auth_(req.token);
  return { links: readLinks_(user.userId) };
}

function saveContacts_(req) {
  const user = auth_(req.token);
  requireTerms_(user);
  const links = validateLinks_(req.links);
  withLock_(() => {
    const row = readAll_('Contacts').find(r => r.userId === user.userId);
    const data = { userId: user.userId, links: JSON.stringify(links), updatedAt: new Date().toISOString() };
    if (row) updateRow_('Contacts', row._row, data);
    else appendRow_('Contacts', data);
  });
  return { message: '連絡先を保存しました。', links: links };
}

function validateLinks_(input) {
  if (!Array.isArray(input)) throw appErr_('連絡先の形式が正しくありません。');
  const out = [];
  input.forEach(l => {
    const type = String((l && l.type) || '');
    let value = clean_(l && l.value, 200);
    if (!value) return;
    const def = CONTACT_TYPES[type];
    if (!def) throw appErr_('連絡先の種類が正しくありません。');
    if (def.kind === 'url') {
      if (!/^https:\/\/[^\s"'<>]+$/i.test(value)) throw appErr_('URL は https:// から始まる形で入力してください。');
    } else if (def.kind === 'handle') {
      value = value.replace(/^@/, '');
      if (!/^[A-Za-z0-9_.]{1,40}$/.test(value)) throw appErr_('ID は半角英数字・アンダーバー・ピリオドで入力してください（@ は不要です）。');
    } else if (value.length > 60) {
      throw appErr_('ID は60文字以内で入力してください。');
    }
    out.push({ type: type, value: value, note: clean_(l && l.note, 40) });
  });
  if (out.length > MAX_LINKS) throw appErr_('連絡先は' + MAX_LINKS + '件までです。');
  return out;
}

function readLinks_(userId) {
  const row = readAll_('Contacts').find(r => r.userId === userId);
  if (!row) return [];
  try { return JSON.parse(row.links || '[]'); } catch (e) { return []; }
}

function mutualMatchIds_(userId, reactions) {
  const sent = {}, got = {};
  reactions.forEach(r => {
    if (r.type !== 'talk') return;
    if (r.fromUserId === userId) sent[r.toUserId] = true;
    if (r.toUserId === userId) got[r.fromUserId] = true;
  });
  return Object.keys(sent).filter(id => got[id]);
}

function approvalSet_() {
  const set = {};
  readAll_('Approvals').forEach(a => { if (!a.revokedAt) set[a.fromUserId + '>' + a.toUserId] = true; });
  return set;
}

function getConnections_(req) {
  const me = auth_(req.token);
  const users = {};
  readAll_('Users').forEach(u => { if (u.status === 'active') users[u.userId] = u; });
  const profs = {};
  readAll_('Profiles').forEach(p => { profs[p.userId] = p; });
  const approvals = approvalSet_();
  const agreed = termsOk_(me.termsVersion);

  const list = mutualMatchIds_(me.userId, readAll_('Reactions')).filter(id => users[id]).map(id => {
    const iApproved = !!approvals[me.userId + '>' + id];
    const theyApproved = !!approvals[id + '>' + me.userId];
    const both = agreed && iApproved && theyApproved && termsOk_(users[id].termsVersion);
    return {
      userId: id,
      nickname: users[id].nickname,
      badge: profs[id] ? profs[id].badge : '',
      iApproved: iApproved,
      theyApproved: theyApproved,
      links: both ? readLinks_(id) : null
    };
  });
  return { termsVersion: TERMS_VERSION, termsAgreed: agreed, connections: list, myLinkCount: readLinks_(me.userId).length };
}

function approveContact_(req) {
  const me = auth_(req.token);
  requireTerms_(me);
  const to = String(req.toUserId || '');
  if (mutualMatchIds_(me.userId, readAll_('Reactions')).indexOf(to) < 0) {
    throw appErr_('おたがいに「お話ししたい」を送り合った相手とだけ、連絡先を交換できます。');
  }
  if (!readLinks_(me.userId).length) throw appErr_('先に、あなたの連絡先を1つ以上登録してください。');
  withLock_(() => {
    const row = readAll_('Approvals').find(a => a.fromUserId === me.userId && a.toUserId === to);
    const now = new Date().toISOString();
    if (row) updateRow_('Approvals', row._row, { createdAt: now, revokedAt: '' });
    else appendRow_('Approvals', { fromUserId: me.userId, toUserId: to, createdAt: now, revokedAt: '' });
  });
  return { message: '承認しました。相手も承認すると、おたがいの連絡先が表示されます。' };
}

function revokeContact_(req) {
  const me = auth_(req.token);
  const to = String(req.toUserId || '');
  withLock_(() => {
    const row = readAll_('Approvals').find(a => a.fromUserId === me.userId && a.toUserId === to && !a.revokedAt);
    if (row) updateRow_('Approvals', row._row, { revokedAt: new Date().toISOString() });
  });
  return { message: '承認を取り消しました。相手からあなたの連絡先は見えなくなります。' };
}

/* =========================================================
 * 音声診断
 * ======================================================= */
function getPrompt_(req) {
  auth_(req.token);
  const pool = PROMPTS.filter(p => p.id !== req.excludeId);
  return { prompt: pool[Math.floor(Math.random() * pool.length)] };
}

function tts_(req) {
  auth_(req.token);
  const text = clean_(req.text, 200);
  if (!text) throw appErr_('読み上げる文章がありません。');
  const voice = prop_('TTS_VOICE', 'Kore');
  const model = prop_('GEMINI_TTS_MODEL', 'gemini-2.5-flash-preview-tts');
  const key = hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, TTS_PROMPT_VER + '|' + model + '|' + voice + '|' + text, Utilities.Charset.UTF_8));
  const folder = DriveApp.getFolderById(prop_('FOLDER_TTS_ID'));
  const name = 'tts_' + key + '.pcm';
  const hit = folder.getFilesByName(name);
  if (hit.hasNext()) {
    return { audio: Utilities.base64Encode(hit.next().getBlob().getBytes()), sampleRate: 24000, format: 'pcm16', cached: true };
  }
  const b64 = geminiTts_(text, model, voice);
  folder.createFile(Utilities.newBlob(Utilities.base64Decode(b64), 'application/octet-stream', name));
  return { audio: b64, sampleRate: 24000, format: 'pcm16', cached: false };
}

function analyzeVoice_(req) {
  const user = auth_(req.token);
  const audio = String(req.audio || '');
  const mime = String(req.mimeType || 'audio/wav');
  if (!audio) throw appErr_('録音データが届いていません。もう一度録音してください。');
  if (audio.length > MAX_READING_B64) throw appErr_('録音が長すぎます。30秒以内で録り直してください。');
  const prompt = PROMPTS.find(p => p.id === req.promptId);
  if (!prompt) throw appErr_('お題が見つかりません。お題を選び直してください。');

  const result = geminiAnalyze_(audio, mime, prompt.text);
  if (result.audioQuality === 'silent') {
    throw appErr_('声がうまく聞き取れませんでした。マイクに近づいて、もう一度録音してください。');
  }

  const folder = DriveApp.getFolderById(prop_('FOLDER_READINGS_ID'));
  const file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(audio), mime,
    'reading_' + user.userId + '_' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmmss') + '.wav'));

  const now = new Date().toISOString();
  withLock_(() => {
    const prof = findProfile_(user.userId);
    if (prof && prof.readingFileId) trashFile_(prof.readingFileId);
    const data = {
      userId: user.userId,
      toneScore: result.toneScore,
      dialectScore: result.dialectScore,
      tempoScore: result.tempoScore,
      detectedDialect: result.detectedDialect,
      regionKey: result.regionKey,
      badge: result.badge,
      summary: result.summary,
      tags: JSON.stringify(result.tags),
      readingFileId: file.getId(),
      promptId: prompt.id,
      diagnosedAt: now,
      updatedAt: now
    };
    if (prof) updateRow_('Profiles', prof._row, data);
    else appendRow_('Profiles', Object.assign({ bio: '', introFileId: '' }, data));
  });
  return { result: profileOut_(findProfile_(user.userId)) };
}

function uploadIntro_(req) {
  const user = auth_(req.token);
  const audio = String(req.audio || '');
  if (!audio) throw appErr_('録音データが届いていません。');
  if (audio.length > MAX_INTRO_B64) throw appErr_('ひとことボイスは10秒以内で録音してください。');
  const prof = findProfile_(user.userId);
  if (!prof) throw appErr_('先に音声診断を済ませてください。');
  const folder = DriveApp.getFolderById(prop_('FOLDER_INTROS_ID'));
  const file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(audio), 'audio/wav', 'intro_' + user.userId + '_' + Date.now() + '.wav'));
  withLock_(() => {
    const p = findProfile_(user.userId);
    if (p.introFileId) trashFile_(p.introFileId);
    updateRow_('Profiles', p._row, { introFileId: file.getId(), updatedAt: new Date().toISOString() });
  });
  return { message: 'ひとことボイスを公開しました。' };
}

function deleteIntro_(req) {
  const user = auth_(req.token);
  withLock_(() => {
    const p = findProfile_(user.userId);
    if (p && p.introFileId) {
      trashFile_(p.introFileId);
      updateRow_('Profiles', p._row, { introFileId: '', updatedAt: new Date().toISOString() });
    }
  });
  return { message: 'ひとことボイスを削除しました。' };
}

function getVoice_(req) {
  auth_(req.token);
  const p = findProfile_(String(req.userId || ''));
  if (!p || !p.introFileId) throw appErr_('このユーザーはひとことボイスを公開していません。');
  const blob = DriveApp.getFileById(p.introFileId).getBlob();
  return { audio: Utilities.base64Encode(blob.getBytes()), mimeType: blob.getContentType() || 'audio/wav' };
}

/* =========================================================
 * プロフィール・マップ
 * ======================================================= */
function updateProfile_(req) {
  const user = auth_(req.token);
  const nickname = clean_(req.nickname, 20);
  const bio = clean_(req.bio, 140);
  if (!nickname) throw appErr_('ニックネームを入力してください。');
  withLock_(() => {
    updateRow_('Users', user._row, { nickname: nickname });
    const p = findProfile_(user.userId);
    if (p) updateRow_('Profiles', p._row, { bio: bio, updatedAt: new Date().toISOString() });
  });
  return { message: 'プロフィールを保存しました。' };
}

function listProfiles_(req) {
  const me = auth_(req.token);
  const users = {};
  readAll_('Users').forEach(u => { if (u.status === 'active') users[u.userId] = u; });
  const counts = {};
  readAll_('Reactions').forEach(r => { counts[r.toUserId] = (counts[r.toUserId] || 0) + 1; });
  const list = readAll_('Profiles')
    .filter(p => users[p.userId] && p.diagnosedAt)
    .map(p => Object.assign(profileOut_(p), {
      nickname: users[p.userId].nickname,
      isMe: p.userId === me.userId,
      reactionCount: counts[p.userId] || 0
    }));
  return { profiles: list };
}

/* =========================================================
 * リアクション
 * ======================================================= */
function sendReaction_(req) {
  const me = auth_(req.token);
  const to = String(req.toUserId || '');
  const type = String(req.type || '');
  const message = clean_(req.message, 100);
  if (REACTION_TYPES.indexOf(type) < 0) throw appErr_('リアクションの種類が正しくありません。');
  if (to === me.userId) throw appErr_('自分にはリアクションできません。');
  const target = readAll_('Users').find(u => u.userId === to && u.status === 'active');
  if (!target) throw appErr_('相手が見つかりません。');

  return withLock_(() => {
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    const rows = readAll_('Reactions');
    const dup = rows.some(r => r.fromUserId === me.userId && r.toUserId === to && r.type === type && new Date(r.createdAt).getTime() > dayAgo);
    if (dup) throw appErr_('このリアクションは24時間以内に送っています。また明日どうぞ。');
    appendRow_('Reactions', {
      reactionId: 'r_' + Utilities.getUuid().replace(/-/g, '').slice(0, 16),
      fromUserId: me.userId, toUserId: to, type: type, message: message,
      createdAt: new Date().toISOString(), readAt: ''
    });
    const matched = type === 'talk' && rows.some(r => r.fromUserId === to && r.toUserId === me.userId && r.type === 'talk');
    return { message: matched ? 'おたがいに「話したい」になりました！' : 'リアクションを送りました。', matched: matched };
  });
}

function getInbox_(req) {
  const me = auth_(req.token);
  const users = {};
  readAll_('Users').forEach(u => { users[u.userId] = u; });
  const profs = {};
  readAll_('Profiles').forEach(p => { profs[p.userId] = p; });
  const all = readAll_('Reactions');

  const received = all.filter(r => r.toUserId === me.userId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 100)
    .map(r => ({
      reactionId: r.reactionId, fromUserId: r.fromUserId, type: r.type, message: r.message,
      createdAt: r.createdAt, unread: !r.readAt,
      fromNickname: users[r.fromUserId] ? users[r.fromUserId].nickname : '退会したユーザー',
      fromBadge: profs[r.fromUserId] ? profs[r.fromUserId].badge : ''
    }));

  const sentTalk = {};
  all.forEach(r => { if (r.fromUserId === me.userId && r.type === 'talk') sentTalk[r.toUserId] = true; });
  const matchIds = {};
  all.forEach(r => { if (r.toUserId === me.userId && r.type === 'talk' && sentTalk[r.fromUserId]) matchIds[r.fromUserId] = true; });
  const matches = Object.keys(matchIds).filter(id => users[id]).map(id => ({
    userId: id, nickname: users[id].nickname, badge: profs[id] ? profs[id].badge : ''
  }));

  withLock_(() => {
    const sh = getSheet_('Reactions');
    const col = SHEET_DEFS.Reactions.indexOf('readAt') + 1;
    const now = new Date().toISOString();
    all.forEach(r => { if (r.toUserId === me.userId && !r.readAt) sh.getRange(r._row, col).setValue(now); });
  });
  return { received: received, matches: matches };
}

/* =========================================================
 * Gemini
 * ======================================================= */
function geminiAnalyze_(audioB64, mime, promptText) {
  const model = prop_('GEMINI_MODEL', 'gemini-2.5-flash');
  const instruction = [
    'あなたは日本語の話し方・音声表現の分析者です。添付音声は、ユーザーが次のお題文を音読したものです。',
    'お題文：「' + promptText + '」',
    '声の高さ、抑揚、話す速さ、間の取り方、アクセント、イントネーション、語尾の癖を聞き取り、次の3軸を -100〜+100 の整数で評価してください。0付近は中間で、極端な値ははっきりしている場合だけにしてください。',
    '・toneScore：-100＝とても落ち着いている（メロウ）／+100＝とてもハイテンション',
    '・dialectScore：-100＝完全な標準語（共通語）のアクセント／+100＝方言・訛りがとても濃い',
    '・tempoScore：-100＝ロジカルでテキパキした早口／+100＝まったり・ゆるふわ',
    'detectedDialect：推定される方言名（例：関西弁、津軽弁、博多弁）。標準語に近ければ「標準語」、判断できなければ「不明」。',
    'regionKey：' + REGION_KEYS.join(', ') + ' から1つ。標準語なら standard、不明なら unknown。',
    'badge：地域や話し方を織り込んだ、楽しくて誰も傷つけない称号（例：「浪速のマシンガントーカー」「津軽のヒーリングボイス」）。16文字以内。',
    'summary：話し方の魅力を前向きに伝える2〜3文の講評。',
    'tags：話し方の特徴タグを3〜5個（例：「語尾やわらか」「抑揚たっぷり」）。#は付けない。',
    'audioQuality：ok（問題なし）／poor（雑音や小声で判断があいまい）／silent（ほぼ無音・聞き取れない）。',
    '外見・年齢・性別・健康状態の推測は書かないでください。否定的・差別的な表現は使わないでください。'
  ].join('\n');

  const body = {
    contents: [{ role: 'user', parts: [{ text: instruction }, { inline_data: { mime_type: mime, data: audioB64 } }] }],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          toneScore: { type: 'INTEGER' },
          dialectScore: { type: 'INTEGER' },
          tempoScore: { type: 'INTEGER' },
          detectedDialect: { type: 'STRING' },
          regionKey: { type: 'STRING', enum: REGION_KEYS },
          badge: { type: 'STRING' },
          summary: { type: 'STRING' },
          tags: { type: 'ARRAY', items: { type: 'STRING' } },
          audioQuality: { type: 'STRING', enum: ['ok', 'poor', 'silent'] }
        },
        required: ['toneScore', 'dialectScore', 'tempoScore', 'detectedDialect', 'regionKey', 'badge', 'summary', 'tags', 'audioQuality']
      }
    }
  };
  const res = geminiFetch_(model, body);
  const text = (((res.candidates || [])[0] || {}).content || {}).parts;
  const raw = text && text.map(p => p.text || '').join('');
  if (!raw) throw appErr_('AIの診断結果を受け取れませんでした。もう一度お試しください。');
  let r;
  try { r = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
  catch (e) { throw appErr_('AIの診断結果を読み取れませんでした。もう一度お試しください。'); }

  return {
    toneScore: clamp_(r.toneScore),
    dialectScore: clamp_(r.dialectScore),
    tempoScore: clamp_(r.tempoScore),
    detectedDialect: clean_(r.detectedDialect, 20) || '不明',
    regionKey: REGION_KEYS.indexOf(r.regionKey) >= 0 ? r.regionKey : 'unknown',
    badge: clean_(r.badge, 24) || 'ひみつの声の持ち主',
    summary: clean_(r.summary, 300),
    tags: (Array.isArray(r.tags) ? r.tags : []).map(t => clean_(String(t).replace(/^#/, ''), 16)).filter(Boolean).slice(0, 5),
    audioQuality: r.audioQuality || 'ok'
  };
}

function geminiTts_(text, model, voice) {
  // 文章だけを読ませる。指示を地の文で書くと「〜で話します」などと
  // 前置きを読み上げることがあるため、英語の演出指示＋TRANSCRIPT 形式にする。
  const directed = [
    'Read the following Japanese transcript aloud in a warm, natural, clear voice at a relaxed pace.',
    'Speak ONLY the words of the transcript, exactly as written.',
    'Do not add any introduction, greeting, explanation, or closing words, and do not describe your voice or speaking style.',
    '',
    'TRANSCRIPT:',
    text
  ].join('\n');
  const body = {
    contents: [{ parts: [{ text: directed }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
    }
  };
  const res = geminiFetch_(model, body);
  const parts = (((res.candidates || [])[0] || {}).content || {}).parts || [];
  const audio = parts.find(p => p.inlineData || p.inline_data);
  if (!audio) throw appErr_('読み上げ音声を作れませんでした。');
  return (audio.inlineData || audio.inline_data).data;
}

function geminiFetch_(model, body) {
  const key = prop_('GEMINI_API_KEY');
  if (!key) throw appErr_('サーバーの設定（GEMINI_API_KEY）がまだ済んでいません。');
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
  let lastErr = '';
  for (let i = 0; i < 3; i++) {
    const res = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-goog-api-key': key }, payload: JSON.stringify(body)
    });
    const code = res.getResponseCode();
    if (code === 200) return JSON.parse(res.getContentText());
    lastErr = code + ' ' + res.getContentText().slice(0, 300);
    if (code === 429 || code >= 500) { Utilities.sleep(1200 * (i + 1)); continue; }
    break;
  }
  console.error('Gemini error: ' + lastErr);
  throw appErr_('AIサービスが混み合っています。少し時間をおいてお試しください。');
}

/* =========================================================
 * セッション
 * ======================================================= */
function createSession_(userId) {
  const token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  const exp = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  appendRow_('Sessions', { token: token, userId: userId, expiresAt: exp, createdAt: new Date().toISOString() });
  CacheService.getScriptCache().put('sess_' + token, JSON.stringify({ userId: userId, exp: exp }), 21600);
  return token;
}

/** allowMustChange=false のとき、仮パスワードのままなら操作を拒否する */
function auth_(token, allowMustChange) {
  token = String(token || '');
  if (!token) throw appErr_('ログインしてください。', 'AUTH');
  const cache = CacheService.getScriptCache();
  let sess = null;
  const c = cache.get('sess_' + token);
  if (c) sess = JSON.parse(c);
  else {
    const s = readAll_('Sessions').find(r => r.token === token);
    if (s) {
      sess = { userId: s.userId, exp: s.expiresAt };
      cache.put('sess_' + token, JSON.stringify(sess), 21600);
    }
  }
  if (!sess || new Date(sess.exp).getTime() < Date.now()) throw appErr_('ログインの有効期限が切れました。もう一度ログインしてください。', 'AUTH');
  const user = readAll_('Users').find(u => u.userId === sess.userId);
  if (!user || user.status !== 'active') throw appErr_('ログインしてください。', 'AUTH');
  if (!allowMustChange && truthy_(user.mustChange)) throw appErr_('先にパスワードを変更してください。', 'MUST_CHANGE');
  return user;
}

/** 期限切れセッションの掃除（時間主導トリガーで1日1回） */
function cleanupSessions() {
  withLock_(() => {
    const sh = getSheet_('Sessions');
    const now = Date.now();
    readAll_('Sessions').filter(r => new Date(r.expiresAt).getTime() < now)
      .map(r => r._row).sort((a, b) => b - a).forEach(row => sh.deleteRow(row));
  });
}

/* =========================================================
 * 初期セットアップ（エディタから1回だけ実行）
 * ======================================================= */
function setup() {
  let ssId = prop_('SPREADSHEET_ID');
  let ss = ssId ? SpreadsheetApp.openById(ssId) : SpreadsheetApp.create('こえいろマップDB');
  PROPS.setProperty('SPREADSHEET_ID', ss.getId());
  Object.keys(SHEET_DEFS).forEach(name => {
    let sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.getRange(1, 1, 1, SHEET_DEFS[name].length).setValues([SHEET_DEFS[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  const def = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);

  const root = getOrCreateFolder_(DriveApp.getRootFolder(), 'koe-iro-map');
  PROPS.setProperty('FOLDER_READINGS_ID', getOrCreateFolder_(root, 'readings').getId());
  PROPS.setProperty('FOLDER_INTROS_ID', getOrCreateFolder_(root, 'intros').getId());
  PROPS.setProperty('FOLDER_TTS_ID', getOrCreateFolder_(root, 'tts_cache').getId());
  const curName = prop_('APP_NAME');
  if (!curName || curName === 'こえいろマップ') PROPS.setProperty('APP_NAME', DEFAULT_APP_NAME);

  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'cleanupSessions').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('cleanupSessions').timeBased().everyDays(1).atHour(4).create();

  console.log('セットアップ完了。スプレッドシート: ' + ss.getUrl());
  console.log('次に、スクリプトプロパティ GEMINI_API_KEY を設定してください。');
}

function getOrCreateFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/* =========================================================
 * スプレッドシート・ユーティリティ
 * ======================================================= */
let SS_CACHE_ = null;
function getSheet_(name) {
  if (!SS_CACHE_) SS_CACHE_ = SpreadsheetApp.openById(prop_('SPREADSHEET_ID'));
  const sh = SS_CACHE_.getSheetByName(name);
  if (!sh) throw new Error('シートがありません: ' + name + '（setup() を実行してください）');
  return sh;
}

function readAll_(name) {
  const sh = getSheet_(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const cols = SHEET_DEFS[name];
  return sh.getRange(2, 1, last - 1, cols.length).getValues().map((row, i) => {
    const o = { _row: i + 2 };
    cols.forEach((c, j) => { o[c] = row[j] instanceof Date ? row[j].toISOString() : row[j]; });
    return o;
  });
}

function appendRow_(name, obj) {
  const cols = SHEET_DEFS[name];
  getSheet_(name).appendRow(cols.map(c => (obj[c] === undefined ? '' : obj[c])));
}

function updateRow_(name, row, patch) {
  const sh = getSheet_(name);
  const cols = SHEET_DEFS[name];
  const cur = sh.getRange(row, 1, 1, cols.length).getValues()[0];
  cols.forEach((c, j) => { if (patch[c] !== undefined) cur[j] = patch[c]; });
  sh.getRange(row, 1, 1, cols.length).setValues([cur]);
}

function findUserByEmail_(email) { return readAll_('Users').find(u => normEmail_(u.email) === email) || null; }
function findProfile_(userId) { return readAll_('Profiles').find(p => p.userId === userId) || null; }

function publicUser_(u) {
  return {
    userId: u.userId, email: u.email, nickname: u.nickname, mustChange: truthy_(u.mustChange),
    termsAgreed: termsOk_(u.termsVersion)
  };
}

function profileOut_(p) {
  if (!p || !p.diagnosedAt) return null;
  let tags = [];
  try { tags = JSON.parse(p.tags || '[]'); } catch (e) { tags = []; }
  return {
    userId: p.userId,
    toneScore: Number(p.toneScore) || 0,
    dialectScore: Number(p.dialectScore) || 0,
    tempoScore: Number(p.tempoScore) || 0,
    detectedDialect: p.detectedDialect || '不明',
    regionKey: p.regionKey || 'unknown',
    badge: p.badge || '',
    summary: p.summary || '',
    tags: tags,
    bio: p.bio || '',
    hasIntro: !!p.introFileId,
    diagnosedAt: p.diagnosedAt
  };
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw appErr_('混み合っています。もう一度お試しください。');
  try { return fn(); } finally { lock.releaseLock(); }
}

function trashFile_(id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* 既に無い */ } }

function sendMail_(to, subject, body) {
  const app = prop_('APP_NAME', DEFAULT_APP_NAME);
  const url = prop_('APP_URL', '');
  MailApp.sendEmail({ to: to, subject: '【' + app + '】' + subject, body: body + (url ? '\n\n' + url : '') + '\n\n――\n' + app });
}

function hash_(pw, salt) {
  let h = salt + ':' + pw;
  for (let i = 0; i < HASH_ROUNDS; i++) {
    h = hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt, Utilities.Charset.UTF_8));
  }
  return h;
}

function genTempPassword_(len) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const limit = 256 - (256 % chars.length);
  let out = '';
  while (out.length < len) {
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Date.now());
    for (let i = 0; i < bytes.length && out.length < len; i++) {
      const n = bytes[i] & 0xff;
      if (n < limit) out += chars[n % chars.length];
    }
  }
  if (!/[0-9]/.test(out)) out = out.slice(0, -1) + '7';
  return out;
}

function hex_(bytes) { return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join(''); }
function prop_(k, d) { const v = PROPS.getProperty(k); return v ? v : (d === undefined ? '' : d); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function appErr_(msg, code) { const e = new Error(msg); e.isApp = true; e.code = code || ''; return e; }
function normEmail_(s) { return String(s || '').trim().toLowerCase(); }
function isEmail_(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }
function isStrongPassword_(s) { return s.length >= 8 && /[A-Za-z]/.test(s) && /[0-9]/.test(s); }
function clean_(s, max) { return String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, max); }
function clamp_(n) { n = Math.round(Number(n) || 0); return Math.max(-100, Math.min(100, n)); }
function truthy_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }
