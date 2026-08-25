# MCP 化設計 — agent-log-replayer

- **namespace:** `replay`
- **種別:** wrap（既存の Express 常駐サービスに薄く MCP を載せる）
- **割当表:** #58, port 9252 → **既存 port 3200 を優先**（catalog に `agent-log-replayer` として port 3200 / wsl 環境で既登録）

## 1. namespace と種別

`replay`（`^[a-z0-9][a-z0-9_-]*$`、予約語 `catalog` / `probe` / `skill` と衝突しない）。
wrap: 既存の Express REST API を Streamable HTTP MCP サーバで包む。既存サーバプロセスに `/mcp` と `/healthz` を同プロセスで追加する。

## 2. tools 表

| name | 目的 | 入力 schema（要点） | 出力の形 | 副作用 | dry-run | job 型 | 所要 | min_role |
|------|------|---------------------|----------|--------|---------|--------|------|----------|
| `list_sessions` | セッション一覧を取得する | `{}` | `SessionSummary[]` (sessionId, agentType, projectPath, status, messageCount, first/lastMessageAt, hasSecurityFlags, hasBannedWords) | read | — | no | <100ms | VIEWER |
| `get_session` | セッション詳細（メッセージ全文）を取得する | `{ sessionId: string }` | `ActiveSession` (messages[], securityFlags[], bannedWordHits[], ...) | read | — | no | <500ms | VIEWER |
| `get_timeline` | セッションのタイムラインイベント一覧を取得する | `{ sessionId: string }` | `TimelineEvent[]` (index, kind, label, timestamp, durationFromPrev, messageIndex) | read | — | no | <100ms | VIEWER |
| `status` | replayer と broker の接続状態を取得する | `{}` | `{ replayer, broker:{connected,brokerUrl}, subscribed, consumerId, sessionCount }` | read | — | no | <200ms | VIEWER |
| `audit_summary` | セッションのセキュリティ監査サマリを構築する | `{ sessionId: string }` | `AuditSummary` (totalFlags, critical/warning/info counts, bannedWordCount, flagsByType, flags[], bannedWordHits[], requiresReview) | read | — | no | <100ms | VIEWER |

全 tool に `annotations: { readOnlyHint: true }` を付ける（全件読み取り系、壊す系なし）。

### 設計判断

- `get_session` は巨大セッションでトークンを膨らませるリスクがあるが、Phase 2 では全文返却を基本とし、エージェントが判断して `get_timeline` で概要を取ってから全文を取るフローを `replay://guide` で案内する。範囲指定・要約モードは暫定仕様（open_questions 参照）。
- `audit_summary` は既存 REST エンドポイントが無いため、MCP 用に新設する（既存 `buildAuditSummary()` を呼ぶだけ）。
- `loadFromStore()` が `main()` で呼ばれていない既知バグ（BUG-003）があるため、MCP サーバ初期化時に `loadFromStore()` を呼ぶことで再起動直後でも過去セッションが一覧に出るように修正する。

## 3. resources 表

| uri | 内容 | mime |
|-----|------|------|
| `replay://spec` | 能力の機械可読仕様（tools/list から自動生成 + compositions/depends_on 手書き） | application/json |
| `replay://guide` | 使い方（namespace、tools 一覧、組み合わせ例、注意点） | text/markdown |
| `skill://replay-ingest` | broker → replayer のイベント受信・永続化手順（SKILL.md 形式） | text/markdown |

## 4. prompts / skills

| 名前 | 用途 | locality | applies_when | requires |
|------|------|----------|--------------|----------|
| `replay-ingest` | broker から replayer へのイベント受信・永続化の手順 | service | broker と replayer の連携を設定・確認するとき | tools: [status, list_sessions] |

skill は `docs/skills/replay-ingest/SKILL.md` に置き、resource `skill://replay-ingest` でも配る。

## 5. 組み合わせ例

1. `index__agent_status` で走行中エージェントを確認 → `replay__list_sessions` でセッション一覧 → `replay__get_timeline` で該当セッションの進行を要約 → 別エージェントへの引き継ぎ判断材料
2. `replay__audit_summary` で critical フラグ付きセッションを抽出 → `volta__svc_logs` で該当エージェントの生ログを照合 → `issue_broker__submit_feedback` でセキュリティレビューを起票
3. `replay__list_sessions` → `replay__get_session` で完了済みセッションの全文を取得 → `kamishibai__validate` で台本素材として再利用

## 6. 依存と協調

| 相手 repo | 方向 | 依存する/提供する入口 | 合意したいこと | 暫定案 |
|-----------|------|------------------------|----------------|--------|
| agent-log-broker | depends_on | BrokerEvent 配信（POST /api/broker/callback）。セッション新規取得に必須 | broker 側の MCP 化が進んだ場合の `broker__subscribe` 等との連携 IF | 現状の HTTP callback を維持。broker MCP 化後に協調 |
| claude-session-replay | depends_on | 概念継承元。コード依存なし。能力が重複 | エージェント向きの正をどちらにするか（broker リアルタイム vs ログファイル直接読み取り） | 暫定: `replay`=broker リアルタイム、`session-replay`=ログファイル直接読み取りで役割分担 |

issue-hub に `mcp-coordination` ラベルで起票し、返答を待たずに暫定仕様で進める。

## 7. 非対応にした候補

| 候補 | 理由 |
|------|------|
| POST /api/broker/callback の tool 化 | 認証が無く任意のクライアントが偽 BrokerEvent を送信可能。MCP 経由で外部に公開すべきでない（survey の risks 記載） |
| WebSocket /ws の tool 化 | ブラウザ向けリアルタイム配信であり、エージェントが呼ぶ用途がない |
| フロントエンド UI の tool 化 | 人が見るもので tool 化の対象外 |
| loadFromStore バグの完全修正 | main() に loadFromStore() を追加する最小修正のみ（BUG-003）。consumerId 変動（BUG-001）、security_events 未実装（BUG-002）は既知バグとして STATUS.md に記録し今回対象外 |

## 8. 参加方法

- **manifest:** `volta.service.json`（root に配置）
- **port:** 3200（既存 catalog 登録を優先。割当表の 9252 は使用しない）
- **host:** 192.168.1.50（prod）に新規登録。既存 wsl 192.168.1.8:3200 も維持
- **runtime:** systemd user unit
- **auth:** `minRole:MEMBER`（読み取り系だが、セッション全文に秘密情報が含まれる可能性があるため VIEWER には見せない）
- **health_check:** `/healthz`
- **mcp:** `{ enabled: true, port: 3200, path: "/mcp", namespace: "replay", min_role: "MEMBER", timeoutMs: 110000 }`

## 9. テスト方針

- e2e: サーバ起動 → `/healthz` 200 → tools/list に 5 tool → `list_sessions` → `get_session` → `get_timeline` → `status` → `audit_summary` → `replay://spec` resource
- MCP クライアント: `@modelcontextprotocol/sdk` の `Client` + `StreamableHTTPClientTransport`
- 既存 vitest テスト（audit, session-store, timeline-renderer, terminal-renderer, diff-renderer）が通ることを確認
