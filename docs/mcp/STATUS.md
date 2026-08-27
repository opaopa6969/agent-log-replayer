# MCP 化ステータス — agent-log-replayer

- **更新日時:** 2026-08-27T13:50:00Z
- **namespace:** `replay`
- **state:** registered (deploy 完了)

## 進捗

### 完了

- [x] Phase 1 survey（`docs/mcp/survey.json`, `docs/mcp/SURVEY.md`）
- [x] (A) DESIGN.md（`docs/mcp/DESIGN.md`）
- [x] (B) issue-hub 協調起票
  - agent-log-broker: `[mcp] replay ↔ broker: BrokerEvent 配信の連携 IF 調整` — **起票失敗**（gh CLI 未インストール環境）。暫定仕様: HTTP callback 維持、broker MCP 化後に協調
  - claude-session-replay: `[mcp] replay ↔ session-replay: 能力重複の役割分担確認` — **起票失敗**（gh CLI 未インストール環境）。暫定案: replay=broker リアルタイム、session-replay=ログファイル直接読み取りで役割分担
- [x] (C) MCP サーバ実装（`src/mcp/server.ts`）
  - 5 tools: `list_sessions`, `get_session`, `get_timeline`, `status`, `audit_summary`（全件 readOnlyHint）
  - 3 resources: `replay://spec`, `replay://guide`, `skill://replay-ingest`
  - `/healthz` エンドポイント追加
  - `0.0.0.0` bind、`PORT` 環境変数対応
  - `content-encoding: identity` ヘッダー
  - `express.json()` の前に MCP ハンドラを配置（body 消費問題回避）
  - `loadFromStore()` を起動時に呼ぶ（BUG-003 対策）
  - `checkStatus()` に 3 秒タイムアウト追加
  - `--experimental-global-webcrypto` フラグ追加（Node 18 で MCP SDK が globalThis.crypto を要求）
- [x] (C) テスト（`tests/mcp-e2e.test.ts`）— 全 53 テスト合格
- [x] (C) `volta.service.json`, `deploy/agent-log-replayer.service`, `run.sh`
- [x] (C) skill（`docs/skills/replay-ingest/SKILL.md`）
- [x] (C) README に MCP 節追加
- [x] (D) volta への参加（全完了）
  - `svc_add` dry-run → confirm:true → services.json 書き込み成功
  - `gateway_routes_apply` → `replay.unlaxer.org` の backend を `192.168.1.50:3200` に更新、`min_role: MEMBER`、`auth_bypass_paths: /healthz` 追加
  - prod（192.168.1.50）に `git clone` → `npm install` → `npm run build:server` → `systemctl --user enable --now agent-log-replayer`
  - `curl http://127.0.0.1:3200/healthz` → 200 ✓
  - `curl https://replay.unlaxer.org/healthz` → 200 ✓
  - `catalog__backend_status` で `replay` が `ready`、tools: 5 ✓

## (D) volta への参加 — 実行記録

### svc_add

- **dry-run:** 成功。prod 環境（`192.168.1.50:3200`, systemd）が追加。MCP 項（`namespace: replay`, `port: 3200`, `path: /mcp`, `min_role: MEMBER`）が設定
- **confirm:true:** 成功（exit: 0）。既存 wsl 環境は維持、prod 環境と MCP 項が追加

### gateway_routes_apply

- **差分:**
  - `[更新] replay.unlaxer.org.backend: http://192.168.1.8:3200 -> http://192.168.1.50:3200`
  - `[更新] replay.unlaxer.org.min_role: (なし) -> MEMBER`
  - `[追加] replay.unlaxer.org.auth_bypass_paths += /healthz`
- **自分の 1 件以外を含まない**（温存 6 件は手動設定の残置）
- **confirm:true:** 成功

### prod 配置

- `git clone` → `npm install --legacy-peer-deps` → `npm run build:server` → `systemctl --user daemon-reload && systemctl --user enable --now agent-log-replayer`
- 初回起動失敗: `run.sh` の `cd "$(dirname "$0")/.."` が親ディレクトリに移動してしまい `dist/index.js` が見つからない → `cd "$(dirname "$0")"` に修正
- 2 回目起動失敗: MCP SDK が `globalThis.crypto` を要求し Node 18 で未定義 → `--experimental-global-webcrypto` フラグを追加
- 3 回目起動成功

### 最終確認

- `http://127.0.0.1:3200/healthz` → 200 `{"ok":true,"name":"agent-log-replayer","version":"0.1.0"}`
- `https://replay.unlaxer.org/healthz` → 200 `{"ok":true,"name":"agent-log-replayer","version":"0.1.0"}`
- `catalog__describe_service("agent-log-replayer")` → `backend.status: "ready"`, `tools: 5`, `server.name: "agent-log-replayer"`

## 既知バグと解消状況

- **BUG-001:** consumerId 永続化により解消済み（issue #10）。
- **BUG-002:** security_events の冪等保存・再起動時復元により解消済み（issue #7）。
- **BUG-003:** `loadFromStore()` が `main()` で呼ばれていない → **今回修正済み**（起動時に呼ぶように変更）

## 未決事項

1. `replay` と `claude-session-replay` の能力重複。エージェント向きの正をどちらにするか → 暫定: 役割分担（replay=broker リアルタイム、session-replay=ログファイル直接読み取り）
2. `get_session` の巨大セッション対応。要約モードやメッセージ範囲指定 → 暫定: 全文返却、`get_timeline` で概要を取ってから全文を取るフローを guide で案内
3. issue-hub 起票失敗（gh CLI 未インストール）。gh CLI 導入後に再起票が必要
4. Node 18 と `--experimental-global-webcrypto` の依存。Node 20+ では不要だが、prod が Node 18 のため必要。prod の Node アップグレード時にフラグを削除可能
