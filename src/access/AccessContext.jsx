import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, getSession, setSession } from '../api.js'

const AccessContext = createContext(null)

const EMPTY = {
  kind: 'public',
  owner: false,
  team: null,
  chapter: null,
  chapterName: null,
  admin: false,
  features: [],
  reason: null,
  ownerConfigured: false,
  season: null,
  catalog: {},
  presets: {}
}

/**
 * The single source of truth for what this device may do.
 *
 * The client never decides access: it renders what the server resolved for this session and
 * shows a clear unlock path otherwise. Every protected endpoint re-checks the same rules.
 */
export function AccessProvider({ children }) {
  const [access, setAccess] = useState(EMPTY)
  const [loading, setLoading] = useState(Boolean(getSession()))
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    if (!getSession()) {
      setAccess(EMPTY)
      setLoading(false)
      return EMPTY
    }
    setLoading(true)
    try {
      const next = await api('/api/access')
      setAccess(next)
      // A revoked or expired session is cleared locally so the UI does not keep offering tools
      // that will be refused.
      if (next.kind === 'public' && next.reason) setSession('')
      setError(null)
      return next
    } catch (e) {
      setError(e.message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const adopt = useCallback(async (payload) => {
    if (payload?.token) setSession(payload.token)
    if (payload?.access) {
      setAccess(payload.access)
      return payload.access
    }
    return await refresh()
  }, [refresh])

  const loginChapter = useCallback(
    async (code, label) => {
      const out = await api('/api/access/chapter', { method: 'POST', body: JSON.stringify({ code, label }) })
      return adopt(out)
    },
    [adopt]
  )

  const loginTeam = useCallback(
    async (team, pin, label) => {
      const out = await api('/api/access/team', { method: 'POST', body: JSON.stringify({ team, pin, label }) })
      return adopt(out)
    },
    [adopt]
  )

  const ownerBegin = useCallback(async (code) => api('/api/access/owner/begin', { method: 'POST', body: JSON.stringify({ code }) }), [])

  const ownerVerify = useCallback(
    async (challenge, code, label) => {
      const out = await api('/api/access/owner/verify', { method: 'POST', body: JSON.stringify({ challenge, code, label }) })
      return adopt(out)
    },
    [adopt]
  )

  const logout = useCallback(async () => {
    try {
      await api('/api/access/logout', { method: 'POST' })
    } catch {
      /* the local session is cleared either way */
    }
    setSession('')
    setAccess(EMPTY)
  }, [])

  const can = useCallback(
    (feature) => {
      if (!feature) return true
      if (access.owner) return true
      return access.kind === 'team' && (access.features || []).includes(feature)
    },
    [access]
  )

  const value = useMemo(
    () => ({
      access,
      loading,
      error,
      refresh,
      loginChapter,
      loginTeam,
      ownerBegin,
      ownerVerify,
      logout,
      can,
      isOwner: Boolean(access.owner),
      isTeam: access.kind === 'team',
      isChapter: access.kind === 'chapter',
      team: access.team,
      features: access.features || [],
      season: access.season
    }),
    [access, loading, error, refresh, loginChapter, loginTeam, ownerBegin, ownerVerify, logout, can]
  )

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>
}

export function useAccess() {
  const ctx = useContext(AccessContext)
  if (!ctx) throw new Error('useAccess must be used inside AccessProvider')
  return ctx
}

export const FEATURE_LABELS = {
  teamLab: 'Team Lab',
  scouting: 'Scouting',
  counters: 'Opponents & Counters',
  allianceStrategy: 'Alliance Strategy',
  matchIntelligence: 'Match Intelligence',
  simulation: 'Match Simulation',
  metaModel: 'Meta & Model',
  fieldSimulator: 'Field Simulator',
  overrideSim: 'Override Sim',
  robotTesting: 'Robot Testing',
  streamAnalysis: 'Stream Analysis',
  matchDay: 'Match Day',
  operations: 'Team Operations',
  notifications: 'Notifications',
  reports: 'Reports'
}
