import { useState, useEffect } from 'react'

const KEY = 'berth_theme'

// Components that paint to a canvas cannot read CSS variables reactively, so
// they subscribe here and redraw when the theme changes.
const listeners = new Set()

export function getTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

// Called before the first render so a stored light theme does not flash dark.
export function applyStoredTheme() {
  const stored = localStorage.getItem(KEY)
  document.documentElement.dataset.theme = stored === 'light' ? 'light' : 'dark'
}

export function setTheme(theme) {
  document.documentElement.dataset.theme = theme
  localStorage.setItem(KEY, theme)
  listeners.forEach(fn => fn(theme))
}

export function useTheme() {
  const [theme, setLocal] = useState(getTheme)
  useEffect(() => {
    listeners.add(setLocal)
    return () => listeners.delete(setLocal)
  }, [])
  return theme
}
