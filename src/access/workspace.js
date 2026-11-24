import { useCallback, useEffect, useState } from 'react'
import { api, jdel, jpost } from '../api.js'

const enc = encodeURIComponent

/**
 * Reads and writes one private workspace collection.
 *
 * The server derives the team from the session, so this hook never passes (and cannot fake) a
 * team number. `event` narrows the list to one tournament; the server keeps the record even
 * when it is filtered out.
 */
export function useWorkspace(collection, event = null) {
  const [state, setState] = useState({ records: [], loading: true, error: null })

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const out = await api(`/api/workspace/${collection}${event ? `?event=${enc(event)}` : ''}`)
      setState({ records: out.records || [], loading: false, error: null })
    } catch (e) {
      setState({ records: [], loading: false, error: e.message })
    }
  }, [collection, event])

  useEffect(() => {
    load()
  }, [load])

  const add = useCallback(
    async (data) => {
      const out = await jpost(`/api/workspace/${collection}`, { ...data, eventSku: event || data.eventSku || null })
      await load()
      return out.record
    },
    [collection, event, load]
  )

  const patch = useCallback(
    async (id, data) => {
      const out = await api(`/api/workspace/${collection}/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
      await load()
      return out.record
    },
    [collection, load]
  )

  const drop = useCallback(
    async (id) => {
      await jdel(`/api/workspace/${collection}/${id}`)
      await load()
    },
    [collection, load]
  )

  return { ...state, add, patch, drop, reload: load }
}

export const TASK_PRIORITIES = ['high', 'normal', 'low']
export const BATTERY_STATES = [
  ['ready', 'Ready'],
  ['in_robot', 'In robot'],
  ['charging', 'Charging'],
  ['depleted', 'Depleted']
]

export const DEFAULT_EVENT_CHECKLIST = [
  'Robot passes inspection',
  'Batteries charged and labelled',
  'Tools and spare parts packed',
  'Brain and controller verified',
  'Autonomous routines tested',
  'Driver practice completed',
  'Interview preparation reviewed',
  'Engineering notebook submitted where required'
]

export const DEFAULT_MATCH_CHECKLIST = [
  'Correct autonomous selected',
  'Battery checked and charged',
  'Robot mechanically inspected',
  'Alliance partner contacted',
  'Opponent intelligence reviewed',
  'Match strategy discussed',
  'Robot ready to queue'
]

export const JUDGING_QUESTIONS = [
  ['Engineering design process', 'Walk us through how your team moved from the game reveal to this robot. What alternatives did you build or reject, and why?'],
  ['Mechanical design', 'Which mechanism gave you the most trouble, and what evidence told you the final version was better?'],
  ['Programming', 'Describe a bug that cost you real match points. How did you find it, and what changed afterwards?'],
  ['Testing and iteration', 'Show us a measurement. What did you change because of that number, and what happened next?'],
  ['Teamwork', 'How are decisions made when the drive team and the build team disagree?'],
  ['Game strategy', 'What is your role in a qualification alliance, and how does it change in eliminations?'],
  ['Autonomous', 'How do you decide whether an autonomous routine is reliable enough to run in a match?'],
  ['Sustainability', 'What would you change about this robot with two more weeks, and what stops you now?']
]

export const CYCLE_MINUTES = 6
