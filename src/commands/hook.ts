import {
  accessSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const HOOK_COMMAND = "npx --yes @jinhyuk9714/red-handed hook";
const MARKER = "red-handed";

interface HookEntry {
  type?: string;
  command?: string;
  timeout?: number;
}

interface HookGroup {
  hooks?: HookEntry[];
  matcher?: string;
}

interface Settings {
  hooks?: Record<string, HookGroup[]>;
  [key: string]: unknown;
}

export class HookError extends Error {}

function settingsPath(claudeHome: string): string {
  return join(claudeHome, "settings.json");
}

/**
 * Reads the settings file, refusing to guess.
 *
 * An absent file is an empty object; an unreadable one is an error. Treating
 * the two the same is how a tool ends up writing a hooks-only file over
 * someone's whole configuration and reporting success.
 */
function readSettings(path: string): Settings {
  if (!existsSync(path)) return {};
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new HookError(`cannot read ${path}: ${(error as Error).message}`);
  }
  if (raw.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not a JSON object");
    }
    return parsed as Settings;
  } catch {
    throw new HookError(
      `${path} is not valid JSON, so it has been left alone. Fix or move it, then try again.`,
    );
  }
}

function stopGroups(settings: Settings): HookGroup[] {
  const stop = settings.hooks?.Stop;
  return Array.isArray(stop) ? stop : [];
}

function containsHook(groups: HookGroup[]): boolean {
  return groups.some((group) =>
    (Array.isArray(group?.hooks) ? group.hooks : []).some((h) => h?.command?.includes(MARKER)),
  );
}

/** Keeps the first backup: it is the only copy of what the user had before. */
function backupOnce(path: string): void {
  if (!existsSync(path)) return;
  const backup = `${path}.${MARKER}-backup`;
  if (existsSync(backup)) return;
  copyFileSync(path, backup);
}

/** Writes through a temporary file, so a failure can never truncate the original. */
function writeAtomically(path: string, contents: string): void {
  // Renaming over a read-only file succeeds on POSIX, because the permission
  // that matters is the directory's. Someone who marked this file read-only
  // meant it, so ask before going around them.
  if (existsSync(path)) {
    try {
      accessSync(path, constants.W_OK);
    } catch {
      throw new HookError(`${path} is not writable, so it has been left alone.`);
    }
  }
  const temporary = `${path}.${MARKER}-tmp`;
  try {
    writeFileSync(temporary, contents, { mode: 0o600 });
    renameSync(temporary, path);
  } catch (error) {
    throw new HookError(`cannot write ${path}: ${(error as Error).message}`);
  }
}

export interface HookResult {
  changed: boolean;
  message: string;
  path: string;
}

/**
 * Adds an audit to the end of every session.
 *
 * Existing hooks and every other setting are left exactly as they are, and the
 * original file is copied aside before anything is written.
 */
export function installHook(claudeHome: string, options: { command?: string } = {}): HookResult {
  const path = settingsPath(claudeHome);
  const settings = readSettings(path);
  const stop = stopGroups(settings);

  if (containsHook(stop)) return { changed: false, message: "already installed", path };

  try {
    mkdirSync(claudeHome, { recursive: true });
  } catch (error) {
    throw new HookError(`cannot create ${claudeHome}: ${(error as Error).message}`);
  }
  backupOnce(path);

  const updated: Settings = {
    ...settings,
    hooks: {
      ...(settings.hooks ?? {}),
      Stop: [
        ...stop,
        { hooks: [{ type: "command", command: options.command ?? HOOK_COMMAND, timeout: 30 }] },
      ],
    },
  };
  writeAtomically(path, `${JSON.stringify(updated, null, 2)}\n`);
  return { changed: true, message: "installed", path };
}

export function uninstallHook(claudeHome: string): HookResult {
  const path = settingsPath(claudeHome);
  const settings = readSettings(path);
  const stop = stopGroups(settings);
  if (!containsHook(stop)) return { changed: false, message: "not installed", path };

  backupOnce(path);
  const cleaned = stop
    .map((group) => ({
      ...group,
      hooks: (Array.isArray(group?.hooks) ? group.hooks : []).filter(
        (h) => !h?.command?.includes(MARKER),
      ),
    }))
    .filter((group) => group.hooks.length > 0);

  writeAtomically(
    path,
    `${JSON.stringify({ ...settings, hooks: { ...(settings.hooks ?? {}), Stop: cleaned } }, null, 2)}\n`,
  );
  return { changed: true, message: "removed", path };
}
