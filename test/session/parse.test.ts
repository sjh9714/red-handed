import { describe, expect, test } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJsonlLines } from "../../src/session/parse.js";

function tmpFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "rh-parse-"));
  const p = join(dir, "session.jsonl");
  writeFileSync(p, content);
  return p;
}

async function collect(path: string): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  for await (const line of readJsonlLines(path)) out.push(line);
  return out;
}

describe("readJsonlLines", () => {
  test("yields one parsed object per line", async () => {
    const p = tmpFile('{"type":"assistant"}\n{"type":"user"}\n');
    const out = await collect(p);
    expect(out.map((l) => l.type)).toEqual(["assistant", "user"]);
  });

  test("skips malformed lines instead of throwing", async () => {
    const p = tmpFile('{"type":"assistant"}\nnot json at all\n{"type":"user"}\n');
    const out = await collect(p);
    expect(out.map((l) => l.type)).toEqual(["assistant", "user"]);
  });

  test("ignores blank lines and a missing trailing newline", async () => {
    const p = tmpFile('{"type":"a"}\n\n   \n{"type":"b"}');
    const out = await collect(p);
    expect(out.map((l) => l.type)).toEqual(["a", "b"]);
  });

  test("skips lines that parse to a non-object", async () => {
    const p = tmpFile('{"type":"a"}\n42\n"a string"\nnull\n{"type":"b"}\n');
    const out = await collect(p);
    expect(out.map((l) => l.type)).toEqual(["a", "b"]);
  });

  test("returns nothing for a file that does not exist", async () => {
    const out = await collect(join(tmpdir(), "rh-does-not-exist-9182.jsonl"));
    expect(out).toEqual([]);
  });
});
