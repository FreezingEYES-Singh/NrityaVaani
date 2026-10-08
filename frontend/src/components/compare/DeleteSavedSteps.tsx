"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { deleteSavedSteps, forgetSessionStep } from "@/lib/compare/store";

/** "Delete saved steps" for /privacy: removes every teacher step Compare kept on this device. */
export default function DeleteSavedSteps() {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await deleteSavedSteps().catch(() => undefined);
        forgetSessionStep();
        setDone(true);
      }}
      className="mono inline-flex items-center gap-2 rounded-full border border-card-border px-4 py-2 text-[11px] uppercase tracking-[0.14em] text-foreground/75 hover:border-primary hover:text-primary"
    >
      <Trash2 size={14} /> {done ? "Saved steps deleted" : "Delete saved steps"}
    </button>
  );
}
