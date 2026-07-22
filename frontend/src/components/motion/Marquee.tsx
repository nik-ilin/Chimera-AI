/**
 * Seamless looping marquee (pure CSS). Two identical tracks translate -50% for
 * a gapless loop; pauses on hover. Motion honoured via globals reduced-motion.
 * Presentation only.
 */
interface MarqueeProps {
  items: string[];
  className?: string;
  slow?: boolean;
}

export default function Marquee({ items, className = "", slow = false }: MarqueeProps) {
  return (
    <div className={`group/marquee overflow-hidden ${className}`}>
      <div className={`marquee ${slow ? "marquee-slow" : ""}`}>
        {[0, 1].map((dup) => (
          <div key={dup} className="flex shrink-0" aria-hidden={dup === 1}>
            {items.map((item, i) => (
              <span key={i} className="flex items-center">
                <span className="font-editorial text-2xl sm:text-3xl text-foreground/80">
                  {item}
                </span>
                <span className="mx-7 text-chimera-clay/70 text-lg">✳</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
