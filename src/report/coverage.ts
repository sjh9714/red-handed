import pc from "picocolors";
import type { ClaimCoverage } from "../commands/stats.js";
import { resolveLocale } from "./messages.js";

/**
 * What the agent claimed, and what stood behind each claim.
 *
 * Most sessions contain nothing worth reporting, and a tool that prints nothing
 * teaches you nothing about your own history. This is the part everybody gets:
 * a count of the sentences your agent wrote, and how many of them anything
 * actually checked.
 */
export function renderCoverage(
  coverage: ClaimCoverage,
  sessionsScanned: number,
  lang: string | undefined,
  color: boolean,
): string {
  if (coverage.claims === 0) return "";
  const locale = resolveLocale(lang);
  const dim = (text: string): string => (color ? pc.dim(text) : text);
  const bold = (text: string): string => (color ? pc.bold(text) : text);
  const warn = (text: string): string => (color ? pc.yellow(text) : text);

  const korean = locale.id === "ko";
  const lines: string[] = [""];

  lines.push(
    korean
      ? `  세션 ${sessionsScanned}개. 에이전트가 "테스트 통과"라고 ${bold(String(coverage.claims))}번 말했습니다.`
      : `  ${sessionsScanned} sessions. Your agent said "tests pass" ${bold(String(coverage.claims))} times.`,
  );

  const rows: Array<[number, string, boolean]> = [
    [
      coverage.verifiedByARun,
      korean ? "먼저 테스트가 돌았음" : "a test ran first",
      false,
    ],
    [
      coverage.noRunInSession,
      korean ? "그 세션에서 테스트가 아예 안 돌았음" : "no test ran in that session at all",
      true,
    ],
    [
      coverage.lastRunHadFailed,
      korean ? "직전 실행은 실패였음" : "the run before it had failed",
      true,
    ],
  ];

  const width = Math.max(...rows.map(([n]) => String(n).length));
  for (const [count, label, notable] of rows) {
    if (count === 0) continue;
    const number = String(count).padStart(width + 2);
    lines.push(`  ${notable ? warn(number) : number}  ${notable ? label : dim(label)}`);
  }

  lines.push("");
  return lines.join("\n");
}
