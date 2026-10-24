import { call, session } from './api.js';
import {
  VoiceRecorder, blobToWav16k, bytesToBase64, pcmToWavUrl, base64ToUrl,
  playUrl, stopPlayback, speakFallback
} from './audio.js';
import { AXES, MAPS, REGIONS, renderMap, pickMatches, closeness } from './map.js';

const CFG = window.APP_CONFIG;
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const state = {
  user: null,
  profile: null,
  profiles: [],
  mapIndex: 0,
  current: 'auth',
  filter: 'all',
  prompt: null,
  readingWav: null,
  introWav: null,
  ttsCache: new Map(),
  termsVersion: '',
  links: []
};

// 連絡先の種類（サーバー側 CONTACT_TYPES と同じキー）
const CONTACT_GROUPS = ['音声SNS', 'ビデオ通話', 'SNS'];
const CONTACT_TYPES = {
  standfm: { label: 'stand.fm', group: '音声SNS', kind: 'url', ph: 'https://stand.fm/channels/…' },
  discord: { label: 'Discord', group: '音声SNS', kind: 'text', ph: 'Discordのユーザー名' },
  spaces: { label: 'X スペース', group: '音声SNS', kind: 'handle', ph: 'Xのユーザー名（@なし）', url: h => `https://x.com/${h}` },
  zoom: { label: 'Zoom', group: 'ビデオ通話', kind: 'url', ph: 'https://zoom.us/j/…（個人ミーティングURL）' },
  meet: { label: 'Google Meet', group: 'ビデオ通話', kind: 'url', ph: 'https://meet.google.com/…' },
  line: { label: 'LINE', group: 'ビデオ通話', kind: 'text', ph: 'LINE ID' },
  openchat: { label: 'LINE オープンチャット', group: 'SNS', kind: 'url', ph: 'https://line.me/ti/g2/…' },
  x: { label: 'X', group: 'SNS', kind: 'handle', ph: 'ユーザー名（@なし）', url: h => `https://x.com/${h}` },
  instagram: { label: 'Instagram', group: 'SNS', kind: 'handle', ph: 'ユーザー名（@なし）', url: h => `https://www.instagram.com/${h}/` },
  threads: { label: 'Threads', group: 'SNS', kind: 'handle', ph: 'ユーザー名（@なし）', url: h => `https://www.threads.net/@${h}` },
  facebook: { label: 'Facebook', group: 'SNS', kind: 'url', ph: 'https://www.facebook.com/…' },
  other: { label: 'その他（URL）', group: 'SNS', kind: 'url', ph: 'https://…' }
};

const REACTIONS = {
  talk: { label: '👋 お話ししたい', short: 'お話ししたい' },
  voice: { label: '😊 いい声！', short: 'いい声！' },
  dialect: { label: '🗾 その方言すき', short: 'その方言すき' },
  smile: { label: '☺️ 和みました', short: '和みました' }
};

/* =========================================================
 * 共通UI
 * ======================================================= */
let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('is-error', isError);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 5000 : 3000);
}

async function busy(btn, fn) {
  const label = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.textContent = '処理中…'; }
  try { return await fn(); }
  catch (e) { handleError(e); }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = label; } }
}

function handleError(e) {
  if (e && e.code === 'AUTH') { logoutLocal(); toast(e.message, true); return; }
  if (e && e.code === 'MUST_CHANGE') { if (state.user) state.user.mustChange = true; openPassModal(true); return; }
  if (e && e.code === 'TERMS') {
    toast(e.message, true);
    if ($('#screen-connect').hidden) show('connect'); else loadConnect();
    return;
  }
  toast((e && e.message) || 'エラーが発生しました。', true);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function show(screen) {
  $$('.screen').forEach(s => { s.hidden = s.id !== `screen-${screen}`; });
  $$('.main-nav button').forEach(b => b.classList.toggle('is-active', b.dataset.go === screen));
  $('#btn-help').classList.toggle('is-active', screen === 'help');
  if (screen !== 'help') state.current = screen;
  window.scrollTo(0, 0);
  if (screen === 'map') loadMap();
  if (screen === 'inbox') loadInbox();
  if (screen === 'connect') loadConnect();
  if (screen === 'mypage') renderMyPage();
}

const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-7 0-11-7-11-7a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/></svg>';

function setupPasswordToggles() {
  $$('.pw-toggle').forEach(btn => {
    btn.innerHTML = EYE;
    btn.addEventListener('click', () => {
      const input = btn.parentElement.querySelector('input');
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.innerHTML = showing ? EYE : EYE_OFF;
      btn.setAttribute('aria-label', showing ? 'パスワードを表示' : 'パスワードを隠す');
    });
  });
}

function resetPasswordFields(form) {
  $$('.pw-wrap input', form).forEach(i => { i.type = 'password'; });
  $$('.pw-toggle', form).forEach(b => { b.innerHTML = EYE; b.setAttribute('aria-label', 'パスワードを表示'); });
}

/* =========================================================
 * 背景・フライト演出（Google Earth Studio 動画）
 * ======================================================= */
function setupBackground() {
  const v = $('#bg-video');
  if (!CFG.BACKGROUND_VIDEO || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  v.src = CFG.BACKGROUND_VIDEO;
  v.addEventListener('error', () => v.remove(), { once: true });
}

function playFlight(regionKey) {
  return new Promise(resolve => {
    const box = $('#flight');
    const video = $('#flight-video');
    const region = REGIONS[regionKey] || REGIONS.unknown;
    $('#flight-region').textContent = regionKey === 'standard' || regionKey === 'unknown' ? 'ニッポン' : region.name;
    const src = (CFG.REGION_VIDEOS || {})[regionKey];
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.pause();
      video.removeAttribute('src');
      video.load();
      box.hidden = true;
      box.classList.remove('no-video');
      resolve();
    };
    const fallback = () => {
      box.classList.add('no-video');
      setTimeout(finish, 2600);
    };
    box.hidden = false;
    $('#flight-skip').onclick = finish;
    if (!src || matchMedia('(prefers-reduced-motion: reduce)').matches) { fallback(); return; }
    video.onended = finish;
    video.onerror = fallback;
    video.src = src;
    video.play().catch(fallback);
    setTimeout(finish, 12000);
  });
}

/* =========================================================
 * TTS
 * ======================================================= */
async function speak(text) {
  stopPlayback();
  try {
    let url = state.ttsCache.get(text);
    if (!url) {
      const r = await call('tts', { text });
      url = pcmToWavUrl(r.audio, r.sampleRate || 24000);
      state.ttsCache.set(text, url);
    }
    playUrl(url);
  } catch (e) {
    if (e.code === 'AUTH' || e.code === 'MUST_CHANGE') return handleError(e);
    speakFallback(text);
  }
}

function navSpeak(key) {
  if (!CFG.NAV_VOICE) return;
  const text = (CFG.NAV_PHRASES || {})[key];
  if (text) speak(text);
}

/* =========================================================
 * 認証
 * ======================================================= */
function setAuthTab(tab) {
  $$('[data-auth-tab]').forEach(b => {
    if (!b.classList.contains('tab')) return;
    const active = b.dataset.authTab === tab;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-selected', String(active));
  });
  $('#form-login').hidden = tab !== 'login';
  $('#form-register').hidden = tab !== 'register';
  $('#form-forgot').hidden = tab !== 'forgot';
}

function formData(form) { return Object.fromEntries(new FormData(form).entries()); }
function submitBtn(e) { return e.submitter || e.target.querySelector('[type=submit]'); }

function setupAuth() {
  $$('[data-auth-tab]').forEach(b => b.addEventListener('click', () => setAuthTab(b.dataset.authTab)));

  $('#form-login').addEventListener('submit', e => {
    e.preventDefault();
    const f = formData(e.target);
    if (!f.email || !f.password) return toast('メールアドレスとパスワードを入力してください。', true);
    busy(submitBtn(e), async () => {
      const r = await call('login', { email: f.email.trim(), password: f.password });
      session.token = r.token;
      e.target.reset();
      resetPasswordFields(e.target);
      await afterLogin(r.user, r.profile, 0);
    });
  });

  $('#form-register').addEventListener('submit', e => {
    e.preventDefault();
    const f = formData(e.target);
    if (!f.nickname.trim() || !f.email.trim()) return toast('ニックネームとメールアドレスを入力してください。', true);
    busy(submitBtn(e), async () => {
      const r = await call('register', { email: f.email.trim(), nickname: f.nickname.trim() });
      toast(r.message);
      e.target.reset();
      setAuthTab('login');
      $('#form-login [name=email]').value = f.email.trim();
    });
  });

  $('#form-forgot').addEventListener('submit', e => {
    e.preventDefault();
    const f = formData(e.target);
    if (!f.email.trim()) return toast('メールアドレスを入力してください。', true);
    busy(submitBtn(e), async () => {
      const r = await call('forgotPassword', { email: f.email.trim() });
      toast(r.message);
      setAuthTab('login');
      $('#form-login [name=email]').value = f.email.trim();
    });
  });

  $('#form-pass').addEventListener('submit', e => {
    e.preventDefault();
    const f = formData(e.target);
    if (f.newPassword !== f.confirm) return toast('確認用のパスワードが一致しません。', true);
    if (f.newPassword.length < 8 || !/[A-Za-z]/.test(f.newPassword) || !/[0-9]/.test(f.newPassword)) {
      return toast('新しいパスワードは8文字以上で、英字と数字をどちらも含めてください。', true);
    }
    busy(submitBtn(e), async () => {
      const r = await call('changePassword', { currentPassword: f.currentPassword, newPassword: f.newPassword });
      toast(r.message);
      e.target.reset();
      resetPasswordFields(e.target);
      $('#modal-pass').hidden = true;
      const was = state.user && state.user.mustChange;
      if (state.user) state.user.mustChange = false;
      if (was) routeHome();
    });
  });

  $('#btn-pass-cancel').addEventListener('click', () => { $('#modal-pass').hidden = true; });
}

function openPassModal(forced) {
  const m = $('#modal-pass');
  $('#pass-note').hidden = !forced;
  $('#btn-pass-cancel').hidden = forced;
  m.hidden = false;
  setTimeout(() => $('#form-pass [name=currentPassword]').focus(), 50);
}

async function afterLogin(user, profile, unread) {
  state.user = user;
  state.profile = profile;
  $('#main-nav').hidden = false;
  setUnread(unread);
  if (user.mustChange) {
    $$('.screen').forEach(s => { s.hidden = true; });
    openPassModal(true);
    return;
  }
  routeHome();
}

function routeHome() {
  if (!state.profile) startDiagnosis();
  else show('map');
}

function logoutLocal() {
  session.token = '';
  state.user = null;
  state.profile = null;
  $('#main-nav').hidden = true;
  $$('.modal').forEach(m => { m.hidden = true; });
  show('auth');
  setAuthTab('login');
}

function setUnread(n) {
  const b = $('#unread-badge');
  b.hidden = !n;
  b.textContent = n > 99 ? '99+' : String(n || '');
}

/* =========================================================
 * 音声診断
 * ======================================================= */
let readingRec = null;
let introRec = null;

function setStep(step) {
  $$('#screen-diagnose .diag-step').forEach(s => { s.hidden = s.dataset.step !== step; });
}

async function startDiagnosis() {
  show('diagnose');
  setStep('prompt');
  state.readingWav = null;
  $('#rec-timer').textContent = `0.0 秒 ／ 最大 ${CFG.READING_MAX_SEC} 秒`;
  await loadPrompt();
  navSpeak('beforeRecord');
}

async function loadPrompt() {
  $('#prompt-text').textContent = '読み込み中…';
  try {
    const r = await call('getPrompt', { excludeId: state.prompt ? state.prompt.id : '' });
    state.prompt = r.prompt;
    $('#prompt-text').textContent = r.prompt.text;
  } catch (e) { handleError(e); }
}

function setupDiagnosis() {
  $('#btn-new-prompt').addEventListener('click', loadPrompt);
  $('#btn-listen').addEventListener('click', () => state.prompt && speak(state.prompt.text));

  readingRec = new VoiceRecorder($('#wave-reading'), {
    maxSec: CFG.READING_MAX_SEC,
    onTick: s => { $('#rec-timer').textContent = `${s.toFixed(1)} 秒 ／ 最大 ${CFG.READING_MAX_SEC} 秒`; },
    onAutoStop: () => stopReading()
  });

  $('#btn-rec').addEventListener('click', async () => {
    stopPlayback();
    try {
      await readingRec.start();
      $('#btn-rec').hidden = true;
      $('#btn-stop').hidden = false;
    } catch (e) { toast(e.message, true); }
  });
  $('#btn-stop').addEventListener('click', stopReading);

  $('#btn-retake').addEventListener('click', () => {
    setStep('prompt');
    $('#rec-timer').textContent = `0.0 秒 ／ 最大 ${CFG.READING_MAX_SEC} 秒`;
    navSpeak('beforeRecord');
  });

  $('#btn-analyze').addEventListener('click', analyze);

  introRec = new VoiceRecorder($('#wave-intro'), {
    maxSec: CFG.INTRO_MAX_SEC,
    onTick: s => { $('#intro-timer').textContent = `${s.toFixed(1)} 秒 ／ 最大 ${CFG.INTRO_MAX_SEC} 秒`; },
    onAutoStop: () => stopIntro()
  });
  $('#btn-intro-rec').addEventListener('click', async () => {
    stopPlayback();
    try {
      await introRec.start();
      $('#btn-intro-rec').hidden = true;
      $('#btn-intro-stop').hidden = false;
      $('#btn-intro-upload').hidden = true;
    } catch (e) { toast(e.message, true); }
  });
  $('#btn-intro-stop').addEventListener('click', stopIntro);
  $('#btn-intro-upload').addEventListener('click', e => busy(e.currentTarget, async () => {
    if (!state.introWav) return;
    const r = await call('uploadIntro', { audio: bytesToBase64(state.introWav) });
    toast(r.message);
    if (state.profile) state.profile.hasIntro = true;
    $('#btn-intro-upload').hidden = true;
  }));

  $('#btn-to-map').addEventListener('click', () => show('map'));
}

async function stopReading() {
  const blob = await readingRec.stop();
  $('#btn-rec').hidden = false;
  $('#btn-stop').hidden = true;
  if (!blob || blob.size < 1000) return toast('録音が短すぎます。もう一度録音してください。', true);
  try {
    const { wav, duration } = await blobToWav16k(blob);
    if (duration < 2) return toast('2秒以上、文章を読んでください。', true);
    state.readingWav = wav;
    $('#review-audio').src = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
    setStep('review');
  } catch (e) {
    toast('録音データを処理できませんでした。別のブラウザでお試しください。', true);
  }
}

async function stopIntro() {
  const blob = await introRec.stop();
  $('#btn-intro-rec').hidden = false;
  $('#btn-intro-stop').hidden = true;
  if (!blob || blob.size < 500) return;
  try {
    const { wav } = await blobToWav16k(blob);
    state.introWav = wav;
    const a = $('#intro-audio');
    a.src = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
    a.hidden = false;
    $('#btn-intro-upload').hidden = false;
  } catch (e) { toast('録音データを処理できませんでした。', true); }
}

const ANALYZE_MSGS = ['あなたの声を聞いています…', '抑揚とテンポを測っています…', 'ことばの地元をさがしています…', '称号を考えています…'];

async function analyze() {
  if (!state.readingWav || !state.prompt) return;
  setStep('analyzing');
  navSpeak('analyzing');
  let i = 0;
  const msgEl = $('#analyzing-msg');
  msgEl.textContent = ANALYZE_MSGS[0];
  const timer = setInterval(() => { i = (i + 1) % ANALYZE_MSGS.length; msgEl.textContent = ANALYZE_MSGS[i]; }, 2200);
  try {
    const r = await call('analyzeVoice', {
      audio: bytesToBase64(state.readingWav),
      mimeType: 'audio/wav',
      promptId: state.prompt.id
    });
    clearInterval(timer);
    stopPlayback();
    state.profile = r.result;
    await playFlight(r.result.regionKey);
    renderResult(r.result);
    setStep('result');
  } catch (e) {
    clearInterval(timer);
    setStep('review');
    handleError(e);
  }
}

function axesHtml(p) {
  return Object.values(AXES).map(a => {
    const v = p[a.key];
    const left = ((v + 100) / 200) * 100;
    return `<div class="axis-row" aria-label="${esc(a.name)} ${v}">
      <div class="axis-ends"><span>${esc(a.neg)}</span><span>${esc(a.pos)}</span></div>
      <div class="axis-track"><span class="axis-pin" style="left:${left}%"></span></div>
    </div>`;
  }).join('');
}

function tagsHtml(tags) { return (tags || []).map(t => `<li>${esc(t)}</li>`).join(''); }

function renderResult(p) {
  $('#result-badge').textContent = p.badge;
  const region = REGIONS[p.regionKey] || REGIONS.unknown;
  $('#result-dialect').textContent = `話し方：${p.detectedDialect}（${region.name}）`;
  $('#result-axes').innerHTML = axesHtml(p);
  $('#result-summary').textContent = p.summary;
  $('#result-tags').innerHTML = tagsHtml(p.tags);
  // 再描画でスタンプアニメーションをもう一度
  const b = $('#result-badge');
  b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
  state.introWav = null;
  $('#intro-audio').hidden = true;
  $('#btn-intro-upload').hidden = true;
  $('#intro-timer').textContent = `0.0 秒 ／ 最大 ${CFG.INTRO_MAX_SEC} 秒`;
}

/* =========================================================
 * マップ
 * ======================================================= */
function setupMap() {
  const tabs = $('#map-tabs');
  tabs.innerHTML = MAPS.map((m, i) =>
    `<button role="tab" class="tab${i === 0 ? ' is-active' : ''}" data-map="${i}" aria-selected="${i === 0}">${m.label.split(' × ').map(esc).map((t, j) => `<span class="nb">${j ? '× ' : ''}${t}</span>`).join(' ')}</button>`).join('');
  tabs.addEventListener('click', e => {
    const b = e.target.closest('[data-map]');
    if (!b) return;
    state.mapIndex = Number(b.dataset.map);
    $$('[data-map]').forEach(x => { const on = x === b; x.classList.toggle('is-active', on); x.setAttribute('aria-selected', String(on)); });
    drawMap();
  });
  $$('[data-filter]').forEach(b => b.addEventListener('click', () => {
    state.filter = b.dataset.filter;
    $$('[data-filter]').forEach(x => x.classList.toggle('is-active', x === b));
    drawMap();
  }));
}

async function loadMap() {
  try {
    const r = await call('listProfiles');
    state.profiles = r.profiles;
    const me = r.profiles.find(p => p.isMe);
    if (me) state.profile = Object.assign(state.profile || {}, me);
    drawMap();
  } catch (e) { handleError(e); }
}

function drawMap() {
  const me = state.profiles.find(p => p.isMe);
  const matches = pickMatches(state.profiles, me, state.filter, CFG.MATCH_COUNT);
  const highlight = matches ? new Set(matches.map(m => m.u.userId)) : null;
  renderMap($('#quad-map'), {
    users: state.profiles,
    me,
    map: MAPS[state.mapIndex],
    highlight,
    onHover: showTip,
    onSelect: openDetail
  });
  renderSide(me, matches);
}

function showTip(u, evt) {
  const tip = $('#map-tip');
  if (!u) { tip.hidden = true; return; }
  const wrap = $('.map-wrap').getBoundingClientRect();
  let x, y;
  if (evt && evt.clientX != null) { x = evt.clientX - wrap.left; y = evt.clientY - wrap.top; }
  else { const r = evt.target.getBoundingClientRect(); x = r.left - wrap.left + r.width / 2; y = r.top - wrap.top; }
  tip.innerHTML = `<b>${esc(u.badge)}</b>${esc(u.nickname)}｜${esc(u.detectedDialect)}`;
  tip.hidden = false;
  const tw = tip.offsetWidth;
  tip.style.left = `${Math.max(4, Math.min(wrap.width - tw - 4, x - tw / 2))}px`;
  tip.style.top = `${Math.max(4, y - tip.offsetHeight - 14)}px`;
}

function renderSide(me, matches) {
  const title = $('#side-title');
  const body = $('#side-body');
  if (!me) {
    title.textContent = 'まだマップにいません';
    body.innerHTML = '<p class="sub">音声診断をすると、あなたの点がマップに現れます。</p><button class="btn btn-primary" id="side-diag" type="button">音声診断をはじめる</button>';
    $('#side-diag').onclick = startDiagnosis;
    return;
  }
  if (!matches) {
    title.textContent = `${state.profiles.length}人がマップにいます`;
    body.innerHTML = `<p class="sub">山吹色の点があなたです。点をタップすると、称号やひとことボイスが見られます。輪のついた点はボイスを公開している人です。</p>
      <p class="sub">「波長が合う人」で似た話し方の人、「真逆の人」で正反対の人が光ります。</p>`;
    return;
  }
  title.textContent = state.filter === 'near' ? '波長が合う人' : '真逆の人';
  if (!matches.length) { body.innerHTML = '<p class="empty">ほかの人がマップに来るのを待ちましょう。</p>'; return; }
  body.innerHTML = `<ul class="match-list">${matches.map(({ u }) => {
    const c = REGIONS[u.regionKey] || REGIONS.unknown;
    const pct = closeness(u, me);
    return `<li><button type="button" data-uid="${esc(u.userId)}">
      <span class="swatch" style="background:${c.color}"></span>
      <span><span class="name">${esc(u.nickname)}</span><span class="badge">${esc(u.badge)}</span></span>
      <span class="pct">${pct}%</span></button></li>`;
  }).join('')}</ul>`;
  $$('[data-uid]', body).forEach(b => b.addEventListener('click', () => {
    const u = state.profiles.find(p => p.userId === b.dataset.uid);
    if (u) openDetail(u);
  }));
}

/* =========================================================
 * 詳細カード・リアクション
 * ======================================================= */
function openDetail(u) {
  $('#map-tip').hidden = true;
  const me = state.profiles.find(p => p.isMe);
  const region = REGIONS[u.regionKey] || REGIONS.unknown;
  const hasVideo = !!(CFG.REGION_VIDEOS || {})[u.regionKey];
  const body = $('#detail-body');
  body.innerHTML = `
    <span class="detail-region"><i style="background:${region.color}"></i>${esc(u.detectedDialect)}（${esc(region.name)}）</span>
    <h2 id="detail-badge" class="detail-badge">${esc(u.badge)}</h2>
    <p class="detail-name">${esc(u.nickname)}${u.isMe ? '（あなた）' : ''}</p>
    ${u.bio ? `<p>${esc(u.bio)}</p>` : ''}
    <div class="axes">${axesHtml(u)}</div>
    <p class="sub" style="margin-top:14px">${esc(u.summary)}</p>
    <ul class="tags">${tagsHtml(u.tags)}</ul>
    ${me && !u.isMe ? `<p class="detail-close">あなたとの波長の近さ：${closeness(u, me)}%</p>` : ''}
    <div class="row">
      ${u.hasIntro ? '<button class="btn btn-primary" id="d-voice" type="button">▶ ひとことボイスを聞く</button>' : '<span class="note">ひとことボイスは未公開です</span>'}
      ${hasVideo ? '<button class="btn btn-ghost" id="d-fly" type="button">ことばの地元へ飛ぶ</button>' : ''}
    </div>
    ${u.isMe ? '' : `
    <div>
      <div class="reactions">${Object.entries(REACTIONS).map(([k, r]) =>
        `<button class="react-btn" data-react="${k}" type="button">${r.label}</button>`).join('')}</div>
      <input class="react-msg" id="d-msg" maxlength="100" placeholder="ひとことメッセージ（任意・100文字まで）">
    </div>`}`;

  const voiceBtn = $('#d-voice', body);
  if (voiceBtn) voiceBtn.addEventListener('click', () => busy(voiceBtn, async () => {
    const r = await call('getVoice', { userId: u.userId });
    playUrl(base64ToUrl(r.audio, r.mimeType));
  }));
  const fly = $('#d-fly', body);
  if (fly) fly.addEventListener('click', () => playFlight(u.regionKey));

  $$('[data-react]', body).forEach(b => b.addEventListener('click', () => busy(b, async () => {
    const r = await call('sendReaction', { toUserId: u.userId, type: b.dataset.react, message: $('#d-msg', body).value });
    toast(r.message);
    $('#d-msg', body).value = '';
    u.reactionCount = (u.reactionCount || 0) + 1;
  })));

  $('#modal-detail').hidden = false;
  $('.close-x', $('#modal-detail')).focus();
}

function setupModals() {
  $('#modal-detail').addEventListener('click', e => {
    if (e.target.id === 'modal-detail' || e.target.closest('[data-close]')) closeDetail();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#modal-detail').hidden) closeDetail();
  });
}

function closeDetail() {
  stopPlayback();
  $('#modal-detail').hidden = true;
}

/* =========================================================
 * リアクション一覧
 * ======================================================= */
async function loadInbox() {
  const list = $('#inbox-list');
  list.innerHTML = '<li class="empty">読み込み中…</li>';
  try {
    const r = await call('getInbox');
    setUnread(0);
    $('#matches').innerHTML = r.matches.length
      ? r.matches.map(m => `<button class="match-pill" type="button">🤝 ${esc(m.nickname)} さんとおたがいに「お話ししたい」</button>`).join('')
      : '';
    $('#matches-note').hidden = !r.matches.length;
    $$('#matches .match-pill').forEach(b => b.addEventListener('click', () => show('connect')));

    if (!r.received.length) {
      list.innerHTML = '<li class="empty">まだリアクションは届いていません。マップで気になる人にリアクションしてみましょう。</li>';
      return;
    }
    list.innerHTML = r.received.map(x => `
      <li class="${x.unread ? 'is-unread' : ''}">
        <span class="who">${esc(x.fromNickname)}</span>
        ${x.fromBadge ? `<span class="note">（${esc(x.fromBadge)}）</span>` : ''}
        から「${esc((REACTIONS[x.type] || {}).short || x.type)}」
        <div class="when">${new Date(x.createdAt).toLocaleString('ja-JP')}</div>
        ${x.message ? `<p class="msg">${esc(x.message)}</p>` : ''}
        <button class="link-btn" data-uid="${esc(x.fromUserId)}" type="button">この人をマップで見る</button>
      </li>`).join('');
    $$('#inbox-list [data-uid]').forEach(b => b.addEventListener('click', () => openUser(b.dataset.uid)));
  } catch (e) { handleError(e); }
}

async function openUser(uid) {
  if (!state.profiles.length) {
    try { state.profiles = (await call('listProfiles')).profiles; } catch (e) { return handleError(e); }
  }
  const u = state.profiles.find(p => p.userId === uid);
  if (u) openDetail(u);
  else toast('この人はまだマップにいません。', true);
}

/* =========================================================
 * つながる（相互マッチ＋相互承認で連絡先交換）
 * ======================================================= */
async function loadConnect() {
  const status = $('#connect-status');
  status.classList.remove('is-error');
  status.textContent = '読み込み中…';
  try {
    const r = await call('getConnections');
    status.textContent = '';
    state.termsVersion = r.termsVersion;
    if (state.user) state.user.termsAgreed = r.termsAgreed;
    const panel = $('#terms-panel');
    $('#form-terms').hidden = r.termsAgreed;
    panel.hidden = r.termsAgreed;
    $('#connect-body').hidden = !r.termsAgreed;
    if (!r.termsAgreed) {
      $('#form-terms').reset();
      $('#btn-terms-agree').disabled = true;
      return;
    }
    const mine = await call('getMyContacts');
    state.links = mine.links || [];
    renderLinkRows(state.links.length ? state.links : [{ type: 'zoom', value: '', note: '' }]);
    renderConnections(r.connections);
  } catch (e) {
    if (e.code === 'AUTH' || e.code === 'MUST_CHANGE') return handleError(e);
    status.classList.add('is-error');
    status.textContent = `読み込めませんでした：${e.message}`;
  }
}

function typeOptions(selected) {
  return CONTACT_GROUPS.map(g => `<optgroup label="${g}">${Object.entries(CONTACT_TYPES)
    .filter(([, t]) => t.group === g)
    .map(([k, t]) => `<option value="${k}"${k === selected ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}</optgroup>`).join('');
}

function renderLinkRows(links) {
  const box = $('#link-rows');
  box.innerHTML = links.map(l => linkRowHtml(l)).join('');
  bindLinkRows();
}

function linkRowHtml(l) {
  const t = CONTACT_TYPES[l.type] || CONTACT_TYPES.other;
  return `<div class="link-row">
    <select aria-label="サービス">${typeOptions(l.type)}</select>
    <input class="lv" aria-label="URL または ID" maxlength="200" value="${esc(l.value)}" placeholder="${esc(t.ph)}">
    <input class="ln" aria-label="メモ" maxlength="40" value="${esc(l.note || '')}" placeholder="メモ（例：夜なら話せます）">
    <button class="remove" type="button" aria-label="この連絡先を削除">×</button>
  </div>`;
}

function bindLinkRows() {
  $$('#link-rows .link-row').forEach(row => {
    const sel = $('select', row);
    sel.onchange = () => { $('.lv', row).placeholder = (CONTACT_TYPES[sel.value] || {}).ph || ''; };
    $('.remove', row).onclick = () => { row.remove(); };
  });
}

function collectLinks() {
  return $$('#link-rows .link-row').map(row => ({
    type: $('select', row).value,
    value: $('.lv', row).value.trim(),
    note: $('.ln', row).value.trim()
  })).filter(l => l.value);
}

function linkValueHtml(l) {
  const t = CONTACT_TYPES[l.type] || CONTACT_TYPES.other;
  let href = '';
  if (t.kind === 'url' && /^https:\/\//i.test(l.value)) href = l.value;
  if (t.kind === 'handle' && t.url && /^[A-Za-z0-9_.]+$/.test(l.value)) href = t.url(l.value);
  const shown = t.kind === 'handle' ? '@' + l.value : l.value;
  const main = href
    ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer nofollow">${esc(shown)}</a>`
    : esc(shown);
  return `<li><span class="svc">${esc(t.label)}</span>
    <span class="val">${main}${l.note ? `<br><span class="note">${esc(l.note)}</span>` : ''}</span>
    <button class="copy-btn" type="button" data-copy="${esc(l.value)}">コピー</button></li>`;
}

function renderConnections(list) {
  const ul = $('#connection-list');
  if (!list.length) {
    ul.innerHTML = '<li class="empty">まだマッチした人はいません。マップで気になる人に「お話ししたい」を送ってみましょう。</li>';
    return;
  }
  ul.innerHTML = list.map(c => {
    let status, action;
    if (c.links) {
      status = '相互承認済みです。下の連絡先から話しかけてみましょう。';
      action = `<button class="btn btn-ghost" data-revoke="${esc(c.userId)}" type="button">承認を取り消す</button>`;
    } else if (c.iApproved && c.theyApproved) {
      status = '相手の同意の更新を待っています。';
      action = `<button class="btn btn-ghost" data-revoke="${esc(c.userId)}" type="button">承認を取り消す</button>`;
    } else if (c.iApproved) {
      status = '承認しました。相手の承認を待っています。';
      action = `<button class="btn btn-ghost" data-revoke="${esc(c.userId)}" type="button">承認を取り消す</button>`;
    } else if (c.theyApproved) {
      status = '相手が承認しました。あなたも承認すると、おたがいの連絡先が表示されます。';
      action = `<button class="btn btn-primary" data-approve="${esc(c.userId)}" data-name="${esc(c.nickname)}" type="button">承認する</button>`;
    } else {
      status = 'まだどちらも承認していません。';
      action = `<button class="btn btn-primary" data-approve="${esc(c.userId)}" data-name="${esc(c.nickname)}" type="button">承認する</button>`;
    }
    const links = c.links
      ? (c.links.length ? `<ul class="conn-links">${c.links.map(linkValueHtml).join('')}</ul>` : '<p class="note">相手はまだ連絡先を登録していません。</p>')
      : '';
    return `<li class="${c.links ? 'is-open' : ''}">
      <span class="conn-name">${esc(c.nickname)}</span> <span class="conn-badge">${esc(c.badge)}</span>
      <p class="conn-status">${status}</p>${links}
      <div class="row">${action}<button class="btn btn-ghost" data-profile="${esc(c.userId)}" type="button">プロフィールを見る</button></div>
    </li>`;
  }).join('');

  $$('[data-approve]', ul).forEach(b => b.addEventListener('click', () => {
    if (!collectLinks().length && !state.links.length) return toast('先に、あなたの連絡先を登録して保存してください。', true);
    if (!confirm(`${b.dataset.name} さんを承認します。相手も承認すると、あなたが登録した連絡先が相手に表示されます。よろしいですか？`)) return;
    busy(b, async () => {
      const r = await call('approveContact', { toUserId: b.dataset.approve });
      toast(r.message);
      loadConnect();
    });
  }));
  $$('[data-revoke]', ul).forEach(b => b.addEventListener('click', () => {
    if (!confirm('承認を取り消しますか？ 相手からあなたの連絡先が見えなくなります。')) return;
    busy(b, async () => {
      const r = await call('revokeContact', { toUserId: b.dataset.revoke });
      toast(r.message);
      loadConnect();
    });
  }));
  $$('[data-profile]', ul).forEach(b => b.addEventListener('click', () => openUser(b.dataset.profile)));
  $$('[data-copy]', ul).forEach(b => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast('コピーしました。'); }
    catch (e) { toast('コピーできませんでした。長押しで選択してください。', true); }
  }));
}

function setupConnect() {
  const form = $('#form-terms');
  const boxes = $$('input[type=checkbox]', form);
  boxes.forEach(cb => cb.addEventListener('change', () => {
    $('#btn-terms-agree').disabled = !boxes.every(x => x.checked);
  }));
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!boxes.every(x => x.checked)) return toast('すべての項目にチェックしてください。', true);
    const checks = Object.fromEntries(boxes.map(x => [x.name, x.checked]));
    busy(submitBtn(e), async () => {
      const r = await call('agreeTerms', { version: state.termsVersion, checks });
      toast(r.message);
      await loadConnect();
    });
  });

  if (CFG.OPERATOR_CONTACT) {
    const p = $('#operator-contact');
    p.textContent = `迷惑行為や規約違反の報告：${CFG.OPERATOR_CONTACT}`;
    p.hidden = false;
  }

  $('#btn-add-link').addEventListener('click', () => {
    if ($$('#link-rows .link-row').length >= 8) return toast('連絡先は8件までです。', true);
    $('#link-rows').insertAdjacentHTML('beforeend', linkRowHtml({ type: 'zoom', value: '', note: '' }));
    bindLinkRows();
  });
  $('#btn-save-links').addEventListener('click', e => busy(e.currentTarget, async () => {
    const r = await call('saveContacts', { links: collectLinks() });
    state.links = r.links;
    renderLinkRows(r.links.length ? r.links : [{ type: 'zoom', value: '', note: '' }]);
    toast(r.message);
  }));
  $('#btn-show-terms').addEventListener('click', () => {
    const panel = $('#terms-panel');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

/* =========================================================
 * マイページ
 * ======================================================= */
function renderMyPage() {
  const p = state.profile;
  const f = $('#form-profile');
  f.nickname.value = state.user ? state.user.nickname : '';
  f.bio.value = p ? (p.bio || '') : '';
  $('#btn-delete-intro').hidden = !(p && p.hasIntro);
  $('#my-summary').innerHTML = p
    ? `<p class="result-kicker" style="margin:0">あなたの称号</p>
       <h3 class="detail-badge" style="padding:0">${esc(p.badge)}</h3>
       <p class="note" style="margin-bottom:16px">${esc(p.detectedDialect)}｜${esc(state.user.email)}</p>`
    : `<p class="note" style="margin-bottom:16px">${esc(state.user ? state.user.email : '')}</p>`;
}

function setupMyPage() {
  $('#form-profile').addEventListener('submit', e => {
    e.preventDefault();
    const f = formData(e.target);
    if (!f.nickname.trim()) return toast('ニックネームを入力してください。', true);
    busy(submitBtn(e), async () => {
      const r = await call('updateProfile', { nickname: f.nickname.trim(), bio: f.bio.trim() });
      state.user.nickname = f.nickname.trim();
      if (state.profile) state.profile.bio = f.bio.trim();
      toast(r.message);
    });
  });
  $('#btn-rediagnose').addEventListener('click', startDiagnosis);
  $('#btn-change-pass').addEventListener('click', () => openPassModal(false));
  $('#btn-delete-intro').addEventListener('click', e => {
    if (!confirm('公開中のひとことボイスを削除しますか？')) return;
    busy(e.currentTarget, async () => {
      const r = await call('deleteIntro');
      if (state.profile) state.profile.hasIntro = false;
      toast(r.message);
      renderMyPage();
    });
  });
  $('#btn-logout').addEventListener('click', async () => {
    try { await call('logout'); } catch (e) { /* 失敗してもローカルは消す */ }
    logoutLocal();
  });
}

/* =========================================================
 * 起動
 * ======================================================= */
function setupHelp() {
  const open = () => { stopPlayback(); $('#modal-detail').hidden = true; show('help'); };
  $('#btn-help').addEventListener('click', open);
  $$('[data-open-help]').forEach(b => b.addEventListener('click', open));
  $('#btn-help-back').addEventListener('click', () => {
    if (!state.user) return show('auth');
    if (state.user.mustChange) { $$('.screen').forEach(s => { s.hidden = true; }); return openPassModal(true); }
    show(state.current && state.current !== 'auth' ? state.current : (state.profile ? 'map' : 'diagnose'));
  });
}

function setupNav() {
  $$('[data-go]').forEach(b => b.addEventListener('click', e => {
    e.preventDefault();
    if (!state.user || state.user.mustChange) return;
    if (b.dataset.go === 'map' && !state.profile) return startDiagnosis();
    show(b.dataset.go);
  }));
}

async function boot() {
  $('#app-version').textContent = `${CFG.APP_NAME} ${CFG.VERSION}`;
  setupBackground();
  setupPasswordToggles();
  setupAuth();
  setupDiagnosis();
  setupMap();
  setupModals();
  setupMyPage();
  setupNav();
  setupHelp();
  setupConnect();

  if (!session.token) { show('auth'); return; }
  try {
    const r = await call('me');
    await afterLogin(r.user, r.profile, r.unread);
  } catch (e) {
    session.token = '';
    show('auth');
    if (e.code !== 'AUTH') toast(e.message, true);
  }
}

boot();
