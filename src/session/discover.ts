import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { SessionInfo } from "../types.js";
import { findSubagentTranscripts, sessionToolResultsDir } from "./normalize.js";
import { readJsonlLines } from "./parse.js";

export interface DiscoverOptions {
  claudeHome?: string;
}

/** How Claude Code names a project's transcript directory. */
export function flattenPath(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, "-");
}

export function claudeHomeDir(options: DiscoverOptions = {}): string {
  return options.claudeHome ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
}

function projectsDir(options: DiscoverOptions = {}): string {
  return join(claudeHomeDir(options), "projects");
}

/**
 * Reads the working directory recorded inside a transcript.
 *
 * The directory name cannot be trusted for this: "/work/np-watch" and
 * "/work/np/watch" flatten to exactly the same thing, and both exist on this
 * machine. Only the transcript knows which is which.
 */
async function readSessionCwd(path: string): Promise<string | null> {
  for await (const line of readJsonlLines(path)) {
    if (typeof line.cwd === "string" && line.cwd !== "") return line.cwd;
  }
  return null;
}

/** Synchronous first-line scan, so discovery stays cheap on hundreds of files. */
function readSessionCwdSync(path: string): string | null {
  // A transcript's cwd appears within the first few lines; read a small prefix.
  const PREFIX_BYTES = 64 * 1024;
  try {
    const size = statSync(path).size;
    if (size <= PREFIX_BYTES) {
      return extractCwd(readFileSync(path, "utf8"));
    }
    const fd = openSync(path, "r");
    try {
      const buffer = Buffer.alloc(PREFIX_BYTES);
      const read = readSync(fd, buffer, 0, PREFIX_BYTES, 0);
      return extractCwd(buffer.subarray(0, read).toString("utf8"));
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

function extractCwd(text: string): string | null {
  for (const line of text.split("\n")) {
    const match = /"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(line);
    if (!match) continue;
    try {
      return JSON.parse(`"${match[1]}"`) as string;
    } catch {
      return match[1] ?? null;
    }
  }
  return null;
}

function toSessionInfo(path: string, cwd: string): SessionInfo | null {
  let stats;
  try {
    stats = statSync(path);
  } catch {
    return null;
  }
  const sessionId = path.split("/").pop()?.replace(/\.jsonl$/, "") ?? path;
  return {
    sessionId,
    transcriptPath: path,
    cwd,
    mtimeMs: stats.mtimeMs,
    sizeBytes: stats.size,
    subagentPaths: findSubagentTranscripts(path),
    toolResultsDir: sessionToolResultsDir(path),
  };
}

function isInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith("/") ? parent : `${parent}/`);
}

/**
 * Every session recorded for a directory, newest first.
 *
 * Sessions started in a subdirectory count too: work on one package of a
 * monorepo belongs to the repository as a whole.
 */
export function sessionsForCwd(cwd: string, options: DiscoverOptions = {}): SessionInfo[] {
  const root = resolve(cwd);
  const dir = projectsDir(options);
  if (!existsSync(dir)) return [];

  const prefix = flattenPath(root);
  const found: SessionInfo[] = [];

  for (const entry of readdirSync(dir)) {
    if (entry !== prefix && !entry.startsWith(`${prefix}-`)) continue;
    const projectPath = join(dir, entry);
    let files: string[];
    try {
      if (!statSync(projectPath).isDirectory()) continue;
      files = readdirSync(projectPath);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const full = join(projectPath, file);
      const sessionCwd = readSessionCwdSync(full);
      if (sessionCwd === null || !isInside(sessionCwd, root)) continue;
      const info = toSessionInfo(full, sessionCwd);
      if (info) found.push(info);
    }
  }

  return found.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** Every session on this machine, newest first. */
export function allSessions(options: DiscoverOptions = {}): SessionInfo[] {
  const dir = projectsDir(options);
  if (!existsSync(dir)) return [];
  const found: SessionInfo[] = [];
  for (const entry of readdirSync(dir)) {
    const projectPath = join(dir, entry);
    let files: string[];
    try {
      if (!statSync(projectPath).isDirectory()) continue;
      files = readdirSync(projectPath);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const full = join(projectPath, file);
      const sessionCwd = readSessionCwdSync(full) ?? "";
      const info = toSessionInfo(full, sessionCwd);
      if (info) found.push(info);
    }
  }
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** Resolves `--session`, which may be a transcript path or a session id. */
export async function sessionByIdOrPath(
  value: string,
  options: DiscoverOptions = {},
): Promise<SessionInfo | null> {
  if (isAbsolute(value) || value.endsWith(".jsonl")) {
    const path = resolve(value);
    if (!existsSync(path)) return null;
    return toSessionInfo(path, (await readSessionCwd(path)) ?? "");
  }
  return allSessions(options).find((s) => s.sessionId.startsWith(value)) ?? null;
}
