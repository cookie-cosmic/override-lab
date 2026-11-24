import React, { useEffect, useId, useRef, useState } from 'react'

/**
 * A small question-mark control that explains a metric in plain language.
 *
 * Works with hover, keyboard (Enter/Space/Escape) and touch. Short by default, with optional
 * detail behind a second disclosure so beginners are not handed a wall of statistics.
 */
export default function Help({ label, children, detail, align = 'start' }) {
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  const id = useId()

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => box.current && !box.current.contains(e.target) && setOpen(false)
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span className={`help ${open ? 'open' : ''}`} ref={box}>
      <button
        type="button"
        className="help-btn"
        aria-label={label ? `About ${label}` : 'More information'}
        aria-expanded={open}
        aria-controls={id}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        ?
      </button>
      {open && (
        <span className={`help-pop ${align}`} id={id} role="dialog" aria-label={label || 'Explanation'}>
          {label && <strong>{label}</strong>}
          <span className="help-text">{children}</span>
          {detail && (
            <details className="help-detail">
              <summary>More detail</summary>
              <p>{detail}</p>
            </details>
          )}
        </span>
      )}
    </span>
  )
}
