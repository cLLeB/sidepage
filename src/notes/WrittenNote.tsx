import { useEffect, useRef, useState } from 'react'
import {
  ALargeSmall, AlignCenter, AlignJustify, AlignLeft, AlignRight, Baseline, Bold, Highlighter, Italic, ListTree, PenLine, Printer, RemoveFormatting,
  Strikethrough, Underline,
} from 'lucide-react'
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
import {
  FACES, INKS, MARKER_COLOURS, TEXT_COLOURS, TEXT_FACES, TEXT_SIZES, WRITING_SIZES, addLooks, clearLooks, setAlign, setLook, setWriting, toggleLook, useWriting,
  type Writing,
} from './writing'

// A notebook made before 0.11 had the book's name put on its first line. Nobody wrote that, so it is left out.
const withoutMadeTitle = (note: string, notebook: string) => {
  const [first, ...rest] = note.split('\n')
  return first.startsWith('# ') && first.slice(2).replace(/\\/g, '').trim() === notebook ? rest.join('\n').replace(/^\n+/, '') : note
}

// On a touch screen the device shows its own Cut / Copy / Paste bubble over the selection, right where the
// editor's floating toolbar would be. There the note's own bar does that work instead.
const touch = matchMedia('(pointer: coarse)').matches

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
  const probe = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Crepe | null>(null)
  const writing = useWriting()
  const rule = writing.size * 2
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
        defaultValue: withoutMadeTitle(saved ?? '', notebook),
        features: { [Crepe.Feature.Toolbar]: !touch },
        featureConfigs: {
          [Crepe.Feature.Placeholder]: { text: 'Write here…' },
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
      addLooks(editor)
      editor.on(listener => listener.markdownUpdated((_, markdown) => save(markdown)))
      await editor.create()
      if (cancelled) return void editor.destroy()
      crepe = editor
      editorRef.current = editor
      setReady(true)
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

  // The rules of the paper are laid where the writing actually falls: one rule to each row of text, just under
  // the letters. A hidden row of the same writing is measured for that, so it holds for any typeface and size,
  // and on devices that scale text themselves.
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const page = host.current, sample = probe.current
    if (!page || !sample) return
    const lay = () => {
      const sheet = page.querySelector<HTMLElement>('.ProseMirror')
      const box = sample.getBoundingClientRect()
      if (!sheet || !box.height) return
      const step = box.height / 2
      const baseline = sample.firstElementChild!.getBoundingClientRect().bottom - box.top
      const first = sheet.getBoundingClientRect().top + parseFloat(getComputedStyle(sheet).paddingTop) - (page.getBoundingClientRect().top - page.scrollTop)
      page.style.setProperty('--step', `${step}px`)
      // How far a letter's foot sits below the middle of its row, as a share of the letter's size: headings,
      // being larger, are lifted by this much to stand on the rule too.
      page.style.setProperty('--foot', String((baseline - step / 2) / parseFloat(getComputedStyle(sample).fontSize)))
      page.style.setProperty('--paper-y', `${(first + baseline + 2) % step}px`)
    }
    lay()
    const watch = new ResizeObserver(lay)
    watch.observe(sample)
    watch.observe(page)
    void document.fonts.ready.then(lay)
    document.fonts.addEventListener('loadingdone', lay)
    return () => { watch.disconnect(); document.fonts.removeEventListener('loadingdone', lay) }
  }, [ready, writing])

  const crepe = () => editorRef.current

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
    <div
      className="note written-wrap"
      data-ink={writing.ink}
      style={{ '--rule': `${rule}px`, '--note-size': `${writing.size}px`, '--note-face': FACES[writing.face].css } as React.CSSProperties}
    >
      {/* A button pressed in the bar must not take the cursor out of the note. */}
      <div className="note-bar" onMouseDown={e => { if (!(e.target as HTMLElement).closest('select, input')) e.preventDefault() }}>
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
        <Menu quiet icon={PenLine} label="Writing" hint="The typeface, size and ink of your writing">
          <label className="menu-row">Typeface
            <select value={writing.face} onChange={e => setWriting({ face: e.target.value as Writing['face'] })}>
              {Object.entries(FACES).map(([id, face]) => <option key={id} value={id}>{face.name}</option>)}
            </select>
          </label>
          <label className="menu-row">Size
            <select value={writing.size} onChange={e => setWriting({ size: Number(e.target.value) })}>
              {Object.entries(WRITING_SIZES).map(([name, size]) => <option key={name} value={size}>{name}</option>)}
            </select>
          </label>
          <label className="menu-row">Ink
            <select value={writing.ink} onChange={e => setWriting({ ink: e.target.value as Writing['ink'] })}>
              {Object.entries(INKS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <p className="menu-note">The lines of the paper follow the size you choose.</p>
        </Menu>
        <span className="divider" />
        <Tool quiet icon={Bold} label="Bold" onClick={() => toggleLook(crepe(), 'strong')} />
        <Tool quiet icon={Italic} label="Italic" onClick={() => toggleLook(crepe(), 'emphasis')} />
        <Tool quiet icon={Underline} label="Underline" onClick={() => toggleLook(crepe(), 'underline')} />
        <Tool quiet icon={Strikethrough} label="Strike through" onClick={() => toggleLook(crepe(), 'strike_through')} />
        <Menu quiet icon={Baseline} label="Text colour" hint="Colour the selected words">
          <span className="swatches">
            {Object.entries(TEXT_COLOURS).map(([name, colour]) => (
              <button key={name} className="swatch" style={{ background: colour }} title={name} aria-label={`${name} text`} onClick={() => setLook(crepe(), 'ink', colour)} />
            ))}
          </span>
          <button className="menu-item" onClick={() => setLook(crepe(), 'ink', null)}>The page's own ink</button>
        </Menu>
        <Menu quiet icon={Highlighter} label="Marker" hint="Run a marker over the selected words">
          <span className="swatches">
            {Object.entries(MARKER_COLOURS).map(([name, colour]) => (
              <button key={name} className="swatch" style={{ background: colour }} title={name} aria-label={`${name} marker`} onClick={() => setLook(crepe(), 'marker', colour)} />
            ))}
          </span>
          <button className="menu-item" onClick={() => setLook(crepe(), 'marker', null)}>No marker</button>
        </Menu>
        <Menu quiet icon={ALargeSmall} label="Size and typeface" hint="Make the selected words larger or smaller, or set them in another typeface">
          <p className="menu-head">Size</p>
          <button className="menu-item" onClick={() => setLook(crepe(), 'size', null)}>Normal</button>
          {Object.entries(TEXT_SIZES).map(([name, size]) => (
            <button key={name} className="menu-item" onClick={() => setLook(crepe(), 'size', size)}><span style={{ fontSize: size }}>{name}</span></button>
          ))}
          <p className="menu-head">Typeface</p>
          <button className="menu-item" onClick={() => setLook(crepe(), 'face', null)}>The page's own</button>
          {Object.entries(TEXT_FACES).map(([name, face]) => (
            <button key={name} className="menu-item" onClick={() => setLook(crepe(), 'face', face)}><span data-face={face}>{name}</span></button>
          ))}
        </Menu>
        <Menu quiet icon={AlignLeft} label="Alignment" hint="Which side the paragraph leans to">
          <Tool icon={AlignLeft} label="Left" onClick={() => setAlign(crepe(), 'left')} />
          <Tool icon={AlignCenter} label="Centre" onClick={() => setAlign(crepe(), 'center')} />
          <Tool icon={AlignRight} label="Right" onClick={() => setAlign(crepe(), 'right')} />
          <Tool icon={AlignJustify} label="Fill the line" onClick={() => setAlign(crepe(), 'justify')} />
        </Menu>
        <Tool quiet icon={RemoveFormatting} label="Plain writing" hint="Take the colour, size and other looks off the selected words" onClick={() => clearLooks(crepe())} />
        <span className="divider" />
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
      <div ref={probe} className="rule-probe" aria-hidden><i />x<br />x</div>
    </div>
  )
}
