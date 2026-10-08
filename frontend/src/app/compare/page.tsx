import type { Metadata } from "next";
import CompareClient from "@/components/compare/CompareClient";

export const metadata: Metadata = {
  title: "Compare with teacher | NrityaVaani",
  description:
    "Mark a step in your teacher's video, add a video of yourself, and get up to three corrections. Both videos are processed on your device and never uploaded.",
};

export default function ComparePage() {
  return <CompareClient />;
}
