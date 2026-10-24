# こえいろマップ～マッチングサイト（koe-iro-map） v1.1.1-beta

お題文を音読すると、Gemini が「テンション／方言の濃さ／テンポ」の3軸で話し方を診断し、4象限マップ上で波長の合う人・真逆の人を探して交流できる Web アプリです。

## 1. ディレクトリ構成

```
koe-iro-map/
├── index.html          画面（認証・診断・マップ・リアクション・マイページ）
├── config.js           GAS URL・バージョン・動画パスなどの設定
├── css/
│   └── style.css
├── js/
│   ├── api.js          GAS通信（プリフライト無しのPOST）
│   ├── audio.js        録音・16kHz WAV変換・波形・TTS再生
│   ├── map.js          SVG 4象限マップ・相性計算
│   └── app.js          画面制御・認証・診断・リアクション
├── videos/             Google Earth Studio の書き出し動画（mp4）
│   ├── bg-loop.mp4     背景ループ
│   ├── japan.mp4       標準語・不明のとき
│   └── hokkaido.mp4 … okinawa.mp4（地域ごとのズームイン）
├── gas/
│   ├── Code.gs         バックエンド（GASに貼り付け）
│   └── appsscript.json マニフェスト
└── README.md
```

## 2. スプレッドシートのテーブル定義

`setup()` を実行すると自動で作成されます。

**Users**（会員）

| カラム | 内容 |
|---|---|
| userId | `u_` + 16桁ID |
| email | 小文字に正規化 |
| nickname | 20文字まで |
| passHash | SHA-256（ソルト付き・300回ストレッチ） |
| salt | UUID（パスワード変更のたびに更新） |
| mustChange | TRUE＝仮パスワード中（初回ログイン時に変更を強制） |
| failCount / lockedUntil | 5回失敗で15分ロック |
| status | active / suspended |
| createdAt / lastLoginAt | ISO日時 |
| termsVersion / termsAgreedAt | 同意した利用上の注意の版と日時 |

**Sessions**：token / userId / expiresAt（7日）/ createdAt

**Profiles**（診断結果）

| カラム | 内容 |
|---|---|
| userId | Users と対応 |
| toneScore | -100 落ち着き（メロウ）〜 +100 ハイテンション |
| dialectScore | -100 標準語 〜 +100 方言が濃い |
| tempoScore | -100 ロジカル・早口 〜 +100 まったり・ゆるふわ |
| detectedDialect / regionKey | 方言名／地域キー（演出動画の選択に使用） |
| badge / summary / tags | 称号／講評／特徴タグ（JSON配列） |
| bio | ひとこと紹介 |
| readingFileId | 音読録音（Drive・非公開、再診断時に古いものはゴミ箱へ） |
| introFileId | ひとことボイス（会員だけが GAS 経由で再生） |
| promptId / diagnosedAt / updatedAt | |

**Reactions**：reactionId / fromUserId / toUserId / type（talk・voice・dialect・smile）/ message / createdAt / readAt
同じ相手に同じリアクションは24時間に1回。双方が「お話ししたい」を送るとマッチ。

**Contacts**（連絡先）：userId / links（JSON配列 `{type, value, note}`、8件まで）/ updatedAt

**Approvals**（連絡先公開の承認）：fromUserId / toUserId / createdAt / revokedAt
連絡先が表示される条件は、①相互マッチ、②双方が利用上の注意に同意（最新版）、③双方が承認（取り消していない）、のすべてを満たすこと。サーバー側で判定するので、条件を満たさない相手の連絡先はブラウザに送られません。

### 既存環境を v1.1.0 に上げるとき

Code.gs を差し替えたあと、もう一度 `setup()` を実行してください。Users に2列が追加され、Contacts・Approvals シートが作られます（既存データは消えません）。

### 利用上の注意を変えるとき

index.html の「連絡先を交換する前に」の文面を直したら、Code.gs の `TERMS_VERSION` を新しい日付に変えて再デプロイします。全員に再同意が求められ、再同意するまで連絡先は表示されません。迷惑行為の報告先は config.js の `OPERATOR_CONTACT` に設定すると表示されます。

## 3. GAS のセットアップ

1. https://script.google.com で新規プロジェクトを作成し、`Code.gs` を貼り付け。
2. 「プロジェクトの設定」→「appsscript.json をエディタで表示」をオンにして、`appsscript.json` を貼り付け。
3. エディタで関数 `setup` を選んで実行し、権限を承認。
   スプレッドシート「こえいろマップDB」と Drive フォルダ `koe-iro-map/readings・intros・tts_cache` が作られ、ID がスクリプトプロパティに保存されます。セッション掃除のトリガー（毎日4時）も登録されます。
4. 「プロジェクトの設定」→「スクリプトプロパティ」に追加：
   - `GEMINI_API_KEY`（必須）
   - `APP_URL`（メール本文に載せる公開URL。例 `https://kenken6291.github.io/koe-iro-map/`）
   - 必要なら `GEMINI_MODEL`・`GEMINI_TTS_MODEL`・`TTS_VOICE` でモデルや声を変更（既定は `gemini-2.5-flash`／`gemini-2.5-flash-preview-tts`／`Kore`）。
5. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
   - 次のユーザーとして実行：**自分**
   - アクセスできるユーザー：**全員**
6. 発行された `/exec` の URL を `config.js` の `GAS_URL` に設定。
   コードを更新したときは「デプロイを管理」→ 既存デプロイを編集 →「新バージョン」にすると URL が変わりません。

### CORS 対策

- フロントは `fetch(GAS_URL, { method: 'POST', body: JSON文字列 })` で **Content-Type ヘッダーを付けずに** 送っています。これで `text/plain` の「単純リクエスト」になり、GAS が対応していないプリフライト（OPTIONS）が発生しません。
- GAS は `ContentService` で JSON を返し、リダイレクト先（googleusercontent.com）は CORS 許可済みなので、そのまま `res.json()` で読めます。
- `doGet` は疎通確認用です。ブラウザで `/exec` を開いて `{"ok":true,...}` が出ればデプロイ成功です。

## 4. Google Drive の権限

- ファイルはすべて **デプロイしたあなたのドライブ** に保存され、共有設定は「制限付き」のままで動きます。リンク共有にする必要はありません。
- ひとことボイスは GAS がログイン中の会員にだけ Base64 で返すので、URL が外に出ません。
- 音読録音（readings）は診断専用で、他の会員には公開されません。
- TTS キャッシュ（tts_cache）は同じ文章の再生成を防ぐためのもので、不要になったら中身を削除して構いません。

## 5. GitHub Pages への公開

1. リポジトリ `koe-iro-map` を作成し、`gas/` 以外のファイル一式を push（`gas/` を一緒に置いても公開に影響はありません）。
2. Settings → Pages → Branch を `main` / `(root)` にして保存。
3. `https://kenken6291.github.io/koe-iro-map/` で表示確認。マイク録音は HTTPS 必須ですが GitHub Pages は HTTPS なのでそのまま使えます。

## 6. Google Earth Studio 動画の作り方

- 地域ごとに「日本全体 → その地方の街並みへズームイン」する 5〜8 秒のフライトを作成。
- 書き出しは 1280×720・30fps 程度で連番画像 → ffmpeg で mp4（H.264）に変換するとサイズが抑えられます。
  `ffmpeg -framerate 30 -i frame_%03d.jpeg -c:v libx264 -pix_fmt yuv420p -crf 26 -movflags +faststart kansai.mp4`
- 背景ループ（`bg-loop.mp4`）は音なし・10〜20秒・ゆっくり旋回するカメラがおすすめ（画面上は半透明の幕を重ねています）。
- Earth Studio の利用規約に従い、映像内のクレジット（Google Earth のロゴ・データ提供表示）は消さないでください。
- 動画が無い地域は自動で文字アニメーションの演出に切り替わるので、少しずつ追加して大丈夫です。

## 7. 主なAPIアクション（POST `{action, token, ...}`）

| action | 内容 |
|---|---|
| register / login / logout | 登録（仮パスワードをメール送信）／ログイン／ログアウト |
| changePassword / forgotPassword | パスワード変更／仮パスワード再発行 |
| me | ログイン状態・プロフィール・未読数 |
| getPrompt / tts | お題取得／Gemini TTS（Driveにキャッシュ） |
| analyzeVoice | 音読WAVをDrive保存→Gemini解析→Profiles更新 |
| uploadIntro / deleteIntro / getVoice | ひとことボイスの公開・削除・再生 |
| updateProfile / listProfiles | プロフィール更新／マップ用一覧 |
| sendReaction / getInbox | リアクション送信／受信一覧とマッチ |
| agreeTerms | 利用上の注意・免責事項への同意を記録 |
| getMyContacts / saveContacts | 自分の連絡先の取得・保存 |
| getConnections | マッチ一覧と承認状況（相互承認済みの相手だけ連絡先つき） |
| approveContact / revokeContact | 連絡先公開の承認／取り消し |

## 8. 運用メモ

- 仮パスワードのまま（mustChange=TRUE）だと、サーバー側でもパスワード変更以外の操作を拒否します。
- 利用停止は Users シートの `status` を `suspended` に変更。
- 会員数が数百人を超えて重くなってきたら、Profiles の一覧結果を CacheService に数分キャッシュすると軽くなります。
