import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { maskPii } from "@/lib/log";

/** PII-free logs (SPEC §13.1): masking, and no direct console output elsewhere. */
describe("logs", () => {
  it("masks emails and phone numbers", () => {
    expect(maskPii("lead jane.doe+x@example.com failed for (425) 555-0100 and +14255550199")).toBe(
      "lead [email] failed for [phone] and [phone]",
    );
    expect(maskPii("job BB-2026-0001 stage 4")).toBe("job BB-2026-0001 stage 4");
  });

  it("app code logs only through lib/log (masked), never console directly", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name !== "node_modules" && !name.startsWith(".")) walk(p);
        } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          const src = readFileSync(p, "utf8");
          src.split("\n").forEach((line, i) => {
            if (
              /console\.(log|info|warn|error|debug)\(/.test(line) &&
              !p.endsWith(join("lib", "log.ts"))
            ) {
              // Codes only (no record data) are allowed with an explicit marker.
              if (!line.includes("error.code")) offenders.push(`${p}:${i + 1}`);
            }
          });
        }
      }
    };
    for (const d of ["app", "lib", "components"]) walk(join(process.cwd(), d));
    expect(offenders).toEqual([]);
  });
});
