[English version](README.md)

# agent-log-replayer

ブラウザベースの LLM セッションリプレイヤー — **TypeScript、React、SQLite。**

[agent-log-broker](../agent-log-broker/) からイベントを受信し、AI エージェントのセッションをリアルタイムで再生・可視化・監査するための Web UI を提供します。

> **agent-log-replayer** はパイプラインの末端に位置します: broker が検出 → broker が配信 → replayer が永続化して再生。

---

## 目次

- [なぜ agent-log-replayer が必要か](#なぜ-agent-log-replayer-が必要か)
- [クイックスタート](#クイックスタート)
- [アーキテクチャ概要](#アーキテクチャ概要)
- [Broker 連携](#broker-連携)
- [SQLite ストレージ](#sqlite-ストレージ)
- [WebSocket / REST API](#websocket--rest-api)
- [レンダラー](#レンダラー)
- [セキュリティ監査](#セキュリティ監査)
- [フロントエンドコンポーネント](#フロントエンドコンポーネント)
- [設定](#設定)
- [既知の問題 / バックログ](#既知の問題--バックログ)
- [テスト](#テスト)
- [claude-session-replay との関係](#claude-session-replay-との関係)

---

## なぜ agent-log-replayer が必要か

```
エージェントセッション実行
  → broker がログイベントを検出・リダクト・配信
  → replayer が受信、SQLite に永続化、ブラウザへストリーミング
  → ブラウザがセッションをフレーム単位で再生・監査
```

核心的な価値は**生ログファイルを読む必要がないこと**。replayer は構造化された、シーク可能で監査可能なビューを提供します — セッション実行中でも、完了後でも。

---

## クイックスタート

### 前提条件

- Node.js ≥ 20
- [agent-log-broker](../agent-log-broker/) が `http://localhost:3100` で起動済み

### インストールと起動

```bash
npm install
npm run build
npm start
```

ブラウザで `http://localhost:3200` を開きます。

### 開発モード

```bash
# ターミナル 1 — バックエンド
npm run dev

# ターミナル 2 — フロントエンド (Vite dev サーバー)
npm run dev:frontend
```

---

## アーキテクチャ概要

3 層構成:

```
Layer 1 — Consumer
  broker-client.ts    agent-log-broker にサブスクライブ (full_stream モード)
  session-manager.ts  セッション状態をメモリ上で管理

        │ BrokerEvent (HTTP callback)
        ▼

Layer 2 — Storage
  session-store.ts    セッション・メッセージ・セキュリティイベントを SQLite に永続化

        │ クエリ + リアルタイム通知
        ▼

Layer 3 — UI
  routes.ts           REST API (セッション、タイムライン、ステータス)
  websocket.ts        WebSocket リアルタイムイベントストリーミング
  React SPA           SessionList / SessionPlayer / TerminalView / TimelineView / SecurityPanel
```

詳細は [docs/architecture-ja.md](docs/architecture-ja.md) を参照してください。

---

## Broker 連携

agent-log-replayer は `mode: full_stream` で agent-log-broker の**コンシューマー**として登録します。

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

### BrokerEvent 種別

| 種別 | アクション |
|------|-----------|
| `session.discovered` | セッションレコードをメモリ + SQLite に作成 |
| `message` | メッセージを追加・永続化・WebSocket でブロードキャスト |
| `session.idle` | セッション状態を `idle` に更新 |
| `session.lost` | セッション状態を `lost` に更新 |

### 警告 — BrokerEvent 型二重定義リスク

`BrokerEvent` と `AgentMessage` は `src/consumer/broker-client.ts` で**ローカル再定義**されています。broker の正規型定義と常に同期が必要です。broker がフィールドを追加・変更した場合、このファイルを手動で更新しなければなりません。

詳細と解決策の選択肢は [docs/decisions/broker-event-type-duplication.md](docs/decisions/broker-event-type-duplication.md) を参照してください。

---

## SQLite ストレージ

セッション・メッセージ・セキュリティイベントは `better-sqlite3`（同期 API、WAL モード）を介して SQLite に永続化されます。

**テーブル構成:**

| テーブル | 説明 |
|---------|------|
| `sessions` | セッションメタデータ (status、agentType、projectPath、メッセージ数) |
| `messages` | セッションごとに `message_index` 順で格納された全メッセージ |
| `security_events` | セッションごとのセキュリティフラグ・禁止語ヒット |

起動時に `SessionManager.loadFromStore()` が過去のセッションを復元し、一覧に即座に表示されます。

---

## WebSocket / REST API

### REST

| メソッド | パス | 説明 |
|---------|------|------|
| `GET` | `/api/sessions` | セッション一覧 |
| `GET` | `/api/sessions/:id` | セッション詳細（メッセージ含む） |
| `GET` | `/api/sessions/:id/timeline` | タイムラインイベント |
| `GET` | `/api/status` | ヘルスチェック + broker 接続状態 |
| `POST` | `/api/broker/callback` | broker からの BrokerEvent 受信 |

### WebSocket (`ws://host:3200/ws`)

**サーバー → クライアント:**

```json
{ "type": "event",        "sessionId": "...", "event": { /* BrokerEvent */ } }
{ "type": "session.list", "sessions": [ /* SessionSummary[] */ ] }
{ "type": "error",        "message": "..." }
```

**クライアント → サーバー:**

```json
{ "type": "subscribe",   "sessionId": "..." }
{ "type": "unsubscribe" }
```

---

## レンダラー

3 つのサーバーサイドレンダラーモジュールが生の `AgentMessage` データを表示用フォーマットに変換します:

| モジュール | 出力 |
|-----------|------|
| `terminal-renderer.ts` | xterm.js 用 ANSI エスケープシーケンス |
| `timeline-renderer.ts` | 構造化タイムラインイベントリスト（ツール呼び出し、メッセージ、状態変化） |
| `diff-renderer.ts` | Edit/Write ツールイベントのファイル差分可視化 |

ターミナルレンダラーは `claude-session-replay` の視覚的慣習を引き継ぎます:
- ユーザーメッセージ: 青背景に `>` プロンプト
- アシスタントテキスト: オレンジ左ボーダー
- ツールブロック: ツール固有アイコン (📄 Read、📝 Write、✏️ Edit、`$` Bash、…)

---

## セキュリティ監査

`src/security/audit.ts` が broker から受信したセキュリティフラグと禁止語ヒットを集約します。broker が検出を行い、replayer が表示を担当します。

```typescript
interface SecurityFlag {
  type: string;
  severity: "info" | "warning" | "critical";
  description: string;
  messageIndex?: number;
}

interface BannedWordHit {
  word: string;
  context: string;
  messageIndex: number;
  field: string;
}
```

`requiresReview(summary)` は `critical` フラグまたは禁止語ヒットが存在する場合に `true` を返します。

---

## フロントエンドコンポーネント

| コンポーネント | 状態 | 説明 |
|--------------|------|------|
| `SessionList` | 実装済み | ステータスバッジ付きセッション一覧 |
| `SessionPlayer` | 実装済み | 再生コントロール（再生/一時停止、シーク、速度） |
| `TerminalView` | **TODO プレースホルダー** | xterm.js ターミナル — セッションストアへの接続未実装 |
| `TimelineView` | **TODO プレースホルダー** | タイムラインイベント — API からの取得未実装 |
| `SecurityPanel` | **TODO プレースホルダー** | セキュリティフラグ表示 — セッションストアへの接続未実装 |

3 つのプレースホルダーコンポーネントは必要な接続を示す `// TODO` コメント付きの静的 UI シェルをレンダリングします。意図的に未完成の状態です。

---

## 設定

| 変数 | デフォルト | 説明 |
|------|----------|------|
| `PORT` | `3200` | HTTP/WebSocket サーバーポート |
| `BROKER_URL` | `http://localhost:3100` | agent-log-broker の URL |
| `CALLBACK_URL` | `http://localhost:3200/api/broker/callback` | broker に登録するコールバック URL |
| `DB_PATH` | `./data/sessions.db` | SQLite データベースパス |

---

## 既知の問題 / バックログ

### BACKLOG — 再起動ごとに consumerId が変化する

`BrokerClient` は明示的な ID が指定されない場合、`` `agent-log-replayer-${Date.now()}` `` として `consumerId` を生成します。つまり**再起動のたびに新しいコンシューマーとして登録**されます。古いサブスクリプションはクリーンアップされません。

**影響:** broker に古いコンシューマーレコードが蓄積される。再起動を繰り返すと、デッドなコールバックへの配信が試みられる可能性があります。

**回避策:** 環境変数で安定した `consumerId` を設定するか、`./data/consumer-id.json` に永続化する。

詳細は [docs/decisions/consumer-id-instability.md](docs/decisions/consumer-id-instability.md) を参照してください。

---

## テスト

**テスト件数: 0。** `tests/` ディレクトリには `.gitkeep` のみが存在します。

ユニットテストも統合テストも現時点では存在しません。テストランナーとして `vitest` が設定されています。

---

## claude-session-replay との関係

| 観点 | claude-session-replay | agent-log-replayer |
|------|----------------------|-------------------|
| データ取得 | ログファイルを直接読み取り | agent-log-broker から受信 |
| パース | 自前アダプター (Python) | broker が実施済み |
| UI | Flask + 自己完結 HTML | React SPA + WebSocket |
| セッション状態 | ファイルベース（毎回スキャン） | SQLite + リアルタイム更新 |
| ライブ表示 | なし（完了後のみ） | WebSocket によるリアルタイム |

引き継いだ概念: データモデル、ターミナル表示スタイル、再生モード、セキュリティフラグ分類体系。

---

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| サーバー | TypeScript、Express、ws (WebSocket) |
| フロントエンド | React、Zustand、xterm.js |
| ストレージ | SQLite (better-sqlite3、WAL モード) |
| 通信 | HTTP callback (broker → replayer)、WebSocket (replayer → ブラウザ) |
| ビルド | Vite、TypeScript、tsx |
