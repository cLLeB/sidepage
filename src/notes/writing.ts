import { useSyncExternalStore } from 'react'
import type { Crepe } from '@milkdown/crepe'
import { commandsCtx, editorViewCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import { redoCommand, undoCommand } from '@milkdown/kit/plugin/history'
import {
  headingSchema, insertHrCommand, paragraphSchema, turnIntoTextCommand, wrapInBlockquoteCommand, wrapInBulletListCommand, wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark'
import { insertTableCommand } from '@milkdown/kit/preset/gfm'
import { toggleMark } from '@milkdown/kit/prose/commands'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, Selection, TextSelection } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $markSchema, $prose, $remark } from '@milkdown/kit/utils'

// How the writing in a note looks: its colour, marker, size, typeface, underline and which side it leans to.
// Markdown has no words for these, so they are kept the way Markdown allows: as small pieces of HTML inside
// the note (`<span style="color:#e5484d">…</span>`, `<u>…</u>`, `<div align="center">` round a paragraph).
// The note stays a plain text file that other Markdown apps can read.

// ── The whole note: typeface, size and ink, remembered on this device ──
export const FACES = {
  sans: { name: 'Plain', css: "system-ui, 'Segoe UI', Roboto, sans-serif" },
  serif: { name: 'Book', css: "Georgia, 'Times New Roman', serif" },
  hand: { name: 'Handwriting', css: "'Sidepage Hand', 'Segoe Print', 'Bradley Hand', cursive" },
  mono: { name: 'Typewriter', css: "'Courier New', ui-monospace, monospace" },
} as const
export const WRITING_SIZES = { Small: 14, Medium: 16, Large: 18, Larger: 21, Largest: 24 } as const
export const INKS = { pencil: 'Pencil', blue: 'Blue ink', black: 'Black ink', green: 'Green ink', red: 'Red ink' } as const
export const GAPS = { Narrow: 1.7, Normal: 2, Wide: 2.5 } as const
export const TINTS = { paper: 'The theme\'s own', white: 'White', cream: 'Cream', yellow: 'Legal yellow', blue: 'Pale blue', green: 'Pale green', pink: 'Pale pink' } as const
export type Writing = { face: keyof typeof FACES; size: number; ink: keyof typeof INKS; gap: number; tint: keyof typeof TINTS }

const DEFAULT_WRITING: Writing = { face: 'sans', size: 16, ink: 'pencil', gap: 2, tint: 'paper' }
let writing: Writing = { ...DEFAULT_WRITING, ...JSON.parse(localStorage.getItem('sidepage:writing') ?? '{}') }
const listeners = new Set<() => void>()
export function setWriting(change: Partial<Writing>) {
  writing = { ...writing, ...change }
  localStorage.setItem('sidepage:writing', JSON.stringify(writing))
  listeners.forEach(listener => listener())
}
export const useWriting = () => useSyncExternalStore(
  listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
  () => writing,
)

// ── A passage: colour, marker, size, typeface, underline ──
export const TEXT_COLOURS = { Red: '#e5484d', Orange: '#f08c00', Green: '#2f9e44', Blue: '#3b82f6', Grey: '#868e96' } as const
export const MARKER_COLOURS = { Yellow: '#ffd84d', Green: '#8fe3a0', Blue: '#8ecbff', Pink: '#ffa8c7' } as const
export const TEXT_SIZES = { Small: '0.8em', Large: '1.25em', Huge: '1.5em' } as const
export const TEXT_FACES = { Plain: 'sans-serif', Book: 'serif', Handwriting: 'cursive', Typewriter: 'monospace' } as const

// Each look, the CSS it stands for, and what it may be set to (a note is a file anyone could have edited).
const LOOKS = {
  ink: { css: 'color', allowed: /^#[0-9a-f]{3,8}$/i },
  marker: { css: 'background-color', allowed: /^#[0-9a-f]{3,8}$/i },
  size: { css: 'font-size', allowed: /^\d(\.\d{1,2})?em$/ },
  face: { css: 'font-family', allowed: /^(sans-serif|serif|cursive|monospace)$/ },
} as const
type Look = keyof typeof LOOKS
// Looks that are a plain tag round the words rather than a style.
const TAGS = { underline: 'u', sup: 'sup', sub: 'sub' } as const
type Tagged = keyof typeof TAGS
const TAG_NAMES = Object.keys(TAGS) as Tagged[]
const isTagged = (kind: string | undefined): kind is Tagged => !!kind && kind in TAGS
const LOOK_NAMES = Object.keys(LOOKS) as Look[]

type Mdast = { type: string; value?: string; children?: Mdast[]; kind?: string; look?: string; align?: string }

const styledSpan = /^<span style="([^"<>]*)">$/
// The looks an opening tag asks for, outermost first; nothing if it is not one of ours.
function looksOf(tag: string): { kind: string; look: string }[] | null {
  const tagged = TAG_NAMES.find(name => tag === `<${TAGS[name]}>`)
  if (tagged) return [{ kind: tagged, look: '' }]
  const style = styledSpan.exec(tag)?.[1]
  if (!style) return null
  const found: { kind: string; look: string }[] = []
  for (const part of style.split(';')) {
    const [property, value] = part.split(':').map(piece => piece.trim())
    const kind = LOOK_NAMES.find(name => LOOKS[name].css === property)
    if (kind && LOOKS[kind].allowed.test(value ?? '')) found.push({ kind, look: value })
  }
  return found.length ? found : null
}

const ALIGNED = /^<div align="(left|center|right|justify)">$/
// Markdown reads our HTML as loose tags among the text. Pair them up again, so a tag and its closing tag
// become one piece of styled text, and a `<div align>` becomes the alignment of the paragraphs inside it.
function readLooks(node: Mdast) {
  if (!node.children) return
  node.children.forEach(readLooks)
  const out: Mdast[] = []
  const open: { at: number; close: string; looks: { kind: string; look: string }[] }[] = []
  let align: string | undefined
  // Alignment is a matter between blocks; inside a line of text a stray <div> is left as it is.
  const blocks = node.type !== 'paragraph' && node.type !== 'heading'
  for (const child of node.children) {
    const lone = child.type === 'paragraph' && child.children?.length === 1 && child.children[0].type === 'html' ? child.children[0] : child
    const tag = lone.type === 'html' ? (lone.value ?? '').trim() : ''
    const aligned = blocks && ALIGNED.exec(tag)?.[1]
    if (aligned) { align = aligned; continue }
    if (align && tag === '</div>') { align = undefined; continue }
    const looks = child.type === 'html' ? looksOf(tag) : null
    if (looks) {
      open.push({ at: out.length, close: isTagged(looks[0].kind) ? `</${TAGS[looks[0].kind]}>` : '</span>', looks })
      out.push(child)
      continue
    }
    if (child.type === 'html' && open.length && open[open.length - 1].close === tag) {
      const { at, looks: wanted } = open.pop()!
      let inside = out.splice(at).slice(1)
      for (const { kind, look } of [...wanted].reverse()) inside = [{ type: 'textStyle', kind, look, children: inside }]
      out.push(...inside)
      continue
    }
    if (align && (child.type === 'paragraph' || child.type === 'heading')) child.align = align
    out.push(child)
  }
  node.children = out
}
const remarkLooks = $remark('sidepageLooks', () => () => (tree: unknown) => { readLooks(tree as Mdast) })

// One kind of mark for each look, so that a colour, a size and a marker can lie over the same words.
const lookMark = (kind: Look | Tagged) => $markSchema(kind, () => ({
  attrs: { look: { default: '' } },
  parseDOM: isTagged(kind)
    ? [{ tag: TAGS[kind] }]
    : [{ tag: `span[data-${kind}]`, getAttrs: dom => ({ look: (dom as HTMLElement).getAttribute(`data-${kind}`) ?? '' }) }],
  toDOM: mark => isTagged(kind)
    ? [TAGS[kind], 0]
    : ['span', { [`data-${kind}`]: mark.attrs.look, style: kind === 'face' ? undefined : `${LOOKS[kind].css}:${mark.attrs.look}` }, 0],
  parseMarkdown: {
    match: node => node.type === 'textStyle' && node.kind === kind,
    runner: (state, node, type) => {
      state.openMark(type, { look: node.look })
      state.next(node.children)
      state.closeMark(type)
    },
  },
  toMarkdown: {
    match: mark => mark.type.name === kind,
    runner: (state, mark) => { state.withMark(mark, 'textStyle', undefined, { kind, look: mark.attrs.look }) },
  },
}))
const marks = [...LOOK_NAMES, ...TAG_NAMES].map(lookMark)

// Writing a piece of styled text back into the note.
type Stringify = {
  enter(name: string): () => void
  createTracker(info: unknown): { move(text: string): string; current(): object }
  containerPhrasing(node: Mdast, info: object): string
}
const writeLook = Object.assign((node: Mdast, _parent: unknown, state: Stringify, info: unknown) => {
  const [before, after] = isTagged(node.kind)
    ? [`<${TAGS[node.kind]}>`, `</${TAGS[node.kind]}>`]
    : [`<span style="${LOOKS[node.kind as Look].css}:${node.look}">`, '</span>']
  const exit = state.enter('textStyle')
  const tracker = state.createTracker(info)
  let text = tracker.move(before)
  text += tracker.move(state.containerPhrasing(node, { before: '>', after: '<', ...tracker.current() }))
  text += tracker.move(after)
  exit()
  return text
}, { peek: () => '<' })

// Paragraphs and headings can lean left, centre, right, or fill the line.
const withAlign = (style: unknown, node: ProseNode) => {
  const spec = style as [string, Record<string, unknown>, 0]
  return node.attrs.align ? [spec[0], { ...spec[1], style: `text-align:${node.attrs.align}` }, 0] as const : spec
}
const alignOf = (dom: HTMLElement) => /^(left|center|right|justify)$/.test(dom.style.textAlign) ? dom.style.textAlign : null
const alignedParagraph = paragraphSchema.extendSchema(prev => ctx => {
  const base = prev(ctx)
  return {
    ...base,
    attrs: { ...base.attrs, align: { default: null } },
    parseDOM: [{ tag: 'p', getAttrs: dom => ({ align: alignOf(dom as HTMLElement) }) }],
    toDOM: node => withAlign(base.toDOM!(node), node) as ReturnType<NonNullable<typeof base.toDOM>>,
    parseMarkdown: {
      match: base.parseMarkdown.match,
      runner: (state, node, type) => {
        state.openNode(type, { align: node.align ?? null })
        if (node.children) state.next(node.children)
        else state.addText((node.value || '') as string)
        state.closeNode()
      },
    },
    toMarkdown: { match: base.toMarkdown.match, runner: (state, node) => writeAligned(state, node, base.toMarkdown.runner) },
  }
})
const alignedHeading = headingSchema.extendSchema(prev => ctx => {
  const base = prev(ctx)
  return {
    ...base,
    attrs: { ...base.attrs, align: { default: null } },
    parseDOM: [1, 2, 3, 4, 5, 6].map(level => ({
      tag: `h${level}`,
      getAttrs: (dom: HTMLElement) => ({ level, id: dom.id, align: alignOf(dom) }),
    })),
    toDOM: node => withAlign(base.toDOM!(node), node) as ReturnType<NonNullable<typeof base.toDOM>>,
    parseMarkdown: {
      match: base.parseMarkdown.match,
      runner: (state, node, type) => {
        state.openNode(type, { level: node.depth as number, align: node.align ?? null })
        state.next(node.children)
        state.closeNode()
      },
    },
    toMarkdown: { match: base.toMarkdown.match, runner: (state, node) => writeAligned(state, node, base.toMarkdown.runner) },
  }
})
function writeAligned<S extends { addNode(type: string, children?: undefined, value?: string): unknown }>(state: S, node: ProseNode, plain: (state: S, node: ProseNode) => void) {
  const align = node.attrs.align as string | null
  if (align) state.addNode('html', undefined, `<div align="${align}">`)
  plain(state, node)
  if (align) state.addNode('html', undefined, '</div>')
}

// Pictures, tables and the like are as tall as they happen to be, which would leave every line after them
// off the rules. Each is given just enough room underneath to end on a rule again.
const fitKey = new PluginKey<DecorationSet>('sidepageFitRules')
const fitRules = $prose(() => new Plugin<DecorationSet>({
  key: fitKey,
  state: {
    init: () => DecorationSet.empty,
    apply: (tr, old) => tr.getMeta(fitKey) ?? old.map(tr.mapping, tr.doc),
  },
  props: { decorations: state => fitKey.getState(state) },
  view: view => {
    const given = new WeakMap<Element, number>()
    let waiting = 0
    const fit = () => {
      waiting = 0
      if (!view.dom.isConnected || !view.dom.clientWidth) return
      const step = parseFloat(getComputedStyle(view.dom).getPropertyValue('--step'))
      if (!step) return
      const blocks: { from: number; to: number; dom: HTMLElement }[] = []
      view.state.doc.forEach((node, from) => {
        const dom = view.nodeDOM(from)
        // Rows of writing are whole rules tall by their nature; it is the other things that need fitting.
        if (dom instanceof HTMLElement && node.type.name !== 'paragraph' && node.type.name !== 'heading') blocks.push({ from, to: from + node.nodeSize, dom })
      })
      const room: Decoration[] = []
      let changed = false
      blocks.forEach(({ from, to, dom }) => {
        const before = given.get(dom) ?? 0
        const tall = dom.getBoundingClientRect().height
        const over = tall % step
        const gap = over < 0.75 || step - over < 0.75 ? 0 : Math.round((step - over) * 10) / 10
        if (Math.abs(gap - before) > 0.05) changed = true
        given.set(dom, gap)
        if (gap) room.push(Decoration.node(from, to, { style: `margin-bottom:${gap}px` }))
      })
      if (changed) view.dispatch(view.state.tr.setMeta(fitKey, DecorationSet.create(view.state.doc, room)).setMeta('addToHistory', false))
    }
    const soon = () => { if (!waiting) waiting = requestAnimationFrame(fit) }
    // Pictures arrive late and panels change width: both change how tall things are.
    const watch = new ResizeObserver(soon)
    watch.observe(view.dom)
    return { update: soon, destroy: () => { cancelAnimationFrame(waiting); watch.disconnect() } }
  },
}))

// Everything above, added to an editor before it is created.
export function addLooks(crepe: Crepe) {
  crepe.editor
    .config(ctx => {
      ctx.update(remarkStringifyOptionsCtx, options => ({
        ...options,
        handlers: { ...options.handlers, textStyle: writeLook } as typeof options.handlers,
      }))
    })
    .use(remarkLooks)
    .use(marks.flat())
    .use(alignedParagraph)
    .use(alignedHeading)
    .use(fitRules)
}

// ── What the buttons do ──
const withView = (crepe: Crepe | null, act: (view: EditorView) => void) => crepe?.editor.action(ctx => {
  const view = ctx.get(editorViewCtx)
  act(view)
  view.focus()
})

// Bold, italic, struck through, underlined: on if it was off, off if it was on.
export const toggleLook = (crepe: Crepe | null, name: 'strong' | 'emphasis' | 'strike_through' | Tagged) => withView(crepe, view => {
  const type = view.state.schema.marks[name]
  if (type) toggleMark(type)(view.state, view.dispatch)
})

// Give the selected words a look, or take it away (null). With nothing selected, it is for what is typed next.
export const setLook = (crepe: Crepe | null, kind: Look, look: string | null) => withView(crepe, view => {
  const type = view.state.schema.marks[kind]
  const { from, to, empty } = view.state.selection
  let tr = view.state.tr
  if (empty) tr = look ? tr.addStoredMark(type.create({ look })) : tr.removeStoredMark(type)
  else {
    tr = tr.removeMark(from, to, type)
    if (look) tr = tr.addMark(from, to, type.create({ look }))
  }
  view.dispatch(tr)
})

// Lean the paragraphs and headings touched by the selection to one side.
export const setAlign = (crepe: Crepe | null, align: 'left' | 'center' | 'right' | 'justify') => withView(crepe, view => {
  const { from, to } = view.state.selection
  let tr = view.state.tr
  view.state.doc.nodesBetween(from, to, (node, at) => {
    if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return
    tr = tr.setNodeMarkup(at, undefined, { ...node.attrs, align: align === 'left' ? null : align })
  })
  view.dispatch(tr)
})

// Back to plain writing: every look taken off the selected words.
export const clearLooks = (crepe: Crepe | null) => withView(crepe, view => {
  const { from, to, empty } = view.state.selection
  if (empty) return
  let tr = view.state.tr
  for (const name of [...LOOK_NAMES, ...TAG_NAMES, 'strong', 'emphasis', 'strike_through']) {
    const type = view.state.schema.marks[name]
    if (type) tr = tr.removeMark(from, to, type)
  }
  view.dispatch(tr)
})

// What kind of block the line is: plain text, a heading, a list, a quote.
export type BlockStyle = 'text' | 'h1' | 'h2' | 'h3' | 'bullets' | 'numbers' | 'checklist' | 'quote'
export const setBlock = (crepe: Crepe | null, style: BlockStyle) => crepe?.editor.action(ctx => {
  const commands = ctx.get(commandsCtx)
  const view = ctx.get(editorViewCtx)
  if (style === 'text') commands.call(turnIntoTextCommand.key)
  else if (style === 'bullets' || style === 'checklist') commands.call(wrapInBulletListCommand.key)
  else if (style === 'numbers') commands.call(wrapInOrderedListCommand.key)
  else if (style === 'quote') commands.call(wrapInBlockquoteCommand.key)
  else commands.call(wrapInHeadingCommand.key, Number(style[1]))
  if (style === 'checklist') {
    // A checklist is a bullet list whose items carry a box: ticked, or not yet.
    const { from, to } = view.state.selection
    let tr = view.state.tr
    view.state.doc.nodesBetween(from, to, (node, at) => {
      if (node.type.name === 'list_item') tr = tr.setNodeMarkup(at, undefined, { ...node.attrs, checked: node.attrs.checked == null ? false : null })
    })
    view.dispatch(tr)
  }
  view.focus()
})

export const undo = (crepe: Crepe | null) => crepe?.editor.action(ctx => { ctx.get(commandsCtx).call(undoCommand.key); ctx.get(editorViewCtx).focus() })
export const redo = (crepe: Crepe | null) => crepe?.editor.action(ctx => { ctx.get(commandsCtx).call(redoCommand.key); ctx.get(editorViewCtx).focus() })
export const insertTable = (crepe: Crepe | null) => crepe?.editor.action(ctx => {
  // After the selected words, not in place of them.
  const view = ctx.get(editorViewCtx)
  view.dispatch(view.state.tr.setSelection(Selection.near(view.state.selection.$to)))
  ctx.get(commandsCtx).call(insertTableCommand.key, { row: 3, col: 2 })
  view.focus()
})
export const insertLine = (crepe: Crepe | null) => crepe?.editor.action(ctx => { ctx.get(commandsCtx).call(insertHrCommand.key); ctx.get(editorViewCtx).focus() })

// Which looks the words under the cursor already have, so the bar can show its buttons pressed.
export function looksAt(crepe: Crepe | null): Record<string, boolean> & { align?: string } {
  const found: Record<string, boolean> & { align?: string } = {}
  crepe?.editor.action(ctx => {
    const { state } = ctx.get(editorViewCtx)
    const { from, to, empty, $from } = state.selection
    for (const name of ['strong', 'emphasis', 'underline', 'strike_through', 'sup', 'sub']) {
      const type = state.schema.marks[name]
      if (type) found[name] = empty ? !!type.isInSet(state.storedMarks ?? $from.marks()) : state.doc.rangeHasMark(from, to, type)
    }
    found.align = $from.parent.attrs.align ?? 'left'
  })
  return found
}

// ── Find and replace ──
// Every place the words occur, as positions in the note. (Words split by a change of look are not joined up.)
function occurrences(view: EditorView, wanted: string) {
  const found: { from: number; to: number }[] = []
  const needle = wanted.toLowerCase()
  if (!needle) return found
  view.state.doc.descendants((node, at) => {
    if (!node.isText || !node.text) return
    const text = node.text.toLowerCase()
    for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + needle.length)) found.push({ from: at + i, to: at + i + needle.length })
  })
  return found
}
// Select the next occurrence after the cursor (going round at the end). Says which one it is, and of how many.
export function findNext(crepe: Crepe | null, wanted: string): { at: number; of: number } {
  let result = { at: 0, of: 0 }
  crepe?.editor.action(ctx => {
    const view = ctx.get(editorViewCtx)
    const found = occurrences(view, wanted)
    if (!found.length) return
    const after = view.state.selection.to
    const index = Math.max(0, found.findIndex(spot => spot.from >= after))
    const spot = found[index]
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, spot.from, spot.to)).scrollIntoView())
    result = { at: index + 1, of: found.length }
  })
  return result
}
// Replace the selected occurrence, or all of them. Says how many were changed.
export function replaceFound(crepe: Crepe | null, wanted: string, by: string, all: boolean): number {
  let changed = 0
  crepe?.editor.action(ctx => {
    const view = ctx.get(editorViewCtx)
    const { from, to } = view.state.selection
    const spots = all ? occurrences(view, wanted) : occurrences(view, wanted).filter(spot => spot.from === from && spot.to === to)
    let tr = view.state.tr
    for (const spot of [...spots].reverse()) tr = by ? tr.insertText(by, spot.from, spot.to) : tr.delete(spot.from, spot.to)
    if (spots.length) view.dispatch(tr)
    changed = spots.length
  })
  return changed
}

// How many boxes of the note's checklists are ticked, and how many there are.
export function checklist(crepe: Crepe | null) {
  const boxes = { done: 0, all: 0 }
  crepe?.editor.action(ctx => ctx.get(editorViewCtx).state.doc.descendants(node => {
    if (node.type.name !== 'list_item' || node.attrs.checked == null) return
    boxes.all++
    if (node.attrs.checked) boxes.done++
  }))
  return boxes
}

// Typewriter writing: the line being written stays at the same height while the page moves under it.
export const keepLineInPlace = (crepe: Crepe | null, page: HTMLElement) => crepe?.editor.action(ctx => {
  const view = ctx.get(editorViewCtx)
  if (!view.hasFocus()) return
  const line = view.coordsAtPos(view.state.selection.head)
  const box = page.getBoundingClientRect()
  page.scrollTop += line.top - (box.top + box.height * 0.42)
})
