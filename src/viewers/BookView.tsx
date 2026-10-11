import { useEffect, useRef, useState } from 'react'
import 'foliate-js/view.js'
import { Overlayer } from 'foliate-js/overlayer.js'
import { useTheme, type Theme } from '../lib/theme'
import SearchBox, { type SearchHit } from './SearchBox'
import { BookOpen, ChevronLeft, ChevronRight, ScrollText, TextQuote } from 'lucide-react'
import { Tool } from '../ui'
import CurlBook, { type CurlHandle, type CurlPlace } from './CurlBook'
import {
  baseName, extensionOf, findInNotes, loadNote, onGoToPlace, prefersFlip, rememberFlip, saveNote, sendQuote,
} from '../lib/platform'

type TocItem = { label: string; href: string; subitems?: TocItem[] }

const bookColours = { light: '#1c1d21', sepia: '#40372b', dark: '#d7dade' } as const

const bookCSS = (theme: Theme) => `
  @namespace epub "http://www.idpf.org/2007/ops";
  /* The page itself stays see-through, so the panel's themed background shows behind the text. */
  html { color: ${bookColours[theme]}; }
  a:any-link { color: ${theme === 'dark' ? '#8ab4f8' : '#1a56c4'}; }
  p, li, blockquote, dd { line-height: 1.6; text-align: start; hyphens: auto; }
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
  const [where, setWhere] = useState({ fraction: 0, label: '' })
  const [scrolled, setScrolled] = useState(false)
  const [error, setError] = useState('')
  const marks = useRef<{ cfi: string; index: number; text: string }[]>([])
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
      setWhere({ fraction: e.detail.fraction ?? 0, label: e.detail.tocItem?.label ?? '' })
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
      for (const mark of marks.current) if (mark.index === e.detail.index) view.addAnnotation({ value: mark.cfi })
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    view.addEventListener('draw-annotation', (e: any) => e.detail.draw(Overlayer.highlight, { color: '#ffd84d' }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    view.addEventListener('show-annotation', (e: any) => {
      const mark = marks.current.find(m => m.cfi === e.detail.value)
      if (mark) findInNotes({ text: mark.text })
    })
    const stopGoTo = onGoToPlace(({ book, place }) => { if (book === file.name) void view.goTo(place) })
    const isArchive = ['cbr', 'cb7', 'cbt'].includes(extensionOf(file.name))
    Promise.resolve(isArchive ? openComicArchive(file) : file).then(book => view.open(book)).then(async () => {
      if (closed) return
      marks.current = JSON.parse((await loadNote(baseName(file.name), 'highlights.json')) ?? '[]')
      setToc(flatten(view.book.toc ?? []))
      view.renderer.setStyles?.(bookCSS(themeAtStart.current))
      view.renderer.setAttribute('animated', '')
      // Where the reader is, chapter by chapter. A jump made elsewhere (contents, a link in a note) moves the
      // paper pages too; a page turned by hand is already there, so its echo is ignored.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      view.renderer.addEventListener('relocate', (e: any) => {
        here.current = { index: e.detail.index ?? 0, fraction: e.detail.fraction ?? 0 }
        if (Date.now() - turnedAt.current > 1500) setCurlStart(s => ({ place: here.current, key: s.key + 1 }))
      })
      // Reopen where the reader left off.
      await view.init({ lastLocation: localStorage.getItem(`sidepage:place:${file.name}`) })
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
    viewRef.current?.renderer?.setStyles?.(bookCSS(theme))
  }, [theme])

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

  // Keep a quoted passage: highlight it in the book and send it to the notes with a link back to its place.
  const keep = (text: string, index: number, cfi: string) => {
    marks.current.push({ cfi, index, text })
    void saveNote(baseName(file.name), 'highlights.json', JSON.stringify(marks.current))
    void viewRef.current.addAnnotation({ value: cfi })
    sendQuote({ text, source: [baseName(file.name), where.label].filter(Boolean).join(', '), book: file.name, place: cfi })
  }

  const quote = async () => {
    const view = viewRef.current
    if (turning) {
      // The paper pages are a copy of the chapter, so the selection is found again in the chapter itself
      // to get its true address in the book.
      const picked = curlRef.current?.selection()
      if (!picked) return
      const source = [baseName(file.name), where.label].filter(Boolean).join(', ')
      try {
        const doc: Document = await sections[picked.index].createDocument()
        const find = (path: number[]) => path.reduce<Node>((node, i) => node.childNodes[i], doc.body)
        const range = doc.createRange()
        range.setStart(find(picked.start.path), picked.start.offset)
        range.setEnd(find(picked.end.path), picked.end.offset)
        if (range.toString().trim() !== picked.text) throw new Error('selection not found in chapter')
        keep(picked.text, picked.index, view.getCFI(picked.index, range))
      } catch {
        sendQuote({ text: picked.text, source, book: file.name })
      }
      document.getSelection()?.removeAllRanges()
      return
    }
    const contents: { doc: Document; index: number }[] = view?.renderer?.getContents?.() ?? []
    for (const { doc, index } of contents) {
      const selection = doc.getSelection()
      const text = selection?.toString().trim()
      if (!selection || !text) continue
      keep(text, index, view.getCFI(index, selection.getRangeAt(0)))
      return selection.removeAllRanges()
    }
  }

  if (error) return <div className="viewer-message">Could not open this book: {error}</div>

  return (
    <div className="viewer">
      <div className="viewer-bar">
        <Tool quiet icon={ChevronLeft} label="Previous page" onClick={() => (turning ? curlRef.current?.previous() : viewRef.current?.goLeft())} />
        <Tool quiet icon={ChevronRight} label="Next page" onClick={() => (turning ? curlRef.current?.next() : viewRef.current?.goRight())} />
        {toc.length > 0 && (
          <select value="" onChange={e => viewRef.current?.goTo(e.target.value)} title="Contents">
            <option value="" disabled>{where.label || 'Contents'}</option>
            {toc.map((item, i) => (
              <option key={i} value={item.href}>{'  '.repeat(item.depth) + item.label}</option>
            ))}
          </select>
        )}
        <span className="viewer-pos">{Math.round(where.fraction * 100)}%</span>
        <span className="spacer" />
        <SearchBox onSearch={query => void search(query)} onClear={clearSearch} status={searching} hits={hits} />
        <Tool icon={TextQuote} label="Quote" hint="Copy the selected text into your notes" onClick={() => void quote()} />
        {!turning && <Tool icon={ScrollText} label="Scroll" hint="Read as one long scroll" on={scrolled} onClick={() => setScrolled(s => !s)} />}
        {canCurl && <Tool icon={BookOpen} label="Flip" hint="Turn pages like paper" on={curl} onClick={toggleCurl} />}
      </div>
      <div className="viewer-body">
        <div ref={host} className="book-host" style={{ visibility: turning ? 'hidden' : undefined }} />
        {turning && <CurlBook key={curlStart.key} ref={curlRef} sections={sections} start={curlStart.place} onPlace={onCurlPlace} />}
      </div>
    </div>
  )
}
