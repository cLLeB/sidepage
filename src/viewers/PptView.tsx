import { lazy, Suspense, useState } from 'react'
import { ReactPptxViewer, setWasmSource } from '@extend-ai/react-pptx'
import wasmUrl from '@extend-ai/react-pptx/pptx_wasm_bg.wasm?url'
import '@extend-ai/react-pptx/styles.css'
import { baseName, extensionOf, prefersFlip, rememberFlip, sendQuote } from '../lib/platform'

const SlidesView = lazy(() => import('./SlidesView'))

setWasmSource(new URL(wasmUrl, document.baseURI).href)

// PowerPoint decks (.pptx and the older .ppt), read natively by react-pptx. A .pptx can also be leafed through
// as a book; that view draws the slides as pictures with PptxViewJS.
export default function PptView({ file }: { file: File }) {
  const [slide, setSlide] = useState(0)
  const [count, setCount] = useState(0)
  const [error, setError] = useState('')
  const canFlip = extensionOf(file.name) === 'pptx'
  const [flip, setFlip] = useState(() => canFlip && prefersFlip())
  const toggleFlip = () => {
    rememberFlip(!flip)
    setFlip(!flip)
  }

  const quote = () => {
    const text = window.getSelection()?.toString().trim()
    if (text) sendQuote({ text, source: `${baseName(file.name)}, slide ${slide + 1}` })
  }

  if (flip) return <Suspense fallback={<div className="viewer-message">Loading…</div>}><SlidesView file={file} onLeave={toggleFlip} /></Suspense>
  if (error) return <div className="viewer-message">Could not open these slides: {error}</div>

  return (
    <div className="viewer">
      <div className="viewer-bar">
        <span className="viewer-pos">{count ? `${slide + 1} / ${count}` : '…'}</span>
        <span className="spacer" />
        <button onClick={quote} title="Copy the selected text into your notes">Quote</button>
        {canFlip && <button onClick={toggleFlip} title="Turn slides like pages">Flip</button>}
      </div>
      <div className="viewer-body ppt-host">
        <ReactPptxViewer
          source={file}
          defaultZoom="fit-width"
          showToolbar={false}
          showThumbnails={false}
          height="100%"
          onLoad={presentation => setCount(presentation.document.slides.length)}
          onSlideChange={setSlide}
          onError={e => setError(e.message)}
        />
      </div>
    </div>
  )
}
