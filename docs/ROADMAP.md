# Roadmap

- [#9 TerminalView/TimelineView/SecurityPanel が全員プレースホルダー](https://github.com/opaopa6969/agent-log-replayer/issues/9) — 再生 UI の API/store 結合、xterm.js 統合、E2E を縦切りで完成させる。
- [#11 POST /api/broker/callback と WebSocket に認証なし](https://github.com/opaopa6969/agent-log-replayer/issues/11) — broker と認証契約を定め、callback の署名検証と WebSocket の接続元検証を導入する。
- [#13 realtime/compressed 再生モードが uniform と同一計算](https://github.com/opaopa6969/agent-log-replayer/issues/13) — timestamp ベースの realtime と圧縮規則を定義し、3 モードを実装・検証する。
- [#19 セッション削除 API が未実装で DB の手動管理が必要 (TECH-004)](https://github.com/opaopa6969/agent-log-replayer/issues/19) — retention 方針を決め、セッション削除・archive・purge の運用機能を整備する。
