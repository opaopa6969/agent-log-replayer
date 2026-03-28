# アーキテクチャ概要

## 1. 設計思想

agent-log-replayer は agent-log-broker のコンシューマーとして動作するブラウザベースのセッションリプレイヤーです。3層アーキテクチャで構成されています。

## 2. 3層アーキテクチャ

```
┌─────────────────────────────────────────────────────────┐
│ Layer 1: Consumer (broker サブスクリプション)              │
│   broker-client.ts  → HTTP callback でイベントを受信      │
│   session-manager.ts → セッション状態をメモリ上で管理      │
└──────────────────────────┬──────────────────────────────┘
                           │ BrokerEvent
                           ▼
┌─────────────────────────────────────────────────────────┐
│ Layer 2: Storage (SQLite 永続化)                         │
│   session-store.ts → セッション・メッセージを SQLite に保存 │
│   セキュリティフラグ・禁止語ヒットも永続化                   │
└──────────────────────────┬──────────────────────────────┘
                           │ データクエリ + リアルタイム通知
                           ▼
┌─────────────────────────────────────────────────────────┐
│ Layer 3: UI (React + WebSocket)                          │
│   Express REST API → セッション一覧・詳細・タイムライン     │
│   WebSocket → リアルタイムイベントストリーミング             │
│   React SPA → セッション表示・再生・監査                    │
└─────────────────────────────────────────────────────────┘
```

## 3. データフロー

### 3.1 イベント受信フロー

```
agent-log-broker
       │
       │ POST /api/broker/callback (BrokerEvent)
       ▼
  broker-client.ts
       │  コールバック受信・バリデーション
       ▼
  session-manager.ts
       │  セッション状態更新（メモリ）
       ├──────────────────┐
       ▼                  ▼
  session-store.ts    WebSocket broadcast
  (SQLite 永続化)     (ブラウザへリアルタイム配信)
```

### 3.2 ブラウザ表示フロー

```
  ブラウザ
       │
       ├── HTTP GET /api/sessions → セッション一覧取得
       ├── HTTP GET /api/sessions/:id → セッション詳細取得
       ├── HTTP GET /api/sessions/:id/timeline → タイムライン取得
       │
       └── WebSocket /ws → リアルタイムイベント受信
              │
              ▼
         Zustand Store (クライアント状態)
              │
              ▼
         React Components
         ├── SessionList      (セッション一覧)
         ├── SessionPlayer    (再生コントロール)
         ├── TerminalView     (ターミナル表示)
         ├── TimelineView     (タイムライン)
         └── SecurityPanel    (セキュリティ監査)
```

## 4. Broker イベント処理

agent-log-broker から受信する `BrokerEvent` の処理方法:

| イベント種別 | 処理 |
|-------------|------|
| `message` | セッションにメッセージ追加、SQLite 保存、WebSocket 配信 |
| `session.discovered` | 新規セッション作成、セッション一覧更新 |
| `session.idle` | セッション状態を `idle` に更新 |
| `session.lost` | セッション状態を `lost` に更新 |

### BrokerEvent 構造

```typescript
interface BrokerEvent {
  _broker: {
    version: string;
    messageId: string;
    deliveredAt: string;
    deliveryAttempt: number;
  };
  _session: {
    sessionId: string;
    sessionPath: string;
    projectPath: string;
    agentType: string;
  };
  _index?: {
    messageIndex: number;
    byteOffset: number;
  };
  type: "message" | "session.discovered" | "session.idle" | "session.lost";
  message?: AgentMessage;
  securityFlags?: unknown[];
  bannedWordHits?: unknown[];
}
```

## 5. claude-session-replay との比較

| 観点 | claude-session-replay | agent-log-replayer |
|------|----------------------|-------------------|
| **アーキテクチャ** | 3段パイプライン (Adapter → Model → Renderer) | 3層アーキテクチャ (Consumer → Storage → UI) |
| **データ取得** | ファイルシステム直接読み取り | agent-log-broker から HTTP callback |
| **パース処理** | 自前アダプター (Python) | broker が実施済み (TypeScript) |
| **データモデル** | Common Model JSON (ファイル) | AgentMessage (SQLite + メモリ) |
| **レンダリング** | Python → 自己完結 HTML 生成 | React SPA + WebSocket |
| **リアルタイム** | なし（完了後のみ） | WebSocket によるリアルタイム配信 |
| **永続化** | なし（毎回ファイルスキャン） | SQLite |
| **セキュリティ** | session-shipper が検出・送信 | broker が検出、replayer が表示 |
| **出力形式** | Markdown / HTML / Player / Terminal / MP4 | Web UI（ブラウザ内のみ） |

### 引き継がれた概念

claude-session-replay から以下の概念が引き継がれています:

1. **データモデル**: メッセージ構造（role, text, toolUses, toolResults, thinking, timestamp）
2. **レンダリング概念**: ターミナル表示スタイル、ツールブロックアイコン、差分表示
3. **再生機能**: Uniform / Real-time / Compressed 再生モード、速度コントロール、キーボードショートカット
4. **セキュリティ分析**: セキュリティフラグ種別、禁止語検出の表示方法

### 新しい概念

1. **broker サブスクリプション**: ファイル読み取りではなく、イベント駆動
2. **リアルタイムストリーミング**: 進行中セッションのライブ表示
3. **永続化**: SQLite によるセッション履歴保存
4. **React SPA**: シングルページアプリケーションによる柔軟な UI

## 6. モジュール構成

```
src/
├── index.ts                    # Express + WebSocket サーバー起動
├── consumer/
│   ├── broker-client.ts        # broker サブスクリプション管理
│   └── session-manager.ts      # セッション状態管理（メモリ + 永続化）
├── renderer/
│   ├── terminal-renderer.ts    # ターミナル表示用シーケンス生成
│   ├── timeline-renderer.ts    # タイムラインイベント構築
│   └── diff-renderer.ts        # ファイル差分構築
├── storage/
│   └── session-store.ts        # SQLite 永続化
├── api/
│   ├── routes.ts               # REST API エンドポイント
│   └── websocket.ts            # WebSocket リアルタイム配信
└── security/
    └── audit.ts                # セキュリティフラグ集約・表示

frontend/
├── index.html
└── src/
    ├── App.tsx                 # React エントリポイント
    ├── components/
    │   ├── SessionList.tsx     # セッション一覧
    │   ├── SessionPlayer.tsx   # 再生プレイヤー
    │   ├── TerminalView.tsx    # ターミナル表示
    │   ├── TimelineView.tsx    # タイムライン
    │   └── SecurityPanel.tsx   # セキュリティ監査パネル
    └── store/
        └── sessionStore.ts     # Zustand クライアント状態管理
```

## 7. 通信プロトコル

### 7.1 broker → replayer (HTTP callback)

- **エンドポイント**: `POST /api/broker/callback`
- **ボディ**: `BrokerEvent`
- **レスポンス**: `200 OK` で成功、`400` でフォーマットエラー、`500` で一時エラー（リトライ対象）

### 7.2 replayer → ブラウザ (WebSocket)

サーバーからクライアントへ:
```json
{ "type": "event", "sessionId": "...", "event": { /* BrokerEvent */ } }
{ "type": "session.list", "sessions": [ /* SessionSummary[] */ ] }
```

クライアントからサーバーへ:
```json
{ "type": "subscribe", "sessionId": "..." }
{ "type": "unsubscribe" }
```

### 7.3 REST API

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/sessions` | セッション一覧 |
| GET | `/api/sessions/:id` | セッション詳細（メッセージ含む） |
| GET | `/api/sessions/:id/timeline` | タイムラインイベント |
| GET | `/api/status` | ヘルスチェック + broker 接続状態 |
| POST | `/api/broker/callback` | broker からのイベント受信 |
