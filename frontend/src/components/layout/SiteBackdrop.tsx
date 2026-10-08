"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

// Three.js stays off the server render and off the critical path.
const NatarajaShadow = dynamic(() => import("@/components/three/NatarajaShadow"));

/**
 * Puts the Nataraja shadow behind every page but the landing page.
 *
 * The landing page runs its own `NatarajaStage`, which owns the same figure and
 * resolves it through three states as you scroll. Two of them on one page would
 * be two WebGL contexts drawing the same model on top of each other.
 *
 * Off to the right and only partly on screen, at the size a page's own
 * illustration would be. Centred, a figure this size sits directly under the
 * reading column and has to be faded until it is not worth drawing.
 */
export default function SiteBackdrop() {
  const pathname = usePathname();
  // Don't render behind the landing page (which runs NatarajaStage)
  // or behind 3D lesson players and practice coaches (which run their own 3D studios)
  if (
    pathname === "/" ||
    pathname.startsWith("/learn/") ||
    pathname.startsWith("/practice") ||
    pathname.startsWith("/live") ||
    pathname.startsWith("/mocap") ||
    pathname === "/lesson"
  ) {
    return null;
  }

  return (
    <div className="fixed inset-y-0 right-0 w-full lg:w-[62%] -z-0 pointer-events-none overflow-hidden opacity-30 dark:opacity-75 transition-opacity">
      <NatarajaShadow className="absolute inset-0 translate-x-[18%] scale-125" />
    </div>
  );
}
