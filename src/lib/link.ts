import { useSyncExternalStore } from 'react'
import type { MessageAction, Room } from '@trystero-p2p/core'
import { baseName, canRunTools, isMobile, loadNote, notebookFolder, openFileNow, saveNote, saveNoteFile } from './platform'
import { getPref, setPref } from './prefs'

// Linking the reader's own devices (a phone or tablet with their computer), with no account and no server of
// Sidepage's: Trystero lets the two find each other through public relays and then talk straight to one another,
// encrypted with the link's code. Over the link:
//   · a phone or tablet asks the AI app on the computer (Claude Code, Codex, Gemini CLI: the reader's subscription);
//   · either device sends a book with all its notes to the other.
// Only a device that was given the code can join; the computer only ever runs its AI app the way Sidepage itself
// does (reading and searching one book's folder).
export type Tool = 'claude' | 'codex' | 'gemini'
type Hello = { device: string; computer: boolean; tools: Tool[] }
type AskMessage = { id: string; tool: Tool; mode: 'ask' | 'status'; input: string; system: string; resume: string; book: string; text?: string; notes?: string }
// Lines are numbered, and the end says how many there were: messages can overtake one another on the way.
type Line = { id: string; line: string; n: number }
type Done = { id: string; code: number | null; errors: string; lines: number }

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
export const newCode = () => {
  const random = crypto.getRandomValues(new Uint8Array(10))
  const letters = [...random].map(value => ALPHABET[value % ALPHABET.length]).join('')
  return `${letters.slice(0, 5)}-${letters.slice(5)}`
}
const tidy = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '')
export const validCode = (code: string) => tidy(code).length === 10

export type LinkState = { code: string; status: 'off' | 'waiting' | 'linked'; other: Hello | null }
let state: LinkState = { code: getPref('link-code', ''), status: 'off', other: null }
const listeners = new Set<() => void>()
const change = (patch: Partial<LinkState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()) }
export const linkNow = () => state
export const useLink = () => useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => state)
// Whether the other device is a computer that can run an AI app for this one.
export const computerLinked = () => state.status === 'linked' && !!state.other?.computer && !canRunTools

let room: Room | null = null
let peer = ''
let actions: {
  hello: MessageAction<Hello>; ask: MessageAction<AskMessage>; line: MessageAction<Line>; done: MessageAction<Done>
  stop: MessageAction<{ id: string }>; picture: MessageAction<ArrayBuffer>; book: MessageAction<ArrayBuffer>
} | null = null
type Waiting = { onLine(line: string): void; finish(result: { code: number | null; errors: string }): void; next: number; early: Map<number, string>; done?: Done }
const waiting = new Map<string, Waiting>()
// Lines are handed on in their order; the run ends once every line before the end has come.
const deliver = (id: string) => {
  const run = waiting.get(id)
  if (!run) return
  while (run.early.has(run.next)) { run.onLine(run.early.get(run.next)!); run.early.delete(run.next); run.next++ }
  if (run.done && run.next >= run.done.lines) { run.finish(run.done); waiting.delete(id) }
}
// Should a line be lost on the way, the end is not held up by it for more than a moment.
const finishSoon = (id: string) => setTimeout(() => {
  const run = waiting.get(id)
  if (!run?.done) return
  for (const n of [...run.early.keys()].sort((a, b) => a - b)) run.onLine(run.early.get(n)!)
  run.finish(run.done); waiting.delete(id)
}, 2500)
const stops = new Map<string, () => void>()
const notice = (text: string) => window.dispatchEvent(new CustomEvent('sidepage:notice', { detail: text }))
const device = () => (isMobile ? (/iPad|Tablet|SM-[TX]/i.test(navigator.userAgent) || Math.min(screen.width, screen.height) >= 600 ? 'tablet' : 'phone') : 'computer')

// Joins the link named by the code (and remembers it, so the devices find each other again whenever both are open).
export async function startLink(code: string) {
  if (!validCode(code)) return
  if (room) await stopLink(true)
  setPref('link-code', code)
  change({ code, status: 'waiting', other: null })
  const [{ joinRoom }, { installedTools }] = await Promise.all([import('trystero'), import('./ai')])
  const joined = joinRoom({ appId: 'io.github.clleb.sidepage.link', password: tidy(code) }, `link-${tidy(code).slice(0, 5)}`)
  room = joined
  const made = {
    hello: joined.makeAction<Hello>('hello'), ask: joined.makeAction<AskMessage>('ask'), line: joined.makeAction<Line>('line'),
    done: joined.makeAction<Done>('done'), stop: joined.makeAction<{ id: string }>('stop'),
    picture: joined.makeAction<ArrayBuffer>('picture'), book: joined.makeAction<ArrayBuffer>('book'),
  }
  actions = made
  joined.onPeerJoin = async id => {
    peer = id
    void made.hello.send({ device: device(), computer: canRunTools, tools: canRunTools ? await installedTools() : [] }, { target: id })
  }
  joined.onPeerLeave = id => {
    if (id !== peer) return
    peer = ''
    change({ status: 'waiting', other: null })
    for (const [, run] of waiting) run.finish({ code: 1, errors: 'The link to your computer was lost.' })
    waiting.clear()
  }
  made.hello.onMessage = (hello, { peerId }) => { peer = peerId; change({ status: 'linked', other: hello }) }

  // ── On the computer: the other device asks its AI app ──
  made.ask.onMessage = async (asked, { peerId }) => {
    if (!canRunTools) return
    const { runTool } = await import('./ai')
    const notebook = baseName(asked.book)
    try {
      if (asked.text !== undefined) await saveNote(notebook, 'book.md', asked.text)
      if (asked.notes !== undefined) await saveNote(notebook, 'notes-other-device.md', asked.notes)
      // A question about a book runs in that book's folder; the sign-in check needs none.
      const cwd = asked.book ? (await notebookFolder(notebook)) ?? '' : ''
      let n = 0
      const result = await runTool(asked.tool, asked.mode === 'status' ? 'status' : 'ask', asked.input, { cwd, system: asked.system, resume: asked.resume },
        line => void made.line.send({ id: asked.id, line, n: n++ }, { target: peerId }), halt => stops.set(asked.id, halt))
      void made.done.send({ id: asked.id, code: result.code, errors: result.errors, lines: n }, { target: peerId })
    } catch (error) {
      void made.done.send({ id: asked.id, code: 1, errors: String((error as Error)?.message ?? error), lines: 0 }, { target: peerId })
    }
    stops.delete(asked.id)
  }
  made.stop.onMessage = ({ id }) => stops.get(id)?.()
  // The page the other device is looking at, for the AI to see.
  made.picture.onMessage = (data, { metadata }) => {
    const book = (metadata as { book?: string } | undefined)?.book
    if (canRunTools && book) void saveNoteFile(baseName(book), 'this-page.png', new Blob([data], { type: 'image/png' }))
  }

  // ── On the asking device: what the computer's AI app writes ──
  made.line.onMessage = ({ id, line, n }) => {
    const run = waiting.get(id)
    if (!run) return
    if (typeof n !== 'number') return run.onLine(line)
    run.early.set(n, line); deliver(id)
  }
  made.done.onMessage = done => { const run = waiting.get(done.id); if (run) { run.done = { ...done, lines: done.lines ?? 0 }; deliver(done.id); finishSoon(done.id) } }

  // ── Either way: a book with its notes, sent from the other device ──
  made.book.onMessage = (data, { metadata }) => {
    const name = (metadata as { name?: string } | undefined)?.name ?? 'Book.sidepage'
    openFileNow(new File([data], name))
    notice(`${baseName(name)} arrived from your ${state.other?.device ?? 'other device'}.`)
  }
}

export async function stopLink(keepCode = false) {
  const leaving = room
  room = null; actions = null; peer = ''
  if (!keepCode) setPref('link-code', '')
  change({ code: keepCode ? state.code : '', status: 'off', other: null })
  await leaving?.leave().catch(() => {})
}

// Joins again, when the app starts, a link made earlier.
export const resumeLink = () => { if (state.code && !room) void startLink(state.code) }

// ── Asking the computer's AI app from this device (the same shape as running it here: see ai.ts) ──
const sentText = new Map<string, number>()
let counter = 0
export async function runOnComputer(tool: Tool, mode: 'ask' | 'status' | 'login', input: string, options: { system?: string; resume?: string; book?: string; text?: string },
  onLine: (line: string) => void, onStart?: (stop: () => void) => void): Promise<{ code: number | null; errors: string }> {
  if (!actions || !peer) return { code: 1, errors: 'Your computer is not linked just now. Open Sidepage on it.' }
  if (mode === 'login') return { code: 1, errors: 'Sign in on the computer itself.' }
  const id = `link-${Date.now()}-${++counter}`
  const book = options.book ?? ''
  // The book's words go across once; after that only what is asked.
  const fresh = !!book && options.text !== undefined && sentText.get(book) !== options.text.length
  const notes = fresh ? (await loadNote(baseName(book), 'notes.md')) ?? '' : undefined
  const done = new Promise<{ code: number | null; errors: string }>(finish => waiting.set(id, { onLine, finish, next: 0, early: new Map() }))
  await actions.ask.send({ id, tool, mode, input, system: options.system ?? '', resume: options.resume ?? '', book, ...(fresh ? { text: options.text, notes } : {}) }, { target: peer })
  if (fresh) sentText.set(book, options.text!.length)
  onStart?.(() => void actions?.stop.send({ id }, { target: peer }))
  return done
}
export async function sendPicture(book: string, picture: Blob) {
  if (actions && peer) await actions.picture.send(await picture.arrayBuffer(), { target: peer, metadata: { book } })
}

// A book and everything written beside it, sent to the other device, where it opens with its notes in place.
export async function sendBook(book: File, onProgress?: (share: number) => void) {
  if (!actions || !peer) throw new Error('The other device is not linked just now. Open Sidepage on it.')
  const { packBundle, BUNDLE_EXTENSION } = await import('./bundle')
  const bundle = await packBundle(book)
  await actions.book.send(bundle.buffer.slice(bundle.byteOffset, bundle.byteOffset + bundle.byteLength) as ArrayBuffer,
    { target: peer, metadata: { name: `${baseName(book.name)}.${BUNDLE_EXTENSION}` }, onProgress: share => onProgress?.(share) })
}
