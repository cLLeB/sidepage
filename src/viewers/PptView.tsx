import { useState } from 'react'
import { ReactPptxViewer, setWasmSource } from '@extend-ai/react-pptx'
import wasmUrl from '@extend-ai/react-pptx/pptx_wasm_bg.wasm?url'
import '@extend-ai/react-pptx/styles.css'
import { baseName, sendQuote } from '../lib/platform'

setWasmSource(new URL(wasmUrl, document.baseURI).href)

// PowerPoint 97–2003 (.ppt) decks, read natively by react-pptx.
export default function PptView({ file }: { file: File }) {
  const [slide, setSlide] = useState(0)
  const [count, setCount] = useState(0)
  const [error, setError] = useState('')

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
