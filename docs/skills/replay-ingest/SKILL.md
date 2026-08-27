---
name: replay-ingest
description: broker から replayer へのイベント受信・永続化手順
volta:
  version: 2
  namespace: replay
  locality: service
  applies_when: broker と replayer の連携を設定・確認するとき
  requires:
    tools: [status, list_sessions]
  min_role: VIEWER
  tags: [broker, replay, ingest]
  export: true
---

# replay-ingest — broker → replayer のイベント受信・永続化手順

## 前提

- agent-log-broker が `http://<host>:3100` で起動している
- replayer が `BROKER_URL` 環境変数で broker URL を指定して起動している
- replayer の `CALLBACK_URL` が broker から到達可能な URL である

## 手順

1. `replay__status` で broker 接続状態と `subscribed` を確認
2. `subscribed: false` の場合、replayer の `BROKER_URL` と `CALLBACK_URL` を確認
3. broker が起動している場合、replayer は起動時に自動で `/api/subscribe` を呼び subscribe する
4. `replay__list_sessions` で受信済みセッションを確認
5. セッションが見つからない場合: broker がエージェントを検知していない可能性

## トラブルシューティング

- `consumerId` はファイルに永続化され、再起動後も同じ ID を使う（BUG-001 対策）。
- `security_events` は broker の `messageId` 単位で冪等に保存され、再起動時に復元される（BUG-002 対策）。
- `loadFromStore()` はサーバ起動時に呼ばれる（BUG-003 対策）。再起動直後も過去セッションが一覧に出る。
