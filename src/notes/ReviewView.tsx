import { useCallback, useEffect, useState } from 'react'
import { BookOpen, FileDown, Repeat, RotateCcw } from 'lucide-react'
import { Tool } from '../ui'
import { baseName, goToPlace, openBookByName, saveFileAs } from '../lib/platform'
import { allCards, dueCards, grade, Rating, type Flashcard } from '../lib/review'
import { PictureCard } from './PictureCards'

// Every card, front and back on one line with a tab between: the form Anki and most flashcard apps import.
const exportCards = async () => {
  const flat = (text: string) => text.replace(/\s+/g, ' ').trim()
  const lines = (await allCards()).filter(card => card.back && !card.picture).map(card => `${flat(card.front)}\t${flat(card.back)}\t${baseName(card.book)}`)
  await saveFileAs('Sidepage flashcards.txt', new TextEncoder().encode(lines.join('\n') + '\n'))
}

const focusHere = (card: HTMLDivElement | null) => card?.focus({ preventScroll: true })

const GRADES = [
  { rating: Rating.Again, name: 'Again', hint: 'I did not remember' },
  { rating: Rating.Hard, name: 'Hard', hint: 'I remembered with effort' },
  { rating: Rating.Good, name: 'Good', hint: 'I remembered' },
  { rating: Rating.Easy, name: 'Easy', hint: 'I knew it at once' },
] as const

// Go through the flashcards that are due, one at a time: read the front, recall, turn it over, say how it went.
export default function ReviewView() {
  const [cards, setCards] = useState<Flashcard[] | null>(null)
  const [total, setTotal] = useState(0)
  const [turned, setTurned] = useState(false)
  const [done, setDone] = useState(0)
  // Practice: every card in a shuffled pile, without touching when each is next due.
  const [practice, setPractice] = useState(false)
  const practise = () => void allCards().then(all => {
    setPractice(true)
    setTurned(false)
    setCards(all.filter(card => card.back || card.picture).sort(() => Math.random() - 0.5))
  })

  const load = useCallback(() => {
    setCards(null)
    setDone(0)
    setPractice(false)
    void dueCards().then(found => {
      setCards(found.due)
      setTotal(found.total)
      setTurned(false)
    })
  }, [])
  useEffect(load, [load])

  if (!cards) return <div className="note review"><p className="review-note">Gathering your cards…</p></div>

  const card = cards[0]
  if (!card) {
    return (
      <div className="note review">
        <div className="review-empty">
          <h2>{total ? 'All caught up' : 'No cards yet'}</h2>
          <p>
            {total
              ? `You went through ${done} card${done === 1 ? '' : 's'}. ${total} in all; each comes back when it is time.`
              : 'Cards make themselves from your reading: highlight a passage in a book and add a comment to it, or write a line starting “Q:” in your notes with a line starting “A:” under it.'}
          </p>
          <Tool icon={RotateCcw} label="Check again" onClick={load} />
          {total > 0 && <Tool icon={Repeat} label="Practise every card anyway" hint="Go through all your cards now, without changing when they are due" onClick={practise} />}
          {total > 0 && <Tool icon={FileDown} label="Save the cards for Anki" hint="A text file other flashcard apps can import" onClick={() => void exportCards()} />}
        </div>
      </div>
    )
  }

  const answer = async (rating: (typeof GRADES)[number]['rating']) => {
    if (!practice) await grade(card, rating)
    setDone(done + 1)
    setTurned(false)
    // "Again" comes round once more at the end of this sitting.
    setCards(rating === Rating.Again ? [...cards.slice(1), card] : cards.slice(1))
  }

  const openInBook = () => {
    openBookByName(card.book)
    if (card.place) for (const delay of [800, 2200]) setTimeout(() => goToPlace({ book: card.book, place: card.place! }), delay)
  }

  return (
    <div
      className="note review" tabIndex={0} ref={focusHere}
      onKeyDown={e => {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setTurned(true) }
        const picked = GRADES[Number(e.key) - 1]
        if (turned && picked) void answer(picked.rating)
      }}
    >
      <p className="review-count">{practice ? 'Practice · ' : ''}{cards.length} to go · {baseName(card.book)}</p>
      <div className="review-card">
        {card.picture
          ? <>
              <PictureCard {...card.picture} turned={turned} />
              <p className="review-note">{turned && card.back ? card.back : `What is under the marked box? · ${card.front}`}</p>
            </>
          : <>
              <div className="review-front">{card.front}</div>
              {turned && <div className="review-back">{card.back || 'You have not added a comment to this passage yet.'}</div>}
            </>}
      </div>
      {turned
        ? <div className="review-grades">
            {GRADES.map(option => <button key={option.name} title={option.hint} onClick={() => void answer(option.rating)}>{option.name}</button>)}
          </div>
        : <button className="primary" onClick={() => setTurned(true)}>Show the other side</button>}
      <div className="review-grades">
        <Tool icon={BookOpen} label="Open in the book" onClick={openInBook} />
        <Tool icon={FileDown} label="Save the cards for Anki" hint="A text file other flashcard apps can import" onClick={() => void exportCards()} />
      </div>
      <p className="review-note keys">Space turns the card · 1 to 4 say how it went</p>
    </div>
  )
}
