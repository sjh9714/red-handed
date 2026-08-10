import {
  accessSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The @latest is load-bearing: npx cannot derive the bin of a scoped package
// from a bare `npx @scope/name`, but resolves it correctly with a version tag.
const HOOK_COMMAND = "npx --yes @jinhyuk9714/red-handed@latest hook";
const MARKER = "red-handed";

/** Written into the entries this tool creates, so uninstall can find its own. */
const INSTALLED_BY = "red-handed";

interface HookEntry {
  type?: string;
  command?: string;
  timeout?: number;
  /** Present on entries this tool wrote. Claude Code ignores what it does not know. */
  installedBy?: string;
}

/**
 * Whether this is the hook this tool installed — not merely one that mentions it.
 *
 * The first version matched the substring "red-handed" anywhere in the command,
 * which also swept up a wrapper script called red-handed-notify.sh and a clone
 * checked out at a path containing the name. Uninstalling one tool is not
 * permission to delete another.
 *
 * Identity now comes from a property this tool writes, not from reading the
 * command. That is the only way to tell `install-hook --local` apart from a hook
 * someone wrote themselves pointing at their own build — the two commands are
 * identical. The published command is still matched exactly, so hooks installed
 * before this property existed are still recognised.
 */
function isOurs(entry: HookEntry | undefined): boolean {
  if (!entry) return false;
  if (entry.installedBy === INSTALLED_BY) return true;
  return typeof entry.command === "string" && entry.command.trim() === HOOK_COMMAND;
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
    (Array.isArray(group?.hooks) ? group.hooks : []).some((h) => isOurs(h)),
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
        {
          hooks: [
            {
              type: "command",
              command: options.command ?? HOOK_COMMAND,
              timeout: 30,
              installedBy: INSTALLED_BY,
            },
          ],
        },
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
        (h) => !isOurs(h),
      ),
    }))
    .filter((group) => group.hooks.length > 0);

  writeAtomically(
    path,
    `${JSON.stringify({ ...settings, hooks: { ...(settings.hooks ?? {}), Stop: cleaned } }, null, 2)}\n`,
  );
  return { changed: true, message: "removed", path };
}

/** Marks the entries `fix` writes, so `unfix` removes those and nothing else. */
const FIX_INSTALLED_BY = "red-handed-fix";

function isOurFix(entry: HookEntry | undefined): boolean {
  return entry?.installedBy === FIX_INSTALLED_BY;
}

function preToolUseGroups(settings: Settings): HookGroup[] {
  const groups = settings.hooks?.PreToolUse;
  return Array.isArray(groups) ? groups : [];
}

function containsFix(groups: HookGroup[]): boolean {
  return groups.some((group) =>
    (Array.isArray(group?.hooks) ? group.hooks : []).some((h) => isOurFix(h)),
  );
}

/** Where the standalone hook script lives once installed. */
function fixScriptPath(env: Record<string, string | undefined> = process.env): string {
  return join(env.RED_HANDED_HOME ?? join(homedir(), ".red-handed"), "fix-pipes.mjs");
}

/**
 * Stops the agent cutting test output before the result is recorded.
 *
 * Copies the standalone script next to the cache and registers it as a
 * PreToolUse hook on Bash. The script runs on every shell command, so it must
 * not go through npx: the copy is dependency free and starts in the time node
 * takes to boot. It rewrites nothing but the command text, and never the
 * permission decision.
 */
export function installFix(
  claudeHome: string,
  options: { scriptSource?: string; env?: Record<string, string | undefined> } = {},
): HookResult {
  const path = settingsPath(claudeHome);
  const settings = readSettings(path);
  const groups = preToolUseGroups(settings);
  if (containsFix(groups)) return { changed: false, message: "already installed", path };

  // Bundled, this file lives in dist/cli.js and the script is its sibling.
  // Under the test runner it lives in src/commands/ and the sibling is the
  // built copy in dist. Whichever exists is the one to install.
  const source =
    options.scriptSource ??
    ["./fix-hook.js", "../../dist/fix-hook.js"]
      .map((rel) => fileURLToPath(new URL(rel, import.meta.url)))
      .find((p) => existsSync(p));
  if (!source) {
    throw new HookError("cannot find the built fix-hook script; run the build first");
  }
  const target = fixScriptPath(options.env);
  try {
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    copyFileSync(source, target);
  } catch (error) {
    throw new HookError(`cannot write ${target}: ${(error as Error).message}`);
  }

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
      PreToolUse: [
        ...groups,
        {
          matcher: "Bash",
          hooks: [
            {
              type: "command",
              command: `node "${target}"`,
              timeout: 10,
              installedBy: FIX_INSTALLED_BY,
            },
          ],
        },
      ],
    },
  };
  writeAtomically(path, `${JSON.stringify(updated, null, 2)}\n`);
  return { changed: true, message: "installed", path };
}

export function uninstallFix(
  claudeHome: string,
  options: { env?: Record<string, string | undefined> } = {},
): HookResult {
  const path = settingsPath(claudeHome);
  const settings = readSettings(path);
  const groups = preToolUseGroups(settings);
  if (!containsFix(groups)) return { changed: false, message: "not installed", path };

  backupOnce(path);
  const cleaned = groups
    .map((group) => ({
      ...group,
      hooks: (Array.isArray(group?.hooks) ? group.hooks : []).filter((h) => !isOurFix(h)),
    }))
    .filter((group) => group.hooks.length > 0);

  writeAtomically(
    path,
    `${JSON.stringify(
      { ...settings, hooks: { ...(settings.hooks ?? {}), PreToolUse: cleaned } },
      null,
      2,
    )}\n`,
  );
  try {
    rmSync(fixScriptPath(options.env), { force: true });
  } catch {
    // The hook entry is gone; a leftover script that nothing calls can stay.
  }
  return { changed: true, message: "removed", path };
}
