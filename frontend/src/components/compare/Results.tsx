"use client";

import { Eye, CheckCircle2, AlertTriangle, Info } from "lucide-react";
import type { BandLevel, CompareResult, Part, PartSwitches, Tip } from "@/lib/compare/types";
import { MESSAGES } from "@/lib/compare/tips.en";

/**
 * The result (05-mvp.md §1 step 3, §3.6): up to three corrections and one
 * thing done well, a separate Timing line, a band per body part with what
 * wasn't checked, and "Show me" for each tip. No percentage score: the bands
 * say as much as the measurement can honestly support.
 */

const BAND_TEXT: Record<BandLevel, string> = {
  close: "Close match",
  getting: "Getting there",
  needs: "Needs work",
  partly: "Partly checked",
  na: "Not checked",
};
const BAND_STYLE: Record<BandLevel, string> = {
  close: "border-emerald-500/50 text-emerald-600 dark:text-emerald-400",
  getting: "border-amber-500/50 text-amber-600 dark:text-amber-400",
  needs: "border-primary/60 text-primary",
  partly: "border-card-border text-foreground/60",
  na: "border-card-border text-foreground/45",
};
const PART_NAME: Record<Part | "timing", string> = { arms: "Arms", legs: "Legs", torso: "Torso", timing: "Timing" };

interface Props {
  result: CompareResult;
  parts: PartSwitches;
  onParts: (p: PartSwitches) => void;
  onShowMe: (tip: Tip) => void;
  activeTip: string | null;
}

export default function Results({ result: r, parts, onParts, onShowMe, activeTip }: Props) {
  const toggle = (k: keyof PartSwitches) => onParts({ ...parts, [k]: !parts[k] });
  return (
    <section aria-live="polite" className="space-y-6">
      {r.message && (
        <p className="serif flex items-start gap-2 text-lg text-foreground/85">
          <Info size={18} className="mt-1 shrink-0 text-primary" /> {r.message}
        </p>
      )}

      {r.found && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(["arms", "legs", "torso", "timing"] as const).map((k) => {
              const b = r.bands[k];
              return (
                <div key={k} className={`rounded-xl border px-3 py-2 ${BAND_STYLE[b.level]}`}>
                  <p className="mono text-[10px] uppercase tracking-[0.16em] text-foreground/55">{PART_NAME[k]}</p>
                  <p className="text-sm font-medium">{BAND_TEXT[b.level]}</p>
                  {b.note && <p className="mt-0.5 text-[11px] leading-snug text-foreground/55">{b.note}</p>}
                </div>
              );
            })}
          </div>

          {r.timing.text && (
            <p className="serif text-foreground/80">
              <span className="mono mr-2 text-[10px] uppercase tracking-[0.16em] text-foreground/45">Timing</span>
              {r.timing.text}
            </p>
          )}

          {r.tips.length > 0 ? (
            <ol className="space-y-3">
              {r.tips.map((t, i) => (
                <li key={t.id} className={`rounded-2xl border bg-card px-4 py-3 ${activeTip === t.id ? "border-primary" : "border-card-border"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">
                        <span className="mono mr-2 text-[10px] text-foreground/45">{i + 1}</span>
                        {t.title}
                        <span className="mono ml-2 rounded-full border border-card-border px-1.5 py-0.5 align-middle text-[9px] uppercase tracking-[0.12em] text-foreground/45">
                          beta
                        </span>
                      </p>
                      <p className="serif mt-1 text-[0.98rem] leading-relaxed text-foreground/70">{t.detail}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onShowMe(t)}
                      className="mono inline-flex shrink-0 items-center gap-1.5 rounded-full border border-card-border px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] hover:border-primary hover:text-primary"
                    >
                      <Eye size={12} /> Show me
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="serif text-foreground/75">No corrections: what could be checked matched the teacher.</p>
          )}

          {r.strength && (
            <p className="flex items-start gap-2 text-foreground/80">
              <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-500" />
              <span className="serif">{r.strength.text}</span>
            </p>
          )}
        </>
      )}

      {(r.notChecked.length > 0 || r.warnings.length > 0) && (
        <ul className="space-y-1.5 text-[0.92rem] text-foreground/65">
          {r.warnings.map((w) => (
            <li key={w} className="flex items-start gap-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" /> {w}
            </li>
          ))}
          {r.notChecked.map((w) => (
            <li key={w} className="flex items-start gap-2">
              <Info size={15} className="mt-0.5 shrink-0 text-foreground/40" /> {w}
            </li>
          ))}
        </ul>
      )}

      {r.pauses.length > 0 && (
        <p className="mono text-[10px] uppercase tracking-[0.14em] text-foreground/45">
          {r.pauses.length} pause{r.pauses.length > 1 ? "s" : ""} not judged
        </p>
      )}

      <fieldset className="space-y-2">
        <legend className="mono text-[10px] uppercase tracking-[0.16em] text-foreground/45">
          Judge these body parts (switch off what the teacher only does incidentally)
        </legend>
        <div className="flex flex-wrap gap-2">
          {(["arms", "legs", "torso", "head"] as const).map((k) => (
            <label key={k} className="mono inline-flex cursor-pointer items-center gap-2 rounded-full border border-card-border px-3 py-1.5 text-[10px] uppercase tracking-[0.14em]">
              <input type="checkbox" checked={parts[k]} onChange={() => toggle(k)} className="accent-[var(--primary)]" />
              {k}
            </label>
          ))}
        </div>
      </fieldset>

      <p className="serif text-sm text-foreground/55">
        {MESSAGES.followTeacher} Tips are a first version (beta): their limits are first guesses.
      </p>
    </section>
  );
}
