import { useEffect, useState } from 'react'

// Three skins: the light dashboard, a dark counterpart, and a translucent glass one.
// The choice lives in localStorage and is applied as data-theme on <html> so the CSS
// token layer does the rest — no component knows which theme is active.
export const THEMES = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'glass', label: 'Glass' }
]

const KEY = 'override-lab:theme'
const META = { light: '#f4f6fb', dark: '#0b0f16', glass: '#e7eeff' }

export function getTheme() {
  try {
    const stored = localStorage.getItem(KEY)
    if (THEMES.some((t) => t.id === stored)) return stored
  } catch {
    /* private mode: fall through to the default */
  }
  return 'light'
}

export function applyTheme(id) {
  const theme = THEMES.some((t) => t.id === id) ? id : 'light'
  document.documentElement.dataset.theme = theme
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', META[theme] || META.light)
  return theme
}

export function saveTheme(id) {
  const theme = applyTheme(id)
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* the theme simply will not persist */
  }
  return theme
}

export function useTheme() {
  const [theme, setTheme] = useState(getTheme)
  useEffect(() => {
    applyTheme(theme)
  }, [theme])
  return [theme, (next) => setTheme(saveTheme(next))]
}
