import { useEffect, useState } from 'react'
import { BookOpenText, NotebookPen } from 'lucide-react'
import { Tool } from '../ui'
import { baseName, goToPlace, onPlace, openBookByName, placeNow, sendQuote, type Place } from '../lib/platform'
import { placeName } from '../lib/library'
import { gistOf, kinOf, termsOf, type Kin, type Term } from '../lib/insight'

// A study guide for the page in front of you, worked out from the book's own words: the gist of the page, the
// terms the book turns on (and where each is thickest), and the places in your other books on the same subject.
export default function GuideView() {
  const [here, setHere] = useState<Place | null>(placeNow)
  const [gist, setGist] = useState<string[] | null>(null)
  const [terms, setTerms] = useState<Term[] | null>(null)
  const [kin, setKin] = useState<Kin[] | null>(null)
  const [picked, setPicked] = useState<Term | null>(null)

  useEffect(() => onPlace(setHere), [])

  // The terms belong to the book; they are worked out once for each book opened.
  const book = here?.book
  useEffect(() => {
    setTerms(null)
    setPicked(null)
    if (!book) return
    let cancelled = false
    void termsOf(book).then(found => { if (!cancelled) setTerms(found) })
    return () => { cancelled = true }
  }, [book])

  // The gist and the kindred places follow the page, a moment after it settles.
  useEffect(() => {
    setGist(null)
    setKin(null)
    if (!here) return
    let cancelled = false
    const timer = setTimeout(() => {
      void gistOf(here.book, here.place).then(found => { if (!cancelled) setGist(found) })
      void kinOf(here.book, here.place).then(found => { if (!cancelled) setKin(found) })
    }, 350)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [here])

  if (!here) {
    return (
      <div className="note guide">
        <div className="review-empty">
          <h2>Study guide</h2>
          <p>Open a book and turn to a page. The guide gives the gist of that page, the terms the book turns on, and the places in your other books that are about the same thing.</p>
        </div>
      </div>
    )
  }

  const go = (to: Place) => {
    openBookByName(to.book)
    for (const delay of [100, 1200, 2600]) setTimeout(() => goToPlace(to), delay)
  }

  return (
    <div className="note guide">
      <p className="eyebrow">{baseName(here.book)} · {placeName(here.place)}</p>

      <section>
        <h3>This page in brief</h3>
        {gist === null && <p className="guide-wait">Reading the page…</p>}
        {gist?.length === 0 && <p className="guide-wait">There is not enough running text on this page to sum up. (A scanned page is a picture: use “Read text” on it first.)</p>}
        {gist && gist.length > 0 && <>
          <ul className="gist">{gist.map((sentence, i) => <li key={i}>{sentence}</li>)}</ul>
          <Tool icon={NotebookPen} label="Add to my notes" onClick={() => sendQuote({ text: gist.join('\n'), source: `${baseName(here.book)}, ${placeName(here.place)}`, book: here.book, place: here.place })} />
        </>}
      </section>

      <section>
        <h3>What this book turns on</h3>
        {terms === null && <p className="guide-wait">Going through the book…</p>}
        {terms?.length === 0 && <p className="guide-wait">This book's words have not been gathered yet. They are gathered a little after it is first opened.</p>}
        <div className="terms">
          {terms?.map(term => (
            <button key={term.term} className={picked?.term === term.term ? 'chip on' : 'chip'} style={{ fontSize: `${Math.min(15.5, 12 + Math.log2(term.count))}px` }} onClick={() => setPicked(picked?.term === term.term ? null : term)}>
              {term.term} <span>{term.count}</span>
            </button>
          ))}
        </div>
        {picked && (
          <div className="term-places">
            <span>“{picked.term}” is thickest at</span>
            {picked.places.map(found => <button key={found.place} className="viewer-pos" onClick={() => go({ book: here.book, place: found.place })}>{placeName(found.place)} · {found.count}×</button>)}
          </div>
        )}
      </section>

      <section>
        <h3>Elsewhere in your books</h3>
        {kin === null && <p className="guide-wait">Looking through your other books…</p>}
        {kin?.length === 0 && <p className="guide-wait">None of your other books has a passage close to this one.</p>}
        {kin?.map(found => (
          <button key={found.book + found.place} className="kin" onClick={() => go(found)}>
            <span className="hit-book"><BookOpenText size={13} aria-hidden /> {baseName(found.book)} · {placeName(found.place)} · {Math.round(found.closeness * 100)}% alike</span>
            {found.line}
          </button>
        ))}
      </section>
    </div>
  )
}
