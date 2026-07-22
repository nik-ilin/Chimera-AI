"use client";
/**
 * Living background: a slow warm animated gradient + fine grain (CSS, in
 * globals.css) plus a very subtle cursor-reactive glow. The gradient/grain are
 * pure CSS; this component only nudges the --cursor-x/y vars on pointer move
 * (rAF-throttled). Disabled under prefers-reduced-motion.
 */
import { useEffect } from "react";

export default function LivingBackground() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const root = document.documentElement;
        root.style.setProperty("--cursor-x", `${(e.clientX / window.innerWidth) * 100}%`);
        root.style.setProperty("--cursor-y", `${(e.clientY / window.innerHeight) * 100}%`);
      });
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <>
      <div className="living-bg" aria-hidden />
      <div className="grain" aria-hidden />
    </>
  );
}
