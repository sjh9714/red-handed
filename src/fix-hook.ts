/**
 * Strips the pipe that eats test results, before the command runs.
 *
 * Agents save context by writing `npx vitest run 2>&1 | tail -5`, and the line
 * that says how many tests passed is often above those five. The run happened;
 * the record kept nothing. This is a PreToolUse hook: when the agent is about
 * to run a test command whose output ends in a truncating filter, it removes
 * the filter so the result reaches the transcript. Median test output is a few
 * hundred characters, so keeping it costs almost nothing.
 *
 * It is deliberately timid. It only touches the final pipeline stage of the
 * final statement, only when the rest of the pipeline looks like a test run,
 * and it never touches the permission decision. Anything it cannot parse with
 * certainty it leaves alone. A hook that breaks one real command has cost more
 * than it will ever save.
 *
 * This file is copied to ~/.red-handed/fix-pipes.mjs at install time and runs
 * standalone with no dependencies, because it fires on every Bash call.
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Splits a command at top-level occurrences of the given operators, respecting quotes. */
function splitTopLevel(command: string, operators: string[]): string[] | null {
  const parts: string[] = [];
  let current = "";
  let i = 0;
  let single = false;
  let double = false;
  let depth = 0; // $( … ) nesting
  while (i < command.length) {
    const ch = command[i] as string;
    const pair = command.slice(i, i + 2);
    if (!single && ch === "\\") {
      current += command.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (!double && ch === "'") single = !single;
    else if (!single && ch === '"') double = !double;
    if (!single && !double) {
      if (ch === "`") return null; // backticks: too old, too odd, leave alone
      if (pair === "$(") depth += 1;
      else if (ch === ")" && depth > 0) depth -= 1;
      if (depth === 0) {
        const op = operators.find(
          (o) => command.startsWith(o, i) && (o !== "|" || (pair !== "||" && command[i - 1] !== "|")),
        );
        if (op) {
          parts.push(current);
          current = "";
          i += op.length;
          continue;
        }
      }
    }
    current += ch;
    i += 1;
  }
  if (single || double || depth > 0) return null; // unbalanced: not ours to guess
  parts.push(current);
  return parts;
}

/** Whether this pipeline stage only cuts output down, so removing it loses nothing. */
function isTruncatingStage(stage: string): boolean {
  const trimmed = stage.trim();
  const word = trimmed.split(/\s+/)[0] ?? "";
  if (word === "tail" || word === "head") return !/\s-[a-zA-Z]*f/.test(trimmed);
  if (word === "grep" || word === "rg" || word === "egrep" || word === "fgrep") {
    // Count, quiet and file-list modes change what the caller gets back in kind,
    // not just in size. Removing those changes meaning, so they stay.
    return !/(?:^|\s)-{1,2}(?:[a-zA-Z]*[qclL][a-zA-Z]*|quiet|count|files-with-matches)\b/.test(
      trimmed,
    );
  }
  if (word === "sed") return /(?:^|\s)-n\b/.test(trimmed);
  if (word === "cut") return true;
  return false;
}

// `--test` sits outside the \b group: a word boundary never forms before a
// hyphen, so inside the group it could never match at all.
const TEST_INVOCATION =
  /\b(?:vitest|jest|mocha|pytest|py\.test|unittest|rspec|phpunit|tox|ctest|cargo\s+(?:nextest\s+run|test)|go\s+test|mix\s+test|rake\s+test|composer\s+test|gradlew?\s+test|mvnw?\s+(?:test|verify)|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|make\s+test|swift\s+test|dotnet\s+test|test:)|(?:^|\s)--test\b/;

/**
 * Returns the command with its trailing result-eating filters removed, or null
 * when there is nothing to fix or the command is not clearly a test run.
 */
export function fixCommand(command: string): string | null {
  if (typeof command !== "string" || command.length > 20_000) return null;
  if (command.includes("<<")) return null; // heredocs carry bodies this parser does not read

  const statements = splitTopLevel(command, ["&&", "||", ";", "\n"]);
  if (!statements || statements.length === 0) return null;
  const last = statements[statements.length - 1] as string;

  const stages = splitTopLevel(last, ["|"]);
  if (!stages || stages.length < 2) return null;

  let end = stages.length;
  while (end > 1 && isTruncatingStage(stages[end - 1] as string)) end -= 1;
  if (end === stages.length) return null; // nothing truncating at the end

  const kept = stages.slice(0, end);
  if (!TEST_INVOCATION.test(kept.join("|"))) return null;

  const fixedLast = kept.map((s) => s.trim()).join(" | ");
  const head = command.slice(0, command.length - last.length);
  const fixed = `${head}${head.endsWith(" ") || head === "" ? "" : " "}${fixedLast}`;
  return fixed === command ? null : fixed;
}

interface HookInput {
  tool_name?: string;
  tool_input?: { command?: string; [key: string]: unknown };
}

/** Reads the hook payload from stdin and answers with a fixed command, or with nothing. */
async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as HookInput;
  if (input.tool_name !== "Bash") return;
  const command = input.tool_input?.command;
  if (typeof command !== "string") return;
  const fixed = fixCommand(command);
  if (fixed === null) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        // Only the command changes. The permission decision is not touched:
        // whatever prompt the user would have seen, they still see, now with
        // the fixed command in it.
        updatedInput: { ...input.tool_input, command: fixed },
      },
    }),
  );
}

const runDirectly = (() => {
  try {
    return (
      process.argv[1] !== undefined &&
      realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
    );
  } catch {
    return false;
  }
})();

if (runDirectly) {
  // A hook that crashes must never take the session down with it.
  main().catch(() => {}).finally(() => process.exit(0));
}
