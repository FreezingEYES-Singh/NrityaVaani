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
  partly: "border-foreground/12 text-foreground/60",
  na: "border-foreground/12 text-foreground/45",
};
const PART_NAME: Record<Part | "timing" | "hands", string> = { arms: "Arms", legs: "Legs", torso: "Torso", hands: "Hands", timing: "Timing" };

interface Props {
  result: CompareResult;
  parts: PartSwitches;
  onParts: (p: PartSwitches) => void;
  onShowMe: (tip: Tip) => void;
  activeTip: string | null;
}

export default function Results({ result: r, parts, onParts, onShowMe, activeTip }: Props) {
  const toggle = (k: keyof PartSwitches) => onParts({ ...parts, [k]: !parts[k] });
  const label = "mono text-[10px] uppercase tracking-[0.18em] text-foreground/45";
  return (
    <section aria-live="polite" className="space-y-8">
      {r.message && (
        <p className="serif flex items-start gap-3 rounded-sm border border-primary/30 bg-primary/[0.05] px-4 py-3 text-lg text-foreground/85">
          <Info size={18} className="mt-1 shrink-0 text-primary" /> {r.message}
        </p>
      )}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-12">
        {r.found ? (
          <div className="space-y-4">
            <p className={label}>Corrections</p>
            {r.tips.length > 0 ? (
              <ol className="space-y-3">
                {r.tips.map((t, i) => (
                  <li
                    key={t.id}
                    className={`rounded-sm border px-4 py-4 transition-colors sm:px-5 ${
                      activeTip === t.id ? "border-primary bg-primary/[0.05]" : "border-foreground/12 bg-foreground/[0.02]"
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <span className="mono grid h-7 w-7 shrink-0 place-items-center rounded-full border border-primary/30 text-[11px] text-primary">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {t.title}
                          <span className="mono ml-2 rounded-full border border-foreground/15 px-1.5 py-0.5 align-middle text-[9px] uppercase tracking-[0.12em] text-foreground/45">
                            beta
                          </span>
                        </p>
                        <p className="serif mt-1 text-[0.98rem] leading-relaxed text-foreground/65">{t.detail}</p>
                        <button
                          type="button"
                          onClick={() => onShowMe(t)}
                          className="mono mt-3 inline-flex items-center gap-1.5 rounded-full border border-foreground/15 px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-foreground/75 transition-colors hover:border-primary/60 hover:text-primary"
                        >
                          <Eye size={12} /> Show me
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="serif flex items-start gap-3 rounded-sm border border-emerald-500/30 bg-emerald-500/[0.05] px-4 py-3 text-foreground/80">
                <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-500" />
                No corrections: what could be checked matched the teacher.
              </p>
            )}

            {r.strength && (
              <p className="flex items-start gap-3 px-1 pt-1 text-foreground/80">
                <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-500" />
                <span className="serif">{r.strength.text}</span>
              </p>
            )}
          </div>
        ) : (
          <div />
        )}

        <div className="space-y-6">
          {r.found && (
            <div className="space-y-3">
              <p className={label}>Assessment</p>
              <div className="grid grid-cols-2 gap-2">
                {(["arms", "legs", "torso", "hands", "timing"] as const).map((k) => {
                  const b = r.bands[k];
                  if (!b) return null;
                  return (
                    <div key={k} className={`rounded-sm border bg-foreground/[0.02] px-3 py-2.5 ${BAND_STYLE[b.level]}`}>
                      <p className="mono text-[9px] uppercase tracking-[0.16em] text-foreground/50">{PART_NAME[k]}</p>
                      <p className="mt-0.5 text-sm font-medium">{BAND_TEXT[b.level]}</p>
                      {b.note && <p className="mt-0.5 text-[11px] leading-snug text-foreground/55">{b.note}</p>}
                    </div>
                  );
                })}
              </div>
              {r.timing.text && (
                <p className="serif text-[0.98rem] leading-relaxed text-foreground/75">
                  <span className="mono mr-2 text-[10px] uppercase tracking-[0.16em] text-foreground/45">Timing</span>
                  {r.timing.text}
                </p>
              )}
            </div>
          )}

          {(r.notChecked.length > 0 || r.warnings.length > 0) && (
            <ul className="space-y-2 text-[0.9rem] leading-snug text-foreground/65">
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

          <fieldset className="space-y-2.5 rounded-sm border border-foreground/12 p-4">
            <legend className="mono px-1 text-[10px] uppercase tracking-[0.16em] text-foreground/45">Body parts to judge</legend>
            <p className="text-[0.82rem] leading-snug text-foreground/50">Switch off what the teacher only does in passing.</p>
            <div className="flex flex-wrap gap-2">
              {(["arms", "hands", "legs", "torso", "head"] as const).map((k) => (
                <label
                  key={k}
                  className={`mono inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] transition-colors ${
                    parts[k] ? "border-primary/50 text-foreground" : "border-foreground/15 text-foreground/45"
                  }`}
                >
                  <input type="checkbox" checked={parts[k]} onChange={() => toggle(k)} className="accent-[var(--primary)]" />
                  {k}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </div>

      <p className="serif text-sm text-foreground/50">
        {MESSAGES.followTeacher} Tips are a first version (beta): their limits are first guesses.
      </p>
    </section>
  );
}
