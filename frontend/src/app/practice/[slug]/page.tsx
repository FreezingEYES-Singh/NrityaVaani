'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ArrowLeft, 
  ArrowRight,
  Camera, 
  ChevronLeft, 
  ChevronRight, 
  RotateCcw, 
  Volume2, 
  VolumeX, 
  Award, 
  CheckCircle2, 
  Sparkles, 
  Box, 
  Image as ImageIcon 
} from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { MUDRAS } from '@/lib/constants/mudras';
import type { Point } from '@/lib/mediapipe/classification';
import CameraFeed from '@/components/live/CameraFeed';
import { cn } from '@/lib/utils';
import { Eyebrow, Rule } from '@/components/ui/editorial';
import { translateFeedback } from '@/lib/utils/translations';
import { StatsService } from '@/lib/services/StatsService';

const MudraHand3D = dynamic(() => import('@/components/three/MudraHand3D'), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center bg-black/40">
      <span className="mono text-[10px] uppercase tracking-[0.16em] text-foreground/40">
        Loading 3D Hand Model...
      </span>
    </div>
  ),
});

/** What CameraFeed hands back for each hand it reads. */
type DetectedMudra = { name: string; confidence: number; feedback: string; handedness?: string; isTarget?: boolean };

const THREE_D_MUDRA_INDEX: Record<string, number> = {
  pataka: 0,
  tripataka: 1,
  ardhapataka: 2,
  kartarimukha: 3,
  mayura: 4,
  ardhachandra: 5,
  alapadma: 6,
  mushti: 7,
};

const REQUIRED_HOLD_MS = 3000;

export default function PracticeModePage() {
  const params = useParams();
  const router = useRouter();
  const mudraSlug = params.slug as string;
  const mudra = MUDRAS.find(m => m.slug === mudraSlug);

  const currentIndex = useMemo(() => {
    return MUDRAS.findIndex(m => m.slug === mudraSlug);
  }, [mudraSlug]);

  const prevMudra = currentIndex > 0 ? MUDRAS[currentIndex - 1] : null;
  const nextMudra = currentIndex >= 0 && currentIndex < MUDRAS.length - 1 ? MUDRAS[currentIndex + 1] : null;
  const has3DPose = mudra ? mudra.slug in THREE_D_MUDRA_INDEX : false;

  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(true);
  const [language, setLanguage] = useState<'en' | 'hi'>('en');
  const [confidence, setConfidence] = useState(0);
  const [bestDetection, setBestDetection] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string>("Show your hand to the camera to begin.");
  const [overlayMode, setOverlayMode] = useState<'photo' | '3d'>('photo');

  // Hold-to-Master Progression State
  const [holdProgress, setHoldProgress] = useState(0); // 0 to 100
  const [isMastered, setIsMastered] = useState(false);
  const holdStartRef = useRef<number | null>(null);
  const hasSavedMasteryRef = useRef(false);

  // Session Logging
  const sessionStartTimeRef = useRef<number | null>(null);
  const accuracySamplesRef = useRef<number[]>([]);

  // Voice Assistant Ref
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null);
  const lastSpokenRef = useRef<string>("");
  const speechTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasGreetedRef = useRef(false);
  const lastHandSeenRef = useRef<number | null>(null);
  const nudgeIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize voices
  useEffect(() => {
    const loadVoices = () => {
      if (typeof window === 'undefined' || !window.speechSynthesis) return;
      const voices = window.speechSynthesis.getVoices();
      const targetVoice = voices.find(v => v.lang === 'hi-IN') || 
                          voices.find(v => v.lang.includes('hi')) ||
                          voices.find(v => v.lang.includes('IN'));
      setVoice(targetVoice || null);
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  // Speak feedback function
  const speak = useCallback((text: string) => {
    if (!isVoiceEnabled || typeof window === 'undefined' || !window.speechSynthesis) return;
    if (text === lastSpokenRef.current) return;
    
    if (speechTimeoutRef.current) clearTimeout(speechTimeoutRef.current);
    
    speechTimeoutRef.current = setTimeout(() => {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      
      if (voice) utterance.voice = voice;
      utterance.lang = language === 'hi' ? 'hi-IN' : 'en-IN';
      utterance.rate = 0.9;
      utterance.pitch = 1.05;
      
      window.speechSynthesis.speak(utterance);
      lastSpokenRef.current = text;
    }, 300);
  }, [isVoiceEnabled, language, voice]);

  // Nudge logic: Speak if no hand is seen for 12 seconds
  useEffect(() => {
    if (!isCameraActive || !isVoiceEnabled) return;
    lastHandSeenRef.current = Date.now();

    nudgeIntervalRef.current = setInterval(() => {
      const idleTime = Date.now() - (lastHandSeenRef.current ?? Date.now());
      if (idleTime > 12000) {
        const nudgeMsg = translateFeedback("Adjust your hand position to match the reference image.", language);
        speak(nudgeMsg);
        lastHandSeenRef.current = Date.now();
      }
    }, 5000);

    return () => {
      if (nudgeIntervalRef.current) clearInterval(nudgeIntervalRef.current);
    };
  }, [isCameraActive, isVoiceEnabled, language, speak]);

  // Session start & stop persistence
  useEffect(() => {
    if (isCameraActive) {
      sessionStartTimeRef.current = Date.now();
      accuracySamplesRef.current = [];
      hasSavedMasteryRef.current = false;
      setIsMastered(false);
      setHoldProgress(0);
    } else if (sessionStartTimeRef.current && mudra) {
      const duration = (Date.now() - sessionStartTimeRef.current) / 1000;
      const samples = accuracySamplesRef.current;
      if (duration > 4 && samples.length > 0 && !hasSavedMasteryRef.current) {
        const avgAccuracy = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
        StatsService.saveSession({
          mudraId: mudra.slug,
          mudraName: mudra.name,
          accuracy: avgAccuracy,
          duration: Math.round(duration),
        });
      }
      sessionStartTimeRef.current = null;
    }
  }, [isCameraActive, mudra]);

  // Hold-to-master loop
  useEffect(() => {
    if (!isCameraActive || !mudra) return;

    const interval = setInterval(() => {
      if (confidence >= 0.8) {
        if (!holdStartRef.current) {
          holdStartRef.current = Date.now();
        }
        const elapsed = Date.now() - holdStartRef.current;
        const progress = Math.min(100, Math.round((elapsed / REQUIRED_HOLD_MS) * 100));
        setHoldProgress(progress);

        if (elapsed >= REQUIRED_HOLD_MS && !hasSavedMasteryRef.current) {
          hasSavedMasteryRef.current = true;
          setIsMastered(true);

          const duration = sessionStartTimeRef.current
            ? (Date.now() - sessionStartTimeRef.current) / 1000
            : 5;
          const finalScore = Math.max(92, Math.round(confidence * 100));

          StatsService.saveSession({
            mudraId: mudra.slug,
            mudraName: mudra.name,
            accuracy: finalScore,
            duration: Math.max(5, Math.round(duration)),
          });

          const praise = language === 'hi' 
            ? `Adbhut! Aapne ${mudra.name} mudra par purnata prapt ki!` 
            : `Mastered! Excellent ${mudra.name} form held steady.`;
          speak(praise);
        }
      } else if (confidence < 0.65) {
        holdStartRef.current = null;
        setHoldProgress(prev => Math.max(0, prev - 15));
      }
    }, 100);

    return () => clearInterval(interval);
  }, [isCameraActive, confidence, mudra, language, speak]);

  // Handle detection updates
  const handleUpdate = useCallback((landmarkData: { landmarks?: Point[][] } | null, mudraData: DetectedMudra[]) => {
    if (!landmarkData || !landmarkData.landmarks || landmarkData.landmarks.length === 0) {
      return;
    }
    
    lastHandSeenRef.current = Date.now();
    
    if (!hasGreetedRef.current) {
      const greeting = translateFeedback("Show your hand to the camera to begin.", language);
      speak(greeting);
      hasGreetedRef.current = true;
    }
    
    if (!mudra) return;

    // Find the target mudra in the detections
    const targetDetection = mudraData.find(
      m => m.isTarget || m.name.toLowerCase() === mudra.name.toLowerCase()
    );
    const primaryDetection = mudraData[0];

    if (targetDetection) {
      setConfidence(targetDetection.confidence);
      setBestDetection(targetDetection.name);
      
      // Collect accuracy sample
      accuracySamplesRef.current.push(Math.round(targetDetection.confidence * 100));
      
      const translatedMsg = translateFeedback(targetDetection.feedback, language);
      setFeedback(translatedMsg);
      
      if (targetDetection.confidence > 0.85 && !isMastered) {
        const perfectMsg = language === 'hi' 
          ? `Adbhut! ${mudra.name} mudra bilkul sahi hai.` 
          : `Perfect ${mudra.name} form. Hold steady!`;
        speak(perfectMsg);
      } else if (targetDetection.confidence > 0.4 && !isMastered) {
        speak(translatedMsg);
      }
    } else if (primaryDetection && primaryDetection.name !== "No Mudra Detected") {
      setConfidence(0.1); 
      setBestDetection(primaryDetection.name);
      const wrongMsg = translateFeedback(`Detected ${primaryDetection.name} instead. Try to form ${mudra.name}.`, language);
      setFeedback(wrongMsg);
      speak(wrongMsg);
    } 
  }, [mudra, speak, language, isMastered]);

  if (!mudra) {
    return (
      <div className="min-h-screen grid place-items-center px-6">
        <div className="max-w-md">
          <Eyebrow>not found</Eyebrow>
          <h1 className="serif text-[2rem] leading-tight mt-4">No mudra by that name.</h1>
          <Link
            href="/practice"
            className="mono mt-7 inline-flex rounded-full border border-foreground/25 px-6 py-3 text-[11px] uppercase tracking-[0.16em] text-foreground/80 hover:border-primary/60 hover:text-primary transition-colors"
          >
            Back to Practice Hub
          </Link>
        </div>
      </div>
    );
  }

  const reading =
    confidence > 0.8 ? "holding" : confidence > 0.4 ? "close" : isCameraActive ? "searching" : "idle";

  return (
    <div className="min-h-screen px-6 pt-28 pb-20">
      <div className="max-w-[1500px] mx-auto">
        {/* Top Bar: Back Link, Breadcrumbs & Sequence Navigation */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8">
          <div>
            <div className="flex items-center gap-4">
              <Link
                href="/practice"
                className="mono inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-foreground/45 hover:text-primary transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Practice Hub
              </Link>

              <span className="text-foreground/20">&middot;</span>

              {/* Sequence Navigation */}
              <div className="flex items-center gap-2">
                {prevMudra && (
                  <Link
                    href={`/practice/${prevMudra.slug}`}
                    className="mono inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.14em] text-foreground/50 hover:text-primary transition-colors border border-foreground/15 rounded-full px-2.5 py-1"
                    title={`Previous: ${prevMudra.name}`}
                  >
                    <ChevronLeft className="w-3 h-3" />
                    <span className="hidden sm:inline">{prevMudra.name}</span>
                  </Link>
                )}
                <span className="mono text-[10px] uppercase tracking-[0.14em] text-foreground/40 px-1">
                  {currentIndex + 1} / {MUDRAS.length}
                </span>
                {nextMudra && (
                  <Link
                    href={`/practice/${nextMudra.slug}`}
                    className="mono inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.14em] text-foreground/50 hover:text-primary transition-colors border border-foreground/15 rounded-full px-2.5 py-1"
                    title={`Next: ${nextMudra.name}`}
                  >
                    <span className="hidden sm:inline">{nextMudra.name}</span>
                    <ChevronRight className="w-3 h-3" />
                  </Link>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-5">
              <Eyebrow tone="primary">practice</Eyebrow>
              <span className="mono text-[10px] uppercase tracking-[0.18em] text-foreground/40">
                {mudra.category}
              </span>
              <span className="mono text-[10px] uppercase tracking-[0.18em] text-foreground/40">
                {mudra.difficulty}
              </span>
            </div>
            <h1 className="serif font-normal tracking-[-0.015em] leading-[1.05] text-[clamp(1.9rem,4.4vw,3rem)] mt-3">
              {mudra.name} <span className="italic text-primary">{mudra.meaning}</span>
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            {/* 3D / Photo Mode Switcher */}
            {has3DPose && (
              <div className="flex items-center gap-1 bg-foreground/[0.04] p-1 rounded-full border border-foreground/12">
                <button
                  type="button"
                  onClick={() => setOverlayMode('photo')}
                  className={cn(
                    'mono inline-flex items-center gap-1.5 text-[9px] uppercase tracking-[0.14em] px-3 py-1 rounded-full transition-colors',
                    overlayMode === 'photo'
                      ? 'bg-primary text-black font-semibold'
                      : 'text-foreground/50 hover:text-foreground'
                  )}
                >
                  <ImageIcon className="w-3 h-3" />
                  Photo
                </button>
                <button
                  type="button"
                  onClick={() => setOverlayMode('3d')}
                  className={cn(
                    'mono inline-flex items-center gap-1.5 text-[9px] uppercase tracking-[0.14em] px-3 py-1 rounded-full transition-colors',
                    overlayMode === '3d'
                      ? 'bg-primary text-black font-semibold'
                      : 'text-foreground/50 hover:text-foreground'
                  )}
                >
                  <Box className="w-3 h-3" />
                  3D Rig
                </button>
              </div>
            )}

            {/* Language Selector */}
            <div className="flex items-center gap-3">
              <span className="mono text-[10px] uppercase tracking-[0.18em] text-foreground/35">
                voice
              </span>
              {(["en", "hi"] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setLanguage(code)}
                  aria-pressed={language === code}
                  className={cn(
                    "mono text-[10px] uppercase tracking-[0.14em] transition-colors",
                    language === code ? "text-primary" : "text-foreground/45 hover:text-foreground",
                  )}
                >
                  {code === "en" ? "English" : "\u0939\u093f\u0902\u0926\u0940"}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setIsVoiceEnabled(!isVoiceEnabled)}
              className="mono inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-foreground/70 hover:text-primary transition-colors"
            >
              {isVoiceEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              Spoken cues {isVoiceEnabled ? "on" : "off"}
            </button>

            {/* Reset Button */}
            <button
              type="button"
              onClick={() => {
                setConfidence(0);
                setBestDetection(null);
                setFeedback("Show your hand to the camera to begin.");
                setHoldProgress(0);
                setIsMastered(false);
                holdStartRef.current = null;
                hasSavedMasteryRef.current = false;
                hasGreetedRef.current = false;
                lastSpokenRef.current = "";
                if (typeof window !== "undefined") window.speechSynthesis?.cancel();
              }}
              className="mono inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-foreground/70 hover:text-primary transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>
          </div>
        </div>

        <Rule className="mt-8 mb-8" />

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 xl:gap-12">
          {/* Main Camera / Visualizer Column */}
          <div className="xl:col-span-7 space-y-8">
            <div className="relative aspect-video overflow-hidden rounded-sm border border-foreground/12 bg-black">
              <CameraFeed isActive={isCameraActive} onUpdate={handleUpdate} targetMudra={mudra.name} />

              {/* 2D Photo Reference Ghost Overlay */}
              <AnimatePresence>
                {isCameraActive && overlayMode === 'photo' && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 0.18 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 pointer-events-none grid place-items-center p-16"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={mudra.image}
                      alt=""
                      aria-hidden
                      className="h-full w-auto object-contain grayscale invert"
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* 3D Interactive Model Overlay */}
              <AnimatePresence>
                {isCameraActive && overlayMode === '3d' && has3DPose && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 0.85 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 pointer-events-auto"
                  >
                    <MudraHand3D 
                      staticPose={THREE_D_MUDRA_INDEX[mudra.slug]} 
                      className="h-full w-full" 
                    />
                    <div className="absolute bottom-3 right-3 pointer-events-none bg-black/70 backdrop-blur-md px-3 py-1 rounded-sm border border-foreground/15">
                      <span className="mono text-[9px] uppercase tracking-[0.14em] text-primary">
                        Drag to rotate 3D reference
                      </span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Camera Off State */}
              {!isCameraActive && (
                <div className="absolute inset-0 grid place-items-center px-6">
                  <div className="text-center">
                    <Camera className="w-7 h-7 text-foreground/30 mx-auto" />
                    <p className="mono text-[11px] uppercase tracking-[0.16em] text-foreground/60 mt-5">
                      Camera off
                    </p>
                    <p className="mono text-[10px] text-foreground/35 mt-2.5 max-w-[34ch] mx-auto leading-relaxed">
                      On-device neural vision evaluates finger alignment against {mudra.name}. Nothing is recorded.
                    </p>
                    <button
                      type="button"
                      onClick={() => setIsCameraActive(true)}
                      className="mono mt-7 inline-flex rounded-full bg-primary text-black px-7 py-3 text-[11px] uppercase tracking-[0.16em] hover:bg-primary/85 transition-colors font-medium"
                    >
                      Start camera
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Instruction Sections */}
            <div className="grid md:grid-cols-2 gap-8">
              <section>
                <Eyebrow tone="primary">how it is held</Eyebrow>
                <p className="serif text-[1rem] leading-[1.6] text-foreground/70 mt-3">
                  {mudra.instructions}
                </p>
              </section>
              <section className="border-l-2 border-rose-400/40 pl-5">
                <Eyebrow className="text-rose-400/80">where it goes wrong</Eyebrow>
                <p className="serif text-[1rem] leading-[1.6] text-foreground/70 mt-3">
                  {mudra.commonMistakes}
                </p>
              </section>
            </div>
          </div>

          {/* Feedback & Score Panel Column */}
          <div className="xl:col-span-5 space-y-8">
            {/* Target Reference Header */}
            <div className="flex items-start gap-6">
              <div className="relative w-24 h-[7.5rem] shrink-0 overflow-hidden rounded-sm border border-foreground/12 bg-black">
                <Image
                  src={mudra.image}
                  alt={`The ${mudra.name} mudra`}
                  fill
                  sizes="96px"
                  className="object-contain"
                />
              </div>
              <div>
                <Eyebrow>you are aiming for</Eyebrow>
                <h2 className="serif text-[1.6rem] leading-tight tracking-tight mt-2">
                  {mudra.name}
                </h2>
                <p className="serif italic text-[1rem] text-foreground/55 mt-1">{mudra.meaning}</p>
                <p className="mono text-[10px] uppercase tracking-[0.16em] text-primary/80 mt-2">
                  {mudra.category}
                </p>
              </div>
            </div>

            {/* Live Scorecard Card */}
            <div className="border border-foreground/12 rounded-sm p-8 sm:p-10 bg-background/50 backdrop-blur-sm">
              <div className="flex items-baseline justify-between">
                <div className="flex items-baseline gap-3">
                  <span className="mono text-[3.4rem] leading-none tabular-nums tracking-tight text-primary">
                    {Math.round(confidence * 100)}
                  </span>
                  <span className="mono text-[11px] uppercase tracking-[0.16em] text-foreground/45">
                    % match
                  </span>
                </div>

                {/* Hold Timer Ring / Milestone Badge */}
                {confidence >= 0.8 && (
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-full border border-primary/30 flex items-center justify-center relative">
                      <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                        <path
                          className="text-foreground/10"
                          strokeWidth="3"
                          stroke="currentColor"
                          fill="none"
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                        <path
                          className="text-primary transition-all duration-100"
                          strokeDasharray={`${holdProgress}, 100`}
                          strokeWidth="3"
                          strokeLinecap="round"
                          stroke="currentColor"
                          fill="none"
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                      </svg>
                      <span className="absolute mono text-[9px] font-semibold text-primary">
                        {Math.ceil((100 - holdProgress) * 0.03)}s
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Progress bar */}
              <div className="mt-5 h-px w-full bg-foreground/15">
                <div
                  className="h-full bg-primary transition-[width] duration-200"
                  style={{ width: `${Math.round(confidence * 100)}%` }}
                />
              </div>

              {/* Mastery Celebration Banner */}
              {isMastered && (
                <div className="mt-6 p-4 rounded-sm border border-emerald-500/40 bg-emerald-950/30 backdrop-blur-md">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                    <div>
                      <p className="mono text-[10px] uppercase tracking-[0.16em] text-emerald-400 font-semibold">
                        Gesture Mastered!
                      </p>
                      <p className="serif text-[0.95rem] text-foreground/80 mt-0.5">
                        Saved to your practice history. Form held steady with high fidelity.
                      </p>
                    </div>
                  </div>

                  {nextMudra && (
                    <div className="mt-3 pt-3 border-t border-emerald-500/20 flex items-center justify-between">
                      <span className="mono text-[9px] uppercase tracking-[0.14em] text-foreground/50">
                        Up next: {nextMudra.name}
                      </span>
                      <Link
                        href={`/practice/${nextMudra.slug}`}
                        className="mono inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-emerald-300 hover:underline underline-offset-4"
                      >
                        Advance to {nextMudra.name}
                        <ArrowRight className="w-3 h-3" />
                      </Link>
                    </div>
                  )}
                </div>
              )}

              {/* Spoken Feedback */}
              <p
                aria-live="polite"
                className="serif text-[1.08rem] leading-[1.55] text-foreground/80 mt-7"
              >
                {feedback}
              </p>

              <Rule className="my-7" />

              <dl className="space-y-3.5">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="mono text-[10px] uppercase tracking-[0.18em] text-foreground/45">
                    reading
                  </dt>
                  <dd className="mono text-[11px] uppercase tracking-[0.14em] text-foreground/85">
                    {bestDetection ?? "\u2014"}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="mono text-[10px] uppercase tracking-[0.18em] text-foreground/45">
                    status
                  </dt>
                  <dd
                    className={cn(
                      "mono text-[11px] uppercase tracking-[0.14em]",
                      reading === "holding"
                        ? "text-emerald-400"
                        : reading === "close"
                          ? "text-primary"
                          : "text-foreground/50",
                    )}
                  >
                    {isMastered ? "mastered" : reading}
                  </dd>
                </div>
              </dl>
            </div>

            {/* Quick Link to Encyclopedia */}
            <div className="flex items-center justify-between">
              <Link
                href={`/library/${mudra.slug}`}
                className="mono inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-primary hover:gap-3 transition-all"
              >
                Read full entry in Library
                <ChevronRight className="w-3 h-3" />
              </Link>

              <Link
                href="/practice"
                className="mono text-[10px] uppercase tracking-[0.16em] text-foreground/45 hover:text-foreground transition-colors"
              >
                Choose another mudra
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
