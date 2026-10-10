import { useEffect, useRef } from 'react'
import { Crepe } from '@milkdown/crepe'
import { insert } from '@milkdown/kit/utils'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import { debounce, loadNote, onQuote, saveNote } from '../lib/platform'

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
      stopQuotes = onQuote(({ text, source }) => {
        const quoted = text.split(/\n+/).map(line => `> ${line}`).join('\n')
        editor.editor.action(insert(`\n${quoted}\n>\n> — *${source}*\n\n`))
      })
    })
    return () => {
      cancelled = true
      stopQuotes()
      void crepe?.destroy()
    }
  }, [notebook])

  return <div ref={host} className="note written-note paper" />
}
