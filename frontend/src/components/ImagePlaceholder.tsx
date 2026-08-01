/**
 * ImagePlaceholder — a clearly-marked neutral box standing in for imagery that
 * will be generated later. See IMAGE_MANIFEST.md for every id and its spec.
 *
 * One-line swap when the real asset exists: pass `src` (e.g. drop the PNG into
 * frontend/public/images/<id>.png and set src="/images/<id>.png"). Until then
 * it renders a labelled placeholder with fixed dimensions / aspect ratio so the
 * layout is already correct.
 *
 * Presentation only — no data flow.
 */
import type { CSSProperties } from "react";

interface ImagePlaceholderProps {
  /** Stable id used in IMAGE_MANIFEST.md and the default asset path. */
  id: string;
  /** Aspect ratio, e.g. "16/10", "1/1", "4/3". Preferred over fixed w/h. */
  aspect?: string;
  /** Optional intrinsic size hints (used for the label + as a fallback box). */
  w?: number;
  h?: number;
  /** One-line description of what image belongs here. */
  note?: string;
  /** When the real asset exists: e.g. "/images/landing-hero.png". */
  src?: string;
  /** Tailwind rounding token (defaults to widget radius). */
  rounded?: string;
  className?: string;
}

export default function ImagePlaceholder({
  id,
  aspect = "16/10",
  w,
  h,
  note,
  src,
  rounded = "rounded-widget",
  className = "",
}: ImagePlaceholderProps) {
  const style: CSSProperties = aspect
    ? { aspectRatio: aspect.replace("/", " / ") }
    : { width: w, height: h };

  if (src) {
    return (
      <div style={style} className={`${rounded} relative w-full overflow-hidden ${className}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={note ?? id}
          className="absolute inset-0 w-full h-full object-cover"
        />
      </div>
    );
  }

  return (
    <div
      style={style}
      data-image-placeholder={id}
      className={`${rounded} ${className} relative w-full overflow-hidden border border-border/70 flex items-center justify-center select-none`}
    >
      {/* soft warm wash — no hard lines */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 120% at 20% 15%, hsl(var(--chimera-clay) / 0.10), transparent 55%), radial-gradient(120% 120% at 90% 95%, hsl(var(--chimera-plum) / 0.08), transparent 55%), hsl(var(--chimera-sand) / 0.5)",
        }}
      />
      <div className="relative text-center px-4 py-3">
        <div className="u-label text-foreground/50 mb-1.5">image · {id}</div>
        {note && (
          <p className="text-[11px] leading-snug text-foreground/45 max-w-[22ch] mx-auto">
            {note}
          </p>
        )}
        {(aspect || (w && h)) && (
          <div className="mt-1.5 text-[10px] font-mono text-foreground/35">
            {aspect ? aspect : `${w}×${h}`}
          </div>
        )}
      </div>
    </div>
  );
}
