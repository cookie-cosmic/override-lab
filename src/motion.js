import { useEffect, useState } from 'react'

// Central motion preference. "Follow system" is the default: full motion unless the operating
// system asks for reduced motion. The resolved value is applied to <html> as data-motion so the
// stylesheet can switch off decorative animation without every component knowing about it.
export const MOTIONS = [
  { id: 'full', label: 'Full motion', note: 'Ambient field animation, entrances and chart transitions.' },
  { id: 'reduced', label: 'Reduced motion', note: 'No decorative movement. Feedback stays instant.' },
  { id: 'system', label: 'Follow system', note: 'Matches your operating system setting.' }
]

const KEY = 'override-lab:motion'
const media = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null)

export const systemReduced = () => Boolean(media()?.matches)

export function getMotion() {
  try {
    const stored = localStorage.getItem(KEY)
    if (MOTIONS.some((m) => m.id === stored)) return stored
  } catch {
    /* private mode: fall back to the system setting */
  }
  return 'system'
}

export function motionAllowed(preference) {
  if (preference === 'reduced') return false
  if (preference === 'full') return true
  return !systemReduced()
}

export function applyMotion(preference) {
  const choice = MOTIONS.some((m) => m.id === preference) ? preference : 'system'
  const allowed = motionAllowed(choice)
  document.documentElement.dataset.motion = allowed ? 'full' : 'reduced'
  document.documentElement.dataset.motionPreference = choice
  return allowed
}

export function saveMotion(preference) {
  const choice = MOTIONS.some((m) => m.id === preference) ? preference : 'system'
  applyMotion(choice)
  try {
    localStorage.setItem(KEY, choice)
  } catch {
    /* the preference simply will not persist */
  }
  return choice
}

export function useMotion() {
  const [preference, setPreference] = useState(getMotion)

  useEffect(() => {
    const allowed = applyMotion(preference)
    const mq = media()
    if (preference !== 'system' || !mq) return undefined
    const onChange = () => applyMotion('system')
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [preference])

  return [preference, (next) => setPreference(saveMotion(next)), motionAllowed(preference)]
}
