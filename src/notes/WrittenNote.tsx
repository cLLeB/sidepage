import { useEffect, useRef, useState } from 'react'
import {
  ALargeSmall, AlignCenter, AlignJustify, AlignLeft, AlignRight, Baseline, Bold, CalendarDays, Heading1, Heading2, Heading3, Highlighter, ImagePlus, Italic,
  List, ListChecks, ListOrdered, ListTree, Minus, PenLine, Pilcrow, Plus, Printer, Quote, Redo2, RemoveFormatting, Strikethrough, Table, Underline, Undo2,
  AlignVerticalJustifyCenter, Footprints, History as HistoryIcon, Mic, ArrowDown, ArrowUp, ClipboardCopy, CopyPlus, Ellipsis, Trash2, FileType, Globe, Link2, Omega, Replace, Square, Subscript, Superscript, Volume2, X,
} from 'lucide-react'
import { Menu, Tool } from '../ui'
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { Selection } from '@milkdown/kit/prose/state'
import { imageBlockSchema } from '@milkdown/kit/component/image-block'
import { insert, replaceAll } from '@milkdown/kit/utils'
import { HistoryDialog, keepVersion } from './History'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import {
  baseName, debounce, onPlace, goToPlace, isMobile, isShown, loadNote, loadNoteFile, noteLink, noteLinks, onClip, saveNoteFile, onFindInNotes, onQuote, openBookByName, parseNoteLink,
  parsePlaceLink, placeLink, saveFileAs, saveNote, shelf,
} from '../lib/platform'
import {
  FACES, INKS, MARKER_COLOURS, TEXT_COLOURS, TEXT_FACES, TEXT_SIZES, WRITING_SIZES, GAPS, TINTS, addLooks, changeLine, checklist, clearLooks, findNext, insertLine, keepLineInPlace, replaceFound, insertTable, looksAt, redo, setAlign, setBlock,
  setLook, setWriting, toggleLook, undo, useWriting,
  type Writing,
} from './writing'
import { canSpeak, useReadAloud } from '../lib/speech'
import { usePref } from '../lib/prefs'
import { compare as compareCfi } from 'foliate-js/epubcfi.js'

// Characters a keyboard does not have to hand.
const SYMBOLS = '→ ← ↔ ⇒ ≈ ≠ ≤ ≥ ± × ÷ √ ∞ ∑ ∆ π µ θ λ Ω ° ′ ″ ½ ¼ ¾ ² ³ € £ ¥ © § ¶ † • … — ✓ ✗ ★'.split(' ')

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
  const picker = useRef<HTMLInputElement>(null)
  // How many words are on the page, and which looks the words under the cursor have.
  const [words, setWords] = useState(0)
  const [, look] = useState(0)
  const editorRef = useRef<Crepe | null>(null)
  const writing = useWriting()
  const rule = Math.round(writing.size * writing.gap)
  const voice = useReadAloud()
  const [typewriter, setTypewriter] = usePref('typewriter', false)
  const typewriterNow = useRef(typewriter)
  typewriterNow.current = typewriter
  // Find and replace: its own strip under the bar while it is in use.
  const [finding, setFinding] = useState(false)
  const [wanted, setWanted] = useState('')
  const [swap, setSwap] = useState('')
  const [found, setFound] = useState('')
  const [boxes, setBoxes] = useState({ done: 0, all: 0 })
  // Keeping pace: as the book's pages turn, the note moves to what was written about that page.
  const [pace, setPace] = usePref('pace', false)
  useEffect(() => {
    if (!pace) return
    return onPlace(({ book, place, cfi }) => {
      if (baseName(book) !== notebook) return
      const page = place.match(/^page=(\d+)/)?.[1]
      const part = place.match(/^section=(\d+)/)?.[1]
      const links = [...(host.current?.querySelectorAll<HTMLAnchorElement>('a[href^="#sidepage-open"]') ?? [])]
        .map(link => ({ link, at: parsePlaceLink(link.getAttribute('href') ?? '')?.place ?? '' }))
      let first: HTMLAnchorElement | undefined
      if (page) first = links.find(({ at }) => at.match(/^page=(\d+)/)?.[1] === page)?.link
      else if (part) {
        // A book of flowing text: a quote's place names its part of the book (the step after "/6/") and the
        // exact spot in it. Of the quotes from this part, the one wanted is the last at or before where the
        // reader is; before any of them, the first.
        const inPart = links.filter(({ at }) => Number(at.match(/^epubcfi\(\/6\/(\d+)/)?.[1]) / 2 - 1 === Number(part))
        const order = (a: string, b: string) => { try { return compareCfi(a, b) as number } catch { return 0 } }
        inPart.sort((a, b) => order(a.at, b.at))
        first = (cfi ? inPart.filter(({ at }) => order(at, cfi) <= 0).pop() : undefined)?.link ?? inPart[0]?.link
      }
      const block = first?.closest('.ProseMirror > *') as HTMLElement | null | undefined
      if (!block) return
      block.scrollIntoView({ block: 'center', behavior: 'smooth' })
      block.animate([{ backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent)' }, { backgroundColor: 'transparent' }], { duration: 1600 })
    })
  }, [pace, notebook])

  // Sound: a lecture or your own voice recorded beside the note. While it records, each new line you start is
  // stamped with the moment it was written; tap a stamp later to hear what was being said just then.
  const [recording, setRecording] = useState<{ name: string; started: number; stop(): void } | null>(null)
  const recordingNow = useRef(recording)
  recordingNow.current = recording
  const [elapsed, setElapsed] = useState(0)
  const [player, setPlayer] = useState<{ url: string; at: number } | null>(null)
  const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds) % 60).padStart(2, '0')}`
  useEffect(() => {
    if (!recording) return
    const tick = setInterval(() => setElapsed((Date.now() - recording.started) / 1000), 500)
    return () => clearInterval(tick)
  }, [recording])
  // A stamp: a small link at the start of the line (or where the cursor is) that knows its moment.
  const stamp = (lineStart: boolean) => {
    const now = recordingNow.current
    if (!now) return
    const seconds = Math.max(0, Math.round((Date.now() - now.started) / 1000) - 2)
    editorRef.current?.editor.action(ctx => {
      const view = ctx.get(editorViewCtx)
      const { schema, selection } = view.state
      const link = schema.marks.link?.create({ href: `#sidepage-sound?file=${now.name}&t=${seconds}` })
      if (!link) return
      const at = lineStart ? selection.$from.start() : selection.from
      view.dispatch(view.state.tr.insert(at, [schema.text(`▸ ${clock(seconds)}`, [link]), schema.text(' ')]))
    })
  }
  const record = async () => {
    if (recording) return recording.stop()
    let stream: MediaStream
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }) } catch { setSoundNote('The microphone is not available to Sidepage on this device.'); return }
    const recorder = new MediaRecorder(stream)
    const name = `sound-${Date.now().toString(36)}.${recorder.mimeType.includes('mp4') ? 'm4a' : recorder.mimeType.includes('ogg') ? 'ogg' : 'webm'}`
    const parts: Blob[] = []
    recorder.ondataavailable = e => { if (e.data.size) parts.push(e.data) }
    recorder.onstop = () => {
      stream.getTracks().forEach(track => track.stop())
      void saveNoteFile(notebook, name, new Blob(parts, { type: recorder.mimeType }))
      setRecording(null)
    }
    recorder.start(1000)
    setElapsed(0)
    setSoundNote('')
    const mine = { name, started: Date.now(), stop: () => recorder.stop() }
    recordingNow.current = mine
    setRecording(mine)
    stamp(false)
  }
  const [soundNote, setSoundNote] = useState('')
  const [history, setHistory] = useState<string | null>(null)
  const openHistory = () => setHistory(editorRef.current?.getMarkdown() ?? '')
  const play = async (name: string, at: number) => {
    const sound = await loadNoteFile(notebook, name)
    if (!sound) return setSoundNote('That recording is not in this notebook any more.')
    setPlayer(old => { if (old) URL.revokeObjectURL(old.url); return { url: URL.createObjectURL(sound), at } })
  }
  const playNow = useRef(play)
  playNow.current = play
  const stampNow = useRef(stamp)
  stampNow.current = stamp
  // Other books to link to, and the books whose notes link here.
  const [others, setOthers] = useState<string[]>([])
  // Typing [[ starts a link to another book's notes: a list of books opens at the cursor and narrows as you type.
  const [linking, setLinking] = useState<{ query: string; from: number; to: number; x: number; y: number; at: number } | null>(null)
  const linkingNow = useRef(linking)
  linkingNow.current = linking
  const othersNow = useRef(others)
  othersNow.current = others
  const linkChoices = (query: string) => othersNow.current.filter(name => baseName(name).toLowerCase().includes(query.toLowerCase())).slice(0, 8)
  const watchForLink = (editor: Crepe) => editor.editor.action(ctx => {
    const view = ctx.get(editorViewCtx)
    // The editor tells of a selection once while it is still being made, before it has a view.
    if (!view.state) return
    const { $from, empty } = view.state.selection
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
    const typed = empty ? before.match(/\[\[([^\]\n]{0,40})$/) : null
    if (!typed) return setLinking(null)
    const spot = view.coordsAtPos($from.pos)
    setLinking(old => ({ query: typed[1], from: $from.pos - typed[0].length, to: $from.pos, x: spot.left, y: spot.bottom, at: old?.query === typed[1] ? old.at : 0 }))
  })
  const placeLinkTo = (name: string) => {
    const open = linkingNow.current
    if (!open) return
    editorRef.current?.editor.action(ctx => {
      const view = ctx.get(editorViewCtx)
      const mark = view.state.schema.marks.link?.create({ href: noteLink(name) })
      if (!mark) return
      // The [[ and what follows it, as they stand now (the list may lag a keystroke behind).
      const { $from } = view.state.selection
      const typed = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼').match(/\[\[([^\]\n]{0,40})$/)
      const [from, to] = typed ? [$from.pos - typed[0].length, $from.pos] : [open.from, open.to]
      view.dispatch(view.state.tr.replaceWith(from, to, [view.state.schema.text(baseName(name), [mark]), view.state.schema.text(' ')]).scrollIntoView())
      view.focus()
    })
    setLinking(null)
  }
  const placeLinkNow = useRef(placeLinkTo)
  placeLinkNow.current = placeLinkTo
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
    const save = debounce((markdown: string) => {
      void saveNote(notebook, 'notes.md', markdown)
      // Every ten minutes or so of writing, the note as it stands is kept as an earlier version.
      void keepVersion(notebook, markdown)
    }, 500)
    loadNote(notebook, 'notes.md').then(async saved => {
      // …and the note as it was found, before anything is changed in this sitting.
      if (saved) void keepVersion(notebook, saved, true)
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
      // While the list of books is open, the arrow keys and Enter belong to it.
      host.current?.addEventListener('keydown', e => {
        const open = linkingNow.current
        if (!open) return
        const choices = linkChoices(open.query)
        if (e.key === 'Escape') { e.preventDefault(); setLinking(null) }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setLinking({ ...open, at: Math.max(0, Math.min(choices.length - 1, open.at + (e.key === 'ArrowDown' ? 1 : -1))) }) }
        else if ((e.key === 'Enter' || e.key === 'Tab') && choices.length) { e.preventDefault(); e.stopPropagation(); placeLinkNow.current(choices[open.at] ?? choices[0]) }
      }, true)
      const count = debounce(() => {
        setWords(host.current?.querySelector<HTMLElement>('.ProseMirror')?.innerText.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0)
        setBoxes(checklist(editor))
      }, 400)
      editor.on(listener => listener
        .markdownUpdated((_, markdown) => {
          save(markdown)
          count()
          // While sound is recording, the first letter of a new line stamps that line with its moment.
          if (!recordingNow.current) return
          const line = editor.editor.action(ctx => ctx.get(editorViewCtx).state.selection.$from.parent)
          if (line.type.name === 'paragraph' && line.textContent.length === 1) setTimeout(() => stampNow.current(true), 0)
        })
        .selectionUpdated(() => {
          look(n => n + 1)
          watchForLink(editor)
          if (typewriterNow.current && host.current) keepLineInPlace(editor, host.current)
        }))
      await editor.create()
      if (cancelled) return void editor.destroy()
      crepe = editor
      editorRef.current = editor
      setReady(true)
      count()
      stopQuotes = onQuote(({ text, source, book, place, table }) => {
        // Each book's quotes go to its own notebook.
        if (book && baseName(book) !== notebook) return
        const quoted = table ? text : text.split(/\n+/).map(line => `> ${line}`).join('\n')
        // The source line links back to the exact place in the book.
        const credit = book && place ? `[${source}](${placeLink({ book, place })})` : `*${source}*`
        // Quotes are added at the end of the page, like the next line in a notebook.
        editor.editor.action(ctx => {
          const view = ctx.get(editorViewCtx)
          view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)))
        })
        editor.editor.action(insert(table ? `\n${quoted}\n\n— ${credit}\n\n` : `\n${quoted}\n>\n> — ${credit}\n\n`))
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
      const sound = href.match(/^#sidepage-sound\?file=(sound-[\w.-]+)&t=(\d+)/)
      if (sound) { e.preventDefault(); e.stopPropagation(); return void playNow.current(sound[1], Number(sound[2])) }
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
  const has = looksAt(editorRef.current)
  const AlignIcon = { left: AlignLeft, center: AlignCenter, right: AlignRight, justify: AlignJustify }[has.align ?? 'left'] ?? AlignLeft
  // Plain words, typed where the cursor is.
  const type = (text: string) => editorRef.current?.editor.action(ctx => {
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.insertText(text).scrollIntoView())
    view.focus()
  })
  const put = (markdown: string, inline = false) => editorRef.current?.editor.action(insert(markdown, inline))
  // A link to wherever the book is open just now: tap it later to come back to this page.
  const linkToPage = async () => {
    const book = (await shelf()).map(entry => entry.name).find(name => baseName(name) === notebook)
    const where = book && localStorage.getItem(`sidepage:place:${book}`)
    if (!book || !where) return put('*Open the book to a page first, then link to it.*')
    const page = /^\d+$/.test(where)
    put(`[${page ? `${notebook}, p. ${where}` : `${notebook}, where I was reading`}](${placeLink({ book, place: page ? `page=${where}` : where })})`, true)
  }
  // Read the note aloud, once through.
  const readAloud = () => {
    if (voice.speaking) return voice.stop()
    let told = false
    void voice.start(async () => (told ? null : (told = true, host.current?.querySelector<HTMLElement>('.ProseMirror')?.innerText ?? '')))
  }
  // The note as a document other programs open: a Word file, or a web page. Pictures go inside it.
  const saveAs = async (kind: 'doc' | 'html') => {
    const page = host.current?.querySelector('.ProseMirror')?.cloneNode(true) as HTMLElement | undefined
    if (!page) return
    page.querySelectorAll('.ProseMirror-widget, [data-decoration], button, input').forEach(extra => extra.remove())
    for (const picture of page.querySelectorAll('img')) {
      try {
        const blob = await (await fetch(picture.src)).blob()
        picture.src = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(blob) })
      } catch { /* a picture that cannot be read stays as its link */ }
    }
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${notebook}</title><style>
      body { font: 12pt/1.6 ${FACES[writing.face].css}; color: #111; max-width: 46em; margin: 2em auto; padding: 0 1.2em; }
      h1, h2, h3 { line-height: 1.25; } img { max-width: 100%; } a { color: inherit; }
      blockquote { margin: 1em 0; padding-left: 1em; border-left: 3px solid #bbb; color: #333; }
      table { border-collapse: collapse; } td, th { border: 1px solid #999; padding: 4px 8px; }
    </style></head><body>${page.innerHTML}</body></html>`
    await saveFileAs(`${notebook} notes.${kind}`, new TextEncoder().encode(html))
  }
  const seek = () => { const spot = findNext(crepe(), wanted); setFound(spot.of ? `${spot.at} of ${spot.of}` : wanted ? 'Not in this note' : '') }

  // A picture chosen from the device is kept in the notebook and set where the cursor is.
  const addPicture = async (picture: File) => {
    const name = `picture-${Date.now().toString(36)}.${picture.name.split('.').pop() || 'png'}`
    await saveNoteFile(notebook, name, picture)
    editorRef.current?.editor.action(ctx => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.replaceSelectionWith(imageBlockSchema.type(ctx).create({ src: name })).scrollIntoView())
    })
  }

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
      data-tint={writing.tint}
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
          <label className="menu-row">Lines
            <select value={writing.gap} onChange={e => setWriting({ gap: Number(e.target.value) })}>
              {Object.entries(GAPS).map(([name, gap]) => <option key={name} value={gap}>{name}</option>)}
            </select>
          </label>
          <label className="menu-row">Paper
            <select value={writing.tint} onChange={e => setWriting({ tint: e.target.value as Writing['tint'] })}>
              {Object.entries(TINTS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <p className="menu-note">The lines of the paper follow the size you choose.</p>
        </Menu>
        <Tool quiet icon={Undo2} label="Undo" onClick={() => undo(crepe())} />
        <Tool quiet icon={Redo2} label="Redo" onClick={() => redo(crepe())} />
        <span className="divider" />
        <Menu quiet icon={Pilcrow} label="Kind of line" hint="Make this line a heading, a list or a quote">
          <Tool icon={Pilcrow} label="Plain text" onClick={() => setBlock(crepe(), 'text')} />
          <Tool icon={Heading1} label="Large heading" onClick={() => setBlock(crepe(), 'h1')} />
          <Tool icon={Heading2} label="Heading" onClick={() => setBlock(crepe(), 'h2')} />
          <Tool icon={Heading3} label="Small heading" onClick={() => setBlock(crepe(), 'h3')} />
          <Tool icon={List} label="Bullet list" onClick={() => setBlock(crepe(), 'bullets')} />
          <Tool icon={ListOrdered} label="Numbered list" onClick={() => setBlock(crepe(), 'numbers')} />
          <Tool icon={ListChecks} label="Checklist" onClick={() => setBlock(crepe(), 'checklist')} />
          <Tool icon={Quote} label="Quote" onClick={() => setBlock(crepe(), 'quote')} />
          <p className="menu-head">This line</p>
          <div className="menu-line">
            <button className="tool stay" title="Move up" aria-label="Move the line up" onClick={() => changeLine(crepe(), 'up')}><ArrowUp size={18} aria-hidden /></button>
            <button className="tool stay" title="Move down" aria-label="Move the line down" onClick={() => changeLine(crepe(), 'down')}><ArrowDown size={18} aria-hidden /></button>
            <button className="tool stay" title="Make a copy under it" aria-label="Copy the line" onClick={() => changeLine(crepe(), 'copy')}><CopyPlus size={18} aria-hidden /></button>
            <button className="tool stay" title="Remove" aria-label="Remove the line" onClick={() => changeLine(crepe(), 'remove')}><Trash2 size={18} aria-hidden /></button>
          </div>
        </Menu>
        <Tool quiet icon={Bold} label="Bold" on={has.strong} onClick={() => toggleLook(crepe(), 'strong')} />
        <Tool quiet icon={Italic} label="Italic" on={has.emphasis} onClick={() => toggleLook(crepe(), 'emphasis')} />
        <Tool quiet icon={Underline} label="Underline" on={has.underline} onClick={() => toggleLook(crepe(), 'underline')} />
        <Tool quiet icon={Strikethrough} label="Strike through" on={has.strike_through} onClick={() => toggleLook(crepe(), 'strike_through')} />
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
          <div className="menu-line">
            <Tool icon={Superscript} label="Raised" on={has.sup} onClick={() => toggleLook(crepe(), 'sup')} />
            <Tool icon={Subscript} label="Lowered" on={has.sub} onClick={() => toggleLook(crepe(), 'sub')} />
          </div>
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
        <Menu quiet icon={AlignIcon} label="Alignment" hint="Which side the paragraph leans to">
          <Tool icon={AlignLeft} label="Left" onClick={() => setAlign(crepe(), 'left')} />
          <Tool icon={AlignCenter} label="Centre" onClick={() => setAlign(crepe(), 'center')} />
          <Tool icon={AlignRight} label="Right" onClick={() => setAlign(crepe(), 'right')} />
          <Tool icon={AlignJustify} label="Fill the line" onClick={() => setAlign(crepe(), 'justify')} />
        </Menu>
        <Tool quiet icon={RemoveFormatting} label="Plain writing" hint="Take the colour, size and other looks off the selected words" onClick={() => clearLooks(crepe())} />
        <span className="divider" />
        <Menu quiet icon={Plus} label="Insert" hint="Put a picture, a table, a layout or a link into the note">
          <Tool icon={ImagePlus} label="Picture" onClick={() => picker.current?.click()} />
          <Tool icon={Table} label="Table" onClick={() => insertTable(crepe())} />
          <Tool icon={Minus} label="Dividing line" onClick={() => insertLine(crepe())} />
          <Tool icon={CalendarDays} label="Today's date" onClick={() => type(new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))} />
          <Tool icon={Link2} label="Link to this page of the book" hint="A link back to where the book is open now" onClick={() => void linkToPage()} />
          <p className="menu-head"><Omega size={12} aria-hidden /> Symbols</p>
          <div className="symbols">{SYMBOLS.map(symbol => <button key={symbol} onClick={() => type(symbol)}>{symbol}</button>)}</div>
          <p className="menu-head">Layouts</p>
          {Object.keys(TEMPLATES).map(name => (
            <button key={name} className="menu-item" onClick={() => put(TEMPLATES[name as keyof typeof TEMPLATES])}>{name}</button>
          ))}
          {others.length > 0 && <p className="menu-head">Link to another book's notes</p>}
          <div className="menu-scroll">
            {others.map(name => (
              <button key={name} className="menu-item" onClick={() => put(`[${baseName(name)}](${noteLink(name)})`, true)}>{baseName(name)}</button>
            ))}
          </div>
        </Menu>
        <input
          ref={picker} type="file" accept="image/*" hidden
          onChange={e => { const picture = e.target.files?.[0]; e.target.value = ''; if (picture) void addPicture(picture) }}
        />
        <Tool quiet icon={Replace} label="Find and replace" on={finding} onClick={() => setFinding(!finding)} />
        <Menu quiet icon={Ellipsis} label="More for this note">
          {canSpeak && <Tool icon={voice.speaking ? Square : Volume2} label={voice.speaking ? 'Stop reading' : 'Read this note aloud'} onClick={readAloud} />}
          <Tool icon={Mic} label={recording ? 'Stop recording sound' : 'Record sound with this note'} hint="Record a lecture or yourself; lines you write meanwhile are stamped with their moment" on={!!recording} onClick={() => void record()} />
          <Tool icon={Footprints} label={pace ? 'Keep pace with the book: on' : 'Keep pace with the book'} hint="As you turn the pages of the book, show what you quoted or clipped from there" on={pace} onClick={() => setPace(!pace)} />
          <Tool icon={AlignVerticalJustifyCenter} label={typewriter ? 'Typewriter writing: on' : 'Typewriter writing'} hint="Keep the line you are writing at the same height" on={typewriter} onClick={() => setTypewriter(!typewriter)} />
          <Tool icon={HistoryIcon} label="Earlier versions" hint="See how the note looked before, and bring a version back" onClick={openHistory} />
          <Tool icon={ClipboardCopy} label="Copy the whole note" onClick={() => void navigator.clipboard?.writeText(host.current?.querySelector<HTMLElement>('.ProseMirror')?.innerText ?? '')} />
          <Tool icon={FileType} label="Save as a Word document" onClick={() => void saveAs('doc')} />
          <Tool icon={Globe} label="Save as a web page" onClick={() => void saveAs('html')} />
          {!isMobile && <Tool icon={Printer} label="Print this note" onClick={print} />}
        </Menu>
        {boxes.all > 0 && <span className="viewer-pos" title="Checklist boxes ticked">{boxes.done} of {boxes.all} done</span>}
        {words > 0 && <span className="viewer-pos" title="Words on this page">{words.toLocaleString()} {words === 1 ? 'word' : 'words'}</span>}
        {backlinks.length > 0 && <span className="viewer-pos">Linked from</span>}
        {backlinks.map(name => <button key={name} onClick={() => openBookByName(name)}>{baseName(name)}</button>)}
      </div>
      {(recording || player || soundNote) && (
        <div className="find-strip" onMouseDown={e => { if (!(e.target as HTMLElement).closest('audio')) e.preventDefault() }}>
          {recording && <>
            <span className="rec-dot" aria-hidden />
            <span className="viewer-pos">Recording {clock(elapsed)}</span>
            <button onClick={() => stamp(false)}>Mark this moment</button>
            <button onClick={() => recording.stop()}>Stop</button>
          </>}
          {player && !recording && <>
            <audio
              key={player.url + player.at} src={player.url} controls autoPlay
              onLoadedMetadata={e => { e.currentTarget.currentTime = player.at }}
            />
            <Tool quiet icon={X} label="Close the player" onClick={() => setPlayer(null)} />
          </>}
          {soundNote && <span className="viewer-pos">{soundNote}</span>}
        </div>
      )}
      {history !== null && (
        <HistoryDialog
          notebook={notebook} current={history} onClose={() => setHistory(null)}
          onRestore={text => {
            // The note as it is now is kept first, so bringing back an old version can itself be undone.
            void keepVersion(notebook, history, true)
            editorRef.current?.editor.action(replaceAll(text, true))
            // A note put back whole is not an edit the editor reports, so it is saved here.
            void saveNote(notebook, 'notes.md', text)
          }}
        />
      )}
      {linking && (
        <div className="link-picker" style={{ left: Math.min(linking.x, window.innerWidth - 270), top: linking.y + 6 }} onMouseDown={e => e.preventDefault()}>
          <p className="menu-head">Link to the notes of</p>
          {linkChoices(linking.query).map((name, i) => (
            <button key={name} className={i === linking.at ? 'palette-item on' : 'palette-item'} onClick={() => placeLinkTo(name)}>{baseName(name)}</button>
          ))}
          {!linkChoices(linking.query).length && <p className="menu-note">No book by that name.</p>}
        </div>
      )}
      {finding && (
        <div className="find-strip" onMouseDown={e => { if (!(e.target as HTMLElement).closest('input')) e.preventDefault() }}>
          <input autoFocus value={wanted} placeholder="Find in this note" onChange={e => { setWanted(e.target.value); setFound('') }} onKeyDown={e => { if (e.key === 'Enter') seek(); if (e.key === 'Escape') setFinding(false) }} />
          <input value={swap} placeholder="Replace with" onChange={e => setSwap(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setFinding(false) }} />
          <button onClick={seek}>Next</button>
          <button onClick={() => { replaceFound(crepe(), wanted, swap, false); seek() }}>Replace</button>
          <button onClick={() => { const changed = replaceFound(crepe(), wanted, swap, true); setFound(changed ? `${changed} replaced` : 'Not in this note') }}>Replace all</button>
          <span className="viewer-pos">{found}</span>
          <span className="spacer" />
          <Tool quiet icon={X} label="Close find and replace" onClick={() => setFinding(false)} />
        </div>
      )}
      <div ref={host} className="written-note paper" />
      <div ref={probe} className="rule-probe" aria-hidden><i />x<br />x</div>
    </div>
  )
}
