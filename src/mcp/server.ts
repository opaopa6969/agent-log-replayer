/**
 * MCP Server — Streamable HTTP backend for volta-mcp facade
 *
 * Wraps the existing SessionManager / BrokerClient with MCP tools.
 * All tools are read-only (no confirm needed).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { SessionManager } from "../consumer/session-manager.js";
import type { BrokerClient } from "../consumer/broker-client.js";
import { buildAuditSummary, requiresReview } from "../security/audit.js";
import { buildTimeline } from "../renderer/timeline-renderer.js";
import { z } from "zod";

export interface McpServerConfig {
  sessionManager: SessionManager;
  brokerClient: BrokerClient;
}

function createMcpServer(config: McpServerConfig): McpServer {
  const { sessionManager, brokerClient } = config;
  const server = new McpServer({
    name: "agent-log-replayer",
    version: "0.1.0",
  });

  // ── Tools ──

  server.registerTool(
    "list_sessions",
    {
      description:
        "セッション一覧を取得する（危険度: read・前提: なし）。broker 経由で受信したセッションの一覧を返す。",
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      const sessions = sessionManager.getAllSessions().map((s) => ({
        sessionId: s.sessionId,
        agentType: s.agentType,
        projectPath: s.projectPath,
        status: s.status,
        messageCount: s.messageCount,
        firstMessageAt: s.firstMessageAt,
        lastMessageAt: s.lastMessageAt,
        hasSecurityFlags: s.securityFlags.length > 0,
        hasBannedWords: s.bannedWordHits.length > 0,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(sessions) }],
      };
    }
  );

  server.registerTool(
    "get_session",
    {
      description:
        "セッション詳細（メッセージ全文）を取得する（危険度: read・前提: sessionId は list_sessions で取得）。巨大セッションの場合トークンが膨れるため、先に get_timeline で概要を取ることを推奨。",
      inputSchema: { sessionId: z.string() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const session = sessionManager.getSession(args.sessionId);
      if (!session) {
        return {
          isError: true,
          content: [
            { type: "text", text: JSON.stringify({ error: "Session not found" }) },
          ],
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(session) }],
      };
    }
  );

  server.registerTool(
    "get_timeline",
    {
      description:
        "セッションのタイムラインイベント一覧を取得する（危険度: read・前提: sessionId は list_sessions で取得）。メッセージの種別・ツール呼出・思考ブロックを構造化イベントとして返す。",
      inputSchema: { sessionId: z.string() },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      const session = sessionManager.getSession(args.sessionId);
      if (!session) {
        return {
          isError: true,
          content: [
            { type: "text", text: JSON.stringify({ error: "Session not found" }) },
          ],
        };
      }
      const timeline = buildTimeline(session.messages);
      return {
        content: [{ type: "text", text: JSON.stringify(timeline) }],
      };
    }
  );

  server.registerTool(
    "status",
    {
      description:
        "replayer と broker の接続状態を取得する（危険度: read・前提: なし）。",
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      const brokerStatus = await brokerClient.checkStatus();
      const result = {
        replayer: "ok",
        broker: brokerStatus,
        subscribed: brokerClient.isSubscribed(),
        consumerId: brokerClient.getConsumerId(),
        sessionCount: sessionManager.getAllSessions().length,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    }
  );

  server.registerTool(
    "audit_summary",
    {
      description:
        "セッションのセキュリティ監査サマリを構築する（危険度: read・前提: sessionId は list_sessions で取得）。critical/warning/info フラグ数、banned word 数、要レビュー判定を返す。",
      inputSchema: { sessionId: z.string() },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      const session = sessionManager.getSession(args.sessionId);
      if (!session) {
        return {
          isError: true,
          content: [
            { type: "text", text: JSON.stringify({ error: "Session not found" }) },
          ],
        };
      }
      const summary = buildAuditSummary(
        session.securityFlags,
        session.bannedWordHits
      );
      const result = { ...summary, requiresReview: requiresReview(summary) };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    }
  );

  // ── Resources ──

  server.resource(
    "spec",
    "replay://spec",
    { mimeType: "application/json", description: "能力の機械可読仕様" },
    async () => {
      const spec = buildSpecResource();
      return {
        contents: [
          {
            uri: "replay://spec",
            mimeType: "application/json",
            text: JSON.stringify(spec, null, 2),
          },
        ],
      };
    }
  );

  server.resource(
    "guide",
    "replay://guide",
    { mimeType: "text/markdown", description: "使い方" },
    async () => {
      return {
        contents: [
          {
            uri: "replay://guide",
            mimeType: "text/markdown",
            text: buildGuideText(),
          },
        ],
      };
    }
  );

  server.resource(
    "skill-replay-ingest",
    "skill://replay-ingest",
    { mimeType: "text/markdown", description: "skill: broker → replayer のイベント受信・永続化手順" },
    async () => {
      return {
        contents: [
          {
            uri: "skill://replay-ingest",
            mimeType: "text/markdown",
            text: buildSkillText(),
          },
        ],
      };
    }
  );

  return server;
}

function buildSpecResource() {
  return {
    namespace: "replay",
    name: "agent-log-replayer",
    version: "0.1.0",
    summary:
      "agent-log-broker が配信する LLM エージェントセッションイベントを受信し、SQLite に永続化してリプレイ再生する常駐サービスの読み取り系 MCP ラッパー",
    capabilities: [
      {
        kind: "tool",
        name: "list_sessions",
        summary: "セッション一覧を取得する",
        input: "{}",
        output: "SessionSummary[]",
        side_effect: "read",
        long_running: false,
        dry_run: false,
        min_role: "VIEWER",
      },
      {
        kind: "tool",
        name: "get_session",
        summary: "セッション詳細（メッセージ全文）を取得する",
        input: "{sessionId: string}",
        output: "ActiveSession",
        side_effect: "read",
        long_running: false,
        dry_run: false,
        min_role: "VIEWER",
      },
      {
        kind: "tool",
        name: "get_timeline",
        summary: "セッションのタイムラインイベント一覧を取得する",
        input: "{sessionId: string}",
        output: "TimelineEvent[]",
        side_effect: "read",
        long_running: false,
        dry_run: false,
        min_role: "VIEWER",
      },
      {
        kind: "tool",
        name: "status",
        summary: "replayer と broker の接続状態を取得する",
        input: "{}",
        output: "{replayer, broker, subscribed, consumerId, sessionCount}",
        side_effect: "read",
        long_running: false,
        dry_run: false,
        min_role: "VIEWER",
      },
      {
        kind: "tool",
        name: "audit_summary",
        summary: "セッションのセキュリティ監査サマリを構築する",
        input: "{sessionId: string}",
        output: "AuditSummary",
        side_effect: "read",
        long_running: false,
        dry_run: false,
        min_role: "VIEWER",
      },
      {
        kind: "resource",
        name: "spec",
        summary: "能力の機械可読仕様",
        input: "-",
        output: "JSON",
        side_effect: "read",
        long_running: false,
        dry_run: false,
        min_role: "VIEWER",
      },
      {
        kind: "resource",
        name: "guide",
        summary: "使い方",
        input: "-",
        output: "markdown",
        side_effect: "read",
        long_running: false,
        dry_run: false,
        min_role: "VIEWER",
      },
      {
        kind: "skill",
        name: "replay-ingest",
        summary: "broker → replayer のイベント受信・永続化手順",
        input: "-",
        output: "SKILL.md",
        side_effect: "read",
        long_running: false,
        dry_run: false,
        min_role: "VIEWER",
      },
    ],
    compositions: [
      {
        title: "走行中エージェントの進行確認",
        flow: ["index__agent_status", "replay__list_sessions", "replay__get_timeline"],
        note: "index で走行中エージェントを確認 → replay でセッション一覧 → timeline で進行概要",
      },
      {
        title: "セキュリティレビュー起票",
        flow: ["replay__audit_summary", "volta__svc_logs", "issue_broker__submit_feedback"],
        note: "critical フラグを抽出 → 生ログを照合 → issue 起票",
      },
      {
        title: "完了セッションの台本素材化",
        flow: ["replay__list_sessions", "replay__get_session", "kamishibai__validate"],
        note: "完了セッションの全文を取得 → 台本素材として再利用",
      },
    ],
    depends_on: [
      {
        namespace: "issue_broker",
        capability: "issue_broker__submit_feedback",
      },
    ],
    health: "/healthz",
    docs: ["replay://guide", "skill://replay-ingest"],
  };
}

function buildGuideText(): string {
  return [
    "# replay — agent-log-replayer MCP ガイド",
    "",
    "## namespace",
    "`replay`（volta-mcp ファサード経由で `replay__*` として呼ばれる）",
    "",
    "## tools",
    "",
    "| tool | 目的 | 入力 | 出力 |",
    "|------|------|------|------|",
    "| `list_sessions` | セッション一覧 | なし | SessionSummary[] |",
    "| `get_session` | セッション詳細（全文） | sessionId | ActiveSession |",
    "| `get_timeline` | タイムラインイベント | sessionId | TimelineEvent[] |",
    "| `status` | 接続状態 | なし | {replayer, broker, subscribed, ...} |",
    "| `audit_summary` | セキュリティ監査サマリ | sessionId | AuditSummary |",
    "",
    "## 使い方",
    "",
    "1. `list_sessions` でセッション一覧を取得",
    "2. 目的の sessionId を見つけたら `get_timeline` で進行概要を確認",
    "3. 全文が必要なら `get_session` でメッセージ全文を取得（巨大セッションは注意）",
    "4. セキュリティ確認は `audit_summary` で critical/warning を抽出",
    "",
    "## 注意点",
    "",
    "- `get_session` は全文を返す。巨大セッションでトークンが膨れるため、先に `get_timeline` で概要を取ることを推奨。",
    "- broker が未接続でも起動済みセッションは参照可能（`status` で broker 接続状態を確認）。",
    "- 再起動直後は `loadFromStore()` で過去セッションを復元するため、数秒遅延する場合がある。",
    "",
    "## 組み合わせ例",
    "",
    "### 走行中エージェントの進行確認",
    "```",
    "index__agent_status → replay__list_sessions → replay__get_timeline",
    "```",
    "",
    "### セキュリティレビュー",
    "```",
    "replay__audit_summary → volta__svc_logs → issue_broker__submit_feedback",
    "```",
    "",
    "### 台本素材化",
    "```",
    "replay__list_sessions → replay__get_session → kamishibai__validate",
    "```",
    "",
  ].join("\n");
}

function buildSkillText(): string {
  return [
    "---",
    "name: replay-ingest",
    "description: broker から replayer へのイベント受信・永続化手順",
    "volta:",
    "  version: 2",
    "  namespace: replay",
    "  locality: service",
    "  applies_when: broker と replayer の連携を設定・確認するとき",
    "  requires:",
    "    tools: [status, list_sessions]",
    "  tags: [broker, replay, ingest]",
    "---",
    "# replay-ingest — broker → replayer のイベント受信・永続化手順",
    "",
    "## 前提",
    "- agent-log-broker が `http://<host>:3100` で起動している",
    "- replayer が `BROKER_URL` 環境変数で broker URL を指定して起動している",
    "",
    "## 手順",
    "",
    "1. `replay__status` で broker 接続状態と subscribed を確認",
    "2. `subscribed: false` の場合、replayer の `BROKER_URL` と `CALLBACK_URL` を確認",
    "3. broker が起動している場合、replayer は起動時に自動で subscribe する",
    "4. `replay__list_sessions` で受信済みセッションを確認",
    "5. セッションが見つからない場合: broker がエージェントを検知していない可能性",
    "",
    "## トラブルシューティング",
    "",
    "- `consumerId` が再起動ごとに変化する既知バグ（BUG-001）。broker にステールエントリが蓄積する。",
    "- `security_events` テーブルへの書き込みが未実装（BUG-002）。再起動でセキュリティデータが消失。",
    "- `loadFromStore()` は MCP サーバ初期化時に呼ばれる（BUG-003 対策）。",
    "",
  ].join("\n");
}

/**
 * MCP request handler (raw, before Express body parsing).
 * Must run before express.json() to avoid consuming the MCP request body.
 */
export function createMcpHandler(config: McpServerConfig) {
  const transports = new Map<string, StreamableHTTPServerTransport>();

  return async (req: Request, res: Response): Promise<void> => {
    if (req.url !== "/mcp") {
      // not our route, let Express handle it
      return;
    }

    try {
      const sid = req.headers["mcp-session-id"] as string | undefined;

      if (sid && transports.has(sid)) {
        const transport = transports.get(sid)!;
        await transport.handleRequest(req, res);
        return;
      }

      if (req.method === "POST" && !sid) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (id: string) => {
            transports.set(id, transport);
          },
          onsessionclosed: (id: string) => {
            transports.delete(id);
          },
        });

        const mcpServer = createMcpServer(config);
        transport.onclose = () => {
          if (transport.sessionId) {
            transports.delete(transport.sessionId);
          }
          mcpServer.close().catch(() => {});
        };
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res);
        return;
      }

      res.writeHead(sid ? 404 : 400, {
        "content-type": "application/json",
        "content-encoding": "identity",
      });
      res.end(
        JSON.stringify({
          error: sid ? "unknown session" : "missing mcp-session-id",
        })
      );
    } catch (err) {
      console.error("MCP request failed:", err);
      if (!res.headersSent) {
        res.writeHead(500, {
          "content-type": "application/json",
          "content-encoding": "identity",
        });
        res.end(JSON.stringify({ error: "internal error" }));
      } else {
        res.end();
      }
    }
  };
}
