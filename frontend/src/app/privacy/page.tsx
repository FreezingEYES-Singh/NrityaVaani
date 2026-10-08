import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ShieldCheck, Cpu, HardDrive, EyeOff } from "lucide-react";
import { Eyebrow, FactStrip, Headline, Mark, Prose, Rule } from "@/components/ui/editorial";
import DeleteSavedSteps from "@/components/compare/DeleteSavedSteps";

export const metadata: Metadata = {
  title: "Privacy | NrityaVaani",
  description: "How NrityaVaani processes camera video and dance postures strictly on your device.",
};

const PILLARS = [
  {
    icon: Cpu,
    title: "100% On-Device Inference",
    desc: "Computer vision and landmark calculations run directly in your browser using WebAssembly and WebGL. No video feed or individual image frame is ever uploaded or streamed to an external server.",
  },
  {
    icon: EyeOff,
    title: "No Recording or Surveillance",
    desc: "Nothing is recorded unless you choose to, and recordings never leave your device. Your camera stream exists only in volatile memory while the live session is active. Closing or navigating away from the page immediately releases the camera hardware and clears the buffer.",
  },
  {
    icon: HardDrive,
    title: "Local Storage for Practice Data",
    desc: "Practice sessions, streak history, and accuracy metrics are stored locally on your device in your browser's localStorage and IndexedDB. You retain full control over your practice records.",
  },
  {
    icon: ShieldCheck,
    title: "Zero Third-Party Tracking",
    desc: "We do not sell personal data, profile dance learners for advertising, or deploy invasive tracking pixels.",
  },
];

export default function PrivacyPage() {
  return (
    <div className="min-h-screen px-6 pt-32 pb-24">
      <div className="max-w-4xl mx-auto">
        <Link
          href="/"
          className="mono inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-foreground/45 hover:text-primary transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Home
        </Link>

        <div className="mt-8">
          <Eyebrow tone="primary">privacy & security</Eyebrow>
          <Headline as="h1" className="mt-4">
            Private by design. <Mark>Nothing leaves your device</Mark>.
          </Headline>
          <Prose className="mt-6">
            <p>
              NrityaVaani is built on a straightforward principle: a dance practice session is personal.
              When you enable your camera, the neural vision pipeline runs inside your browser sandbox.
              Your video stays yours.
            </p>
          </Prose>
        </div>

        <FactStrip
          className="mt-10"
          items={[
            "Client-Side AI",
            "Zero Cloud Video Storage",
            "Local Practice History",
            "Browser Sandboxed",
          ]}
        />

        <Rule className="my-14" />

        <div className="grid sm:grid-cols-2 gap-8">
          {PILLARS.map((pillar) => {
            const Icon = pillar.icon;
            return (
              <div
                key={pillar.title}
                className="rounded-sm border border-foreground/12 bg-foreground/[0.01] p-6 flex flex-col justify-between"
              >
                <div>
                  <div className="w-9 h-9 rounded-sm bg-primary/10 border border-primary/20 grid place-items-center text-primary mb-4">
                    <Icon className="w-4 h-4" />
                  </div>
                  <h2 className="text-[1.1rem] font-semibold tracking-tight">{pillar.title}</h2>
                  <p className="serif text-[0.98rem] leading-[1.6] text-foreground/60 mt-2.5">
                    {pillar.desc}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <Rule className="my-14" />

        <section>
          <Eyebrow tone="primary">compare with teacher</Eyebrow>
          <h2 className="serif text-[1.8rem] leading-tight mt-3">Videos you use in Compare</h2>
          <Prose className="mt-4">
            <p>
              Videos you use in Compare are processed on this device and never uploaded. NrityaVaani never saves your own
              videos. If you record with your phone&apos;s camera, the camera app may keep its own copy in your gallery;
              delete it there if you want.
            </p>
            <p>
              A teacher step you mark is kept for the session (so a reload doesn&apos;t lose it) and then deleted, unless
              you tap &ldquo;Save this teacher step&rdquo;. Only the stick figure is kept, never video.
            </p>
            <p>
              Model files are downloaded from Google when you use the camera or video features (the Live and Upload pages
              also load their runtime from jsDelivr); no video or images are sent.
            </p>
          </Prose>
          <div className="mt-5">
            <DeleteSavedSteps />
          </div>
        </section>

        <Rule className="my-14" />

        <section>
          <Eyebrow tone="primary">questions & contact</Eyebrow>
          <h2 className="serif text-[1.8rem] leading-tight mt-3">Contact</h2>
          <Prose className="mt-4">
            <p>
              If you have any questions regarding how NrityaVaani processes data or would like to request assistance,
              reach out to our engineering team directly at{" "}
              <a
                href="mailto:support@nrityavaani.com"
                className="text-primary underline underline-offset-4"
              >
                support@nrityavaani.com
              </a>
              .
            </p>
          </Prose>
        </section>
      </div>
    </div>
  );
}
