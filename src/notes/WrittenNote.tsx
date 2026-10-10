import { useEffect, useRef, useState } from 'react'
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { Selection } from '@milkdown/kit/prose/state'
import { insert } from '@milkdown/kit/utils'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import {
  baseName, debounce, goToPlace, loadNote, noteLink, noteLinks, onFindInNotes, onQuote, openBookByName, parseNoteLink,
  parsePlaceLink, placeLink, saveNote, shelf,
} from '../lib/platform'

// Typed notes in Markdown (Milkdown Crepe), saved as notes.md.
export default function WrittenNote({ notebook }: { notebook: string }) {
  const host = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Crepe | null>(null)
  // Other books to link to, and the books whose notes link here.
  const [others, setOthers] = useState<string[]>([])
  const [backlinks, setBacklinks] = useState<string[]>([])

  const refreshLinks = async () => {
    const [books, links] = await Promise.all([shelf(), noteLinks()])
    setOthers(books.map(book => book.name).filter(name => baseName(name) !== notebook))
    setBacklinks([...new Set(links.filter(link => baseName(link.to) === notebook && baseName(link.from) !== notebook).map(link => link.from))])
  }
  useEffect(() => { void refreshLinks() }, [notebook]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let crepe: Crepe | undefined
    let cancelled = false
    let stopQuotes = () => {}
    const save = debounce((markdown: string) => { void saveNote(notebook, 'notes.md', markdown) }, 500)
    loadNote(notebook, 'notes.md').then(async saved => {
      if (cancelled || !host.current) return
      const editor = new Crepe({ root: host.current, defaultValue: saved ?? `# ${notebook}\n\n` })
      editor.on(listener => listener.markdownUpdated((_, markdown) => save(markdown)))
      await editor.create()
      if (cancelled) return void editor.destroy()
      crepe = editor
      editorRef.current = editor
      stopQuotes = onQuote(({ text, source, book, place }) => {
        // Each book's quotes go to its own notebook.
        if (book && baseName(book) !== notebook) return
        const quoted = text.split(/\n+/).map(line => `> ${line}`).join('\n')
        // The source line links back to the exact place in the book.
        const credit = book && place ? `[${source}](${placeLink({ book, place })})` : `*${source}*`
        // Quotes are added at the end of the page, like the next line in a notebook.
        editor.editor.action(ctx => {
          const view = ctx.get(editorViewCtx)
          view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)))
        })
        editor.editor.action(insert(`\n${quoted}\n>\n> — ${credit}\n\n`))
      })
    })

    // Clicking a source link travels to that place in the book instead of leaving the app.
    const root = host.current
    const follow = (e: MouseEvent) => {
      const href = (e.target as HTMLElement).closest('a')?.getAttribute('href') ?? ''
      const place = parsePlaceLink(href)
      const book = parseNoteLink(href)
      if (!place && !book) return
      e.preventDefault()
      e.stopPropagation()
      if (place) goToPlace(place)
      else if (book) openBookByName(book)
    }
    root?.addEventListener('click', follow, true)

    // Coming the other way: a highlight clicked in the book shows the note that quotes it.
    const squash = (text: string) => text.replace(/\s+/g, ' ').trim()
    const stopFinding = onFindInNotes(({ text }) => {
      const start = squash(text).slice(0, 60)
      const block = [...(root?.querySelectorAll('blockquote') ?? [])].find(quote => squash(quote.textContent ?? '').includes(start))
      if (!block) return
      block.scrollIntoView({ block: 'center', behavior: 'smooth' })
      // An animation, not a class: the editor owns this element's attributes and would strip one.
      block.animate([{ backgroundColor: '#ffd84d' }, { backgroundColor: 'transparent' }], { duration: 2000 })
    })

    return () => {
      cancelled = true
      stopQuotes()
      stopFinding()
      root?.removeEventListener('click', follow, true)
      void crepe?.destroy()
    }
  }, [notebook])

  return (
    <div className="note written-wrap">
      <div className="note-bar">
        <select
          value=""
          onFocus={() => void refreshLinks()}
          onChange={e => editorRef.current?.editor.action(insert(`[${baseName(e.target.value)}](${noteLink(e.target.value)})`))}
          title="Insert a link to another book's notes"
        >
          <option value="" disabled>Link to another book…</option>
          {others.map(name => <option key={name} value={name}>{baseName(name)}</option>)}
        </select>
        {backlinks.length > 0 && <span className="viewer-pos">Linked from</span>}
        {backlinks.map(name => <button key={name} onClick={() => openBookByName(name)}>{baseName(name)}</button>)}
      </div>
      <div ref={host} className="written-note paper" />
    </div>
  )
}
