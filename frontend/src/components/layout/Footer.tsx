import Link from "next/link";
import { Github, Instagram, Twitter } from "lucide-react";

const PLATFORM = [
  { href: "/practice", label: "Practice coach" },
  { href: "/live", label: "Live detection" },
  { href: "/learn", label: "Interactive lessons" },
  { href: "/library", label: "Pose library" },
  { href: "/upload", label: "Upload analysis" },
  { href: "/mocap", label: "Mocap studio" },
  { href: "/research", label: "Research" },
];

const PROJECT = [
  { href: "/about", label: "About" },
  { href: "/dashboard", label: "My practice" },
  { href: "/privacy", label: "Privacy" },
  { href: "mailto:support@nrityavaani.com", label: "Support" },
];

const SOCIAL = [
  { href: "https://github.com", label: "GitHub", Icon: Github },
  { href: "https://twitter.com", label: "Twitter", Icon: Twitter },
  { href: "https://instagram.com", label: "Instagram", Icon: Instagram },
];

export default function Footer() {
  return (
    <footer className="relative z-10 border-t border-foreground/12 bg-background/95 backdrop-blur-md px-6 pt-16 pb-10">
      <div className="max-w-6xl mx-auto">
        <div className="grid gap-12 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <Link href="/" className="inline-flex items-center gap-2.5 group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo.png"
                alt="NrityaVaani"
                className="w-7 h-7 rounded-lg object-contain shadow-sm border border-foreground/10 group-hover:scale-105 transition-transform"
              />
              <span className="text-[1.05rem] font-semibold tracking-tight font-outfit">
                Nritya<span className="text-primary">Vaani</span>
              </span>
            </Link>
            <p className="serif text-[0.98rem] leading-[1.6] text-foreground/55 mt-5 max-w-sm">
              Learn the classical dances of India and practise their poses with on-device
              tracking. No frame of video leaves the device.
            </p>
            <div className="flex items-center gap-5 mt-7">
              {SOCIAL.map(({ href, label, Icon }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="text-foreground/40 hover:text-primary transition-colors"
                >
                  <Icon className="w-[18px] h-[18px]" />
                </a>
              ))}
            </div>
          </div>

          <FooterColumn title="platform" links={PLATFORM} />
          <FooterColumn title="project" links={PROJECT} />
        </div>

        <div className="mt-16 pt-7 border-t border-foreground/12 flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
          <p className="mono text-[10px] uppercase tracking-[0.16em] text-foreground/35">
            © 2026 NrityaVaani
          </p>
          <p className="mono text-[10px] uppercase tracking-[0.16em] text-foreground/35">
            Classical dance · pose detection
          </p>
        </div>

        {/*
          CC BY 4.0 asks for the credit wherever the work is shown, and the hero
          puts the hand on every page this footer sits under.

          TODO: the Nataraja model on the landing page needs its own line here.
          It arrived without licence text and its glTF generator says Sketchfab,
          where most models are CC BY 4.0 and require attribution — so it is very
          likely owed a credit. public/models/natraj-license.txt has the details
          to fill in. Do that before this ships.
        */}
        <p className="mt-6 text-[11px] leading-relaxed text-foreground/25">
          Hand model{" "}
          <a
            href="https://sketchfab.com/3d-models/low-poly-hand-with-animation-33253439b0874d09b46a9a18685c863c"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground/50 transition-colors"
          >
            &ldquo;Low-Poly Hand With Animation&rdquo;
          </a>{" "}
          by volkanongun, licensed under{" "}
          <a
            href="https://creativecommons.org/licenses/by/4.0/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground/50 transition-colors"
          >
            CC BY 4.0
          </a>
          .
        </p>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: { href: string; label: string }[];
}) {
  return (
    <nav>
      <h2 className="mono text-[10px] uppercase tracking-[0.2em] text-foreground/35">{title}</h2>
      <ul className="mt-6 space-y-3.5">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="text-[0.92rem] text-foreground/60 hover:text-primary transition-colors"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
