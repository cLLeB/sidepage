import type { ModelMessage } from 'ai'
import { baseName, loadNote } from './platform'
import { askBooks, stretchesOf } from './insight'
import { placeName } from './library'
import { webFetch } from './net'
import { getPref, setPref } from './prefs'

// Asking an AI about the open book with the reader's own key, straight from the app: what phones, tablets and the
// web app use, where the AI's computer apps (see ai.ts) cannot run. The AI SDK speaks to each service; the book is
// searched and read by Sidepage itself, through the tools below, so the AI answers from it and names its pages.
// The key stays on this device and goes only to the service it belongs to.
export type Service = 'google' | 'anthropic' | 'openai' | 'other'
export const SERVICES: Record<Service, { name: string; model: string; keyHome: string; plan: string }> = {
  google: { name: 'Google Gemini', model: 'gemini-flash-latest', keyHome: 'https://aistudio.google.com/apikey', plan: 'Free with a Google account' },
  anthropic: { name: 'Anthropic Claude', model: 'claude-sonnet-5-5', keyHome: 'https://console.anthropic.com/settings/keys', plan: 'Paid by use' },
  openai: { name: 'OpenAI ChatGPT', model: 'gpt-5.4-mini', keyHome: 'https://platform.openai.com/api-keys', plan: 'Paid by use' },
  other: { name: 'Another service', model: '', keyHome: '', plan: 'OpenRouter, Groq, Ollama, LM Studio…' },
}

export type Connection = { service: Service; key: string; model: string; address: string }
const KEY = 'ai-connection'
export const connection = () => getPref<Connection | null>(KEY, null)
export const connect = (value: Connection | null) => setPref(KEY, value)
// Ready to ask: a key (a server of one's own may need none, but it needs its address and model).
export const connected = (value = connection()) => !!value && (value.service === 'other' ? !!value.address && !!value.model : !!value.key)

// The app's own requests go out from outside its web view (no cross-site limits), as for every other service.
const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => webFetch(String(input instanceof Request ? input.url : input), init)) as typeof fetch

async function modelOf(value: Connection) {
  const model = value.model.trim() || SERVICES[value.service].model
  if (value.service === 'google') return (await import('@ai-sdk/google')).createGoogle({ apiKey: value.key, fetch: fetcher })(model)
  if (value.service === 'anthropic') return (await import('@ai-sdk/anthropic')).createAnthropic({ apiKey: value.key, fetch: fetcher, headers: { 'anthropic-dangerous-direct-browser-access': 'true' } })(model)
  if (value.service === 'openai') return (await import('@ai-sdk/openai')).createOpenAI({ apiKey: value.key, fetch: fetcher })(model)
  const address = value.address.trim().replace(/\/+$/, '')
  return (await import('@ai-sdk/openai-compatible')).createOpenAICompatible({ name: 'own', baseURL: address, apiKey: value.key || undefined, fetch: fetcher })(model)
}

// The page the reader is looking at, as a picture: for what has no text (a scan, a comic, a photo, a diagram).
export async function pagePicture(): Promise<Blob | null> {
  const panel = [...document.querySelectorAll<HTMLElement>('.viewer')].find(viewer => viewer.offsetWidth > 0)
  if (!panel) return null
  const seen = (element: HTMLElement) => { const box = element.getBoundingClientRect(); return box.width * box.height > 40000 && box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth }
  const area = (element: HTMLElement) => { const box = element.getBoundingClientRect(); return Math.max(0, Math.min(box.bottom, innerHeight) - Math.max(box.top, 0)) * box.width }
  const best = [...panel.querySelectorAll<HTMLCanvasElement | HTMLImageElement>('canvas, img')].filter(seen).sort((a, b) => area(b) - area(a))[0]
  if (!best) return null
  try {
    const canvas = document.createElement('canvas')
    const width = best instanceof HTMLCanvasElement ? best.width : best.naturalWidth
    const height = best instanceof HTMLCanvasElement ? best.height : best.naturalHeight
    const scale = Math.min(1, 1600 / Math.max(width, height))
    canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale)
    canvas.getContext('2d')!.drawImage(best, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  } catch { return null }
}

const instructions = (book: string) => [
  `You are the reading companion inside Sidepage, a reader's app. The reader has "${book}" open beside you.`,
  'Answer from the book first, using your tools: search_book to find where something is said, read_part to read a page or part, read_notes for the reader\'s own notes.',
  'The page the reader is on is given with their question. Say which pages you used, like (p. 12).',
  'When a page has no text (a scan, pictures, a comic), a picture of it may be given: read it from the picture.',
  'Be clear and concise. Answer in the language the reader writes in. Use Markdown for lists, tables and formulas.',
].join(' ')

const clip = (text: string, most: number) => text.length > most ? `${text.slice(0, most)}…` : text

// What a step is doing, said plainly.
const doing = (name: string, input: { query?: string; part?: string }) =>
  name === 'search_book' ? `Searching the book for “${input.query ?? ''}”…` : name === 'read_notes' ? 'Reading your notes…' : `Reading ${input.part ?? 'the book'}…`

// One question: the answer comes as it is written to `onText`, what the AI is doing to `onStatus`. The history
// (the conversation so far, in the AI's own form) is returned with the question and answer added.
export async function askDirect(book: string, place: string, question: string, history: ModelMessage[],
  onText: (text: string) => void, onStatus: (status: string) => void, signal: AbortSignal): Promise<ModelMessage[]> {
  const value = connection()
  if (!value || !connected(value)) throw new Error('Connect an AI first.')
  const [{ streamText, tool, jsonSchema, stepCountIs }, model, stretches] = await Promise.all([import('ai'), modelOf(value), stretchesOf(book)])
  const partOf = (name: string) => {
    const wanted = name.trim().toLowerCase().replace(/^page\s*/, 'p. ').replace(/^p\.?\s*/, 'p. ')
    return stretches.find(stretch => (placeName(stretch.place) || stretch.place).toLowerCase() === wanted) ?? stretches.find(stretch => stretch.place === name)
  }
  const tools = {
    search_book: tool({
      description: 'Search the open book for passages about something. Returns the best passages with the page or part each is on.',
      inputSchema: jsonSchema<{ query: string }>({ type: 'object', properties: { query: { type: 'string', description: 'Words to look for' } }, required: ['query'] }),
      execute: async ({ query }) => {
        const found = await askBooks(query, 8, book)
        return found.length ? found.map(answer => ({ part: placeName(answer.place) || answer.place, passage: answer.sentence })) : 'Nothing in the book matches those words. Try other words.'
      },
    }),
    read_part: tool({
      description: 'Read one page or part of the open book in full, by its name as given in search results or with the question, such as "p. 12" or "part 3".',
      inputSchema: jsonSchema<{ part: string }>({ type: 'object', properties: { part: { type: 'string', description: 'The page or part, such as "p. 12"' } }, required: ['part'] }),
      execute: async ({ part }) => {
        const found = partOf(part)
        return found ? clip(found.text, 12000) : `There is no ${part}. The book has ${stretches.length} parts, from ${placeName(stretches[0]?.place ?? '') || 'the start'} to ${placeName(stretches.at(-1)?.place ?? '') || 'the end'}.`
      },
    }),
    read_notes: tool({
      description: "Read the reader's own notes on this book.",
      inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {} }),
      execute: async () => clip((await loadNote(baseName(book), 'notes.md')) ?? '', 12000) || 'The reader has no notes on this book yet.',
    }),
  }

  // The question, with the page the reader is on: its words, or failing those, a picture of it.
  const here = stretches.find(stretch => stretch.place === place)
  const name = placeName(place) || place
  const lead = stretches.length
    ? here ? `I am on ${name}. Its text:\n\n${clip(here.text, 6000)}` : name ? `I am on ${name}.` : ''
    : 'The text of this book could not be read (it may be a scan).'
  const picture = !here || here.text.trim().length < 200 ? await pagePicture() : null
  const asked: ModelMessage = {
    role: 'user',
    content: [
      { type: 'text', text: `${lead}\n\n${question}`.trim() },
      ...(picture ? [{ type: 'image' as const, image: new Uint8Array(await picture.arrayBuffer()), mediaType: 'image/jpeg' }] : []),
    ],
  }
  // Pictures from earlier questions are not sent again: they are large, and the answers already say what they showed.
  const earlier = history.map(message => message.role === 'user' && Array.isArray(message.content)
    ? { ...message, content: message.content.filter(part => part.type !== 'image') } as ModelMessage : message)

  const result = streamText({ model, system: instructions(baseName(book)), messages: [...earlier, asked], tools, stopWhen: stepCountIs(8), abortSignal: signal })
  let text = ''
  let failed: unknown = null
  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') { text += part.text; onText(text); onStatus('') }
    else if (part.type === 'tool-call') { if (text && !text.endsWith('\n\n')) text += '\n\n'; onStatus(doing(part.toolName, (part.input ?? {}) as never)) }
    else if (part.type === 'error') failed = part.error
  }
  if (failed) throw failed
  return [...history, asked, ...(await result.responseMessages)]
}

// Asking in the AI's own app instead, with the subscription the reader has there (Claude Pro, ChatGPT Plus, Gemini):
// another app cannot ask through it, so the page is copied for the reader to paste, and the app is opened.
export const OWN_APPS = [
  { name: 'Claude', home: 'https://claude.ai/new' },
  { name: 'ChatGPT', home: 'https://chatgpt.com/' },
  { name: 'Gemini', home: 'https://gemini.google.com/app' },
]
export async function pageToPaste(book: string, place: string): Promise<string> {
  const stretches = await stretchesOf(book)
  const here = stretches.find(stretch => stretch.place === place)
  const name = placeName(place)
  return [
    `I am reading "${baseName(book)}"${name ? `, on ${name}` : ''}. Help me understand it. Here is the text of the page:`,
    '',
    here ? clip(here.text.replace(/\s+/g, ' ').trim(), 8000) : '(This page has no text: it may be a scan or a picture.)',
    '',
    'My question: ',
  ].join('\n')
}

// What went wrong, said so the reader can act on it.
export function plainError(error: unknown): string {
  const raw = error as { statusCode?: number; message?: string; responseBody?: string }
  const said = `${raw?.message ?? error} ${raw?.responseBody ?? ''}`
  if (raw?.statusCode === 401 || raw?.statusCode === 403 || /api key|invalid.*key|unauthori[sz]ed|permission/i.test(said)) return 'The service did not accept the key. Check it in Connect an AI.'
  if (raw?.statusCode === 429 || /quota|rate limit|too many requests|resource.?exhausted/i.test(said)) return 'The usage limit of this key is reached for now. Wait a little, or check your plan on the service\'s site.'
  if (raw?.statusCode === 404 || /model.*(not found|does not exist)|not_found/i.test(said)) return 'The service does not know that model. Check its name in Connect an AI.'
  if (/fetch|network|connect|timed? ?out|dns|offline/i.test(said)) return 'The service could not be reached. Check your internet connection (or that your own server is running).'
  return raw?.message || String(error)
}
