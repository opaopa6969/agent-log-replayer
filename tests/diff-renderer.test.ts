import { describe, it, expect } from "vitest";
import {
  buildEditDiff,
  buildWriteDiff,
  extractDiffsFromToolUses,
} from "../src/renderer/diff-renderer.js";

describe("buildEditDiff", () => {
  it("sets correct filePath and toolName", () => {
    const diff = buildEditDiff("/src/foo.ts", "old line\n", "new line\n");
    expect(diff.filePath).toBe("/src/foo.ts");
    expect(diff.toolName).toBe("Edit");
  });

  it("isNew is false", () => {
    const diff = buildEditDiff("/src/foo.ts", "old", "new");
    expect(diff.isNew).toBe(false);
  });

  it("remove lines come before add lines", () => {
    const diff = buildEditDiff("/src/foo.ts", "old line", "new line");
    const lines = diff.hunks[0].lines;
    const firstRemoveIdx = lines.findIndex((l) => l.type === "remove");
    const firstAddIdx = lines.findIndex((l) => l.type === "add");
    expect(firstRemoveIdx).toBeGreaterThanOrEqual(0);
    expect(firstAddIdx).toBeGreaterThanOrEqual(0);
    expect(firstRemoveIdx).toBeLessThan(firstAddIdx);
  });

  it("line numbers are set correctly", () => {
    const oldString = "line1\nline2\nline3";
    const newString = "lineA\nlineB";
    const diff = buildEditDiff("/src/foo.ts", oldString, newString);
    const lines = diff.hunks[0].lines;

    const removeLines = lines.filter((l) => l.type === "remove");
    const addLines = lines.filter((l) => l.type === "add");

    // Remove lines should have sequential oldLineNo starting from 1
    expect(removeLines[0].oldLineNo).toBe(1);
    expect(removeLines[1].oldLineNo).toBe(2);
    expect(removeLines[2].oldLineNo).toBe(3);

    // Add lines should have sequential newLineNo starting from 1
    expect(addLines[0].newLineNo).toBe(1);
    expect(addLines[1].newLineNo).toBe(2);
  });
});

describe("buildWriteDiff", () => {
  it("isNew is true", () => {
    const diff = buildWriteDiff("/src/new-file.ts", "content here");
    expect(diff.isNew).toBe(true);
  });

  it("all lines are 'add' type", () => {
    const diff = buildWriteDiff("/src/new-file.ts", "line1\nline2\nline3");
    const lines = diff.hunks[0].lines;
    expect(lines.every((l) => l.type === "add")).toBe(true);
  });

  it("newLineNo is sequential starting from 1", () => {
    const diff = buildWriteDiff("/src/new-file.ts", "line1\nline2\nline3");
    const lines = diff.hunks[0].lines;
    expect(lines[0].newLineNo).toBe(1);
    expect(lines[1].newLineNo).toBe(2);
    expect(lines[2].newLineNo).toBe(3);
  });

  it("sets correct filePath and toolName", () => {
    const diff = buildWriteDiff("/src/new-file.ts", "content");
    expect(diff.filePath).toBe("/src/new-file.ts");
    expect(diff.toolName).toBe("Write");
  });
});

describe("extractDiffsFromToolUses", () => {
  it("extracts Edit tool diffs", () => {
    const toolUses = [
      {
        name: "Edit",
        input: {
          file_path: "/src/foo.ts",
          old_string: "old content",
          new_string: "new content",
        },
      },
    ];
    const diffs = extractDiffsFromToolUses(toolUses);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].toolName).toBe("Edit");
    expect(diffs[0].filePath).toBe("/src/foo.ts");
    expect(diffs[0].isNew).toBe(false);
  });

  it("extracts Write tool diffs", () => {
    const toolUses = [
      {
        name: "Write",
        input: {
          file_path: "/src/new-file.ts",
          content: "brand new content",
        },
      },
    ];
    const diffs = extractDiffsFromToolUses(toolUses);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].toolName).toBe("Write");
    expect(diffs[0].filePath).toBe("/src/new-file.ts");
    expect(diffs[0].isNew).toBe(true);
  });

  it("skips non-Edit/Write tools", () => {
    const toolUses = [
      { name: "Read", input: { file_path: "/src/foo.ts" } },
      { name: "Bash", input: { command: "ls -la" } },
      { name: "Grep", input: { pattern: "foo", path: "/src" } },
    ];
    const diffs = extractDiffsFromToolUses(toolUses);
    expect(diffs).toHaveLength(0);
  });

  it("handles malformed input gracefully", () => {
    const toolUses = [
      {}, // no name or input
      { name: "Edit" }, // missing input
      { name: "Edit", input: {} }, // missing file_path, old_string, new_string
      { name: "Write", input: {} }, // missing file_path
    ];
    // Should not throw
    expect(() => extractDiffsFromToolUses(toolUses as unknown[])).not.toThrow();
    const diffs = extractDiffsFromToolUses(toolUses as unknown[]);
    // None should produce a diff (no filePath)
    expect(diffs).toHaveLength(0);
  });

  it("skips Edit when both old_string and new_string are empty", () => {
    // Guard in extractDiffsFromToolUses: `if (filePath && (oldStr || newStr))`.
    // When both strings are empty there is nothing to diff; emitting an
    // empty hunk would pollute the DiffView. Regression-prone because the
    // truthiness check is easy to drop during refactors.
    const toolUses = [
      {
        name: "Edit",
        input: {
          file_path: "/src/foo.ts",
          old_string: "",
          new_string: "",
        },
      },
    ];
    const diffs = extractDiffsFromToolUses(toolUses);
    expect(diffs).toHaveLength(0);
  });
});
