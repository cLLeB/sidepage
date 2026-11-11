import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Pause, Play, SkipBack, SkipForward, X } from 'lucide-react'
import type { RsvpEngine } from '@rsvp-engine/core'
import { placeNow } from '../lib/platform'
import { stretchesOf } from '../lib/insight'
import { placeName } from '../lib/library'
import { usePref } from '../lib/prefs'

// Speed reading: the words of the book from the page you are on, shown one at a time in the same spot, so the eye
// stays still and the mind keeps pace. Each word is lined up on its focus letter (in colour). The timing, the focus
// letter and longer pauses at the ends of sentences are @rsvp-engine/core's.
export default function SpeedRead({ onClose }: { onClose(): void }) {
  const [wpm, setWpm] = usePref('speed-wpm', 300)
  const [engine, setEngine] = useState<RsvpEngine | null>(null)
  const [from, setFrom] = useState('')
  const [empty, setEmpty] = useState(false)
  const stage = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let made: RsvpEngine | null = null
    let cancelled = false
    void (async () => {
      const here = placeNow()
      if (!here) return setEmpty(true)
      const [{ RsvpEngine, TextTokenizer }, stretches] = await Promise.all([import('@rsvp-engine/core'), stretchesOf(here.book)])
      const at = Math.max(0, stretches.findIndex(stretch => stretch.place === here.place))
      const text = stretches.slice(at).map(stretch => stretch.text).join(' ').replace(/\s+/g, ' ').trim()
      if (cancelled) return
      if (!text) return setEmpty(true)
      made = new RsvpEngine({ tokenizer: new TextTokenizer(), wpm, onError: () => {} })
      made.load(text)
      setFrom(placeName(stretches[at]?.place ?? '') || '')
      setEngine(made)
    })()
    return () => { cancelled = true; made?.destroy() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const snapshot = useSyncExternalStore(
    listener => engine?.subscribe(() => listener()) ?? (() => {}),
    () => engine?.getSnapshot() ?? null,
  )
  useEffect(() => { engine?.setWpm(wpm) }, [engine, wpm])

  // Space plays and pauses, the arrows step back and on, Escape closes.
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (!engine) return
      if (e.key === ' ') { e.preventDefault(); if (engine.state === 'PLAYING') engine.pause(); else engine.play() }
      else if (e.key === 'ArrowLeft') engine.previous()
      else if (e.key === 'ArrowRight') engine.next()
      else if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', keys)
    return () => window.removeEventListener('keydown', keys)
  }, [engine, onClose])

  const item = snapshot?.currentItem
  const word = item?.value ?? ''
  const focus = item?.ovpIndex ?? 0
  const playing = snapshot?.state === 'PLAYING'
  const left = snapshot?.timing.remainingDurationMs
  return (
    <div className="speed-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="speed" role="dialog" aria-label="Speed reading">
        <div className="speed-head">
          <b>Speed reading</b>
          {from && <span>{`from ${from}`}</span>}
          <span className="spacer" />
          <button className="speed-close" aria-label="Close" onClick={onClose}><X size={18} aria-hidden /></button>
        </div>
        {empty
          ? <p className="speed-empty">Open a book and turn to a page with text, then start speed reading.</p>
          : (
            <div ref={stage} className="speed-stage" onClick={() => { if (!engine) return; if (playing) engine.pause(); else engine.play() }}>
              <span className="speed-guide" aria-hidden />
              <span className="speed-word" aria-live="off">
                <span className="before">{word.slice(0, focus)}</span>
                <span className="focus">{word.charAt(focus)}</span>
                <span className="after">{word.slice(focus + 1)}</span>
              </span>
              {!word && <span className="speed-hint">Tap to start</span>}
            </div>
          )}
        <div className="speed-progress"><i style={{ width: `${Math.round((snapshot?.progress ?? 0) * 100)}%` }} /></div>
        <div className="speed-controls">
          <button aria-label="Back a word" disabled={!engine} onClick={() => engine?.previous()}><SkipBack size={18} aria-hidden /></button>
          <button className="primary speed-play" aria-label={playing ? 'Pause' : 'Read'} disabled={!engine} onClick={() => { if (playing) engine?.pause(); else engine?.play() }}>
            {playing ? <Pause size={20} aria-hidden /> : <Play size={20} aria-hidden />}
          </button>
          <button aria-label="On a word" disabled={!engine} onClick={() => engine?.next()}><SkipForward size={18} aria-hidden /></button>
        </div>
        <label className="speed-pace">
          <span>{`${wpm} words a minute`}</span>
          <input type="range" min={100} max={900} step={25} value={wpm} onChange={e => setWpm(Number(e.target.value))} />
        </label>
        {left != null && left > 0 && <p className="speed-left">{`About ${Math.max(1, Math.round(left / 60000))} min to the end of the book at this pace`}</p>}
      </div>
    </div>
  )
}
