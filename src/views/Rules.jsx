import React, { useMemo, useState } from 'react'
import { useTeam } from '../team/TeamContext.jsx'
import { useTeamStore } from '../team/TeamContext.jsx'
import { Badge, Btn, Card, Empty, Note } from '../components/ui.jsx'
import { navigate } from '../router.js'

// A small, explicit index of the Override rules this app actually relies on. Summaries are
// paraphrases for navigation — the official manual is the authority, and every entry links to
// it. Values are the ones the scoring engine uses, so a change here is a change to the simulator.
const MANUAL = 'https://manuals.vex.com/'
const SEASON = 'VEX V5RC Override 2026–27'
const VERSION = 'Game Manual v0.1 (April 2026) — values indexed 2026-11-23'

const RULES = [
  {
    id: 'SC3',
    category: 'Scoring',
    title: 'How a pin half scores',
    summary:
      'A pin has two coloured halves. Only visible halves score: 5 points for an alliance-coloured half, 10 points for a yellow half paid to whichever alliance owns it. A half hidden by the goal or by a cup face scores nothing.',
    tags: ['pin', 'half', 'points', 'visibility', 'cup'],
    affects: 'field'
  },
  {
    id: 'SC4',
    category: 'Scoring',
    title: 'Toggle states and yellow ownership',
    summary:
      'A quadrant toggle has three scored orientations: red, blue and yellow. Red or blue assigns the yellow pins in that quadrant to that alliance. Yellow assigns them to nobody. A toggle state never scores points by itself.',
    tags: ['toggle', 'yellow', 'ownership', 'quadrant'],
    affects: 'field'
  },
  {
    id: 'SC5',
    category: 'Scoring',
    title: 'Yellow pin ownership in the midfield',
    summary:
      'Yellow halves in the tall midfield goal are paid to the alliance with more robots in the midfield at the end of the match. A tie leaves them unowned and worth nothing.',
    tags: ['yellow', 'midfield', 'tall goal', 'ownership'],
    affects: 'field'
  },
  {
    id: 'SC6',
    category: 'Scoring',
    title: 'Robots in the midfield',
    summary: 'Each robot in the midfield projection when the match ends is worth 8 points to its alliance.',
    tags: ['midfield', 'park', '8 points'],
    affects: 'field'
  },
  {
    id: 'SC7',
    category: 'Scoring',
    title: 'Autonomous bonus',
    summary:
      'The alliance with the higher autonomous score receives 12 points. If the autonomous scores tie, including 0–0, each alliance receives 6.',
    tags: ['autonomous', 'bonus', '12', 'tie'],
    affects: 'field'
  },
  {
    id: 'SC8',
    category: 'Autonomous',
    title: 'Autonomous Win Point requirements',
    summary:
      'Standard-event AWP: at least 7 pins scoring for the alliance, across at least 3 distinct goals with at least 2 pins each, with both robots clear of the field perimeter and no autonomous violations. Pins on the opposing side of the autonomous line do not count.',
    tags: ['awp', 'autonomous win point', '7 pins', '3 goals'],
    affects: 'field'
  },
  {
    id: 'SC1',
    category: 'Match procedures',
    title: 'When the score is evaluated',
    summary: 'The field is scored about 5 seconds after the match clock reaches zero, so endgame actions are judged on the settled field.',
    tags: ['endgame', 'settle', 'scoring', 'clock'],
    affects: null
  },
  {
    id: 'SG1–SG3',
    category: 'Robot construction',
    title: 'Size limits',
    summary:
      'Robots start inside an 18 in cube. Horizontal expansion is capped at 24 in × 24 in, and height at 50 in once outside the midfield in the endgame. A robot in the midfield projection during the endgame is limited to 18 in of height.',
    tags: ['size', '18 inch', '24 inch', '50 inch', 'expansion'],
    affects: 'autonomous'
  },
  {
    id: 'SG5–SG6',
    category: 'Possession',
    title: 'Preloads and possession',
    summary:
      'Each robot starts with one preload pin (red/yellow for red, blue/yellow for blue). A robot may possess at most one pin and one cup at a time; plowing that clearly demonstrates no possession is allowed.',
    tags: ['possession', 'preload', 'pin', 'cup'],
    affects: null
  },
  {
    id: 'SG7',
    category: 'Autonomous',
    title: 'The autonomous line',
    summary:
      'Robots may not cross the autonomous line during the autonomous period. Objects on the line and in the midfield are shared. Defensive autonomous strategies that rely on crossing are penalised.',
    tags: ['autonomous', 'line', 'crossing', 'defence'],
    affects: 'autonomous'
  },
  {
    id: 'SG9–SG10',
    category: 'Defense',
    title: 'Descoring protection',
    summary:
      'Alliance goals are protected from opposing interaction, and pins may not be removed from neutral or opposing goals. In practice, an alliance pin scored in a goal stays scored.',
    tags: ['descoring', 'goal', 'protection', 'remove'],
    affects: 'field'
  },
  {
    id: 'SG11',
    category: 'Loading',
    title: 'Match loads',
    summary:
      'There are four loaders, two adjacent to each alliance station. Match loads are legal during the driver-controlled period only, introduced as a single pin, a single cup or a nested cup-and-pin, and removed through the bottom of the loader.',
    tags: ['loader', 'match load', 'driver', 'cup', 'pin'],
    affects: null
  },
  {
    id: 'Match timing',
    category: 'Match procedures',
    title: 'Period lengths',
    summary: 'Autonomous runs for 15 seconds, the driver-controlled period for 1:45, and the last 20 seconds are the endgame window.',
    tags: ['15 seconds', '1:45', 'endgame', 'timing'],
    affects: 'autonomous'
  }
]

const CATEGORIES = ['All', ...new Set(RULES.map((r) => r.category))]

export default function Rules() {
  const { active } = useTeam()
  const { value: bookmarks, save: saveBookmarks } = useTeamStore('rule-bookmarks', { ids: [], recent: [] })
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [openId, setOpenId] = useState(null)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return RULES.filter((r) => (category === 'All' ? true : r.category === category)).filter((r) =>
      q ? `${r.id} ${r.title} ${r.summary} ${r.tags.join(' ')}`.toLowerCase().includes(q) : true
    )
  }, [query, category])

  const toggleBookmark = (id) => {
    saveBookmarks((prev) => ({
      ...prev,
      ids: prev.ids.includes(id) ? prev.ids.filter((x) => x !== id) : [...prev.ids, id]
    }))
  }

  const open = (id) => {
    setOpenId((cur) => (cur === id ? null : id))
    saveBookmarks((prev) => ({ ...prev, recent: [id, ...(prev.recent || []).filter((x) => x !== id)].slice(0, 5) }))
  }

  return (
    <div>
      <Card title="Rules & Q&A" subtitle={`${SEASON} · ${VERSION}`}>
        <div className="toolbar">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search: yellow ownership, pin halves, midfield, possession…"
            aria-label="Search rules"
          />
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="tiny dim">
          {results.length} of {RULES.length} indexed entries. Summaries are paraphrases for navigation; the official
          manual is the authority.
        </div>

        {!results.length && <Empty>No indexed rule matched that search. Try a shorter phrase, or open the manual.</Empty>}

        <div className="rule-list">
          {results.map((r) => (
            <article key={r.id} className={`rule ${openId === r.id ? 'open' : ''}`}>
              <button type="button" className="rule-head" onClick={() => open(r.id)} aria-expanded={openId === r.id}>
                <span className="rule-id">{r.id}</span>
                <span className="rule-title">{r.title}</span>
                <span className="badge">{r.category}</span>
                <span className="spacer" />
                <span className="rule-caret" aria-hidden="true">{openId === r.id ? '−' : '+'}</span>
              </button>
              {openId === r.id && (
                <div className="rule-body">
                  <p>{r.summary}</p>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <a href={MANUAL} target="_blank" rel="noreferrer" className="tiny">Official manual ↗</a>
                    {r.affects && (
                      <button className="link tiny" onClick={() => navigate(r.affects === 'field' ? 'field' : 'autonomous')}>
                        Used by the {r.affects === 'field' ? 'field simulator' : 'autonomous planner'} →
                      </button>
                    )}
                    <span className="spacer" />
                    <Btn size="sm" variant="ghost" onClick={() => toggleBookmark(r.id)}>
                      {bookmarks.ids.includes(r.id) ? 'Bookmarked' : 'Bookmark'}
                    </Btn>
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      </Card>

      <Card title="Personal rules context" subtitle={active ? `${active.number} · bookmarks and recent topics` : 'choose a team to keep bookmarks'}>
        {!active ? (
          <p className="dim small">
            <button className="link" onClick={() => navigate('welcome')}>Enter a team number</button> to keep bookmarked rules
            with that team context.
          </p>
        ) : (
          <>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              <span className="tiny dim">Bookmarks:</span>
              {bookmarks.ids.length ? (
                bookmarks.ids.map((id) => (
                  <button key={id} className="chip" onClick={() => { setQuery(id); setCategory('All') }}>
                    {id}
                  </button>
                ))
              ) : (
                <span className="tiny dim">none yet</span>
              )}
            </div>
            {bookmarks.recent?.length > 0 && (
              <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                <span className="tiny dim">Recent:</span>
                {bookmarks.recent.map((id) => (
                  <button key={id} className="chip" onClick={() => { setQuery(id); setCategory('All') }}>{id}</button>
                ))}
              </div>
            )}
            <Note>
              The rules are the same for every team in this season. Personalisation changes which rules you keep, not what
              they say. When a rule affects the simulator&apos;s assumptions, the entry links to the tool it changes.
            </Note>
          </>
        )}
      </Card>

      <Card title="What this page will not do">
        <p className="small dim">
          It does not issue referee rulings or invent Q&amp;A answers. Where the manual is ambiguous — for example how cup
          faces hide a pin half — the field simulator states the interpretation it uses and scores it consistently. Ask
          the official Q&amp;A for a binding answer, and check the manual version printed above before relying on a value
          at an event.
        </p>
      </Card>
    </div>
  )
}
