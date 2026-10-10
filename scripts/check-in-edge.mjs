// Runs a snippet of JavaScript inside the app in a headless Microsoft Edge and prints what it returns.
//   node scripts/check-in-edge.mjs <url> <file.js> [width] [height] [screenshot.png]
// The snippet is the body of an async function. Useful when the app must really render (page turns, PDF pages).
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [url, file, width = '1280', height = '800', shot] = process.argv.slice(2)
const port = 9334
quit()
const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', `--remote-debugging-port=${port}`, `--window-size=${width},${height}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'sidepage-edge-'))}`, '--no-first-run', url,
], { stdio: 'ignore' })
const sleep = ms => new Promise(r => setTimeout(r, ms))
// Edge hands its work to other processes, so the one started here is not the one to stop: every Edge that
// was started on this debugging port is. Otherwise the next run would attach to this run's leftovers.
function quit() {
  const stop = "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | Where-Object { $_.CommandLine -like '*remote-debugging-port=" + port + "*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
  try { execFileSync('powershell', ['-NoProfile', '-Command', stop], { stdio: 'ignore' }) } catch { /* already gone */ }
}

let target
for (let i = 0; i < 40 && !target; i++) {
  await sleep(500)
  try {
    target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page' && t.url.startsWith('http'))
  } catch { /* not up yet */ }
}
if (!target) { console.log('no page'); quit(); process.exit(1) }

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise(r => ws.addEventListener('open', r))
const picture = new Promise(resolve => ws.addEventListener('message', e => {
  const msg = JSON.parse(e.data)
  if (msg.id === 2) resolve(msg.result?.data)
}))
const reply = new Promise(resolve => ws.addEventListener('message', e => {
  const msg = JSON.parse(e.data)
  if (msg.id === 1) resolve(msg.result?.exceptionDetails
    ? { error: msg.result.exceptionDetails.exception?.description ?? msg.result.exceptionDetails.text }
    : msg.result?.result?.value)
}))
await sleep(3000)
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: `(async () => { ${readFileSync(file, 'utf8')} })()`, awaitPromise: true, returnByValue: true } }))
console.log(JSON.stringify(await reply, null, 1))
if (shot) {
  ws.send(JSON.stringify({ id: 2, method: 'Page.captureScreenshot', params: { format: 'png' } }))
  writeFileSync(shot, Buffer.from(await picture, 'base64'))
}
ws.close()
quit()
process.exit(0)
