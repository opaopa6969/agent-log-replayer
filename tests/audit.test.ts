import { describe, it, expect } from "vitest";
import {
  buildAuditSummary,
  requiresReview,
} from "../src/security/audit.js";

describe("buildAuditSummary", () => {
  it("returns all zeros for empty inputs", () => {
    const summary = buildAuditSummary([], []);
    expect(summary.totalFlags).toBe(0);
    expect(summary.criticalCount).toBe(0);
    expect(summary.warningCount).toBe(0);
    expect(summary.infoCount).toBe(0);
    expect(summary.bannedWordCount).toBe(0);
    expect(summary.flagsByType).toEqual({});
    expect(summary.flags).toHaveLength(0);
    expect(summary.bannedWordHits).toHaveLength(0);
  });

  it("counts severity levels correctly", () => {
    const flags = [
      { type: "file_access", severity: "critical", description: "Sensitive file" },
      { type: "command", severity: "warning", description: "Suspicious command" },
      { type: "url", severity: "info", description: "External URL" },
      { type: "file_access", severity: "critical", description: "Another sensitive file" },
    ];
    const summary = buildAuditSummary(flags, []);
    expect(summary.totalFlags).toBe(4);
    expect(summary.criticalCount).toBe(2);
    expect(summary.warningCount).toBe(1);
    expect(summary.infoCount).toBe(1);
  });

  it("aggregates flagsByType correctly", () => {
    const flags = [
      { type: "file_access", severity: "critical", description: "A" },
      { type: "file_access", severity: "warning", description: "B" },
      { type: "command", severity: "info", description: "C" },
    ];
    const summary = buildAuditSummary(flags, []);
    expect(summary.flagsByType).toEqual({ file_access: 2, command: 1 });
  });

  it("normalizes unknown/invalid severity to 'info'", () => {
    const flags = [
      { type: "unknown_type", severity: "bogus", description: "Bad severity" },
      { type: "null_severity", severity: null, description: "Null severity" },
      { type: "missing_severity", description: "No severity field" },
    ];
    const summary = buildAuditSummary(flags, []);
    expect(summary.criticalCount).toBe(0);
    expect(summary.warningCount).toBe(0);
    expect(summary.infoCount).toBe(3);
  });

  it("handles non-object items gracefully", () => {
    const flags = [
      null,
      undefined,
      "string",
      42,
      { type: "valid", severity: "info", description: "Valid flag" },
    ];
    const summary = buildAuditSummary(flags as unknown[], []);
    // Only the valid object should be counted
    expect(summary.totalFlags).toBe(1);
    expect(summary.infoCount).toBe(1);
  });

  it("includes banned word hits in count", () => {
    const hits = [
      { word: "secret", context: "some context", messageIndex: 0, field: "text" },
      { word: "password", context: "other context", messageIndex: 1, field: "tool_input" },
    ];
    const summary = buildAuditSummary([], hits);
    expect(summary.bannedWordCount).toBe(2);
    expect(summary.bannedWordHits).toHaveLength(2);
  });
});

describe("requiresReview", () => {
  it("returns false when criticalCount=0 and bannedWordCount=0", () => {
    const summary = buildAuditSummary(
      [{ type: "url", severity: "info", description: "External URL" }],
      []
    );
    expect(requiresReview(summary)).toBe(false);
  });

  it("returns true when criticalCount > 0", () => {
    const summary = buildAuditSummary(
      [{ type: "file_access", severity: "critical", description: "Sensitive file" }],
      []
    );
    expect(requiresReview(summary)).toBe(true);
  });

  it("returns true when bannedWordCount > 0", () => {
    const hits = [
      { word: "secret", context: "some context", messageIndex: 0, field: "text" },
    ];
    const summary = buildAuditSummary([], hits);
    expect(requiresReview(summary)).toBe(true);
  });
});
