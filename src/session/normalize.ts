import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { readJsonlLines, type RawContentBlock, type RawLine } from "./parse.js";
import type {
  AgentAction,
  CommandAction,
  FileEditAction,
  HookAction,
  PatchHunk,
  TodoUpdateAction,
  UserMessageAction,
} from "../types.js";

/** Command output is kept from the tail: every test framework prints its summary last. */
const MAX_OUTPUT_CHARS = 64_000;
/** Edit strings are kept from the head; assertion-level edits are far smaller than this. */
const MAX_STRING_CHARS = 16_000;

/** timeout(1), SIGKILL and SIGTERM: the command was stopped, it did not decide anything. */
const KILLED_EXIT_CODES = new Set([124, 137, 143]);

const KNOWN_LINE_TYPES = new Set([
  "assistant",
  "user",
  "attachment",
  "system",
  "summary",
  "progress",
  "mode",
  "permission-mode",
  "queue-operation",
  "ai-title",
  "last-prompt",
  "pr-link",
  "agent-name",
  "file-history-snapshot",
  "file-history-delta",
  // Workflow agent lifecycle records, seen inside subagents/workflows/*.
  "started",
  "result",
]);

export interface NormalizedSession {
  actions: AgentAction[];
  cwd: string;
  sessionId: string;
  versions: string[];
  unrecognizedLineTypes: Record<string, number>;
}

interface Ordered {
  action: AgentAction;
  tsMs: number;
  fileIndex: number;
  lineIndex: number;
}

interface PendingCall {
  toolUseId: string;
  name: string;
  input: Record<string, unknown>;
  ts: string;
  tsMs: number;
  uuid: string;
  agentId?: string;
  lineIndex: number;
}

interface ToolResult {
  contentText: string;
  isError: boolean;
  raw: unknown;
}

function tailCap(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return text.slice(text.length - MAX_OUTPUT_CHARS);
}

function headCap(text: string): { value: string; truncated: boolean } {
  if (text.length <= MAX_STRING_CHARS) return { value: text, truncated: false };
  return { value: text.slice(0, MAX_STRING_CHARS), truncated: true };
}

function blocks(line: RawLine): RawContentBlock[] {
  const content = line.message?.content;
  return Array.isArray(content) ? content : [];
}

function textFromContent(content: string | RawContentBlock[] | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
}

function resultContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        b !== null && typeof b === "object" && typeof (b as { text?: unknown }).text === "string"
          ? ((b as { text: string }).text)
          : "",
      )
      .join("\n");
  }
  return "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseHunks(value: unknown): PatchHunk[] {
  if (!Array.isArray(value)) return [];
  const hunks: PatchHunk[] = [];
  for (const entry of value) {
    const rec = asRecord(entry);
    if (!rec) continue;
    const { oldStart, oldLines, newStart, newLines, lines } = rec;
    if (
      typeof oldStart !== "number" ||
      typeof newStart !== "number" ||
      !Array.isArray(lines)
    ) {
      continue;
    }
    hunks.push({
      oldStart,
      oldLines: typeof oldLines === "number" ? oldLines : 0,
      newStart,
      newLines: typeof newLines === "number" ? newLines : 0,
      lines: lines.filter((l): l is string => typeof l === "string"),
    });
  }
  return hunks;
}

/**
 * Recovers a command's outcome.
 *
 * A successful Bash call returns an object with stdout/stderr. A failure returns
 * a string that starts with "Error: Exit code N". Blocked or refused calls return
 * an error string with no exit code — those stay unknown, never "failed".
 */
function commandOutcome(result: ToolResult | undefined): {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  interrupted: boolean;
  background: boolean;
} {
  if (!result) {
    return { stdout: "", stderr: "", exitCode: null, interrupted: false, background: false };
  }
  const rec = asRecord(result.raw);
  if (rec && (typeof rec.stdout === "string" || typeof rec.stderr === "string")) {
    return {
      stdout: tailCap(typeof rec.stdout === "string" ? rec.stdout : ""),
      stderr: tailCap(typeof rec.stderr === "string" ? rec.stderr : ""),
      exitCode: result.isError ? null : 0,
      interrupted: rec.interrupted === true,
      background: typeof rec.backgroundTaskId === "string",
    };
  }
  const text = typeof result.raw === "string" ? result.raw : result.contentText;
  const match = /^(?:Error:\s*)?Exit code (\d+)/.exec(text);
  if (match) {
    const rest = text.slice(match[0].length).replace(/^\n/, "");
    const code = Number(match[1]);
    return {
      stdout: tailCap(rest),
      stderr: "",
      exitCode: code,
      // A command that was killed reports the signal that killed it, not a
      // verdict on the code. Tests that ran out of time have not failed.
      interrupted: /^Command timed out after/m.test(rest) || KILLED_EXIT_CODES.has(code),
      background: false,
    };
  }
  return {
    stdout: tailCap(text),
    stderr: "",
    exitCode: result.isError ? null : 0,
    interrupted: /interrupted/i.test(text),
    background: false,
  };
}

/** Recovers output that the CLI wrote to a side file instead of the transcript. */
function recoverOffloaded(text: string, toolResultsDir: string | null): string {
  if (!toolResultsDir) return text;
  const match = /tool-results\/([\w.\-]+\.txt)/.exec(text);
  if (!match) return text;
  const candidate = join(toolResultsDir, match[1] as string);
  try {
    if (!existsSync(candidate)) return text;
    return tailCap(readFileSync(candidate, "utf8"));
  } catch {
    return text;
  }
}

/** Subagent transcripts live beside the main one, in a directory named after the session. */
export function findSubagentTranscripts(mainPath: string): string[] {
  const sessionDir = join(dirname(mainPath), basename(mainPath, ".jsonl"));
  const found: string[] = [];
  const collect = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) collect(full);
      else if (entry.endsWith(".jsonl")) found.push(full);
    }
  };
  collect(join(sessionDir, "subagents"));
  return found.sort();
}

export function sessionToolResultsDir(mainPath: string): string | null {
  const dir = join(dirname(mainPath), basename(mainPath, ".jsonl"), "tool-results");
  return existsSync(dir) ? dir : null;
}

interface FileTrackerEntry {
  lastNewString: string;
}

/**
 * Turns one or more transcripts into a single ordered timeline.
 *
 * Tool calls and their results are joined by tool_use_id, never by adjacency:
 * background commands return out of order.
 */
export async function normalize(
  mainPath: string,
  options: { subagentPaths?: string[]; toolResultsDir?: string | null } = {},
): Promise<NormalizedSession> {
  const subagentPaths = options.subagentPaths ?? findSubagentTranscripts(mainPath);
  const toolResultsDir =
    options.toolResultsDir === undefined ? sessionToolResultsDir(mainPath) : options.toolResultsDir;

  const paths = [mainPath, ...subagentPaths];
  const ordered: Ordered[] = [];
  const unrecognized: Record<string, number> = {};
  const versions = new Set<string>();
  let cwd = "";
  let sessionId = "";

  for (const [fileIndex, path] of paths.entries()) {
    const calls: PendingCall[] = [];
    const results = new Map<string, ToolResult>();
    let lineIndex = 0;

    for await (const line of readJsonlLines(path)) {
      const index = lineIndex++;
      const ts = typeof line.timestamp === "string" ? line.timestamp : "";
      const tsMs = ts ? Date.parse(ts) : 0;
      const agentId = typeof line.agentId === "string" ? line.agentId : undefined;
      const uuid = typeof line.uuid === "string" ? line.uuid : `${path}:${index}`;

      if (typeof line.cwd === "string" && cwd === "") cwd = line.cwd;
      if (typeof line.sessionId === "string" && sessionId === "") sessionId = line.sessionId;
      if (typeof line.version === "string") versions.add(line.version);

      const type = typeof line.type === "string" ? line.type : "";
      if (type !== "" && !KNOWN_LINE_TYPES.has(type)) {
        unrecognized[type] = (unrecognized[type] ?? 0) + 1;
        continue;
      }

      if (type === "assistant") {
        for (const block of blocks(line)) {
          if (block.type === "text" && typeof block.text === "string" && block.text.trim() !== "") {
            ordered.push({
              action: { kind: "assistant-text", ts, seq: 0, uuid, agentId, text: block.text },
              tsMs,
              fileIndex,
              lineIndex: index,
            });
          } else if (block.type === "tool_use" && typeof block.id === "string") {
            calls.push({
              toolUseId: block.id,
              name: typeof block.name === "string" ? block.name : "",
              input: block.input ?? {},
              ts,
              tsMs,
              uuid,
              agentId,
              lineIndex: index,
            });
          }
          // "thinking" blocks are deliberately skipped: private reasoning is not a claim.
        }
        continue;
      }

      if (type === "user") {
        const resultBlock = blocks(line).find((b) => b?.type === "tool_result");
        if (resultBlock && typeof resultBlock.tool_use_id === "string") {
          results.set(resultBlock.tool_use_id, {
            contentText: recoverOffloaded(
              resultContentToText(resultBlock.content),
              toolResultsDir ?? null,
            ),
            isError: resultBlock.is_error === true,
            raw: line.toolUseResult,
          });
          continue;
        }
        if (line.isMeta === true || line.isCompactSummary === true) continue;
        const text = textFromContent(line.message?.content);
        if (text.trim() === "") continue;
        const action: UserMessageAction = {
          kind: "user-message",
          ts,
          seq: 0,
          uuid,
          agentId,
          text: headCap(text).value,
        };
        ordered.push({ action, tsMs, fileIndex, lineIndex: index });
        continue;
      }

      if (type === "attachment" && line.attachment?.type === "hook_success") {
        const hook: HookAction = {
          kind: "hook",
          ts,
          seq: 0,
          uuid,
          agentId,
          command: typeof line.attachment.command === "string" ? line.attachment.command : "",
          exitCode: typeof line.attachment.exitCode === "number" ? line.attachment.exitCode : null,
          stdout: tailCap(typeof line.attachment.stdout === "string" ? line.attachment.stdout : ""),
        };
        ordered.push({ action: hook, tsMs, fileIndex, lineIndex: index });
        continue;
      }
    }

    // Join calls to results now that every result in this file has been seen.
    const fileTracker = new Map<string, FileTrackerEntry>();
    for (const call of calls) {
      const result = results.get(call.toolUseId);
      const base = {
        ts: call.ts,
        seq: 0,
        uuid: call.uuid,
        agentId: call.agentId,
      };

      if (call.name === "Bash") {
        const outcome = commandOutcome(result);
        const command = typeof call.input.command === "string" ? call.input.command : "";
        const description =
          typeof call.input.description === "string" ? call.input.description : undefined;
        const action: CommandAction = {
          kind: "command",
          ...base,
          command,
          description,
          stdout: outcome.stdout,
          stderr: outcome.stderr,
          exitCode: outcome.exitCode,
          isError: result?.isError === true,
          interrupted: outcome.interrupted,
          background: outcome.background || call.input.run_in_background === true,
        };
        ordered.push({
          action,
          tsMs: call.tsMs,
          fileIndex,
          lineIndex: call.lineIndex,
        });
        continue;
      }

      if (call.name === "Edit" || call.name === "Write") {
        // An edit whose result errored never touched the file.
        if (!result || result.isError) continue;
        const rec = asRecord(result.raw);
        if (!rec) continue;
        const filePath =
          typeof rec.filePath === "string"
            ? rec.filePath
            : typeof call.input.file_path === "string"
              ? call.input.file_path
              : "";
        if (filePath === "") continue;

        const isWrite = call.name === "Write";
        const oldRaw = typeof rec.oldString === "string" ? rec.oldString : "";
        const newRaw = isWrite
          ? typeof rec.content === "string"
            ? rec.content
            : ""
          : typeof rec.newString === "string"
            ? rec.newString
            : "";
        const oldCapped = headCap(oldRaw);
        const newCapped = headCap(newRaw);
        const originalFile = typeof rec.originalFile === "string" ? rec.originalFile : undefined;

        const tracked = fileTracker.get(filePath);
        let precededByExternalChange = false;
        if (tracked && tracked.lastNewString !== "" && originalFile !== undefined) {
          precededByExternalChange = !originalFile.includes(tracked.lastNewString);
        }
        fileTracker.set(filePath, { lastNewString: newRaw });

        const opType: "create" | "update" =
          isWrite && rec.type === "create" ? "create" : "update";
        const action: FileEditAction = {
          kind: "file-edit",
          ...base,
          tool: isWrite ? "Write" : "Edit",
          filePath,
          opType,
          oldString: isWrite ? undefined : oldCapped.value,
          newString: newCapped.value,
          replaceAll: rec.replaceAll === true,
          content: isWrite ? newCapped.value : undefined,
          patch: parseHunks(rec.structuredPatch),
          userModified: rec.userModified === true,
          precededByExternalChange,
          truncated: oldCapped.truncated || newCapped.truncated,
        };
        ordered.push({
          action,
          tsMs: call.tsMs,
          fileIndex,
          lineIndex: call.lineIndex,
        });
        continue;
      }

      if (call.name === "TodoWrite") {
        const rec = asRecord(result?.raw);
        if (!rec) continue;
        const oldTodos = Array.isArray(rec.oldTodos) ? rec.oldTodos : [];
        const newTodos = Array.isArray(rec.newTodos) ? rec.newTodos : [];
        const statusBefore = new Map<string, string>();
        for (const todo of oldTodos) {
          const t = asRecord(todo);
          if (t && typeof t.content === "string" && typeof t.status === "string") {
            statusBefore.set(t.content, t.status);
          }
        }
        const completed: string[] = [];
        const started: string[] = [];
        for (const todo of newTodos) {
          const t = asRecord(todo);
          if (!t || typeof t.content === "string" === false) continue;
          const content = t.content as string;
          const status = typeof t.status === "string" ? t.status : "";
          const before = statusBefore.get(content);
          if (status === "completed" && before !== "completed") completed.push(content);
          if (status === "in_progress" && before !== "in_progress") started.push(content);
        }
        if (completed.length === 0 && started.length === 0) continue;
        const action: TodoUpdateAction = {
          kind: "todo-update",
          ...base,
          completed,
          started,
        };
        ordered.push({ action, tsMs: call.tsMs, fileIndex, lineIndex: call.lineIndex });
      }
    }
  }

  ordered.sort((a, b) => {
    if (a.tsMs !== b.tsMs) return a.tsMs - b.tsMs;
    if (a.fileIndex !== b.fileIndex) return a.fileIndex - b.fileIndex;
    return a.lineIndex - b.lineIndex;
  });

  const actions = ordered.map((entry, index) => {
    entry.action.seq = index;
    return entry.action;
  });

  return {
    actions,
    cwd,
    sessionId,
    versions: [...versions],
    unrecognizedLineTypes: unrecognized,
  };
}
