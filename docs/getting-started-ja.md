[English version](getting-started.md)

# はじめに

このガイドでは agent-log-replayer の起動と、ライブエージェントセッションの観察手順を説明します。

## 前提条件

- Node.js ≥ 20
- agent-log-broker が起動・アクセス可能な状態（デフォルト: `http://localhost:3100`）
- broker が監視するログファイルに書き込む AI エージェント（例: Claude Code）

## 1. 依存関係のインストール

```bash
cd agent-log-replayer
npm install
```

## 2. 環境変数の設定（任意）

ローカル開発ではデフォルト値で動作します。必要に応じて環境変数で上書きしてください:

```bash
export PORT=3200
export BROKER_URL=http://localhost:3100
export CALLBACK_URL=http://localhost:3200/api/broker/callback
export DB_PATH=./data/sessions.db
```

## 3. ビルドと起動

```bash
npm run build
npm start
```

以下のようなログが表示されます:

```
[replayer] Listening on http://localhost:3200
[replayer] Subscribed to broker as agent-log-replayer-1713500000000
```

## 4. UI を開く

ブラウザで `http://localhost:3200` にアクセスします。

broker が最初のイベントを配信するまで、左側の**セッションリスト**パネルは空です。

## 5. エージェントセッションを開始する

broker が監視するように設定されたエージェントを起動します。例として Claude Code:

```bash
cd /your/project
claude
```

数秒以内にセッションリストにセッションが表示されます。

## 6. セッションを再生する

1. **セッションリスト**のセッションをクリックします。
2. 再生コントロール付きの**セッションプレイヤー**が開きます。
3. **再生**を押すか、シークバーでセッション内を移動します。
4. **TerminalView**、**TimelineView**、**SecurityPanel** の各エリアは現在プレースホルダースタブです — 実装後にコンテンツが表示されます。

## 7. 過去のセッションを参照する

過去のセッションは起動時に SQLite から読み込まれます。`archived` ステータスでセッションリストに表示されます。

アーカイブ済みセッションをクリックして REST API 経由でメッセージを確認できます:

```bash
# 全セッション一覧
curl http://localhost:3200/api/sessions

# 特定セッションの詳細（メッセージ含む）
curl http://localhost:3200/api/sessions/<sessionId>

# タイムラインイベント取得
curl http://localhost:3200/api/sessions/<sessionId>/timeline

# broker 接続確認
curl http://localhost:3200/api/status
```

## 8. 開発ワークフロー

バックエンドとフロントエンドを同時にウォッチモードで起動します:

```bash
# ターミナル 1
npm run dev

# ターミナル 2
npm run dev:frontend
```

フロントエンドの変更は Vite によるホットリロードが機能します。バックエンドの変更は再起動が必要です。

## 既知の制限事項

- **TerminalView**、**TimelineView**、**SecurityPanel** はプレースホルダースタブです — 静的シェルのみレンダリングされます。
- **consumerId** は再起動ごとに変化します。これにより broker にスタレなコンシューマーレコードが蓄積されます。[decisions/consumer-id-instability.md](decisions/consumer-id-instability.md) を参照してください。
- **テスト: 0 件。** 自動テストは存在しません。手動検証のみです。
