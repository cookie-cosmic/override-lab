// Win probability: pre-match projections and in-game curves.
//
// Pre-match: P(win) = Phi((mu_alliance - mu_opponent) / sigma_margin), where mu are
// shrunk per-team score means and sigma_margin is the observed spread of final margins
// at the event. This is deliberately interpretable: every input is a number a coach
// can argue with.
//
// In-game: a random-walk model. Remaining margin uncertainty grows like sqrt(time left),
// so P(win) = Phi(margin / sigma_remaining). It is a model, not an observation — the
// timeline it runs on must come from real score events (video tagging / OCR).
import { normCdf, normInv, clamp, sd, mean } from '../util.js'

export const MATCH_SECONDS = 120 // 15s autonomous + 105s driver (V5)

export function pFromScores(muA, muB, sigma) {
  const s = Math.max(Number(sigma) || 0, 4)
  return clamp(normCdf((muA - muB) / s), 0.001, 0.999)
}

export function inGameProb(margin, secondsRemaining, sigmaEnd, total = MATCH_SECONDS) {
  if (secondsRemaining <= 0) return margin > 0 ? 0.999 : margin < 0 ? 0.001 : 0.5
  const frac = clamp(secondsRemaining / total, 0, 1)
  const sigma = Math.max((Number(sigmaEnd) || 18) * Math.sqrt(frac), 1.2)
  return clamp(normCdf(margin / sigma), 0.001, 0.999)
}

/** Score band for one alliance: [p10, p50, p90]. */
export function scoreBand(mu, sigma, qs = [0.1, 0.5, 0.9]) {
  return qs.map((q) => Math.max(0, mu + normInv(q) * sigma))
}

export function marginPercentiles(muA, muB, sigma, qs = [0.1, 0.25, 0.5, 0.75, 0.9]) {
  return qs.map((q) => muA - muB + normInv(q) * Math.max(sigma, 4))
}

export function sigmaFromMatches(matches) {
  const margins = matches
    .filter((m) => m.red_score != null && m.blue_score != null)
    .map((m) => Math.abs(m.red_score - m.blue_score))
  if (margins.length < 4) return 18
  const s = sd(margins)
  return clamp(s, 8, 70) || 18
}

/**
 * Replays a match timeline into a win-probability curve and per-event WPA.
 * `events` come from score_events (manual tagging, OCR, or a modeled timeline).
 * If the tagged points do not add up to the official final score, the timeline is
 * rescaled to end at the official margin and flagged `estimated`.
 */
export function wpaTimeline({ events = [], finalRed = null, finalBlue = null, sigmaEnd = 18, total = MATCH_SECONDS }) {
  const sorted = [...events].filter((e) => e.alliance === 'red' || e.alliance === 'blue').sort((a, b) => a.t_s - b.t_s)
  if (!sorted.length) {
    return {
      available: false,
      reason: 'No score events tagged for this match yet.',
      series: [],
      events: [],
      totals: { red: 0, blue: 0, coverage: 0 }
    }
  }

  const rawRed = sorted.filter((e) => e.alliance === 'red').reduce((s, e) => s + e.points, 0)
  const rawBlue = sorted.filter((e) => e.alliance === 'blue').reduce((s, e) => s + e.points, 0)
  const officialTotal = (finalRed ?? 0) + (finalBlue ?? 0)
  const rawTotal = rawRed + rawBlue
  const coverage = officialTotal > 0 ? rawTotal / officialTotal : 1
  const rescale = coverage > 0.4 && coverage < 1.6 ? 1 / coverage : 1
  // A timeline that does not add up to the official score is an estimate; one covering
  // well under the match is partial and must never be read as the whole story.
  const partial = coverage < 0.9
  const estimated = Math.abs(rescale - 1) > 0.02 || coverage < 0.9 || coverage > 1.1

  let red = 0
  let blue = 0
  let prevP = inGameProb(0, total, sigmaEnd, total)
  const series = [{ t: 0, red: 0, blue: 0, margin: 0, p: prevP, wpa: 0 }]
  const scored = []

  for (const ev of sorted) {
    const pts = (Number(ev.points) || 0) * rescale
    if (ev.alliance === 'red') red += pts
    else blue += pts
    const tRem = clamp(total - ev.t_s, 0, total)
    const p = inGameProb(red - blue, tRem, sigmaEnd, total)
    const wpa = p - prevP
    scored.push({
      id: ev.id,
      t_s: ev.t_s,
      alliance: ev.alliance,
      points: Number(ev.points) || 0,
      note: ev.note || null,
      source: ev.source || 'manual',
      pBefore: prevP,
      pAfter: p,
      wpa,
      margin: red - blue
    })
    prevP = p
    series.push({ t: ev.t_s, red, blue, margin: red - blue, p, wpa })
  }

  const leverage = scored.length
    ? scored.reduce((s, e) => s + Math.abs(e.wpa), 0) / scored.length
    : 0
  const biggest = scored.slice().sort((a, b) => Math.abs(b.wpa) - Math.abs(a.wpa))[0] || null

  return {
    available: true,
    estimated,
    partial,
    coverage: Number(coverage.toFixed(3)),
    series,
    events: scored,
    leverage: Number(leverage.toFixed(4)),
    biggestSwing: biggest,
    finalMargin: red - blue,
    totals: { red, blue, coverage }
  }
}

/**
 * Fit P(win) = expit(a + b * ratingDiff/400) on observed results.
 * Returns leave-one-out Brier / log loss plus reliability bins, so the model's
 * honesty is visible in the UI rather than asserted.
 */
export function calibrationReport(samples) {
  const rows = samples.filter((s) => Number.isFinite(s.x) && (s.y === 0 || s.y === 1))
  if (rows.length < 8) return { n: rows.length, brier: null, logLoss: null, reliability: [], note: 'too few results to calibrate' }

  const fit = (data) => {
    let a = 0
    let b = 1
    for (let it = 0; it < 40; it++) {
      let g0 = 0
      let g1 = 0
      let h00 = 0
      let h01 = 0
      let h11 = 0
      for (const r of data) {
        const p = 1 / (1 + Math.exp(-(a + b * r.x)))
        const w = Math.max(p * (1 - p), 1e-9)
        g0 += r.y - p
        g1 += (r.y - p) * r.x
        h00 += w
        h01 += w * r.x
        h11 += w * r.x * r.x
      }
      const det = h00 * h11 - h01 * h01
      if (Math.abs(det) < 1e-12) break
      const da = (h11 * g0 - h01 * g1) / det
      const db = (-h01 * g0 + h00 * g1) / det
      a += da * 0.6
      b += db * 0.6
      if (Math.abs(da) + Math.abs(db) < 1e-7) break
    }
    return { a, b }
  }

  const full = fit(rows)
  let brier = 0
  let logLoss = 0
  const loo = []
  for (let i = 0; i < rows.length; i++) {
    const others = rows.filter((_, j) => j !== i)
    const { a, b } = others.length >= 8 ? fit(others) : full
    const p = clamp(1 / (1 + Math.exp(-(a + b * rows[i].x))), 0.02, 0.98)
    loo.push({ p, y: rows[i].y })
    brier += (p - rows[i].y) ** 2
    logLoss += -(rows[i].y * Math.log(p) + (1 - rows[i].y) * Math.log(1 - p))
  }
  brier /= rows.length
  logLoss /= rows.length

  const bins = Array.from({ length: 5 }, () => ({ n: 0, sumP: 0, sumY: 0 }))
  for (const r of loo) {
    const b = Math.min(4, Math.floor(r.p * 5))
    bins[b].n++
    bins[b].sumP += r.p
    bins[b].sumY += r.y
  }

  return {
    n: rows.length,
    coef: { intercept: Number(full.a.toFixed(4)), slope: Number(full.b.toFixed(4)) },
    brier: Number(brier.toFixed(4)),
    logLoss: Number(logLoss.toFixed(4)),
    baselineBrier: Number(mean(rows.map((r) => (r.y - 0.5) ** 2)).toFixed(4)),
    reliability: bins
      .filter((b) => b.n > 0)
      .map((b) => ({ n: b.n, predicted: Number((b.sumP / b.n).toFixed(3)), observed: Number((b.sumY / b.n).toFixed(3)) })),
    method: 'leave-one-out refit per match'
  }
}
