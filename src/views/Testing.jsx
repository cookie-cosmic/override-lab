import React, { useEffect, useMemo, useState } from 'react'
import { useTeam, useTeamStore } from '../team/TeamContext.jsx'
import { Badge, Btn, Card, Empty, Note, Stat, Table, Tabs } from '../components/ui.jsx'
import Icon from '../components/Icons.jsx'
import { navigate } from '../router.js'
import { fmt } from '../api.js'

const CATEGORIES = [
  { id: 'scoring', label: 'Scoring efficiency', hint: 'Cycles, successful pickups and cycle time' },
  { id: 'autonomous', label: 'Autonomous testing', hint: 'Runs, completion, navigation, AWP objectives' },
  { id: 'mechanical', label: 'Mechanical reliability', hint: 'Jams, motor, connection and battery issues' },
  { id: 'driver', label: 'Driver performance', hint: 'Cycles, control errors, toggles and defence' }
]

const today = () => new Date().toISOString().slice(0, 10)

function blankForm() {
  return {
    date: today(),
    category: 'scoring',
    robotVersion: '',
    driver: '',
    routine: '',
    goal: '',
    hypothesis: '',
    trials: '',
    successes: '',
    avgCycle: '',
    navigationFailures: '',
    controlErrors: '',
    awpMet: '',
    timeRemaining: '',
    incidents: '',
    notes: ''
  }
}

const num = (v) => (v === '' || v == null ? null : Number(v))
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null)

function aggregate(sessions) {
  const trials = sessions.reduce((s, x) => s + (Number(x.trials) || 0), 0)
  const successes = sessions.reduce((s, x) => s + (Number(x.successes) || 0), 0)
  const cycleRows = sessions.filter((x) => Number(x.avgCycle))
  const weighted = cycleRows.reduce((s, x) => s + Number(x.avgCycle) * (Number(x.trials) || 1), 0)
  const cycleWeight = cycleRows.reduce((s, x) => s + (Number(x.trials) || 1), 0)
  return {
    sessions: sessions.length,
    trials,
    successes,
    successRate: trials ? successes / trials : null,
    avgCycle: cycleWeight ? weighted / cycleWeight : null,
    incidents: sessions.reduce((s, x) => s + (Number(x.incidents) || 0), 0)
  }
}

export default function Testing() {
  const { active } = useTeam()
  const { value, save, markDirty, clearDirty } = useTeamStore('testing', { sessions: [] })
  const [tab, setTab] = useState('overview')
  const [form, setForm] = useState(blankForm)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState(null)
  const [filterCategory, setFilterCategory] = useState('all')
  const [compareA, setCompareA] = useState('')
  const [compareB, setCompareB] = useState('')

  // An open session with trials filled in is unsaved work: switching team asks first.
  useEffect(() => {
    if (open && form.trials) markDirty('a robot test session', active?.number)
    else clearDirty()
    return () => clearDirty()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, form.trials, active?.number])

  const sessions = value.sessions || []
  const versions = useMemo(() => [...new Set(sessions.map((s) => s.robotVersion).filter(Boolean))], [sessions])
  const filtered = sessions.filter((s) => (filterCategory === 'all' ? true : s.category === filterCategory))
  const overall = aggregate(filtered)
  const autonomy = aggregate(sessions.filter((s) => s.category === 'autonomous'))

  const submit = (e) => {
    e.preventDefault()
    if (!num(form.trials) || num(form.trials) <= 0) {
      setError('Record at least one trial — a session without trials cannot produce a rate.')
      return
    }
    if (num(form.successes) == null || num(form.successes) < 0 || num(form.successes) > num(form.trials)) {
      setError('Successes must be between 0 and the number of trials.')
      return
    }
    save((prev) => ({
      sessions: [
        {
          id: `${Date.now()}`,
          createdAt: new Date().toISOString(),
          date: form.date || today(),
          category: form.category,
          robotVersion: form.robotVersion.trim() || null,
          driver: form.driver.trim() || null,
          routine: form.routine.trim() || null,
          goal: form.goal.trim() || null,
          hypothesis: form.hypothesis.trim() || null,
          trials: num(form.trials),
          successes: num(form.successes),
          avgCycle: num(form.avgCycle),
          navigationFailures: num(form.navigationFailures),
          controlErrors: num(form.controlErrors),
          awpMet: num(form.awpMet),
          timeRemaining: num(form.timeRemaining),
          incidents: num(form.incidents),
          notes: form.notes.trim() || null
        },
        ...(prev.sessions || [])
      ]
    }))
    setForm(blankForm())
    setError(null)
    setOpen(false)
  }

  const groupFor = (version) => aggregate(sessions.filter((s) => (s.robotVersion || 'unlabelled') === version))
  const a = compareA ? groupFor(compareA) : null
  const b = compareB ? groupFor(compareB) : null
  const trend = [...filtered].slice(0, 10).reverse()

  if (!active) {
    return (
      <Empty>
        Choose a team first — practice sessions belong to one team.{' '}
        <button type="button" className="link" onClick={() => navigate('welcome')}>Enter a team number</button>.
      </Empty>
    )
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Robot Testing</h2>
          <p className="dim small">{active.number} · sessions stored for this team only</p>
        </div>
        <Btn size="sm" variant="primary" onClick={() => { setTab('sessions'); setOpen(true) }}>
          <Icon name="plus" size={14} /> Log session
        </Btn>
      </div>

      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'sessions', label: 'Practice sessions', count: sessions.length },
          { id: 'versions', label: 'Versions & comparisons', count: versions.length }
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'overview' && (
        <>
          {!sessions.length ? (
            <Card title="No testing sessions yet">
              <Empty>
                Record a block of trials — ten cycles, five autonomous runs, a driver set — with the configuration that
                produced them. <button type="button" className="link" onClick={() => { setTab('sessions'); setOpen(true) }}>Log the first session</button>.
              </Empty>
            </Card>
          ) : (
            <>
              <div className="stat-row">
                <Stat label="Sessions" value={overall.sessions} sub={`${overall.trials} trials`} />
                <Stat label="Success rate" value={overall.successRate == null ? '—' : `${fmt(overall.successRate * 100, 1)}%`} sub={`${overall.successes}/${overall.trials}`} />
                <Stat label="Avg cycle" value={overall.avgCycle == null ? '—' : `${fmt(overall.avgCycle, 2)}s`} sub="trial-weighted" />
                <Stat label="Autonomous trials" value={autonomy.trials} sub={autonomy.successRate == null ? 'no runs recorded' : `${fmt(autonomy.successRate * 100, 0)}% completed`} />
              </div>

              {trend.length > 1 && (
                <Card title="Success rate by session" subtitle="oldest → newest, from recorded trials">
                  <div className="trend-chart">
                    <div className="bars">
                      {trend.map((s) => {
                        const r = pct(s.successes, s.trials) || 0
                        return (
                          <div key={s.id} className="bar-col" title={`${s.date}: ${r}% (${s.successes}/${s.trials})`}>
                            <div className="bar" style={{ height: `${Math.max(4, r)}%` }} />
                            <span className="tiny dim">{r}%</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </Card>
              )}

              <Card title="Recent tests" subtitle="latest recorded sessions" right={<Btn size="sm" variant="ghost" onClick={() => setTab('sessions')}>All sessions</Btn>}>
                <Table head={['Date', 'Category', 'Version', 'Trials', 'Rate', 'Cycle']}>
                  {sessions.slice(0, 5).map((s) => (
                    <tr key={s.id}>
                      <td className="mono tiny">{s.date}</td>
                      <td>{CATEGORIES.find((c) => c.id === s.category)?.label || s.category}</td>
                      <td>{s.robotVersion || '—'}</td>
                      <td className="mono">{s.successes}/{s.trials}</td>
                      <td className="mono">{pct(s.successes, s.trials)}%</td>
                      <td className="mono">{s.avgCycle ? `${fmt(s.avgCycle, 2)}s` : '—'}</td>
                    </tr>
                  ))}
                </Table>
              </Card>
            </>
          )}

          <Card title="What these numbers mean">
            <p className="small dim">
              Success rate is recorded successes divided by recorded trials. Average cycle is weighted by trials, so a
              ten-cycle session counts more than a two-cycle check. Nothing here is inferred from match scores: if a
              measurement was not recorded, it is shown as unavailable.
            </p>
          </Card>
        </>
      )}

      {tab === 'sessions' && (
        <Card
          title="Practice sessions"
          subtitle="short structured form — only trials and successes are required"
          right={<Btn size="sm" variant={open ? 'ghost' : 'primary'} onClick={() => setOpen((v) => !v)}>{open ? 'Close' : '+ Log session'}</Btn>}
        >
          {open && (
            <form className="test-form" onSubmit={submit}>
              <div className="form-grid">
                <label>
                  <span>Date</span>
                  <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                </label>
                <label>
                  <span>Category</span>
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                    {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </label>
                <label>
                  <span>Robot version</span>
                  <input value={form.robotVersion} onChange={(e) => setForm({ ...form, robotVersion: e.target.value })} placeholder="e.g. intake v2" maxLength={40} />
                </label>
                <label>
                  <span>Driver / tester</span>
                  <input value={form.driver} onChange={(e) => setForm({ ...form, driver: e.target.value })} placeholder="optional" maxLength={40} />
                </label>
                <label>
                  <span>Trials</span>
                  <input type="number" min="1" value={form.trials} onChange={(e) => setForm({ ...form, trials: e.target.value })} required />
                </label>
                <label>
                  <span>Successes</span>
                  <input type="number" min="0" value={form.successes} onChange={(e) => setForm({ ...form, successes: e.target.value })} required />
                </label>
                <label>
                  <span>Average cycle (s)</span>
                  <input type="number" min="0" step="0.1" value={form.avgCycle} onChange={(e) => setForm({ ...form, avgCycle: e.target.value })} placeholder="optional" />
                </label>
                {form.category === 'autonomous' && (
                  <>
                    <label>
                      <span>Routine</span>
                      <input value={form.routine} onChange={(e) => setForm({ ...form, routine: e.target.value })} placeholder="routine name" maxLength={40} />
                    </label>
                    <label>
                      <span>Navigation failures</span>
                      <input type="number" min="0" value={form.navigationFailures} onChange={(e) => setForm({ ...form, navigationFailures: e.target.value })} />
                    </label>
                    <label>
                      <span>AWP objectives met</span>
                      <input type="number" min="0" value={form.awpMet} onChange={(e) => setForm({ ...form, awpMet: e.target.value })} />
                    </label>
                    <label>
                      <span>Time remaining (s)</span>
                      <input type="number" step="0.1" value={form.timeRemaining} onChange={(e) => setForm({ ...form, timeRemaining: e.target.value })} />
                    </label>
                  </>
                )}
                {form.category === 'mechanical' && (
                  <label>
                    <span>Incidents</span>
                    <input type="number" min="0" value={form.incidents} onChange={(e) => setForm({ ...form, incidents: e.target.value })} placeholder="jams, resets…" />
                  </label>
                )}
                {form.category === 'driver' && (
                  <label>
                    <span>Control errors</span>
                    <input type="number" min="0" value={form.controlErrors} onChange={(e) => setForm({ ...form, controlErrors: e.target.value })} />
                  </label>
                )}
                <label className="wide">
                  <span>Testing goal</span>
                  <input value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} placeholder="What were you trying to learn?" maxLength={120} />
                </label>
                <label className="wide">
                  <span>Notes</span>
                  <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="What actually happened" maxLength={200} />
                </label>
              </div>
              {error && <Note tone="warn">{error}</Note>}
              <div className="row"><Btn type="submit" variant="primary" size="sm">Save session</Btn></div>
            </form>
          )}

          {!sessions.length ? (
            <Empty>No sessions recorded for {active.number} yet. A session is one block of trials with the configuration that produced them.</Empty>
          ) : (
            <>
              <div className="toolbar">
                <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} aria-label="Filter by category">
                  <option value="all">All categories</option>
                  {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                <span className="tiny dim">sorted by newest session</span>
              </div>
              <Table head={['Date', 'Category', 'Version', 'Trials', 'Rate', 'Cycle', '']}>
                {filtered.map((s) => (
                  <tr key={s.id}>
                    <td className="mono tiny">{s.date}</td>
                    <td>{CATEGORIES.find((c) => c.id === s.category)?.label || s.category}</td>
                    <td>{s.robotVersion || '—'}{s.driver ? <span className="tiny dim"> · {s.driver}</span> : null}</td>
                    <td className="mono">{s.successes}/{s.trials}</td>
                    <td className="mono">{pct(s.successes, s.trials)}%</td>
                    <td className="mono">{s.avgCycle ? `${fmt(s.avgCycle, 2)}s` : '—'}</td>
                    <td><Btn size="sm" variant="ghost" onClick={() => save((prev) => ({ sessions: prev.sessions.filter((x) => x.id !== s.id) }))}>Delete</Btn></td>
                  </tr>
                ))}
              </Table>
            </>
          )}
        </Card>
      )}

      {tab === 'versions' && (
        <>
          <Card title="Robot versions" subtitle="configurations that appear in recorded sessions">
            {!versions.length ? (
              <Empty>Add a robot version to a session (for example “intake v2”) to group tests by build.</Empty>
            ) : (
              <Table head={['Version', 'Sessions', 'Trials', 'Success rate', 'Avg cycle', 'Incidents']}>
                {versions.map((v) => {
                  const g = groupFor(v)
                  return (
                    <tr key={v}>
                      <td><strong>{v}</strong></td>
                      <td className="mono">{g.sessions}</td>
                      <td className="mono">{g.trials}</td>
                      <td className="mono">{g.successRate == null ? '—' : `${fmt(g.successRate * 100, 1)}%`}</td>
                      <td className="mono">{g.avgCycle == null ? '—' : `${fmt(g.avgCycle, 2)}s`}</td>
                      <td className="mono">{g.incidents}</td>
                    </tr>
                  )
                })}
              </Table>
            )}
          </Card>

          <Card title="Compare configurations" subtitle="before and after a change">
            {versions.length < 2 ? (
              <p className="dim small">Record sessions with at least two different robot versions to compare them. The comparison uses only saved trials.</p>
            ) : (
              <>
                <div className="toolbar">
                  <select value={compareA} onChange={(e) => setCompareA(e.target.value)} aria-label="Configuration A">
                    <option value="">Configuration A…</option>
                    {versions.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                  <select value={compareB} onChange={(e) => setCompareB(e.target.value)} aria-label="Configuration B">
                    <option value="">Configuration B…</option>
                    {versions.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                {a && b && (
                  <Table head={['Measure', compareA, compareB, 'Difference']}>
                    <tr><td>Trials</td><td className="mono">{a.trials}</td><td className="mono">{b.trials}</td><td className="mono dim">—</td></tr>
                    <tr>
                      <td>Success rate</td>
                      <td className="mono">{a.successRate == null ? '—' : `${fmt(a.successRate * 100, 1)}%`}</td>
                      <td className="mono">{b.successRate == null ? '—' : `${fmt(b.successRate * 100, 1)}%`}</td>
                      <td className="mono">{a.successRate != null && b.successRate != null ? `${fmt((b.successRate - a.successRate) * 100, 1)} pts` : '—'}</td>
                    </tr>
                    <tr>
                      <td>Avg cycle</td>
                      <td className="mono">{a.avgCycle == null ? '—' : `${fmt(a.avgCycle, 2)}s`}</td>
                      <td className="mono">{b.avgCycle == null ? '—' : `${fmt(b.avgCycle, 2)}s`}</td>
                      <td className="mono">{a.avgCycle != null && b.avgCycle != null ? `${fmt(b.avgCycle - a.avgCycle, 2)}s` : '—'}</td>
                    </tr>
                    <tr><td>Incidents</td><td className="mono">{a.incidents}</td><td className="mono">{b.incidents}</td><td className="mono">{b.incidents - a.incidents}</td></tr>
                  </Table>
                )}
                <p className="tiny dim">With small samples a difference can be noise. Treat a change as real only when the trial counts are meaningful and the gap survives another session.</p>
              </>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
