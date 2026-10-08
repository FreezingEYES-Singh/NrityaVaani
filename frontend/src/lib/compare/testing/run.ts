/**
 * Prints the synthetic suite as a table:
 *   node --experimental-strip-types src/lib/compare/testing/run.ts [filter]
 */
import { CASES, check } from "./cases.ts";

const filter = process.argv[2] ?? "";
let pass = 0;
let fail = 0;
const fails: string[] = [];
for (const c of CASES) {
  if (filter && !c.name.includes(filter)) continue;
  const o = check(c);
  const r = o.result;
  const tips = r.tips.map((t) => t.id).join(",");
  const line = [
    (o.ok ? "ok   " : "FAIL ") + c.name.padEnd(44),
    r.kind.padEnd(8),
    `${r.found ? "FOUND" : "no"}/${r.reading}`,
    `tries ${r.tries.length}`,
    r.mirrored ? "mirrored" : "",
    r.coverage < 1 && r.found ? `cov ${r.coverage.toFixed(2)}` : "",
    `tips[${tips}]`,
    r.strength ? `str[${r.strength.part}]` : "",
    r.timing.text ? `timing: ${r.timing.text.split(".")[0]}` : "",
    `${o.ms.toFixed(0)}ms`,
    o.ok ? "" : "  !! " + o.bad.join("; "),
  ].filter(Boolean);
  console.log(line.join(" | "));
  if (o.ok) pass++;
  else {
    fail++;
    fails.push(`${c.name}: ${o.bad.join("; ")}`);
  }
}
console.log(`\nPASS ${pass} FAIL ${fail}`);
for (const f of fails) console.log("  - " + f);
