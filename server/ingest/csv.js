// Tournament Manager CSV import.
//
// TM's File -> Export produces "Match List" / "Team List" CSVs. These are the only
// documented export path, and they carry two things the public APIs do not: field
// assignments and scheduled start times — both required for video alignment.
//
// Header names vary by TM version, so columns are matched fuzzily.
import { parseCsv, looseDate, num } from '../util.js'

const pick = (headers, candidates) => {
  for (const cand of candidates) {
    const idx = headers.findIndex((h) => h.toLowerCase().replace(/[^a-z0-9]/g, '') === cand)
    if (idx >= 0) return idx
  }
  for (const cand of candidates) {
    const idx = headers.findIndex((h) => h.toLowerCase().replace(/[^a-z0-9]/g, '').includes(cand))
    if (idx >= 0) return idx
  }
  return -1
}

export function looksLikeMatchCsv(text) {
  const first = String(text).split(/\r?\n/)[0] || ''
  const h = first.toLowerCase()
  return /match|red1|red 1/.test(h) && /red|blue/.test(h)
}

/**
 * Parse a TM "Match List" export into match rows.
 * Expected-ish columns: Match, Field, Red1, Red2, Red3, Blue1, Blue2, Blue3,
 * Red Score, Blue Score, Scheduled, Division, Round, Instance
 */
export function parseMatchCsv(text, sku) {
  const rows = parseCsv(text)
  if (!rows.length) throw new Error('CSV is empty')
  const headers = rows[0].map((h) => String(h).trim())
  const H = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''))

  const c = {
    match: pick(H, ['match', 'matchnumber', 'matchnum', 'matchno']),
    field: pick(H, ['field', 'fieldname']),
    red1: pick(H, ['red1', 'red1team', 'redrobot1']),
    red2: pick(H, ['red2', 'red2team', 'redrobot2']),
    red3: pick(H, ['red3', 'red3team', 'redrobot3']),
    blue1: pick(H, ['blue1', 'blue1team', 'bluerobot1']),
    blue2: pick(H, ['blue2', 'blue2team', 'bluerobot2']),
    blue3: pick(H, ['blue3', 'blue3team', 'bluerobot3']),
    redScore: pick(H, ['redscore', 'redpoints', 'redtotal']),
    blueScore: pick(H, ['bluescore', 'bluepoints', 'bluetotal']),
    scheduled: pick(H, ['scheduled', 'starttime', 'time', 'scheduledtime']),
    division: pick(H, ['division', 'div']),
    round: pick(H, ['round', 'roundname']),
    instance: pick(H, ['instance', 'roundinstance'])
  }
  if (c.match < 0 || c.red1 < 0) throw new Error('Could not find match / red1 columns in CSV header')

  const roundFromName = (v) => {
    const s = String(v || '').toLowerCase()
    if (!s) return 2
    if (s.includes('practice')) return 1
    if (s.includes('qual')) return 2
    if (s.includes('quarter')) return 3
    if (s.includes('semi')) return 4
    if (s.includes('final')) return 5
    if (s === '16' || s.includes('round of 16')) return 6
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : 2
  }

  const out = []
  for (const r of rows.slice(1)) {
    const get = (i) => (i >= 0 ? String(r[i] ?? '').trim() : '')
    const matchnum = num(get(c.match))
    if (matchnum === null) continue
    out.push({
      division: get(c.division) || 'Default',
      round: roundFromName(get(c.round)),
      instance: num(get(c.instance)) ?? 1,
      matchnum,
      field: get(c.field) || null,
      scheduled: looseDate(get(c.scheduled)),
      scored: num(get(c.redScore)) !== null && num(get(c.blueScore)) !== null ? 1 : 0,
      red1: get(c.red1),
      red2: get(c.red2),
      red3: get(c.red3),
      blue1: get(c.blue1),
      blue2: get(c.blue2),
      blue3: get(c.blue3),
      redscore: num(get(c.redScore)),
      bluescore: num(get(c.blueScore))
    })
  }
  return { matches: out, headers }
}

/** Parse a TM "Team List" export. */
export function parseTeamCsv(text) {
  const rows = parseCsv(text)
  if (!rows.length) return []
  const headers = rows[0].map((h) => String(h).trim())
  const H = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''))
  const c = {
    number: pick(H, ['number', 'teamnumber', 'team']),
    name: pick(H, ['teamname', 'name']),
    org: pick(H, ['organization', 'organisation', 'school']),
    city: pick(H, ['city']),
    region: pick(H, ['state', 'region', 'province']),
    country: pick(H, ['country'])
  }
  if (c.number < 0) return []
  return rows
    .slice(1)
    .map((r) => {
      const get = (i) => (i >= 0 ? String(r[i] ?? '').trim() : '')
      const number = get(c.number)
      if (!number) return null
      return { number, name: get(c.name) || null, org: get(c.org) || null, city: get(c.city) || null, region: get(c.region) || null, country: get(c.country) || null }
    })
    .filter(Boolean)
}
