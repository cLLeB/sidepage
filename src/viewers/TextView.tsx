import { useEffect, useRef, useState } from 'react'
import { TextQuote } from 'lucide-react'
import { HighlightsMenu } from './ReaderMenus'
import { useTextHighlights } from './TextHighlights'
import { Tool } from '../ui'
import { Crepe } from '@milkdown/crepe'
import { baseName, extensionOf, sendQuote } from '../lib/platform'
import { keepWords } from '../lib/library'

// Plain text, Markdown (rendered read-only by Milkdown) and HTML (in a sandboxed frame).
export default function TextView({ file }: { file: File }) {
  const host = useRef<HTMLDivElement>(null)
  const [text, setText] = useState<string | null>(null)
  const kind = extensionOf(file.name)
  const isMarkdown = kind === 'md' || kind === 'markdown'
  const isHtml = kind === 'html' || kind === 'htm'
  const [ready, setReady] = useState(false)
  const pre = useRef<HTMLPreElement>(null)
  const marks = useTextHighlights(isMarkdown ? host : pre, file, ready)

  useEffect(() => {
    let cancelled = false
    file.text().then(t => {
      if (cancelled) return
      setText(t)
      if (!isMarkdown) setTimeout(() => setReady(true), 50)
      // Its words, in parts of a few thousand letters cut between paragraphs.
      const words = isHtml ? new DOMParser().parseFromString(t, 'text/html').body.innerText || new DOMParser().parseFromString(t, 'text/html').body.textContent || '' : t
      const parts: string[] = []
      for (const paragraph of words.split(/\n\s*\n/)) {
        if (parts.length && parts[parts.length - 1].length + paragraph.length < 4000) parts[parts.length - 1] += `\n\n${paragraph}`
        else parts.push(paragraph)
      }
      void keepWords(file.name, parts.filter(part => part.trim()).map((part, i) => ({ place: `section=${i}`, text: part })))
    })
    return () => { cancelled = true }
  }, [file])

  useEffect(() => {
    if (!isMarkdown || text === null || !host.current) return
    const crepe = new Crepe({ root: host.current, defaultValue: text })
    crepe.setReadonly(true)
    const made = crepe.create()
    void made.then(() => setReady(true))
    return () => { made.then(() => crepe.destroy()) }
  }, [isMarkdown, text])

  const quote = () => {
    const selected = window.getSelection()?.toString().trim()
    if (selected) sendQuote({ text: selected, source: baseName(file.name) })
  }

  return (
    <div className="viewer">
      <div className="viewer-bar">
        <span className="spacer" />
        {!isHtml && <HighlightsMenu marks={marks.marks} onHighlight={colour => void marks.highlight(colour)} onGo={marks.go} onChange={marks.change} onRemove={marks.remove} />}
        {!isHtml && <Tool icon={TextQuote} label="Quote" hint="Copy the selected text into your notes" onClick={quote} />}
      </div>
      {isHtml
        ? <iframe className="viewer-body html-frame" sandbox="" srcDoc={text ?? ''} title={file.name} />
        : isMarkdown
          ? <div ref={host} className="viewer-body text-host" />
          : <pre ref={pre} className="viewer-body text-host plain-text">{text}</pre>}
    </div>
  )
}
