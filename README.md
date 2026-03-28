# agent-log-replayer

agent-log-broker のコンシューマーとして動作する、ブラウザベースの LLM セッションリプレイヤー。

## 概要

agent-log-replayer は [agent-log-broker](../agent-log-broker/) からリアルタイムにイベントを受信し、AI エージェントのセッションを可視化・再生・監査するための Web UI を提供します。

### claude-session-replay との関係

本プロジェクトは [claude-session-replay](../claude-session-replay/) の進化版です。置き換えではありません。

| 観点 | claude-session-replay | agent-log-replayer |
|------|----------------------|-------------------|
| データ取得 | ログファイルを直接読み取り | agent-log-broker から受信 |
| パース | 自前のアダプター（log2model） | broker が事前にパース済み |
| UI | Flask + 自己完結 HTML | React + WebSocket リアルタイム |
| セッション状態 | ファイルベース（毎回スキャン） | SQLite で永続化 + リアルタイム更新 |
| ライブ表示 | なし（ファイル完了後のみ） | 進行中セッションのリアルタイム表示 |

claude-session-replay のデータモデル、レンダリング概念、エージェントアダプターの知見は本プロジェクトに引き継がれています。

### agent-log-broker との関係

agent-log-replayer は agent-log-broker の **コンシューマー** として動作します。

```
agent-log-broker                    agent-log-replayer
┌──────────────┐   HTTP callback   ┌──────────────────┐
│ FileWatcher  │ ────────────────> │ broker-client.ts  │
│ Parse/Redact │   BrokerEvent     │ session-manager   │
│ Distribute   │                   │ SQLite + WS       │
└──────────────┘                   └──────────────────┘
                                          │
                                          ▼ WebSocket
                                   ┌──────────────────┐
                                   │ React Web UI      │
                                   │ (ブラウザ)         │
                                   └──────────────────┘
```

broker に `full_stream` モードでサブスクライブし、全メッセージイベントを受信します。

## 主な機能

- **リアルタイムセッション表示**: 進行中のエージェントセッションをリアルタイムで閲覧
- **セッション再生**: 再生コントロール付きのセッションリプレイ（再生/一時停止、シーク、速度調整）
- **タイムライン可視化**: ツール呼び出し、イベント発生のタイムライン表示
- **ターミナル再現**: xterm.js によるターミナル出力の忠実な再現
- **ファイル差分表示**: Edit/Write ツールによるファイル変更の差分ビジュアライゼーション
- **セキュリティ監査**: セキュリティフラグ表示、禁止語ハイライト
- **セッション永続化**: SQLite によるセッション履歴の保存と検索

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| サーバー | TypeScript, Express, WebSocket (ws) |
| フロントエンド | React, Zustand, xterm.js |
| ストレージ | SQLite (better-sqlite3) |
| 通信 | HTTP callback (broker → replayer), WebSocket (replayer → ブラウザ) |
| ビルド | Vite, TypeScript |

## セットアップ

```bash
npm install
npm run build
npm start
```

### 開発

```bash
# サーバー（バックエンド）
npm run dev

# フロントエンド（別ターミナル）
npm run dev:frontend
```

## 設定

環境変数:

| 変数 | デフォルト | 説明 |
|------|----------|------|
| `PORT` | `3200` | HTTP/WebSocket サーバーポート |
| `BROKER_URL` | `http://localhost:3100` | agent-log-broker の URL |
| `CALLBACK_URL` | `http://localhost:3200/api/broker/callback` | broker からのコールバック URL |
| `DB_PATH` | `./data/sessions.db` | SQLite データベースパス |

## ドキュメント

- [アーキテクチャ](docs/architecture.md) - システム設計概要
- [claude-session-replay からの移行](docs/migration-from-session-replay.md) - 移行ガイド
