import { useEffect, useRef, useState } from 'react'
import 'foliate-js/view.js'
import { baseName, extensionOf, sendQuote } from '../lib/platform'

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
  Archive.init({ workerUrl: '/libarchive/worker-bundle.js' })
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
    const isArchive = ['cbr', 'cb7', 'cbt'].includes(extensionOf(file.name))
    Promise.resolve(isArchive ? openComicArchive(file) : file).then(book => view.open(book)).then(() => {
      if (closed) return
      setToc(flatten(view.book.toc ?? []))
      view.renderer.setStyles?.(bookCSS)
      view.renderer.setAttribute('animated', '')
      // Reopen where the reader left off.
      return view.init({ lastLocation: localStorage.getItem(`sidepage:place:${file.name}`) })
    }).catch((e: Error) => setError(String(e?.message ?? e)))
    return () => {
      closed = true
      view.close?.()
      view.remove()
    }
  }, [file])

  useEffect(() => {
    viewRef.current?.renderer?.setAttribute('flow', scrolled ? 'scrolled' : 'paginated')
  }, [scrolled, toc])

  const quote = () => {
    const contents: { doc: Document }[] = viewRef.current?.renderer?.getContents?.() ?? []
    const text = contents.map(c => c.doc.getSelection()?.toString().trim()).find(Boolean)
    if (text) sendQuote({ text, source: [baseName(file.name), where.label].filter(Boolean).join(', ') })
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
        <button onClick={quote} title="Copy the selected text into your notes">Quote to notes</button>
        <button onClick={() => setScrolled(s => !s)} className={scrolled ? 'on' : ''}>Scroll</button>
      </div>
      <div ref={host} className="viewer-body book-host" />
    </div>
  )
}
