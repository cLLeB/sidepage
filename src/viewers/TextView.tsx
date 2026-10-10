import { useEffect, useRef, useState } from 'react'
import { Crepe } from '@milkdown/crepe'
import { baseName, extensionOf, sendQuote } from '../lib/platform'

// Plain text, Markdown (rendered read-only by Milkdown) and HTML (in a sandboxed frame).
export default function TextView({ file }: { file: File }) {
  const host = useRef<HTMLDivElement>(null)
  const [text, setText] = useState<string | null>(null)
  const kind = extensionOf(file.name)
  const isMarkdown = kind === 'md' || kind === 'markdown'
  const isHtml = kind === 'html' || kind === 'htm'

  useEffect(() => {
    let cancelled = false
    file.text().then(t => { if (!cancelled) setText(t) })
    return () => { cancelled = true }
  }, [file])

  useEffect(() => {
    if (!isMarkdown || text === null || !host.current) return
    const crepe = new Crepe({ root: host.current, defaultValue: text })
    crepe.setReadonly(true)
    const ready = crepe.create()
    return () => { ready.then(() => crepe.destroy()) }
  }, [isMarkdown, text])

  const quote = () => {
    const selected = window.getSelection()?.toString().trim()
    if (selected) sendQuote({ text: selected, source: baseName(file.name) })
  }

  return (
    <div className="viewer">
      <div className="viewer-bar">
        <span className="spacer" />
        {!isHtml && <button onClick={quote} title="Copy the selected text into your notes">Quote to notes</button>}
      </div>
      {isHtml
        ? <iframe className="viewer-body html-frame" sandbox="" srcDoc={text ?? ''} title={file.name} />
        : isMarkdown
          ? <div ref={host} className="viewer-body text-host" />
          : <pre className="viewer-body text-host plain-text">{text}</pre>}
    </div>
  )
}
