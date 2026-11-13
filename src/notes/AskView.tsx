import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import 'katex/dist/katex.min.css'
import { ArrowUp, Check, Copy, ExternalLink, KeyRound, Laptop, NotebookPen, RotateCcw, Square } from 'lucide-react'
import type { ModelMessage } from 'ai'
import { baseName, loadNote, onAskAi, onPlace, openOutside, placeNow, saveNote, sendQuote } from '../lib/platform'
import { uiLocale } from '../lib/language'
import { placeName } from '../lib/library'
import { usePref } from '../lib/prefs'
import { useLink } from '../lib/link'
import { aiPossible as appOnThisDevice, bookText, installedTools, prepareBook, runTool, signedIn, signIn, snapPage, systemPrompt, TOOL_HOMES, TOOL_NAMES, type Tool } from '../lib/ai'
import { askDirect, connect, connected, connection, OWN_APPS, pageToPaste, plainError, SERVICES, type Connection, type Service } from '../lib/directai'

type Message = { from: 'reader' | 'ai'; text: string; status?: string; error?: boolean; done?: boolean }
// `session` carries on a conversation with Claude's app (resumed, it remembers what was said) and `covered` counts
// the messages that session has seen; `history` carries one with an AI reached with a key. `started` names the chat.
type Chat = { id: string; started: string; messages: Message[]; session: string; covered?: number; history: ModelMessage[] }
let made = 0
const newChat = (): Chat => ({ id: `${Date.now().toString(36)}${(++made).toString(36)}`, started: new Date().toISOString(), messages: [], session: '', history: [] })

// Each book's conversations are kept with its notes (ai-chats.json), the latest last, so closing Sidepage loses
// nothing. While Sidepage runs they live here, outside the panel, one shelf per book: an answer goes on being
// written into the chat it was asked in, whatever book or chat the panel shows meanwhile, even with the panel closed.
const CHATS_FILE = 'ai-chats.json'
const KEEP = 40
type Shelf = { chats: Chat[]; current: string }
const shelves = new Map<string, Shelf>()
const loading = new Map<string, Promise<Shelf>>()
// The chats being answered, each with what stops it.
const running = new Map<string, () => void>()
const drafts = new Map<string, string>()
const listeners = new Set<() => void>()
let version = 0
const changed = () => { version++; listeners.forEach(listener => listener()) }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

// An answer cut short when Sidepage closed shows as stopped, not as one still coming.
const settled = (chat: Chat): Chat => ({
  ...chat,
  messages: chat.messages.map(message => message.from === 'ai' && !message.done
    ? { ...message, done: true, status: undefined, ...(message.text.trim() ? {} : { text: STOPPED, error: true }) } : message),
})
const STOPPED = 'Stopped before an answer came.'
function shelfOf(book: string): Promise<Shelf> {
  const had = shelves.get(book)
  if (had) return Promise.resolve(had)
  if (!loading.has(book)) loading.set(book, (async () => {
    let chats: Chat[] = []
    try { chats = (JSON.parse((await loadNote(baseName(book), CHATS_FILE)) ?? '[]') as Chat[]).map(settled) } catch { chats = [] }
    const shelf: Shelf = { chats, current: chats.at(-1)?.id ?? '' }
    if (!chats.length) { const fresh = newChat(); shelf.chats = [fresh]; shelf.current = fresh.id }
    shelves.set(book, shelf)
    changed()
    return shelf
  })())
  return loading.get(book)!
}

// Pictures sent along with a question are left out: they are large, and the answers say what they showed.
const storable = (chat: Chat): Chat => ({
  ...chat,
  messages: chat.messages.map(message => ({ ...message, status: undefined })),
  history: chat.history.map(message => message.role === 'user' && Array.isArray(message.content)
    ? { ...message, content: message.content.filter(part => part.type !== 'image') } as ModelMessage : message),
})
// A book's chats are written whole, one write after another, a moment after they change (not at every word).
const writing = new Map<string, Promise<unknown>>()
const timers = new Map<string, number>()
function save(book: string, now = false) {
  clearTimeout(timers.get(book))
  const write = () => {
    const shelf = shelves.get(book)
    if (!shelf) return
    const text = JSON.stringify(shelf.chats.filter(chat => chat.messages.length).slice(-KEEP).map(storable))
    writing.set(book, (writing.get(book) ?? Promise.resolve()).then(() => saveNote(baseName(book), CHATS_FILE, text)).catch(() => {}))
  }
  if (now) write()
  else timers.set(book, window.setTimeout(write, 700))
}
function putChat(book: string, chat: Chat, now = false) {
  const shelf = shelves.get(book)
  if (!shelf) return
  shelf.chats = shelf.chats.some(other => other.id === chat.id) ? shelf.chats.map(other => other.id === chat.id ? chat : other) : [...shelf.chats, chat]
  changed()
  save(book, now)
}
// A new chat, unless the one shown is still empty.
function startChat(book: string) {
  const shelf = shelves.get(book)
  if (!shelf) return
  if (shelf.chats.find(chat => chat.id === shelf.current)?.messages.length === 0) return
  const fresh = newChat()
  shelf.chats = [...shelf.chats.filter(chat => chat.messages.length || running.has(chat.id)), fresh]
  shelf.current = fresh.id
  changed()
}
function showChat(book: string, id: string) {
  const shelf = shelves.get(book)
  if (!shelf) return
  // An empty chat left behind is dropped.
  shelf.chats = shelf.chats.filter(chat => chat.id === id || chat.messages.length || running.has(chat.id))
  shelf.current = id
  changed()
}

// A chat's name in the list: its first question, and when it began.
const chatName = (chat: Chat) => {
  const first = chat.messages.find(message => message.from === 'reader')?.text.replace(/\s+/g, ' ') ?? ''
  const when = new Date(chat.started).toLocaleDateString(uiLocale(), { day: 'numeric', month: 'short' })
  return `${when} · ${first.length > 48 ? `${first.slice(0, 48)}…` : first}`
}

// What an AI that does not remember the chat needs to follow it: the questions and answers so far.
const clipped = (text: string, most: number) => text.length > most ? `${text.slice(0, most)}…` : text
const transcript = (messages: Message[]) => {
  const said = messages.filter(message => message.text.trim() && !message.error).slice(-12)
  return said.length ? `Our conversation so far:\n\n${said.map(message => `${message.from === 'reader' ? 'Me' : 'You'}: ${clipped(message.text, 2500)}`).join('\n\n')}` : ''
}

// What a tool is doing, said plainly, from a tool call in Claude's stream.
const doing = (call: { name?: string; input?: { pattern?: string; file_path?: string } }) =>
  call.name === 'Grep' ? `Searching the book for “${call.input?.pattern ?? ''}”…` : call.name === 'Read' ? (call.input?.file_path?.endsWith('notes.md') ? 'Reading your notes…' : 'Reading the book…') : 'Looking through the book…'

type Way = { withKey: boolean; tool: Tool; viaComputer: boolean; place: string; onSignedOut(): void }
// One question in one chat of one book. Everything it writes goes to that chat, by its id, and nowhere else.
async function ask(book: string, chatId: string, text: string, way: Way) {
  const shelf = await shelfOf(book)
  const start = shelf.chats.find(chat => chat.id === chatId)
  if (!start || running.has(chatId) || !text.trim()) return
  const earlier = start.messages
  let chat: Chat = { ...start, messages: [...earlier, { from: 'reader', text }, { from: 'ai', text: '', status: 'Opening the book…' }] }
  const last = () => chat.messages.at(-1)!
  const change = (patch: Partial<Message>, now = false) => { chat = { ...chat, messages: [...chat.messages.slice(0, -1), { ...last(), ...patch }] }; putChat(book, chat, now) }
  let stopped = false
  running.set(chatId, () => { stopped = true })
  putChat(book, chat)
  try {
    if (way.withKey) {
      const halt = new AbortController()
      running.set(chatId, () => { stopped = true; halt.abort() })
      try {
        const history = await askDirect(book, way.place, text, chat.history, written => change({ text: written, status: '' }), status => change({ status }), halt.signal)
        chat = { ...chat, history }
        if (!last().text.trim()) change({ text: 'No answer came back.', error: true })
      } catch (error) {
        if (!stopped) change({ text: plainError(error), error: true })
      }
      return
    }
    const folder = await prepareBook(book, baseName(book))
    const pictured = await snapPage(baseName(book), book)
    const where = [way.place ? `I am on ${placeName(way.place) || way.place} of the book.` : '', pictured ? 'this-page.png shows the page I am looking at, taken just now.' : ''].filter(Boolean).join(' ')
    const text_ = way.viaComputer ? await bookText(book) : undefined
    // Claude's app remembers a chat it has had (the session); what it has not seen, and everything for the others,
    // is told again.
    let session = way.tool === 'claude' ? chat.session : ''
    const attempt = async (resume: string, before: Message[]) => {
      let streamed = ''
      let failed = ''
      const said = transcript(before)
      const input = [said, where, said ? `My new question: ${text}` : text].filter(Boolean).join('\n\n')
      const result = await runTool(way.tool, 'ask', input, { cwd: folder ?? '', system: systemPrompt(baseName(book), way.viaComputer), resume, ...(text_ !== undefined ? { book, text: text_ } : {}) }, line => {
        if (way.tool !== 'claude') { streamed += `${line}\n`; change({ text: streamed, status: '' }); return }
        let event: { type: string; session_id?: string; event?: { type: string; delta?: { type: string; text?: string } }; message?: { content?: { type: string; name?: string; input?: object }[] }; result?: string; is_error?: boolean }
        try { event = JSON.parse(line) } catch { return }
        if (event.session_id) session = event.session_id
        if (event.type === 'stream_event' && event.event?.type === 'content_block_delta' && event.event.delta?.type === 'text_delta') {
          streamed += event.event.delta.text ?? ''
          change({ text: streamed, status: '' })
        } else if (event.type === 'assistant') {
          const call = event.message?.content?.find(part => part.type === 'tool_use')
          if (call) { streamed += streamed && !streamed.endsWith('\n\n') ? '\n\n' : ''; change({ status: doing(call as never) }) }
        } else if (event.type === 'result') {
          if (event.is_error) failed = event.result || 'The AI could not answer.'
          else change({ text: event.result || streamed, status: '' })
        }
      }, stop => running.set(chatId, () => { stopped = true; stop() }))
      return { ...result, failed }
    }
    const resumable = !!session
    let result = await attempt(session, resumable ? earlier.slice(chat.covered ?? earlier.length) : earlier)
    // A session Claude no longer has (another folder, cleared): the chat so far is told instead.
    if (resumable && !stopped && /no conversation found|session.*not found|could not resume/i.test(`${result.failed}\n${result.errors}`)) {
      session = ''
      change({ text: '', status: 'Opening the book…' })
      result = await attempt('', earlier)
    }
    if (stopped) return
    if (result.failed) change({ text: result.failed, error: true, status: '' })
    else if (!last().text.trim()) change({ text: result.code === 0 ? 'No answer came back.' : (result.errors.trim().split('\n').slice(-3).join('\n') || 'The AI could not answer.'), error: result.code !== 0, status: '' })
    if (last().error && /log ?in|sign ?in|auth|credential|api key/i.test(last().text)) way.onSignedOut()
    if (way.tool === 'claude' && session) chat = { ...chat, session, covered: chat.messages.length }
  } catch (error) {
    if (!stopped) change({ text: String((error as Error)?.message ?? error), error: true })
  } finally {
    running.delete(chatId)
    change({ done: true, status: '', ...(last().text.trim() ? {} : { text: STOPPED, error: true }) }, true)
  }
}

// An answer written in Markdown, made safe before it is shown (it comes from outside the app).
function Answer({ text }: { text: string }) {
  const [html, setHtml] = useState('')
  useEffect(() => {
    let live = true
    void Promise.all([import('marked'), import('dompurify'), import('katex')]).then(([{ marked }, { default: purify }, { default: katex }]) => {
      // Formulas ($$…$$, \[…\], $…$, \(…\)) are drawn by KaTeX; the rest is Markdown.
      const formulas: string[] = []
      const keep = (tex: string, display: boolean) => {
        formulas.push(katex.renderToString(tex.trim(), { displayMode: display, throwOnError: false }))
        return `@@FORMULA${formulas.length - 1}@@`
      }
      const source = text
        .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => keep(tex, true))
        .replace(/\\\[([\s\S]+?)\\\]/g, (_, tex: string) => keep(tex, true))
        .replace(/\\\((.+?)\\\)/g, (_, tex: string) => keep(tex, false))
        .replace(/(^|[^\\$\w])\$([^$\n]+?)\$(?!\w)/g, (_, before: string, tex: string) => before + keep(tex, false))
      const html = (marked.parse(source, { async: false }) as string).replace(/@@FORMULA(\d+)@@/g, (_, i: string) => formulas[Number(i)])
      if (live) setHtml(purify.sanitize(html))
    })
    return () => { live = false }
  }, [text])
  return (
    <div className="ai-answer" dangerouslySetInnerHTML={{ __html: html }}
      onClick={e => { const link = (e.target as HTMLElement).closest('a'); if (link?.href) { e.preventDefault(); void openOutside(link.href) } }} />
  )
}

const STARTERS = ['Explain this page simply', 'Sum up this part in five points', 'Quiz me on this page', 'What should I remember from this?']


// Connecting an AI with a key: the service, the key (kept on this device), and for some, the model and address.
function Connect({ onDone, onCancel, onApp, book, place }: { onDone: (value: Connection | null) => void; onCancel?: () => void; onApp?: () => void; book: string; place: string }) {
  const was = connection()
  const [service, setService] = useState<Service>(was?.service ?? 'google')
  const [key, setKey] = useState(was?.service === service ? was.key : '')
  const [model, setModel] = useState(was?.model ?? '')
  const [address, setAddress] = useState(was?.address ?? '')
  const value: Connection = { service, key: key.trim(), model: model.trim(), address: address.trim() }
  const choose = (next: Service) => { setService(next); setKey(was?.service === next ? was.key : ''); setModel(was?.service === next ? was.model : '') }
  const about = SERVICES[service]
  return (
    <div className="note ask-ai">
      <form className="review-empty ai-connect" onSubmit={e => { e.preventDefault(); if (connected(value)) { connect(value); onDone(value) } }}>
        <h2>Connect an AI</h2>
        <p>Ask an AI about your book with a key from the AI's service. The easiest is a free Gemini key from Google.</p>
        <div className="ai-services">
          {(Object.keys(SERVICES) as Service[]).map(name => (
            <button type="button" key={name} className={name === service ? 'soft on' : 'soft'} aria-pressed={name === service} onClick={() => choose(name)}>
              <b>{SERVICES[name].name}</b><span>{SERVICES[name].plan}</span>
            </button>
          ))}
        </div>
        {service === 'other' && (
          <label className="ai-field">Address of the service
            <input value={address} onChange={e => setAddress(e.target.value)} placeholder="https://openrouter.ai/api/v1 or http://localhost:11434/v1" inputMode="url" autoComplete="off" spellCheck={false} />
          </label>
        )}
        <label className="ai-field">{service === 'other' ? 'Key (if the service needs one)' : 'Key'}
          <input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder="Paste the key here" autoComplete="off" spellCheck={false} />
        </label>
        {about.keyHome && (
          <button type="button" className="ai-link" onClick={() => void openOutside(about.keyHome)}>
            <ExternalLink size={14} aria-hidden /> {service === 'google' ? 'Get a free key from Google' : `Get a key from ${about.name.split(' ')[0]}`}
          </button>
        )}
        <label className="ai-field">{service === 'other' ? 'Model' : 'Model (you can leave this)'}
          <input value={model} onChange={e => setModel(e.target.value)} placeholder={about.model || 'llama3.2, google/gemini-flash-latest…'} autoComplete="off" spellCheck={false} />
        </label>
        <p className="ai-fine">The key stays on this device. Your questions and the parts of the book needed to answer go to {service === 'other' ? 'that service' : about.name.split(' ')[0]}.</p>
        <div className="ai-connect-actions">
          <button className="primary" disabled={!connected(value)}><KeyRound size={16} aria-hidden /> Connect</button>
          {onCancel && <button type="button" className="soft" onClick={onCancel}>Cancel</button>}
          {was && <button type="button" className="soft" onClick={() => { connect(null); setKey(''); onDone(null) }}>Forget the key</button>}
        </div>
        {onApp && <button type="button" className="ai-link" onClick={onApp}>Use the AI app on this computer instead</button>}
        {!appOnThisDevice && (
          <div className="ai-elsewhere">
            <p>Have Claude Pro, ChatGPT Plus or Gemini on your computer? Link this device to it and ask here with your plan, with no key.</p>
            <div className="ai-connect-actions">
              <button type="button" className="soft" onClick={() => window.dispatchEvent(new Event('sidepage:link'))}><Laptop size={14} aria-hidden /> Link to my computer</button>
            </div>
          </div>
        )}
        {book && (
          <div className="ai-elsewhere">
            <p>Already pay for Claude Pro, ChatGPT Plus or Gemini? Ask in their app with your plan: Sidepage copies this page, opens the app, and you paste it there.</p>
            <div className="ai-connect-actions">
              {OWN_APPS.map(app => (
                <button type="button" key={app.name} className="soft" onClick={() => void pageToPaste(book, place).then(text => navigator.clipboard.writeText(text)).finally(() => void openOutside(app.home))}>
                  <ExternalLink size={14} aria-hidden /> Ask in {app.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </form>
    </div>
  )
}

export default function AskView() {
  const [here, setHere] = useState(placeNow)
  const [tools, setTools] = useState<Tool[] | null>(null)
  const [tool, setTool] = usePref<Tool>('ai-tool', 'claude')
  const [ready, setReady] = useState<boolean | null>(null)
  // With the AI's app on this computer, or with a key (the only way on phones, tablets and the web).
  const [via, setVia] = usePref<'app' | 'key'>('ai-via', 'app')
  // The AI's app: on this computer, or on the reader's computer linked to this phone or tablet.
  const link = useLink()
  const viaComputer = !appOnThisDevice && link.status === 'linked' && !!link.other?.computer
  const aiPossible = appOnThisDevice || viaComputer
  const withKey = !aiPossible || via === 'key'
  const [linked, setLinked] = useState(connection)
  const [changing, setChanging] = useState(false)
  const [copied, setCopied] = useState(-1)
  const book = here?.book ?? ''
  const bookNow = useRef(book)
  bookNow.current = book

  // Following the book in front; one brought to the front while the panel was still loading counts too.
  useEffect(() => { const stop = onPlace(setHere); setHere(placeNow()); return stop }, [])
  // The chats of the book in front, from their shelf (which every answer being written keeps up to date).
  useSyncExternalStore(subscribe, () => version)
  useEffect(() => { if (book) void shelfOf(book) }, [book])
  const shelf = book ? shelves.get(book) : undefined
  const blank = useMemo(newChat, [])
  const chat = shelf?.chats.find(other => other.id === shelf.current) ?? blank
  const busy = running.has(chat.id)
  const kept = shelf?.chats.filter(other => other.messages.length) ?? []

  // What is being typed, kept for each book.
  const [question, setTyped] = useState('')
  const setQuestion = (text: string) => { drafts.set(bookNow.current, text); setTyped(text) }
  useEffect(() => { setTyped(drafts.get(book) ?? '') }, [book])
  // A question sent from the book (an open question on a passage) is typed in, ready to send, for that book.
  useEffect(() => onAskAi(text => {
    const from = placeNow()?.book ?? bookNow.current
    drafts.set(from, text)
    if (from === bookNow.current) setTyped(text)
  }), [])

  // The newest words stay in view while an answer is written, unless the reader scrolled up to read.
  const list = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  useLayoutEffect(() => { pinned.current = true; setCopied(-1) }, [book, chat.id])
  useLayoutEffect(() => { if (pinned.current && list.current) list.current.scrollTop = list.current.scrollHeight }, [book, chat])

  const look = async () => {
    const found = await installedTools()
    setTools(found)
    const use = found.includes(tool) ? tool : found[0]
    if (use && use !== tool) setTool(use)
    setReady(use ? await signedIn(use) : null)
  }
  useEffect(() => { if (aiPossible && !withKey) void look() }, [withKey, aiPossible]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = (text: string) => {
    if (!text.trim() || busy || !book || !shelf) return
    setQuestion('')
    void ask(book, chat.id, text, { withKey, tool, viaComputer, place: here?.book === book ? here.place : '', onSignedOut: () => setReady(false) })
  }
  const fresh = () => { if (book) startChat(book) }
  const useApp = aiPossible ? () => { setVia('app'); setChanging(false); fresh() } : undefined
  if (withKey && (changing || !connected(linked))) {
    return <Connect book={book} place={here?.place ?? ''} onDone={value => { setLinked(value); setChanging(false); fresh() }} onCancel={changing && connected(linked) ? () => setChanging(false) : undefined} onApp={useApp} />
  }
  if (!withKey && tools && !tools.length) {
    return (
      <div className="note ask-ai">
        <div className="review-empty">
          <h2>Ask AI with your subscription</h2>
          <p>Sidepage asks your AI through its own app for computers, signed in with the plan you already pay for. No API key is needed. Install one, then come back:</p>
          <div className="ai-installs">
            {(['claude', 'codex', 'gemini'] as Tool[]).map(name => (
              <button key={name} className="soft" onClick={() => void openOutside(TOOL_HOMES[name])}>
                <b>{TOOL_NAMES[name]}</b><span>{name === 'claude' ? 'Claude Pro or Max: Claude Code' : name === 'codex' ? 'ChatGPT Plus or Pro: Codex CLI' : 'A Google account: Gemini CLI'}</span>
              </button>
            ))}
          </div>
          <button className="primary" onClick={() => void look()}><RotateCcw size={16} aria-hidden /> Check again</button>
          <button className="ai-link" onClick={() => { setVia('key'); fresh() }}><KeyRound size={14} aria-hidden /> Or connect an AI with a key</button>
        </div>
      </div>
    )
  }
  return (
    <div className="note ask-ai">
      <div className="ai-bar">
        {withKey ? <>
          <b>{linked?.service === 'other' ? linked.model : SERVICES[linked!.service].name}</b>
          <button className="soft" onClick={() => setChanging(true)}>Change</button>
          {useApp && <button className="soft" onClick={useApp}>Use the AI app</button>}
        </> : <>
        {tools && tools.length > 1
          ? <select value={tool} onChange={e => { setTool(e.target.value as Tool); setReady(null); void signedIn(e.target.value as Tool).then(setReady) }}>
              {tools.map(name => <option key={name} value={name}>{TOOL_NAMES[name]}</option>)}
            </select>
          : <b>{TOOL_NAMES[tool]}</b>}
        {viaComputer && <span className="ai-ready">on your computer</span>}
        {ready === false && !viaComputer && <button className="primary" onClick={() => void signIn(tool).then(() => signedIn(tool)).then(setReady)}>Sign in with your {TOOL_NAMES[tool]} account</button>}
        {ready === false && viaComputer && <span className="ai-fine">Sign in to {TOOL_NAMES[tool]} on the computer first.</span>}
        {ready && <span className="ai-ready"><Check size={14} aria-hidden /> Signed in</span>}
        {aiPossible && <button className="soft" onClick={() => { setVia('key'); fresh() }}>Use a key</button>}
        </>}
        <span className="ai-spacer" />
        {kept.some(other => other.id !== chat.id) && (
          <select className="ai-earlier" aria-label="Earlier chats" title="Earlier chats about this book" value={chat.id}
            onChange={e => showChat(book, e.target.value)}>
            {!kept.some(other => other.id === chat.id) && <option value={chat.id}>New chat</option>}
            {[...kept].reverse().map(other => <option key={other.id} value={other.id}>{running.has(other.id) ? '… ' : ''}{chatName(other)}</option>)}
          </select>
        )}
        {chat.messages.length > 0 && <button className="soft" onClick={fresh}>New chat</button>}
      </div>

      <div className="ai-messages" ref={list} onScroll={e => { const box = e.currentTarget; pinned.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80 }}>
        {!chat.messages.length && (
          <div className="ai-welcome">
            <p>{book ? `Ask anything about ${baseName(book)}. The AI reads the book itself and says which pages it used.` : 'Open a book, then ask anything about it.'}</p>
            {book && <div className="ai-starters">{STARTERS.map(text => <button key={text} className="chip" onClick={() => send(text)}>{text}</button>)}</div>}
          </div>
        )}
        {chat.messages.map((message, i) => message.from === 'reader'
          ? <div key={i} className="ai-said">{message.text}</div>
          : (
            <div key={i} className={message.error ? 'ai-reply error' : 'ai-reply'}>
              {message.status && <p className="ai-status"><span className="ai-dot" />{message.status}</p>}
              {message.text && <Answer text={message.text} />}
              {message.done && message.text && !message.error && (
                <div className="ai-actions">
                  <button onClick={() => sendQuote({ text: message.text, source: '' })} title="Put this answer in your notes"><NotebookPen size={14} aria-hidden /> Add to notes</button>
                  <button onClick={() => { void navigator.clipboard.writeText(message.text); setCopied(i); setTimeout(() => setCopied(-1), 1500) }}>
                    {copied === i ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} {copied === i ? 'Copied' : 'Copy'}
                  </button>
                </div>
              )}
            </div>
          ))}
      </div>

      <form className="ai-compose" onSubmit={e => { e.preventDefault(); send(question) }}>
        <textarea rows={2} value={question} disabled={!book} placeholder={book ? 'Ask about this book…' : 'Open a book first'}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(question) } }} />
        {busy
          ? <button type="button" className="ai-send" onClick={() => running.get(chat.id)?.()} title="Stop" aria-label="Stop"><Square size={16} aria-hidden /></button>
          : <button className="ai-send" disabled={!question.trim() || !book} title="Ask (Enter)" aria-label="Ask"><ArrowUp size={18} aria-hidden /></button>}
      </form>
    </div>
  )
}
