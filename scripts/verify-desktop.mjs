// Launches the built Sidepage app with a debug port and runs checks inside its window.
import { spawn } from 'node:child_process'

const exe = process.argv[2]
const port = 9333
const app = spawn(exe, process.argv.slice(3), {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
  detached: true,
  stdio: 'ignore',
})
const sleep = ms => new Promise(r => setTimeout(r, ms))

let target
for (let i = 0; i < 40 && !target; i++) {
  await sleep(500)
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
    target = list.find(t => t.type === 'page')
  } catch { /* not up yet */ }
}
if (!target) { console.log('no debug target'); app.kill(); process.exit(1) }

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise(r => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
ws.addEventListener('message', e => {
  const msg = JSON.parse(e.data)
  if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
})
const evaluate = expression => new Promise(resolve => {
  pending.set(++id, msg => resolve(msg.result?.exceptionDetails
    ? { error: msg.result.exceptionDetails.exception?.description ?? msg.result.exceptionDetails.text }
    : msg.result?.result?.value))
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true } }))
})

await sleep(4000)
console.log(JSON.stringify(await evaluate(`return { href: location.href, targets: ${JSON.stringify(target.url)}, body: document.body.innerHTML.slice(0, 300) }`)))
const checks = `
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const errs = []
  window.addEventListener('unhandledrejection', e => errs.push(String(e.reason?.message ?? e.reason)))
  window.addEventListener('error', e => errs.push(e.message))
  const drop = async name => {
    const blob = await (await fetch('http://localhost:5173/samples/' + name)).blob()
    const dt = new DataTransfer()
    dt.items.add(new File([blob], name))
    document.querySelector('.app').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
    await wait(5000)
  }
  const click = text => [...document.querySelectorAll('button')].find(b => b.textContent === text)?.click()
  const out = { origin: location.origin, tauri: '__TAURI_INTERNALS__' in window, openedAtLaunch: [...document.querySelectorAll('.dv-tab')].map(t => t.textContent) }
  await drop('sample.pdf'); out.pdf = document.querySelectorAll('.pdfViewer .page canvas').length
  await drop('sample.epub'); out.epub = !!document.querySelector('foliate-view')?.renderer?.getContents?.()[0]
  await drop('sample.pptx'); out.pptx = (document.querySelector('.ppt-host')?.textContent ?? '').trim().length > 20 || !!document.querySelector('.flipbook.tinted canvas')
  await drop('sample.docx'); out.docx = document.querySelectorAll('section.docx').length
  await drop('sample.cb7'); out.comic = [...document.querySelectorAll('foliate-view')].map(v => v.book?.sections?.length)
  out.notes = !!document.querySelector('.written-note .ProseMirror')
  // Quote a paragraph from the EPUB into the written note.
  const book = document.querySelector('foliate-view').renderer.getContents()[0].doc
  const range = book.createRange(); range.selectNodeContents(book.querySelector('p'))
  book.getSelection().removeAllRanges(); book.getSelection().addRange(range)
  ;[...document.querySelectorAll('.viewer-bar button')].filter(b => b.textContent === 'Quote').forEach(b => b.click())
  click('Canvas'); await wait(5000); out.canvas = !!document.querySelector('.excalidraw canvas')
  click('Mind map'); await wait(3000); out.mind = !!document.querySelector('.mindmap-note .map-canvas, .mindmap-note me-root')
  click('Flip'); await wait(4000); out.flip = !!document.querySelector('.flipbook canvas')
  out.tabs = [...document.querySelectorAll('.dv-tab')].map(t => t.textContent)
  out.errs = errs
  return out
`
console.log(JSON.stringify(await evaluate(checks), null, 1))
ws.close()
app.kill()
process.exit(0)
