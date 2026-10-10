import { useEffect, useRef, useState } from 'react'
import 'foliate-js/view.js'
import { Overlayer } from 'foliate-js/overlayer.js'
import { baseName, extensionOf, findInNotes, loadNote, onGoToPlace, saveNote, sendQuote } from '../lib/platform'

type TocItem = { label: string; href: string; subitems?: TocItem[] }

const bookCSS = `
  @namespace epub "http://www.idpf.org/2007/ops";
  html { color-scheme: light; }
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
      view.renderer.setStyles?.(bookCSS)
      view.renderer.setAttribute('animated', '')
      // Reopen where the reader left off.
      return view.init({ lastLocation: localStorage.getItem(`sidepage:place:${file.name}`) })
    }).catch((e: Error) => setError(String(e?.message ?? e)))
    return () => {
      closed = true
      stopGoTo()
      view.close?.()
      view.remove()
    }
  }, [file])

  useEffect(() => {
    viewRef.current?.renderer?.setAttribute('flow', scrolled ? 'scrolled' : 'paginated')
  }, [scrolled, toc])

  const quote = () => {
    const view = viewRef.current
    const contents: { doc: Document; index: number }[] = view?.renderer?.getContents?.() ?? []
    for (const { doc, index } of contents) {
      const selection = doc.getSelection()
      const text = selection?.toString().trim()
      if (!selection || !text) continue
      const cfi: string = view.getCFI(index, selection.getRangeAt(0))
      marks.current.push({ cfi, index, text })
      void saveNote(baseName(file.name), 'highlights.json', JSON.stringify(marks.current))
      void view.addAnnotation({ value: cfi })
      selection.removeAllRanges()
      return sendQuote({ text, source: [baseName(file.name), where.label].filter(Boolean).join(', '), book: file.name, place: cfi })
    }
  }

  if (error) return <div className="viewer-message">Could not open this book: {error}</div>

  return (
    <div className="viewer">
      <div className="viewer-bar">
        <button onClick={() => viewRef.current?.goLeft()} title="Previous page">‹</button>
        <button onClick={() => viewRef.current?.goRight()} title="Next page">›</button>
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
        <button onClick={quote} title="Copy the selected text into your notes">Quote</button>
        <button onClick={() => setScrolled(s => !s)} className={scrolled ? 'on' : ''}>Scroll</button>
      </div>
      <div ref={host} className="viewer-body book-host" />
    </div>
  )
}
