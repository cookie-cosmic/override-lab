import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { applyTheme, getTheme } from './theme.js'
import './styles.css'
import './styles-platform.css'
import './styles-redesign.css'

// Apply the stored theme before the first paint so the app never flashes the wrong skin.
applyTheme(getTheme())

createRoot(document.getElementById('root')).render(<App />)
