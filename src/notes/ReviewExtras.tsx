import { useEffect, useRef, useState } from 'react'
import { BookOpen, Pause, Play, X } from 'lucide-react'
import { Tool } from '../ui'
import { baseName, goToPlace, openBookByName } from '../lib/platform'
import { placeName } from '../lib/library'
import { usePref } from '../lib/prefs'
import { useReadAloud } from '../lib/speech'
import { forgottenCards, type Flashcard } from '../lib/review'

const openAt = (card: Flashcard) => {
  openBookByName(card.book)
  if (card.place) for (const delay of [800, 2200]) setTimeout(() => goToPlace({ book: card.book, place: card.place! }), delay)
}
// A card's text as it is read out: a gap is said as "blank".
const spoken = (text: string) => text.replace(/［\s*…\s*］/g, ' … blank … ').replace(/\s+/g, ' ').trim()

// ── Listen to your cards, hands free: on a walk, on the bus, washing up ──
// Each card's front is read, then a pause to answer in your head, then its back. When it is not time for them,
// nothing changes in when they come up next: this is going over them, not grading them.
export function ListenToCards({ cards, onLeave }: { cards: Flashcard[]; onLeave(): void }) {
  const list = cards.filter(card => !card.picture && card.back)
  const [pause, setPause] = usePref('listen-pause', 5)
  const [at, setAt] = useState<{ index: number; side: 'front' | 'back' } | null>(null)
  const voice = useReadAloud()
  const stopped = useRef(false)
  const start = (from = 0) => {
    stopped.current = false
    let index = from, side: 'front' | 'back' = 'front'
    const wait = (seconds: number) => new Promise(resolve => setTimeout(resolve, seconds * 1000))
    void voice.start(async () => {
      if (side === 'back') await wait(pause)
      else if (index > from) await wait(1.5)
      if (stopped.current || index >= list.length) return null
      const card = list[index]
      setAt({ index, side })
      const text = spoken(side === 'front' ? card.front : card.back)
      if (side === 'back') { side = 'front'; index++ } else side = 'back'
      return text
    })
  }
  useEffect(() => () => { stopped.current = true }, [])
  const card = at ? list[at.index] : null
  if (!list.length) return <div className="review-empty"><p>No cards with words to listen to.</p><Tool icon={X} label="Back" onClick={onLeave} /></div>
  return (
    <div className="listen-cards">
      <p className="review-count">{`Listening · ${at ? at.index + 1 : 0} / ${list.length}`}</p>
      <div className="review-card">
        {card ? <>
          <div className="review-front">{card.front}</div>
          {at?.side === 'back' && <div className="review-back">{card.back}</div>}
        </> : <p className="review-note">Each card is read aloud: the question, a pause to answer in your head, then the answer. Your cards’ schedule does not change.</p>}
      </div>
      <div className="review-grades">
        {voice.speaking
          ? <button className="primary" onClick={() => { stopped.current = true; voice.stop() }}><Pause size={16} aria-hidden /> Pause</button>
          : <button className="primary" onClick={() => start(at ? at.index + (at.side === 'back' ? 1 : 0) : 0)}><Play size={16} aria-hidden /> {at ? 'Go on' : 'Start listening'}</button>}
        <label className="menu-row">Time to answer
          <select value={pause} onChange={e => setPause(Number(e.target.value))}>{[3, 5, 8, 12].map(n => <option key={n} value={n}>{n} s</option>)}</select>
        </label>
        <Tool icon={X} label="Stop listening" onClick={() => { stopped.current = true; voice.stop(); onLeave() }} />
      </div>
    </div>
  )
}

// ── The cards you keep forgetting, with the pages they come from ──
export function ForgottenCards({ onLeave }: { onLeave(): void }) {
  const [found, setFound] = useState<{ card: Flashcard; lapses: number }[] | null>(null)
  useEffect(() => { void forgottenCards().then(setFound) }, [])
  return (
    <div className="forgotten">
      <div className="study-sheet-head"><b>Cards you keep forgetting</b><button className="menu-x" aria-label="Close" onClick={onLeave}><X size={16} aria-hidden /></button></div>
      <p className="menu-note">Forgotten again and again after you had learned them. Reading their page again often helps more than more turns of the card.</p>
      {!found ? <p className="review-note">Looking through your cards…</p> : !found.length ? <p className="review-note">None: every card you learned has stayed learned.</p> : (
        <div className="word-list">
          {found.map(({ card, lapses }) => (
            <div key={card.id} className="word-row">
              <div>
                <b>{card.front.slice(0, 160)}</b>
                <p>{card.back.slice(0, 160)}</p>
                <p>{`${baseName(card.book)}${card.place ? ` · ${placeName(card.place)}` : ''} · forgotten ${lapses} times`}</p>
              </div>
              {card.place && <span className="question-tools"><button title="Read its page again" aria-label="Read its page again" onClick={() => openAt(card)}><BookOpen size={15} aria-hidden /></button></span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
