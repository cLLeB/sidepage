import { canRunTools, extensionOf, fromShelf, isTauri, notebookFolder, saveNote, saveNoteFile } from './platform'
import { stretchesOf } from './insight'
import { placeName } from './library'

// Asking an AI about the open book with the reader's own subscription: the AI's command-line tool (Claude Code,
// Codex or Gemini CLI), signed in once, is run by the app in the book's notes folder (see src-tauri/src/ai.rs).
// The book's text is put there as book.md, page by page, beside the reader's notes.md, so the AI answers from them.
export type Tool = 'claude' | 'codex' | 'gemini'
export const TOOL_NAMES: Record<Tool, string> = { claude: 'Claude', codex: 'ChatGPT (Codex)', gemini: 'Gemini' }
export const TOOL_HOMES: Record<Tool, string> = {
  claude: 'https://claude.com/product/claude-code',
  codex: 'https://developers.openai.com/codex/cli',
  gemini: 'https://github.com/google-gemini/gemini-cli',
}
export const aiPossible = canRunTools

export async function installedTools(): Promise<Tool[]> {
  if (!isTauri || !canRunTools) return []
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<Tool[]>('ai_tools')
}

let counter = 0
// One run of a tool; each line it writes comes to `onLine`. Resolves when it is done.
export async function runTool(tool: Tool, mode: 'ask' | 'status' | 'login', input: string, options: { cwd?: string; system?: string; resume?: string },
  onLine: (line: string) => void, onStart?: (stop: () => void) => void): Promise<{ code: number | null; errors: string }> {
  const [{ invoke }, { listen }] = await Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/event')])
  const id = `ai-${Date.now()}-${++counter}`
  const lines = await listen<{ id: string; line: string }>('ai-line', event => { if (event.payload.id === id) onLine(event.payload.line) })
  let finish: (result: { code: number | null; errors: string }) => void = () => {}
  const done = new Promise<{ code: number | null; errors: string }>(resolve => { finish = resolve })
  const ended = await listen<{ id: string; code: number | null; errors: string }>('ai-done', event => { if (event.payload.id === id) finish(event.payload) })
  try {
    await invoke('ai_start', { id, tool, mode, input, cwd: options.cwd ?? '', system: options.system ?? '', resume: options.resume ?? '' })
    onStart?.(() => void invoke('ai_stop', { id }))
    return await done
  } finally { lines(); ended() }
}

// Whether the tool is signed in (Claude and Codex can say; Gemini is taken to be).
export async function signedIn(tool: Tool): Promise<boolean> {
  if (tool === 'gemini') return true
  let said = ''
  const { code } = await runTool(tool, 'status', '', {}, line => { said += `${line}\n` })
  if (tool === 'claude') { try { return !!JSON.parse(said).loggedIn } catch { return false } }
  return code === 0 && !/not logged in/i.test(said)
}
export const signIn = (tool: Tool) => runTool(tool, 'login', '', {}, () => {})

// The book's words, page by page, written beside its notes for the AI to read. Rewritten only when they change.
export async function prepareBook(book: string, notebook: string): Promise<string | null> {
  const folder = await notebookFolder(notebook)
  if (!folder) return null
  const stretches = await stretchesOf(book)
  const text = [
    `# ${book}`,
    '',
    stretches.length ? 'The full text of the book the reader has open, part by part. Their own notes are in notes.md.' : 'The text of this book could not be read (it may be a scan). Their own notes are in notes.md.',
    '',
    ...stretches.map(stretch => `## ${placeName(stretch.place) || stretch.place}\n\n${lines(stretch.text)}\n`),
  ].join('\n')
  if (sessionKeyOf(book) !== text.length) {
    await saveNote(notebook, 'book.md', text)
    written.set(book, text.length)
  }
  // The file itself, where the AI can read it as it is (a scanned PDF's pages, a photo, a text file).
  const ext = extensionOf(book)
  if (READABLE.includes(ext) && !copied.has(book)) {
    const original = await fromShelf(book)
    if (original) { await saveNoteFile(notebook, `book.${ext}`, original); copied.add(book) }
  }
  return folder
}
const written = new Map<string, number>()
const copied = new Set<string>()
// What the AI can read straight from the file: PDFs and pictures (it sees them), and text.
const READABLE = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'txt', 'md', 'markdown', 'html', 'htm']

// The page the reader is looking at, as a picture, for the AI to see: what has no text (a scan, a comic, a DjVu
// page, a photo, a diagram) is read from it. The largest picture drawn in the open reader is taken.
export async function snapPage(notebook: string): Promise<boolean> {
  const panel = [...document.querySelectorAll<HTMLElement>('.viewer')].find(viewer => viewer.offsetWidth > 0)
  if (!panel) return false
  const seen = (element: HTMLElement) => { const box = element.getBoundingClientRect(); return box.width * box.height > 40000 && box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth }
  const candidates = [...panel.querySelectorAll<HTMLCanvasElement | HTMLImageElement>('canvas, img')].filter(seen)
  const best = candidates.sort((a, b) => {
    const area = (element: HTMLElement) => { const box = element.getBoundingClientRect(); return Math.max(0, Math.min(box.bottom, innerHeight) - Math.max(box.top, 0)) * box.width }
    return area(b) - area(a)
  })[0]
  if (!best) return false
  try {
    const canvas = document.createElement('canvas')
    const width = best instanceof HTMLCanvasElement ? best.width : best.naturalWidth
    const height = best instanceof HTMLCanvasElement ? best.height : best.naturalHeight
    const scale = Math.min(1, 1600 / Math.max(width, height))
    canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale)
    canvas.getContext('2d')!.drawImage(best, 0, 0, canvas.width, canvas.height)
    const picture = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
    if (!picture) return false
    await saveNoteFile(notebook, 'this-page.png', picture)
    return true
  } catch { return false }
}
// A page's words in short lines, broken after sentences: the AI's file reader cuts very long lines short.
function lines(text: string, most = 300): string {
  const out: string[] = []
  let line = ''
  for (const piece of text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?;:])\s+/)) {
    if (line && line.length + piece.length + 1 > most) { out.push(line); line = '' }
    line = line ? `${line} ${piece}` : piece
    while (line.length > most * 2) { const cut = line.lastIndexOf(' ', most) > 0 ? line.lastIndexOf(' ', most) : most; out.push(line.slice(0, cut)); line = line.slice(cut).trim() }
  }
  if (line) out.push(line)
  return out.join('\n')
}
const sessionKeyOf = (book: string) => written.get(book)

export const systemPrompt = (book: string) => [
  `You are the reading companion inside Sidepage, a reader's app. The reader has "${book}" open beside you.`,
  'Its full text is in book.md in the current folder, with a heading for each page (p. 12) or part. Their own notes are in notes.md.',
  'Answer from the book first and say which pages you used, like (p. 12). For a long book, search it with Grep before reading.',
  'When book.md has little or no text (a scan, pictures, a comic), read the file itself if it is here (book.pdf, book.png and so on), and this-page.png, a picture of the page the reader is looking at now.',
  'Be clear and concise. Answer in the language the reader writes in. Use Markdown for lists, tables and formulas.',
].join(' ')
