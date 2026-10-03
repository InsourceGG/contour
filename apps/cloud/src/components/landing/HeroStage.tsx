"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { StageView } from "./StageView";
import { CHAPTERS, CHAPTER_START, PROMPTS, STEPS } from "./steps";
import s from "./hero-stage.module.css";

const REDUCE = "(prefers-reduced-motion: reduce)";
function subscribeReduce(cb: () => void) {
  const mq = window.matchMedia(REDUCE);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const useReducedMotion = () => useSyncExternalStore(subscribeReduce, () => window.matchMedia(REDUCE).matches, () => false);

const chapterDuration = CHAPTERS.map((_, c) => STEPS.filter((st) => st.chapter === c).reduce((sum, st) => sum + st.duration, 0));
const offsetInChapter = STEPS.map((st, i) => STEPS.slice(0, i).filter((p) => p.chapter === st.chapter).reduce((sum, p) => sum + p.duration, 0));

/** Types the prompt one character at a time while a typing step is active. */
function useTyped(text: string, active: boolean, running: boolean, total: number) {
  const [count, setCount] = useState(text.length);
  const [prevText, setPrevText] = useState(text);
  const [prevActive, setPrevActive] = useState(active);
  if (text !== prevText || active !== prevActive) {
    setPrevText(text);
    setPrevActive(active);
    setCount(active ? 0 : text.length);
  }
  useEffect(() => {
    if (!active || !running || count >= text.length) return;
    const per = Math.max(24, Math.min(60, (total - 700) / text.length));
    const t = window.setTimeout(() => setCount((n) => n + 1), per);
    return () => window.clearTimeout(t);
  }, [active, running, count, text, total]);
  return text.slice(0, count);
}

export function HeroStage({ stageClassName, chaptersClassName, pauseClassName }: { stageClassName: string; chaptersClassName: string; pauseClassName: string }) {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [nonce, setNonce] = useState(0);
  const [paused, setPaused] = useState(false);
  const [inView, setInView] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);
  const stageRef = useRef<HTMLDivElement>(null);
  const barRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const remaining = useRef<{ index: number; ms: number } | null>(null);

  const running = !paused && inView && pageVisible && !reduced;
  const step = STEPS[index];

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    const onVis = () => setPageVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => { io.disconnect(); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  // Step clock, resumable from where it was paused.
  useEffect(() => {
    if (!running) return;
    const left = remaining.current?.index === index ? remaining.current.ms : STEPS[index].duration;
    remaining.current = null;
    const started = performance.now();
    let fired = false;

    const chapter = STEPS[index].chapter;
    const total = chapterDuration[chapter];
    const from = (offsetInChapter[index] + STEPS[index].duration - left) / total;
    const to = (offsetInChapter[index] + STEPS[index].duration) / total;
    barRefs.current.forEach((b) => b?.getAnimations().forEach((a) => a.cancel()));
    const bar = barRefs.current[chapter];
    const anim = bar?.animate([{ transform: `scaleX(${from})` }, { transform: `scaleX(${to})` }], { duration: left, easing: "linear", fill: "forwards" });

    const t = window.setTimeout(() => {
      fired = true;
      setIndex((i) => (i + 1) % STEPS.length);
    }, left);
    return () => {
      window.clearTimeout(t);
      anim?.pause();
      if (!fired) remaining.current = { index, ms: Math.max(0, left - (performance.now() - started)) };
    };
  }, [index, running, nonce]);

  const jump = useCallback((chapter: number) => {
    remaining.current = null;
    setIndex(CHAPTER_START[chapter]);
    setNonce((n) => n + 1);
  }, []);

  const typed = useTyped(step.prompt ? PROMPTS[step.prompt] : "", !!step.typing, running, step.duration);

  return (
    <>
      <div className={stageClassName} ref={stageRef} aria-hidden="true">
        <StageView step={step} typed={step.prompt ? typed : undefined} stepIndex={index} className={s.live} />
      </div>
      <div className={`${chaptersClassName} ${s.chapters}`}>
        <ol className={s.list}>
          {CHAPTERS.map((c, i) => {
            const active = step.chapter === i;
            return (
              <li key={c.title} className={s.item} data-active={active ? "true" : undefined}>
                <button type="button" className={s.jump} onClick={() => jump(i)} aria-current={active ? "step" : undefined}>
                  <span className={s.num} aria-hidden="true">{i + 1}</span>
                  <span className={s.title}>{c.title}</span>
                </button>
                <span className={s.track} aria-hidden="true"><span className={s.fill} ref={(el) => { barRefs.current[i] = el; }} /></span>
                {active ? <p key={index} className={s.caption} aria-hidden="true">{step.caption}</p> : null}
              </li>
            );
          })}
        </ol>
      </div>
      <button type="button" className={`${pauseClassName} ${s.pause}`} onClick={() => setPaused((p) => !p)}>
        <span className={s.pauseIcon} data-paused={paused ? "true" : undefined} aria-hidden="true" />
        {paused ? "Play animation" : "Pause animation"}
      </button>
    </>
  );
}
