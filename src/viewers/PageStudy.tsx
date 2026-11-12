import { useEffect, useMemo, useState } from 'react'
import { CircleHelp, Check, Sparkles, X } from 'lucide-react'
import { Menu } from '../ui'
import { placeName } from '../lib/library'
import { askAi, sendQuote, baseName } from '../lib/platform'
import {
  addQuestion, answerQuestion, dropQuestion, onPageMarks, pageMarksOf, recapOf, usesOf, whereExplained,
  type Explained, type Known, type PageMarks, type Recap, type Use,
} from '../lib/pages'

// Study marks on the pages of a book: how well you know each page, and the questions it left you with.
export function usePageMarks(book: string) {
  const [marks, setMarks] = useState<PageMarks>({ known: {}, questions: [] })
  useEffect(() => {
    let cancelled = false
    const read = () => void pageMarksOf(book).then(found => { if (!cancelled) setMarks(found) })
    read()
    const stop = onPageMarks(changed => { if (changed === book) read() })
    return () => { cancelled = true; stop() }
  }, [book])
  return marks
}

export const KNOWN: Record<Known, { name: string; colour: string }> = {
  1: { name: 'Not yet', colour: '#e5484d' },
  2: { name: 'Partly', colour: '#f5a524' },
  3: { name: 'Well', colour: '#30a46c' },
}

// The questions a book left you with: answer them yourself, ask the AI, or go back to the passage.
export function QuestionsMenu({ book, marks, onGo }: { book: string; marks: PageMarks; onGo(place: string): void }) {
  const open = marks.questions.filter(q => !q.answered)
  if (!marks.questions.length) return null
  return (
    <Menu quiet icon={CircleHelp} label={`Open questions (${open.length})`} hint="The questions you noted on passages of this book" on={open.length > 0}>
      <p className="menu-head">Open questions</p>
      {open.length === 0 && <p className="menu-note">Every question is answered.</p>}
      <div className="menu-scroll questions">
        {marks.questions.map(q => (
          <div key={q.id} className={q.answered ? 'question answered' : 'question'}>
            <button className="menu-item" onClick={() => onGo(q.place)}>
              <b>{q.question}</b>
              <span>{placeName(q.place)} · “{q.passage.slice(0, 90)}{q.passage.length > 90 ? '…' : ''}”</span>
            </button>
            <span className="question-tools">
              {!q.answered && <button title="Ask the AI this question about the passage" aria-label="Ask AI" onClick={() => askAi(`${q.question}\n\nAbout this passage (${placeName(q.place)}): “${q.passage}”`)}><Sparkles size={14} aria-hidden /></button>}
              <button className="stay" title={q.answered ? 'Open it again' : 'I have the answer'} aria-label={q.answered ? 'Open it again' : 'Answered'} onClick={() => void answerQuestion(book, q.id, !q.answered)}><Check size={14} aria-hidden /></button>
              <button className="stay" title="Remove" aria-label="Remove" onClick={() => void dropQuestion(book, q.id)}><X size={14} aria-hidden /></button>
            </span>
          </div>
        ))}
      </div>
    </Menu>
  )
}

// A sheet over the page: every use of some words (a concordance), where the book explains them, or a question
// to note on a passage.
export type Sheet =
  | { kind: 'uses'; words: string }
  | { kind: 'explained'; words: string }
  | { kind: 'question'; passage: string; place: string }
export function StudySheet({ book, sheet, onGo, onClose }: { book: string; sheet: Sheet; onGo(place: string): void; onClose(): void }) {
  const [uses, setUses] = useState<Use[] | null>(null)
  const [explained, setExplained] = useState<Explained | null | undefined>(undefined)
  const [order, setOrder] = useState<'book' | 'after' | 'before'>('book')
  const [question, setQuestion] = useState('')
  useEffect(() => {
    setUses(null)
    setExplained(undefined)
    if (sheet.kind === 'uses') void usesOf(book, sheet.words).then(setUses)
    if (sheet.kind === 'explained') void whereExplained(book, sheet.words).then(setExplained)
  }, [book, sheet])
  // Sorted by the word after (or before) the one looked for, uses of the same phrase come together.
  const sorted = useMemo(() => {
    if (!uses || order === 'book') return uses
    const key = (use: Use) => (order === 'after' ? use.after.trim().toLowerCase() : use.before.trim().split(' ').reverse().join(' ').toLowerCase())
    return [...uses].sort((a, b) => key(a).localeCompare(key(b)))
  }, [uses, order])

  return (
    <div className="study-sheet" role="dialog" aria-label="Study">
      <div className="study-sheet-head">
        <b>{sheet.kind === 'uses' ? `“${sheet.words}” in this book` : sheet.kind === 'explained' ? `Where “${sheet.words}” is explained` : 'A question about this passage'}</b>
        <button className="menu-x" aria-label="Close" onClick={onClose}><X size={16} aria-hidden /></button>
      </div>
      {sheet.kind === 'uses' && (!sorted ? <p className="guide-wait">Looking through the book…</p> : !sorted.length ? <p className="guide-wait">Not found in the book’s text.</p> : <>
        <div className="study-sheet-row">
          <span>{sorted.length >= 400 ? '400 or more uses' : `${sorted.length} use${sorted.length === 1 ? '' : 's'} on ${new Set(sorted.map(use => use.place)).size} page${new Set(sorted.map(use => use.place)).size === 1 ? '' : 's'}`}</span>
          <span className="spacer" />
          <label>Order <select value={order} onChange={e => setOrder(e.target.value as typeof order)}>
            <option value="book">As in the book</option>
            <option value="after">By the word after</option>
            <option value="before">By the word before</option>
          </select></label>
        </div>
        <div className="concordance">
          {sorted.map((use, i) => (
            <button key={i} onClick={() => onGo(use.place)}>
              <span className="kwic-place">{placeName(use.place)}</span>
              <span className="kwic-before"><span>{use.before}</span></span>
              <mark>{use.match}</mark>
              <span className="kwic-after">{use.after}</span>
            </button>
          ))}
        </div>
      </>)}
      {sheet.kind === 'explained' && (explained === undefined ? <p className="guide-wait">Looking through the book…</p> : !explained ? <p className="guide-wait">Not found in the book’s text.</p> : <div className="explained">
        <p className="eyebrow">{`${explained.defines ? 'Explained' : 'First comes'} on ${placeName(explained.place)}`}</p>
        <blockquote>{explained.sentence}</blockquote>
        <div className="study-sheet-row">
          <button className="primary" onClick={() => onGo(explained.place)}>Go there</button>
          <button className="soft" onClick={() => sendQuote({ text: explained.sentence, source: `${baseName(book)}, ${placeName(explained.place)}`, book, place: explained.place })}>Add to notes</button>
          <button className="soft" onClick={() => onClose()}>Close</button>
        </div>
      </div>)}
      {sheet.kind === 'question' && <form className="explained" onSubmit={e => {
        e.preventDefault()
        if (!question.trim()) return
        void addQuestion(book, { place: sheet.place, passage: sheet.passage, question: question.trim() })
        onClose()
      }}>
        <blockquote>{sheet.passage}</blockquote>
        <textarea autoFocus rows={3} placeholder="What do you want to find out?" value={question} onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }} />
        <p className="menu-note">It is kept under Open questions in the book’s bar, and marked on the page map, until you answer it.</p>
        <div className="study-sheet-row">
          <button className="primary" type="submit">Keep the question</button>
          <button className="soft" type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>}
    </div>
  )
}

// Coming back to a book after a few days: what you were reading last time, in brief.
export function RecapCard({ book, onGo }: { book: string; onGo(page: number): void }) {
  const [recap, setRecap] = useState<Recap | null>(null)
  useEffect(() => {
    let cancelled = false
    // A moment after opening, once the book's words are at hand (a book opened the first time on this device
    // has its words read first, so it is tried again a little later).
    let timer = 0
    const look = (tries: number) => {
      timer = window.setTimeout(() => void recapOf(book).then(found => {
        if (cancelled) return
        if (found) setRecap(found)
        else if (tries > 1) look(tries - 1)
      }), 1500)
    }
    look(4)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [book])
  if (!recap) return null
  const when = recap.daysAgo < 7 ? `${recap.daysAgo} days ago` : recap.daysAgo < 14 ? 'last week' : `${Math.round(recap.daysAgo / 7)} weeks ago`
  return (
    <div className="recap" role="note">
      <div className="study-sheet-head">
        <b>{`Last time, ${when}: ${recap.from === recap.to ? `p. ${recap.to}` : `pp. ${recap.from} to ${recap.to}`}`}</b>
        <button className="menu-x" aria-label="Close" onClick={() => setRecap(null)}><X size={16} aria-hidden /></button>
      </div>
      <ul>{recap.gist.map((line, i) => <li key={i}>{line}</li>)}</ul>
      <div className="study-sheet-row">
        <button className="primary" onClick={() => { onGo(recap.to); setRecap(null) }}>{`Go on from p. ${recap.to}`}</button>
        <button className="soft" onClick={() => setRecap(null)}>Close</button>
      </div>
    </div>
  )
}
