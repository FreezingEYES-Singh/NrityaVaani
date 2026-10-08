'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { 
  Award, 
  Clock, 
  Flame, 
  Search, 
  Sparkles, 
  Target, 
  ArrowRight, 
  CheckCircle2, 
  ChevronRight, 
  Compass, 
  Video,
  Activity
} from 'lucide-react';
import { MUDRAS } from '@/lib/constants/mudras';
import { StatsService, type PracticeSession, type UserStats } from '@/lib/services/StatsService';
import { Eyebrow, Headline, Prose, Rule } from '@/components/ui/editorial';
import { cn } from '@/lib/utils';

type CategoryFilter = 'all' | 'asamyukta' | 'samyukta';
type DifficultyFilter = 'all' | 'Beginner' | 'Intermediate' | 'Advanced';

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '0m';
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
}

export default function PracticeHubPage() {
  const [stats, setStats] = useState<UserStats | null>(null);
  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [difficultyFilter, setDifficultyFilter] = useState<DifficultyFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    setStats(StatsService.getStats());
    setSessions(StatsService.getSessions());
  }, []);

  // Map each mudra slug to its best recorded accuracy
  const mudraScores = useMemo(() => {
    const map = new Map<string, number>();
    for (const session of sessions) {
      const current = map.get(session.mudraId) || 0;
      if (session.accuracy > current) {
        map.set(session.mudraId, session.accuracy);
      }
    }
    return map;
  }, [sessions]);

  // Set of mastered mudra slugs (score >= 90 or stored in userStats)
  const masteredSet = useMemo(() => {
    const set = new Set<string>(stats?.masteredMudras || []);
    mudraScores.forEach((score, slug) => {
      if (score >= 90) set.add(slug);
    });
    return set;
  }, [stats, mudraScores]);

  // Next recommended mudra: first unmastered beginner mudra, or lowest score, or default pataka
  const recommendedMudra = useMemo(() => {
    // 1. First unmastered beginner mudra
    const unmasteredBeginner = MUDRAS.find(
      (m) => m.difficulty === 'Beginner' && !masteredSet.has(m.slug)
    );
    if (unmasteredBeginner) return { mudra: unmasteredBeginner, reason: 'Foundation step to master' };

    // 2. Practiced mudra with accuracy < 85% needing polish
    for (const m of MUDRAS) {
      const score = mudraScores.get(m.slug);
      if (score !== undefined && score < 85) {
        return { mudra: m, reason: `Improve your ${score}% score` };
      }
    }

    // 3. First untouched mudra
    const untouched = MUDRAS.find((m) => !mudraScores.has(m.slug));
    if (untouched) return { mudra: untouched, reason: 'New gesture to learn' };

    // 4. Default to first mudra
    return { mudra: MUDRAS[0], reason: 'Keep your practice sharp' };
  }, [masteredSet, mudraScores]);

  // Filtered mudras
  const filteredMudras = useMemo(() => {
    return MUDRAS.filter((m) => {
      // Category filter
      if (categoryFilter === 'asamyukta' && !m.category.toLowerCase().includes('asamyukta')) {
        return false;
      }
      if (categoryFilter === 'samyukta' && !m.category.toLowerCase().includes('samyukta')) {
        return false;
      }
      // Difficulty filter
      if (difficultyFilter !== 'all' && m.difficulty !== difficultyFilter) {
        return false;
      }
      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesName = m.name.toLowerCase().includes(query);
        const matchesMeaning = m.meaning.toLowerCase().includes(query);
        const matchesCategory = m.category.toLowerCase().includes(query);
        if (!matchesName && !matchesMeaning && !matchesCategory) return false;
      }
      return true;
    });
  }, [categoryFilter, difficultyFilter, searchQuery]);

  const totalMasteredCount = masteredSet.size;

  return (
    <div className="min-h-screen px-6 pt-32 pb-28">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <header>
          <div className="flex flex-wrap items-center gap-3">
            <Eyebrow tone="primary">targeted training</Eyebrow>
            <span className="mono text-[10px] uppercase tracking-[0.16em] text-foreground/40">
              on-device vision &middot; bilingual audio
            </span>
          </div>
          <Headline as="h1" className="mt-3">
            Practice Coach
          </Headline>
          <Prose className="mt-4">
            <p>
              Targeted posture training with real-time AI scoring, 3D hand guidance, and bilingual 
              voice feedback. Select a mudra, hold the gesture to the camera, and refine your precision.
            </p>
          </Prose>
        </header>

        {/* Stats & Streak Strip */}
        <section aria-label="Practice Statistics" className="mt-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-5 rounded-sm border border-foreground/12 bg-foreground/[0.02]">
            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-sm bg-primary/10 border border-primary/20 grid place-items-center text-primary shrink-0">
                <Clock className="w-4 h-4" />
              </div>
              <div>
                <p className="mono text-[10px] uppercase tracking-[0.16em] text-foreground/45">
                  Practice Time
                </p>
                <p className="mono text-[1.25rem] font-semibold tracking-tight text-foreground/90 mt-0.5">
                  {formatDuration(stats?.totalPracticeTime || 0)}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-sm bg-primary/10 border border-primary/20 grid place-items-center text-primary shrink-0">
                <Target className="w-4 h-4" />
              </div>
              <div>
                <p className="mono text-[10px] uppercase tracking-[0.16em] text-foreground/45">
                  Sessions
                </p>
                <p className="mono text-[1.25rem] font-semibold tracking-tight text-foreground/90 mt-0.5">
                  {stats?.totalSessions || sessions.length}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-sm bg-primary/10 border border-primary/20 grid place-items-center text-primary shrink-0">
                <Flame className="w-4 h-4 text-amber-500" />
              </div>
              <div>
                <p className="mono text-[10px] uppercase tracking-[0.16em] text-foreground/45">
                  Avg Accuracy
                </p>
                <p className="mono text-[1.25rem] font-semibold tracking-tight text-foreground/90 mt-0.5">
                  {stats?.averageAccuracy ? `${stats.averageAccuracy}%` : '—'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-sm bg-primary/10 border border-primary/20 grid place-items-center text-emerald-400 shrink-0">
                <Award className="w-4 h-4" />
              </div>
              <div>
                <p className="mono text-[10px] uppercase tracking-[0.16em] text-foreground/45">
                  Mastered
                </p>
                <p className="mono text-[1.25rem] font-semibold tracking-tight text-foreground/90 mt-0.5">
                  {totalMasteredCount} <span className="text-foreground/40 text-[0.95rem]">/ {MUDRAS.length}</span>
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Daily Goal & Recommended Mudra Hero Card */}
        <section aria-label="Daily Recommended Practice" className="mt-8">
          <div className="relative overflow-hidden rounded-sm border border-foreground/15 bg-gradient-to-br from-primary/5 via-foreground/[0.01] to-background p-6 sm:p-8">
            <div className="grid md:grid-cols-[minmax(0,1fr)_auto] gap-6 items-center">
              <div>
                <div className="inline-flex items-center gap-2 mono text-[10px] uppercase tracking-[0.18em] text-primary font-semibold mb-2">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Recommended Next</span>
                  <span className="text-foreground/30">&middot;</span>
                  <span className="text-foreground/50">{recommendedMudra.reason}</span>
                </div>
                <h2 className="serif text-[1.8rem] sm:text-[2.2rem] font-normal tracking-tight leading-tight">
                  {recommendedMudra.mudra.name}{' '}
                  <span className="italic text-primary">{recommendedMudra.mudra.meaning}</span>
                </h2>
                <p className="serif text-[1rem] leading-[1.6] text-foreground/65 mt-2 max-w-[55ch]">
                  {recommendedMudra.mudra.meaningLong}
                </p>

                <div className="mt-6 flex flex-wrap items-center gap-4">
                  <Link
                    href={`/practice/${recommendedMudra.mudra.slug}`}
                    className="mono inline-flex items-center gap-2.5 rounded-full bg-primary px-7 py-3 text-[11px] uppercase tracking-[0.16em] text-black font-medium hover:bg-primary/85 transition-colors"
                  >
                    <Video className="w-4 h-4" />
                    Practise {recommendedMudra.mudra.name} Now
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                  <Link
                    href="/live"
                    className="mono inline-flex items-center gap-2 rounded-full border border-foreground/20 px-5 py-3 text-[10px] uppercase tracking-[0.16em] text-foreground/70 hover:border-primary/60 hover:text-primary transition-colors"
                  >
                    <Activity className="w-3.5 h-3.5" />
                    Free Camera Practice
                  </Link>
                </div>
              </div>

              {/* Thumbnail of recommended mudra */}
              <div className="hidden md:block relative w-32 h-44 overflow-hidden rounded-sm border border-foreground/15 bg-black shrink-0">
                <Image
                  src={recommendedMudra.mudra.image}
                  alt={`The ${recommendedMudra.mudra.name} mudra`}
                  fill
                  sizes="128px"
                  className="object-contain"
                />
              </div>
            </div>
          </div>
        </section>

        <Rule className="my-12" />

        {/* Filter & Search Bar */}
        <section aria-label="Filter Mudras">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
            {/* Category tabs */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="mono text-[10px] uppercase tracking-[0.18em] text-foreground/40 mr-1">
                Type:
              </span>
              {[
                { id: 'all', label: `All (${MUDRAS.length})` },
                { id: 'asamyukta', label: 'Single Hand (18)' },
                { id: 'samyukta', label: 'Double Hand (10)' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setCategoryFilter(tab.id as CategoryFilter)}
                  className={cn(
                    'mono text-[10px] uppercase tracking-[0.14em] px-3.5 py-1.5 rounded-full border transition-colors',
                    categoryFilter === tab.id
                      ? 'border-primary/80 bg-primary/10 text-primary font-medium'
                      : 'border-foreground/15 text-foreground/55 hover:border-foreground/30 hover:text-foreground'
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Difficulty & Search */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5">
                {(['all', 'Beginner', 'Intermediate', 'Advanced'] as const).map((diff) => (
                  <button
                    key={diff}
                    type="button"
                    onClick={() => setDifficultyFilter(diff)}
                    className={cn(
                      'mono text-[9px] uppercase tracking-[0.14em] px-2.5 py-1 rounded-sm border transition-colors',
                      difficultyFilter === diff
                        ? 'border-primary bg-primary text-black font-semibold'
                        : 'border-foreground/15 text-foreground/50 hover:text-foreground'
                    )}
                  >
                    {diff}
                  </button>
                ))}
              </div>

              {/* Search input */}
              <div className="relative min-w-[200px]">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-foreground/40" />
                <input
                  type="text"
                  placeholder="Search mudra..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-[11px] mono bg-foreground/[0.03] border border-foreground/15 rounded-sm text-foreground focus:outline-none focus:border-primary/80 placeholder:text-foreground/30"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Mudra Practice Grid */}
        <section aria-label="Mudra Practice Curriculum" className="mt-8">
          {filteredMudras.length === 0 ? (
            <div className="rounded-sm border border-dashed border-foreground/20 p-16 text-center">
              <p className="serif text-[1.2rem] text-foreground/70">No mudras match your search.</p>
              <button
                type="button"
                onClick={() => {
                  setCategoryFilter('all');
                  setDifficultyFilter('all');
                  setSearchQuery('');
                }}
                className="mono mt-4 text-[10px] uppercase tracking-[0.16em] text-primary hover:underline underline-offset-4"
              >
                Clear all filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {filteredMudras.map((mudra) => {
                const bestScore = mudraScores.get(mudra.slug);
                const isMastered = masteredSet.has(mudra.slug);

                return (
                  <article
                    key={mudra.slug}
                    className="group flex flex-col rounded-sm border border-foreground/12 bg-background/60 p-4 transition-all duration-200 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5"
                  >
                    {/* Thumbnail */}
                    <div className="relative aspect-[4/5] overflow-hidden rounded-sm bg-black border border-foreground/10">
                      <Image
                        src={mudra.image}
                        alt={`The ${mudra.name} mudra`}
                        fill
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                        className="object-contain transition-transform duration-300 group-hover:scale-[1.02]"
                      />

                      {/* Status overlay badge */}
                      <div className="absolute top-2.5 right-2.5">
                        {isMastered ? (
                          <span className="mono inline-flex items-center gap-1 rounded-full bg-emerald-950/80 border border-emerald-500/40 px-2.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-emerald-300 backdrop-blur-md">
                            <CheckCircle2 className="w-2.5 h-2.5" />
                            {bestScore ? `${bestScore}%` : 'Mastered'}
                          </span>
                        ) : bestScore !== undefined ? (
                          <span className="mono inline-flex items-center gap-1 rounded-full bg-amber-950/80 border border-amber-500/40 px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] text-amber-300 backdrop-blur-md">
                            {bestScore}%
                          </span>
                        ) : (
                          <span className="mono text-[8px] uppercase tracking-[0.14em] text-foreground/40 bg-black/60 px-2 py-0.5 rounded-full border border-foreground/10 backdrop-blur-md">
                            Untouched
                          </span>
                        )}
                      </div>

                      {/* Difficulty Tag */}
                      <div className="absolute bottom-2 left-2">
                        <span className="mono text-[8px] uppercase tracking-[0.14em] text-foreground/75 bg-black/75 px-2 py-0.5 rounded-sm border border-foreground/15 backdrop-blur-md">
                          {mudra.difficulty}
                        </span>
                      </div>
                    </div>

                    {/* Content */}
                    <div className="mt-3.5 flex-1 flex flex-col">
                      <div className="flex items-baseline justify-between gap-2">
                        <h3 className="serif text-[1.2rem] font-semibold leading-tight group-hover:text-primary transition-colors">
                          {mudra.name}
                        </h3>
                        <span className="serif italic text-[0.88rem] text-foreground/50 truncate">
                          {mudra.meaning}
                        </span>
                      </div>

                      <p className="serif text-[0.88rem] leading-[1.5] text-foreground/60 mt-1.5 line-clamp-2">
                        {mudra.instructions}
                      </p>

                      {/* Actions */}
                      <div className="mt-auto pt-4 flex items-center justify-between border-t border-foreground/10">
                        <Link
                          href={`/practice/${mudra.slug}`}
                          className="mono inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-primary font-medium hover:underline underline-offset-4"
                        >
                          Practise
                          <ArrowRight className="w-3 h-3" />
                        </Link>
                        <Link
                          href={`/library/${mudra.slug}`}
                          className="mono text-[9px] uppercase tracking-[0.16em] text-foreground/40 hover:text-foreground transition-colors"
                        >
                          Details
                        </Link>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* Alternate Practice Modes Banner */}
        <section aria-label="Alternate Practice Modes" className="mt-20">
          <Rule className="mb-12" />
          <div className="grid md:grid-cols-2 gap-8">
            <div className="p-6 rounded-sm border border-foreground/12 bg-foreground/[0.01]">
              <div className="w-9 h-9 rounded-sm bg-primary/10 border border-primary/20 grid place-items-center text-primary mb-4">
                <Video className="w-4 h-4" />
              </div>
              <h3 className="serif text-[1.4rem] leading-tight">Freeform Live Detection</h3>
              <p className="serif text-[0.98rem] leading-[1.6] text-foreground/60 mt-2">
                Turn on your camera without setting a target mudra. Practice free sequences and let 
                the AI identify each gesture and measure your transition fluidity in real-time.
              </p>
              <Link
                href="/live"
                className="mono mt-5 inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-primary hover:underline underline-offset-4"
              >
                Open Live Detection
                <ChevronRight className="w-3 h-3" />
              </Link>
            </div>

            <div className="p-6 rounded-sm border border-foreground/12 bg-foreground/[0.01]">
              <div className="w-9 h-9 rounded-sm bg-primary/10 border border-primary/20 grid place-items-center text-primary mb-4">
                <Compass className="w-4 h-4" />
              </div>
              <h3 className="serif text-[1.4rem] leading-tight">Classical Dance Lessons</h3>
              <p className="serif text-[0.98rem] leading-[1.6] text-foreground/60 mt-2">
                Study full body choreographies and classical adavus (Namaskaram, Thattadavu) with 
                our 3D humanoid avatar and bilingual teacher voice narration.
              </p>
              <Link
                href="/learn"
                className="mono mt-5 inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-primary hover:underline underline-offset-4"
              >
                Go to Lessons
                <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
