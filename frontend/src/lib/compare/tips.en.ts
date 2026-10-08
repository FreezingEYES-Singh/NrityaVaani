/**
 * English wording for /compare tips (05-mvp.md §3.6). Pure TS.
 * Tips never say "left" or "right": "Show me" points at the joint instead.
 */

export interface Wording {
  title: string;
  detail: string;
}

const pctOf = (r: number) => {
  if (r >= 0.6 && r < 0.75) return "about two thirds";
  if (r >= 0.4 && r < 0.6) return "about half";
  if (r < 0.4) return "less than half";
  return `about ${Math.round(r * 10) * 10}%`;
};
const deg = (d: number) => `${Math.round(Math.abs(d) / 5) * 5}°`;

export const WORDS = {
  kneeDepth: (d: number): Wording => ({
    title: "Bend your knees a little more",
    detail: `Your knees are about ${deg(d)} straighter than the teacher's. Sit a little lower into the position, keeping your knees out over your toes; don't force it.`,
  }),
  kneeSafe: (): Wording => ({
    title: "Bend your knees a little, keeping them over your toes",
    detail: "Your legs stay nearly straight while the teacher's are bent. Bend a little at a time, with your knees pointing the same way as your toes; don't force it.",
  }),
  rollIn: (): Wording => ({
    title: "Push your knees out over your toes before going lower",
    detail: "Your knees turn inward compared with where your feet point. Open them out over your toes first; only then sit lower.",
  }),
  elbowStraighter: (d: number): Wording => ({
    title: "Bend your elbow like the teacher",
    detail: `Your arm is about ${deg(d)} straighter at the elbow than the teacher's.`,
  }),
  elbowBent: (d: number): Wording => ({
    title: "Stretch your arm out more",
    detail: `Your elbow is about ${deg(d)} more bent than the teacher's.`,
  }),
  armLow: (d: number): Wording => ({
    title: "Raise your arm higher",
    detail: `Your upper arm is about ${deg(d)} lower than the teacher's.`,
  }),
  armHigh: (d: number): Wording => ({
    title: "Lower your arm a little",
    detail: `Your upper arm is about ${deg(d)} higher than the teacher's.`,
  }),
  kneeSpread: (): Wording => ({
    title: "Open your knees out more",
    detail: "Your knees are closer together than the teacher's. Turn them out over your toes.",
  }),
  feetNarrow: (): Wording => ({
    title: "Place your feet wider apart",
    detail: "Your feet are closer together than the teacher's.",
  }),
  feetWide: (): Wording => ({
    title: "Bring your feet a little closer",
    detail: "Your feet are further apart than the teacher's.",
  }),
  tilt: (d: number): Wording => ({
    title: "Keep your body upright",
    detail: `You lean about ${deg(d)} to one side; the teacher stays straighter.`,
  }),
  bobbing: (): Wording => ({
    title: "Stay at the same height",
    detail: "Your hips bounce up and down while the teacher's stay level.",
  }),
  rangeArm: (r: number): Wording => ({
    title: "Raise your arms higher",
    detail: `At the top of the movement your arms reach ${pctOf(r)} of the teacher's height. Move bigger.`,
  }),
  rangeElbow: (r: number): Wording => ({
    title: "Bend and stretch your arms fully",
    detail: `Your elbows move through ${pctOf(r)} of the teacher's range.`,
  }),
  rangeKnee: (r: number): Wording => ({
    title: "Go a little lower at the low point",
    detail: `Your knees bend through ${pctOf(r)} of the teacher's range. Go a little lower, keeping your knees over your toes; don't force it.`,
  }),
  partStill: (part: "arms" | "legs" | "torso"): Wording =>
    part === "legs"
      ? {
          title: "Your feet hardly moved",
          detail: "This step has footwork. Practise it with the stamps.",
        }
      : part === "arms"
        ? {
            title: "Your arms hardly moved",
            detail: "This step has arm movement. Practise it with the arm movements.",
          }
        : {
            title: "Your body hardly moved",
            detail: "This step moves the upper body. Practise it with the body movement.",
          },
  strength: (part: "arms" | "legs" | "torso"): string =>
    part === "arms"
      ? "Your arm positions match the teacher's closely."
      : part === "legs"
        ? "Your leg position matches the teacher's closely."
        : "Your body stays as upright as the teacher's.",
};

export function timingText(ratio: number): string {
  if (ratio > 2) return "More than 2× slower than the teacher. Practising slowly is fine; speed up when you're comfortable.";
  if (ratio < 0.5) return "More than 2× faster than the teacher. Slow down to the teacher's speed.";
  if (ratio > 1.25)
    return `About ${Math.round((ratio - 1) * 10) * 10}% slower than the teacher. Practising slowly is fine; speed up when you're comfortable.`;
  if (ratio < 0.8) return `About ${Math.round((1 - ratio) * 10) * 10}% faster than the teacher. Slow down a little.`;
  return "About the same speed as the teacher.";
}

export const MESSAGES = {
  notFoundMovement: "We couldn't find the teacher's step in your video.",
  notFoundPosture: "We couldn't find you in the teacher's posture.",
  tooShort: "Your video is too short, or the dancer wasn't found in it.",
  teacherEmpty: "The dancer wasn't found in the marked teacher step.",
  followTeacher: "If your teacher says otherwise, follow your teacher.",
  footworkNotChecked: "Footwork count and timing aren't checked yet.",
  partial: (cov: number) => `You practised about ${Math.round(cov * 10) * 10}% of the step. Tips cover that part.`,
  view: "Your camera angle differs from the teacher's by more than 30°, so arm height, spreads and side tilt weren't checked.",
  mostlyStill: "Much of the marked teacher part is still. If the teacher is talking there, mark a tighter range.",
  torsoPartly: "Partly checked: side tilt only (forward lean needs a side view).",
  lessonNone: "We couldn't find your dancing in the class video. Check that it's the same steps, filmed from the front, with your whole body in view.",
  lessonNoDance: "Your video seems to have no dancing in it: you're still, or not in view, most of the time.",
};
