import { useCallback, useEffect, useRef, useState } from 'react'
import { api, endpoints, jpost, useApi } from '../api.js'

/**
 * A team's current-season record. The server caches it for a few hours; `fresh` forces a
 * re-read when the user asks. Returns the profile plus loading/error so a dashboard can show an
 * honest empty state instead of inventing numbers.
 */
export function useTeamHistory(team, { enabled = true, fresh = false, nonce = 0 } = {}) {
  const path = team && enabled ? endpoints.history(team) + (fresh ? '&fresh=1' : '') : null
  const { data, error, loading, reload } = useApi(path, [nonce])
  return { profile: data || null, error, loading, reload }
}

/** The active team's registered events for the current season. */
export function useTeamSeasonEvents(team, { enabled = true, nonce = 0 } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(team && enabled) })
  const [localNonce, setLocalNonce] = useState(0)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    if (!team || !enabled) {
      setState({ data: null, error: null, loading: false })
      return
    }
    setState((s) => ({ ...s, loading: true, error: null }))
    jpost('/api/season/events', { team, scope: 'team' })
      .then((data) => alive.current && setState({ data, error: null, loading: false }))
      .catch((error) => alive.current && setState({ data: null, error: error.message, loading: false }))
  }, [team, enabled, nonce, localNonce])

  const reload = useCallback(() => setLocalNonce((n) => n + 1), [])
  return { ...state, reload }
}

/** Any team's season record, fetched on demand (opponent comparison, alliance analysis). */
export function useLookupHistory() {
  const [records, setRecords] = useState({})
  const [loading, setLoading] = useState({})
  const [errors, setErrors] = useState({})

  const load = useCallback(
    async (team, { fresh = false } = {}) => {
      const number = String(team || '').trim().toUpperCase()
      if (!number) return null
      if (!fresh && records[number]) return records[number]
      setLoading((m) => ({ ...m, [number]: true }))
      setErrors((m) => ({ ...m, [number]: null }))
      try {
        const profile = await api(endpoints.history(number) + (fresh ? '&fresh=1' : ''))
        setRecords((m) => ({ ...m, [number]: profile }))
        return profile
      } catch (e) {
        setErrors((m) => ({ ...m, [number]: e.message }))
        return null
      } finally {
        setLoading((m) => ({ ...m, [number]: false }))
      }
    },
    [records]
  )

  return { records, loading, errors, load }
}

/** A season-wide event search, for tournament discovery outside the team's own schedule. */
export function useSeasonSearch() {
  const [state, setState] = useState({ data: null, error: null, loading: false })
  const search = useCallback(async (query, scope = 'season') => {
    setState({ data: null, error: null, loading: true })
    try {
      const data = await jpost('/api/season/events', { q: query || undefined, scope })
      setState({ data, error: null, loading: false })
      return data
    } catch (e) {
      setState({ data: null, error: e.message, loading: false })
      return null
    }
  }, [])
  return { ...state, search }
}
