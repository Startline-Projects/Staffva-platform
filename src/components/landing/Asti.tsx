/**
 * Asti — the gamification mascot: the brand asterisk with a face.
 *
 * House rules (from the mascot spec):
 *  - candidate-side only: onboarding, trackers, waiting rooms, lockouts —
 *    never the client side, never near money, never in the logo lockup;
 *  - one spin per completion, no idle dancing everywhere — celebration
 *    means something because it's rare;
 *  - prefers-reduced-motion turns the animation off (handled in CSS).
 */

const LIME = "#D6F24D";
const INK = "#0E0E0C";
const GRAY = "#B7B2A6";

type AstiVariant = "idle" | "spin" | "rest" | "celebrate";

function AstiBody({ variant }: { variant: AstiVariant }) {
  const fill = variant === "rest" ? GRAY : LIME;
  const outlined = variant !== "rest";
  return (
    <>
      <g fill={fill} stroke={outlined ? INK : undefined} strokeWidth={outlined ? 3 : undefined}>
        <rect x="52" y="8" width="16" height="104" rx="8" />
        <rect x="52" y="8" width="16" height="104" rx="8" transform="rotate(60 60 60)" />
        <rect x="52" y="8" width="16" height="104" rx="8" transform="rotate(120 60 60)" />
      </g>
      <circle cx="60" cy="60" r="19" fill={fill} stroke={outlined ? INK : undefined} strokeWidth={outlined ? 3 : undefined} />
      {variant === "idle" && (
        <>
          <circle cx="53" cy="57" r="3.4" fill={INK} />
          <circle cx="67" cy="57" r="3.4" fill={INK} />
          <path d="M53 67 Q60 73 67 67" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
        </>
      )}
      {variant === "spin" && (
        <>
          <path d="M49 57 Q53 53 57 57 M63 57 Q67 53 71 57" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
          <path d="M52 66 Q60 75 68 66" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
        </>
      )}
      {variant === "rest" && (
        <>
          <path d="M49 59 Q53 62 57 59 M63 59 Q67 62 71 59" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
          <text x="88" y="30" fontFamily="var(--font-mono), monospace" fontSize="14" fill="#6B6860">z</text>
          <text x="98" y="18" fontFamily="var(--font-mono), monospace" fontSize="11" fill="#6B6860">z</text>
        </>
      )}
      {variant === "celebrate" && (
        <>
          <path d="M50 54 l3.5 2.5 l3.5 -2.5 l-1.3 4 l3.3 2.6 l-4.2 0 l-1.3 4 l-1.3 -4 l-4.2 0 l3.3 -2.6 Z" fill={INK} transform="scale(0.9) translate(6 2)" />
          <path d="M64 54 l3.5 2.5 l3.5 -2.5 l-1.3 4 l3.3 2.6 l-4.2 0 l-1.3 4 l-1.3 -4 l-4.2 0 l3.3 -2.6 Z" fill={INK} transform="scale(0.9) translate(6 2)" />
          <path d="M52 70 Q60 78 68 70" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
          <g fill="#B9D92F">
            <circle cx="16" cy="24" r="4" /><circle cx="104" cy="18" r="3" /><circle cx="106" cy="96" r="4" /><circle cx="12" cy="92" r="3" />
          </g>
        </>
      )}
    </>
  );
}

export default function Asti({
  variant = "idle",
  size = 120,
  animate = true,
  className = "",
}: {
  variant?: AstiVariant;
  size?: number;
  /** idle floats, spin does its one spin-pop; false renders static */
  animate?: boolean;
  className?: string;
}) {
  const anim = !animate ? "" : variant === "idle" ? "asti-floaty" : variant === "spin" ? "asti-spinning" : "";
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" className={`${anim} ${className}`.trim()} aria-hidden>
      <AstiBody variant={variant} />
    </svg>
  );
}

/** The faceless mini asterisk as the point unit: "+25 english test passed". */
export function AstiPointChip({ label }: { label: string }) {
  return (
    <span className="xp-pill">
      <svg width="16" height="16" viewBox="0 0 120 120" aria-hidden>
        <g fill={LIME}>
          <rect x="50" y="4" width="20" height="112" rx="10" />
          <rect x="50" y="4" width="20" height="112" rx="10" transform="rotate(60 60 60)" />
          <rect x="50" y="4" width="20" height="112" rx="10" transform="rotate(120 60 60)" />
        </g>
      </svg>
      {label}
    </span>
  );
}

/** Asti with a progress ring — the tracker header state (ratio 0..1). */
export function AstiProgressRing({ ratio, size = 140 }: { ratio: number; size?: number }) {
  const C = 2 * Math.PI * 62;
  const clamped = Math.max(0, Math.min(1, ratio));
  return (
    <svg width={size} height={size} viewBox="0 0 140 140" aria-hidden>
      <circle cx="70" cy="70" r="62" fill="none" stroke="#E5DECF" strokeWidth="9" />
      <circle
        cx="70" cy="70" r="62" fill="none" stroke={LIME} strokeWidth="9" strokeLinecap="round"
        strokeDasharray={C} strokeDashoffset={C * (1 - clamped)} transform="rotate(-90 70 70)"
      />
      <g transform="translate(70 70) scale(0.62) translate(-60 -60)">
        <AstiBody variant="idle" />
      </g>
    </svg>
  );
}
