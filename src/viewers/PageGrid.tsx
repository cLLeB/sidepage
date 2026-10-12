import { useEffect, useRef } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { pageFilter, useTheme } from '../lib/theme'

// Every page of a PDF as a small picture, to find a place by eye and jump to it. Pages are drawn as they come
// into view, so a long book opens its overview at once.
export default function PageGrid({ doc, current, onPick }: { doc: PDFDocumentProxy; current: number; onPick(page: number): void }) {
  const grid = useRef<HTMLDivElement>(null)
  const theme = useTheme()

  useEffect(() => {
    const el = grid.current!
    let closed = false
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const cell = entry.target as HTMLElement
        if (!entry.isIntersecting || cell.dataset.drawn) continue
        cell.dataset.drawn = '1'
        void doc.getPage(Number(cell.dataset.page)).then(async page => {
          const viewport = page.getViewport({ scale: 220 / page.getViewport({ scale: 1 }).width })
          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
          if (!closed) cell.querySelector('.page-thumb')!.replaceChildren(canvas)
        }).catch(() => {})
      }
    }, { root: el, rootMargin: '400px 0px' })
    el.querySelectorAll('.page-cell').forEach(cell => observer.observe(cell))
    el.querySelector('.page-cell.here')?.scrollIntoView({ block: 'center' })
    return () => {
      closed = true
      observer.disconnect()
    }
  }, [doc])

  return (
    <div ref={grid} className="page-grid" style={{ '--page-filter': pageFilter(theme) } as React.CSSProperties}>
      {Array.from({ length: doc.numPages }, (_, i) => (
        <button key={i} className={i + 1 === current ? 'page-cell here' : 'page-cell'} data-page={i + 1} onClick={() => onPick(i + 1)}>
          <span className="page-thumb" />
          <span className="page-number">{i + 1}</span>
        </button>
      ))}
    </div>
  )
}
