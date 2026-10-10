import { useEffect, useRef, useState } from 'react'
import { baseName, sendQuote } from '../lib/platform'

// Word documents, laid out page by page with docx-preview.
export default function OfficeView({ file }: { file: File }) {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')

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
    import('docx-preview')
      .then(({ renderAsync }) => cancelled ? undefined : renderAsync(file, el, undefined, { inWrapper: true, breakPages: true }))
      .then(fit)
      .catch(e => setError(String(e?.message ?? e)))
    return () => {
      cancelled = true
      resize.disconnect()
      el.replaceChildren()
    }
  }, [file])

  const quote = () => {
    const text = window.getSelection()?.toString().trim()
    if (text) sendQuote({ text, source: baseName(file.name) })
  }

  if (error) return <div className="viewer-message">Could not open this document: {error}</div>

  return (
    <div className="viewer">
      <div className="viewer-bar">
        <span className="spacer" />
        <button onClick={quote} title="Copy the selected text into your notes">Quote to notes</button>
      </div>
      <div ref={host} className="viewer-body office-host" />
    </div>
  )
}
