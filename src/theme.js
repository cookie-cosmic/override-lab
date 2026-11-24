import { useEffect, useState } from 'react'

// Three preferences: light, dark, or follow the operating system. The chosen preference is
// stored, while the resolved skin is applied as data-theme on <html> so the token layer does
// the rest — no component knows which theme is active.
export const THEMES = [
  { id: 'light', label: 'Light', icon: 'sun' },
  { id: 'dark', label: 'Dark', icon: 'moon' },
  { id: 'system', label: 'System', icon: 'monitor' }
]

const KEY = 'override-lab:theme'
const META = { light: '#f4f6fb', dark: '#0b0f16' }

const media = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null)

export function resolveTheme(preference) {
  if (preference === 'light' || preference === 'dark') return preference
  return media()?.matches ? 'light' : 'dark'
}

export function getTheme() {
  try {
    const stored = localStorage.getItem(KEY)
    if (THEMES.some((t) => t.id === stored)) return stored
  } catch {
    /* private mode: fall through to the default */
  }
  return 'dark'
}

export function applyTheme(preference) {
  const choice = THEMES.some((t) => t.id === preference) ? preference : 'system'
  const resolved = resolveTheme(choice)
  document.documentElement.dataset.theme = resolved
  document.documentElement.dataset.themePreference = choice
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', META[resolved] || META.dark)
  return resolved
}

export function saveTheme(preference) {
  const choice = THEMES.some((t) => t.id === preference) ? preference : 'system'
  applyTheme(choice)
  try {
    localStorage.setItem(KEY, choice)
  } catch {
    /* the preference simply will not persist */
  }
  return choice
}

export function useTheme() {
  const [theme, setThemeState] = useState(getTheme)

  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'system' || !media()) return undefined
    const mq = media()
    const onChange = () => applyTheme('system')
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [theme])

  return [theme, (next) => setThemeState(saveTheme(next))]
}
