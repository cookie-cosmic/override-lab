import React from 'react'

// Dependency-free SVG charts. Tailored to this app's needs rather than general purpose.

const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

export function Line({
  series = [],
  height = 190,
  width = 760,
  xDomain = null,
  yDomain = null,
  yTicks = null,
  zero = null,
  area = false,
  yFormat = (v) => Math.round(v),
  xFormat = (v) => String(Math.round(v)),
  xLabel = '',
  yLabel = '',
  playhead = null,
  onScrub = null,
  markers = []
}) {
  const pad = { l: 46, r: 14, t: 12, b: 24 }
  const iw = width - pad.l - pad.r
  const ih = height - pad.t - pad.b
  const pts = series.flatMap((s) => s.points || [])
  if (!pts.length) return <div className="empty">No series yet</div>

  const xmin = xDomain ? xDomain[0] : Math.min(...pts.map((p) => p.x))
  const xmax = xDomain ? xDomain[1] : Math.max(...pts.map((p) => p.x))
  const ymin = yDomain ? yDomain[0] : Math.min(...pts.map((p) => p.y), 0)
  const ymax = yDomain ? yDomain[1] : Math.max(...pts.map((p) => p.y), 1)
  const sx = (x) => pad.l + ((x - xmin) / (xmax - xmin || 1)) * iw
  const sy = (y) => pad.t + ih - ((y - ymin) / (ymax - ymin || 1)) * ih

  const ticks = yTicks || [0, 0.25, 0.5, 0.75, 1].map((f) => ymin + f * (ymax - ymin))
  const xTicks = 5

  const scrub = (e) => {
    if (!onScrub) return
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = clampNum((e.clientX - rect.left) / rect.width, 0, 1)
    const padFrac = pad.l / width
    const usable = (width - pad.l - pad.r) / width
    const t = (frac - padFrac) / usable
    onScrub(xmin + clampNum(t, 0, 1) * (xmax - xmin))
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height: 'auto', display: 'block', cursor: onScrub ? 'crosshair' : 'default' }}
        onClick={scrub}
        onMouseMove={onScrub ? (e) => e.buttons === 1 && scrub(e) : undefined}
      >
        {ticks.map((t, i) => (
          <g key={`y${i}`}>
            <line x1={pad.l} x2={width - pad.r} y1={sy(t)} y2={sy(t)} stroke="var(--line)" strokeDasharray="2 4" />
            <text x={pad.l - 6} y={sy(t) + 3.5} fill="var(--dim)" fontSize="9.5" textAnchor="end" fontFamily="var(--mono)">
              {yFormat(t)}
            </text>
          </g>
        ))}
        {Array.from({ length: xTicks }, (_, i) => {
          const x = xmin + ((xmax - xmin) * i) / (xTicks - 1)
          return (
            <text key={`x${i}`} x={sx(x)} y={height - 6} fill="var(--dim)" fontSize="9.5" textAnchor="middle" fontFamily="var(--mono)">
              {xFormat(x)}
            </text>
          )
        })}

        {zero != null && <line x1={pad.l} x2={width - pad.r} y1={sy(zero)} y2={sy(zero)} stroke="var(--line-2)" />}

        {series.map((s, si) => {
          const d = (s.points || [])
            .map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`)
            .join(' ')
          const first = s.points?.[0]
          const last = s.points?.[s.points.length - 1]
          return (
            <g key={si}>
              {area && first && last && (
                <path
                  d={`${d} L${sx(last.x).toFixed(1)},${sy(zero ?? ymin).toFixed(1)} L${sx(first.x).toFixed(1)},${sy(zero ?? ymin).toFixed(1)} Z`}
                  fill={s.color || 'var(--blue)'}
                  opacity="0.13"
                />
              )}
              <path d={d} fill="none" stroke={s.color || 'var(--blue)'} strokeWidth={s.width || 1.8} strokeLinejoin="round" />
            </g>
          )
        })}

        {markers.map((m, i) => (
          <circle key={`m${i}`} cx={sx(m.x)} cy={sy(m.y ?? 0)} r={m.r || 3} fill={m.color || 'var(--amber)'} />
        ))}

        {playhead != null && (
          <line x1={sx(playhead)} x2={sx(playhead)} y1={pad.t} y2={pad.t + ih} stroke="var(--amber)" strokeWidth="1.2" strokeDasharray="3 3" />
        )}
        <line x1={pad.l} x2={width - pad.r} y1={pad.t + ih} y2={pad.t + ih} stroke="var(--line-2)" />
      </svg>
      {(series.length > 1 || xLabel || yLabel) && (
        <div className="legend" style={{ marginTop: 6 }}>
          {series.map((s, i) => (
            <span key={i}>
              <span className="dot" style={{ background: s.color || 'var(--blue)' }} />
              {s.label}
            </span>
          ))}
          {xLabel && <span className="dim">{xLabel}</span>}
          {yLabel && <span className="dim">{yLabel}</span>}
        </div>
      )}
    </div>
  )
}

export function Bars({ bins = [], height = 140, width = 620, color = 'var(--blue)', valueKey = 'count', labelKey = 'from', labelEvery = 1 }) {
  if (!bins.length) return <div className="empty">No data</div>
  const pad = { l: 6, r: 6, t: 8, b: 18 }
  const iw = width - pad.l - pad.r
  const ih = height - pad.t - pad.b
  const max = Math.max(...bins.map((b) => b[valueKey] || 0), 1)
  const bw = iw / bins.length
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {bins.map((b, i) => {
        const h = ((b[valueKey] || 0) / max) * ih
        return (
          <g key={i}>
            <rect x={pad.l + i * bw + 1} y={pad.t + ih - h} width={Math.max(1, bw - 2)} height={h} fill={color} opacity={0.75} rx="1.5" />
            {i % labelEvery === 0 && (
              <text x={pad.l + i * bw + bw / 2} y={height - 5} fill="var(--dim)" fontSize="9" textAnchor="middle" fontFamily="var(--mono)">
                {b[labelKey]}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

export function HBars({ items = [], color = 'var(--blue)', unit = '', format = (v) => v }) {
  if (!items.length) return <div className="empty">No data</div>
  const max = Math.max(...items.map((i) => Math.abs(Number(i.value) || 0)), 1)
  return (
    <div>
      {items.map((it, i) => (
        <div className="bar-row" key={i}>
          <span className="mono dim" style={{ textAlign: 'right' }}>
            {it.label}
          </span>
          <span className="track">
            <span className="fill" style={{ width: `${(Math.abs(Number(it.value) || 0) / max) * 100}%`, background: it.color || color }} />
          </span>
          <span className="mono" style={{ textAlign: 'right' }}>
            {format(it.value)}
            {unit}
          </span>
        </div>
      ))}
    </div>
  )
}

export function Radar({ axes = [], size = 230, color = 'var(--blue)' }) {
  if (!axes.length) return <div className="empty">No data</div>
  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - 36
  const n = axes.length
  const angle = (i) => (Math.PI * 2 * i) / n - Math.PI / 2
  // z-scores in roughly [-3, 3] mapped to [0, 1]
  const rad = (v) => r * clampNum(((Number(v) || 0) + 3) / 6, 0.04, 1)
  const point = (i, v) => [cx + Math.cos(angle(i)) * rad(v), cy + Math.sin(angle(i)) * rad(v)]
  const polygon = axes.map((a, i) => point(i, a.value).join(',')).join(' ')
  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: '100%', maxWidth: size, display: 'block', margin: '0 auto' }}>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon
          key={f}
          points={axes.map((_, i) => [cx + Math.cos(angle(i)) * r * f, cy + Math.sin(angle(i)) * r * f].join(',')).join(' ')}
          fill="none"
          stroke="var(--line)"
        />
      ))}
      {axes.map((a, i) => {
        const [x, y] = [cx + Math.cos(angle(i)) * r, cy + Math.sin(angle(i)) * r]
        const [lx, ly] = [cx + Math.cos(angle(i)) * (r + 15), cy + Math.sin(angle(i)) * (r + 15)]
        return (
          <g key={i}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke="var(--line)" />
            <text x={lx} y={ly} fill="var(--dim)" fontSize="8.5" textAnchor="middle" dominantBaseline="middle">
              {a.label}
            </text>
          </g>
        )
      })}
      <polygon points={polygon} fill={color} fillOpacity="0.18" stroke={color} strokeWidth="1.6" />
      {axes.map((a, i) => {
        const [x, y] = point(i, a.value)
        return <circle key={i} cx={x} cy={y} r="2.2" fill={color} />
      })}
    </svg>
  )
}

export function Heat({ teams = [], rows = [], onCell }) {
  if (!teams.length || !rows.length) return <div className="empty">No data</div>
  const cellStyle = (p) => {
    if (p == null) return {}
    const d = p - 0.5
    const alpha = Math.min(0.85, Math.abs(d) * 1.7 + 0.08)
    const color = d >= 0 ? `rgba(75,141,255,${alpha})` : `rgba(255,77,94,${alpha})`
    return { background: color, color: '#eaf1fb' }
  }
  return (
    <div className="scroll-x">
      <table className="table" style={{ width: 'auto', minWidth: '100%' }}>
        <thead>
          <tr>
            <th style={{ position: 'sticky', left: 0, background: 'var(--panel-2)', zIndex: 2 }}>P(row beats col)</th>
            {teams.map((t) => (
              <th key={t} style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', height: 66, padding: '4px 2px' }}>
                {t}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.team}>
              <th style={{ position: 'sticky', left: 0, background: 'var(--panel)', fontWeight: 600, fontSize: 11.5, textAlign: 'left', zIndex: 1 }}>
                {r.team}
              </th>
              {r.cells.map((p, i) => (
                <td
                  key={i}
                  className="heat-cell"
                  style={cellStyle(p)}
                  onClick={() => onCell && p != null && onCell(r.team, teams[i])}
                >
                  {p == null ? '' : Math.round(p * 100)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Spark({ values = [], width = 92, height = 22, color = 'var(--blue)' }) {
  if (!values.length) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const sx = (i) => (i / Math.max(1, values.length - 1)) * width
  const sy = (v) => height - ((v - min) / (max - min || 1)) * (height - 2) - 1
  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width, height, display: 'block' }}>
      <path d={d} fill="none" stroke={color} strokeWidth="1.4" />
    </svg>
  )
}

export function ProbMeter({ value = 0.5, label, width = 140 }) {
  const p = clampNum(Number(value) || 0, 0, 1)
  return (
    <div>
      <div className="row tiny" style={{ marginBottom: 2 }}>
        <span className="muted">{label || 'Win probability'}</span>
        <span className="spacer" />
        <span className="mono">{(p * 100).toFixed(0)}%</span>
      </div>
      <div className="prob" style={{ width }}>
        <span
          style={{
            width: `${p * 100}%`,
            background: p >= 0.5 ? 'linear-gradient(90deg,var(--blue),var(--green))' : 'linear-gradient(90deg,var(--amber),var(--red))'
          }}
        />
      </div>
    </div>
  )
}
