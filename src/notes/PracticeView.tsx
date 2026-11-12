import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Mic, Pause, Play, Square, Volume2 } from 'lucide-react'
import { onPlace, placeNow, type Place } from '../lib/platform'
import { placeName } from '../lib/library'
import { getPref, setPref, usePref } from '../lib/prefs'
import { useReadAloud, canSpeak } from '../lib/speech'
import {
  compareWords, forgetWord, knownWords, languageOfText, meaningOf, onKnownWords, pageText, piecesOf, saveWord, savedWords, sentencesIn, setStatus,
  statusOf, translateSentence, wordsToLearn, type Candidate, type Marked, type Saved, type Status,
} from '../lib/practice'

// Practice a language on the page you are reading: see the words you do not know yet, gather the ones worth
// learning, read the page with its translation, write it from dictation, and say it back after the voice.
const TABS = { read: 'Read', words: 'Words', both: 'Both languages', dictation: 'Dictation', shadow: 'Say it back' } as const
type Tab = keyof typeof TABS
const LANGUAGES = { en: 'English', fr: 'French', es: 'Spanish', de: 'German', pt: 'Portuguese', it: 'Italian' } as const
const CHUNK = 14

export default function PracticeView() {
  const [here, setHere] = useState<Place | null>(placeNow)
  useEffect(() => onPlace(setHere), [])
  const [tab, setTab] = usePref<Tab>('practice-tab', 'read')
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    setText(null)
    if (!here) return
    let cancelled = false
    void pageText(here.book, here.place).then(found => { if (!cancelled) setText(found) })
    return () => { cancelled = true }
  }, [here?.book, here?.place]) // eslint-disable-line react-hooks/exhaustive-deps
  const language = useMemo(() => (text ? languageOfText(text) : 'en'), [text])
  // The language you know: answers come in it. French readers get French, others English, unless chosen.
  const [into, setInto] = usePref<keyof typeof LANGUAGES>('practice-into', document.documentElement.lang === 'fr' ? 'fr' : 'en')
  const mine = into === language ? (language === 'en' ? 'fr' : 'en') : into
  const sentences = useMemo(() => (text ? sentencesIn(text, language) : []), [text, language])
  const [part, setPart] = useState(0)
  useEffect(() => setPart(0), [here?.place])
  const shown = sentences.slice(part * CHUNK, part * CHUNK + CHUNK)
  const parts = Math.ceil(sentences.length / CHUNK)

  const [known, setKnown] = useState<Record<string, Status>>({})
  useEffect(() => {
    const read = () => void knownWords().then(all => setKnown({ ...all }))
    read()
    return onKnownWords(read)
  }, [])

  if (!here) return <div className="guide practice"><p className="guide-wait">Open a book and go to the page you want to practise on.</p></div>
  return (
    <div className="guide practice">
      <div className="practice-head">
        <p className="eyebrow">{placeName(here.place) || 'This part'} · {LANGUAGES[language as keyof typeof LANGUAGES] ?? language}</p>
        <label className="practice-into">Meanings in
          <select value={mine} onChange={e => setInto(e.target.value as keyof typeof LANGUAGES)}>
            {Object.entries(LANGUAGES).filter(([code]) => code !== language).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </label>
      </div>
      <div className="practice-tabs" role="tablist">
        {(Object.keys(TABS) as Tab[]).map(key => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'chip on' : 'chip'} onClick={() => setTab(key)}>{TABS[key]}</button>)}
      </div>
      {text === null ? <p className="guide-wait">Reading the page…</p> : !sentences.length ? <p className="guide-wait">This page has no text to practise on. For a scanned page, make the book searchable first.</p> : <>
        {tab === 'read' && <ReadTab book={here.book} place={here.place} sentences={shown} language={language} mine={mine} known={known} />}
        {tab === 'words' && <WordsTab book={here.book} place={here.place} text={shown.join(' ')} language={language} mine={mine} known={known} />}
        {tab === 'both' && <BothTab sentences={shown} language={language} mine={mine} />}
        {tab === 'dictation' && <SentenceDrill key={`d${here.place}${part}`} kind="dictation" sentences={shown} language={language} />}
        {tab === 'shadow' && <SentenceDrill key={`s${here.place}${part}`} kind="shadow" sentences={shown} language={language} />}
        {parts > 1 && <div className="practice-parts">
          <button className="soft" disabled={part === 0} onClick={() => setPart(part - 1)}>Earlier sentences</button>
          <span>{part + 1} / {parts}</span>
          <button className="soft" disabled={part >= parts - 1} onClick={() => setPart(part + 1)}>Later sentences</button>
        </div>}
      </>}
    </div>
  )
}

// ── Read: every word you do not know yet stands out; tap one for its meaning ──
function ReadTab({ book, place, sentences, language, mine, known }: { book: string; place: string; sentences: string[]; language: string; mine: string; known: Record<string, Status> }) {
  const [picked, setPicked] = useState<{ word: string; sentence: string } | null>(null)
  const [meaning, setMeaning] = useState('')
  useEffect(() => {
    setMeaning('')
    if (!picked) return
    let cancelled = false
    void meaningOf(picked.word, language, mine).then(found => { if (!cancelled) setMeaning(found) }).catch(() => { if (!cancelled) setMeaning('…') })
    return () => { cancelled = true }
  }, [picked, language, mine])
  const words = sentences.flatMap(sentence => piecesOf(sentence, language).filter(piece => piece.word).map(piece => piece.text))
  const fresh = [...new Set(words.filter(word => !statusOf(known, language, word)).map(word => word.toLocaleLowerCase()))]
  const share = words.length ? words.filter(word => statusOf(known, language, word) === 'known').length / words.length : 0
  return (
    <section>
      <p className="practice-score">{`You know ${Math.round(share * 100)}% of the words here.`} <span className="word-new">New</span> <span className="word-learning">Learning</span></p>
      <div className="practice-text">
        {sentences.map((sentence, i) => (
          <p key={i}>{piecesOf(sentence, language).map((piece, j) => {
            if (!piece.word) return piece.text
            const status = statusOf(known, language, piece.text)
            return <button key={j} className={`practice-word ${status === 'known' ? '' : status === 'learning' ? 'word-learning' : 'word-new'}`} onClick={() => setPicked({ word: piece.text, sentence })}>{piece.text}</button>
          })} </p>
        ))}
      </div>
      {picked && <div className="practice-card">
        <b>{picked.word}</b> <span>{meaning || 'Looking it up…'}</span>
        <div className="study-sheet-row">
          <button className="primary" onClick={() => { void saveWord(book, { word: picked.word, sentence: picked.sentence, meaning, place, language }); setPicked(null) }} disabled={!meaning}>Learn it</button>
          <button className="soft" onClick={() => { void setStatus(language, [picked.word], 'known'); setPicked(null) }}>I know it</button>
          <button className="soft" onClick={() => setPicked(null)}>Close</button>
        </div>
      </div>}
      {fresh.length > 0 && <button className="soft" onClick={() => void setStatus(language, fresh, 'known')} title="Every word still marked new here is one you know">{`I know the rest (${fresh.length})`}</button>}
    </section>
  )
}

// ── Words: the words of the page worth learning, the most used in the book first ──
function WordsTab({ book, place, text, language, mine, known }: { book: string; place: string; text: string; language: string; mine: string; known: Record<string, Status> }) {
  const [list, setList] = useState<Candidate[] | null>(null)
  const [saved, setSaved] = useState<Saved[]>([])
  const [meanings, setMeanings] = useState<Record<string, string>>({})
  useEffect(() => {
    let cancelled = false
    void wordsToLearn(book, text, language, known).then(found => { if (!cancelled) setList(found) })
    void savedWords(book).then(found => { if (!cancelled) setSaved(found) })
    return () => { cancelled = true }
  }, [book, text, language, known])
  const look = (word: string) => void meaningOf(word, language, mine).then(found => setMeanings(now => ({ ...now, [word]: found }))).catch(() => {})
  const learning = list?.filter(entry => statusOf(known, language, entry.word) !== 'learning') ?? []
  return (
    <section>
      <p className="menu-note">The words here you have not marked as known, those the book uses most first. Learn them, and they come up in Review as flashcards.</p>
      {!list ? <p className="guide-wait">Gathering words…</p> : !learning.length ? <p className="guide-wait">You know every word here.</p> : (
        <div className="word-list">
          {learning.map(entry => (
            <div key={entry.word} className="word-row">
              <div>
                <b>{entry.word}</b> <span className="word-count">×{entry.count}</span>
                {meanings[entry.word] ? <span className="word-meaning">{meanings[entry.word]}</span> : <button className="link-button" onClick={() => look(entry.word)}>Meaning</button>}
                <p>{entry.sentence}</p>
              </div>
              <span className="question-tools">
                <button title="Learn it: a flashcard with its sentence" aria-label="Learn it" onClick={async () => {
                  const meaning = meanings[entry.word] ?? await meaningOf(entry.word, language, mine).catch(() => '')
                  await saveWord(book, { word: entry.word, sentence: entry.sentence, meaning, place, language })
                  setSaved(await savedWords(book))
                }}>+</button>
                <button title="I know it" aria-label="I know it" onClick={() => void setStatus(language, [entry.word], 'known')}><Check size={14} aria-hidden /></button>
              </span>
            </div>
          ))}
        </div>
      )}
      {saved.length > 0 && <>
        <h3>{`Words you are learning from this book (${saved.length})`}</h3>
        <div className="word-list">
          {saved.slice().reverse().map(entry => (
            <div key={entry.word} className="word-row">
              <div><b>{entry.word}</b> <span className="word-meaning">{entry.meaning}</span><p>{entry.sentence}</p></div>
              <span className="question-tools">
                <button title="I know it now" aria-label="I know it now" onClick={async () => { await setStatus(entry.language, [entry.word], 'known'); await forgetWord(book, entry.word); setSaved(await savedWords(book)) }}><Check size={14} aria-hidden /></button>
              </span>
            </div>
          ))}
        </div>
      </>}
    </section>
  )
}

// ── Both languages: each sentence with its translation under it ──
function BothTab({ sentences, language, mine }: { sentences: string[]; language: string; mine: string }) {
  const [done, setDone] = useState<string[]>([])
  const [trouble, setTrouble] = useState('')
  useEffect(() => {
    setDone([])
    setTrouble('')
    let cancelled = false
    void (async () => {
      const out: string[] = []
      for (const sentence of sentences) {
        try { out.push(await translateSentence(sentence, language, mine)) } catch (error) {
          if (!cancelled) setTrouble(/LIMIT|WARNING/i.test(String(error)) ? 'The free translation service has reached its limit for today.' : 'The translation service could not be reached. It needs the internet.')
          return
        }
        if (cancelled) return
        setDone([...out])
      }
    })()
    return () => { cancelled = true }
  }, [sentences, language, mine])
  return (
    <section className="both">
      {sentences.map((sentence, i) => (
        <div key={i} className="both-pair">
          <p>{sentence}</p>
          <p className="both-under">{done[i] ?? (trouble && i >= done.length ? '' : '…')}</p>
        </div>
      ))}
      {trouble && <p className="menu-note">{trouble}</p>}
      <p className="menu-note small">Sent a sentence at a time to MyMemory, a free translation service.</p>
    </section>
  )
}

// ── Dictation and saying it back: a sentence is read out; write it, or say it, and see what was missed ──
function SentenceDrill({ kind, sentences, language }: { kind: 'dictation' | 'shadow'; sentences: string[]; language: string }) {
  const [at, setAt] = useState(0)
  const [given, setGiven] = useState('')
  const [result, setResult] = useState<{ marked: Marked[]; score: number; heard?: string } | null>(null)
  const [slow, setSlow] = usePref('practice-slow', false)
  const voice = useReadAloud()
  const sentence = sentences[at] ?? ''
  const speak = () => {
    if (voice.speaking) return voice.stop()
    let once = true
    // Slower: the chosen pace, less a third, for this sentence only.
    const before = getPref('voice-rate', 1)
    if (slow) setPref('voice-rate', before * 0.7)
    void voice.start(async () => (once ? ((once = false), sentence) : null)).finally(() => { if (slow) setPref('voice-rate', before) })
  }
  const next = (step: number) => { setAt(Math.max(0, Math.min(sentences.length - 1, at + step))); setGiven(''); setResult(null) }

  // Saying it back: recorded on the device, written out by the speech recogniser, compared with the sentence.
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState('')
  const recorder = useRef<MediaRecorder | null>(null)
  const [mineSound, setMineSound] = useState<string | null>(null)
  const record = async () => {
    if (recording) return recorder.current?.stop()
    setResult(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const pieces: Blob[] = []
      const take = new MediaRecorder(stream)
      take.ondataavailable = e => pieces.push(e.data)
      take.onstop = async () => {
        stream.getTracks().forEach(track => track.stop())
        setRecording(false)
        const sound = new Blob(pieces, { type: take.mimeType })
        setMineSound(URL.createObjectURL(sound))
        try {
          const { writeOut } = await import('../lib/transcribe')
          const heard = (await writeOut(sound, language, setBusy)).map(part => part.text).join(' ')
          setBusy('')
          setResult({ ...(await compareWords(sentence, heard)), heard })
        } catch {
          setBusy('The speech recogniser could not be fetched. It needs the internet the first time.')
        }
      }
      recorder.current = take
      take.start()
      setRecording(true)
    } catch {
      setBusy('Sidepage could not use the microphone.')
    }
  }

  if (!canSpeak) return <p className="guide-wait">This device has no voice to read the sentences.</p>
  return (
    <section className="drill">
      <p className="menu-note">{kind === 'dictation'
        ? 'Listen, then write the sentence. Play it as often as you like.'
        : 'Listen, then say the sentence the same way. Sidepage writes out what you said, on this device, and shows what it missed.'}</p>
      <div className="study-sheet-row">
        <button className="primary" onClick={speak}>{voice.speaking ? <Pause size={15} aria-hidden /> : <Volume2 size={15} aria-hidden />} {voice.speaking ? 'Stop' : 'Listen'}</button>
        <label className="practice-slow"><input type="checkbox" checked={slow} onChange={e => setSlow(e.target.checked)} /> Slower</label>
        <span className="spacer" />
        <span>{`Sentence ${at + 1} / ${sentences.length}`}</span>
      </div>
      {kind === 'dictation' && <form onSubmit={async e => { e.preventDefault(); if (given.trim()) setResult(await compareWords(sentence, given)) }}>
        <textarea rows={3} value={given} onChange={e => setGiven(e.target.value)} placeholder="Write what you hear" lang={language} spellCheck={false}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }} />
        <button className="soft" type="submit">Check</button>
      </form>}
      {kind === 'shadow' && <div className="study-sheet-row">
        <button className={recording ? 'primary recording' : 'soft'} onClick={() => void record()}>{recording ? <Square size={14} aria-hidden /> : <Mic size={15} aria-hidden />} {recording ? 'Stop' : 'Say it'}</button>
        {mineSound && !recording && <button className="soft" onClick={() => void new Audio(mineSound).play()}><Play size={14} aria-hidden /> Hear yourself</button>}
        {busy && <span>{busy}</span>}
      </div>}
      {result && <div className="drill-result">
        <p className="practice-score">{`${Math.round(result.score * 100)}% right${result.score === 1 ? '. Perfect.' : ''}`}</p>
        {result.heard !== undefined && <p className="menu-note">{`Heard: “${result.heard}”`}</p>}
        <p className="drill-marked">{result.marked.map((part, i) => <span key={i} className={`drill-${part.kind}`}>{part.text} </span>)}</p>
        <p className="drill-answer">{sentence}</p>
      </div>}
      <div className="study-sheet-row">
        <button className="soft" disabled={at === 0} onClick={() => next(-1)}>Previous sentence</button>
        <button className="soft" disabled={at >= sentences.length - 1} onClick={() => next(1)}>Next sentence</button>
      </div>
    </section>
  )
}
