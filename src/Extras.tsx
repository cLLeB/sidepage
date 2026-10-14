import { useEffect, useMemo, useRef, useState } from 'react'
import { BookA, Play, Search, Square, Timer, X, type LucideIcon } from 'lucide-react'
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
  const [sound, setSound] = usePref<Sound>('sound', 'off')
  const [volume, setVolume] = usePref('sound-volume', 50)
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
    <Menu icon={Timer} quiet={!run} on={!!run || sound !== 'off'} label={run ? `${run.kind === 'rest' ? 'Break' : 'Study'} ${clock}` : 'Study timer'} hint="Study for a stretch, then take a break">
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
      <p className="menu-head">Sound while you work</p>
      <label className="menu-row">Sound
        <select value={sound} onChange={e => setSound(e.target.value as Sound)}>{Object.entries(SOUNDS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
      </label>
      {sound !== 'off' && <label className="menu-row">Volume<input type="range" min={5} max={100} step={5} value={volume} onChange={e => setVolume(Number(e.target.value))} /></label>}
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

// ── Translate: a selected passage into the language of your choice, by a free translation service online ──
export const TRANSLATE_TO = { en: 'English', fr: 'French', es: 'Spanish', de: 'German', pt: 'Portuguese', it: 'Italian', nl: 'Dutch', ak: 'Akan (Twi)', ar: 'Arabic', zh: 'Chinese', ja: 'Japanese', ru: 'Russian' } as const
export const translate = (text: string | undefined | null) => window.dispatchEvent(new CustomEvent('sidepage:translate', { detail: (text ?? '').trim() }))

// The service takes a few hundred letters at a time, so a long passage goes in pieces, sentence by sentence.
const pieces = (text: string, most = 450) => {
  const out: string[] = []
  let piece = ''
  for (const sentence of text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]*\s*/g) ?? [text]) {
    if ((piece + sentence).length > most && piece) { out.push(piece.trim()); piece = '' }
    piece += sentence.length > most ? sentence.slice(0, most) : sentence
  }
  if (piece.trim()) out.push(piece.trim())
  return out
}

export function Translator() {
  const [text, setText] = useState<string | null>(null)
  const [to, setTo] = usePref<keyof typeof TRANSLATE_TO>('translate-to', 'en')
  const [result, setResult] = useState<{ text: string; from?: string } | 'loading' | 'failed' | 'same'>('loading')
  useEffect(() => {
    const open = (e: Event) => setText((e as CustomEvent<string>).detail)
    window.addEventListener('sidepage:translate', open)
    return () => window.removeEventListener('sidepage:translate', open)
  }, [])
  useEffect(() => {
    if (!text) return
    let cancelled = false
    setResult('loading')
    void (async () => {
      try {
        let from: string | undefined
        const done: string[] = []
        for (const piece of pieces(text).slice(0, 12)) {
          const answer = await (await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(piece)}&langpair=Autodetect|${to}`)).json()
          // Asked to translate into the language it is already in, the service answers with a complaint.
          if (/two distinct languages/i.test(String(answer?.responseData?.translatedText ?? ''))) { if (!cancelled) setResult('same'); return }
          done.push(String(answer?.responseData?.translatedText ?? ''))
          from ??= answer?.responseData?.detectedLanguage ?? answer?.matches?.[0]?.source
        }
        if (!cancelled) setResult({ text: done.join(' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&'), from })
      } catch {
        if (!cancelled) setResult('failed')
      }
    })()
    return () => { cancelled = true }
  }, [text, to])
  if (text === null) return null
  return (
    <div className="palette-shade" onClick={() => setText(null)}>
      <div className="palette lookup translator" role="dialog" aria-label="Translate" onClick={e => e.stopPropagation()}>
        <h2>Translate
          <select value={to} onChange={e => setTo(e.target.value as keyof typeof TRANSLATE_TO)} aria-label="Into">
            {Object.entries(TRANSLATE_TO).map(([code, name]) => <option key={code} value={code}>into {name}</option>)}
          </select>
        </h2>
        {!text && <p className="menu-note">Select a passage on the page first, then choose Translate.</p>}
        {text && <>
          <blockquote className="translate-from">{text.length > 900 ? `${text.slice(0, 900)}…` : text}</blockquote>
          {result === 'loading' && <p className="menu-note">Translating…</p>}
          {result === 'same' && <p className="menu-note">This passage is already in {TRANSLATE_TO[to]}. Choose another language above.</p>}
          {result === 'failed' && <p className="menu-note">The translation service is on the internet, and it cannot be reached just now.</p>}
          {typeof result === 'object' && <p className="translate-to">{result.text}</p>}
          <p className="menu-note small">Sent to MyMemory, a free translation service, to be translated.</p>
        </>}
        <div className="lookup-actions">
          {typeof result === 'object' && <>
            <button className="soft" onClick={() => void navigator.clipboard?.writeText(result.text)}>Copy</button>
            <button className="soft" onClick={() => { sendQuote({ text: `${result.text}\n\n(${text})`, source: `Translated into ${TRANSLATE_TO[to]}` }); setText(null) }}>Add to my notes</button>
          </>}
          <button className="primary" onClick={() => setText(null)}>Done</button>
        </div>
      </div>
    </div>
  )
}

// ── The sitting just ended, told in a few figures ──
export function SittingCard({ sitting, onClose }: { sitting: import('./lib/session').Sitting; onClose(): void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 14_000)
    return () => clearTimeout(timer)
  }, [onClose])
  const moved = Math.round((sitting.to - sitting.from) * 100)
  const figures = [
    sitting.minutes >= 1 && { value: sitting.minutes < 60 ? `${sitting.minutes} min` : `${Math.floor(sitting.minutes / 60)} h ${sitting.minutes % 60} min`, label: 'reading' },
    moved > 0 && { value: `+${moved}%`, label: `now ${Math.round(sitting.to * 100)}% through` },
    sitting.highlights > 0 && { value: String(sitting.highlights), label: sitting.highlights === 1 ? 'highlight' : 'highlights' },
    sitting.words > 0 && { value: String(sitting.words), label: 'words of notes' },
    sitting.answers > 0 && { value: String(sitting.answers), label: sitting.answers === 1 ? 'card answered' : 'cards answered' },
  ].filter(Boolean) as { value: string; label: string }[]
  return (
    <div className="sitting" role="status">
      <div className="sitting-head">
        <span className="eyebrow">That sitting</span>
        <strong>{sitting.file.replace(/\.[^.]+$/, '')}</strong>
        <button className="tool quiet" aria-label="Close" onClick={onClose}><X size={16} aria-hidden /></button>
      </div>
      <div className="sitting-figures">{figures.map(figure => <span key={figure.label}><b>{figure.value}</b>{figure.label}</span>)}</div>
    </div>
  )
}

// ── Soundscapes for studying: rain, the sea, a fire, or plain brown noise, made on the spot from noise ──
// Nothing is downloaded: each is shaped from random numbers by the browser's own audio filters.
export const SOUNDS = { off: 'Silence', rain: 'Rain', ocean: 'The sea', fire: 'A fire', brown: 'Brown noise' } as const
export type Sound = keyof typeof SOUNDS

function noise(audio: AudioContext, seconds: number, kind: 'white' | 'brown') {
  const buffer = audio.createBuffer(2, audio.sampleRate * seconds, audio.sampleRate)
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    let last = 0
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1
      if (kind === 'white') data[i] = white
      else { last = (last + 0.02 * white) / 1.02; data[i] = last * 3.5 }
    }
  }
  const source = audio.createBufferSource()
  source.buffer = buffer
  source.loop = true
  return source
}

export function Soundscape() {
  const [sound] = usePref<Sound>('sound', 'off')
  const [volume] = usePref('sound-volume', 50)
  const master = useRef<GainNode | null>(null)
  useEffect(() => { if (master.current) master.current.gain.value = volume / 100 }, [volume])
  useEffect(() => {
    if (sound === 'off') return
    const audio = new AudioContext()
    const out = audio.createGain()
    out.gain.value = volume / 100
    out.connect(audio.destination)
    master.current = out
    const stops: (() => void)[] = []
    const play = (node: AudioScheduledSourceNode) => { node.start(); stops.push(() => node.stop()) }
    const filter = (type: BiquadFilterType, frequency: number, q = 0.7) => {
      const made = audio.createBiquadFilter()
      made.type = type
      made.frequency.value = frequency
      made.Q.value = q
      return made
    }
    if (sound === 'brown') {
      const body = noise(audio, 6, 'brown')
      body.connect(out); play(body)
    }
    if (sound === 'rain') {
      // The hiss of rain: white noise, its top and bottom taken off, wavering a little.
      const hiss = noise(audio, 6, 'white')
      const band = filter('bandpass', 0); band.frequency.value = 2400; band.Q.value = 0.4
      const level = audio.createGain(); level.gain.value = 0.32
      const waver = audio.createOscillator(); waver.frequency.value = 0.13
      const depth = audio.createGain(); depth.gain.value = 0.06
      waver.connect(depth).connect(level.gain)
      hiss.connect(band).connect(level).connect(out)
      // …over a low rumble.
      const rumble = noise(audio, 6, 'brown')
      const low = audio.createGain(); low.gain.value = 0.5
      rumble.connect(low).connect(out)
      play(hiss); play(rumble); play(waver)
    }
    if (sound === 'ocean') {
      // Waves: deep noise swelling and falling every eight seconds or so.
      const sea = noise(audio, 8, 'brown')
      const soft = filter('lowpass', 0); soft.frequency.value = 700
      const swell = audio.createGain(); swell.gain.value = 0.55
      const tide = audio.createOscillator(); tide.frequency.value = 0.12
      const reach = audio.createGain(); reach.gain.value = 0.45
      tide.connect(reach).connect(swell.gain)
      sea.connect(soft).connect(swell).connect(out)
      play(sea); play(tide)
    }
    if (sound === 'fire') {
      // A low roar, and now and then a crackle: a short, sharp burst of bright noise.
      const roar = noise(audio, 6, 'brown')
      const warm = filter('lowpass', 0); warm.frequency.value = 400
      const roarLevel = audio.createGain(); roarLevel.gain.value = 0.7
      roar.connect(warm).connect(roarLevel).connect(out)
      play(roar)
      const crackle = audio.createBuffer(1, audio.sampleRate * 0.03, audio.sampleRate)
      const data = crackle.getChannelData(0)
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3)
      let next = 0
      const timer = setInterval(() => {
        if (audio.currentTime < next) return
        const pop = audio.createBufferSource(); pop.buffer = crackle
        const bright = filter('highpass', 0); bright.frequency.value = 1500 + Math.random() * 2500
        const loud = audio.createGain(); loud.gain.value = 0.15 + Math.random() * 0.5
        pop.connect(bright).connect(loud).connect(out)
        pop.start()
        next = audio.currentTime + (Math.random() < 0.25 ? 0.04 : 0.15 + Math.random() * 1.2)
      }, 30)
      stops.push(() => clearInterval(timer))
    }
    return () => { stops.forEach(stop => { try { stop() } catch { /* already stopped */ } }); void audio.close(); master.current = null }
  }, [sound]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}
