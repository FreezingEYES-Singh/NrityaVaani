/**
 * The /compare synthetic suite (05-mvp.md §6 step 1):
 *   npm run test:compare
 * Each case renders a synthetic teacher step and student take, runs analyze(), and checks the outcome.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CASES, KNOWN_LIMITS, check } from "./testing/cases.ts";
import { analyze, teacherStepKind } from "./analyze.ts";
import { A, P, W, HOLD, render, step } from "./testing/synth.ts";

for (const c of CASES) {
  test(c.name, () => {
    const o = check(c);
    if (KNOWN_LIMITS.has(c.name)) return; // written down in 05-mvp.md §6; checked by the table runner
    assert.ok(o.ok, o.bad.join("; "));
  });
}

test("step kinds of the three synthetic steps and a hold", () => {
  assert.equal(teacherStepKind(render(step(A))).kind, "movement");
  assert.equal(teacherStepKind(render(step(W))).kind, "movement");
  assert.equal(teacherStepKind(render(step(P))).kind, "posture");
  assert.equal(teacherStepKind(render(step(HOLD))).kind, "hold");
});

test("an empty student take is reported, not thrown", () => {
  const t = render(step(A));
  const s = { ...render(step(A)), frames: [] };
  const r = analyze(t, s);
  assert.equal(r.found, false);
  assert.ok(r.message);
});

test("tips are at most 3, one per part, and every tip is beta", () => {
  for (const c of CASES.slice(0, 20)) {
    const r = check(c).result;
    assert.ok(r.tips.length <= 3);
    assert.equal(new Set(r.tips.map((t) => t.part)).size, r.tips.length);
    for (const t of r.tips) assert.equal(t.beta, true);
  }
});
