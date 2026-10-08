"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { LogOut, Menu, X } from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/shared/ThemeToggle";

/**
 * The one piece of chrome on every page, so it stays out of the way.
 *
 * Set in monospace at label size rather than as seven equal-weight sentences,
 * which is what let the old bar read as a row of buttons competing with the
 * page. The current section is marked, because a nav that never tells you where
 * you are is decoration.
 */

const LINKS = [
  { name: "Learn", href: "/learn" },
  { name: "Practice", href: "/practice" },
  { name: "Live", href: "/live" },
  { name: "Library", href: "/library" },
  { name: "Research", href: "/research" },
  { name: "Dashboard", href: "/dashboard" },
  { name: "About", href: "/about" },
];

const AVATAR = "https://api.dicebear.com/9.x/micah/svg?seed=DemoUser&backgroundColor=ffb86c";

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { data: session } = useSession();
  const pathname = usePathname();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const isCurrent = (href: string) =>
    href.startsWith("/#") ? false : href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <nav
      className={cn(
        "fixed top-0 inset-x-0 z-50 px-6 py-4 transition-colors duration-300",
        scrolled
          ? "bg-background/85 backdrop-blur-xl border-b border-foreground/10"
          : "bg-transparent border-b border-transparent",
      )}
    >
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-6">
        <Link href="/" className="flex items-center gap-2.5 shrink-0 group">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="NrityaVaani Logo"
            className="w-8 h-8 rounded-lg object-contain shadow-sm border border-foreground/10 group-hover:scale-105 transition-transform"
          />
          <span className="text-[1.1rem] font-semibold tracking-tight font-outfit">
            Nritya<span className="text-primary">Vaani</span>
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-7">
          {LINKS.map((link) => (
            <Link
              key={link.name}
              href={link.href}
              aria-current={isCurrent(link.href) ? "page" : undefined}
              className={cn(
                "mono text-[10px] uppercase tracking-[0.16em] transition-colors",
                isCurrent(link.href)
                  ? "text-primary"
                  : "text-foreground/55 hover:text-foreground",
              )}
            >
              {link.name}
            </Link>
          ))}

          <div className="flex items-center gap-5 pl-2">
            <ThemeToggle />
            {session ? (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={AVATAR}
                  alt=""
                  className="w-7 h-7 rounded-full border border-foreground/15 bg-foreground/5"
                />
                <span className="mono text-[10px] uppercase tracking-[0.14em] text-foreground/55 max-w-[9ch] truncate">
                  {session.user?.name}
                </span>
                <button
                  type="button"
                  onClick={() => signOut()}
                  title="Sign out"
                  className="text-foreground/40 hover:text-rose-400 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <Link
                href="/live"
                className="mono rounded-full bg-primary text-black px-5 py-2 text-[10px] uppercase tracking-[0.16em] hover:bg-primary/85 transition-colors font-medium"
              >
                Try Live AI
              </Link>
            )}
          </div>
        </div>

        <div className="md:hidden flex items-center gap-3">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            className="p-2 text-foreground"
          >
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.22 }}
            className="md:hidden absolute top-full inset-x-0 bg-background/97 backdrop-blur-xl border-b border-foreground/10 px-6 py-8"
          >
            {session && (
              <div className="flex items-center gap-3 pb-6 mb-6 border-b border-foreground/10">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={AVATAR}
                  alt=""
                  className="w-10 h-10 rounded-full border border-foreground/15"
                />
                <div className="min-w-0">
                  <p className="text-[0.95rem] font-semibold truncate">{session.user?.name}</p>
                  <p className="mono text-[10px] text-foreground/45 truncate">
                    {session.user?.email}
                  </p>
                </div>
              </div>
            )}

            <ul className="space-y-5">
              {LINKS.map((link) => (
                <li key={link.name}>
                  <Link
                    href={link.href}
                    // A menu left open across a navigation covers the page you
                    // just asked for.
                    onClick={() => setOpen(false)}
                    aria-current={isCurrent(link.href) ? "page" : undefined}
                    className={cn(
                      "mono text-[12px] uppercase tracking-[0.16em]",
                      isCurrent(link.href) ? "text-primary" : "text-foreground/70",
                    )}
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>

            {session ? (
              <button
                type="button"
                onClick={() => signOut()}
                className="mono mt-8 w-full rounded-full border border-rose-500/30 text-rose-400 py-3 text-[11px] uppercase tracking-[0.16em]"
              >
                Sign out
              </button>
            ) : (
              <Link
                href="/live"
                onClick={() => setOpen(false)}
                className="mono mt-8 block text-center rounded-full bg-primary text-black py-3 text-[11px] uppercase tracking-[0.16em] font-medium"
              >
                Try Live AI
              </Link>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
