import { useEffect, useRef, useState } from 'react'
import { ListTree, Printer } from 'lucide-react'
import { Menu, Tool } from '../ui'
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { Selection } from '@milkdown/kit/prose/state'
import { imageBlockSchema } from '@milkdown/kit/component/image-block'
import { insert } from '@milkdown/kit/utils'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import {
  baseName, debounce, goToPlace, isMobile, isShown, loadNote, loadNoteFile, noteLink, noteLinks, onClip, saveNoteFile, onFindInNotes, onQuote, openBookByName, parseNoteLink,
  parsePlaceLink, placeLink, saveNote, shelf,
} from '../lib/platform'

// Ready-made layouts for a note. "Question and answer" lines become flashcards (see lib/review.ts).
const TEMPLATES = {
  'Cornell notes': '\n## Cornell notes\n\n**Cues and questions**\n\n- \n\n**Notes**\n\n- \n\n**Summary**\n\n\n',
  'Question and answer': '\nQ: \n\nA: \n\n',
  'Chapter summary': '\n## Summary\n\n**Main idea**\n\n\n**Key points**\n\n- \n- \n- \n\n**What I still do not understand**\n\n- \n\n',
  'Key terms': '\n| Term | Meaning |\n| --- | --- |\n|  |  |\n|  |  |\n\n',
} as const

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
    const shown = new Map<string, string>()
    const save = debounce((markdown: string) => { void saveNote(notebook, 'notes.md', markdown) }, 500)
    loadNote(notebook, 'notes.md').then(async saved => {
      if (cancelled || !host.current) return
      const editor = new Crepe({
        root: host.current,
        defaultValue: saved ?? `# ${notebook}\n\n`,
        featureConfigs: {
          [Crepe.Feature.ImageBlock]: {
            // A picture put into the note is kept in the notebook, and the note refers to it by its file name.
            onUpload: async picture => {
              const name = `picture-${Date.now().toString(36)}.${picture.name.split('.').pop() || 'png'}`
              await saveNoteFile(notebook, name, picture)
              return name
            },
            // …and that name is turned back into the picture whenever the note is shown.
            proxyDomURL: async url => {
              if (!/^(clip|picture)-[\w.-]+$/.test(url)) return url
              if (!shown.has(url)) {
                const picture = await loadNoteFile(notebook, url)
                if (picture) shown.set(url, URL.createObjectURL(picture))
              }
              return shown.get(url) ?? url
            },
          },
        },
      })
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

    // A clip from a page goes in the same way as a quote: at the end, with its source linking back.
    const stopClips = onClip(async ({ image, source, book, place }) => {
      if (baseName(book) !== notebook || !crepe) return
      // With the Canvas in front and this note behind it, the clip is the Canvas's to take.
      if (!isShown(host.current) && [...document.querySelectorAll('.canvas-page')].some(isShown)) return
      const name = `clip-${Date.now().toString(36)}.jpg`
      await saveNoteFile(notebook, name, await (await fetch(image)).blob())
      // The picture goes in as a picture block at the end of the note, then its source on the line after.
      crepe.editor.action(ctx => {
        const view = ctx.get(editorViewCtx)
        const picture = imageBlockSchema.type(ctx).create({ src: name, caption: source })
        view.dispatch(view.state.tr.insert(view.state.doc.content.size, picture))
        view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)))
      })
      crepe.editor.action(insert(`\n— [${source}](${placeLink({ book, place })})\n\n`))
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
      const blocks = [...(root?.querySelectorAll<HTMLElement>('.ProseMirror > *') ?? [])]
      const block = blocks.find(part => part.matches('blockquote') && squash(part.textContent ?? '').includes(start))
        ?? blocks.find(part => squash(part.textContent ?? '').includes(start))
      if (!block) return
      block.scrollIntoView({ block: 'center', behavior: 'smooth' })
      // An animation, not a class: the editor owns this element's attributes and would strip one.
      block.animate([{ backgroundColor: '#ffd84d' }, { backgroundColor: 'transparent' }], { duration: 2000 })
    })

    return () => {
      cancelled = true
      stopQuotes()
      stopFinding()
      stopClips()
      root?.removeEventListener('click', follow, true)
      void crepe?.destroy()
      shown.forEach(url => URL.revokeObjectURL(url))
    }
  }, [notebook])

  // The note's headings, to jump by.
  const headings = () => [...(host.current?.querySelectorAll<HTMLElement>('.ProseMirror :is(h1, h2, h3, h4)') ?? [])]
    .filter(heading => heading.textContent?.trim())

  // Print the note as it reads, on plain paper, without the app round it.
  const print = () => {
    const page = host.current?.querySelector('.ProseMirror')
    if (!page) return
    const frame = document.createElement('iframe')
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden'
    document.body.append(frame)
    const sheet = frame.contentDocument!
    sheet.open()
    sheet.write(`<!doctype html><title>${notebook}</title><style>
      body { font: 12pt/1.55 Georgia, 'Times New Roman', serif; color: #111; margin: 18mm; }
      h1, h2, h3 { font-family: system-ui, sans-serif; line-height: 1.25; }
      blockquote { margin: 1em 0; padding-left: 1em; border-left: 3px solid #bbb; color: #333; }
      img { max-width: 100%; } table { border-collapse: collapse; } td, th { border: 1px solid #999; padding: 4px 8px; }
      a { color: inherit; text-decoration: none; }
    </style>${page.innerHTML}`)
    sheet.close()
    frame.contentWindow!.onafterprint = () => frame.remove()
    setTimeout(() => { frame.contentWindow!.focus(); frame.contentWindow!.print() }, 300)
    setTimeout(() => frame.remove(), 120_000)
  }

  return (
    <div className="note written-wrap">
      <div className="note-bar">
        <Menu quiet icon={ListTree} label="Outline" hint="Jump to a heading in this note">
          {() => {
            const found = headings()
            return found.length
              ? <div className="menu-scroll">{found.map((heading, i) => (
                  <button key={i} className="menu-item" style={{ paddingLeft: 10 + (Number(heading.tagName[1]) - 1) * 14 }} onClick={() => heading.scrollIntoView({ block: 'start', behavior: 'smooth' })}>
                    {heading.textContent}
                  </button>
                ))}</div>
              : <p className="menu-note">Headings you write in this note are listed here.</p>
          }}
        </Menu>
        <select
          value=""
          onFocus={() => void refreshLinks()}
          onChange={e => editorRef.current?.editor.action(insert(`[${baseName(e.target.value)}](${noteLink(e.target.value)})`))}
          title="Insert a link to another book's notes"
        >
          <option value="" disabled>Link to another book…</option>
          {others.map(name => <option key={name} value={name}>{baseName(name)}</option>)}
        </select>
        <select
          value=""
          onChange={e => editorRef.current?.editor.action(insert(TEMPLATES[e.target.value as keyof typeof TEMPLATES]))}
          title="Put a ready-made layout into the note, where the cursor is"
        >
          <option value="" disabled>Insert a template…</option>
          {Object.keys(TEMPLATES).map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        {!isMobile && <Tool quiet icon={Printer} label="Print this note" onClick={print} />}
        {backlinks.length > 0 && <span className="viewer-pos">Linked from</span>}
        {backlinks.map(name => <button key={name} onClick={() => openBookByName(name)}>{baseName(name)}</button>)}
      </div>
      <div ref={host} className="written-note paper" />
    </div>
  )
}
