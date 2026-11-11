import { useEffect, useRef, useState } from 'react'
import { onPinch } from '../lib/pinch'
import { FONTS, setTextStyle, textStyleNow, useTextStyle } from '../lib/reading'
import { addReadingFonts } from '../lib/fonts'
import { fixate, unfixate } from '../lib/fixation'
import { TextQuote } from 'lucide-react'
import { HighlightsMenu, TextMenu } from './ReaderMenus'
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
  // The reader's typeface and fixation reading, as for books.
  const style = useTextStyle()
  useEffect(addReadingFonts, [])
  useEffect(() => {
    const el = (isMarkdown ? host : pre).current
    if (!el || !ready) return
    el.style.fontFamily = FONTS[style.font].css
    el.style.fontSize = `${style.size}%`
    el.style.lineHeight = String(style.spacing)
    void (style.fixation ? fixate(el) : unfixate(el))
  }, [style.font, style.fixation, style.size, style.spacing, ready, isMarkdown])
  // Pinching makes the words larger or smaller, the same as the text size in Aa.
  useEffect(() => {
    const el = (isMarkdown ? host : pre).current
    if (!el || !ready) return
    let wanted = 0
    return onPinch(el, factor => {
      const size = textStyleNow().size
      wanted = (wanted || size) * factor
      if (Math.abs(wanted - size) >= 5) { setTextStyle({ size: Math.round(wanted) }); wanted = 0 }
    })
  }, [ready, isMarkdown])
  // A web page is shown in a frame of its own (where nothing of it can run): pinching is listened for inside it.
  const framed = (frame: HTMLIFrameElement) => {
    const page = frame.contentDocument
    if (!page) return
    let zoom = 1
    onPinch(page, factor => { zoom = Math.max(0.4, Math.min(5, zoom * factor)); page.documentElement.style.zoom = String(zoom) })
  }

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
        {!isHtml && <TextMenu />}
        {!isHtml && <HighlightsMenu marks={marks.marks} onHighlight={colour => void marks.highlight(colour)} onGo={marks.go} onChange={marks.change} onRemove={marks.remove} />}
        {!isHtml && <Tool icon={TextQuote} label="Quote" hint="Copy the selected text into your notes" onClick={quote} />}
      </div>
      {isHtml
        ? <iframe className="viewer-body html-frame" sandbox="allow-same-origin" srcDoc={text ?? ''} title={file.name} onLoad={e => framed(e.currentTarget)} />
        : isMarkdown
          ? <div ref={host} className="viewer-body text-host" />
          : <pre ref={pre} className="viewer-body text-host plain-text">{text}</pre>}
    </div>
  )
}
