/**
 * Class mode (analyzeLesson) on a synthetic class: talking, a slow demonstration,
 * repeats, a step only some students dance, and arm gestures while talking.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeLesson } from "./analyze.ts";
import { A, EXTRA, P, render, squats, stand, step, walk, wave, type Fr } from "./testing/synth.ts";

// A slow 5-14.1 | P x2 18.1-30.2 | A 34.2-40.3 | squats 43.3-49.3 | EXTRA 52.3-61.3 | wave 65.3-70.3
const CLASS: Fr[] = [
  ...stand(5), ...step(A, { k: 1.5 }), ...stand(4), ...step(P, { reps: 2 }), ...stand(4), ...step(A), ...stand(3),
  ...squats(6), ...stand(3), ...step(EXTRA), ...stand(4), ...wave(5), ...stand(3),
];
const teacher = render(CLASS, { seed: 5 });
const A_DEMOS: [number, number][] = [[5, 14.1], [34.2, 40.3]];
const overlaps = ([a, b]: [number, number], [c, d]: [number, number]) => Math.min(b, d) - Math.max(a, c) > 1;

test("A, P, EXTRA: each step found in the class, A in an A demonstration, EXTRA in its own", () => {
  const L = analyzeLesson(teacher, render([...stand(2), ...step(A, { k: 1.1 }), ...step(P), ...step(EXTRA), ...stand(2)], { seed: 9 }));
  assert.ok(L.steps.length >= 2, "steps");
  assert.ok(A_DEMOS.some((d) => overlaps(L.steps[0].teacher, d)), `first step in an A demo: ${L.steps[0].teacher}`);
  assert.ok(overlaps(L.steps[L.steps.length - 1].teacher, [52.3, 61.3]), "last step in the EXTRA demo");
  assert.ok(L.steps.every((s) => s.result.found));
  assert.deepEqual(L.missed, []);
  assert.deepEqual(L.unmatched, []);
});

test("a student who skips A is told both A demonstrations weren't found in their video", () => {
  const L = analyzeLesson(teacher, render([...stand(2), ...step(P), ...step(EXTRA), ...stand(2)], { seed: 9 }));
  for (const d of A_DEMOS) assert.ok(L.missed.some((m) => overlaps(m, d)), `missed ${d}`);
  // gestures while talking (wave) are never "missed"
  assert.ok(!L.missed.some((m) => overlaps(m, [65.3, 70.3])));
});

test("the class compared with itself follows the same timeline, with nothing missed", () => {
  const L = analyzeLesson(teacher, render(CLASS, { seed: 9 }));
  assert.ok(L.steps.length >= 5);
  for (const s of L.steps.filter((x) => x.result.reading === "full"))
    assert.ok(Math.abs((s.student[0] + s.student[1]) / 2 - (s.teacher[0] + s.teacher[1]) / 2) <= 3, `diagonal: ${s.student} / ${s.teacher}`);
  assert.deepEqual(L.missed, []);
  assert.deepEqual(L.unmatched, []);
});

test("walking around isn't a step and isn't reported as dancing", () => {
  const L = analyzeLesson(teacher, render([...stand(2), ...step(A), ...walk(6), ...stand(2)], { seed: 9 }));
  assert.equal(L.steps.length, 1);
  assert.ok(A_DEMOS.some((d) => overlaps(L.steps[0].teacher, d)));
  assert.deepEqual(L.unmatched, []);
});

test("a video with no dancing says so", () => {
  const L = analyzeLesson(teacher, render(stand(8), { seed: 9 }));
  assert.equal(L.steps.length, 0);
  assert.ok(L.message);
});
