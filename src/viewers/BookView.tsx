import { useEffect, useRef, useState } from 'react'
import 'foliate-js/view.js'
import { Overlayer } from 'foliate-js/overlayer.js'
import { useTheme, type Theme } from '../lib/theme'
import SearchBox, { type SearchHit } from './SearchBox'
import { BookA, BookOpen, ChevronLeft, ChevronRight, ScrollText, Square, TextQuote, Volume2 } from 'lucide-react'
import { lookUp } from '../Extras'
import { Tool } from '../ui'
import { BookmarksMenu, ContentsMenu, HIGHLIGHT_COLOURS, HighlightsMenu, TextMenu, type Highlight } from './ReaderMenus'
import { canSpeak, useReadAloud } from '../lib/speech'
import { hasWords, keepWords, type Stretch } from '../lib/library'
import { FONTS, loadHighlights, saveCover, saveHighlights, setProgress, useBookmarks, useTextStyle, type TextStyle } from '../lib/reading'
import CurlBook, { type CurlHandle, type CurlPlace } from './CurlBook'
import {
  baseName, extensionOf, findInNotes, onGoToPlace, prefersFlip, rememberFlip, sendQuote, tellPlace,
} from '../lib/platform'

type TocItem = { label: string; href: string; subitems?: TocItem[] }

const bookColours = { light: '#1c1d21', sepia: '#40372b', dark: '#d7dade' } as const

const bookCSS = (theme: Theme, text: TextStyle) => `
  @namespace epub "http://www.idpf.org/2007/ops";
  /* The page itself stays see-through, so the panel's themed background shows behind the text. */
  html { color: ${bookColours[theme]}; }
  a:any-link { color: ${theme === 'dark' ? '#8ab4f8' : '#1a56c4'}; }
  /* The reader's own choice of size, spacing and typeface. */
  html { font-size: ${text.size}% !important; }
  p, li, blockquote, dd { line-height: ${text.spacing} !important; text-align: start; hyphens: auto; }
  ${FONTS[text.font].css ? `body, p, li, blockquote, dd, div, span, td { font-family: ${FONTS[text.font].css} !important; }` : ''}
  pre { white-space: pre-wrap !important; }
`

// CBR, CB7 and CBT comics: libarchive.js unpacks the pages, foliate-js shows them like a CBZ.
async function openComicArchive(file: File) {
  const { Archive } = await import('libarchive.js')
  Archive.init({ workerUrl: new URL('libarchive/worker-bundle.js', document.baseURI).href })
  const archive = await Archive.open(file)
  const pages = new Map<string, { size: number; extract(): Promise<File> }>()
  for (const entry of await archive.getFilesArray()) pages.set(`${entry.path}${entry.file.name}`.toLowerCase(), entry.file)
  const { makeComicBook } = await import('foliate-js/comic-book.js')
  return makeComicBook({
    entries: [...pages.keys()].map(filename => ({ filename })),
    loadBlob: (name: string) => pages.get(name)!.extract(),
    getSize: (name: string) => pages.get(name)!.size,
  }, file)
}

const flatten =(items: TocItem[], depth = 0): (TocItem & { depth: number })[] =>
  items.flatMap(item => [{ ...item, depth }, ...flatten(item.subitems ?? [], depth + 1)])

// EPUB, MOBI, AZW3, FB2 and CBZ, rendered by foliate-js.
export default function BookView({ file }: { file: File }) {
  const host = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const viewRef = useRef<any>(null)
  const [toc, setToc] = useState<(TocItem & { depth: number })[]>([])
  const [where, setWhere] = useState({ fraction: 0, label: '', cfi: '' })
  const text = useTextStyle()
  const textAtStart = useRef(text)
  textAtStart.current = text
  const bookmarks = useBookmarks(file.name)
  const [scrolled, setScrolled] = useState(false)
  const [error, setError] = useState('')
  // The reader's highlights. The list is kept twice: here for the book's own event handlers, which outlive a
  // render, and in `highlights` for showing.
  const marks = useRef<Highlight[]>([])
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const shownRange = useRef<Range | null>(null)
  const placeNow = useRef('')
  const voice = useReadAloud()
  const theme = useTheme()
  const themeAtStart = useRef(theme)
  themeAtStart.current = theme
  // Page-turn mode: the same book shown as paper pages that curl (see CurlBook). Not for comics, which are pictures.
  const canCurl = !['cbz', 'cbr', 'cb7', 'cbt'].includes(extensionOf(file.name))
  const [curl, setCurl] = useState(() => canCurl && prefersFlip())
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sections, setSections] = useState<any[] | null>(null)
  const [curlStart, setCurlStart] = useState<{ place: CurlPlace; key: number }>({ place: { index: 0, fraction: 0 }, key: 0 })
  const curlRef = useRef<CurlHandle>(null)
  const here = useRef<CurlPlace>({ index: 0, fraction: 0 })
  const turnedAt = useRef(0)

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const view = document.createElement('foliate-view') as any
    viewRef.current = view
    host.current!.append(view)
    let closed = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    view.addEventListener('relocate', (e: any) => {
      setWhere({ fraction: e.detail.fraction ?? 0, label: e.detail.tocItem?.label ?? '', cfi: e.detail.cfi ?? '' })
      setProgress(file.name, e.detail.fraction ?? 0)
      placeNow.current = e.detail.cfi ?? ''
      tellPlace({ book: file.name, place: `section=${e.detail.section?.current ?? here.current.index}`, cfi: e.detail.cfi ?? '' })
      if (e.detail.cfi) localStorage.setItem(`sidepage:place:${file.name}`, e.detail.cfi)
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    view.addEventListener('load', (e: any) => {
      e.detail.doc.addEventListener('keydown', onKey)
    })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') view.goLeft()
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') view.goRight()
    }
    // Quoted passages stay highlighted in the book; clicking one shows the note that quotes it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    view.addEventListener('create-overlay', (e: any) => {
      for (const mark of marks.current) if (mark.index === e.detail.index) view.addAnnotation({ value: mark.cfi, color: mark.color })
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    view.addEventListener('draw-annotation', (e: any) => e.detail.draw(Overlayer.highlight, { color: e.detail.annotation.color ?? HIGHLIGHT_COLOURS.Yellow }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    view.addEventListener('show-annotation', (e: any) => {
      const mark = marks.current.find(m => m.cfi === e.detail.value)
      if (mark) findInNotes({ text: mark.text })
    })
    // A place is a CFI, or "section=3" for the start of a part (what a search across books gives).
    const target = (place: string | null) => { const part = place?.match(/^section=(\d+)/)?.[1]; return part ? Number(part) : place }
    const stopGoTo = onGoToPlace(({ book, place }) => { if (book === file.name) void view.goTo(target(place)) })
    const isArchive = ['cbr', 'cb7', 'cbt'].includes(extensionOf(file.name))
    Promise.resolve(isArchive ? openComicArchive(file) : file).then(book => view.open(book)).then(async () => {
      if (closed) return
      marks.current = await loadHighlights(baseName(file.name), 'book')
      setHighlights(marks.current)
      setToc(flatten(view.book.toc ?? []))
      view.renderer.setStyles?.(bookCSS(themeAtStart.current, textAtStart.current))
      void Promise.resolve(view.book.getCover?.()).then(cover => saveCover(file.name, cover)).catch(() => {})
      view.renderer.setAttribute('animated', '')
      // Where the reader is, chapter by chapter. A jump made elsewhere (contents, a link in a note) moves the
      // paper pages too; a page turned by hand is already there, so its echo is ignored.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      view.renderer.addEventListener('relocate', (e: any) => {
        here.current = { index: e.detail.index ?? 0, fraction: e.detail.fraction ?? 0 }
        tellPlace({ book: file.name, place: `section=${e.detail.index ?? 0}`, cfi: placeNow.current })
        shownRange.current = e.detail.range ?? null
        if (Date.now() - turnedAt.current > 1500) setCurlStart(s => ({ place: here.current, key: s.key + 1 }))
      })
      // Reopen where the reader left off.
      await view.init({ lastLocation: target(localStorage.getItem(`sidepage:place:${file.name}`)) })
      // The book's words, part by part, so it can be found by them later. Done once.
      if (canCurl) void hasWords(file.name).then(async known => {
        if (known) return
        const parts: Stretch[] = []
        for (const [index, section] of (view.book.sections as { createDocument?(): Promise<Document> }[]).entries()) {
          if (closed) return
          const doc = await section.createDocument?.().catch(() => null)
          if (doc?.body) parts.push({ place: `section=${index}`, text: doc.body.textContent ?? '' })
        }
        await keepWords(file.name, parts)
      }).catch(() => {})
      if (closed) return
      // Only now is the reader's place known, so only now may the paper pages be built from it.
      setCurlStart(s => ({ place: here.current, key: s.key + 1 }))
      setSections(view.book.sections)
    }).catch((e: Error) => setError(String(e?.message ?? e)))
    return () => {
      closed = true
      stopGoTo()
      view.close?.()
      view.remove()
    }
  }, [file])

  useEffect(() => {
    viewRef.current?.renderer?.setStyles?.(bookCSS(theme, text))
  }, [theme, text])

  useEffect(() => {
    viewRef.current?.renderer?.setAttribute('flow', scrolled ? 'scrolled' : 'paginated')
  }, [scrolled, toc])

  // A page turned in page-turn mode moves the underlying reader too, which keeps progress, contents and the
  // saved place right.
  const onCurlPlace = (place: CurlPlace) => {
    here.current = place
    turnedAt.current = Date.now()
    void viewRef.current?.renderer.goTo({ index: place.index, anchor: place.fraction })
  }

  const toggleCurl = () => {
    rememberFlip(!curl)
    if (!curl) setCurlStart(s => ({ place: here.current, key: s.key + 1 }))
    setCurl(!curl)
  }

  const turning = curl && !!sections

  // Search the whole book (foliate-js); each match leads to its place.
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState('')
  const searchRun = useRef(0)
  const search = async (query: string) => {
    const view = viewRef.current
    const run = ++searchRun.current
    const found: SearchHit[] = []
    setHits([])
    setSearching('Searching…')
    type Match = { cfi: string; excerpt: { pre: string; match: string; post: string } }
    const add = ({ cfi, excerpt }: Match) => found.length < 200 && found.push({
      key: cfi,
      label: <>{excerpt.pre}<mark>{excerpt.match}</mark>{excerpt.post}</>,
      pick: () => void view.goTo(cfi),
    })
    for await (const result of view.search({ query })) {
      if (run !== searchRun.current) return
      if (result === 'done') break
      if (result.cfi) add(result)
      for (const item of result.subitems ?? []) add(item)
      setHits([...found])
    }
    setSearching(found.length ? `${found.length}${found.length === 200 ? '+' : ''} found` : 'No matches')
  }
  const clearSearch = () => {
    searchRun.current++
    setHits([])
    setSearching('')
    viewRef.current?.clearSearch()
  }

  const saveMarks = (next: Highlight[]) => {
    marks.current = next
    setHighlights(next)
    void saveHighlights(baseName(file.name), 'book', next)
  }

  // The selected passage and its address in the book, whichever way the book is being shown. `cfi` is empty
  // when the address cannot be worked out; the words are still returned.
  const selectedPassage = async (): Promise<{ text: string; index: number; cfi: string } | null> => {
    const view = viewRef.current
    if (turning) {
      // The paper pages are a copy of the chapter, so the selection is found again in the chapter itself.
      const picked = curlRef.current?.selection()
      if (!picked) return null
      document.getSelection()?.removeAllRanges()
      try {
        const doc: Document = await sections[picked.index].createDocument()
        const find = (path: number[]) => path.reduce<Node>((node, i) => node.childNodes[i], doc.body)
        const range = doc.createRange()
        range.setStart(find(picked.start.path), picked.start.offset)
        range.setEnd(find(picked.end.path), picked.end.offset)
        if (range.toString().trim() !== picked.text) throw new Error('selection not found in chapter')
        return { text: picked.text, index: picked.index, cfi: view.getCFI(picked.index, range) }
      } catch {
        return { text: picked.text, index: picked.index, cfi: '' }
      }
    }
    const contents: { doc: Document; index: number }[] = view?.renderer?.getContents?.() ?? []
    for (const { doc, index } of contents) {
      const selection = doc.getSelection()
      const text = selection?.toString().trim()
      if (!selection || !text) continue
      const cfi: string = view.getCFI(index, selection.getRangeAt(0))
      selection.removeAllRanges()
      return { text, index, cfi }
    }
    return null
  }

  // Highlight the selected passage. A passage already highlighted takes the new colour.
  const highlight = async (color: string) => {
    const passage = await selectedPassage()
    if (!passage?.cfi) return null
    const known = marks.current.find(mark => mark.cfi === passage.cfi)
    saveMarks(known
      ? marks.current.map(mark => (mark === known ? { ...mark, color } : mark))
      : [...marks.current, { cfi: passage.cfi, index: passage.index, text: passage.text, color }])
    void viewRef.current.addAnnotation({ value: passage.cfi, color })
    return passage
  }

  const changeHighlight = (cfi: string, change: Partial<Highlight>) => {
    saveMarks(marks.current.map(mark => (mark.cfi === cfi ? { ...mark, ...change } : mark)))
    if (change.color) void viewRef.current.addAnnotation({ value: cfi, color: change.color })
  }

  const removeHighlight = (cfi: string) => {
    saveMarks(marks.current.filter(mark => mark.cfi !== cfi))
    void viewRef.current.deleteAnnotation({ value: cfi })
  }

  // Quote: highlight the passage and send it to the notes with a link back to its place.
  const quote = async () => {
    const source = [baseName(file.name), where.label].filter(Boolean).join(', ')
    const passage = await selectedPassage()
    if (!passage) return
    if (!passage.cfi) return sendQuote({ text: passage.text, source, book: file.name })
    if (!marks.current.some(mark => mark.cfi === passage.cfi)) {
      saveMarks([...marks.current, { cfi: passage.cfi, index: passage.index, text: passage.text }])
      void viewRef.current.addAnnotation({ value: passage.cfi })
    }
    sendQuote({ text: passage.text, source, book: file.name, place: passage.cfi })
  }

  // Read aloud: the page that is open, then the next, and so on to the end of the book.
  const readAloud = () => {
    const renderer = viewRef.current?.renderer
    // While reading, pages change at once: the sliding turn waits for the screen to draw, and the screen may be
    // off or the app in the background while the voice carries on.
    if (voice.speaking) {
      renderer?.setAttribute('animated', '')
      return voice.stop()
    }
    renderer?.removeAttribute('animated')
    let first = true
    void voice.start(async () => {
      const view = viewRef.current
      if (!first) {
        const before = placeNow.current
        await Promise.race([view.next(), new Promise(resolve => setTimeout(resolve, 3000))])
        await new Promise(resolve => setTimeout(resolve, 450))
        if (placeNow.current === before) {
          renderer?.setAttribute('animated', '')
          return null
        }
      }
      first = false
      // The page's words, with each heading and paragraph on its own line.
      const shown = document.createElement('div')
      if (shownRange.current) shown.append(shownRange.current.cloneContents())
      shown.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, div, br').forEach(block => block.append('\n'))
      return shown.textContent ?? ''
    })
  }

  if (error) return <div className="viewer-message">Could not open this book: {error}</div>

  return (
    <div className="viewer" onPointerDownCapture={() => tellPlace({ book: file.name, place: `section=${here.current.index}`, cfi: placeNow.current })}>
      <div className="viewer-bar">
        <Tool quiet icon={ChevronLeft} label="Previous page" onClick={() => (turning ? curlRef.current?.previous() : viewRef.current?.goLeft())} />
        <Tool quiet icon={ChevronRight} label="Next page" onClick={() => (turning ? curlRef.current?.next() : viewRef.current?.goRight())} />
        <ContentsMenu items={toc.map(item => ({ label: item.label, depth: item.depth, go: item.href }))} onGo={href => void viewRef.current?.goTo(href)} />
        <span className="viewer-pos" title={where.label}>{where.label ? `${where.label} · ` : ''}{Math.round(where.fraction * 100)}%</span>
        <span className="spacer" />
        <SearchBox onSearch={query => void search(query)} onClear={clearSearch} status={searching} hits={hits} />
        <BookmarksMenu
          marks={bookmarks}
          here={where.cfi ? { place: where.cfi, label: `${where.label || 'Page'} · ${Math.round(where.fraction * 100)}%` } : null}
          onGo={place => void viewRef.current?.goTo(place)}
        />
        {canCurl && <HighlightsMenu marks={highlights} onHighlight={color => void highlight(color)} onGo={cfi => void viewRef.current?.goTo(cfi)} onChange={changeHighlight} onRemove={removeHighlight} />}
        {canCurl && <TextMenu />}
        {canCurl && canSpeak && !turning && <Tool icon={voice.speaking ? Square : Volume2} label={voice.speaking ? 'Stop reading' : 'Read aloud'} on={voice.speaking} onClick={readAloud} />}
        <Tool icon={TextQuote} label="Quote" hint="Copy the selected text into your notes" onClick={() => void quote()} />
        <Tool icon={BookA} label="Look up" hint="What the selected word means" onClick={() => void selectedPassage().then(passage => lookUp(passage?.text))} />
        {!turning && <Tool icon={ScrollText} label="Scroll" hint="Read as one long scroll" on={scrolled} onClick={() => setScrolled(s => !s)} />}
        {canCurl && <Tool icon={BookOpen} label="Flip" hint="Turn pages like paper" on={curl} onClick={toggleCurl} />}
      </div>
      <div
        className="viewer-body"
        // The paper pages take their text size, spacing and typeface from here (see index.css).
        style={{ '--book-scale': text.size / 100, '--book-spacing': text.spacing, ...(FONTS[text.font].css ? { '--book-font': FONTS[text.font].css } : {}) } as React.CSSProperties}
      >
        <div ref={host} className="book-host" style={{ visibility: turning ? 'hidden' : undefined }} />
        {turning && <CurlBook key={`${curlStart.key}/${text.size}/${text.spacing}/${text.font}`} ref={curlRef} sections={sections} start={curlStart.place} onPlace={onCurlPlace} />}
      </div>
    </div>
  )
}
