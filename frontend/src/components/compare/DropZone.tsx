"use client";

import { useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";

/**
 * A video picker you can also drop a file on. The <input> stays a real file
 * input (inside the label), so tests and screen readers use it as before.
 */
interface Props {
  title: string;
  hint: ReactNode;
  icon: ReactNode;
  onFile: (f: File) => void;
  onReject?: () => void;
  disabled?: boolean;
  testId?: string;
  /** "user" opens the front camera on phones instead of the file picker. */
  capture?: "user";
  className?: string;
}

const isVideo = (f: File) => f.type === "" || f.type.startsWith("video/");

export default function DropZone({ title, hint, icon, onFile, onReject, disabled, testId, capture, className = "" }: Props) {
  const [over, setOver] = useState(false);

  const take = (f: File | undefined) => {
    if (!f) return;
    if (isVideo(f)) onFile(f);
    else onReject?.();
  };
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    take(f);
  };
  const onDragOver = (e: DragEvent<HTMLLabelElement>) => {
    if (disabled) return;
    e.preventDefault();
    setOver(true);
  };
  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setOver(false);
    if (!disabled) take(e.dataTransfer.files?.[0]);
  };

  const tone = disabled
    ? "cursor-not-allowed border-foreground/10 opacity-50"
    : over
      ? "cursor-pointer border-primary bg-primary/[0.06]"
      : "cursor-pointer border-foreground/20 hover:border-primary/50 hover:bg-foreground/[0.02]";

  return (
    <label
      className={`group grid place-items-center rounded-sm border border-dashed px-6 py-10 text-center transition-colors focus-within:border-primary ${tone} ${className}`}
      onDragOver={onDragOver}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <span>
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-sm border border-primary/20 bg-primary/10 text-primary">
          {icon}
        </span>
        <span className="mono mt-5 block text-[11px] uppercase tracking-[0.16em] text-foreground/80 group-hover:text-primary">{title}</span>
        <span className="mono mt-2.5 block text-[10px] leading-relaxed text-foreground/45">{hint}</span>
      </span>
      <input type="file" accept="video/*" capture={capture} className="sr-only" onChange={onChange} disabled={disabled} data-testid={testId} />
    </label>
  );
}
