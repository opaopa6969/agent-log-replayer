# claude-session-replay からの移行ガイド

## 1. 概要

agent-log-replayer は claude-session-replay の **進化版** です。claude-session-replay のコア概念を引き継ぎつつ、agent-log-broker を活用したリアルタイムアーキテクチャに刷新しています。

claude-session-replay は引き続き動作します。agent-log-replayer はそれを **置き換える** ものではなく、broker エコシステムにおける新しい UI レイヤーです。

## 2. 引き継がれたもの

### 2.1 データモデル

claude-session-replay の Common Model スキーマは agent-log-broker の `AgentMessage` 型として引き継がれています。

| Common Model フィールド | AgentMessage フィールド | 変更点 |
|------------------------|----------------------|--------|
| `role` | `role` | `"system"` が追加 |
| `text` | `text` | 変更なし |
| `tool_uses` | `toolUses` | camelCase に変更 |
| `tool_results` | `toolResults` | camelCase に変更 |
| `thinking` | `thinking` | 変更なし |
| `timestamp` | `timestamp` | 変更なし |

セッションレベルのメタデータ（`source`, `agent`）は `BrokerEvent._session` に移動しています。

### 2.2 レンダリング概念

以下のレンダリング概念はそのまま引き継がれています:

- **ターミナル表示**: User プロンプト（`>` + 青背景）、Assistant テキスト（オレンジ左罫線）
- **ツールブロック**: アイコン付きツール表示（Read, Write, Edit, Bash, Grep, Glob, Task）
- **再生モード**: Uniform / Real-time / Compressed
- **速度コントロール**: 0.25x 〜 16x
- **キーボードショートカット**: Space, 矢印キー, Home/End

### 2.3 エージェントアダプターの知見

claude-session-replay のアダプター設計（エージェント非依存の共通モデル変換）は agent-log-broker のアダプター層に引き継がれています。agent-log-replayer はパース済みデータを受信するため、アダプターを直接持ちません。

### 2.4 セキュリティ分析

session-shipper のセキュリティ分析機能（機密ファイルアクセス検出、不審コマンド検出、外部 URL アクセスフラグ、禁止語検出）は agent-log-broker の Redaction パイプラインに移管されています。agent-log-replayer はこれらのフラグを **表示** する責務を持ちます。

## 3. 新しいもの

### 3.1 broker サブスクリプション

```
claude-session-replay:  ファイル → アダプター → Common Model → レンダラー
agent-log-replayer:     broker → HTTP callback → session-manager → UI
```

ファイルシステムの直接スキャンではなく、agent-log-broker から `full_stream` モードでイベントを受信します。

### 3.2 リアルタイムストリーミング

claude-session-replay ではセッション完了後にしかリプレイできませんでした。agent-log-replayer では進行中のセッションをリアルタイムで閲覧できます。

- broker がファイル変更を検知するたびにイベントを配信
- replayer が WebSocket でブラウザに即座に転送
- ブラウザがリアルタイムでメッセージを表示

### 3.3 React SPA

claude-session-replay は自己完結 HTML ファイルを生成する Python レンダラーでした。agent-log-replayer は React シングルページアプリケーションとして動作します。

| claude-session-replay | agent-log-replayer |
|----------------------|-------------------|
| Python (Flask) サーバー | Express (TypeScript) サーバー |
| Jinja2 テンプレート | React コンポーネント |
| 自己完結 HTML 出力 | SPA + WebSocket |
| jQuery 風 DOM 操作 | React 状態管理 (Zustand) |

### 3.4 永続化

claude-session-replay はセッションを毎回ファイルシステムからスキャンしていました。agent-log-replayer は SQLite にセッション履歴を永続化します。

- セッション一覧の即時表示（スキャン不要）
- メッセージの全文保存と検索
- セキュリティイベントの蓄積

### 3.5 タイムラインビュー

セッション内のイベントを時系列で可視化するタイムラインビューが新設されました。ツール呼び出し、Thinking ブロック、メッセージ間のタイミングを一目で把握できます。

## 4. 廃止されたもの（broker が担当）

以下の機能は agent-log-broker の責務に移管されたため、agent-log-replayer では実装しません:

| 機能 | claude-session-replay での場所 | 移管先 |
|------|------------------------------|--------|
| ログファイル直接パース | `*-log2model.py` | agent-log-broker アダプター |
| ファイルシステムスキャン | `discover_sessions()` | agent-log-broker FileWatcher |
| PII リダクション | `session-shipper.py` | agent-log-broker Redaction |
| セキュリティフラグ検出 | `session-shipper.py` | agent-log-broker Redaction |
| 禁止語検出 | `session-shipper.py` | agent-log-broker Redaction |

## 5. 移行パス

### 既存の claude-session-replay ユーザー向け

1. **agent-log-broker をセットアップ**: broker がログファイルの監視・パース・配信を担当
2. **agent-log-replayer を起動**: replayer が broker にサブスクライブ
3. **ブラウザでアクセス**: `http://localhost:3200` でリアルタイム UI を利用

### 並行運用

claude-session-replay と agent-log-replayer は並行して運用できます:

- claude-session-replay: 過去セッションのオフライン再生、MP4 エクスポート、Markdown 出力
- agent-log-replayer: リアルタイム監視、セッション監査、タイムライン分析

### 段階的移行

1. **Phase 1**: agent-log-broker + agent-log-replayer を導入し、リアルタイム監視を開始
2. **Phase 2**: 日常的なセッションレビューを agent-log-replayer に移行
3. **Phase 3**: claude-session-replay は MP4 エクスポートなど特殊用途に限定

## 6. 機能対応表

| claude-session-replay 機能 | agent-log-replayer 対応 | 状態 |
|--------------------------|----------------------|------|
| セッション一覧表示 | SessionList コンポーネント | 実装済み（スタブ） |
| セッション再生 | SessionPlayer コンポーネント | 実装済み（スタブ） |
| ターミナル表示 | TerminalView コンポーネント | 実装済み（スタブ） |
| タイムライン表示 | TimelineView コンポーネント | 新規 |
| セキュリティ監査 | SecurityPanel コンポーネント | 新規 |
| Alibai Mode | 将来対応予定 | 未実装 |
| Markdown 出力 | 対象外（claude-session-replay を使用） | - |
| HTML 出力 | 対象外（claude-session-replay を使用） | - |
| MP4 エクスポート | 対象外（claude-session-replay を使用） | - |
| 全文検索 | 将来対応予定 | 未実装 |
| 統計・Diff | 将来対応予定 | 未実装 |
