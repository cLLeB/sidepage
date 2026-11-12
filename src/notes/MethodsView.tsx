import { useEffect, useMemo, useState } from 'react'
import { Mic, Square } from 'lucide-react'
import { baseName, contentsOf, goToPlace, loadNote, openBookByName, onContents, onPlace, placeNow, type ContentsItem, type Place } from '../lib/platform'
import { placeName } from '../lib/library'
import { usePref } from '../lib/prefs'
import { askBooks, checkRecall, stretchesOf, type Answer, type Recall } from '../lib/insight'
import { compareWords, type Marked } from '../lib/practice'
import { languageOf } from '../lib/speech'
import { useDictate } from '../lib/dictate'
import { currentTheme } from '../lib/theme'
import {
  addStudyCards, examQuestions, fade, learningOrder, mnemonicFor, newMnemonicSeed, orderDiagram, questionFor, textOfPdf, type Step,
} from '../lib/methods'

// Study methods beside the book, each worked on the book you are reading.
const METHODS = {
  memorise: { name: 'Memorise a passage', hint: 'Its words fade away a few at a time until you can say it all' },
  blurt: { name: 'Blurt it out', hint: 'Write or say all you remember of the last pages, then see what you left out' },
  sq3r: { name: 'Questions before reading (SQ3R)', hint: 'Each heading turned into the question its section answers' },
  order: { name: 'Learn in order', hint: 'The book’s key terms, each after the ones it builds on' },
  mnemonic: { name: 'Make a mnemonic', hint: 'A word and a sentence from the first letters of a list' },
  exam: { name: 'Past exam paper', hint: 'Each question of an old paper, with the pages of your books that answer it' },
} as const
type Method = keyof typeof METHODS

export default function MethodsView() {
  const [here, setHere] = useState<Place | null>(placeNow)
  useEffect(() => onPlace(setHere), [])
  const [method, setMethod] = usePref<Method>('method', 'memorise')
  const [language, setLanguage] = useState('en')
  useEffect(() => { if (here) void stretchesOf(here.book).then(all => setLanguage(languageOf(all.slice(0, 5).map(stretch => stretch.text).join(' ')))) }, [here?.book]) // eslint-disable-line react-hooks/exhaustive-deps
  // Another book is opened first, then its page found (it takes a moment to open).
  const go = (to: Place) => {
    if (to.book !== here?.book) openBookByName(to.book)
    for (const delay of to.book !== here?.book ? [100, 1200, 2600] : [0]) setTimeout(() => goToPlace(to), delay)
  }
  return (
    <div className="guide methods">
      <div className="practice-tabs" role="tablist">
        {(Object.keys(METHODS) as Method[]).map(key => <button key={key} role="tab" aria-selected={method === key} title={METHODS[key].hint} className={method === key ? 'chip on' : 'chip'} onClick={() => setMethod(key)}>{METHODS[key].name}</button>)}
      </div>
      <p className="menu-note">{METHODS[method].hint}.</p>
      {method === 'exam' ? <PastExam onGo={go} /> : !here ? <p className="guide-wait">Open a book first.</p> : <>
        {method === 'memorise' && <Memorise book={here.book} language={language} />}
        {method === 'blurt' && <Blurt here={here} language={language} onGo={go} />}
        {method === 'sq3r' && <Sq3r book={here.book} onGo={go} />}
        {method === 'order' && <Order book={here.book} onGo={go} />}
        {method === 'mnemonic' && <Mnemonic book={here.book} />}
      </>}
    </div>
  )
}

// ── Memorise: a passage, its words fading step by step; then say or write it all ──
function Memorise({ book, language }: { book: string; language: string }) {
  const [passage, setPassage] = useState('')
  const [step, setStep] = useState(0)
  const [shown, setShown] = useState<Set<number>>(new Set())
  const [highlights, setHighlights] = useState<string[]>([])
  useEffect(() => {
    void loadNote(baseName(book), 'highlights.json').then(text => { try { setHighlights((JSON.parse(text ?? '[]') as { text: string }[]).map(mark => mark.text).filter(text => text?.split(' ').length >= 6)) } catch { setHighlights([]) } })
  }, [book])
  const [given, setGiven] = useState('')
  const [result, setResult] = useState<{ marked: Marked[]; score: number } | null>(null)
  const voice = useDictate(language, heard => setGiven(now => (now ? `${now} ${heard}` : heard)))
  const pieces = useMemo(() => fade(passage, step), [passage, step])
  const take = (text: string) => { setPassage(text.replace(/\s+/g, ' ').trim()); setStep(0); setShown(new Set()); setGiven(''); setResult(null) }
  if (!passage) return (
    <section>
      <p>Select a passage on the page, then:</p>
      <button className="primary" onClick={() => { const text = window.getSelection()?.toString().trim(); if (text) take(text) }}>Use the selected passage</button>
      {highlights.length > 0 && <>
        <h3>Or one of your highlights</h3>
        <div className="word-list">{highlights.slice(-12).reverse().map((text, i) => <button key={i} className="kin" onClick={() => take(text)}>{text.slice(0, 200)}</button>)}</div>
      </>}
    </section>
  )
  return (
    <section className="memorise">
      <div className="study-sheet-row">
        <span>{`Step ${step + 1} of 5`}</span>
        <span className="spacer" />
        <button className="soft" disabled={step === 0} onClick={() => { setStep(step - 1); setShown(new Set()) }}>Fewer gaps</button>
        <button className="primary" disabled={step === 4} onClick={() => { setStep(step + 1); setShown(new Set()) }}>More gaps</button>
      </div>
      <p className="memorise-text">{pieces.map((piece, i) => !piece.hidden ? piece.text : shown.has(i)
        ? <mark key={i}>{piece.text}</mark>
        : <button key={i} className="gap" title="Show this word" onClick={() => setShown(new Set([...shown, i]))}>{piece.hint}{' '.repeat(Math.max(1, piece.text.length - piece.hint.length))}</button>)}</p>
      <p className="menu-note">Read it aloud, filling the gaps from memory; tap a gap you cannot recall. When the whole passage is hidden, say or write it all.</p>
      {step === 4 && <>
        <textarea rows={4} value={given} onChange={e => { setGiven(e.target.value); setResult(null) }} placeholder="Write the passage from memory" />
        <div className="teach-buttons">
          <button className="primary" disabled={!given.trim()} onClick={async () => setResult(await compareWords(passage, given))}>Check</button>
          <button className={voice.recording ? 'soft recording' : 'soft'} onClick={() => void voice.toggle()}>{voice.recording ? <Square size={14} aria-hidden /> : <Mic size={15} aria-hidden />} {voice.recording ? 'Stop' : 'Say it'}</button>
          {voice.busy && <span className="menu-note">{voice.busy}</span>}
        </div>
        {result && <div className="drill-result">
          <p className="practice-score">{`${Math.round(result.score * 100)}% right${result.score === 1 ? '. Perfect.' : ''}`}</p>
          <p className="drill-marked">{result.marked.map((part, i) => <span key={i} className={`drill-${part.kind}`}>{part.text} </span>)}</p>
        </div>}
      </>}
      <button className="link-button" onClick={() => take('')}>Another passage</button>
    </section>
  )
}

// ── Blurt: write all you remember of the last pages, then see which of their key ideas you left out ──
function Blurt({ here, language, onGo }: { here: Place; language: string; onGo(to: Place): void }) {
  const [span, setSpan] = usePref('blurt-pages', 3)
  const [text, setText] = useState('')
  const [started, setStarted] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [recall, setRecall] = useState<Recall | null>(null)
  const [made, setMade] = useState('')
  useEffect(() => { if (!started || recall) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [started, recall])
  const voice = useDictate(language, heard => setText(old => (old ? `${old} ${heard}` : heard)))
  // The pages to recall: the one you are on and the few before it.
  const pages = useMemo(() => {
    const [, kind, number] = here.place.match(/^(page|section|slide)=(\d+)/) ?? []
    if (!kind) return [here.place]
    const from = kind === 'section' ? 0 : 1
    return Array.from({ length: span }, (_, i) => Number(number) - i).filter(n => n >= from).reverse().map(n => `${kind}=${n}`)
  }, [here.place, span])
  const seconds = Math.floor((now - started) / 1000)
  if (!started) return (
    <section>
      <label className="menu-row">What to recall
        <select value={span} onChange={e => setSpan(Number(e.target.value))}>
          {[1, 2, 3, 5, 8, 12].map(n => <option key={n} value={n}>{n === 1 ? 'This page' : `This page and the ${n - 1} before`}</option>)}
        </select>
      </label>
      <p>{`Without looking at the book, write (or say) everything you remember of ${pages.length === 1 ? placeName(pages[0]) : `${placeName(pages[0])} to ${placeName(pages.at(-1)!)}`}: ideas, terms, examples, in any order.`}</p>
      <button className="primary" onClick={() => { setStarted(Date.now()); setNow(Date.now()) }}>Start</button>
    </section>
  )
  return (
    <section className="blurt">
      <div className="study-sheet-row"><span>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span></div>
      <textarea rows={8} value={text} onChange={e => setText(e.target.value)} placeholder="Everything you remember…" disabled={!!recall} />
      {!recall && <div className="teach-buttons">
        <button className="primary" disabled={text.trim().split(/\s+/).length < 5} onClick={async () => setRecall(await checkRecall(here.book, pages, text))}>I have written all I remember</button>
        <button className={voice.recording ? 'soft recording' : 'soft'} onClick={() => void voice.toggle()}>{voice.recording ? <Square size={14} aria-hidden /> : <Mic size={15} aria-hidden />} {voice.recording ? 'Stop' : 'Say it instead'}</button>
        {voice.busy && <span className="menu-note">{voice.busy}</span>}
      </div>}
      {recall && <div className="teach-result">
        <p className="practice-score">{`${Math.round(recall.share * 100)}% of the key ideas of these pages, from memory.`}</p>
        {recall.covered.length > 0 && <p className="teach-row"><span>You brought back</span>{recall.covered.map(word => <i key={word} className="chip right">{word}</i>)}</p>}
        {recall.missed.length > 0 && <>
          <p className="teach-row"><span>You left out</span></p>
          {recall.missed.slice(0, 10).map(miss => (
            <button key={miss.word} className="kin" onClick={() => onGo({ book: here.book, place: miss.place })}>
              <span className="hit-book">{miss.word} · {placeName(miss.place)}</span>{miss.sentence}
            </button>
          ))}
          <button className="soft" onClick={async () => {
            const count = await addStudyCards(here.book, recall.missed.filter(miss => miss.sentence).slice(0, 8).map(miss => ({
              front: miss.sentence.replace(new RegExp(miss.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '［ … ］'), back: miss.word, place: miss.place,
            })))
            setMade(`${count} card${count === 1 ? '' : 's'} made: they come up in Review`)
          }}>Make cards of what I left out</button>
          {made && <p className="menu-note">{made}</p>}
        </>}
        <button className="link-button" onClick={() => { setStarted(0); setText(''); setRecall(null); setMade('') }}>Blurt again</button>
      </div>}
    </section>
  )
}

// ── SQ3R: survey the headings, turn each into a question, read, then recite the answer ──
function Sq3r({ book, onGo }: { book: string; onGo(to: Place): void }) {
  const [items, setItems] = useState<ContentsItem[]>(() => contentsOf(book))
  useEffect(() => { setItems(contentsOf(book)); return onContents(changed => { if (changed === book) setItems(contentsOf(book)) }) }, [book])
  const questions = useMemo(() => items.map(item => ({ ...item, question: questionFor(item.label) })).filter(item => item.question), [items])
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [made, setMade] = useState('')
  if (!questions.length) return <p className="guide-wait">This book has no headings to turn into questions.</p>
  return (
    <section className="sq3r">
      <p>Before reading each section, read its question; after it, answer in your own words, without looking. Answers become flashcards.</p>
      {questions.map((item, i) => (
        <div key={i} className="sq3r-item" style={{ marginLeft: Math.min(item.depth, 3) * 14 }}>
          <button className="kin" onClick={() => item.place && onGo({ book, place: item.place })} disabled={!item.place}>
            <span className="hit-book">{item.label}{item.place ? ` · ${placeName(item.place)}` : ''}</span><b>{item.question}</b>
          </button>
          <textarea rows={2} placeholder="After reading: your answer, without looking" value={answers[i] ?? ''} onChange={e => setAnswers({ ...answers, [i]: e.target.value })} />
        </div>
      ))}
      <button className="primary" disabled={!Object.values(answers).some(answer => answer.trim())} onClick={async () => {
        const count = await addStudyCards(book, questions.flatMap((item, i) => (answers[i]?.trim() ? [{ front: item.question, back: answers[i].trim(), place: item.place }] : [])))
        setMade(`${count} card${count === 1 ? '' : 's'} made: they come up in Review`)
      }}>Keep my answers as flashcards</button>
      {made && <p className="menu-note">{made}</p>}
    </section>
  )
}

// ── Learn in order: the key terms, each after those it builds on, as a list and as a diagram ──
function Order({ book, onGo }: { book: string; onGo(to: Place): void }) {
  const [steps, setSteps] = useState<Step[] | null>(null)
  const [svg, setSvg] = useState('')
  useEffect(() => {
    setSteps(null)
    let cancelled = false
    void learningOrder(book).then(async found => {
      if (cancelled) return
      setSteps(found)
      if (found.length < 2) return
      const { default: mermaid } = await import('mermaid')
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: currentTheme() === 'dark' ? 'dark' : 'neutral', fontFamily: 'inherit' })
      try { const drawn = await mermaid.render(`sidepage-order-${Date.now()}`, orderDiagram(found)); if (!cancelled) setSvg(drawn.svg) } catch { /* the list is enough */ }
    })
    return () => { cancelled = true }
  }, [book])
  if (!steps) return <p className="guide-wait">Working out the order…</p>
  if (!steps.length) return <p className="guide-wait">This book has too few words to find its terms.</p>
  return (
    <section>
      <ol className="order-list">
        {steps.map(step => (
          <li key={step.term.term}>
            <button className="link-button" onClick={() => onGo({ book, place: step.term.everywhere[0] })}>{step.term.term}</button>
            <span className="menu-note"> {placeName(step.term.everywhere[0])}</span>{step.after.length > 0 && <span className="menu-note">{` · builds on ${step.after.join(', ')}`}</span>}
          </li>
        ))}
      </ol>
      {svg && <div className="order-diagram" dangerouslySetInnerHTML={{ __html: svg }} />}
    </section>
  )
}

// ── Mnemonic: the first letters of a list as a word, and a sentence to remember them by ──
function Mnemonic({ book }: { book: string }) {
  const [list, setList] = useState('')
  const [made, setMade] = useState<{ letters: string; sentence: string[] } | null>(null)
  const [kept, setKept] = useState('')
  const items = list.split(/\n|;|,/).map(item => item.trim()).filter(Boolean)
  return (
    <section>
      <p>Write the items to remember, one per line (or select a list on the page and press the button).</p>
      <button className="soft" onClick={() => { const text = window.getSelection()?.toString(); if (text) setList(text.split(/\n|•|;|,|\s\d+[.)]\s/).map(item => item.replace(/^\s*[-•*\d.)]+\s*/, '').trim()).filter(Boolean).join('\n')) }}>Use the selected list</button>
      <textarea rows={6} value={list} onChange={e => { setList(e.target.value); setMade(null) }} placeholder={'Mercury\nVenus\nEarth\nMars'} />
      <div className="teach-buttons">
        <button className="primary" disabled={items.length < 2} onClick={async () => setMade(await mnemonicFor(items))}>Make a mnemonic</button>
        {made && <button className="soft" onClick={async () => { newMnemonicSeed(); setMade(await mnemonicFor(items)) }}>Another sentence</button>}
      </div>
      {made && <div className="teach-result">
        <p className="mnemonic-letters">{made.letters}</p>
        <p className="mnemonic-sentence">{made.sentence.map((word, i) => <span key={i} title={items[i]}><b>{word[0]}</b>{word.slice(1)} </span>)}</p>
        <ul className="mnemonic-key">{items.map((item, i) => <li key={i}><b>{made.letters[i]}</b> {item}</li>)}</ul>
        <button className="soft" onClick={async () => {
          await addStudyCards(book, [{ front: `What does “${made.sentence.join(' ')}” (${made.letters}) stand for?`, back: items.join(', ') }])
          setKept('Kept as a flashcard: it comes up in Review')
        }}>Keep it as a flashcard</button>
        {kept && <p className="menu-note">{kept}</p>}
      </div>}
    </section>
  )
}

// ── A past exam paper: its questions, each with the pages of your books that answer it ──
function PastExam({ onGo }: { onGo(to: Place): void }) {
  const [questions, setQuestions] = useState<{ question: string; answers: Answer[] }[] | null>(null)
  const [busy, setBusy] = useState('')
  const [open, setOpen] = useState(-1)
  const load = async (file: File) => {
    setBusy('Reading the paper…')
    setQuestions(null)
    try {
      const text = file.name.toLowerCase().endsWith('.pdf') ? await textOfPdf(file) : await file.text()
      const found = examQuestions(text)
      if (!found.length) { setBusy('No numbered questions were found in this paper.'); return }
      const out: { question: string; answers: Answer[] }[] = []
      for (const [i, question] of found.entries()) {
        setBusy(`Finding the answers… ${i + 1} / ${found.length}`)
        out.push({ question, answers: await askBooks(question, 3) })
      }
      setQuestions(out)
      setBusy('')
    } catch {
      setBusy('This paper could not be read. A scanned paper needs its text: open it in Sidepage and make it searchable first.')
    }
  }
  return (
    <section>
      <p>Choose an old exam paper (a PDF or a text file). Each question is matched with the pages of your opened books that best answer it.</p>
      <label className="soft file-button">Choose a paper<input type="file" accept=".pdf,.txt,.md" onChange={e => { const file = e.target.files?.[0]; if (file) void load(file) }} /></label>
      {busy && <p className="guide-wait">{busy}</p>}
      {questions && <ol className="exam-list">
        {questions.map((item, i) => (
          <li key={i}>
            <button className="exam-question" onClick={() => setOpen(open === i ? -1 : i)}>{item.question}</button>
            {open === i && (item.answers.length ? item.answers.map((answer, j) => (
              <button key={j} className="kin" onClick={() => onGo({ book: answer.book, place: answer.place })}>
                <span className="hit-book">{baseName(answer.book)} · {placeName(answer.place)}</span>{answer.sentence}
              </button>
            )) : <p className="menu-note">None of your books seems to speak of this.</p>)}
          </li>
        ))}
      </ol>}
    </section>
  )
}
