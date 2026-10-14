import { useEffect, useRef, useState } from 'react'
import { BookA, Languages, TextQuote } from 'lucide-react'
import { HighlightsMenu } from './ReaderMenus'
import { useTextHighlights } from './TextHighlights'
import { lookUp, translate } from '../Extras'
import { Tool } from '../ui'
import { baseName, extensionOf, onGoToPlace, sendQuote, tellPlace } from '../lib/platform'
import { keepWords } from '../lib/library'

// The pages a document was drawn as: Word's own pages, or the one sheet the others are set on.
const pagesOf = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('section.docx, .sheet')]

// Word documents (docx-preview, and @file-viewer/doc for Word 97–2003), RTF (rtf.js) and OpenDocument text (odf-kit).
export default function OfficeView({ file }: { file: File }) {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const marks = useTextHighlights(host, file, ready)

  useEffect(() => {
    const el = host.current!
    let cancelled = false
    // Pages keep their real width; shrink them to fit a narrow panel.
    const fit = () => {
      const page = el.querySelector<HTMLElement>('section.docx')
      if (page) el.style.setProperty('--fit', String(Math.min(1, (el.clientWidth - 40) / page.offsetWidth)))
    }
    const resize = new ResizeObserver(fit)
    resize.observe(el)
    const kind = extensionOf(file.name)
    const page = () => {
      const sheet = document.createElement('article')
      sheet.className = 'sheet'
      el.append(sheet)
      return sheet
    }
    const render = async () => {
      if (kind === 'rtf') {
        const { RTFJS } = await import('rtf.js')
        RTFJS.loggingEnabled(false)
        const parts = await new RTFJS.Document(await file.arrayBuffer(), {}).render()
        if (!cancelled) page().append(...parts)
      } else if (kind === 'doc') {
        const { parseMsDocToHtml, mountMsDoc } = await import('@file-viewer/doc')
        const rendered = await parseMsDocToHtml(await file.arrayBuffer())
        if (!cancelled) mountMsDoc(page(), rendered)
      } else if (kind === 'odt') {
        const [{ odtToHtml }, { default: purify }] = await Promise.all([import('odf-kit/odt/to-html'), import('dompurify')])
        const html = odtToHtml(new Uint8Array(await file.arrayBuffer()), { fragment: true })
        if (!cancelled) page().innerHTML = purify.sanitize(html)
      } else {
        const { renderAsync } = await import('docx-preview')
        if (!cancelled) await renderAsync(file, el, undefined, { inWrapper: true, breakPages: true })
      }
    }
    render()
      .then(fit)
      .then(() => {
        if (cancelled) return
        setReady(true)
        // Its words, page by page, so the document can be searched, asked and studied like any book.
        void keepWords(file.name, pagesOf(el).map((page, i) => ({ place: `page=${i + 1}`, text: page.innerText })))
      })
      .catch(e => setError(String(e?.message ?? e)))
    return () => {
      cancelled = true
      resize.disconnect()
      el.replaceChildren()
    }
  }, [file])

  // Which page is in view, told to the notes and the study guide; a link in a note brings its page back.
  const [page, setPage] = useState(1)
  useEffect(() => {
    const el = host.current
    if (!el || !ready) return
    const look = () => {
      const pages = pagesOf(el)
      const top = el.getBoundingClientRect().top + 80
      const index = pages.findIndex(found => found.getBoundingClientRect().bottom > top)
      setPage(Math.max(1, index + 1))
    }
    look()
    el.addEventListener('scroll', look, { passive: true })
    return () => el.removeEventListener('scroll', look)
  }, [ready])
  useEffect(() => { if (ready) tellPlace({ book: file.name, place: `page=${page}` }) }, [page, ready, file])
  useEffect(() => onGoToPlace(({ book, place }) => {
    const number = Number(place.match(/^page=(\d+)/)?.[1])
    if (book !== file.name || !number || !host.current) return
    pagesOf(host.current)[number - 1]?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }), [file])

  const quote = () => {
    const text = window.getSelection()?.toString().trim()
    if (text) sendQuote({ text, source: `${baseName(file.name)}, p. ${page}`, book: file.name, place: `page=${page}` })
  }

  if (error) return <div className="viewer-message">Could not open this document: {error}</div>

  return (
    <div className="viewer" onPointerDownCapture={() => { if (ready) tellPlace({ book: file.name, place: `page=${page}` }) }}>
      <div className="viewer-bar">
        {ready && pagesOf(host.current!).length > 1 && <span className="viewer-pos">p. {page} / {pagesOf(host.current!).length}</span>}
        <span className="spacer" />
        <HighlightsMenu marks={marks.marks} onHighlight={colour => void marks.highlight(colour)} onGo={marks.go} onChange={marks.change} onRemove={marks.remove} />
        <Tool icon={TextQuote} label="Quote" hint="Copy the selected text into your notes" onClick={quote} />
        <Tool icon={BookA} label="Look up" hint="What the selected word means" onClick={() => lookUp(window.getSelection()?.toString())} />
          <Tool icon={Languages} label="Translate" hint="Translate the selected passage (sent to a free online service)" onClick={() => translate(window.getSelection()?.toString())} />
      </div>
      <div ref={host} className="viewer-body office-host" />
    </div>
  )
}
