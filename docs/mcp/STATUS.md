# MCP 化ステータス — agent-log-replayer

- **更新日時:** 2026-08-22T13:30:00Z
- **namespace:** `replay`
- **state:** implemented → deploying

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
- [x] (C) テスト（`tests/mcp-e2e.test.ts`）— 全 53 テスト合格
- [x] (C) `volta.service.json`, `deploy/agent-log-replayer.service`, `run.sh`
- [x] (C) skill（`docs/skills/replay-ingest/SKILL.md`）
- [x] (C) README に MCP 節追加

### 進行中

- [ ] (D) volta への参加

## (D) volta への参加 — dry-run 記録

### svc_add dry-run

- **結果:** 成功（exit: 0）
- **変更内容:** prod 環境（`192.168.1.50:3200`, systemd）が追加。MCP 項（`namespace: replay`, `port: 3200`, `path: /mcp`, `min_role: MEMBER`）が設定される
- **既存の wsl 環境は維持**（上書きなし）
- **ポート:** 3200（既存 catalog 登録を優先。割当表の 9252 は使用しない。prod の 3200 は空き）

### gateway_routes_diff

- **結果:** 変更 0 件、温存 6 件
- `replay.unlaxer.org` は既存ルートがそのまま維持される（既に cloudflare 登録済みのため新規ルート不要）
- 温存 6 件は手動設定として残置（自分の変更ではない）

### 次のステップ

1. `svc_add(confirm: true)` で services.json に書き込み
2. prod でのコード配置と起動（`git clone` + `systemctl --user enable --now`）
3. `curl http://127.0.0.1:3200/healthz` が 200 になることを確認
4. `https://replay.unlaxer.org/healthz` が 200 になることを確認
5. `catalog__backend_status` で `replay` が `ready` になることを確認

## 既知バグ（今回の対象外）

- **BUG-001:** consumerId が再起動ごとに変化。broker にステールエントリ蓄積。
- **BUG-002:** security_events テーブルへの書き込みが未実装。再起動でセキュリティデータ消失。
- **BUG-003:** `loadFromStore()` が `main()` で呼ばれていない → **今回修正済み**（起動時に呼ぶように変更）

## 未決事項

1. `replay` と `claude-session-replay` の能力重複。エージェント向きの正をどちらにするか → 暫定: 役割分担（replay=broker リアルタイム、session-replay=ログファイル直接読み取り）
2. `get_session` の巨大セッション対応。要約モードやメッセージ範囲指定 → 暫定: 全文返却、`get_timeline` で概要を取ってから全文を取るフローを guide で案内
3. issue-hub 起票失敗（gh CLI 未インストール）。gh CLI 導入後に再起票が必要
