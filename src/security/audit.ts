/**
 * Security Audit
 *
 * Processes and displays security flags and banned word hits
 * received from agent-log-broker. The broker performs the actual
 * detection; this module handles presentation and aggregation.
 *
 * Security concepts inherited from claude-session-replay's session-shipper:
 * - Sensitive file access detection
 * - Suspicious command detection
 * - External URL access flagging
 * - Banned word highlighting
 */

export interface SecurityFlag {
  type: string;
  severity: "info" | "warning" | "critical";
  description: string;
  messageIndex?: number;
  detail?: Record<string, unknown>;
}

export interface BannedWordHit {
  word: string;
  context: string;
  messageIndex: number;
  field: string;
}

export interface AuditSummary {
  totalFlags: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  bannedWordCount: number;
  flagsByType: Record<string, number>;
  flags: SecurityFlag[];
  bannedWordHits: BannedWordHit[];
}

/**
 * Build an audit summary from raw security data.
 */
export function buildAuditSummary(
  securityFlags: unknown[],
  bannedWordHits: unknown[]
): AuditSummary {
  const flags = normalizeFlags(securityFlags);
  const hits = normalizeBannedWords(bannedWordHits);

  const flagsByType: Record<string, number> = {};
  let criticalCount = 0;
  let warningCount = 0;
  let infoCount = 0;

  for (const flag of flags) {
    flagsByType[flag.type] = (flagsByType[flag.type] ?? 0) + 1;
    switch (flag.severity) {
      case "critical":
        criticalCount++;
        break;
      case "warning":
        warningCount++;
        break;
      case "info":
        infoCount++;
        break;
    }
  }

  return {
    totalFlags: flags.length,
    criticalCount,
    warningCount,
    infoCount,
    bannedWordCount: hits.length,
    flagsByType,
    flags,
    bannedWordHits: hits,
  };
}

/**
 * Check whether a session requires security review.
 */
export function requiresReview(summary: AuditSummary): boolean {
  return summary.criticalCount > 0 || summary.bannedWordCount > 0;
}

// ── Helpers ──

function normalizeFlags(raw: unknown[]): SecurityFlag[] {
  return raw
    .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null)
    .map((f) => ({
      type: String(f.type ?? "unknown"),
      severity: normalizeSeverity(f.severity),
      description: String(f.description ?? ""),
      messageIndex: typeof f.messageIndex === "number" ? f.messageIndex : undefined,
      detail: typeof f.detail === "object" ? (f.detail as Record<string, unknown>) : undefined,
    }));
}

function normalizeBannedWords(raw: unknown[]): BannedWordHit[] {
  return raw
    .filter((h): h is Record<string, unknown> => typeof h === "object" && h !== null)
    .map((h) => ({
      word: String(h.word ?? ""),
      context: String(h.context ?? ""),
      messageIndex: typeof h.messageIndex === "number" ? h.messageIndex : 0,
      field: String(h.field ?? ""),
    }));
}

function normalizeSeverity(
  value: unknown
): "info" | "warning" | "critical" {
  if (value === "critical" || value === "warning" || value === "info") {
    return value;
  }
  return "info";
}
