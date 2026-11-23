// Personal team store.
//
// Two layers live here, and they are deliberately separate:
//
//   profile   — who is using this browser: the saved teams, which one is active, and display
//               preferences. One record, one key.
//   team data — everything a tool saves for one team (field scenarios, routines, testing
//               sessions, scouting notes). Every key is namespaced by team number, so switching
//               teams can never read another team's work.
//
// This build is guest-first: the profile and all team work live in this browser's localStorage.
// Nothing here is a claim of team membership — it is a personal view of public data plus work
// the user recorded themselves.

const PROFILE_KEY = 'override-lab:profile:v1'
const TEAM_PREFIX = 'override-lab:team:'
const USER_PREFIX = 'override-lab:user:'

export const SEASON_LABEL = '2026-27 Override'

/** Trim, drop a leading #, remove spaces, upper-case. */
export function normalizeTeamNumber(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/^#/, '')
    .replace(/\s+/g, '')
    .toUpperCase()
}

/** V5RC identifiers: up to five digits with an optional single letter suffix (75019D, 37S). */
export function isValidTeamNumber(value) {
  return /^[0-9]{1,5}[A-Z]?$/.test(normalizeTeamNumber(value))
}

export function emptyProfile() {
  return {
    teams: [],
    active: null,
    defaultTeam: null,
    prefs: {
      event: null,
      favoriteEvents: [],
      fieldOrientation: 'blue-bottom',
      showHints: true
    },
    createdAt: null,
    updatedAt: null
  }
}

function safeParse(text, fallback) {
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed : fallback
  } catch {
    return fallback
  }
}

export function loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (!raw) return emptyProfile()
    const parsed = safeParse(raw, null)
    if (!parsed) return emptyProfile()
    const base = emptyProfile()
    return {
      ...base,
      ...parsed,
      teams: Array.isArray(parsed.teams) ? parsed.teams.filter((t) => t && isValidTeamNumber(t.number)) : [],
      prefs: { ...base.prefs, ...(parsed.prefs || {}) }
    }
  } catch {
    return emptyProfile()
  }
}

export function saveProfile(profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ ...profile, updatedAt: new Date().toISOString() }))
  } catch {
    /* storage full or blocked: the session still works, it just will not persist */
  }
}

/** One saved team. `verified` is false when the user continued without official data. */
export function makeTeamRecord(input = {}) {
  const number = normalizeTeamNumber(input.number)
  return {
    number,
    label: String(input.label || '').trim() || null,
    name: input.name || null,
    org: input.org || null,
    city: input.city || null,
    region: input.region || null,
    country: input.country || null,
    program: input.program || null,
    grade: input.grade || null,
    teamId: input.teamId ?? null,
    verified: Boolean(input.verified),
    seasonStatus: input.seasonStatus || 'unknown', // 'active' | 'none' | 'unknown'
    seasonLabel: input.seasonLabel || SEASON_LABEL,
    favorite: Boolean(input.favorite),
    addedAt: new Date().toISOString()
  }
}

export const displayName = (team) => (team?.label || team?.number || 'Team')

// ---- per-team data -------------------------------------------------------

const teamKey = (team, scope) => `${TEAM_PREFIX}${normalizeTeamNumber(team)}:${scope}:v1`

export function readTeamData(team, scope, fallback) {
  if (!team) return fallback
  try {
    const raw = localStorage.getItem(teamKey(team, scope))
    if (raw === null) return fallback
    return safeParse(raw, fallback)
  } catch {
    return fallback
  }
}

export function writeTeamData(team, scope, value) {
  if (!team) return false
  try {
    localStorage.setItem(teamKey(team, scope), JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export const peekTeam = (team, scope, fallback) => readTeamData(team, scope, fallback)

export function removeTeamData(team) {
  try {
    const prefix = `${TEAM_PREFIX}${normalizeTeamNumber(team)}:`
    const doomed = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(prefix)) doomed.push(key)
    }
    for (const key of doomed) localStorage.removeItem(key)
    return doomed.length
  } catch {
    return 0
  }
}

/** How much saved work exists for a team, used by My Teams before a removal. */
export function teamDataSummary(team) {
  const counts = {}
  try {
    const prefix = `${TEAM_PREFIX}${normalizeTeamNumber(team)}:`
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(prefix)) continue
      const scope = key.slice(prefix.length).replace(/:v1$/, '')
      counts[scope] = true
    }
  } catch {
    /* ignore */
  }
  return Object.keys(counts)
}

// ---- user-level data (not tied to one team) ------------------------------

export function readUserData(scope, fallback) {
  try {
    const raw = localStorage.getItem(`${USER_PREFIX}${scope}:v1`)
    if (raw === null) return fallback
    return safeParse(raw, fallback)
  } catch {
    return fallback
  }
}

export function writeUserData(scope, value) {
  try {
    localStorage.setItem(`${USER_PREFIX}${scope}:v1`, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export const PROFILE_STORAGE_KEY = PROFILE_KEY
