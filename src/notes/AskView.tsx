import { useEffect, useRef, useState } from 'react'
import 'katex/dist/katex.min.css'
import { ArrowUp, Check, Copy, ExternalLink, KeyRound, NotebookPen, RotateCcw, Square } from 'lucide-react'
import type { ModelMessage } from 'ai'
import { baseName, onPlace, openOutside, placeNow, sendQuote } from '../lib/platform'
import { placeName } from '../lib/library'
import { usePref } from '../lib/prefs'
import { aiPossible, installedTools, prepareBook, runTool, signedIn, signIn, snapPage, systemPrompt, TOOL_HOMES, TOOL_NAMES, type Tool } from '../lib/ai'
import { askDirect, connect, connected, connection, OWN_APPS, pageToPaste, plainError, SERVICES, type Connection, type Service } from '../lib/directai'

type Message = { from: 'reader' | 'ai'; text: string; status?: string; error?: boolean; done?: boolean }
// `session` carries on a conversation with an AI app; `history` one with an AI reached with a key.
type Chat = { messages: Message[]; session: string; history: ModelMessage[] }
// Each book keeps its own conversation while the app is open.
const chats = new Map<string, Chat>()

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

// What a tool is doing, said plainly, from a tool call in Claude's stream.
const doing = (call: { name?: string; input?: { pattern?: string; file_path?: string } }) =>
  call.name === 'Grep' ? `Searching the book for “${call.input?.pattern ?? ''}”…` : call.name === 'Read' ? (call.input?.file_path?.endsWith('notes.md') ? 'Reading your notes…' : 'Reading the book…') : 'Looking through the book…'

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
  const [chat, setChat] = useState<Chat>({ messages: [], session: '', history: [] })
  // With the AI's app on this computer, or with a key (the only way on phones, tablets and the web).
  const [via, setVia] = usePref<'app' | 'key'>('ai-via', 'app')
  const withKey = !aiPossible || via === 'key'
  const [linked, setLinked] = useState(connection)
  const [changing, setChanging] = useState(false)
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(-1)
  const stop = useRef<() => void>(() => {})
  const end = useRef<HTMLDivElement>(null)
  const book = here?.book ?? ''

  useEffect(() => onPlace(setHere), [])
  useEffect(() => { setChat(chats.get(book) ?? { messages: [], session: '', history: [] }) }, [book])
  useEffect(() => { if (book) chats.set(book, chat) }, [book, chat])
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [chat])

  const look = async () => {
    const found = await installedTools()
    setTools(found)
    const use = found.includes(tool) ? tool : found[0]
    if (use && use !== tool) setTool(use)
    setReady(use ? await signedIn(use) : null)
  }
  useEffect(() => { if (aiPossible && !withKey) void look() }, [withKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const ask = async (text: string) => {
    if (!text.trim() || busy || !book) return
    setQuestion('')
    setBusy(true)
    const asked: Message = { from: 'reader', text }
    const answer: Message = { from: 'ai', text: '', status: 'Opening the book…' }
    let messages = [...chat.messages, asked, answer]
    let session = chat.session
    let history = chat.history
    const show = () => setChat({ messages: [...messages], session, history })
    const change = (patch: Partial<Message>) => { messages = [...messages.slice(0, -1), { ...messages.at(-1)!, ...patch }]; show() }
    show()
    if (withKey) {
      const halt = new AbortController()
      stop.current = () => halt.abort()
      try {
        history = await askDirect(book, here?.place ?? '', text, history, written => change({ text: written }), status => change({ status }), halt.signal)
        if (!messages.at(-1)!.text.trim()) change({ text: 'No answer came back.', error: true })
        change({ done: true, status: '' })
      } catch (error) {
        const stopped = halt.signal.aborted
        change(stopped ? { done: true, status: '' } : { text: plainError(error), error: true, status: '', done: true })
      }
      setBusy(false)
      return
    }
    try {
      const folder = await prepareBook(book, baseName(book))
      const pictured = await snapPage(baseName(book))
      const where = [here?.place ? `I am on ${placeName(here.place) || here.place} of the book.` : '', pictured ? 'this-page.png shows the page I am looking at.' : ''].filter(Boolean).join(' ')
      let streamed = ''
      const { code, errors } = await runTool(tool, 'ask', `${where}\n\n${text}`, { cwd: folder ?? '', system: systemPrompt(baseName(book)), resume: session }, line => {
        if (tool !== 'claude') { streamed += `${line}\n`; change({ text: streamed, status: '' }); return }
        let event: { type: string; subtype?: string; session_id?: string; event?: { type: string; delta?: { type: string; text?: string } }; message?: { content?: { type: string; name?: string; input?: object }[] }; result?: string; is_error?: boolean }
        try { event = JSON.parse(line) } catch { return }
        if (event.session_id) session = event.session_id
        if (event.type === 'stream_event' && event.event?.type === 'content_block_delta' && event.event.delta?.type === 'text_delta') {
          streamed += event.event.delta.text ?? ''
          change({ text: streamed, status: '' })
        } else if (event.type === 'assistant') {
          const call = event.message?.content?.find(part => part.type === 'tool_use')
          if (call) { streamed += streamed && !streamed.endsWith('\n\n') ? '\n\n' : ''; change({ status: doing(call as never) }) }
        } else if (event.type === 'result') {
          change(event.is_error ? { text: event.result || 'The AI could not answer.', error: true, status: '' } : { text: event.result ?? streamed, status: '' })
        }
      }, halt => { stop.current = halt })
      const last = messages.at(-1)!
      if (!last.text.trim()) change({ text: code === 0 ? 'No answer came back.' : (errors.trim().split('\n').slice(-3).join('\n') || 'The AI could not answer.'), error: code !== 0, status: '' })
      if (/log ?in|sign ?in|auth|credential|api key/i.test(messages.at(-1)!.text) && messages.at(-1)!.error) setReady(false)
      change({ done: true, status: '' })
    } catch (error) {
      change({ text: String((error as Error)?.message ?? error), error: true, status: '', done: true })
    }
    setBusy(false)
  }

  const fresh = () => setChat({ messages: [], session: '', history: [] })
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
          <button className="soft" disabled={busy} onClick={() => setChanging(true)}>Change</button>
          {useApp && <button className="soft" disabled={busy} onClick={useApp}>Use the AI app</button>}
        </> : <>
        {tools && tools.length > 1
          ? <select value={tool} onChange={e => { setTool(e.target.value as Tool); setReady(null); void signedIn(e.target.value as Tool).then(setReady) }}>
              {tools.map(name => <option key={name} value={name}>{TOOL_NAMES[name]}</option>)}
            </select>
          : <b>{TOOL_NAMES[tool]}</b>}
        {ready === false && <button className="primary" onClick={() => void signIn(tool).then(() => signedIn(tool)).then(setReady)}>Sign in with your {TOOL_NAMES[tool]} account</button>}
        {ready && <span className="ai-ready"><Check size={14} aria-hidden /> Signed in</span>}
        {aiPossible && <button className="soft" disabled={busy} onClick={() => { setVia('key'); fresh() }}>Use a key</button>}
        </>}
        <span className="ai-spacer" />
        {chat.messages.length > 0 && <button className="soft" disabled={busy} onClick={fresh}>New chat</button>}
      </div>

      <div className="ai-messages">
        {!chat.messages.length && (
          <div className="ai-welcome">
            <p>{book ? `Ask anything about ${baseName(book)}. The AI reads the book itself and says which pages it used.` : 'Open a book, then ask anything about it.'}</p>
            {book && <div className="ai-starters">{STARTERS.map(text => <button key={text} className="chip" onClick={() => void ask(text)}>{text}</button>)}</div>}
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
        <div ref={end} />
      </div>

      <form className="ai-compose" onSubmit={e => { e.preventDefault(); void ask(question) }}>
        <textarea rows={2} value={question} disabled={!book} placeholder={book ? 'Ask about this book…' : 'Open a book first'}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(question) } }} />
        {busy
          ? <button type="button" className="ai-send" onClick={() => stop.current()} title="Stop" aria-label="Stop"><Square size={16} aria-hidden /></button>
          : <button className="ai-send" disabled={!question.trim() || !book} title="Ask (Enter)" aria-label="Ask"><ArrowUp size={18} aria-hidden /></button>}
      </form>
    </div>
  )
}
