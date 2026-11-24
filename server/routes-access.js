// HTTP routes for the access hierarchy and the private team workspace.
import { all, get, run } from './db.js'
import { sendJson, readBody } from './util.js'
import {
  FEATURES,
  FEATURE_KEYS,
  PRESETS,
  audit,
  assignTeam,
  chapterAdminLogin,
  chapterLogin,
  createChapter,
  decideRequest,
  deleteChapter,
  enableTeam,
  getChapter,
  getTeamAccess,
  issueChapterAdminPassword,
  issueChapterCode,
  issueTeamPin,
  isOwner,
  listAudit,
  listChapters,
  listRequests,
  listSessions,
  listTeamAccess,
  logout,
  ownerBegin,
  ownerConfigured,
  ownerMfaConfigured,
  ownerVerify,
  removeTeam,
  requestAccess,
  resolveAccess,
  revokeSession,
  revokeTeamSessions,
  seasonWindow,
  setTeamFeatures,
  setTeamStatus,
  teamLogin,
  teamNumber,
  updateChapter,
  verifyTotp
} from './access.js'
import {
  COLLECTIONS,
  bundle,
  create,
  remove,
  restore,
  scheduleConflicts,
  scheduleInsight,
  update
} from './workspace.js'

const body = async (req) => {
  const raw = await readBody(req)
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw Object.assign(new Error('invalid JSON body'), { status: 400 })
  }
}

const clientIp = (req) =>
  String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown'

/** Destructive owner actions need the authenticator again, not just the session. */
function ownerReauth(req) {
  // With an authenticator configured, destructive actions need a fresh code. Without one the
  // deployment has no second factor to ask for; the session itself is the only gate, which is
  // why the UI warns when MFA is absent.
  if (!ownerMfaConfigured()) return true
  return verifyTotp(process.env.OWNER_TOTP_SECRET, req.headers['x-ol-totp'])
}

function requireOwner(access) {
  if (!isOwner(access)) throw Object.assign(new Error('owner authorization required'), { status: 403, code: 'owner_required' })
}

const publicTeam = (team) => ({
  team: team.team,
  chapterId: team.chapterId,
  status: team.status,
  hasPin: team.hasPin,
  features: team.features,
  preset: team.preset,
  issuedAt: team.issuedAt,
  lastSeenAt: team.lastSeenAt
})

export const accessDescription = async (access) => ({
  kind: access.kind,
  owner: Boolean(access.owner),
  team: access.team || null,
  chapter: access.chapter || null,
  chapterName: access.chapterName || null,
  admin: Boolean(access.admin),
  features: access.features || [],
  reason: access.reason || null,
  ownerConfigured: ownerConfigured(),
  ownerMfa: ownerMfaConfigured(),
  season: await seasonWindow(),
  catalog: FEATURES,
  presets: Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, v.label]))
})

export async function handleAccess(req, res, url, parts, q, method, access) {
  const seg = parts.slice(1)
  const ip = clientIp(req)

  // ---- identity ----------------------------------------------------------
  if (!seg.length && method === 'GET') {
    return sendJson(res, 200, await accessDescription(access))
  }

  if (seg[0] === 'me' && method === 'GET') return sendJson(res, 200, await accessDescription(access))

  if (seg[0] === 'chapter' && seg.length === 1 && method === 'POST') {
    const b = await body(req)
    if (!b.code) return sendJson(res, 400, { error: 'an access code is required' })
    const out = await chapterLogin({ code: b.code, label: b.label || null, ip })
    return sendJson(res, 200, { ...out, access: await accessDescription(await resolveAccess({ headers: { 'x-ol-session': out.token } })) })
  }

  if (seg[0] === 'team' && seg.length === 1 && method === 'POST') {
    const b = await body(req)
    if (!b.team || !b.pin) return sendJson(res, 400, { error: 'team number and access PIN are required' })
    const out = await teamLogin({ team: b.team, pin: b.pin, label: b.label || null, ip })
    return sendJson(res, 200, { ...out, access: await accessDescription(await resolveAccess({ headers: { 'x-ol-session': out.token } })) })
  }

  if (seg[0] === 'owner' && seg[1] === 'begin' && method === 'POST') {
    const b = await body(req)
    const out = await ownerBegin({ code: b.code, ip })
    // When no authenticator is configured the entry code opens the session directly.
    if (out.token) {
      const asAccess = await resolveAccess({ headers: { 'x-ol-session': out.token } })
      return sendJson(res, 200, { ...out, access: await accessDescription(asAccess) })
    }
    return sendJson(res, 200, out)
  }

  // Chapter administrator elevation, from inside an existing chapter session.
  if (seg[0] === 'chapter' && seg[1] === 'admin' && method === 'POST') {
    const b = await body(req)
    const out = await chapterAdminLogin(access, { password: b.password, ip })
    const asAccess = await resolveAccess(req)
    return sendJson(res, 200, { ...out, access: await accessDescription(asAccess) })
  }

  if (seg[0] === 'owner' && seg[1] === 'verify' && method === 'POST') {
    const b = await body(req)
    const out = await ownerVerify({ challenge: b.challenge, code: b.code, label: b.label || 'owner console', ip })
    return sendJson(res, 200, { ...out, access: await accessDescription(await resolveAccess({ headers: { 'x-ol-session': out.token } })) })
  }

  if (seg[0] === 'logout' && method === 'POST') {
    if (access.sessionId) audit({ actorKind: access.kind, team: access.team, chapterId: access.chapter, action: 'access.logout', ip })
    return sendJson(res, 200, logout(access))
  }

  // A team captain can ask to be enabled. This never grants anything by itself.
  if (seg[0] === 'request' && method === 'POST') {
    const b = await body(req)
    const recent = get(
      'SELECT COUNT(*) AS c FROM access_requests WHERE created_at > ? AND team_number = ?',
      new Date(Date.now() - 600000).toISOString(),
      teamNumber(b.team)
    )
    if (Number(recent?.c || 0) >= 3) return sendJson(res, 429, { error: 'a request was already sent recently' })
    return sendJson(res, 200, requestAccess({ team: b.team, chapterId: b.chapterId || null, contact: b.contact || null, note: b.note || null }))
  }

  // ---- chapter dashboard -------------------------------------------------
  if (seg[0] === 'chapters' && !seg[1]) {
    requireOwner(access)
    if (method === 'GET') return sendJson(res, 200, { chapters: listChapters(), season: await seasonWindow() })
    if (method === 'POST') {
      const b = await body(req)
      const chapter = createChapter({ name: b.name, season: b.season, expiresAt: b.expiresAt, adminEnabled: b.adminEnabled })
      audit({ actorKind: 'owner', action: 'chapter.created', chapterId: chapter.id, detail: { name: chapter.name } })
      return sendJson(res, 200, { chapter })
    }
    return sendJson(res, 405, { error: 'method not allowed' })
  }

  if (seg[0] === 'chapters' && seg[1]) {
    const chapter = getChapter(seg[1])
    if (!chapter) return sendJson(res, 404, { error: 'unknown chapter' })
    const allowed = isOwner(access) || (access.kind === 'chapter' && access.chapter === chapter.id)
    if (!allowed) return sendJson(res, 403, { error: 'chapter authorization required', code: 'chapter_required' })

    if (seg.length === 2 && method === 'GET') {
      const teams = chapter.teams.map((team) => {
        const row = getTeamAccess(team)
        return row ? publicTeam(row) : { team, status: 'not_requested', hasPin: false, features: [] }
      })
      const requests = isOwner(access) ? listRequests().filter((r) => r.chapterId === chapter.id) : listRequests().filter((r) => r.chapterId === chapter.id && r.status !== 'declined')
      return sendJson(res, 200, {
        chapter,
        teams,
        requests: requests.map((r) => ({ id: r.id, team: r.team, status: r.status, createdAt: r.createdAt, note: r.note })),
        season: await seasonWindow(),
        // A chapter code never carries team permissions, and chapter administrators never see
        // a team's PIN, strategies or private records.
        canViewPrivate: false
      })
    }

    if (seg.length === 2 && method === 'PATCH') {
      requireOwner(access)
      return sendJson(res, 200, { chapter: updateChapter(chapter.id, await body(req)) })
    }
    if (seg.length === 2 && method === 'DELETE') {
      requireOwner(access)
      if (!ownerReauth(req)) return sendJson(res, 403, { error: 'enter a current authenticator code to delete a chapter', code: 'reauth_required' })
      const out = deleteChapter(chapter.id)
      audit({ actorKind: 'owner', action: 'chapter.deleted', chapterId: chapter.id, detail: chapter.name })
      return sendJson(res, 200, out)
    }
    if (seg[2] === 'admin-code' && method === 'POST') {
      requireOwner(access)
      const out = issueChapterAdminPassword(chapter.id)
      return sendJson(res, 200, { ...out, notice: 'Shown once. Give it only to the chapter administrator; it is stored as a hash.' })
    }
    if (seg[2] === 'code' && method === 'POST') {
      requireOwner(access)
      const out = issueChapterCode(chapter.id)
      audit({ actorKind: 'owner', action: 'chapter.code.issued', chapterId: chapter.id })
      return sendJson(res, 200, { ...out, notice: 'This code is shown once. Share it with the chapter coordinator through a private channel.' })
    }
    if (seg[2] === 'teams' && method === 'POST') {
      requireOwner(access)
      const b = await body(req)
      const updated = assignTeam(chapter.id, b.team)
      audit({ actorKind: 'owner', action: 'chapter.team.added', chapterId: chapter.id, team: teamNumber(b.team) })
      return sendJson(res, 200, { chapter: updated })
    }
    if (seg[2] === 'teams' && seg[3] && method === 'DELETE') {
      requireOwner(access)
      const updated = removeTeam(chapter.id, seg[3])
      audit({ actorKind: 'owner', action: 'chapter.team.removed', chapterId: chapter.id, team: teamNumber(seg[3]) })
      return sendJson(res, 200, { chapter: updated })
    }
  }

  // ---- team workspaces (owner) -------------------------------------------
  if (seg[0] === 'teams') {
    requireOwner(access)
    if (!seg[1] && method === 'GET') return sendJson(res, 200, { teams: listTeamAccess(), catalog: FEATURES, presets: PRESETS })

    const number = teamNumber(seg[1] || '')
    if (!/^[0-9]{1,5}[A-Z]?$/.test(number)) return sendJson(res, 400, { error: 'a valid team number is required' })

    if (seg.length === 2 && method === 'GET') {
      const team = getTeamAccess(number)
      if (!team) return sendJson(res, 404, { error: 'unknown team workspace' })
      return sendJson(res, 200, { team, catalog: FEATURES, presets: PRESETS, sessions: listSessions({ team: number }) })
    }
    if (seg[2] === 'enable' && method === 'POST') {
      const b = await body(req)
      return sendJson(res, 200, { team: enableTeam(b.chapterId || null, number, { preset: b.preset || 'standard', features: b.features || null }) })
    }
    if (seg[2] === 'pin' && method === 'POST') {
      const out = issueTeamPin(number)
      audit({ actorKind: 'owner', action: 'team.pin.issued', team: number })
      return sendJson(res, 200, { ...out, notice: 'Shown once. Give it to the team captain privately; it is stored only as a hash.' })
    }
    if (seg[2] === 'revoke' && method === 'POST') {
      revokeTeamSessions(number)
      return sendJson(res, 200, { revoked: true, team: number })
    }
    if (seg.length === 2 && method === 'PATCH') {
      const b = await body(req)
      let team = getTeamAccess(number)
      if (!team) return sendJson(res, 404, { error: 'unknown team workspace' })
      if (b.features || b.preset) team = setTeamFeatures(number, { preset: b.preset, features: b.features })
      if (b.status) team = setTeamStatus(number, b.status)
      return sendJson(res, 200, { team })
    }
  }

  // ---- access requests (owner) -------------------------------------------
  if (seg[0] === 'requests') {
    requireOwner(access)
    if (method === 'GET') return sendJson(res, 200, { requests: listRequests() })
    if (seg[1] && method === 'POST') {
      const b = await body(req)
      const out = decideRequest(Number(seg[1]), Boolean(b.approve), 'owner')
      return sendJson(res, 200, out)
    }
  }

  // ---- device sessions and audit (owner) ---------------------------------
  if (seg[0] === 'sessions') {
    requireOwner(access)
    if (method === 'GET') return sendJson(res, 200, { sessions: listSessions({ team: q.get('team') || undefined }) })
    if (seg[1] && method === 'DELETE') return sendJson(res, 200, revokeSession(seg[1]))
  }

  if (seg[0] === 'audit' && method === 'GET') {
    requireOwner(access)
    return sendJson(res, 200, { entries: listAudit(Number(q.get('limit')) || 200, { team: q.get('team') || null, action: q.get('action') || null }) })
  }

  if (seg[0] === 'season' && method === 'GET') return sendJson(res, 200, { season: await seasonWindow() })

  return sendJson(res, 404, { error: 'not found' })
}

// ---- private workspace ---------------------------------------------------

function workspaceTeam(access, requested) {
  if (access.kind === 'team') {
    // A team session can only ever address its own workspace; a different number is a
    // mismatch, not a pivot.
    if (requested && teamNumber(requested) !== access.team) {
      throw Object.assign(new Error('this session belongs to a different team workspace'), {
        status: 403,
        code: 'team_mismatch'
      })
    }
    return access.team
  }
  if (access.owner) {
    const team = teamNumber(requested)
    if (!team) throw Object.assign(new Error('owner view requires ?team='), { status: 400 })
    return team
  }
  throw Object.assign(new Error('a team workspace session is required'), { status: 401, code: 'team_required' })
}

const notifyView = (r) => ({
  id: r.id,
  team: r.team_number,
  label: r.label,
  categories: JSON.parse(r.categories || '[]'),
  leadMinutes: r.lead_minutes,
  quietStart: r.quiet_start,
  quietEnd: r.quiet_end,
  createdAt: r.created_at,
  lastSeenAt: r.last_seen_at
})

export async function handleWorkspace(req, res, url, parts, q, method, access) {
  const seg = parts.slice(1)
  const nowIso = () => new Date().toISOString()

  if (seg[0] === 'notifications') {
    const team = workspaceTeam(access, q.get('team'))
    if (seg[1] === 'subscriptions') {
      if (method === 'GET') {
        return sendJson(res, 200, {
          subscriptions: all('SELECT * FROM notify_subs WHERE team_number = ? ORDER BY created_at', team).map(notifyView),
          // Delivery needs a push service and VAPID keys. Without them the app schedules
          // reminders locally and says so, instead of pretending a push was sent.
          pushConfigured: Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
        })
      }
      if (method === 'POST') {
        const b = await body(req)
        if (!b.endpoint) return sendJson(res, 400, { error: 'a push subscription endpoint is required' })
        const id = `n_${Math.random().toString(36).slice(2, 12)}`
        run(
          'INSERT INTO notify_subs(id, team_number, endpoint, p256dh, auth, label, categories, lead_minutes, quiet_start, quiet_end, created_at, last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
          id,
          team,
          String(b.endpoint).slice(0, 500),
          b.keys?.p256dh ? String(b.keys.p256dh).slice(0, 200) : null,
          b.keys?.auth ? String(b.keys.auth).slice(0, 100) : null,
          b.label || null,
          JSON.stringify(Array.isArray(b.categories) ? b.categories.slice(0, 20) : []),
          Number(b.leadMinutes) || 10,
          b.quietStart == null ? null : Number(b.quietStart),
          b.quietEnd == null ? null : Number(b.quietEnd),
          nowIso(),
          nowIso()
        )
        return sendJson(res, 200, { id, pushConfigured: Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) })
      }
      if (seg[2] && method === 'DELETE') {
        const row = get('SELECT * FROM notify_subs WHERE id = ? AND team_number = ?', seg[2], team)
        if (!row) return sendJson(res, 404, { error: 'unknown subscription' })
        run('DELETE FROM notify_subs WHERE id = ?', seg[2])
        return sendJson(res, 200, { removed: seg[2] })
      }
    }
    if (seg[1] === 'preferences' && method === 'POST') {
      const b = await body(req)
      const subs = all('SELECT id FROM notify_subs WHERE team_number = ?', team)
      for (const s of subs) {
        run(
          'UPDATE notify_subs SET categories = ?, lead_minutes = ?, quiet_start = ?, quiet_end = ?, last_seen_at = ? WHERE id = ?',
          JSON.stringify(Array.isArray(b.categories) ? b.categories.slice(0, 20) : []),
          Number(b.leadMinutes) || 10,
          b.quietStart == null ? null : Number(b.quietStart),
          b.quietEnd == null ? null : Number(b.quietEnd),
          nowIso(),
          s.id
        )
      }
      return sendJson(res, 200, { updated: subs.length })
    }
    return sendJson(res, 404, { error: 'not found' })
  }

  const team = workspaceTeam(access, q.get('team') || null)

  if (seg[0] === 'all' && method === 'GET') {
    return sendJson(res, 200, bundle(team, q.get('event') || null))
  }

  if (seg[0] === 'schedule' && seg[1] === 'insight' && method === 'GET') {
    return sendJson(res, 200, scheduleInsight(team, q.get('sku') || null))
  }
  if (seg[0] === 'schedule' && seg[1] === 'conflicts' && method === 'GET') {
    return sendJson(res, 200, scheduleConflicts(team, q.get('sku') || null))
  }

  const collection = seg[0]
  if (!COLLECTIONS.includes(collection)) return sendJson(res, 404, { error: 'unknown workspace collection' })

  if (seg.length === 1 && method === 'GET') {
    const event = q.get('event') || null
    const rows = event
      ? all('SELECT * FROM ws_records WHERE team_number = ? AND collection = ? AND event_sku = ? AND deleted_at IS NULL ORDER BY created_at', team, collection, event)
      : all('SELECT * FROM ws_records WHERE team_number = ? AND collection = ? AND deleted_at IS NULL ORDER BY created_at', team, collection)
    return sendJson(res, 200, {
      records: rows.map((r) => ({ id: r.id, eventSku: r.event_sku, ...JSON.parse(r.data || '{}'), createdAt: r.created_at, updatedAt: r.updated_at }))
    })
  }
  if (seg.length === 1 && method === 'POST') {
    const b = await body(req)
    return sendJson(res, 200, { record: create(team, collection, b) })
  }
  if (seg[1] && method === 'PATCH') {
    return sendJson(res, 200, { record: update(team, collection, seg[1], await body(req)) })
  }
  if (seg[1] && method === 'DELETE') {
    return sendJson(res, 200, remove(team, collection, seg[1]))
  }
  if (seg[1] && seg[2] === 'restore' && method === 'POST') {
    return sendJson(res, 200, restore(team, collection, seg[1]))
  }

  return sendJson(res, 404, { error: 'not found' })
}
