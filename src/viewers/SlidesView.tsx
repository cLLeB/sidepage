import { useEffect, useState } from 'react'
import FlipBook from './FlipBook'

const WIDTH = 1280
const HEIGHT = 720

// A PowerPoint deck as a book to leaf through: each slide drawn as a picture by PptxViewJS and turned by
// StPageFlip. The everyday view of a deck, with real text, is PptView.
export default function SlidesView({ file, onLeave }: { file: File; onLeave(): void }) {
  const [slides, setSlides] = useState<string[] | null>(null)
  const [current, setCurrent] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const urls: string[] = []
    let release = () => {}
    ;(async () => {
      const { PPTXViewer } = await import('pptxviewjs')
      const viewer = new PPTXViewer({ backgroundColor: '#ffffff' })
      await viewer.loadFile(file)
      for (let i = 0; i < viewer.getSlideCount() && !cancelled; i++) {
        const canvas = document.createElement('canvas')
        canvas.width = WIDTH
        canvas.height = HEIGHT
        await viewer.renderSlide(i, canvas)
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
        if (blob) urls.push(URL.createObjectURL(blob))
      }
      // Released on close: the library still has work queued right after the last slide.
      release = () => viewer.destroy()
      if (cancelled) release()
      else setSlides(urls)
    })().catch(e => setError(String(e?.message ?? e)))
    return () => {
      cancelled = true
      release()
      urls.forEach(url => URL.revokeObjectURL(url))
    }
  }, [file])

  return (
    <div className="viewer">
      <div className="viewer-bar">
        <span className="viewer-pos">{slides ? `${current + 1} / ${slides.length}` : '…'}</span>
        <span className="spacer" />
        <button onClick={onLeave} className="on" title="Back to the slides with selectable text">Flip</button>
      </div>
      <div className="viewer-body">
        {error
          ? <div className="viewer-message">Could not turn these slides into pages: {error}</div>
          : slides
            ? <FlipBook tinted pages={slides} ratio={HEIGHT / WIDTH} startPage={current} onFlip={setCurrent} />
            : <div className="viewer-message">Preparing slides…</div>}
      </div>
    </div>
  )
}
