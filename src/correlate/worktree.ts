import { readFileSync } from "node:fs";
import { relative } from "node:path";

export interface WorktreeAnchor {
  line: number;
  snippet: string;
}

export interface WorktreeReader {
  /** Current file content, or null when the file is gone. Cached per path. */
  read(path: string): string | null;
  /** Where a snippet sits today, or null when it is no longer there. */
  locate(path: string, needle: string): WorktreeAnchor | null;
  relative(path: string): string;
}

function normalizeWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function lineOfOffset(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i += 1) {
    if (content[i] === "\n") line += 1;
  }
  return line;
}

/**
 * Reads the repository as it stands right now.
 *
 * Every finding is re-checked against this before it is reported: if the agent
 * weakened a test and then put it back, there is nothing to accuse it of.
 */
export function createWorktreeReader(repoRoot: string | null): WorktreeReader {
  const cache = new Map<string, string | null>();

  const read = (path: string): string | null => {
    const cached = cache.get(path);
    if (cached !== undefined) return cached;
    let content: string | null;
    try {
      content = readFileSync(path, "utf8");
    } catch {
      content = null;
    }
    cache.set(path, content);
    return content;
  };

  return {
    read,
    locate(path, needle) {
      const content = read(path);
      if (content === null || needle.trim() === "") return null;

      const exact = content.indexOf(needle);
      if (exact !== -1) {
        return { line: lineOfOffset(content, exact), snippet: needle.trim() };
      }

      // Fall back to a whitespace-insensitive line match, so a reformatted file
      // still anchors instead of silently dropping a real finding.
      const wanted = normalizeWhitespace(needle);
      if (wanted === "" || wanted.includes("\n")) return null;
      const lines = content.split("\n");
      for (const [index, line] of lines.entries()) {
        if (normalizeWhitespace(line) === wanted) {
          return { line: index + 1, snippet: line.trim() };
        }
      }
      return null;
    },
    relative(path) {
      if (!repoRoot) return path;
      const rel = relative(repoRoot, path);
      return rel === "" || rel.startsWith("..") ? path : rel;
    },
  };
}
