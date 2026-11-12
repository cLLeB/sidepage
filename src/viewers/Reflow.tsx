import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { layoutOf, reflowOf, type Flow } from '../lib/paper'
import { FONTS, useTextStyle } from '../lib/reading'
import { addReadingFonts } from '../lib/fonts'

// A PDF read as flowing text: its words set in the size and typeface you chose for books, at the width of the
// screen, page after page. The page you are on is followed as you scroll, and kept when you go back to the pages.
export default function Reflow({ doc, page, onPage }: { doc: PDFDocumentProxy; page: number; onPage(page: number): void }) {
  const [flow, setFlow] = useState<Flow[] | null>(null)
  const style = useTextStyle()
  const host = useRef<HTMLDivElement>(null)
  const started = useRef(false)
  // The reading typefaces (OpenDyslexic, Atkinson Hyperlegible, Lexend), fetched when first used.
  useEffect(() => { if (FONTS[style.font].css && !['serif', 'sans', 'mono'].includes(style.font)) addReadingFonts() }, [style.font])
  useEffect(() => { let cancelled = false; void layoutOf(doc).then(layout => { if (!cancelled) setFlow(reflowOf(layout)) }); return () => { cancelled = true } }, [doc])
  // Open at the page that was showing.
  useEffect(() => {
    if (!flow || started.current) return
    started.current = true
    requestAnimationFrame(() => host.current?.querySelector(`[data-page="${page}"]`)?.scrollIntoView({ block: 'start' }))
  }, [flow, page])
  // The page whose start was last scrolled past is the page you are on.
  const onScroll = () => {
    const el = host.current
    if (!el) return
    const top = el.getBoundingClientRect().top + 40
    let current = 1
    for (const mark of el.querySelectorAll<HTMLElement>('[data-page]')) { if (mark.getBoundingClientRect().top <= top) current = Number(mark.dataset.page); else break }
    if (current !== page) onPage(current)
  }
  if (!flow) return <div className="viewer-message">Setting the text…</div>
  if (!flow.some(part => part.blocks.length)) return <div className="viewer-message">This PDF has no text to set: its pages are pictures. Make it searchable first, from ⋯ Tools.</div>
  return (
    <div ref={host} className="reflow" onScroll={onScroll} style={{ fontSize: `${(style.size / 100) * 18}px`, lineHeight: style.spacing * 1.1, fontFamily: FONTS[style.font].css || "Georgia, 'Times New Roman', serif" }}>
      <div className="reflow-column">
        {flow.map(part => (
          <section key={part.page} data-page={part.page}>
            <p className="reflow-page">{`p. ${part.page}`}</p>
            {part.blocks.map((block, i) => block.heading ? <h3 key={i}>{block.text}</h3> : <p key={i}>{block.text}</p>)}
          </section>
        ))}
      </div>
    </div>
  )
}
