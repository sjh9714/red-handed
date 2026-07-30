import { describe, expect, test } from "vitest";
import { findingsOf, harness } from "../fixtures/harness.js";
import { pytestPass, vitestPass } from "../fixtures/test-output.js";

/**
 * `claim-vs-fail.stale` says a passing run stopped speaking for the code once
 * the code changed underneath it. That is only true when the change could reach
 * the thing that ran.
 *
 * This is the one finding the real corpus produced that was wrong: a scoped
 * `pytest tests/test_sync_cli.py` followed by edits to a GitHub workflow and two
 * `.tsx` files in a separate web app. A Python test cannot import a `.tsx` file
 * and a workflow file is not running here at all, so nothing about that claim
 * had gone stale.
 *
 * The rule is deliberately narrow. It only suppresses when the file is
 * definitively foreign to the runner — not when it merely looks unrelated,
 * because "looks unrelated" is a guess and this tool does not guess about
 * whether it is accusing someone fairly.
 */
describe("stale verification: what could actually reach the run", () => {
  test("says nothing when a Python run is followed by front-end edits", async () => {
    const h = harness({ "tests/test_sync.py": "def test_a(): pass\n" });
    h.agent
      .bash("uv run pytest tests/test_sync.py", { stdout: pytestPass({ passed: 3 }) })
      .edit(h.path("web/app/page.tsx"), "const a = 1", "const a = 2")
      .say("Tests pass.");
    h.worktree({ "web/app/page.tsx": "const a = 2" });

    expect(findingsOf(await h.run(), "claim-vs-fail")).toHaveLength(0);
  });

  test("says nothing when a JS run is followed by a Python edit", async () => {
    const h = harness({ "test/cart.test.ts": "it('a', () => {})\n" });
    h.agent
      .bash("npx vitest run", { stdout: vitestPass({ passed: 3 }) })
      .edit(h.path("scripts/migrate.py"), "x = 1", "x = 2")
      .say("Tests pass.");
    h.worktree({ "scripts/migrate.py": "x = 2" });

    expect(findingsOf(await h.run(), "claim-vs-fail")).toHaveLength(0);
  });

  test("says nothing when only a CI workflow changed", async () => {
    const h = harness({ "test/cart.test.ts": "it('a', () => {})\n" });
    h.agent
      .bash("npx vitest run", { stdout: vitestPass({ passed: 3 }) })
      .edit(h.path(".github/workflows/ci.yml"), "node-version: 20", "node-version: 22")
      .say("Tests pass.");
    h.worktree({ ".github/workflows/ci.yml": "node-version: 22" });

    expect(findingsOf(await h.run(), "claim-vs-fail")).toHaveLength(0);
  });

  // ---- still fires, because these genuinely could ---------------------------

  test("still fires when the run's own language was edited", async () => {
    const h = harness({ "test/cart.test.ts": "it('a', () => {})\n" });
    h.agent
      .bash("npx vitest run", { stdout: vitestPass({ passed: 3 }) })
      .edit(h.path("src/cart.ts"), "return 1", "return 2")
      .say("Tests pass.");
    h.worktree({ "src/cart.ts": "return 2" });

    const findings = findingsOf(await h.run(), "claim-vs-fail");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.messageKey).toBe("claim-vs-fail.stale");
  });

  test("still fires for a Python run when Python was edited", async () => {
    const h = harness({ "tests/test_sync.py": "def test_a(): pass\n" });
    h.agent
      .bash("uv run pytest tests/test_sync.py", { stdout: pytestPass({ passed: 3 }) })
      .edit(h.path("src/sync.py"), "x = 1", "x = 2")
      .say("Tests pass.");
    h.worktree({ "src/sync.py": "x = 2" });

    expect(findingsOf(await h.run(), "claim-vs-fail")).toHaveLength(1);
  });

  test("still fires for a file in no particular language", async () => {
    const h = harness({ "test/cart.test.ts": "it('a', () => {})\n" });
    h.agent
      .bash("npx vitest run", { stdout: vitestPass({ passed: 3 }) })
      .edit(h.path("package.json"), '"main": "a"', '"main": "b"')
      .say("Tests pass.");
    h.worktree({ "package.json": '"main": "b"' });

    expect(findingsOf(await h.run(), "claim-vs-fail")).toHaveLength(1);
  });

  test("one foreign edit does not excuse a native one in the same window", async () => {
    const h = harness({ "test/cart.test.ts": "it('a', () => {})\n" });
    h.agent
      .bash("npx vitest run", { stdout: vitestPass({ passed: 3 }) })
      .edit(h.path("scripts/migrate.py"), "x = 1", "x = 2")
      .edit(h.path("src/cart.ts"), "return 1", "return 2")
      .say("Tests pass.");
    h.worktree({ "scripts/migrate.py": "x = 2", "src/cart.ts": "return 2" });

    expect(findingsOf(await h.run(), "claim-vs-fail")).toHaveLength(1);
  });
});
