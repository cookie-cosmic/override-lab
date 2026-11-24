import React, { useEffect, useMemo, useState } from 'react'
import { useTeam } from '../team/TeamContext.jsx'
import { useLookupHistory } from '../team/data.js'
import { useTeamStore } from '../team/TeamContext.jsx'
import { Badge, Btn, Card, Empty, Note, Stat, Table, Tabs } from '../components/ui.jsx'
import Icon from '../components/Icons.jsx'
import { navigate } from '../router.js'
import { fmt, pct } from '../api.js'

/**
 * A transparent 2v2 estimate.
 *
 * Each team contributes its own season average and spread; the alliance's score is the sum of
 * two draws from those distributions, and the win rate is the share of simulated matches the
 * alliance wins. This is a stated model, not a claim about VEX scoring mechanics: two robots on
 * one alliance do not literally add their solo averages, and the page says so wherever the
 * number appears.
 */
function simulate(redTeams, blueTeams, trials = 20000) {
  if (!redTeams.length || !blueTeams.length) return null
  const draw = (t) => {
    const mean = t.avgScore
    const sd = t.sd || Math.max(5, mean * 0.18)
    // Box–Muller, clamped away from impossible negative scores.
    const u = Math.random() || 1e-9
    const v = Math.random() || 1e-9
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
    return Math.max(0, mean + z * sd)
  }
  let redWins = 0
  let blueWins = 0
  let ties = 0
  let redSum = 0
  let blueSum = 0
  let redSq = 0
  for (let i = 0; i < trials; i++) {
    const r = Math.round(redTeams.reduce((s, t) => s + draw(t), 0))
    const b = Math.round(blueTeams.reduce((s, t) => s + draw(t), 0))
    redSum += r
    blueSum += b
    redSq += r * r
    if (r > b) redWins++
    else if (b > r) blueWins++
    else ties++
  }
  const redMean = redSum / trials
  const redSd = Math.sqrt(Math.max(0, redSq / trials - redMean * redMean))
  const p = redWins / trials
  const se = Math.sqrt((p * (1 - p)) / trials)
  return {
    trials,
    redWin: p,
    blueWin: blueWins / trials,
    tie: ties / trials,
    redMean,
    blueMean: blueSum / trials,
    redSd,
    ci: [Math.max(0, p - 1.96 * se), Math.min(1, p + 1.96 * se)],
    se
  }
}

function components(a, b) {
  const rows = []
  const push = (label, weight, value, text, available = true) => rows.push({ label, weight, value, text, available })
  if (a.avgScore != null && b.avgScore != null) {
    const balance = Math.min(a.avgScore, b.avgScore) / Math.max(a.avgScore, b.avgScore)
    push('Scoring balance', 30, balance, `${fmt(a.avgScore)} and ${fmt(b.avgScore)} average alliance score: both can carry a match.`)
  } else push('Scoring balance', 30, null, 'One team has no scored matches this season.', false)

  if (a.cv != null && b.cv != null) {
    const consistency = Math.max(0, 1 - (a.cv + b.cv) / 2)
    push('Consistency', 25, consistency, `Match-to-match spread (CV ${fmt(a.cv, 2)} and ${fmt(b.cv, 2)}): lower spread makes alliance planning safer.`)
  } else push('Consistency', 25, null, 'Needs at least two scored matches for each team.', false)

  if (a.matches && b.matches) {
    const experience = Math.min(1, Math.min(a.matches, b.matches) / 12)
    push('Sample size', 15, experience, `${a.matches} and ${b.matches} scored matches: how much the comparison rests on.`)
  } else push('Sample size', 15, null, 'Not enough recorded matches.', false)

  if (a.winRate != null && b.winRate != null) {
    const form = (a.winRate + b.winRate) / 2
    push('Record', 20, form, `Win rates ${pct(a.winRate)} and ${pct(b.winRate)}; ties count half.`)
  } else push('Record', 20, null, 'No win rate available.', false)

  // Scouting-only inputs are named rather than invented.
  push('Autonomous overlap', 0, null, 'Needs scouting notes on both starting positions and routines.', false)
  push('AWP potential', 0, null, 'Needs recorded autonomous results; the season history does not publish AWP.', false)
  push('Role conflict', 0, null, 'Needs scouting roles (scorer, toggle, defender).', false)
  return rows
}

function scoreFrom(rows) {
  const usable = rows.filter((r) => r.available && r.weight > 0 && r.value != null)
  const weight = usable.reduce((s, r) => s + r.weight, 0)
  if (!weight) return null
  const raw = usable.reduce((s, r) => s + r.value * r.weight, 0) / weight
  return { value: raw, covered: weight }
}

function TeamInput({ label, value, onChange, onLookup, profile, loading, error }) {
  return (
    <div className="team-input">
      <label>
        <span className="tiny dim">{label}</span>
        <div className="row" style={{ gap: 6 }}>
          <input value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} placeholder="team number" maxLength={8} />
          <Btn size="sm" onClick={() => onLookup(value)} disabled={!value || loading}>
            {loading ? '…' : 'Load'}
          </Btn>
        </div>
      </label>
      {error && <span className="tiny bad">{error}</span>}
      {profile && (
        <span className="tiny dim">
          {profile.matches ? `${profile.matches} matches · ${fmt(profile.avgScore)} avg · ${pct(profile.winRate)} adjusted win rate` : 'no scored matches this season'}
        </span>
      )}
    </div>
  )
}

export default function Alliance({ sku }) {
  const { active } = useTeam()
  const { records, loading, errors, load } = useLookupHistory()
  const { value: saved, save: saveSaved } = useTeamStore('alliance-scenarios', { items: [] })
  const [partner, setPartner] = useState('')
  const [opp1, setOpp1] = useState('')
  const [opp2, setOpp2] = useState('')
  const [name, setName] = useState('')
  const [result, setResult] = useState(null)
  const [runError, setRunError] = useState(null)
  const [tab, setTab] = useState('fit')
  const { value: board, save: saveBoard } = useTeamStore('selection-board', { items: [] })
  const [candidate, setCandidate] = useState('')
  const [candidateNote, setCandidateNote] = useState('')

  useEffect(() => {
    if (active?.number) load(active.number)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.number])

  const own = active ? records[active.number] : null
  const a = active ? records[active.number] : null
  const b = partner ? records[partner] : null
  const c = opp1 ? records[opp1] : null
  const d = opp2 ? records[opp2] : null

  const rows = useMemo(() => (a && b ? components(a, b) : []), [a, b])
  const fit = useMemo(() => scoreFrom(rows), [rows])

  const run = () => {
    setRunError(null)
    if (!a || !b || !c) {
      setRunError('Load the active team, a partner and at least one opponent before simulating.')
      return
    }
    if (!a.avgScore || !b.avgScore || !c.avgScore) {
      setRunError('A team without scored matches has no distribution to draw from, so no estimate is produced.')
      return
    }
    const red = [a, b]
    const blue = d?.avgScore ? [c, d] : [c]
    const out = simulate(red, blue)
    setResult({ out, red, blue, createdAt: new Date().toISOString() })
  }

  const saveScenario = () => {
    if (!result) return
    const entry = {
      id: `${Date.now()}`,
      name: name.trim() || `${active.number} + ${partner}`,
      savedAt: new Date().toISOString(),
      red: [active.number, partner],
      blue: [opp1, opp2].filter(Boolean),
      result: result.out,
      fit: fit?.value ?? null
    }
    saveSaved((prev) => ({ items: [entry, ...(prev.items || [])].slice(0, 25) }))
    setName('')
  }

  if (!active) {
    return (
      <Empty>
        Choose a team first — alliance defaults follow the active team.{' '}
        <button className="link" onClick={() => navigate('welcome')}>Enter a team number</button>.
      </Empty>
    )
  }

  return (
    <div>
      <Card title="Alliance Strategy" subtitle={`${active.number} is pre-filled as your alliance participant`}>
        <div className="alliance-inputs">
          <div className="alliance-self">
            <span className="tiny dim">Your team</span>
            <strong>{active.number}</strong>
            {own ? (
              <span className="tiny dim">{own.matches ? `${own.matches} matches · ${fmt(own.avgScore)} avg` : 'no scored matches'}</span>
            ) : (
              <span className="tiny dim">loading…</span>
            )}
          </div>
          <TeamInput
            label="Partner"
            value={partner}
            onChange={setPartner}
            onLookup={(v) => load(v)}
            profile={b}
            loading={loading[partner]}
            error={errors[partner]}
          />
          <TeamInput label="Opponent 1" value={opp1} onChange={setOpp1} onLookup={(v) => load(v)} profile={c} loading={loading[opp1]} error={errors[opp1]} />
          <TeamInput label="Opponent 2" value={opp2} onChange={setOpp2} onLookup={(v) => load(v)} profile={d} loading={loading[opp2]} error={errors[opp2]} />
        </div>

      </Card>

      <Tabs
        tabs={[
          { id: 'fit', label: 'Compatibility' },
          { id: 'predict', label: 'Match predictions' },
          { id: 'board', label: 'Selection board', count: board.items?.length },
          { id: 'method', label: 'Model & method' }
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'predict' && (
        <Card title="2v2 match prediction" subtitle="red alliance versus blue alliance, from recorded scores">
          <div className="row" style={{ marginBottom: 8 }}>
            <Btn variant="primary" onClick={run} disabled={!partner}>Run 2v2 estimate</Btn>
            <span className="tiny dim">20,000 draws · normal approximation · see Model &amp; method</span>
          </div>
          <p className="tiny dim">
            Red: {active.number}{partner ? ` + ${partner}` : ' + partner'} · Blue: {[opp1, opp2].filter(Boolean).join(' + ') || 'choose opponents above'}
          </p>
          {runError && <Note tone="warn">{runError}</Note>}
          {!result && !runError && <p className="dim small">Load a partner and at least one opponent, then run the estimate. No prediction is produced when a team has no scored matches.</p>}
        </Card>
      )}

      {tab === 'fit' && (!a || !b) && (
        <Card title="Partner compatibility" subtitle="load two teams to compare them">
          <Empty>
            Enter a partner above and press Load. The active team is already filled in; nothing is estimated until both
            teams have a public record.
          </Empty>
        </Card>
      )}

      {tab === 'fit' && a && b && (
        <Card title={`Compatibility · ${a.team} + ${b.team}`} subtitle="each component is shown, not hidden in one number">
          {!fit ? (
            <p className="dim small">Not enough shared signals to score this pair yet.</p>
          ) : (
            <>
              <div className="fit-head">
                <div className="fit-score">{Math.round(fit.value * 100)}<span>/100</span></div>
                <div>
                  <div className="small">
                    Weighted from {fit.covered}% of the available factors. Missing factors are listed below instead of
                    being guessed.
                  </div>
                  <div className="tiny dim">
                    Sample: {Math.min(a.matches, b.matches)} shared-season matches minimum · {a.season || active.seasonLabel}
                  </div>
                </div>
              </div>
              <Table head={['Factor', 'Weight', 'Value', 'What it uses']}>
                {rows.map((r) => (
                  <tr key={r.label} className={r.available ? '' : 'dim'}>
                    <td>{r.label}</td>
                    <td className="mono">{r.weight ? `${r.weight}%` : '—'}</td>
                    <td className="mono">{r.value == null ? 'not available' : `${Math.round(r.value * 100)}%`}</td>
                    <td className="small">{r.text}</td>
                  </tr>
                ))}
              </Table>
            </>
          )}
          <div className="fit-notes">
            <div>
              <h3>Complementary strengths</h3>
              <p className="small">
                {a.avgScore != null && b.avgScore != null
                  ? `${a.avgScore >= b.avgScore ? a.team : b.team} carries the higher average score (${fmt(Math.max(a.avgScore, b.avgScore))}); ${a.avgScore < b.avgScore ? a.team : b.team} is the lower-volume side (${fmt(Math.min(a.avgScore, b.avgScore))}).`
                  : 'Needs both season averages.'}
              </p>
            </div>
            <div>
              <h3>Recommended role division</h3>
              <p className="small">
                {a.cv != null && b.cv != null
                  ? `${a.cv <= b.cv ? a.team : b.team} has the steadier record, so it is the safer scoring anchor; the other takes the higher-variance role.`
                  : 'Record more matches, or add scouting roles, before assigning roles.'}
              </p>
            </div>
            <div>
              <h3>Strategic conflicts</h3>
              <p className="small">
                Starting-position and autonomous overlap need scouting notes or recorded routines — this page will not
                invent them from match scores.
              </p>
            </div>
          </div>
        </Card>
      )}

      {tab === 'predict' && result && (
        <Card title="2v2 estimate" subtitle={`${result.red.map((t) => t.team).join(' + ')} vs ${result.blue.map((t) => t.team).join(' + ')}`}>
          <div className="stat-row">
            <Stat label="Red win" value={pct(result.out.redWin, 1)} sub={`95% CI ${pct(result.out.ci[0], 1)}–${pct(result.out.ci[1], 1)}`} />
            <Stat label="Blue win" value={pct(result.out.blueWin, 1)} sub={`${result.out.tie ? pct(result.out.tie, 1) + ' tied' : 'ties included'}`} />
            <Stat label="Expected red" value={fmt(result.out.redMean)} sub={`spread ± ${fmt(result.out.redSd)}`} />
            <Stat label="Expected blue" value={fmt(result.out.blueMean)} sub={`${result.out.trials.toLocaleString()} draws`} />
          </div>
          <div className="prob red-blue">
            <span style={{ width: `${result.out.redWin * 100}%` }} />
          </div>
          <p className="tiny dim">
            {result.red.map((t) => `${t.team}: ${fmt(t.avgScore)} ± ${fmt(t.sd)}`).join(' · ')} against{' '}
            {result.blue.map((t) => `${t.team}: ${fmt(t.avgScore)} ± ${fmt(t.sd)}`).join(' · ')}
          </p>
          <div className="row" style={{ gap: 8 }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Save this scenario as…" maxLength={40} />
            <Btn size="sm" onClick={saveScenario}>Save scenario</Btn>
          </div>
          <Note>
            This is an estimate from each team&apos;s own scored matches, not a claim that alliance scores add exactly.
            With {Math.min(...result.red.map((t) => t.matches), ...result.blue.map((t) => t.matches))} or fewer matches
            per team, treat the direction as more informative than the percentage.
          </Note>
        </Card>
      )}

      {tab === 'predict' && <Card title="Saved alliance scenarios" subtitle={`${active.number} only`}>
        {!saved.items.length ? (
          <p className="dim small">Nothing saved yet. Run an estimate and keep it to compare partners later.</p>
        ) : (
          <Table head={['Scenario', 'Red', 'Blue', 'Red win', 'Saved', '']}>
            {saved.items.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td className="mono">{s.red.join(' + ')}</td>
                <td className="mono">{s.blue.join(' + ')}</td>
                <td className="mono">{pct(s.result.redWin, 1)}</td>
                <td className="mono tiny">{new Date(s.savedAt).toLocaleDateString()}</td>
                <td>
                  <Btn size="sm" variant="ghost" onClick={() => saveSaved((prev) => ({ items: prev.items.filter((x) => x.id !== s.id) }))}>
                    Delete
                  </Btn>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>}

      {tab === 'board' && (
        <Card title="Selection board" subtitle="shortlist saved in this browser for the active team">
          <div className="form-grid">
            <label>
              <span>Candidate team</span>
              <input value={candidate} onChange={(e) => setCandidate(e.target.value.toUpperCase())} placeholder="e.g. 1234A" maxLength={8} />
            </label>
            <label>
              <span>Role or note</span>
              <input value={candidateNote} onChange={(e) => setCandidateNote(e.target.value)} placeholder="scoring anchor, toggle…" maxLength={60} />
            </label>
          </div>
          <div className="row">
            <Btn
              size="sm"
              variant="primary"
              disabled={!/^[0-9]{1,5}[A-Z]?$/.test(candidate.trim())}
              onClick={() => {
                saveBoard((prev) => ({
                  items: [
                    ...(prev.items || []),
                    { id: `${Date.now()}`, team: candidate.trim(), note: candidateNote.trim() || null, available: true, order: (prev.items || []).length }
                  ]
                }))
                setCandidate('')
                setCandidateNote('')
              }}
            >
              <Icon name="plus" size={14} /> Add candidate
            </Btn>
            <span className="tiny dim">Reorder with the arrows. Marking a team unavailable keeps the note.</span>
          </div>
          {!(board.items || []).length ? (
            <Empty>No candidates shortlisted yet. Add teams as you scout them.</Empty>
          ) : (
            <Table head={['#', 'Team', 'Note', 'Status', '']}>
              {(board.items || []).map((item, i) => (
                <tr key={item.id} className={item.available ? '' : 'dim'}>
                  <td className="mono">{i + 1}</td>
                  <td className="mono">{item.team}</td>
                  <td className="small">{item.note || '—'}</td>
                  <td><Badge tone={item.available ? 'good' : 'warn'}>{item.available ? 'available' : 'unavailable'}</Badge></td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      <Btn size="sm" variant="ghost" aria-label={`Move ${item.team} up`} disabled={i === 0} onClick={() => saveBoard((prev) => {
                        const list = [...prev.items]
                        ;[list[i - 1], list[i]] = [list[i], list[i - 1]]
                        return { items: list }
                      })}>↑</Btn>
                      <Btn size="sm" variant="ghost" aria-label={`Move ${item.team} down`} disabled={i === (board.items || []).length - 1} onClick={() => saveBoard((prev) => {
                        const list = [...prev.items]
                        ;[list[i + 1], list[i]] = [list[i], list[i + 1]]
                        return { items: list }
                      })}>↓</Btn>
                      <Btn size="sm" variant="ghost" onClick={() => saveBoard((prev) => ({ items: prev.items.map((x) => (x.id === item.id ? { ...x, available: !x.available } : x)) }))}>
                        {item.available ? 'Mark unavailable' : 'Mark available'}
                      </Btn>
                      <Btn size="sm" variant="ghost" onClick={() => saveBoard((prev) => ({ items: prev.items.filter((x) => x.id !== item.id) }))}>Remove</Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {tab === 'method' && <Card title="Method">
        <p className="small dim">
          Each team&apos;s season average and standard deviation come from its scored qualification matches. The model
          draws one score per team, adds the two alliance draws, and counts wins over 20,000 simulated matches. The 95%
          interval is the simulation&apos;s own binomial uncertainty. Match-to-match correlations, robot interactions and
          scouting information are not in the model; a team with fewer than three matches contributes a distribution that
          is little more than a guess, which the confidence note above states.
        </p>
        {sku ? (
          <p className="small">
            <button type="button" className="link" onClick={() => navigate(`meta/${sku}`)}>Open the advanced event model for {sku} →</button>
          </p>
        ) : null}
        <div className="method-grid">
          <div>
            <h4>What the model uses</h4>
            <p className="small dim">Each team&apos;s season average and standard deviation from scored qualification matches, drawn once per simulated match.</p>
          </div>
          <div>
            <h4>What it cannot know</h4>
            <p className="small dim">Robot interactions, match-to-match correlation, scouting information and autonomous overlap are not in the model.</p>
          </div>
          <div>
            <h4>Confidence</h4>
            <p className="small dim">The 95% interval is simulation uncertainty only. Teams with fewer than three matches contribute little more than a guess.</p>
          </div>
          <div>
            <h4>Alliance scores, not robots</h4>
            <p className="small dim">Scores are alliance totals. Two robots do not literally add their solo averages, which is why the estimate is labelled.</p>
          </div>
        </div>
      </Card>}
    </div>
  )
}
