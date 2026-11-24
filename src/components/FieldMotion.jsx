import React, { useEffect, useRef, useState } from 'react'

/**
 * Decorative Override field visualisation: an isometric schematic with two alliance halves,
 * patrolling robot markers, scoring objects and annotated tracking lines.
 *
 * It is deliberately labelled as illustrative. No score, team or match value is drawn from the
 * application, so it can never be mistaken for live tournament data. Everything animates with
 * transforms and opacity only, pauses when offscreen or backgrounded, and freezes under
 * reduced motion.
 */
export default function FieldMotion() {
  const ref = useRef(null)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    const el = ref.current
    const onVisibility = () => setPaused(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    let io = null
    if (el && typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(([entry]) => setPaused(!entry.isIntersecting || document.hidden), { threshold: 0.05 })
      io.observe(el)
    }
    return () => {
      io?.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return (
    <figure className={`field-motion ${paused ? 'is-paused' : ''}`} ref={ref}>
      <svg viewBox="0 0 560 440" className="field-motion-svg" aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id="fm-glow" cx="50%" cy="46%" r="62%">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.20" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="fm-red" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--alliance-red)" stopOpacity="0.22" />
            <stop offset="1" stopColor="var(--alliance-red)" stopOpacity="0.03" />
          </linearGradient>
          <linearGradient id="fm-blue" x1="1" y1="0" x2="0" y2="0">
            <stop offset="0" stopColor="var(--alliance-blue)" stopOpacity="0.22" />
            <stop offset="1" stopColor="var(--alliance-blue)" stopOpacity="0.03" />
          </linearGradient>
        </defs>

        <rect width="560" height="440" fill="url(#fm-glow)" />

        <g className="fm-grid" stroke="var(--line)" strokeWidth="0.6">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <line key={`h${i}`} x1="60" y1={60 + i * 52} x2="500" y2={60 + i * 52} />
          ))}
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <line key={`v${i}`} x1={70 + i * 60} y1="50" x2={70 + i * 60} y2="390" />
          ))}
        </g>

        {/* field diamond */}
        <polygon points="280,112 508,224 280,336 52,224" fill="var(--surface)" fillOpacity="0.55" stroke="var(--line-2)" strokeWidth="1.4" />
        <polygon className="fm-half fm-half-red" points="280,112 52,224 280,336" fill="url(#fm-red)" />
        <polygon className="fm-half fm-half-blue" points="280,112 508,224 280,336" fill="url(#fm-blue)" />
        <line x1="280" y1="112" x2="280" y2="336" stroke="var(--line-2)" strokeWidth="1.2" strokeDasharray="4 5" />

        {/* goals: three per alliance side */}
        <g className="fm-goals" fill="none" strokeWidth="1.4">
          {[
            [214, 143],
            [166, 167],
            [118, 191]
          ].map(([x, y]) => (
            <rect key={`g${x}`} x={x - 11} y={y - 6} width="22" height="12" rx="3" stroke="var(--alliance-red)" opacity="0.85" />
          ))}
          {[
            [346, 143],
            [394, 167],
            [442, 191]
          ].map(([x, y]) => (
            <rect key={`g${x}`} x={x - 11} y={y - 6} width="22" height="12" rx="3" stroke="var(--alliance-blue)" opacity="0.85" />
          ))}
        </g>

        {/* scoring objects */}
        <g className="fm-objects">
          {[
            [206, 176, 0],
            [246, 258, 0.7],
            [310, 178, 1.3],
            [338, 262, 1.9],
            [168, 236, 2.4]
          ].map(([x, y, d]) => (
            <circle key={`o${x}-${y}`} cx={x} cy={y} r="4" fill="var(--accent-hi)" style={{ animationDelay: `${d}s` }} />
          ))}
        </g>

        {/* red robot with a scanning ring */}
        <g className="fm-robot fm-robot-red">
          <circle cx="196" cy="206" r="22" className="fm-scan" fill="none" stroke="var(--alliance-red)" strokeOpacity="0.35" strokeDasharray="3 6" />
          <rect x="184" y="196" width="24" height="17" rx="4" fill="var(--alliance-red)" fillOpacity="0.9" />
          <rect x="186" y="213" width="6" height="4" rx="1.5" fill="var(--alliance-red)" />
          <rect x="200" y="213" width="6" height="4" rx="1.5" fill="var(--alliance-red)" />
          <path d="M196 200l4 4-4 4" fill="none" stroke="var(--bg)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </g>

        {/* blue robot */}
        <g className="fm-robot fm-robot-blue">
          <rect x="352" y="236" width="24" height="17" rx="4" fill="var(--alliance-blue)" fillOpacity="0.9" />
          <rect x="354" y="253" width="6" height="4" rx="1.5" fill="var(--alliance-blue)" />
          <rect x="368" y="253" width="6" height="4" rx="1.5" fill="var(--alliance-blue)" />
          <path d="M364 240l-4 4 4 4" fill="none" stroke="var(--bg)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </g>

        {/* annotations */}
        <g className="fm-notes" stroke="var(--line-2)" strokeWidth="1" strokeDasharray="3 4" fill="none">
          <path d="M214 222c22 18 40 30 62 38" />
          <path d="M348 232c26-14 44-28 62-44" />
        </g>
        <g className="fm-labels">
          <text x="282" y="266" className="fm-label">TRACKING</text>
          <text x="406" y="182" className="fm-label">ALLIANCE</text>
          <text x="64" y="60" className="fm-label fm-label-dim">OVERRIDE FIELD · SCHEMATIC</text>
        </g>

        {[
          [52, 112],
          [508, 112],
          [52, 336],
          [508, 336]
        ].map(([x, y]) => (
          <g key={`c${x}-${y}`} stroke="var(--line-2)" strokeWidth="1" opacity="0.7">
            <line x1={x - 6} y1={y} x2={x + 6} y2={y} />
            <line x1={x} y1={y - 6} x2={x} y2={y + 6} />
          </g>
        ))}
      </svg>
      <figcaption>Schematic field geometry. Illustrative only — never live match data.</figcaption>
    </figure>
  )
}
