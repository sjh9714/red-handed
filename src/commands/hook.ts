import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HOOK_COMMAND = "npx --yes red-handed hook";
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

function settingsPath(claudeHome: string): string {
  return join(claudeHome, "settings.json");
}

function readSettings(path: string): Settings {
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed !== null && typeof parsed === "object" ? (parsed as Settings) : {};
  } catch {
    return {};
  }
}

function containsHook(groups: HookGroup[]): boolean {
  return groups.some((group) => group.hooks?.some((h) => h.command?.includes(MARKER)));
}

export interface HookResult {
  changed: boolean;
  message: string;
  path: string;
}

/**
 * Adds an audit to the end of every session.
 *
 * Existing hooks are left exactly as they are — this machine already runs
 * several — and the previous settings are copied aside first.
 */
export function installHook(claudeHome: string): HookResult {
  const path = settingsPath(claudeHome);
  const settings = readSettings(path);
  const hooks = settings.hooks ?? {};
  const stop = hooks.Stop ?? [];

  if (containsHook(stop)) {
    return { changed: false, message: "already installed", path };
  }

  if (existsSync(path)) copyFileSync(path, `${path}.red-handed-backup`);
  else writeFileSync(`${path}.red-handed-backup`, JSON.stringify({ hooks: {} }, null, 2));

  const updated: Settings = {
    ...settings,
    hooks: {
      ...hooks,
      Stop: [...stop, { hooks: [{ type: "command", command: HOOK_COMMAND, timeout: 30 }] }],
    },
  };
  writeFileSync(path, `${JSON.stringify(updated, null, 2)}\n`);
  return { changed: true, message: "installed", path };
}

export function uninstallHook(claudeHome: string): HookResult {
  const path = settingsPath(claudeHome);
  const settings = readSettings(path);
  const hooks = settings.hooks ?? {};
  const stop = hooks.Stop ?? [];
  if (!containsHook(stop)) return { changed: false, message: "not installed", path };

  if (existsSync(path)) copyFileSync(path, `${path}.red-handed-backup`);
  const cleaned = stop
    .map((group) => ({
      ...group,
      hooks: (group.hooks ?? []).filter((h) => !h.command?.includes(MARKER)),
    }))
    .filter((group) => (group.hooks ?? []).length > 0);

  writeFileSync(
    path,
    `${JSON.stringify({ ...settings, hooks: { ...hooks, Stop: cleaned } }, null, 2)}\n`,
  );
  return { changed: true, message: "removed", path };
}
