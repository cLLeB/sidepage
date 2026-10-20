import { useEffect, useMemo, useState } from 'react'
import { Check, Timer, X } from 'lucide-react'
import { baseName } from '../lib/platform'
import { allCards, grade, Rating, type Flashcard } from '../lib/review'
import { PictureCard } from './PictureCards'

// A mock exam: questions drawn from the cards of the books you choose, each with four answers to pick from (the
// right one and three taken from other cards), against the clock if you like. At the end: the score, book by
// book, the questions missed with their right answers, and the choice to count it all in your reviews.
type Question = { card: Flashcard; right: string; choices: string[] }

const shuffle = <T,>(items: T[]) => {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]] }
  return out
}
const short = (text: string) => (text.length > 220 ? `${text.slice(0, 220)}…` : text)

function questionsFrom(cards: Flashcard[], count: number): Question[] {
  const answers = [...new Set(cards.map(card => card.back.trim()).filter(Boolean))]
  return shuffle(cards.filter(card => card.back.trim())).slice(0, count).flatMap(card => {
    // Answers to a picture card come from the labels of the same picture where it has enough of them.
    const pool = card.picture
      ? [...new Set(card.picture.boxes.map(box => box.label?.trim()).filter((label): label is string => !!label))]
      : answers
    const others = shuffle((pool.length >= 4 ? pool : answers).filter(answer => answer !== card.back.trim())).slice(0, 3)
    if (others.length < 2) return []
    return [{ card, right: card.back.trim(), choices: shuffle([card.back.trim(), ...others]) }]
  })
}

export default function Exam({ onLeave }: { onLeave(): void }) {
  const [cards, setCards] = useState<Flashcard[] | null>(null)
  const [books, setBooks] = useState<string[]>([])
  const [count, setCount] = useState(20)
  const [minutes, setMinutes] = useState(0)
  const [questions, setQuestions] = useState<Question[] | null>(null)
  const [at, setAt] = useState(0)
  const [picked, setPicked] = useState<Record<number, string>>({})
  const [ends, setEnds] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [finished, setFinished] = useState(false)
  const [counted, setCounted] = useState(false)

  useEffect(() => { void allCards().then(found => { setCards(found); setBooks([...new Set(found.filter(card => card.back).map(card => card.book))]) }) }, [])
  const withCards = useMemo(() => [...new Set((cards ?? []).filter(card => card.back).map(card => card.book))], [cards])
  useEffect(() => {
    if (!ends || finished) return
    const tick = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(tick)
  }, [ends, finished])
  useEffect(() => { if (ends && now >= ends) setFinished(true) }, [now, ends])

  if (!cards) return <div className="exam"><p className="review-note">Gathering your cards…</p></div>

  // ── Setting it up ──
  if (!questions) {
    const pool = cards.filter(card => books.includes(card.book))
    const possible = questionsFrom(pool, 1000).length
    return (
      <div className="exam">
        <h2>Mock exam</h2>
        <p className="review-note">Questions from your cards, four answers each. Choose what it covers.</p>
        <div className="exam-books">
          {withCards.map(book => (
            <label key={book} className="exam-book">
              <input type="checkbox" checked={books.includes(book)} onChange={e => setBooks(e.target.checked ? [...books, book] : books.filter(other => other !== book))} />
              {baseName(book)} <span>{`${cards.filter(card => card.book === book && card.back).length} cards`}</span>
            </label>
          ))}
        </div>
        <div className="exam-options">
          <label className="menu-row">Questions<select value={count} onChange={e => setCount(Number(e.target.value))}>{[10, 20, 30, 50].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
          <label className="menu-row">Time<select value={minutes} onChange={e => setMinutes(Number(e.target.value))}><option value={0}>No limit</option>{[5, 10, 15, 20, 30, 45, 60].map(m => <option key={m} value={m}>{m} minutes</option>)}</select></label>
        </div>
        {possible < 4 && <p className="review-note">Too few cards with answers for an exam yet: at least four are needed among the books chosen.</p>}
        <div className="review-grades">
          <button className="soft" onClick={onLeave}>Back</button>
          <button className="primary" disabled={possible < 4} onClick={() => {
            setQuestions(questionsFrom(pool, count))
            setAt(0); setPicked({}); setFinished(false); setCounted(false)
            setEnds(minutes ? Date.now() + minutes * 60_000 : 0); setNow(Date.now())
          }}>Begin ({Math.min(count, possible)} questions)</button>
        </div>
      </div>
    )
  }

  const total = questions.length
  const right = questions.filter((question, i) => picked[i] === question.right).length

  // ── The result ──
  if (finished || Object.keys(picked).length === total && at >= total) {
    const byBook = [...new Set(questions.map(question => question.card.book))].map(book => {
      const mine = questions.map((question, i) => ({ question, i })).filter(({ question }) => question.card.book === book)
      return { book, right: mine.filter(({ question, i }) => picked[i] === question.right).length, of: mine.length }
    })
    const missed = questions.map((question, i) => ({ question, i })).filter(({ question, i }) => picked[i] !== question.right)
    return (
      <div className="exam">
        <h2>{Math.round((right / total) * 100)}%</h2>
        <p className="review-note">{`${right} of ${total} right${ends && now >= ends ? ' · time ran out' : ''}`}</p>
        <div className="exam-results">
          {byBook.map(row => (
            <div key={row.book} className="exam-row"><span>{baseName(row.book)}</span><span className="meter"><i style={{ width: `${(row.right / row.of) * 100}%` }} /></span><b>{row.right}/{row.of}</b></div>
          ))}
        </div>
        {missed.length > 0 && <>
          <p className="eyebrow">To look at again</p>
          <div className="exam-missed">
            {missed.map(({ question, i }) => (
              <div key={i} className="exam-miss">
                <p>{question.card.picture ? `Picture card · ${question.card.front}` : short(question.card.front)}</p>
                <p><X size={14} aria-hidden /> {picked[i] ? short(picked[i]) : 'Not answered'}</p>
                <p className="right"><Check size={14} aria-hidden /> {short(question.right)}</p>
              </div>
            ))}
          </div>
        </>}
        <div className="review-grades">
          <button className="soft" disabled={counted} onClick={() => {
            // Counted in the reviews: a right answer as "Good", a wrong one as "Again" (it comes back soon).
            setCounted(true)
            void (async () => { for (const [i, question] of questions.entries()) await grade(question.card, picked[i] === question.right ? Rating.Good : Rating.Again) })()
          }}>{counted ? 'Counted in your reviews' : 'Count this in my reviews'}</button>
          <button className="soft" onClick={() => setQuestions(null)}>Another exam</button>
          <button className="primary" onClick={onLeave}>Done</button>
        </div>
      </div>
    )
  }

  // ── The questions, one at a time ──
  const question = questions[Math.min(at, total - 1)]
  const left = ends ? Math.max(0, Math.ceil((ends - now) / 1000)) : 0
  return (
    <div className="exam">
      <p className="review-count">
        {`Question ${Math.min(at, total - 1) + 1} of ${total} · ${baseName(question.card.book)}`}
        {ends > 0 && <span className={left < 60 ? 'exam-clock low' : 'exam-clock'}><Timer size={13} aria-hidden /> {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>}
      </p>
      <div className="review-card">
        {question.card.picture
          ? <><PictureCard {...question.card.picture} turned={false} /><p className="review-note">What is under the marked box?</p></>
          : <div className="review-front">{question.card.front}</div>}
      </div>
      <div className="exam-choices">
        {question.choices.map(choice => (
          <button key={choice} className={picked[at] === choice ? 'exam-choice on' : 'exam-choice'} onClick={() => setPicked({ ...picked, [at]: choice })}>{short(choice)}</button>
        ))}
      </div>
      <div className="review-grades">
        <button className="soft" disabled={at === 0} onClick={() => setAt(at - 1)}>Back</button>
        <button className="soft" onClick={() => setFinished(true)}>Finish now</button>
        <button className="primary" disabled={!picked[at]} onClick={() => setAt(at + 1)}>{at + 1 >= total ? 'See the result' : 'Next'}</button>
      </div>
    </div>
  )
}
