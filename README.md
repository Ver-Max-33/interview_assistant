# 面接アシスタント (AI Interview Assistant)

日本の転職面接をサポートするmacOSデスクトップアプリケーション

## 技術スタック

- **フロントエンド**: React 18 + TypeScript
- **デスクトップフレームワーク**: Tauri 2.0
- **スタイリング**: Tailwind CSS
- **アイコン**: Lucide React
- **AI**: OpenAI Realtime API + GPT-4

## 機能

### 1. 準備フェーズ（WelcomeView）
- **基本資料**: 履歴書・職務経歴書のアップロード/入力
- **面接情報**: 業界・企業・職種情報の入力
- **面接稿**: 想定Q&Aの登録（必須）
- **音声設定**: システムオーディオ/マイク入力の選択

### 2. 面接フェーズ（MainView）
- リアルタイム音声認識（OpenAI Realtime API）
- 会話履歴の表示
- AI回答案の自動生成
- 面接稿マッチング（Embeddings API使用）

### 3. 設定（SettingsView）
- API設定（OpenAI APIキー、モデル選択）
- 音声設定（デバイス、音量、ノイズ除去）
- AI回答設定（長さ、具体例、面接稿優先度）
- プライバシー設定（保存期間、保存場所）
- 表示設定（フォントサイズ、テーマ）

## セットアップ

### 前提条件

- Node.js 18+
- Rust 1.70+
- macOS 10.13+

### インストール

```bash
# 依存関係のインストール
npm install

# 開発サーバーの起動
npm run tauri:dev

# ビルド（macOS .dmg）
npm run tauri:build
```

### OpenAI APIキーの取得

1. [OpenAI Platform](https://platform.openai.com/)にアクセス
2. APIキーを生成
3. アプリの設定画面でAPIキーを入力

### システムオーディオ設定（推奨）

BlackHoleを使用してシステムオーディオをキャプチャ:

```bash
# HomebrewでBlackHoleをインストール
brew install blackhole-2ch

# Audio MIDI設定でMulti-Output Deviceを作成
# 1. /Applications/Utilities/Audio MIDI Setup.appを開く
# 2. 左下の「+」→「Create Multi-Output Device」
# 3. 内蔵スピーカーとBlackHole 2chを選択
# 4. システム環境設定→サウンド→出力をMulti-Output Deviceに設定
```

## 使い方

### 0. API機能テスト（重要）

**面接を開始する前に、必ず実行してください！**

1. 設定画面（⚙️）を開く
2. APIキーを入力
3. **「すべてテスト」ボタンをクリック**
4. 4つのテストすべてが✅になることを確認：
   - API接続テスト
   - LLM応答テスト
   - Realtime API接続テスト
   - マイクアクセステスト

詳細は [API_TEST_GUIDE.md](./API_TEST_GUIDE.md) を参照してください。

### 1. 準備

1. **基本資料**タブ: 履歴書・職務経歴書を入力
2. **面接情報**タブ: 業界・企業名・職種を入力
3. **面接稿**タブ: 想定Q&Aを入力（必須）
4. **音声設定**タブ: システムオーディオを選択（推奨）
5. 「面接を開始」ボタンをクリック

### 2. 面接

1. 「録音開始」ボタンをクリック
2. Google Meet等で面接を開始
3. 面接官の質問が自動的に文字起こしされる
4. 右パネルにAI回答案が表示される
5. 回答案を参考に自分の言葉で回答

### 3. 面接稿マッチングの仕組み

- **完全一致**: 面接稿の質問と完全一致→そのまま使用
- **類似（85%以上）**: 類似した質問→面接稿を参考に生成
- **なし**: 面接稿にない質問→5W1H原則で新規生成

## プロジェクト構造

```
src/
├── App.tsx                     # メインアプリケーション
├── main.tsx                    # エントリーポイント
├── index.css                   # グローバルスタイル
├── components/
│   ├── WelcomeView.tsx        # 準備画面
│   ├── MainView.tsx           # 面接画面
│   └── SettingsView.tsx       # 設定画面
├── services/
│   ├── openai.ts              # OpenAI Realtime API
│   ├── storage.ts             # ローカルストレージ
│   └── script-matcher.ts      # 面接稿マッチング
├── types/
│   └── index.ts               # 型定義
└── utils/
    └── prompt-builder.ts      # システムプロンプト生成

src-tauri/
├── src/
│   ├── main.rs                # Tauriメイン
│   └── lib.rs                 # ライブラリ
├── Cargo.toml                 # Rust依存関係
└── tauri.conf.json           # Tauri設定
```

## ライセンス

MIT License

## サポート

問題が発生した場合は、GitHubのIssuesページで報告してください。

