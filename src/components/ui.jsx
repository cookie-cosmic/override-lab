import React from 'react'

export function Card({ title, subtitle, right, children, flush = false, className = '', id }) {
  return (
    <section className={`card ${className}`} id={id}>
      {(title || right) && (
        <header className="card-h">
          {title && <h2>{title}</h2>}
          {subtitle && <span className="sub">{subtitle}</span>}
          {right && <div className="right">{right}</div>}
        </header>
      )}
      <div className={`card-b ${flush ? 'flush' : ''}`}>{children}</div>
    </section>
  )
}

export function Stat({ label, value, sub, tone }) {
  return (
    <div className="stat">
      <div className="l">{label}</div>
      <div className="v" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
      {sub && <div className="s">{sub}</div>}
    </div>
  )
}

export function Badge({ tone = '', children }) {
  return <span className={`badge ${tone}`}>{children}</span>
}

export function Chip({ tone = '', children, title }) {
  return (
    <span className={`chip ${tone}`} title={title}>
      {children}
    </span>
  )
}

export function TeamTag({ team, onClick, side }) {
  if (!team) return <span className="dim">—</span>
  return (
    <span
      className="team-link"
      onClick={(e) => {
        e.stopPropagation()
        onClick && onClick(team)
      }}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {team}
    </span>
  )
}

export function Table({ head = [], children, clickable = false, className = '', wrap = true, maxHeight }) {
  const body = (
    <table className={`table ${clickable ? 'clickable' : ''} ${className}`}>
      <thead>
        <tr>
          {head.map((h, i) => {
            const conf = typeof h === 'string' ? { label: h } : h
            return (
              <th key={i} className={conf.cls || ''}>
                {conf.label}
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  )
  if (!wrap) return body
  return (
    <div className="table-wrap" style={maxHeight ? { maxHeight } : undefined}>
      {body}
    </div>
  )
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button key={t.id} className={`tab ${active === t.id ? 'active' : ''}`} onClick={() => onChange(t.id)} type="button">
          {t.label}
          {t.count != null && <span className="dim"> {t.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Btn({ children, onClick, variant = '', size = '', type = 'button', disabled, title }) {
  return (
    <button className={`btn ${variant} ${size}`} onClick={onClick} type={type} disabled={disabled} title={title}>
      {children}
    </button>
  )
}

export function Field({ label, hint, children }) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
}

export function Note({ tone = '', children }) {
  return <div className={`note ${tone}`}>{children}</div>
}

export function Loading({ label = 'Loading…' }) {
  return <div className="loading">{label}</div>
}

export function ErrorBox({ error, onRetry }) {
  return (
    <div className="error">
      {String(error)}
      {onRetry && (
        <div style={{ marginTop: 8 }}>
          <Btn size="sm" onClick={onRetry}>
            Retry
          </Btn>
        </div>
      )}
    </div>
  )
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>
}

export function KV({ items }) {
  return (
    <div className="kv">
      {items.map((it, i) => (
        <React.Fragment key={i}>
          <span className="k">{it.k}</span>
          <span className="v">{it.v}</span>
        </React.Fragment>
      ))}
    </div>
  )
}

export function ProbBar({ value, label }) {
  const p = Math.max(0, Math.min(1, Number(value) || 0))
  return (
    <div>
      {label && (
        <div className="row tiny" style={{ marginBottom: 3 }}>
          <span className="muted">{label}</span>
          <span className="spacer" />
          <span className="mono">{(p * 100).toFixed(1)}%</span>
        </div>
      )}
      <div className="prob">
        <span style={{ width: `${p * 100}%` }} />
      </div>
    </div>
  )
}

export function Claims({ claims }) {
  if (!claims?.length) return null
  return (
    <div>
      {claims.map((c, i) => (
        <div className="claim" key={i}>
          <span className="text">{c.text}</span>
          <span className="conf">{c.confidence}</span>
        </div>
      ))}
    </div>
  )
}

export function Prose({ paragraphs }) {
  if (!paragraphs?.length) return null
  return (
    <div className="prose">
      {paragraphs.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  )
}
