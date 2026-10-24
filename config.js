/**
 * こえいろマップ～マッチングサイト 設定ファイル
 * 環境を移すときは、このファイルだけ書き換えればOKです。
 */
window.APP_CONFIG = {
  APP_NAME: 'こえいろマップ～マッチングサイト',
  VERSION: 'v1.1.2-beta',

  // GAS Webアプリの URL（デプロイ → ウェブアプリ のURL。末尾は /exec）
  GAS_URL: 'https://script.google.com/macros/s/AKfycbxOIQTyUYkIOZu7LqfUeMjJKEQp6uIhjex-b6IqnxoysEi5MtzODnxI_x4c8DGMY7mr/exec',

  // 運営への連絡先（迷惑行為の報告などに表示。空なら非表示）
  OPERATOR_CONTACT: '',

  // 録音の上限（秒）
  READING_MAX_SEC: 30,
  INTRO_MAX_SEC: 10,

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
