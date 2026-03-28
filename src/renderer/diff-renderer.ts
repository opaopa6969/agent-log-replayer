/**
 * Diff Renderer
 *
 * Produces structured diff output for file changes made by
 * Edit and Write tool invocations. Used by the DiffView
 * frontend component.
 */

export interface DiffHunk {
  /** Line number in the original file */
  oldStart: number;
  /** Line number in the new file */
  newStart: number;
  /** Lines in this hunk */
  lines: DiffLine[];
}

export interface DiffLine {
  type: "context" | "add" | "remove";
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

export interface FileDiff {
  filePath: string;
  toolName: "Edit" | "Write";
  hunks: DiffHunk[];
  /** True if this was a new file creation */
  isNew: boolean;
}

/**
 * Build a diff from an Edit tool invocation.
 */
export function buildEditDiff(
  filePath: string,
  oldString: string,
  newString: string,
  contextLines = 3
): FileDiff {
  const oldLines = oldString.split("\n");
  const newLines = newString.split("\n");

  // Simple line-by-line diff for Edit operations
  const hunk: DiffHunk = {
    oldStart: 1,
    newStart: 1,
    lines: [],
  };

  // Show removed lines
  for (let i = 0; i < oldLines.length; i++) {
    hunk.lines.push({
      type: "remove",
      content: oldLines[i],
      oldLineNo: i + 1,
    });
  }

  // Show added lines
  for (let i = 0; i < newLines.length; i++) {
    hunk.lines.push({
      type: "add",
      content: newLines[i],
      newLineNo: i + 1,
    });
  }

  return {
    filePath,
    toolName: "Edit",
    hunks: [hunk],
    isNew: false,
  };
}

/**
 * Build a diff from a Write tool invocation (new file or full overwrite).
 */
export function buildWriteDiff(
  filePath: string,
  content: string
): FileDiff {
  const lines = content.split("\n");
  const hunk: DiffHunk = {
    oldStart: 0,
    newStart: 1,
    lines: lines.map((line, i) => ({
      type: "add" as const,
      content: line,
      newLineNo: i + 1,
    })),
  };

  return {
    filePath,
    toolName: "Write",
    hunks: [hunk],
    isNew: true,
  };
}

/**
 * Extract diffs from tool_uses in a message.
 */
export function extractDiffsFromToolUses(toolUses: unknown[]): FileDiff[] {
  const diffs: FileDiff[] = [];

  for (const tool of toolUses) {
    const t = tool as {
      name?: string;
      input?: Record<string, unknown>;
    };

    if (t.name === "Edit" && t.input) {
      const filePath = String(t.input.file_path ?? "");
      const oldStr = String(t.input.old_string ?? "");
      const newStr = String(t.input.new_string ?? "");
      if (filePath && (oldStr || newStr)) {
        diffs.push(buildEditDiff(filePath, oldStr, newStr));
      }
    } else if (t.name === "Write" && t.input) {
      const filePath = String(t.input.file_path ?? "");
      const content = String(t.input.content ?? "");
      if (filePath) {
        diffs.push(buildWriteDiff(filePath, content));
      }
    }
  }

  return diffs;
}
