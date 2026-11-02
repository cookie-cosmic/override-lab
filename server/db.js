// SQLite archive. Uses Node's built-in `node:sqlite` (no native build step).
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { num, matchKey } from './util.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const DATA_DIR = process.env.VEX_DATA_DIR || path.join(ROOT, 'data')
export const ARCHIVE_DIR = path.join(DATA_DIR, 'archive')
const DB_PATH = process.env.VEX_DB || path.join(DATA_DIR, 'vex.db')

fs.mkdirSync(DATA_DIR, { recursive: true })
fs.mkdirSync(ARCHIVE_DIR, { recursive: true })

export const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = OFF')

db.exec(`
CREATE TABLE IF NOT EXISTS events (
  sku TEXT PRIMARY KEY,
  name TEXT, program TEXT, season TEXT,
  start_date TEXT, end_date TEXT, location TEXT,
  divisions TEXT, raw TEXT, ingested_at TEXT
);
CREATE TABLE IF NOT EXISTS teams (
  sku TEXT, number TEXT, name TEXT, org TEXT, city TEXT, region TEXT, country TEXT, grade TEXT,
  PRIMARY KEY (sku, number)
);
CREATE TABLE IF NOT EXISTS rankings (
  sku TEXT, division TEXT, team TEXT, rank INTEGER,
  wins INTEGER, losses INTEGER, ties INTEGER,
  wp REAL, ap REAL, sp REAL, trsp REAL,
  max_score REAL, opr REAL, dpr REAL, ccwm REAL,
  PRIMARY KEY (sku, division, team)
);
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT, match_key TEXT UNIQUE, division TEXT,
  round INTEGER, instance INTEGER, matchnum INTEGER, field TEXT,
  scheduled TEXT, scored INTEGER, video TEXT,
  red1 TEXT, red2 TEXT, red3 TEXT, blue1 TEXT, blue2 TEXT, blue3 TEXT,
  redsit TEXT, bluesit TEXT,
  red_score REAL, blue_score REAL,
  red_auto REAL, blue_auto REAL,
  red_driver REAL, blue_driver REAL,
  red_penalty REAL, blue_penalty REAL,
  score_details TEXT
);
CREATE TABLE IF NOT EXISTS skills (
  sku TEXT, team TEXT, type INTEGER, rank INTEGER, attempts INTEGER, score REAL,
  PRIMARY KEY (sku, team, type)
);
CREATE TABLE IF NOT EXISTS awards (
  id INTEGER PRIMARY KEY AUTOINCREMENT, sku TEXT, name TEXT, team TEXT, ordering INTEGER
);
CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT, youtube_id TEXT, label TEXT, stream_start TEXT, duration_s INTEGER, field TEXT, notes TEXT
);
CREATE TABLE IF NOT EXISTS match_media (
  match_key TEXT PRIMARY KEY,
  video_id INTEGER, offset_s INTEGER, seek_s INTEGER, confidence REAL, source TEXT
);
CREATE TABLE IF NOT EXISTS score_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_key TEXT, t_s REAL, alliance TEXT, points REAL, note TEXT, source TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS scouting (
  sku TEXT, team TEXT, data TEXT, updated_at TEXT,
  PRIMARY KEY (sku, team)
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
-- A team's season, read from the tournaments it already played. Cached, never merged into an
-- event: a future event has a roster and this history, and nothing else.
CREATE TABLE IF NOT EXISTS team_history (team TEXT, season TEXT, data TEXT, fetched_at TEXT, PRIMARY KEY (team, season));
CREATE INDEX IF NOT EXISTS idx_matches_sku ON matches(sku);
CREATE INDEX IF NOT EXISTS idx_events_sku ON score_events(match_key);
`)

export const all = (sql, ...params) => db.prepare(sql).all(...params)
export const get = (sql, ...params) => db.prepare(sql).get(...params)
export const run = (sql, ...params) => db.prepare(sql).run(...params)

// Resolved-but-unsaved events are transient: they are deleted on discard, on expiry, and
// on boot, so the archive only ever holds what the user deliberately kept.
const eventCols = all('PRAGMA table_info(events)').map((c) => c.name)
if (!eventCols.includes('transient')) db.exec('ALTER TABLE events ADD COLUMN transient INTEGER DEFAULT 0')
if (!eventCols.includes('touched_at')) db.exec('ALTER TABLE events ADD COLUMN touched_at TEXT')

const teamCols = all('PRAGMA table_info(teams)').map((c) => c.name)
// The RobotEvents team id is what the season-history endpoint needs; the number alone is ambiguous.
if (!teamCols.includes('team_id')) db.exec('ALTER TABLE teams ADD COLUMN team_id INTEGER')

function tx(fn) {
  db.exec('BEGIN')
  try {
    fn()
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export function getMeta(key, fallback = null) {
  const row = get('SELECT value FROM meta WHERE key = ?', key)
  return row ? row.value : fallback
}
export function setMeta(key, value) {
  run('INSERT INTO meta(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value))
}

// ---- transient sessions -------------------------------------------------

export function setTransient(sku, flag) {
  run('UPDATE events SET transient = ?, touched_at = ? WHERE sku = ?', flag ? 1 : 0, new Date().toISOString(), sku)
}
export function touchTransient(sku) {
  run('UPDATE events SET touched_at = ? WHERE sku = ? AND transient = 1', new Date().toISOString(), sku)
}
export function transientEvent() {
  return get('SELECT * FROM events WHERE transient = 1 ORDER BY ingested_at DESC LIMIT 1') || null
}
export function clearTransients() {
  const rows = all('SELECT sku FROM events WHERE transient = 1')
  for (const r of rows) deleteEvent(r.sku)
  return rows.map((r) => r.sku)
}
export function expireTransients(minutes = 45) {
  const cutoff = new Date(Date.now() - minutes * 60000).toISOString()
  const rows = all('SELECT sku FROM events WHERE transient = 1 AND (touched_at IS NULL OR touched_at < ?)', cutoff)
  for (const r of rows) deleteEvent(r.sku)
  return rows.map((r) => r.sku)
}

export function listEvents() {
  return all(
    `SELECT e.*,
      (SELECT COUNT(*) FROM teams t WHERE t.sku = e.sku) AS team_count,
      (SELECT COUNT(*) FROM matches m WHERE m.sku = e.sku) AS match_count,
      (SELECT COUNT(*) FROM matches m WHERE m.sku = e.sku AND m.round = 2) AS qual_count,
      (SELECT COUNT(*) FROM videos v WHERE v.sku = e.sku) AS video_count
     FROM events e WHERE COALESCE(e.transient, 0) = 0 ORDER BY e.start_date DESC`
  )
}

export function getEvent(sku) {
  return get('SELECT * FROM events WHERE sku = ?', sku)
}
export function getTeams(sku) {
  return all('SELECT * FROM teams WHERE sku = ? ORDER BY number', sku)
}
export function getRankings(sku) {
  return all('SELECT * FROM rankings WHERE sku = ? ORDER BY rank', sku)
}
export function getMatches(sku) {
  return all('SELECT * FROM matches WHERE sku = ? ORDER BY round, instance, matchnum, id', sku).map((m) => ({
    ...m,
    score_details: m.score_details ? safeJson(m.score_details) : null
  }))
}
export function getMatch(matchKeyValue) {
  const m = get('SELECT * FROM matches WHERE match_key = ?', matchKeyValue)
  if (!m) return null
  return { ...m, score_details: m.score_details ? safeJson(m.score_details) : null }
}
export function getSkills(sku) {
  return all('SELECT * FROM skills WHERE sku = ? ORDER BY type, rank', sku)
}
export function getAwards(sku) {
  return all('SELECT * FROM awards WHERE sku = ? ORDER BY ordering, id', sku)
}
export function deleteEvent(sku) {
  tx(() => {
    for (const t of ['events', 'teams', 'rankings', 'matches', 'skills', 'awards', 'videos', 'scouting']) {
      run(`DELETE FROM ${t} WHERE ${t === 'events' ? 'sku' : 'sku'} = ?`, sku)
    }
    run('DELETE FROM score_events WHERE match_key LIKE ?', `${sku}::%`)
    run('DELETE FROM match_media WHERE match_key LIKE ?', `${sku}::%`)
  })
}

function safeJson(s) {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

/**
 * Insert or replace a complete event bundle:
 * { event, teams, rankings, matches, skills, awards, videos }
 * Every field is coerced defensively — sources disagree on types (strings vs numbers).
 */
export function upsertEventBundle(bundle, { replace = true } = {}) {
  const ev = bundle.event || {}
  const sku = ev.sku
  if (!sku) throw new Error('event bundle missing sku')
  if (replace) deleteEvent(sku)

  tx(() => {
    run(
      `INSERT INTO events(sku,name,program,season,start_date,end_date,location,divisions,raw,ingested_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
      sku,
      ev.name || sku,
      ev.program || 'VRC',
      ev.season || null,
      ev.start_date || ev.start || null,
      ev.end_date || ev.end || null,
      [ev.loc_venue, ev.loc_city, ev.loc_region, ev.loc_country].filter(Boolean).join(', ') || null,
      JSON.stringify(bundle.divisions || []),
      JSON.stringify(ev),
      new Date().toISOString()
    )

    for (const t of bundle.teams || []) {
      run(
        `INSERT INTO teams(sku,number,name,org,city,region,country,grade,team_id) VALUES(?,?,?,?,?,?,?,?,?)
         ON CONFLICT(sku,number) DO UPDATE SET name=excluded.name, org=excluded.org, city=excluded.city,
           region=excluded.region, country=excluded.country, grade=excluded.grade,
           team_id=COALESCE(excluded.team_id, teams.team_id)`,
        sku,
        String(t.number || t.team || '').trim(),
        t.name || t.team_name || null,
        t.organisation || t.organization || t.org || null,
        t.loc_city || t.city || null,
        t.loc_region || t.region || null,
        t.loc_country || t.country || null,
        t.grade || null,
        num(t.id ?? t.team_id)
      )
    }

    for (const r of bundle.rankings || []) {
      run(
        `INSERT INTO rankings(sku,division,team,rank,wins,losses,ties,wp,ap,sp,trsp,max_score,opr,dpr,ccwm)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        sku,
        r.division || 'Default',
        String(r.team || '').trim(),
        num(r.rank),
        num(r.wins),
        num(r.losses),
        num(r.ties),
        num(r.wp),
        num(r.ap),
        num(r.sp),
        num(r.trsp),
        num(r.max_score),
        num(r.opr),
        num(r.dpr),
        num(r.ccwm)
      )
    }

    for (const m of bundle.matches || []) {
      const row = {
        sku,
        division: m.division || 'Default',
        round: num(m.round) ?? 2,
        instance: num(m.instance) ?? 1,
        matchnum: num(m.matchnum) ?? num(m.number) ?? 0,
        field: m.field || null,
        scheduled: m.scheduled || null,
        scored: m.scored ? 1 : 0,
        video: m.video || null,
        red1: (m.red1 || '').trim() || null,
        red2: (m.red2 || '').trim() || null,
        red3: (m.red3 || '').trim() || null,
        blue1: (m.blue1 || '').trim() || null,
        blue2: (m.blue2 || '').trim() || null,
        blue3: (m.blue3 || '').trim() || null,
        redsit: (m.redsit || '').trim() || null,
        bluesit: (m.bluesit || '').trim() || null,
        red_score: num(m.redscore ?? m.red_score),
        blue_score: num(m.bluescore ?? m.blue_score)
      }
      const det = m.score_details ? (typeof m.score_details === 'string' ? safeJson(m.score_details) : m.score_details) : null
      row.red_auto = num(m.red_auto ?? det?.red?.auto_points)
      row.blue_auto = num(m.blue_auto ?? det?.blue?.auto_points)
      row.red_driver = num(m.red_driver ?? det?.red?.driver_controlled_points)
      row.blue_driver = num(m.blue_driver ?? det?.blue?.driver_controlled_points)
      row.red_penalty = num(m.red_penalty ?? det?.red?.penalty_points)
      row.blue_penalty = num(m.blue_penalty ?? det?.blue?.penalty_points)
      run(
        `INSERT INTO matches(sku,match_key,division,round,instance,matchnum,field,scheduled,scored,video,
          red1,red2,red3,blue1,blue2,blue3,redsit,bluesit,red_score,blue_score,
          red_auto,blue_auto,red_driver,blue_driver,red_penalty,blue_penalty,score_details)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        sku,
        matchKey(row),
        row.division,
        row.round,
        row.instance,
        row.matchnum,
        row.field,
        row.scheduled,
        row.scored,
        row.video,
        row.red1,
        row.red2,
        row.red3,
        row.blue1,
        row.blue2,
        row.blue3,
        row.redsit,
        row.bluesit,
        row.red_score,
        row.blue_score,
        row.red_auto,
        row.blue_auto,
        row.red_driver,
        row.blue_driver,
        row.red_penalty,
        row.blue_penalty,
        det ? JSON.stringify(det) : null
      )
    }

    for (const s of bundle.skills || []) {
      run(
        `INSERT INTO skills(sku,team,type,rank,attempts,score) VALUES(?,?,?,?,?,?)
         ON CONFLICT(sku,team,type) DO UPDATE SET rank=excluded.rank, attempts=excluded.attempts, score=excluded.score`,
        sku,
        String(s.team || '').trim(),
        num(s.type) ?? 2,
        num(s.rank),
        num(s.attempts),
        num(s.score)
      )
    }

    for (const a of bundle.awards || []) {
      run('INSERT INTO awards(sku,name,team,ordering) VALUES(?,?,?,?)', sku, a.name || null, String(a.team || '').trim() || null, num(a.order) ?? 0)
    }

    for (const v of bundle.videos || []) {
      run(
        'INSERT INTO videos(sku,youtube_id,label,stream_start,duration_s,field,notes) VALUES(?,?,?,?,?,?,?)',
        sku,
        v.youtube_id,
        v.label || null,
        v.stream_start || null,
        num(v.duration_s),
        v.field || null,
        v.notes || null
      )
    }

    // Sources disagree about event dates (VexDB frequently omits them). Derive the
    // range from the match schedule so the header and reports are never dateless.
    if (!ev.start_date) {
      const range = get(
        // Ignore null/epoch timestamps that some sources emit for unplayed matches.
        "SELECT MIN(scheduled) AS start, MAX(scheduled) AS finish FROM matches WHERE sku = ? AND scheduled IS NOT NULL AND scheduled > '2000-01-01'",
        sku
      )
      if (range?.start) {
        run('UPDATE events SET start_date = ?, end_date = ? WHERE sku = ?', range.start, range.finish || range.start, sku)
      }
    }
  })
  return sku
}

// ---- videos & alignment -------------------------------------------------

export function listVideos(sku) {
  return all('SELECT * FROM videos WHERE sku = ? ORDER BY stream_start, id', sku)
}
export function addVideo(sku, v) {
  const r = run(
    'INSERT INTO videos(sku,youtube_id,label,stream_start,duration_s,field,notes) VALUES(?,?,?,?,?,?,?)',
    sku,
    v.youtube_id,
    v.label || null,
    v.stream_start || null,
    num(v.duration_s),
    v.field || null,
    v.notes || null
  )
  return Number(r.lastInsertRowid)
}
export function removeVideo(id) {
  run('DELETE FROM videos WHERE id = ?', id)
  run('DELETE FROM match_media WHERE video_id = ?', id)
}
export function listMatchMedia(sku) {
  return all(
    `SELECT mm.* FROM match_media mm JOIN matches m ON m.match_key = mm.match_key WHERE m.sku = ?`,
    sku
  )
}
export function setMatchMedia(matchKeyValue, media) {
  run(
    `INSERT INTO match_media(match_key,video_id,offset_s,seek_s,confidence,source) VALUES(?,?,?,?,?,?)
     ON CONFLICT(match_key) DO UPDATE SET video_id=excluded.video_id, offset_s=excluded.offset_s,
       seek_s=excluded.seek_s, confidence=excluded.confidence, source=excluded.source`,
    matchKeyValue,
    media.video_id ?? null,
    num(media.offset_s) ?? 0,
    num(media.seek_s),
    num(media.confidence),
    media.source || 'auto'
  )
}

// ---- score events (the match timeline) ----------------------------------

export function listScoreEvents(matchKeyValue) {
  return all('SELECT * FROM score_events WHERE match_key = ? ORDER BY t_s, id', matchKeyValue)
}
export function addScoreEvent(matchKeyValue, ev) {
  const r = run(
    'INSERT INTO score_events(match_key,t_s,alliance,points,note,source,created_at) VALUES(?,?,?,?,?,?,?)',
    matchKeyValue,
    num(ev.t_s) ?? 0,
    ev.alliance === 'blue' ? 'blue' : 'red',
    num(ev.points) ?? 1,
    ev.note || null,
    ev.source || 'manual',
    new Date().toISOString()
  )
  return Number(r.lastInsertRowid)
}
export function removeScoreEvent(id) {
  run('DELETE FROM score_events WHERE id = ?', id)
}
export function clearScoreEvents(matchKeyValue) {
  run('DELETE FROM score_events WHERE match_key = ?', matchKeyValue)
}

// ---- scouting -----------------------------------------------------------

export function getScouting(sku, team) {
  const row = get('SELECT data FROM scouting WHERE sku = ? AND team = ?', sku, team)
  if (!row) return null
  return safeJson(row.data)
}
export function listScouting(sku) {
  return all('SELECT team, data, updated_at FROM scouting WHERE sku = ?', sku).map((r) => ({
    team: r.team,
    data: safeJson(r.data) || {},
    updated_at: r.updated_at
  }))
}
export function setScouting(sku, team, data) {
  run(
    `INSERT INTO scouting(sku,team,data,updated_at) VALUES(?,?,?,?)
     ON CONFLICT(sku,team) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at`,
    sku,
    team,
    JSON.stringify(data || {}),
    new Date().toISOString()
  )
}
