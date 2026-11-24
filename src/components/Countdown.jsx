import { useEffect, useMemo, useState } from 'react'

const pad = (n) => String(Math.max(0, Math.floor(n))).padStart(2, '0')

/**
 * Live countdown to an ISO timestamp. Each digit is its own element keyed by its value, so only
 * the digits that change animate — the card never reflows as the clock ticks.
 *
 * It is a timer, not decoration: it keeps ticking under reduced motion (the motion preference
 * only removes the slide animation, see styles-design.css) and announces a quiet text equivalent
 * to screen readers instead of reading every tick.
 */
export default function Countdown({ to, expired = 'Starting now', className = '' }) {
  const target = useMemo(() => {
    if (!to) return NaN
    const t = Date.parse(to)
    return Number.isNaN(t) ? NaN : t
  }, [to])
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!Number.isFinite(target)) return undefined
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [target])

  if (!Number.isFinite(target)) return <span className={`countdown is-over ${className}`}>time not published</span>

  const left = target - now
  if (left <= 0) return <span className={`countdown is-over ${className}`}>{expired}</span>

  const total = Math.floor(left / 1000)
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const groups = days > 0
    ? [[days, 'days'], [hours, 'hrs'], [minutes, 'min'], [seconds, 'sec']]
    : [[hours, 'hrs'], [minutes, 'min'], [seconds, 'sec']]
  const SINGULAR = { days: 'day', hrs: 'hr', min: 'min', sec: 'sec' }
  const spoken = groups.map(([v, unit]) => `${v} ${v === 1 ? SINGULAR[unit] : unit}`).join(' ')

  return (
    <span className={`countdown ${className}`} role="timer">
      <span className="sr-only">{spoken} remaining</span>
      <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 8 }}>
        {groups.map(([value, unit], gi) => (
          <span key={unit} className="count-group">
            <span className="count-digits">
              {pad(value).split('').map((ch, i) => (
                <span key={`${i}-${ch}`} className="count-digit">
                  <span>{ch}</span>
                </span>
              ))}
            </span>
            <span className="count-unit">{unit}</span>
            {gi < groups.length - 1 && <span className="count-sep">:</span>}
          </span>
        ))}
      </span>
    </span>
  )
}
