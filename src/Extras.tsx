import { useEffect, useMemo, useRef, useState } from 'react'
import { BookA, Play, Search, Square, Timer, type LucideIcon } from 'lucide-react'
import { Menu, Tool } from './ui'
import { sendQuote } from './lib/platform'
import { usePref } from './lib/prefs'

// ── Command palette: everything the app can do, and every book, found by typing a few letters ──
export type Command = { name: string; group: string; hint?: string; icon: LucideIcon; run(): void }

export function Palette({ commands, onClose }: { commands: Command[]; onClose(): void }) {
  const [wanted, setWanted] = useState('')
  const [at, setAt] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const found = useMemo(() => {
    const words = wanted.toLowerCase().split(/\s+/).filter(Boolean)
    return commands.filter(command => words.every(word => `${command.name} ${command.group}`.toLowerCase().includes(word))).slice(0, 60)
  }, [commands, wanted])
  useEffect(() => { setAt(0) }, [wanted])
  useEffect(() => { list.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' }) }, [at])
  const choose = (command: Command | undefined) => {
    if (!command) return
    onClose()
    command.run()
  }
  return (
    <div className="palette-shade" onClick={onClose}>
      <div className="palette" role="dialog" aria-label="Go to anything" onClick={e => e.stopPropagation()}>
        <label className="palette-field">
          <Search size={18} aria-hidden />
          <input
            autoFocus value={wanted} placeholder="Type what you want to do, or the name of a book"
            onChange={e => setWanted(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setAt(Math.min(found.length - 1, at + 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setAt(Math.max(0, at - 1)) }
              else if (e.key === 'Enter') choose(found[at])
              else if (e.key === 'Escape') onClose()
            }}
          />
        </label>
        <div className="palette-list" ref={list}>
          {found.map((command, i) => (
            <div key={command.group + command.name}>
              {(i === 0 || found[i - 1].group !== command.group) && <p className="menu-head">{command.group}</p>}
              <button className={i === at ? 'palette-item on' : 'palette-item'} onPointerMove={() => setAt(i)} onClick={() => choose(command)}>
                <command.icon size={17} aria-hidden />
                <span>{command.name}</span>
                {command.hint && <kbd>{command.hint}</kbd>}
              </button>
            </div>
          ))}
          {!found.length && <p className="menu-note">Nothing by that name.</p>}
        </div>
      </div>
    </div>
  )
}

// ── Study timer: a stretch of reading, then a break, with a chime at each change ──
const chime = () => {
  try {
    const audio = new AudioContext()
    ;[0, 0.28, 0.56].forEach((start, i) => {
      const tone = audio.createOscillator(), level = audio.createGain()
      tone.frequency.value = [660, 880, 1100][i]
      level.gain.setValueAtTime(0.0001, audio.currentTime + start)
      level.gain.exponentialRampToValueAtTime(0.2, audio.currentTime + start + 0.03)
      level.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + start + 0.5)
      tone.connect(level).connect(audio.destination)
      tone.start(audio.currentTime + start)
      tone.stop(audio.currentTime + start + 0.55)
    })
  } catch { /* no sound on this device: the message on screen still says it */ }
}

export function StudyTimer({ onNotice }: { onNotice(message: string): void }) {
  const [study, setStudy] = usePref('timer-study', 25)
  const [rest, setRest] = usePref('timer-rest', 5)
  const [done, setDone] = usePref<{ day: string; count: number }>('timer-done', { day: '', count: 0 })
  const [run, setRun] = useState<{ kind: 'study' | 'rest'; ends: number } | null>(null)
  const [now, setNow] = useState(Date.now())
  const today = new Date().toDateString()
  const count = done.day === today ? done.count : 0

  useEffect(() => {
    if (!run) return
    const tick = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(tick)
  }, [run])
  useEffect(() => {
    if (!run || now < run.ends) return
    chime()
    if (run.kind === 'study') {
      setDone({ day: today, count: count + 1 })
      onNotice(`That is ${study} minutes of study done. Take ${rest} minutes off.`)
      setRun({ kind: 'rest', ends: Date.now() + rest * 60_000 })
    } else {
      onNotice('Break over. Ready for another stretch?')
      setRun(null)
    }
  }, [now]) // eslint-disable-line react-hooks/exhaustive-deps

  const left = run ? Math.max(0, Math.ceil((run.ends - now) / 1000)) : 0
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
  return (
    <Menu icon={Timer} quiet={!run} on={!!run} label={run ? `${run.kind === 'rest' ? 'Break' : 'Study'} ${clock}` : 'Study timer'} hint="Study for a stretch, then take a break">
      {run
        ? <Tool icon={Square} label={`Stop (${clock} left)`} onClick={() => setRun(null)} />
        : <Tool icon={Play} label={`Start ${study} minutes of study`} onClick={() => { setNow(Date.now()); setRun({ kind: 'study', ends: Date.now() + study * 60_000 }) }} />}
      <label className="menu-row">Study for
        <select value={study} onChange={e => setStudy(Number(e.target.value))}>{[15, 20, 25, 30, 45, 50, 60].map(m => <option key={m} value={m}>{m} min</option>)}</select>
      </label>
      <label className="menu-row">Then rest for
        <select value={rest} onChange={e => setRest(Number(e.target.value))}>{[3, 5, 10, 15].map(m => <option key={m} value={m}>{m} min</option>)}</select>
      </label>
      <p className="menu-note">{count ? `${count} stretch${count === 1 ? '' : 'es'} done today.` : 'A chime sounds when it is time to rest.'}</p>
    </Menu>
  )
}

// ── Comfort: a warmer, dimmer screen for the evening, and a ruler that keeps your place on the line ──
export function Comfort() {
  const [warmth] = usePref('warmth', 0)
  const [dim] = usePref('dim', 0)
  const [ruler] = usePref('ruler', false)
  const band = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ruler) return
    const follow = (e: PointerEvent) => { if (band.current) band.current.style.top = `${e.clientY}px` }
    window.addEventListener('pointermove', follow, { capture: true, passive: true })
    window.addEventListener('pointerdown', follow, { capture: true, passive: true })
    return () => {
      window.removeEventListener('pointermove', follow, { capture: true })
      window.removeEventListener('pointerdown', follow, { capture: true })
    }
  }, [ruler])
  return <>
    {warmth > 0 && <div className="comfort" style={{ background: `rgb(255 147 41 / ${warmth * 0.0035})`, mixBlendMode: 'multiply' }} />}
    {dim > 0 && <div className="comfort" style={{ background: `rgb(0 0 0 / ${dim / 100})` }} />}
    {ruler && <div ref={band} className="reading-ruler" />}
  </>
}

// ── Look up: what a word means, from a free dictionary on the internet ──
export const lookUp = (words: string | undefined | null) => {
  const word = (words ?? '').trim().split(/\s+/).slice(0, 3).join(' ').replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')
  window.dispatchEvent(new CustomEvent('sidepage:lookup', { detail: word }))
}
type Entry = { phonetic?: string; meanings: { partOfSpeech: string; definitions: { definition: string; example?: string }[] }[] }

export function LookUp() {
  const [word, setWord] = useState<string | null>(null)
  const [entries, setEntries] = useState<Entry[] | 'loading' | 'none' | 'offline'>('loading')
  useEffect(() => {
    const open = (e: Event) => setWord((e as CustomEvent<string>).detail)
    window.addEventListener('sidepage:lookup', open)
    return () => window.removeEventListener('sidepage:lookup', open)
  }, [])
  useEffect(() => {
    if (!word) return
    let cancelled = false
    setEntries('loading')
    fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`)
      .then(async answer => { if (!cancelled) setEntries(answer.ok ? await answer.json() : 'none') })
      .catch(() => { if (!cancelled) setEntries('offline') })
    return () => { cancelled = true }
  }, [word])
  if (word === null) return null
  const first = Array.isArray(entries) ? entries[0]?.meanings[0]?.definitions[0]?.definition : ''
  return (
    <div className="palette-shade" onClick={() => setWord(null)}>
      <div className="palette lookup" role="dialog" aria-label="Dictionary" onClick={e => e.stopPropagation()}>
        <h2><BookA size={20} aria-hidden /> {word || 'Look up'}{Array.isArray(entries) && entries[0]?.phonetic && <small>{entries[0].phonetic}</small>}</h2>
        {!word && <p className="menu-note">Select a word on the page first, then choose Look up.</p>}
        {word && entries === 'loading' && <p className="menu-note">Looking it up…</p>}
        {word && entries === 'none' && <p className="menu-note">The dictionary has no entry for this.</p>}
        {word && entries === 'offline' && <p className="menu-note">The dictionary is on the internet, and it cannot be reached just now.</p>}
        {Array.isArray(entries) && (
          <div className="palette-list">
            {entries.flatMap(entry => entry.meanings).slice(0, 6).map((meaning, i) => (
              <div key={i} className="meaning">
                <p className="menu-head">{meaning.partOfSpeech}</p>
                <ol>{meaning.definitions.slice(0, 3).map((def, j) => <li key={j}>{def.definition}{def.example && <em>{def.example}</em>}</li>)}</ol>
              </div>
            ))}
          </div>
        )}
        <div className="lookup-actions">
          {first && <button className="soft" onClick={() => { sendQuote({ text: `${word}: ${first}`, source: 'Dictionary' }); setWord(null) }}>Add to my notes</button>}
          <button className="primary" onClick={() => setWord(null)}>Done</button>
        </div>
      </div>
    </div>
  )
}

// ── Reading aloud, as you like it ──
export function VoiceSettings() {
  const [voice, setVoice] = usePref('voice', '')
  const [rate, setRate] = usePref('voice-rate', 1)
  const [sleep, setSleep] = usePref('voice-sleep', 0)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  useEffect(() => {
    if (!('speechSynthesis' in window)) return
    const list = () => setVoices(speechSynthesis.getVoices())
    list()
    speechSynthesis.addEventListener('voiceschanged', list)
    return () => speechSynthesis.removeEventListener('voiceschanged', list)
  }, [])
  if (!('speechSynthesis' in window)) return null
  return <>
    <p className="menu-head">Reading aloud</p>
    {voices.length > 0 && (
      <label className="menu-row">Voice
        <select value={voice} onChange={e => setVoice(e.target.value)}>
          <option value="">The device's own</option>
          {voices.map(found => <option key={found.name} value={found.name}>{found.name.replace(/^Microsoft | Online \(Natural\)/g, '')}</option>)}
        </select>
      </label>
    )}
    <label className="menu-row">Pace
      <select value={rate} onChange={e => setRate(Number(e.target.value))}>
        {[['Slow', 0.8], ['Normal', 1], ['Brisk', 1.25], ['Fast', 1.5], ['Very fast', 2]].map(([name, value]) => <option key={name} value={value}>{name}</option>)}
      </select>
    </label>
    <label className="menu-row">Stop after
      <select value={sleep} onChange={e => setSleep(Number(e.target.value))}>
        <option value={0}>Never</option>
        {[10, 20, 30, 45, 60].map(minutes => <option key={minutes} value={minutes}>{minutes} min</option>)}
      </select>
    </label>
  </>
}

// The time of day, for when the toolbars (and with them the device's own clock) are out of sight.
export function FocusClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 20_000)
    return () => clearInterval(tick)
  }, [])
  return <span className="focus-clock">{now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
}

// Keep the screen from dimming and locking while a book is open, where the device allows it.
export function useScreenOn(on: boolean) {
  useEffect(() => {
    const locks = (navigator as Navigator & { wakeLock?: { request(kind: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock
    if (!on || !locks) return
    let lock: { release(): Promise<void> } | undefined
    let over = false
    const hold = () => { if (document.visibilityState === 'visible') locks.request('screen').then(got => { if (over) void got.release(); else lock = got }).catch(() => {}) }
    hold()
    document.addEventListener('visibilitychange', hold)
    return () => { over = true; document.removeEventListener('visibilitychange', hold); void lock?.release().catch(() => {}) }
  }, [on])
}
