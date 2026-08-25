# MCP 化調査 — agent-log-replayer

- **surveyed_at:** 2026-08-21T23:37:33Z
- **kind:** service
- **decision:** wrap

## 概要

agent-log-replayer は、agent-log-broker が配信する LLM エージェントセッションイベントを HTTP コールバックで受信し、SQLite（better-sqlite3, WAL）に永続化して、ブラウザ（React + xterm.js + WebSocket）でリプレイ再生する常駐サービス。Express 4 + ws 8。TypeScript ESM。

既に volta で `https://replay.unlaxer.org` としてホスト済み（catalog id: `agent-log-replayer`、port 3200、source runtime）。ただし `volta.service.json` は未配置、`/healthz` は未実装（`/api/status` が準ず）、MCP バックエンドは未所持。

## 判定と理由

**wrap** — 既に常駐サービスとして volta に乗っており、REST API が存在する。エージェントから呼んで嬉しい読み取り系操作が 4 つ程度はっきりしており、既存エンドポイントを薄く MCP で包めばよい。壊す系操作・30 秒超の長時間処理は今のところ無く、wrap が最小コストで価値を届ける。`library-serve` ではない（既にサーバがある）。ブラウザ向けリプレイ UI 本体は人が見るもので tool 化の対象外。

## 公開候補

| kind | name | io | 副作用 | 長時間 | 対応付け |
|------|------|-----|--------|--------|----------|
| tool | `list_sessions` | `{}` → `SessionSummary[]` | read | no | `src/api/routes.ts:52` GET /api/sessions |
| tool | `get_session` | `{sessionId}` → `ActiveSession` (messages[], securityFlags[], bannedWordHits[], ...) | read | no | `src/api/routes.ts:71` GET /api/sessions/:id |
| tool | `get_timeline` | `{sessionId}` → `TimelineEvent[]` | read | no | `src/api/routes.ts:84` GET /api/sessions/:id/timeline → `buildTimeline()` |
| tool | `status` | `{}` → `{ replayer, broker:{connected,brokerUrl}, subscribed, consumerId, sessionCount }` | read | no | `src/api/routes.ts:98` GET /api/status |
| tool | `audit_summary` | `{sessionId}` → `AuditSummary` (critical/warning/info counts, bannedWordCount, flags[], bannedWordHits[], requiresReview) | read | no | `src/security/audit.ts:44` `buildAuditSummary()` — 既存 REST になし、薄く追加 |
| resource | `spec` | `replay://spec` — 能力の機械可読仕様 | read | no | 新規 |
| resource | `guide` | `replay://guide` — 使い方 | read | no | 新規 |
| skill | `replay-ingest` | broker → replayer のイベント受信・永続化手順 | — | — | 新規、locality: service |

提案 namespace: `replay`（`^[a-z0-9][a-z0-9_-]*$`）。予約語 `catalog` / `probe` / `skill` と衝突しない。

## 組み合わせ例

1. `index__agent_status` で走行中エージェントを確認 → `replay__list_sessions` でセッション一覧 → `replay__get_timeline` で進行を要約 → 別エージェントへの引き継ぎ判断材料。
2. `replay__audit_summary` で critical フラグ付きセッションを抽出 → `volta__svc_logs` で該当エージェントの生ログを照合 → セキュリティレビュー起票。
3. `replay__list_sessions` → `replay__get_session` で完了済みセッションの全文を取得 → `kamishibai` の台本素材として再利用。

## 依存と協調

| 相手 repo | 方向 | 能力 | 現状 | 備考 |
|-----------|------|------|------|------|
| agent-log-broker | depends_on | BrokerEvent 配信（POST /api/broker/callback）。セッション新規取得には必須、broker 無しでも起動可 | catalog に存在（MCP なし、hosted なし、port 3100） | broker 側の MCP 化が進めば `broker__subscribe` 等と連携可能 |
| claude-session-replay | depends_on | 概念継承元（データモデル・ターミナル描画スタイル・再生モード・セキュリティフラグ分類）。コード依存は無し | catalog に存在（MCP なし、`https://replay-hvu.unlaxer.org` でホスト） | 類似能力を持つ。replayer は broker 経由リアルタイム、session-replay はログファイル直接読み取り。重複領域あり、役割分担要確認 |
| issue-broker | depends_on | `.mcp.json` に stdio MCP として登録済み（CURRENT_REPO=agent-log-replayer）。issue 管理用 | 存在 | 開発支援用で replayer 本体の機能ではない。調査対象外 |

Phase 2 で issue-hub 登録する場合は agent-log-broker・claude-session-replay との協調が主題。

## ライブラリのサーバ化

該当しない（既に常駐サービス）。`library_serve.needed = false`。

## リスク

- `POST /api/broker/callback` に認証が無く、任意のクライアントが偽 BrokerEvent を送信可能。MCP 経由で外部に tool として公開するのは callback 入口ではなく読み取り系のみにすべき。
- SQLite ファイルにセッション全文（プロンプト・応答）が格納される。`get_session` は全文を返すため、秘密情報を含むセッション内容が MCP 経由で漏れるリスク。
- WebSocket / REST にも認証なし。現在 localhost 前設だが、volta 公開 URL 経由で MCP を出す場合はアクセス制御に注意。
- consumerId が再起動ごとに変化する既知バグ（BUG-001）。broker にステールエントリが蓄積し、`status` tool の `subscribed` が実態と乖離する可能性。
- `security_events` テーブルへの書き込みが未実装（BUG-002）。再起動でセキュリティデータ消失、`audit_summary` は起動後分のみ。
- `loadFromStore()` が `main()` で呼ばれていないため、再起動直後は過去セッションが一覧に現れず `get_session` も Not Found になる。
- ライセンス UNLICENSED。再配布不可。

## 持ち主への質問

1. `replay` と `claude-session-replay` は能力が重複。エージェント向きはどちらを正とするか（broker リアルタイム vs ログファイル直接読み取り）。統合 or 役割分担の方針確認が要る。
2. `get_session` は全文を返し巨大セッションでトークンを膨らませる。要約モードやメッセージ範囲指定を MCP tool に持たせるか。
3. `audit_summary` は既存 REST に無い。MCP 用に新設するか、`/api/sessions/:id` に audit フィールドを足して `get_session` に含めるか。
4. hosted_url はあるが `/healthz` が無い。volta 参加規約の `/healthz` を実装するか、`/api/status` で代用させるか。
5. `volta.service.json` が無いが catalog には登録済み。manifest を整備すべきか。
