/** Prints analyze() internals for cases matching a filter (test-only). */
import { CASES, check } from "./cases.ts";
import { debug } from "../analyze.ts";
import { setDebugBob } from "../feedback.ts";
setDebugBob((v) => console.log("  bob:", JSON.stringify(v)));
const filter = process.argv[2] ?? "";
for (const c of CASES) {
  if (!c.name.includes(filter)) continue;
  console.log(`\n=== ${c.name}`);
  debug.log = (k, v) => console.log(`  ${k}:`, JSON.stringify(v));
  const o = check(c);
  console.log(`  -> ${o.ok ? "ok" : "FAIL " + o.bad.join("; ")}`, o.result.tips.map((t) => `${t.id}(${t.severity.toFixed(2)})`).join(" "));
}
