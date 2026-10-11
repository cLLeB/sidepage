import { useState } from 'react'
import { ReactPptxViewer, setWasmSource, type PptxViewerController } from '@extend-ai/react-pptx'
import wasmUrl from '@extend-ai/react-pptx/pptx_wasm_bg.wasm?url'
import '@extend-ai/react-pptx/styles.css'
import SlidesView from './SlidesView'
import { baseName, prefersFlip, rememberFlip, sendQuote } from '../lib/platform'

setWasmSource(new URL(wasmUrl, document.baseURI).href)

// PowerPoint decks (.pptx and the older .ppt), read natively by react-pptx: real text to select and quote.
// "Flip" leafs through the same slides as pages (SlidesView).
export default function PptView({ file }: { file: File }) {
  const [slide, setSlide] = useState(0)
  const [count, setCount] = useState(0)
  const [error, setError] = useState('')
  const [controller, setController] = useState<PptxViewerController | null>(null)
  const [flip, setFlip] = useState(prefersFlip)
  const turning = flip && !!controller && count > 0

  const toggleFlip = () => {
    rememberFlip(!flip)
    // Leaving the page-turn view: bring the scrolling view to the slide that was open.
    if (flip) void controller?.goToSlide(slide)
    setFlip(!flip)
  }

  const quote = () => {
    const text = window.getSelection()?.toString().trim()
    if (text) sendQuote({ text, source: `${baseName(file.name)}, slide ${slide + 1}` })
  }

  if (error) return <div className="viewer-message">Could not open these slides: {error}</div>

  return (
    <div className="viewer">
      <div className="viewer-bar">
        <span className="viewer-pos">{count ? `${slide + 1} / ${count}` : '…'}</span>
        <span className="spacer" />
        <button onClick={quote} title="Copy the selected text into your notes">Quote</button>
        <button onClick={toggleFlip} className={flip ? 'on' : ''} title="Turn slides like pages">Flip</button>
      </div>
      <div className="viewer-body">
        {/* The scrolling view stays in place underneath: the page-turn view draws its slides through it. */}
        <div className="ppt-host" style={{ visibility: turning ? 'hidden' : undefined }}>
          <ReactPptxViewer
            source={file}
            defaultZoom="fit-width"
            showToolbar={false}
            showThumbnails={false}
            height="100%"
            onReady={setController}
            onLoad={presentation => setCount(presentation.document.slides.length)}
            onSlideChange={index => { if (!turning) setSlide(index) }}
            onError={e => setError(e.message)}
          />
        </div>
        {turning && <SlidesView controller={controller} count={count} start={slide} onSlide={setSlide} />}
      </div>
    </div>
  )
}
