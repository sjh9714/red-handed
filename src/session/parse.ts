import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

/**
 * One line of a Claude Code transcript.
 *
 * Every field is optional on purpose: a single transcript spans multiple CLI
 * versions, and unknown line types appear all the time. Nothing here may be
 * assumed present.
 */
export interface RawContentBlock {
  type?: string;
  text?: string;
  /** tool_use */
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  /** tool_result */
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
}

export interface RawMessage {
  role?: string;
  id?: string;
  content?: string | RawContentBlock[];
}

export interface RawLine {
  type?: string;
  subtype?: string;
  uuid?: string;
  parentUuid?: string | null;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  isSidechain?: boolean;
  agentId?: string;
  isMeta?: boolean;
  isCompactSummary?: boolean;
  message?: RawMessage;
  toolUseResult?: unknown;
  attachment?: {
    type?: string;
    command?: string;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
  };
  [key: string]: unknown;
}

/**
 * Streams a JSONL transcript. Transcripts reach tens of megabytes, so this
 * never reads the whole file into memory. Malformed lines, non-object lines and
 * a missing file are all non-events — an unreadable line must never abort an audit.
 */
export async function* readJsonlLines(path: string): AsyncGenerator<RawLine> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const raw of rl) {
      const trimmed = raw.trim();
      if (trimmed === "") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      yield parsed as RawLine;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  } finally {
    rl.close();
    stream.destroy();
  }
}
