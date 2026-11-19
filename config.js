/**
 * こえいろマップ～マッチングサイト 設定ファイル
 * 環境を移すときは、このファイルだけ書き換えればOKです。
 */
window.APP_CONFIG = {
  APP_NAME: 'こえいろマップ～マッチングサイト',
  VERSION: 'v1.3.0-beta',

  // GAS Webアプリの URL（デプロイ → ウェブアプリ のURL。末尾は /exec）
  GAS_URL: 'https://script.google.com/macros/s/AKfycbxOIQTyUYkIOZu7LqfUeMjJKEQp6uIhjex-b6IqnxoysEi5MtzODnxI_x4c8DGMY7mr/exec',

  // 既定のGeminiモデル（ユーザーが画面で選んでいない時に使う）
  // 空文字 '' = 自動（汎用の最新モデル）
  GEMINI_MODEL: '',

  // 画面の「診断に使うAIモデル」の選択肢（value がAPIのモデルID）
  // 指定モデルに該当がない（廃止・未公開・名前違い）場合は
  // GAS側で汎用の最新モデルへ自動で切り替わる
  GEMINI_MODEL_OPTIONS: [
    { value: '',                  label: '自動モード（汎用の最新）' },
    { value: 'gemini-4-hydrogen', label: '4 Hydrogen（日々の暮らしをサポート）' },
    { value: 'gemini-4-neon',     label: '4 Neon（Deeper analysis）' },
    { value: 'gemini-4-carbon',   label: '4 Carbon（Code & complex work）' },
    { value: 'gemini-4-argon',    label: '4 Argon' },
    { value: 'gemini-3.8-flash',  label: '3.8 Flash' },
    { value: 'gemini-3.5-flash',  label: '3.5 Flash' }
  ],

  // 運営への連絡先（迷惑行為の報告などに表示。空なら非表示）
  OPERATOR_CONTACT: '',

  // 録音の上限（秒）
  READING_MAX_SEC: 30,
  INTRO_MAX_SEC: 10,
  VOICE_MSG_MAX_SEC: 20,

  // 「近い人」「真逆の人」フィルターで光らせる人数
  MATCH_COUNT: 8,

  // ナビゲーション音声（Gemini TTS）を使うか
  NAV_VOICE: true,
  NAV_PHRASES: {
    beforeRecord: 'ボタンを押したら、画面の文章を、いつもの話し方で読んでください。',
    analyzing: 'あなたの声を聞いています。少しお待ちください。'
  },

  // Google Earth Studio で書き出した動画（videos/ に置く）
  // ファイルが無い地域は、自動でアニメーション演出に切り替わります。
  BACKGROUND_VIDEO: 'videos/bg-loop.mp4',
  REGION_VIDEOS: {
    hokkaido: 'videos/hokkaido.mp4',
    tohoku: 'videos/tohoku.mp4',
    kanto: 'videos/kanto.mp4',
    chubu: 'videos/chubu.mp4',
    kansai: 'videos/kansai.mp4',
    chugoku: 'videos/chugoku.mp4',
    shikoku: 'videos/shikoku.mp4',
    kyushu: 'videos/kyushu.mp4',
    okinawa: 'videos/okinawa.mp4',
    standard: 'videos/japan.mp4',
    unknown: 'videos/japan.mp4'
  }
};
