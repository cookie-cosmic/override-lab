import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useLookupHistory } from '../team/data.js'
import { fmt, pct } from '../api.js'
import { Badge, Btn, Card, Empty, Field, Note, ProbBar, Stat } from '../components/ui.jsx'
import { simulate } from './Alliance.jsx'

/**
 * Match simulation.
 *
 * Uses the same Monte-Carlo engine as Alliance Strategy (`simulate`), not a second one. Each
 * team contributes its own season average and spread; nothing is invented for a team with no
 * scored matches.
 */
export default function MatchSim({ query, sku }) {
  const { records, loading, errors, load } = useLookupHistory()
  const [red, setRed] = useState({ a: query?.get('red')?.split(',')[0] || '', b: query?.get('red')?.split(',')[1] || '' })
  const [blue, setBlue] = useState({ a: query?.get('blue')?.split(',')[0] || '', b: query?.get('blue')?.split(',')[1] || '' })
  const [result, setResult] = useState(null)
  const [message, setMessage] = useState(null)
  const loaded = useRef(new Set())

  const numbers = useMemo(() => [red.a, red.b, blue.a, blue.b].map((v) => String(v || '').trim().toUpperCase()).filter(Boolean), [red, blue])

  useEffect(() => {
    for (const n of numbers) {
      if (loaded.current.has(n)) continue
      loaded.current.add(n)
      load(n)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numbers.join(','), load])

  const profile = (n) => (n ? records[String(n).trim().toUpperCase()] : null)
  const redProfiles = [red.a, red.b].map(profile).filter(Boolean)
  const blueProfiles = [blue.a, blue.b].map(profile).filter(Boolean)

  const run = () => {
    setMessage(null)
    if (!redProfiles.length || !blueProfiles.length) {
      setMessage('Enter at least one team on each side. A team without a scored match this season has no distribution, so no estimate is produced.')
      return
    }
    const missing = [red.a, red.b, blue.a, blue.b]
      .map((v) => String(v || '').trim().toUpperCase())
      .filter((v) => v && !records[v]?.avgScore)
    if (missing.length) {
      setMessage(`${missing.join(', ')} has no scored matches this season, so it cannot be simulated. Teams listed without a distribution are left out rather than guessed.`)
      return
    }
    setResult({ out: simulate(redProfiles, blueProfiles), red: redProfiles, blue: blueProfiles, at: new Date().toISOString() })
  }

  const field = (side, setSide, tone) => (
    <div className="sim-side">
      <h4 style={{ color: tone }}>{tone === 'var(--red)' ? 'Red alliance' : 'Blue alliance'}</h4>
      {['a', 'b'].map((slot) => (
        <Field key={slot} label={slot === 'a' ? 'Team 1' : 'Team 2 (optional)'}>
          <input
            value={side[slot]}
            onChange={(e) => setSide({ ...side, [slot]: e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 6) })}
            placeholder={slot === 'a' ? '75019D' : 'partner'}
            aria-label={`${tone === 'var(--red)' ? 'Red' : 'Blue'} ${slot === 'a' ? 'team one' : 'team two'}`}
          />
        </Field>
      ))}
      <div className="tiny dim">
        {[side.a, side.b]
          .map(profile)
          .filter(Boolean)
          .map((p) => `${p.team || p.number || 'team'}: ${p.matches} matches, ${fmt(p.avgScore)} avg`)
          .join(' · ') || 'no loaded records'}
      </div>
    </div>
  )

  return (
    <div>
      <Card title="Simulate a match" subtitle={sku ? 'prefilled from the selected tournament where possible' : 'any two alliances'}>
        <div className="brief-grid">
          {field(red, setRed, 'var(--red)')}
          {field(blue, setBlue, 'var(--blue)')}
        </div>
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <Btn variant="primary" onClick={run} disabled={loading && numbers.some((n) => !records[n])}>
            Run simulation
          </Btn>
          <Btn variant="ghost" onClick={() => { setRed({ a: '', b: '' }); setBlue({ a: '', b: '' }); setResult(null); setMessage(null) }}>
            Clear
          </Btn>
          <span className="tiny dim">20,000 trials · shared engine</span>
        </div>
        {message && <Note tone="warn">{message}</Note>}
        {Object.values(errors).filter(Boolean).map((e) => <p className="tiny bad" key={e}>{e}</p>)}
      </Card>

      {!result && <Empty>Enter teams with a scored season and run the simulation.</Empty>}

      {result && (
        <>
          <Card title="Estimated outcome" subtitle="hypothetical — never an official result">
            <div className="stat-grid">
              <Stat label="Red win" value={pct(result.out.redWin, 1)} tone="var(--red)" sub={`95% CI ${pct(result.out.ci[0], 1)}–${pct(result.out.ci[1], 1)}`} />
              <Stat label="Blue win" value={pct(result.out.blueWin, 1)} tone="var(--blue)" />
              <Stat label="Tie" value={pct(result.out.tie, 1)} />
              <Stat label="Expected score" value={`${fmt(result.out.redMean)} – ${fmt(result.out.blueMean)}`} sub={`red spread ${fmt(result.out.redSd)}`} />
            </div>
            <ProbBar value={result.out.redWin} label="Red alliance win probability" />
            <p className="tiny dim">
              Monte Carlo over each team&apos;s season average and match-to-match spread. It assumes an alliance scores
              roughly the sum of its members&apos; solo averages, which real VEX alliances do not exactly do. The interval
              is sampling error only, not model error.
            </p>
          </Card>

          <Card title="Inputs" subtitle="what the estimate rests on">
            <div className="brief-grid">
              <div>
                <h4 style={{ color: 'var(--red)' }}>Red</h4>
                {result.red.map((t) => (
                  <p className="small" key={t.team || t.number}>
                    <strong className="mono">{t.team || t.number}</strong> · {t.matches} matches · {fmt(t.avgScore)} avg ·{' '}
                    {t.cv != null ? `CV ${fmt(t.cv, 2)}` : 'spread unavailable'}
                  </p>
                ))}
              </div>
              <div>
                <h4 style={{ color: 'var(--blue)' }}>Blue</h4>
                {result.blue.map((t) => (
                  <p className="small" key={t.team || t.number}>
                    <strong className="mono">{t.team || t.number}</strong> · {t.matches} matches · {fmt(t.avgScore)} avg ·{' '}
                    {t.cv != null ? `CV ${fmt(t.cv, 2)}` : 'spread unavailable'}
                  </p>
                ))}
              </div>
            </div>
            <Note>
              Scouting and robot-testing evidence is not fed into this model. Treat the output as one comparable
              scenario, not a forecast.
            </Note>
            <Badge>{result.at && new Date(result.at).toLocaleTimeString()}</Badge>
          </Card>
        </>
      )}
    </div>
  )
}
