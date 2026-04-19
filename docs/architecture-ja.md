[English version](architecture.md)

# アーキテクチャ

## 1. 設計思想

agent-log-replayer は agent-log-broker のコンシューマーとして動作するブラウザベースのセッションリプレイヤーです。3 層アーキテクチャで構成されています:

1. **Consumer 層** — broker にサブスクライブし、HTTP callback で `BrokerEvent` を受信
2. **Storage 層** — セッション・メッセージ・セキュリティイベントを SQLite に永続化
3. **UI 層** — REST API + WebSocket リアルタイムストリーミングを備えた React SPA を提供

パースロジックは replayer に存在しません。すべてのパースとリダクションは上流の broker が担当します。

---

## 2. 3 層アーキテクチャ

```
┌─────────────────────────────────────────────────────────┐
│ Layer 1: Consumer                                        │
│   broker-client.ts   — HTTP callback サブスクリプション管理 │
│   session-manager.ts — メモリ上のセッション状態管理        │
└──────────────────────────┬──────────────────────────────┘
                           │ BrokerEvent
                           ▼
┌─────────────────────────────────────────────────────────┐
│ Layer 2: Storage (SQLite)                                │
│   session-store.ts   — セッション + メッセージ + セキュリティ │
└──────────────────────────┬──────────────────────────────┘
                           │ クエリ + リアルタイム通知
                           ▼
┌─────────────────────────────────────────────────────────┐
│ Layer 3: UI                                              │
│   routes.ts          — Express REST API                  │
│   websocket.ts       — WebSocket リアルタイムストリーミング  │
│   React SPA          — SessionList/Player/各ビュー       │
└─────────────────────────────────────────────────────────┘
```

---

## 3. SQLite スキーマ

### `sessions`

```sql
CREATE TABLE sessions (
  session_id      TEXT PRIMARY KEY,
  agent_type      TEXT NOT NULL,
  project_path    TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'active',
  first_message_at TEXT,
  last_message_at  TEXT,
  message_count   INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`status` 値: `active` | `idle` | `lost` | `archived`

### `messages`

```sql
CREATE TABLE messages (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id     TEXT NOT NULL,
  message_index  INTEGER NOT NULL,
  role           TEXT NOT NULL,
  text           TEXT,
  tool_uses      TEXT,   -- JSON 配列
  tool_results   TEXT,   -- JSON 配列
  thinking       TEXT,   -- JSON 配列
  timestamp      TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

CREATE INDEX idx_messages_session ON messages(session_id, message_index);
```

`tool_uses`、`tool_results`、`thinking` は JSON 文字列として格納（正規化なし）。`message_index` はセッションごとの単調増加カウンター。

### `security_events`

```sql
CREATE TABLE security_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL,
  message_index INTEGER,
  flag_type     TEXT NOT NULL,
  detail        TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

CREATE INDEX idx_security_session ON security_events(session_id);
```

注意: セキュリティイベント行はスキーマに定義されていますが、現在の `addMessage` 実装では `securityFlags` と `bannedWordHits` はメモリ上の `ActiveSession` にのみ保存されます。このテーブルへの永続保存は未実装です。

---

## 4. WebSocket プロトコル

### サーバー → クライアント

```typescript
// broker からの新規イベント
{ type: "event", sessionId: string, event: BrokerEvent }

// 全セッションリスト（接続時に送信）
{ type: "session.list", sessions: SessionSummary[] }

// エラー通知
{ type: "error", message: string }
```

### クライアント → サーバー

```typescript
// 特定セッションを購読（sessionId 省略で全セッション）
{ type: "subscribe", sessionId?: string }

// 購読解除 — 全セッションモードに戻る
{ type: "unsubscribe" }
```

接続した全クライアントは「全セッション購読」モード（`subscribedSessionId: null`）で開始します。

---

## 5. REST API

| メソッド | パス | 説明 | レスポンス |
|---------|------|------|-----------|
| `GET` | `/api/sessions` | セッション一覧 | `SessionSummary[]` |
| `GET` | `/api/sessions/:id` | セッション詳細 + メッセージ | `ActiveSession` |
| `GET` | `/api/sessions/:id/timeline` | タイムラインイベント | `TimelineEvent[]` |
| `GET` | `/api/status` | ヘルス + broker 接続 | `StatusResponse` |
| `POST` | `/api/broker/callback` | BrokerEvent 受信 | `{ ok: true }` |

**`/api/broker/callback` のエラーコード:**
- `400` — 無効な `BrokerEvent` フォーマット（broker はリトライしない）
- `500` — 内部エラー（broker はリトライする）

---

## 6. レンダラー

`src/renderer/` の 3 つのレンダラーモジュール:

### terminal-renderer.ts

`AgentMessage[]` → `RenderedLine[]`（xterm.js 用 ANSI エスケープシーケンス）に変換。

視覚的慣習:
- `user` メッセージ: `\x1b[44m\x1b[1m > {text}\x1b[0m`（青背景、太字）
- `assistant` テキスト: `\x1b[33m  {text}\x1b[0m`（オレンジ）
- ツールブロック: `\x1b[32m  {icon} {name}: {summary}\x1b[0m`（グリーン）
- thinking ブロック: `\x1b[2m  [thinking] {truncated}\x1b[0m`（薄暗、デフォルト非表示）

オプション: `showThinking: boolean`、`showToolDetails: boolean`、`ansiMode: "strip" | "color"`

### timeline-renderer.ts

`AgentMessage[]` → フロントエンドのタイムラインバー用 `TimelineEvent[]` に変換。

### diff-renderer.ts

`Edit`/`Write` ツール使用入力からファイル差分情報を抽出。

---

## 7. セキュリティ監査

`src/security/audit.ts` — 表示専用モジュール。broker が検出を行い、replayer が集約・表示します。

```typescript
interface AuditSummary {
  totalFlags: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  bannedWordCount: number;
  flagsByType: Record<string, number>;
  flags: SecurityFlag[];
  bannedWordHits: BannedWordHit[];
}
```

`requiresReview(summary): boolean` — `criticalCount > 0 || bannedWordCount > 0` のとき `true`。

---

## 8. フロントエンドコンポーネント

### SessionList

Zustand ストアの全セッションを表示。`sessionId`、`agentType`、`projectPath`、`status` バッジ、`messageCount`、セキュリティ指標を表示。

### SessionPlayer

再生コントロール: 再生/一時停止、シークバー、速度倍率。Zustand ストアの `currentIndex` を操作し、全ビューコンポーネントが参照。

### TerminalView — TODO プレースホルダー

**未実装。** Props: `sessionId`、`visibleUpTo: number`。`currentIndex` まで xterm.js でメッセージをレンダリングする予定。現在の実装は静的プレースホルダー div を返すのみ。

### TimelineView — TODO プレースホルダー

**未実装。** Props: `sessionId`、`currentIndex`、`onSeek`。`GET /api/sessions/:id/timeline` から取得してクリック可能な縦型タイムラインをレンダリングする予定。現在の実装は凡例のみの静的プレースホルダー。

### SecurityPanel — TODO プレースホルダー

**未実装。** Props: `sessionId`。セッションストアから `SecurityFlag[]` と `BannedWordHit[]` を表示する予定。現在の実装は静的プレースホルダー。

---

## 9. モジュール構成

```
src/
├── index.ts                    # Express + WebSocket サーバーエントリ
├── consumer/
│   ├── broker-client.ts        # broker サブスクリプション管理
│   └── session-manager.ts      # セッション状態（メモリ + 永続化）
├── renderer/
│   ├── terminal-renderer.ts    # ANSI シーケンス生成
│   ├── timeline-renderer.ts    # タイムラインイベント構築
│   └── diff-renderer.ts        # ファイル差分抽出
├── storage/
│   └── session-store.ts        # SQLite 永続化 (better-sqlite3)
├── api/
│   ├── routes.ts               # REST API エンドポイント
│   └── websocket.ts            # WebSocket リアルタイムハンドラー
└── security/
    └── audit.ts                # セキュリティフラグ集約

frontend/
├── index.html
└── src/
    ├── App.tsx
    ├── components/
    │   ├── SessionList.tsx      # セッション一覧（実装済み）
    │   ├── SessionPlayer.tsx    # 再生コントロール（実装済み）
    │   ├── TerminalView.tsx     # TODO プレースホルダー
    │   ├── TimelineView.tsx     # TODO プレースホルダー
    │   └── SecurityPanel.tsx   # TODO プレースホルダー
    └── store/
        └── sessionStore.ts     # Zustand クライアント状態
```

---

## 10. 既知のリスク

### BrokerEvent 型二重定義

`BrokerEvent` と `AgentMessage` は共有パッケージからインポートするのではなく、`broker-client.ts` にローカル定義されています。broker の正規型への変更はここに手動で反映する必要があります。[decisions/broker-event-type-duplication.md](decisions/broker-event-type-duplication.md) を参照。

### consumerId の不安定性

`consumerId` は上書きされない限り、プロセス起動ごとに `` `agent-log-replayer-${Date.now()}` `` として生成されます。これにより broker にスタレなコンシューマーレコードが蓄積されます。[decisions/consumer-id-instability.md](decisions/consumer-id-instability.md) を参照。
