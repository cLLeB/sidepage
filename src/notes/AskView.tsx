import { useEffect, useRef, useState } from 'react'
import 'katex/dist/katex.min.css'
import { ArrowUp, Check, Copy, NotebookPen, RotateCcw, Square } from 'lucide-react'
import { baseName, onPlace, openOutside, placeNow, sendQuote } from '../lib/platform'
import { placeName } from '../lib/library'
import { usePref } from '../lib/prefs'
import { aiPossible, installedTools, prepareBook, runTool, signedIn, signIn, systemPrompt, TOOL_HOMES, TOOL_NAMES, type Tool } from '../lib/ai'

type Message = { from: 'reader' | 'ai'; text: string; status?: string; error?: boolean; done?: boolean }
type Chat = { messages: Message[]; session: string }
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

export default function AskView() {
  const [here, setHere] = useState(placeNow)
  const [tools, setTools] = useState<Tool[] | null>(null)
  const [tool, setTool] = usePref<Tool>('ai-tool', 'claude')
  const [ready, setReady] = useState<boolean | null>(null)
  const [chat, setChat] = useState<Chat>({ messages: [], session: '' })
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(-1)
  const stop = useRef<() => void>(() => {})
  const end = useRef<HTMLDivElement>(null)
  const book = here?.book ?? ''

  useEffect(() => onPlace(setHere), [])
  useEffect(() => { setChat(chats.get(book) ?? { messages: [], session: '' }) }, [book])
  useEffect(() => { if (book) chats.set(book, chat) }, [book, chat])
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [chat])

  const look = async () => {
    const found = await installedTools()
    setTools(found)
    const use = found.includes(tool) ? tool : found[0]
    if (use && use !== tool) setTool(use)
    setReady(use ? await signedIn(use) : null)
  }
  useEffect(() => { if (aiPossible) void look() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const ask = async (text: string) => {
    if (!text.trim() || busy || !book) return
    setQuestion('')
    setBusy(true)
    const asked: Message = { from: 'reader', text }
    const answer: Message = { from: 'ai', text: '', status: 'Opening the book…' }
    let messages = [...chat.messages, asked, answer]
    let session = chat.session
    const show = () => setChat({ messages: [...messages], session })
    const change = (patch: Partial<Message>) => { messages = [...messages.slice(0, -1), { ...messages.at(-1)!, ...patch }]; show() }
    show()
    try {
      const folder = await prepareBook(book, baseName(book))
      const where = here?.place ? `I am on ${placeName(here.place) || here.place} of the book.` : ''
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

  if (!aiPossible) {
    return (
      <div className="note ask-ai">
        <div className="review-empty">
          <h2>Ask AI</h2>
          <p>Asking an AI about your book uses the AI's own app for computers (Claude Code, Codex or Gemini CLI) signed in with your subscription, so it works in Sidepage on Windows, macOS and Linux.</p>
        </div>
      </div>
    )
  }
  if (tools && !tools.length) {
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
        </div>
      </div>
    )
  }
  return (
    <div className="note ask-ai">
      <div className="ai-bar">
        {tools && tools.length > 1
          ? <select value={tool} onChange={e => { setTool(e.target.value as Tool); setReady(null); void signedIn(e.target.value as Tool).then(setReady) }}>
              {tools.map(name => <option key={name} value={name}>{TOOL_NAMES[name]}</option>)}
            </select>
          : <b>{TOOL_NAMES[tool]}</b>}
        {ready === false && <button className="primary" onClick={() => void signIn(tool).then(() => signedIn(tool)).then(setReady)}>Sign in with your {TOOL_NAMES[tool]} account</button>}
        {ready && <span className="ai-ready"><Check size={14} aria-hidden /> Signed in</span>}
        <span className="ai-spacer" />
        {chat.messages.length > 0 && <button className="soft" disabled={busy} onClick={() => setChat({ messages: [], session: '' })}>New chat</button>}
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
