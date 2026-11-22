import React, { useCallback, useEffect, useState } from 'react'
import { api, getApiToken, jpost, setApiToken } from '../api.js'
import { Btn } from './ui.jsx'

/**
 * RobotEvents key panel.
 *
 * The server reads ROBOTEVENTS_TOKEN from its own environment. When that is missing or has
 * been rejected — a fresh deployment, an expired token — the user can paste their own key
 * here instead of waiting for a redeploy. The value never reaches the server's storage: it
 * lives in this browser's localStorage and travels as a request header only.
 */
export default function ApiKey() {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(() => getApiToken())
  const [server, setServer] = useState(null)
  const [check, setCheck] = useState(null)

  const loadStatus = useCallback(async () => {
    try {
      const r = await api('/api/season')
      setServer({ token: Boolean(r?.token), source: r?.tokenSource || null })
    } catch {
      setServer({ token: false, source: null, unreachable: true })
    }
  }, [])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  const mine = getApiToken()
  const label = server?.unreachable
    ? 'API unreachable'
    : mine
      ? 'Your key is set'
      : server?.token
        ? 'Server key active'
        : 'Add your API key'

  const save = async () => {
    const next = value.trim()
    setApiToken(next)
    setCheck({ pending: true })
    try {
      const r = await jpost('/api/token/check', {})
      setCheck(r?.ok ? { ok: true } : { ok: false, error: r?.error || 'that key was rejected' })
    } catch (e) {
      setCheck({ ok: false, error: e.message })
    }
    loadStatus()
  }

  const clear = () => {
    setApiToken('')
    setValue('')
    setCheck(null)
    loadStatus()
  }

  return (
    <div className="key-box">
      <button type="button" className="key-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="ico">⌘</span>
        <span>{label}</span>
        <span className="spacer" />
        <span className="tiny dim">{open ? 'hide' : 'key'}</span>
      </button>
      {open && (
        <div className="key-body">
          <div className="tiny dim" style={{ lineHeight: 1.45 }}>
            RobotEvents API token (events.vex.com → Account → API). It is stored in this browser only and sent to the API with each
            request — never saved on the server.
          </div>
          <input
            className="input mono"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="paste your token"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
          <div className="row" style={{ gap: 6 }}>
            <Btn size="sm" variant="primary" onClick={save} disabled={!value.trim()}>
              Save & test
            </Btn>
            <Btn size="sm" variant="ghost" onClick={clear} disabled={!mine}>
              Remove
            </Btn>
          </div>
          {check?.pending && <div className="tiny dim">checking…</div>}
          {check && !check.pending && (
            <div className={`tiny ${check.ok ? 'ok' : 'bad'}`}>
              {check.ok ? 'Key accepted — current-season data is readable.' : `Key rejected: ${check.error}`}
            </div>
          )}
          {!mine && server?.unreachable && <div className="tiny bad">The API did not answer. Check the site, then retry.</div>}
          {!mine && !server?.unreachable && !server?.token && (
            <div className="tiny dim">No key on the server yet, so this is what makes the data load.</div>
          )}
        </div>
      )}
    </div>
  )
}
