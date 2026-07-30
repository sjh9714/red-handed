import type { AgentAction, Claim, ClaimFamily } from "../types.js";
import { LOCALE_PACKS } from "./patterns.js";

export interface FoundClaim {
  family: ClaimFamily;
  /** The sentence the claim was made in, quoted verbatim as evidence. */
  text: string;
  strength: "specific" | "weak";
}

const MAX_QUOTE = 200;

/**
 * Removes text the agent did not assert: fenced code, quoted output, and
 * anything in quotation marks.
 *
 * The last one matters more than it looks. Agents write documentation and
 * explain patterns, and a sentence like `"모든 테스트 통과" = "all tests pass"`
 * reads as a claim to a matcher while being nothing of the sort. Single quotes
 * are left alone because they are apostrophes far more often than quotations.
 */
function stripNonAssertions(text: string): string {
  const withoutFences = text.replace(/```[\s\S]*?(?:```|$)/g, " ");
  const withoutQuotes = withoutFences
    .replace(/`[^`\n]*`/g, " ")
    .replace(/"[^"\n]*"/g, " ")
    .replace(/[“”][^“”\n]*[“”]/g, " ");
  return withoutQuotes
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n");
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|[\n;]+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

function quote(sentence: string): string {
  const collapsed = sentence.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_QUOTE ? `${collapsed.slice(0, MAX_QUOTE)}...` : collapsed;
}

/**
 * Finds claims in a block of prose.
 *
 * A claim only counts when the sentence asserts a present fact. Intentions
 * ("let me run the tests"), conditions ("if the tests pass") and denials
 * ("the tests do not pass") are all thrown away — the cost of a wrong call here
 * is accusing someone of lying, so the bar is deliberately high.
 */
export function findClaims(
  text: string,
  options: { skipRejects?: boolean } = {},
): FoundClaim[] {
  const found: FoundClaim[] = [];
  const cleaned = stripNonAssertions(text);

  for (const sentence of sentences(cleaned)) {
    for (const pack of LOCALE_PACKS) {
      if (!options.skipRejects && pack.reject.some((r) => r.test(sentence))) continue;
      const hedged = pack.hedge.some((h) => h.test(sentence));
      for (const { family, pattern } of pack.claims) {
        if (!pattern.test(sentence)) continue;
        found.push({
          family,
          text: quote(sentence),
          strength: hedged ? "weak" : "specific",
        });
        break;
      }
    }
  }

  return found;
}

const COMMIT_MESSAGE = /git\s+commit\b[^\n]*?-m\s+(['"])([\s\S]*?)\1/g;

/** Pulls every claim out of a timeline, tagged with when and where it was made. */
export function extractClaims(actions: AgentAction[]): Claim[] {
  const claims: Claim[] = [];

  for (const action of actions) {
    if (action.kind === "assistant-text") {
      for (const found of findClaims(action.text)) {
        claims.push({
          ...found,
          ts: action.ts,
          seq: action.seq,
          uuid: action.uuid,
          source: "assistant-text",
          agentId: action.agentId,
        });
      }
      continue;
    }

    if (action.kind === "todo-update") {
      for (const content of action.completed) {
        // Todos are written as instructions, so the intention filter would reject
        // them all. They are always weak, which keeps them out of CAUGHT findings.
        const found = findClaims(content, { skipRejects: true });
        if (found.length === 0) continue;
        claims.push({
          family: found[0]?.family ?? "test-pass",
          text: quote(content),
          strength: "weak",
          ts: action.ts,
          seq: action.seq,
          uuid: action.uuid,
          source: "todo",
          agentId: action.agentId,
        });
      }
      continue;
    }

    if (action.kind === "command") {
      for (const match of action.command.matchAll(COMMIT_MESSAGE)) {
        const message = match[2] ?? "";
        for (const found of findClaims(message)) {
          claims.push({
            ...found,
            ts: action.ts,
            seq: action.seq,
            uuid: action.uuid,
            source: "commit-message",
            agentId: action.agentId,
          });
        }
      }
    }
  }

  return claims;
}
