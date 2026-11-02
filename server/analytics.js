// Cache layer: builds the rating model + archetypes once per event, invalidated on writes.
import * as db from './db.js'
import { buildRatings } from './engine/ratings.js'
import { buildArchetypes } from './engine/style.js'

const cache = new Map()

export function analysis(sku, { fresh = false } = {}) {
  if (!fresh && cache.has(sku)) return cache.get(sku)
  const event = db.getEvent(sku)
  if (!event) return null
  const matches = db.getMatches(sku)
  const teams = db.getTeams(sku)
  const rankings = db.getRankings(sku)
  const skills = db.getSkills(sku)
  const ratings = buildRatings({ sku, matches, teams, rankings, skills })
  const scouting = db.listScouting(sku)
  const archetypes = buildArchetypes(ratings, scouting)
  const out = {
    event,
    ratings,
    archetypes,
    scouting,
    videos: db.listVideos(sku),
    media: db.listMatchMedia(sku),
    awards: db.getAwards(sku)
  }
  cache.set(sku, out)
  return out
}

export function invalidate(sku = null) {
  if (sku) cache.delete(sku)
  else cache.clear()
}
