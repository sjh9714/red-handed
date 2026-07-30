import { join } from "node:path";
import type { FileEditAction, PatchHunk } from "../types.js";
import { runGit } from "./repo.js";

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

interface ParsedFile {
  path: string;
  created: boolean;
  hunks: PatchHunk[];
}

/** Reads unified diff text into per-file hunks. */
export function parseUnifiedDiff(diff: string): ParsedFile[] {
  const files: ParsedFile[] = [];
  let current: ParsedFile | null = null;
  let hunk: PatchHunk | null = null;
  let pendingCreated = false;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      current = null;
      hunk = null;
      pendingCreated = false;
      continue;
    }
    if (line.startsWith("new file mode")) {
      pendingCreated = true;
      continue;
    }
    if (line.startsWith("--- ")) {
      // A new file's old side reads /dev/null, which arrives before the path.
      if (line.slice(4).trim() === "/dev/null") pendingCreated = true;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const path = line.slice(4).trim();
      if (path === "/dev/null") {
        // The file was deleted: there is nothing left to point a finding at.
        current = null;
        continue;
      }
      current = { path: path.replace(/^b\//, ""), created: pendingCreated, hunks: [] };
      files.push(current);
      continue;
    }
    const header = HUNK_HEADER.exec(line);
    if (header && current) {
      hunk = {
        oldStart: Number(header[1]),
        oldLines: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newLines: header[4] === undefined ? 1 : Number(header[4]),
        lines: [],
      };
      current.hunks.push(hunk);
      continue;
    }
    if (hunk && (line.startsWith("+") || line.startsWith("-") || line.startsWith(" "))) {
      hunk.lines.push(line);
    }
  }

  return files.filter((f) => f.path !== "" && f.hunks.length > 0);
}

/**
 * Reads the repository's own record of what changed, for when there is no
 * transcript: a different agent wrote the code, or the logs are long gone.
 */
export function diffActions(repoRoot: string, range?: string): FileEditAction[] {
  const args = ["diff", "--no-color", "--unified=3", "--no-ext-diff"];
  if (range) args.push(range);
  else args.push("HEAD");
  const diff = runGit(repoRoot, args);
  if (diff === null) return [];

  return parseUnifiedDiff(diff).map((file, index) => {
    const added = file.hunks
      .flatMap((h) => h.lines)
      .filter((l) => l.startsWith("+"))
      .map((l) => l.slice(1));
    const removed = file.hunks
      .flatMap((h) => h.lines)
      .filter((l) => l.startsWith("-"))
      .map((l) => l.slice(1));

    return {
      kind: "file-edit",
      ts: "",
      seq: index,
      uuid: `git:${file.path}`,
      tool: "Edit",
      filePath: join(repoRoot, file.path),
      opType: file.created ? "create" : "update",
      oldString: removed.join("\n"),
      newString: added.join("\n"),
      replaceAll: false,
      patch: file.hunks,
      userModified: false,
      precededByExternalChange: false,
      truncated: false,
    };
  });
}
