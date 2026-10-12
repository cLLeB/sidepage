import { useSyncExternalStore } from 'react'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import { headingSchema, paragraphSchema } from '@milkdown/kit/preset/commonmark'
import { toggleMark } from '@milkdown/kit/prose/commands'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
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
export type Writing = { face: keyof typeof FACES; size: number; ink: keyof typeof INKS }

const DEFAULT_WRITING: Writing = { face: 'sans', size: 16, ink: 'pencil' }
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
const LOOK_NAMES = Object.keys(LOOKS) as Look[]

type Mdast = { type: string; value?: string; children?: Mdast[]; kind?: string; look?: string; align?: string }

const styledSpan = /^<span style="([^"<>]*)">$/
// The looks an opening tag asks for, outermost first; nothing if it is not one of ours.
function looksOf(tag: string): { kind: string; look: string }[] | null {
  if (tag === '<u>') return [{ kind: 'underline', look: '' }]
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
      open.push({ at: out.length, close: tag === '<u>' ? '</u>' : '</span>', looks })
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
const lookMark = (kind: Look | 'underline') => $markSchema(kind, () => ({
  attrs: { look: { default: '' } },
  parseDOM: kind === 'underline'
    ? [{ tag: 'u' }]
    : [{ tag: `span[data-${kind}]`, getAttrs: dom => ({ look: (dom as HTMLElement).getAttribute(`data-${kind}`) ?? '' }) }],
  toDOM: mark => kind === 'underline'
    ? ['u', 0]
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
const marks = [...LOOK_NAMES, 'underline' as const].map(lookMark)

// Writing a piece of styled text back into the note.
type Stringify = {
  enter(name: string): () => void
  createTracker(info: unknown): { move(text: string): string; current(): object }
  containerPhrasing(node: Mdast, info: object): string
}
const writeLook = Object.assign((node: Mdast, _parent: unknown, state: Stringify, info: unknown) => {
  const [before, after] = node.kind === 'underline'
    ? ['<u>', '</u>']
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
export const toggleLook = (crepe: Crepe | null, name: 'strong' | 'emphasis' | 'strike_through' | 'underline') => withView(crepe, view => {
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
  for (const name of [...LOOK_NAMES, 'underline', 'strong', 'emphasis', 'strike_through']) {
    const type = view.state.schema.marks[name]
    if (type) tr = tr.removeMark(from, to, type)
  }
  view.dispatch(tr)
})
