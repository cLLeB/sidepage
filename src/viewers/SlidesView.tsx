import { useEffect, useState } from 'react'
import FlipBook from './FlipBook'
import { prefersFlip, rememberFlip } from '../lib/platform'

const WIDTH = 1280
const HEIGHT = 720

// PowerPoint decks, drawn slide by slide with PptxViewJS.
export default function SlidesView({ file }: { file: File }) {
  const [slides, setSlides] = useState<string[] | null>(null)
  const [flip, setFlip] = useState(prefersFlip)
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

  if (error) return <div className="viewer-message">Could not open these slides: {error}</div>
  if (!slides) return <div className="viewer-message">Preparing slides…</div>

  return (
    <div className="viewer">
      <div className="viewer-bar">
        <span className="viewer-pos">{flip ? `${current + 1} / ${slides.length}` : `${slides.length} slides`}</span>
        <span className="spacer" />
        <button onClick={() => { rememberFlip(!flip); setFlip(!flip) }} className={flip ? 'on' : ''}>Flip</button>
      </div>
      <div className="viewer-body">
        {flip
          ? <FlipBook pages={slides} ratio={HEIGHT / WIDTH} startPage={current} onFlip={setCurrent} />
          : <div className="slide-list">
              {slides.map((url, i) => <img key={url} src={url} alt={`Slide ${i + 1}`} onClick={() => setCurrent(i)} />)}
            </div>}
      </div>
    </div>
  )
}
