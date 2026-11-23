import React, { useState } from 'react'
import { Badge, Btn, Note } from './ui.jsx'
import { applyBackup, backupSummary, collectBackup, makeBackupCode, readBackupCode } from '../team/backup.js'

const fmtBytes = (b) => (b > 1024 * 1024 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    window.prompt('Copy this text', text)
    return false
  }
}

/**
 * Settings → one code that carries every saved team, scenario, routine, test and note.
 * The code is encrypted with the PIN, so it can live in a note or a message without exposing
 * the contents. Restoring replaces this browser's local data.
 */
export default function BackupCode() {
  const [busy, setBusy] = useState(false)
  const [made, setMade] = useState(null)
  const [error, setError] = useState(null)
  const [code, setCode] = useState('')
  const [pin, setPin] = useState('')
  const [restored, setRestored] = useState(null)
  const [copied, setCopied] = useState(null)

  const summary = backupSummary()

  const create = async () => {
    setBusy(true)
    setError(null)
    setMade(null)
    try {
      const out = await makeBackupCode()
      setMade(out)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const restore = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setRestored(null)
    try {
      const out = await readBackupCode(code, pin)
      applyBackup(out.data)
      setRestored(out)
      window.setTimeout(() => window.location.reload(), 900)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const download = () => {
    if (!made) return
    const text = `Override Lab backup\nCreated: ${new Date().toLocaleString()}\nPIN: ${made.pin}\n\n${made.code}\n\nKeep the PIN with this code. Without it the code cannot be restored.\n`
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `override-lab-backup-${new Date().toISOString().slice(0, 10)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const copyMade = async (what, value) => {
    await copy(value)
    setCopied(what)
    window.setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div className="backup">
      <div className="backup-status">
        <span>
          <strong>{summary.teams}</strong> team{summary.teams === 1 ? '' : 's'} ·{' '}
          <strong>{fmtBytes(summary.bytes)}</strong> of saved work in this browser
        </span>
        <Badge tone={summary.keys ? 'good' : 'warn'}>{summary.keys ? 'ready to back up' : 'nothing saved yet'}</Badge>
      </div>

      <div className="backup-grid">
        <div>
          <h3>Create a backup code</h3>
          <p className="tiny dim">
            One code and a six-digit PIN. The code is encrypted with the PIN, so keep them together in a note or send
            both to yourself. Works across browsers and devices.
          </p>
          <Btn size="sm" variant="primary" onClick={create} disabled={busy || !summary.keys}>
            {busy ? 'Creating…' : 'Generate PIN + code'}
          </Btn>

          {made && (
            <div className="backup-made">
              <div className="pin-show">
                <span className="tiny dim">PIN</span>
                <strong className="mono">{made.pin}</strong>
                <button className="link tiny" type="button" onClick={() => copyMade('pin', made.pin)}>
                  {copied === 'pin' ? 'copied' : 'copy'}
                </button>
              </div>
              <textarea readOnly value={made.code} rows={4} className="mono" aria-label="Backup code" onFocus={(e) => e.target.select()} />
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <Btn size="sm" onClick={() => copyMade('code', made.code)}>
                  {copied === 'code' ? 'Code copied' : 'Copy code'}
                </Btn>
                <Btn size="sm" variant="ghost" onClick={download}>
                  Download .txt
                </Btn>
              </div>
              <span className="tiny dim">Created {new Date().toLocaleTimeString()} · keep both parts</span>
            </div>
          )}
        </div>

        <div>
          <h3>Restore a code</h3>
          <p className="tiny dim">
            Replaces the teams and saved work in this browser with the backup. RobotEvents keys are never included.
          </p>
          <form onSubmit={restore} className="backup-restore">
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Paste the backup code (starts with OL1.)"
              rows={3}
              className="mono"
              aria-label="Backup code to restore"
              required
            />
            <div className="restore-row">
              <input
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="6-digit PIN"
                inputMode="numeric"
                maxLength={6}
                aria-label="Backup PIN"
                required
              />
              <Btn size="sm" type="submit" disabled={busy}>
                {busy ? 'Restoring…' : 'Restore'}
              </Btn>
            </div>
          </form>
          {restored && (
            <Note tone="good">
              Restored {Object.keys(restored.data).length} saved item{Object.keys(restored.data).length === 1 ? '' : 's'}.
              Reloading…
            </Note>
          )}
        </div>
      </div>

      {error && <Note tone="warn">{error}</Note>}
      <Note>
        The code is local to this browser until you paste it somewhere. There is no account and no server copy: if you
        clear this browser without a code, the saved work is gone. Losing the PIN makes the code unreadable.
      </Note>
    </div>
  )
}
