import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { applyTheme, getTheme } from './theme.js'
import './styles.css'
import './styles-platform.css'
import './styles-redesign.css'
import './styles-workspace.css'

// Apply the stored theme before the first paint so the app never flashes the wrong skin.
applyTheme(getTheme())

createRoot(document.getElementById('root')).render(<App />)

// The service worker only caches the app shell. It never caches /api responses, so private team
// data is not written into a shared cache.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* installability simply stays unavailable */
    })
  })
}
