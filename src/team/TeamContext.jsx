import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  emptyProfile,
  loadProfile,
  makeTeamRecord,
  normalizeTeamNumber,
  readTeamData,
  saveProfile,
  writeTeamData,
  PROFILE_STORAGE_KEY
} from './store.js'

const TeamContext = createContext(null)

/**
 * The single source of personalization for the whole app.
 *
 * Everything team-scoped reads `active.number`. Views never read localStorage directly for
 * team work; they go through `useTeamStore`, which re-reads when the active team changes so a
 * switch cannot show the previous team's data even for one render.
 */
export function TeamProvider({ children }) {
  const [profile, setProfile] = useState(loadProfile)
  const dirty = useRef(null)

  useEffect(() => {
    saveProfile(profile)
  }, [profile])

  // Another tab changing the active team should not leave this one showing a stale context.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== PROFILE_STORAGE_KEY) return
      setProfile(loadProfile())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const active = useMemo(
    () => profile.teams.find((t) => t.number === profile.active) || null,
    [profile.teams, profile.active]
  )

  const update = useCallback((fn) => {
    setProfile((prev) => {
      const next = typeof fn === 'function' ? fn(prev) : fn
      return {
        ...emptyProfile(),
        ...next,
        prefs: { ...emptyProfile().prefs, ...(next.prefs || {}) }
      }
    })
  }, [])

  const addTeam = useCallback(
    (record) => {
      const clean = makeTeamRecord(record)
      update((prev) => {
        const existing = prev.teams.find((t) => t.number === clean.number)
        const teams = existing
          ? prev.teams.map((t) => (t.number === clean.number ? { ...t, ...clean, favorite: t.favorite } : t))
          : [...prev.teams, clean]
        return {
          ...prev,
          teams,
          active: clean.number,
          defaultTeam: prev.defaultTeam || clean.number,
          createdAt: prev.createdAt || new Date().toISOString()
        }
      })
      return clean.number
    },
    [update]
  )

  const patchTeam = useCallback(
    (number, patch) => {
      update((prev) => ({
        ...prev,
        teams: prev.teams.map((t) => (t.number === number ? { ...t, ...patch } : t))
      }))
    },
    [update]
  )

  const removeTeam = useCallback(
    (number) => {
      update((prev) => {
        const teams = prev.teams.filter((t) => t.number !== number)
        const fallback = prev.defaultTeam !== number && prev.teams.some((t) => t.number === prev.defaultTeam) ? prev.defaultTeam : teams[0]?.number || null
        return {
          ...prev,
          teams,
          active: prev.active === number ? fallback : prev.active,
          defaultTeam: prev.defaultTeam === number ? fallback : prev.defaultTeam
        }
      })
    },
    [update]
  )

  /**
   * Switching is blocked by the calling view when it has unsaved work: passing `dirtyLabel`
   * asks first. Nothing is ever silently thrown away.
   */
  const switchTeam = useCallback(
    (number) => {
      const target = normalizeTeamNumber(number)
      if (!profile.teams.some((t) => t.number === target)) return false
      if (dirty.current && dirty.current.team !== target) {
        const ok = window.confirm(`You have unsaved work in ${dirty.current.label}. Switch team and discard it?`)
        if (!ok) return false
      }
      dirty.current = null
      update((prev) => ({ ...prev, active: target }))
      return true
    },
    [profile.teams, update]
  )

  const setDefaultTeam = useCallback(
    (number) => update((prev) => ({ ...prev, defaultTeam: normalizeTeamNumber(number) })),
    [update]
  )

  const setPref = useCallback(
    (patch) => update((prev) => ({ ...prev, prefs: { ...prev.prefs, ...patch } })),
    [update]
  )

  /** Views with an in-progress form call this; switching asks before discarding. */
  const markDirty = useCallback((label, team) => {
    dirty.current = { label, team }
  }, [])
  const clearDirty = useCallback(() => {
    dirty.current = null
  }, [])

  const value = useMemo(
    () => ({
      profile,
      teams: profile.teams,
      active,
      activeNumber: active?.number || null,
      prefs: profile.prefs,
      hasTeams: profile.teams.length > 0,
      addTeam,
      patchTeam,
      removeTeam,
      switchTeam,
      setDefaultTeam,
      setPref,
      markDirty,
      clearDirty,
      reset: () => update(emptyProfile())
    }),
    [profile, active, addTeam, patchTeam, removeTeam, switchTeam, setDefaultTeam, setPref, markDirty, clearDirty, update]
  )

  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>
}

export function useTeam() {
  const ctx = useContext(TeamContext)
  if (!ctx) throw new Error('useTeam must be used inside TeamProvider')
  return ctx
}

/**
 * Team-scoped state with automatic persistence and a hard boundary between teams.
 *
 * `initial` is used only when the active team has nothing saved under this scope. The key is
 * part of the state identity, so a switch remounts the value instead of merging old and new.
 */
export function useTeamStore(scope, initial) {
  const { activeNumber, markDirty, clearDirty } = useTeam()
  const team = activeNumber || null
  const initialRef = useRef(initial)
  const [value, setValue] = useState(() => (team ? readTeamData(team, scope, initialRef.current) : initialRef.current))
  const [loadedFor, setLoadedFor] = useState(team)

  // Load synchronously-ish during render when the team changes, so a view never paints the
  // previous team's saved work.
  if (loadedFor !== team) {
    setLoadedFor(team)
    setValue(team ? readTeamData(team, scope, initialRef.current) : initialRef.current)
  }

  const save = useCallback(
    (next) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next
        if (team) writeTeamData(team, scope, resolved)
        return resolved
      })
    },
    [team, scope]
  )

  return { value, save, team, markDirty, clearDirty }
}

/** Convenience reader for one-off lookups (exports, summaries) without subscribing. */
export const peekTeam = (team, scope, fallback) => readTeamData(team, scope, fallback)
