import React, { useId } from 'react'

/**
 * Override Lab mark: a hexagonal field ring around a rotated alliance square, with a chevron
 * cutting through it — the "override". Drawn as geometry rather than a font so it stays crisp at
 * 16px (favicon) and 64px (loading screen).
 */
export function BrandMark({ size = 32, className = '', title = 'Override Lab' }) {
  // Gradient ids must be unique: the mark appears in the header, sidebar and footer at once.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const ring = `ol-ring-${uid}`
  const square = `ol-square-${uid}`
  return (
    <svg
      className={`brand-glyph ${className}`}
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role="img"
      aria-label={title}
      fill="none"
    >
      <defs>
        <linearGradient id={ring} x1="6" y1="4" x2="34" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--accent-hi, #A3C7FF)" />
          <stop offset="1" stopColor="var(--accent, #739CFF)" />
        </linearGradient>
        <linearGradient id={square} x1="12" y1="30" x2="30" y2="10" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--accent-2, #9686F5)" />
          <stop offset="1" stopColor="var(--accent-hi, #A3C7FF)" />
        </linearGradient>
      </defs>
      {/* hexagon field ring */}
      <path
        className="brand-ring"
        d="M20 3.2 34.2 11.4v17L20 36.8 5.8 28.4v-17L20 3.2Z"
        stroke={`url(#${ring})`}
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      {/* rotated alliance square */}
      <path d="M20 10.4 28.4 20 20 29.6 11.6 20 20 10.4Z" fill={`url(#${square})`} fillOpacity="0.18" />
      <path
        className="brand-square"
        d="M20 10.4 28.4 20 20 29.6 11.6 20 20 10.4Z"
        stroke={`url(#${square})`}
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {/* override chevron */}
      <path className="brand-chevron" d="M14.6 16.4 20 21.8l5.4-5.4" stroke="var(--accent-hi, #A3C7FF)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="20" cy="20" r="1.5" fill="var(--accent-hi, #A3C7FF)" />
    </svg>
  )
}

export default function Brand({ size = 32, compact = false, className = '' }) {
  return (
    <span className={`brand-lockup ${compact ? 'compact' : ''} ${className}`}>
      <BrandMark size={size} />
      {!compact && (
        <span className="brand-lockup-text">
          <span className="brand-lockup-name">
            Override<span className="brand-lockup-lab">Lab</span>
          </span>
          <span className="brand-lockup-tag">Competition intelligence</span>
        </span>
      )}
    </span>
  )
}
