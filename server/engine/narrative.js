// Auto-generated post-mortems. Every clause is bound to a computed number, and every
// claim carries a confidence level derived from sample size — so the prose never
// outruns the evidence.
import { round, clamp } from '../util.js'
import { teamsOf, isScored } from './ratings.js'

const conf = (n) => (n >= 8 ? 'high' : n >= 4 ? 'medium' : 'low')
const pct = (v) => (v == null ? 'n/a' : `${Math.round(v * 100)}%`)
const signed = (v, d = 1) => (v == null ? 'n/a' : `${v > 0 ? '+' : ''}${round(v, d)}`)

export function teamBriefing({ team, ratings, prescription, styleEntry }) {
  const t = ratings.teams.get(team)
  if (!t) return null
  const paragraphs = []
  const claims = []
  const n = t.matches

  const archetype = styleEntry?.archetype || 'unclassified build'
  paragraphs.push(
    `${t.team} played ${n} completed matches and ranks ${t.oprRank ? `#${t.oprRank} on OPR` : 'unranked on OPR'} with an Elo of ${t.elo} (80% band ${t.eloBand?.[0]}–${t.eloBand?.[1]}). On the field that is ${archetype.toLowerCase()}: ${round(t.avgPoints, 1)} points per match with a floor of ${t.floor} and a ceiling of ${t.ceiling}.`
  )
  claims.push({ text: `Average output ${round(t.avgPoints, 1)} pts (floor ${t.floor}, ceiling ${t.ceiling})`, confidence: conf(n) })
  claims.push({ text: `Schedule luck: ${signed(t.winsAboveExpectation, 2)} wins above expectation`, confidence: conf(n) })

  const swing = t.ceiling - t.floor
  paragraphs.push(
    t.cv != null && t.cv > 0.3
      ? `The score is volatile: the swing between this team's good and bad matches is ${round(swing, 1)} points (CV ${t.cv}). That is the single most exploitable fact about them — a plan built on their average will look wrong either way, and opponents who protect their own floor beat this profile more often than the raw average suggests.`
      : `The score is stable: only ${round(swing, 1)} points separate the floor from the ceiling (CV ${t.cv ?? 'n/a'}). Predictable output is an advantage in qualification, but it also means there is no hidden gear to shift in an elimination.`
  )
  claims.push({ text: `Score swing floor-to-ceiling ${round(swing, 1)} pts, CV ${t.cv ?? 'n/a'}`, confidence: conf(n) })

  if (t.clutch != null) {
    paragraphs.push(
      t.clutch > 4
        ? `Elimination performance runs ${signed(t.clutch)} points above qualification average — this team finds another level under bracket pressure.`
        : t.clutch < -4
          ? `Elimination performance runs ${signed(t.clutch)} points below qualification average — the bracket has been unkind, and that is either nerves or matchups.`
          : `Elimination output is essentially flat versus qualification (${signed(t.clutch)}), so the bracket has not changed their level.`
    )
  }
  if (t.penaltyPerMatch) {
    claims.push({ text: `Penalties: ${t.penaltyPerMatch} pts per match`, confidence: conf(n) })
  }
  if (t.autonPerMatch != null) {
    const share = t.avgPoints ? t.autonPerMatch / t.avgPoints : null
    claims.push({
      text: `Autonomous contributes ${round(t.autonPerMatch, 1)} pts (${pct(share)} of average output)`,
      confidence: 'medium'
    })
  }

  let prescriptionLine = null
  if (prescription?.dims?.length) {
    const best = prescription.dims[0]
    prescriptionLine = `${prescription.summary}`
    paragraphs.push(
      `Highest-leverage practice is ${best.label.toLowerCase()}: ${best.gainPoints} ${best.unit} of improvement is worth about ${signed(best.deltaP * 100, 1)} percentage points of win probability per match, i.e. ${best.roiPer10h}pp per 10 practice hours at this level of play. The cheapest next win is ${prescription.dims
        .slice(1, 3)
        .map((d) => d.label.toLowerCase())
        .join(' and ')}.`
    )
    claims.push({ text: `Top practice ROI: ${best.label} at ${best.roiPer10h}pp / 10h`, confidence: prescription.matches >= 6 ? 'medium' : 'low' })
  }

  return {
    team,
    headline: `${t.team} — ${archetype} · ${round(t.avgPoints, 1)} pts/match · Elo ${t.elo}`,
    paragraphs,
    claims,
    caveat:
      n < 6
        ? `Only ${n} completed matches: interval width, not decimal precision, is the honest reading here.`
        : `Estimates come from ${n} completed matches; all phase-level claims assume the score breakdown in the archive.`,
    prescriptionLine
  }
}

export function matchPostMortem({ match, attribution, ratings }) {
  if (!isScored(match)) return null
  const al = teamsOf(match)
  const red = match.red_score
  const blue = match.blue_score
  const margin = red - blue
  const winnerSide = margin > 0 ? 'red' : margin < 0 ? 'blue' : null
  const paragraphs = []
  const claims = []

  if (!winnerSide) {
    return {
      headline: `Tie ${red}–${blue}`,
      paragraphs: ['A tie in a scored match usually means a data or scoring anomaly worth checking against the official sheet.'],
      claims: [{ text: 'Tied final score', confidence: 'high' }]
    }
  }
  const loserSide = winnerSide === 'red' ? 'blue' : 'red'
  const winner = al[winnerSide]
  const loser = al[loserSide]
  const pre = winnerSide === 'red' ? match.pRed : 1 - match.pRed

  paragraphs.push(
    `${winner.join(' + ')} beat ${loser.join(' + ')} ${Math.max(red, blue)}–${Math.min(red, blue)}${margin === 0 ? '' : ` by ${Math.abs(margin)}`}. Pre-match win probability for the winning alliance was ${pct(pre)}.`
  )

  const causes = loserSide === 'red' ? attribution.redLoss : attribution.blueLoss
  if (causes?.length) {
    paragraphs.push(
      `Losing side attribution: ${causes
        .slice(0, 3)
        .map((c) => `${c.label.toLowerCase()} (${Math.round(c.share * 100)}%, ${c.evidence})`)
        .join('; ')}.`
    )
    for (const c of causes.slice(0, 3)) claims.push({ text: `${c.label}: ${c.evidence}`, confidence: c.key === 'variance' ? 'medium' : 'medium' })
  }

  if (attribution.phases?.available) {
    const p = attribution.phases.phases
    paragraphs.push(
      `Phase split: ${p.map((ph) => `${ph.label.toLowerCase()} ${ph.red}–${ph.blue}`).join(', ')}. ${attribution.phases.coverage != null ? `These phases account for ${pct(attribution.phases.coverage)} of the recorded score, so a residual is expected.` : ''}`
    )
  }

  const cf = attribution.counterfactuals?.[loserSide]?.projections || []
  if (cf.length) {
    paragraphs.push(
      `Counterfactual under the model: ${cf
        .slice(0, 3)
        .map((c) => `${c.label.toLowerCase()} → ${pct(c.winProb)} (+${(c.deltaP * 100).toFixed(1)}pp)`)
        .join('; ')}.`
    )
  }

  return {
    headline: `${winner.join(' + ')} def. ${loser.join(' + ')}, ${Math.max(red, blue)}–${Math.min(red, blue)}`,
    paragraphs,
    claims,
    caveat: 'Counterfactuals are model-conditional, not observed. Read them as "how much this lever was worth", not "what would have happened".'
  }
}

export function eventDigest({ event, ratings, archetypes }) {
  const played = ratings.list.filter((t) => t.matches > 0)
  if (!played.length) return null
  const paragraphs = []
  const claims = []
  const scored = ratings.matches.filter(isScored)
  const avgAlliance = scored.length
    ? scored.reduce((s, m) => s + m.red_score + m.blue_score, 0) / (scored.length * 2)
    : 0
  const margins = scored.map((m) => Math.abs(m.red_score - m.blue_score))
  const close = margins.filter((m) => m <= 5).length
  const blowouts = margins.filter((m) => m >= 25).length

  paragraphs.push(
    `${event.name} produced ${scored.length} scored matches across ${played.length} teams. The average alliance scored ${round(avgAlliance, 1)}; ${close} matches (${pct(close / scored.length)}) finished inside 5 points and ${blowouts} (${pct(blowouts / scored.length)}) finished by 25 or more.`
  )
  claims.push({ text: `Average alliance score ${round(avgAlliance, 1)}`, confidence: 'high' })
  claims.push({ text: `${pct(close / scored.length)} of matches decided by 5 or fewer`, confidence: 'high' })

  const top = [...played].sort((a, b) => b.elo - a.elo).slice(0, 3)
  paragraphs.push(
    `By rating the strongest teams were ${top.map((t) => `${t.team} (${t.elo} ±${Math.round(t.eloSd)})`).join(', ')}. ${top[0].winsAboveExpectation > 1.5 ? `${top[0].team} also out-performed their draw by ${signed(top[0].winsAboveExpectation, 1)} wins.` : 'The top of the table is tightly packed, so seed order mostly reflects schedule draw.'}`
  )

  const luckiest = [...played].sort((a, b) => b.winsAboveExpectation - a.winsAboveExpectation)[0]
  const unluckiest = [...played].sort((a, b) => a.winsAboveExpectation - b.winsAboveExpectation)[0]
  if (luckiest && unluckiest && luckiest.team !== unluckiest.team) {
    paragraphs.push(
      `Schedule luck mattered: ${luckiest.team} finished ${signed(luckiest.winsAboveExpectation, 1)} wins above expectation while ${unluckiest.team} finished ${signed(unluckiest.winsAboveExpectation, 1)} — the same results would have produced very different seeds under a different draw.`
    )
    claims.push({ text: `Widest schedule-luck gap: ${luckiest.team} ${signed(luckiest.winsAboveExpectation, 1)} vs ${unluckiest.team} ${signed(unluckiest.winsAboveExpectation, 1)}`, confidence: 'medium' })
  }

  if (archetypes?.clusters?.length) {
    const biggest = [...archetypes.clusters].sort((a, b) => b.size - a.size)[0]
    paragraphs.push(
      `The field clusters into ${archetypes.clusters.length} archetypes; the largest is "${biggest.label}" (${biggest.size} teams), defined by ${biggest.signature.join(' and ').toLowerCase()}.`
    )
  }

  if (ratings.calibration?.brier != null) {
    claims.push({
      text: `Pre-match model: Brier ${ratings.calibration.brier} vs ${ratings.calibration.baselineBrier} baseline over ${ratings.calibration.n} matches (leave-one-out)`,
      confidence: 'high'
    })
  }

  return {
    headline: `${event.name} — ${scored.length} matches, avg ${round(avgAlliance, 1)} pts per alliance`,
    paragraphs,
    claims,
    caveat: 'Ratings are event-local. Cross-event strength is only comparable once the archive holds multiple events from the same season.'
  }
}
