// src/fix-hook.ts
import { realpathSync } from "fs";
import { fileURLToPath } from "url";
function splitTopLevel(command, operators) {
  const parts = [];
  let current = "";
  let i = 0;
  let single = false;
  let double = false;
  let depth = 0;
  while (i < command.length) {
    const ch = command[i];
    const pair = command.slice(i, i + 2);
    if (!single && ch === "\\") {
      current += command.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (!double && ch === "'") single = !single;
    else if (!single && ch === '"') double = !double;
    if (!single && !double) {
      if (ch === "`") return null;
      if (pair === "$(") depth += 1;
      else if (ch === ")" && depth > 0) depth -= 1;
      if (depth === 0) {
        const op = operators.find(
          (o) => command.startsWith(o, i) && (o !== "|" || pair !== "||" && command[i - 1] !== "|")
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
  if (single || double || depth > 0) return null;
  parts.push(current);
  return parts;
}
function isTruncatingStage(stage) {
  const trimmed = stage.trim();
  const word = trimmed.split(/\s+/)[0] ?? "";
  if (word === "tail" || word === "head") return !/\s-[a-zA-Z]*f/.test(trimmed);
  if (word === "grep" || word === "rg" || word === "egrep" || word === "fgrep") {
    return !/(?:^|\s)-{1,2}(?:[a-zA-Z]*[qclL][a-zA-Z]*|quiet|count|files-with-matches)\b/.test(
      trimmed
    );
  }
  if (word === "sed") return /(?:^|\s)-n\b/.test(trimmed);
  if (word === "cut") return true;
  return false;
}
var TEST_INVOCATION = /\b(?:vitest|jest|mocha|pytest|py\.test|unittest|rspec|phpunit|tox|ctest|cargo\s+(?:nextest\s+run|test)|go\s+test|mix\s+test|rake\s+test|composer\s+test|gradlew?\s+test|mvnw?\s+(?:test|verify)|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|make\s+test|swift\s+test|dotnet\s+test|test:)|(?:^|\s)--test\b/;
function fixCommand(command) {
  if (typeof command !== "string" || command.length > 2e4) return null;
  if (command.includes("<<")) return null;
  const statements = splitTopLevel(command, ["&&", "||", ";", "\n"]);
  if (!statements || statements.length === 0) return null;
  const last = statements[statements.length - 1];
  const stages = splitTopLevel(last, ["|"]);
  if (!stages || stages.length < 2) return null;
  let end = stages.length;
  while (end > 1 && isTruncatingStage(stages[end - 1])) end -= 1;
  if (end === stages.length) return null;
  const kept = stages.slice(0, end);
  if (!TEST_INVOCATION.test(kept.join("|"))) return null;
  const fixedLast = kept.map((s) => s.trim()).join(" | ");
  const head = command.slice(0, command.length - last.length);
  const fixed = `${head}${head.endsWith(" ") || head === "" ? "" : " "}${fixedLast}`;
  return fixed === command ? null : fixed;
}
async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
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
        updatedInput: { ...input.tool_input, command: fixed }
      }
    })
  );
}
var runDirectly = (() => {
  try {
    return process.argv[1] !== void 0 && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (runDirectly) {
  main().catch(() => {
  }).finally(() => process.exit(0));
}
export {
  fixCommand
};
