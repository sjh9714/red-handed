import { describe, expect, test } from "vitest";
import { parseTestOutput } from "../../src/session/testruns.js";

/**
 * Issue #1: runners the tool recognised but could not read. Each parser gets a
 * fires pair (real output, real verdict) and a holds-fire pair, because the
 * rule is miss things rather than accuse wrongly. A parser that cannot tell
 * pass from fail must say nothing, not guess.
 */

describe("go test", () => {
  test("reads a passing run", () => {
    const out = "ok  \tgithub.com/acme/store\t0.184s\n";
    const parsed = parseTestOutput(out, "gotest");
    expect(parsed.status).toBe("passed");
    expect(parsed.summaryLine).toContain("ok");
  });

  test("reads a verbose passing run with counts", () => {
    const out = [
      "=== RUN   TestAdd",
      "--- PASS: TestAdd (0.00s)",
      "=== RUN   TestSub",
      "--- PASS: TestSub (0.00s)",
      "PASS",
      "ok  \tgithub.com/acme/math\t0.012s",
    ].join("\n");
    const parsed = parseTestOutput(out, "gotest");
    expect(parsed.status).toBe("passed");
    expect(parsed.passed).toBe(2);
  });

  test("reads a failing run", () => {
    const out = [
      "--- FAIL: TestCheckout (0.00s)",
      "    checkout_test.go:31: got 4, want 5",
      "FAIL",
      "FAIL\tgithub.com/acme/store\t0.021s",
    ].join("\n");
    const parsed = parseTestOutput(out, "gotest");
    expect(parsed.status).toBe("failed");
    expect(parsed.failed).toBe(1);
  });

  test("a bare FAIL with no other go marker stays unread", () => {
    // Some other tool shouting FAIL is not a go test run.
    const parsed = parseTestOutput("FAIL\nsomething exploded\n", "gotest");
    expect(parsed.status).toBe("unknown");
  });

  test("only no-test-files lines stay unread", () => {
    const parsed = parseTestOutput("?   \tgithub.com/acme/tools\t[no test files]\n", "gotest");
    expect(parsed.status).toBe("unknown");
  });
});

describe("cargo test", () => {
  test("reads and sums multiple targets", () => {
    const out = [
      "test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.32s",
      "",
      "test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s",
    ].join("\n");
    const parsed = parseTestOutput(out, "cargo");
    expect(parsed.status).toBe("passed");
    expect(parsed.passed).toBe(9);
  });

  test("one failing target fails the run", () => {
    const out = [
      "test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.32s",
      "test result: FAILED. 2 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s",
    ].join("\n");
    const parsed = parseTestOutput(out, "cargo");
    expect(parsed.status).toBe("failed");
    expect(parsed.failed).toBe(1);
    expect(parsed.summaryLine).toContain("FAILED");
  });

  test("compiler output without a result line stays unread", () => {
    const parsed = parseTestOutput("   Compiling acme v0.1.0\nerror[E0308]: mismatched types\n", "cargo");
    expect(parsed.status).toBe("unknown");
  });
});

describe("rspec and minitest", () => {
  test("reads a passing rspec run", () => {
    const parsed = parseTestOutput("Finished in 0.61 seconds\n72 examples, 0 failures\n", "rspec");
    expect(parsed.status).toBe("passed");
    expect(parsed.passed).toBe(72);
  });

  test("reads a failing rspec run with pending", () => {
    const parsed = parseTestOutput("48 examples, 2 failures, 3 pending\n", "rspec");
    expect(parsed.status).toBe("failed");
    expect(parsed.failed).toBe(2);
    expect(parsed.skipped).toBe(3);
  });

  test("reads a minitest summary", () => {
    const parsed = parseTestOutput("12 runs, 30 assertions, 1 failures, 0 errors, 2 skips\n", "rspec");
    expect(parsed.status).toBe("failed");
    expect(parsed.failed).toBe(1);
  });

  test("zero examples stays unknown, not passed", () => {
    // An empty selection proves nothing about the code.
    const parsed = parseTestOutput("0 examples, 0 failures\n", "rspec");
    expect(parsed.status).toBe("unknown");
  });
});

describe("phpunit", () => {
  test("reads the OK line", () => {
    const parsed = parseTestOutput("OK (14 tests, 31 assertions)\n", "phpunit");
    expect(parsed.status).toBe("passed");
    expect(parsed.passed).toBe(14);
  });

  test("reads the failure summary", () => {
    const out = "FAILURES!\nTests: 14, Assertions: 31, Failures: 2.\n";
    const parsed = parseTestOutput(out, "phpunit");
    expect(parsed.status).toBe("failed");
    expect(parsed.failed).toBe(2);
  });

  test("skipped-but-ok counts as passed", () => {
    const out = "OK, but incomplete, skipped, or risky tests!\nTests: 9, Assertions: 20, Skipped: 1.\n";
    const parsed = parseTestOutput(out, "phpunit");
    expect(parsed.status).toBe("passed");
    expect(parsed.skipped).toBe(1);
  });
});

describe("python unittest", () => {
  test("reads a passing run", () => {
    const parsed = parseTestOutput("Ran 12 tests in 0.034s\n\nOK\n", "unittest");
    expect(parsed.status).toBe("passed");
    expect(parsed.passed).toBe(12);
  });

  test("reads a failing run with counts", () => {
    const parsed = parseTestOutput("Ran 12 tests in 0.034s\n\nFAILED (failures=1, errors=2)\n", "unittest");
    expect(parsed.status).toBe("failed");
    expect(parsed.failed).toBe(3);
  });

  test("an OK with no Ran line stays unread", () => {
    // "OK" alone appears in far too many outputs to be evidence.
    const parsed = parseTestOutput("OK\n", "unittest");
    expect(parsed.status).toBe("unknown");
  });
});

describe("node --test (tap)", () => {
  test("reads a passing run", () => {
    const out = ["# tests 2", "# suites 0", "# pass 2", "# fail 0", "# duration_ms 54.5"].join("\n");
    const parsed = parseTestOutput(out, "tap");
    expect(parsed.status).toBe("passed");
    expect(parsed.passed).toBe(2);
  });

  test("reads a failing run", () => {
    const out = ["# tests 3", "# pass 2", "# fail 1"].join("\n");
    const parsed = parseTestOutput(out, "tap");
    expect(parsed.status).toBe("failed");
  });

  test("a lone hash comment stays unread", () => {
    const parsed = parseTestOutput("# tests 3\nsome unrelated text\n", "tap");
    expect(parsed.status).toBe("unknown");
  });
});

describe("the fallback order", () => {
  test("a generic command with pytest output still gets read", () => {
    const out = "===== 3 passed in 0.21s =====\n";
    const parsed = parseTestOutput(out, "generic");
    expect(parsed.status).toBe("passed");
  });

  test("a generic command with go output still gets read", () => {
    const out = "ok  \tgithub.com/acme/store\t0.184s\n";
    const parsed = parseTestOutput(out, "generic");
    expect(parsed.status).toBe("passed");
  });

  test("a generic command with unittest output still gets read", () => {
    const parsed = parseTestOutput("Ran 5 tests in 0.002s\n\nOK\n", "generic");
    expect(parsed.status).toBe("passed");
  });
});
