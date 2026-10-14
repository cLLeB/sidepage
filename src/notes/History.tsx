import { useEffect, useMemo, useState } from 'react'
import { History as HistoryIcon, RotateCcw } from 'lucide-react'
import { loadNote, saveNote } from '../lib/platform'

// Earlier versions of a note. While you write, the note as it stands is kept every ten minutes or so (and when
// it is opened), up to the last sixty; any of them can be compared with the note now and brought back.
export const HISTORY = 'notes-history.json'
type Version = { at: number; text: string }
const EVERY = 10 * 60_000
const KEEP = 60

export async function versionsOf(notebook: string): Promise<Version[]> {
  return JSON.parse((await loadNote(notebook, HISTORY)) ?? '[]')
}
export async function keepVersion(notebook: string, text: string, now = false) {
  const versions = await versionsOf(notebook)
  const last = versions.at(-1)
  if (last?.text === text || !text.trim()) return
  if (!now && last && Date.now() - last.at < EVERY) return
  await saveNote(notebook, HISTORY, JSON.stringify([...versions, { at: Date.now(), text }].slice(-KEEP)))
}

// What changed between two versions, line by line: the longest run of lines both share is kept, the rest is
// marked as taken out or put in.
type Line = { kind: 'same' | 'out' | 'in'; text: string }
function compare(before: string, after: string): Line[] {
  const a = before.split('\n'), b = after.split('\n')
  if (a.length * b.length > 4_000_000) return [...a.map(text => ({ kind: 'out' as const, text })), ...b.map(text => ({ kind: 'in' as const, text }))]
  const width = b.length + 1
  const runs = new Uint16Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
    runs[i * width + j] = a[i] === b[j] ? runs[(i + 1) * width + j + 1] + 1 : Math.max(runs[(i + 1) * width + j], runs[i * width + j + 1])
  }
  const lines: Line[] = []
  let i = 0, j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { lines.push({ kind: 'same', text: a[i] }); i++; j++ }
    else if (runs[(i + 1) * width + j] >= runs[i * width + j + 1]) lines.push({ kind: 'out', text: a[i++] })
    else lines.push({ kind: 'in', text: b[j++] })
  }
  while (i < a.length) lines.push({ kind: 'out', text: a[i++] })
  while (j < b.length) lines.push({ kind: 'in', text: b[j++] })
  return lines
}

const when = (at: number) => {
  const date = new Date(at)
  const today = new Date().toDateString() === date.toDateString()
  return today ? `Today, ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : date.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

export function HistoryDialog({ notebook, current, onRestore, onClose }: { notebook: string; current: string; onRestore(text: string): void; onClose(): void }) {
  const [versions, setVersions] = useState<Version[] | null>(null)
  const [chosen, setChosen] = useState(0)
  useEffect(() => { void versionsOf(notebook).then(found => setVersions([...found].reverse())) }, [notebook])
  const version = versions?.[chosen]
  const lines = useMemo(() => (version ? compare(version.text, current) : []), [version, current])
  const changed = lines.filter(line => line.kind !== 'same' && line.text.trim()).length
  return (
    <div className="palette-shade" onClick={onClose}>
      <div className="palette history" role="dialog" aria-label="Earlier versions" onClick={e => e.stopPropagation()}>
        <h2><HistoryIcon size={20} aria-hidden /> Earlier versions</h2>
        {versions?.length === 0 && <p className="menu-note">No earlier versions yet. They are kept as you write, every ten minutes or so.</p>}
        {versions && versions.length > 0 && (
          <div className="history-body">
            <div className="history-list">
              {versions.map((found, i) => (
                <button key={found.at} className={i === chosen ? 'palette-item on' : 'palette-item'} onClick={() => setChosen(i)}>
                  <span>{when(found.at)}</span>
                  <small>{found.text.split(/\s+/).filter(Boolean).length} words</small>
                </button>
              ))}
            </div>
            <div className="history-diff">
              <p className="menu-note">{changed ? `From this version to the note now: ${lines.filter(l => l.kind === 'in' && l.text.trim()).length} lines put in (green), ${lines.filter(l => l.kind === 'out' && l.text.trim()).length} taken out (red).` : 'The same as the note now.'}</p>
              {lines.filter(line => line.text.trim()).map((line, i) => <div key={i} className={`diff-line ${line.kind}`}>{line.text}</div>)}
            </div>
          </div>
        )}
        <div className="lookup-actions">
          {version && changed > 0 && <button className="soft" onClick={() => { onRestore(version.text); onClose() }}><RotateCcw size={16} aria-hidden /> Bring this version back</button>}
          <button className="primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
