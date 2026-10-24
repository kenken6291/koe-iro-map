// 録音、16kHz WAV 変換、波形アニメーション、TTS 再生
const AC = window.AudioContext || window.webkitAudioContext;

export class VoiceRecorder {
  constructor(canvas, { maxSec = 30, onTick = () => {}, onAutoStop = () => {} } = {}) {
    this.canvas = canvas;
    this.maxSec = maxSec;
    this.onTick = onTick;
    this.onAutoStop = onAutoStop;
    this.recording = false;
  }

  async start() {
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      throw new Error('このブラウザは録音に対応していません。Chrome か Safari の最新版でお試しください。');
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      throw new Error('マイクが使えません。ブラウザのマイク許可を「許可」にしてください。');
    }
    this.ctx = new AC();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    src.connect(this.analyser);

    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    const mime = types.find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
    this.chunks = [];
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.rec.ondataavailable = e => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.rec.start(250);
    this.recording = true;
    this.startedAt = performance.now();
    this._loop();
  }

  _loop() {
    if (!this.recording) return;
    const sec = (performance.now() - this.startedAt) / 1000;
    this.onTick(sec);
    drawWave(this.canvas, this.analyser);
    if (sec >= this.maxSec) { this.onAutoStop(); return; }
    this.raf = requestAnimationFrame(() => this._loop());
  }

  stop() {
    return new Promise(resolve => {
      if (!this.rec || this.rec.state === 'inactive') return resolve(null);
      this.recording = false;
      cancelAnimationFrame(this.raf);
      this.rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.rec.mimeType || 'audio/webm' });
        this.stream.getTracks().forEach(t => t.stop());
        this.ctx.close();
        clearCanvas(this.canvas);
        resolve(blob);
      };
      this.rec.stop();
    });
  }

  cancel() {
    this.recording = false;
    cancelAnimationFrame(this.raf);
    try { this.rec && this.rec.state !== 'inactive' && this.rec.stop(); } catch (e) { /* 無視 */ }
    this.stream && this.stream.getTracks().forEach(t => t.stop());
    this.ctx && this.ctx.state !== 'closed' && this.ctx.close();
    clearCanvas(this.canvas);
  }
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawWave(canvas, analyser) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  // 縦棒の声紋風表示
  const bars = Math.max(24, Math.floor(w / 7));
  const step = Math.floor(data.length / bars);
  g.fillStyle = cssVar('--wave');
  for (let i = 0; i < bars; i++) {
    let peak = 0;
    for (let j = 0; j < step; j++) peak = Math.max(peak, Math.abs(data[i * step + j] - 128));
    const bh = Math.max(2, (peak / 128) * h * 1.6);
    const x = i * (w / bars);
    g.fillRect(x, (h - Math.min(h, bh)) / 2, Math.max(2, w / bars - 3), Math.min(h, bh));
  }
}

function clearCanvas(canvas) {
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
}

/** 録音Blob → 16kHz モノラル WAV（Uint8Array）。Gemini が確実に読める形式にそろえる */
export async function blobToWav16k(blob) {
  const buf = await blob.arrayBuffer();
  const ctx = new AC();
  const decoded = await new Promise((res, rej) => ctx.decodeAudioData(buf, res, rej));
  ctx.close();
  const rate = 16000;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const off = new OAC(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  return { wav: encodeWav(rendered.getChannelData(0), rate), duration: decoded.duration };
}

function encodeWav(samples, rate) {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return wrapPcm16(new Uint8Array(pcm.buffer), rate);
}

function wrapPcm16(bytes, rate) {
  const out = new Uint8Array(44 + bytes.length);
  const v = new DataView(out.buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); v.setUint32(4, 36 + bytes.length, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, bytes.length, true);
  out.set(bytes, 44);
  return out;
}

export function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Gemini TTS の生PCM(16bit/24kHz) → 再生用 Blob URL */
export function pcmToWavUrl(b64, rate = 24000) {
  return URL.createObjectURL(new Blob([wrapPcm16(base64ToBytes(b64), rate)], { type: 'audio/wav' }));
}

export function base64ToUrl(b64, mime = 'audio/wav') {
  return URL.createObjectURL(new Blob([base64ToBytes(b64)], { type: mime }));
}

/** 再生中の音声を1つに保つプレーヤー */
let current = null;
export function playUrl(url) {
  stopPlayback();
  current = new Audio(url);
  current.play().catch(() => {});
  return current;
}
export function stopPlayback() {
  if (current) { current.pause(); current = null; }
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}

/** TTS が使えないときのブラウザ読み上げ */
export function speakFallback(text) {
  if (!window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ja-JP';
  u.rate = 0.95;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}
