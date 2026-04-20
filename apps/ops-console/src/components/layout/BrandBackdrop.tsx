import { cn } from "@/components/ui/utils"

type Variant = "auth" | "workspace"

const BRAND_COLORS = [
  "#FACC15",
  "#8B5CF6",
  "#3B82F6",
  "#EC4899",
  "#A3E635",
  "#F97316",
  "#6366F1",
  "#EF4444",
  "#14B8A6",
]

interface BrandBackdropProps {
  variant: Variant
}

/**
 * Decorative full-screen brand pattern.
 *
 * - `auth`     full-strength: 9-cell color grid + brand-grid SVG + black/violet
 *              geometric shapes. The "wow on entry" surface for setup/unlock.
 * - `workspace` faint watermark: brand-grid SVG only, ~3.5% opacity. Sits
 *              behind the working console without competing with cards.
 *
 * The SVG `<pattern>` id is variant-scoped so both can theoretically coexist
 * in the same DOM without collision.
 */
export function BrandBackdrop({ variant }: BrandBackdropProps) {
  const patternId = `brand-grid-${variant}`
  const isAuth = variant === "auth"

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
      {isAuth && (
        <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-40">
          {BRAND_COLORS.map((color, index) => (
            <div key={`${color}-${index}`} style={{ backgroundColor: color }} />
          ))}
        </div>
      )}

      <div className={cn("absolute inset-0", isAuth ? "opacity-20" : "opacity-[0.035]")}>
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id={patternId} x="0" y="0" width="200" height="200" patternUnits="userSpaceOnUse">
              <rect width="200" height="200" fill="none" />
              <rect
                x="0"
                y="0"
                width="200"
                height="200"
                fill="none"
                stroke="#111111"
                strokeWidth="5"
                strokeLinecap="square"
              />
              <g stroke="#111111" strokeWidth="5" fill="none" strokeLinecap="square">
                <line x1="0" y1="0" x2="60" y2="60" />
                <line x1="200" y1="0" x2="140" y2="60" />
                <line x1="0" y1="200" x2="60" y2="140" />
                <line x1="200" y1="200" x2="140" y2="140" />
                <rect x="60" y="60" width="80" height="80" />
                <circle cx="100" cy="100" r="40" />
                <line x1="60" y1="60" x2="140" y2="140" />
                <line x1="140" y1="60" x2="60" y2="140" />
              </g>
              <g
                fill="#111111"
                fontFamily="'Inter', 'Helvetica Neue', Arial, sans-serif"
                fontWeight="900"
                letterSpacing="0.05em"
              >
                <text x="12" y="38" fontSize="22" textAnchor="start">
                  CALL
                </text>
                <text x="188" y="180" fontSize="22" textAnchor="end">
                  ANYTHING
                </text>
              </g>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#${patternId})`} />
        </svg>
      </div>

      {isAuth && (
        <>
          <div className="absolute left-[10%] top-24 h-52 w-64 bg-black/10" />
          <div className="absolute bottom-32 right-[15%] h-60 w-72 bg-black/10 -rotate-6" />
          <div className="absolute top-[42%] right-[8%] h-56 w-56 rounded-full bg-black/10" />
          <div className="absolute bottom-[48%] left-[12%] h-48 w-48 rounded-full bg-black/10" />
          <div className="absolute left-20 top-20 h-64 w-64 rotate-12 bg-[#A3E635]/30" />
          <div className="absolute bottom-20 right-20 h-80 w-80 -rotate-12 bg-[#8B5CF6]/25" />
        </>
      )}
    </div>
  )
}
