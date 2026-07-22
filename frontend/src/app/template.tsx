/**
 * Route template — re-mounts on every navigation, so the entrance animation
 * replays for a refined page transition. Reduced-motion is honoured via the
 * global media query (which neutralises .page-enter's animation).
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
