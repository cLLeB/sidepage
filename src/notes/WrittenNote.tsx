import { useEffect, useRef } from 'react'
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { Selection } from '@milkdown/kit/prose/state'
import { insert } from '@milkdown/kit/utils'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import { baseName, debounce, goToPlace, loadNote, onFindInNotes, onQuote, parsePlaceLink, placeLink, saveNote } from '../lib/platform'

// Typed notes in Markdown (Milkdown Crepe), saved as notes.md.
export default function WrittenNote({ notebook }: { notebook: string }) {
  const host = useRef<HTMLDivElement>(null)

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
      const place = parsePlaceLink((e.target as HTMLElement).closest('a')?.getAttribute('href') ?? '')
      if (!place) return
      e.preventDefault()
      e.stopPropagation()
      goToPlace(place)
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

  return <div ref={host} className="note written-note paper" />
}
