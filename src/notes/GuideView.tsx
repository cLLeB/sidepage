import { useEffect, useRef, useState } from 'react'
import ForceGraph from 'force-graph'
import { useTheme } from '../lib/theme'
import { BookOpenText, NotebookPen } from 'lucide-react'
import { Tool } from '../ui'
import { baseName, goToPlace, onPlace, openBookByName, placeNow, sendQuote, type Place } from '../lib/platform'
import { placeName } from '../lib/library'
import { gistOf, kinOf, quizOf, termLinks, termsOf, type Kin, type Question, type Term } from '../lib/insight'

// The terms of a book drawn as a map: each a dot sized by how often it comes, joined to those it keeps company with.
function IdeaMap({ terms, onPick }: { terms: Term[]; onPick(term: Term): void }) {
  const host = useRef<HTMLDivElement>(null)
  const theme = useTheme()
  const pick = useRef(onPick)
  pick.current = onPick
  useEffect(() => {
    const el = host.current
    if (!el) return
    const links = termLinks(terms)
    const joined = new Set(links.flatMap(link => [link.source, link.target]))
    const shown = terms.filter(term => joined.has(term.term))
    if (!shown.length) return
    const css = getComputedStyle(document.documentElement)
    const colour = (name: string) => css.getPropertyValue(name).trim()
    const most = Math.max(...shown.map(term => term.count))
    type Dot = { id: string; count: number; x?: number; y?: number }
    const graph = new ForceGraph(el)
      .width(el.clientWidth).height(el.clientHeight).backgroundColor('rgba(0,0,0,0)')
      .graphData({ nodes: shown.map(term => ({ id: term.term, count: term.count })), links: links.map(link => ({ ...link })) })
      .linkColor(() => colour('--border')).linkWidth(link => 1 + 4 * (link as { strength: number }).strength)
      .nodeCanvasObject((node, ctx, scale) => {
        const { x = 0, y = 0, id, count } = node as Dot
        const radius = 3 + 7 * Math.sqrt(count / most)
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fillStyle = colour('--accent'); ctx.fill()
        ctx.font = `${11.5 / scale}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = colour('--text')
        ctx.fillText(id, x, y + radius + 2 / scale)
      })
      .nodePointerAreaPaint((node, paint, ctx) => { ctx.fillStyle = paint; ctx.beginPath(); ctx.arc(node.x ?? 0, node.y ?? 0, 12, 0, Math.PI * 2); ctx.fill() })
      .onNodeClick(node => { const term = terms.find(found => found.term === (node as Dot).id); if (term) pick.current(term) })
      .cooldownTime(1500)
      .onEngineStop(() => graph.zoomToFit(0, 30))
    const resize = new ResizeObserver(() => graph.width(el.clientWidth).height(el.clientHeight))
    resize.observe(el)
    return () => { resize.disconnect(); graph._destructor(); el.replaceChildren() }
  }, [terms, theme])
  return <div ref={host} className="idea-map" />
}

// A few questions on the page: a key term taken out of each of its weightiest sentences, to pick back.
function Quiz({ questions }: { questions: Question[] }) {
  const [picked, setPicked] = useState<Record<number, string>>({})
  useEffect(() => setPicked({}), [questions])
  const right = questions.filter((question, i) => picked[i] === question.answer).length
  return (
    <div className="quiz">
      {questions.map((question, i) => (
        <div key={i} className="quiz-item">
          <p>{question.before}<b className={picked[i] ? 'blank shown' : 'blank'}>{picked[i] ? question.answer : '_____'}</b>{question.after}</p>
          <div className="quiz-choices">
            {question.choices.map(choice => (
              <button key={choice} disabled={!!picked[i]} className={!picked[i] ? 'chip' : choice === question.answer ? 'chip right' : choice === picked[i] ? 'chip wrong' : 'chip'} onClick={() => setPicked({ ...picked, [i]: choice })}>{choice}</button>
            ))}
          </div>
        </div>
      ))}
      {Object.keys(picked).length === questions.length && <p className="quiz-score">{right} of {questions.length} right</p>}
    </div>
  )
}

// A study guide for the page in front of you, worked out from the book's own words: the gist of the page, the
// terms the book turns on (and where each is thickest), and the places in your other books on the same subject.
export default function GuideView() {
  const [here, setHere] = useState<Place | null>(placeNow)
  const [gist, setGist] = useState<string[] | null>(null)
  const [terms, setTerms] = useState<Term[] | null>(null)
  const [kin, setKin] = useState<Kin[] | null>(null)
  const [picked, setPicked] = useState<Term | null>(null)
  const [quiz, setQuiz] = useState<Question[] | null>(null)
  const [showMap, setShowMap] = useState(false)

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

  // The quiz needs the book's terms as well as the page.
  useEffect(() => {
    setQuiz(null)
    if (!here || !terms?.length) return
    let cancelled = false
    void quizOf(here.book, here.place, terms).then(found => { if (!cancelled) setQuiz(found) })
    return () => { cancelled = true }
  }, [here, terms])

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

      {quiz && quiz.length > 0 && (
        <section>
          <h3>Test yourself on this page</h3>
          <Quiz questions={quiz} />
        </section>
      )}

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
        {terms && terms.length > 4 && <button className="soft" onClick={() => setShowMap(!showMap)}>{showMap ? 'Hide the map of ideas' : 'Show how its ideas connect'}</button>}
        {showMap && terms && <IdeaMap terms={terms} onPick={setPicked} />}
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
