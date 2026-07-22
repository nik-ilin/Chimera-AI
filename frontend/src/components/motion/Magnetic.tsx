"use client";
/**
 * Magnetic hover — the element eases toward the cursor while hovered, then
 * springs back. Disabled under reduced-motion. Presentation only.
 */
import { useRef, type ReactNode, type PointerEvent } from "react";

interface MagneticProps {
  children: ReactNode;
  /** 0.1–0.4 is tasteful */
  strength?: number;
  className?: string;
}

export default function Magnetic({ children, strength = 0.28, className = "" }: MagneticProps) {
  const ref = useRef<HTMLDivElement>(null);

  function onMove(e: PointerEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - (r.left + r.width / 2)) * strength;
    const y = (e.clientY - (r.top + r.height / 2)) * strength;
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }
  function onLeave() {
    if (ref.current) ref.current.style.transform = "";
  }

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className={`inline-block ${className}`}
      style={{ transition: "transform 0.4s var(--ease-spring)" }}
    >
      {children}
    </div>
  );
}
