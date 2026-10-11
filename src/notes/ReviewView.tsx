import { useCallback, useEffect, useState } from 'react'
import { BookOpen, RotateCcw } from 'lucide-react'
import { Tool } from '../ui'
import { baseName, goToPlace, openBookByName } from '../lib/platform'
import { dueCards, grade, Rating, type Flashcard } from '../lib/review'

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

  const load = useCallback(() => {
    setCards(null)
    setDone(0)
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
        </div>
      </div>
    )
  }

  const answer = async (rating: (typeof GRADES)[number]['rating']) => {
    await grade(card, rating)
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
    <div className="note review">
      <p className="review-count">{cards.length} to go · {baseName(card.book)}</p>
      <div className="review-card">
        <div className="review-front">{card.front}</div>
        {turned && <div className="review-back">{card.back || 'You have not added a comment to this passage yet.'}</div>}
      </div>
      {turned
        ? <div className="review-grades">
            {GRADES.map(option => <button key={option.name} title={option.hint} onClick={() => void answer(option.rating)}>{option.name}</button>)}
          </div>
        : <button className="primary" onClick={() => setTurned(true)}>Show the other side</button>}
      <Tool icon={BookOpen} label="Open in the book" onClick={openInBook} />
    </div>
  )
}
