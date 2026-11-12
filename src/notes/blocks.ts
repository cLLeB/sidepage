import { currentTheme } from '../lib/theme'
import { webFetch } from '../lib/net'

// More code blocks that come alive in a note, each by its own open source project:
//   python     (Pyodide)      Python code with a Run button; its output, and any matplotlib figure, under it
//   javascript (the browser)  JavaScript with a Run button, run apart from the app, its console under it
//   algebra    (nerdamer)     one line per step: diff, integrate, solve, factor, expand, simplify, written out
//   chart      (Mermaid)      a small table ("Year, Sales" then rows) drawn as a bar or line chart, or a pie
//   music      (abcjs)        a tune written in ABC notation, drawn as a score that can be played
//   geometry   (JSXGraph)     points, lines, circles and graphs you can drag
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const failed = (what: string, error: unknown) => `<p class="diagram-error">${what}: ${escape(String((error as Error)?.message ?? error).split('\n')[0])}</p>`

// ── Running code: the code shown as it is, a Run button, and what it printed ──
// The note's editor shows a block's drawing as a copy of its HTML, so nothing can be wired to the button itself:
// one listener on the page answers every Run (and Play) button, reading the code from the block it is in.
type Run = (code: string, out: HTMLElement) => Promise<void>
const RUNS: Record<string, Run> = {}
function runner(code: string, holder: HTMLElement, label: string, kind: string) {
  holder.innerHTML = `<pre class="run-code"><code>${escape(code)}</code></pre><div class="run-bar"><button type="button" class="run-button" data-run="${kind}">▶ Run</button><span class="run-what">${label}</span></div><div class="run-out" hidden></div>`
  listen()
}
let listening = false
function listen() {
  if (listening) return
  listening = true
  // A tap on these buttons, or a drag on a board, must not open the block for editing.
  const inside = (e: Event) => (e.target as HTMLElement)?.closest?.('.run-button, .play-button, .geometry-live')
  for (const kind of ['mousedown', 'pointerdown'] as const) document.addEventListener(kind, e => { if (inside(e)) e.stopPropagation() }, true)
  document.addEventListener('click', async e => {
    const button = (e.target as HTMLElement)?.closest?.<HTMLButtonElement>('.run-button, .play-button')
    if (!button) return
    e.preventDefault(); e.stopPropagation()
    const block = button.closest<HTMLElement>('.preview') ?? button.parentElement!.parentElement!
    if (button.classList.contains('play-button')) return void play(button, block)
    const out = block.querySelector<HTMLElement>('.run-out')
    const code = block.querySelector('.run-code')?.textContent ?? ''
    const run = RUNS[button.dataset.run ?? '']
    if (!out || !run) return
    button.disabled = true
    out.hidden = false
    out.textContent = 'Running…'
    try { await run(code, out) } catch (error) { out.innerHTML = `<span class="run-error">${escape(String((error as Error)?.message ?? error))}</span>` }
    button.disabled = false
  }, true)
  // Geometry boards are made live when they come on screen (see drawGeometry).
  new MutationObserver(() => { for (const board of document.querySelectorAll<HTMLElement>('.geometry-live:not(.mounted)')) void mountGeometry(board) })
    .observe(document.body, { childList: true, subtree: true })
}

// Python, through Pyodide (CPython built for the web), fetched once from its CDN the first time it runs.
const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/'
type Pyodide = { runPythonAsync(code: string): Promise<unknown>; loadPackagesFromImports(code: string): Promise<void>; setStdout(options: { batched(text: string): void }): void; setStderr(options: { batched(text: string): void }): void }
let pyodide: Promise<Pyodide> | null = null
const loadPython = () => (pyodide ??= (async () => {
  const module = await import(/* @vite-ignore */ `${PYODIDE}pyodide.mjs`) as { loadPyodide(options: { indexURL: string }): Promise<Pyodide> }
  return module.loadPyodide({ indexURL: PYODIDE })
})().catch(error => { pyodide = null; throw error }))
RUNS.python = async (code, out) => {
  out.textContent = 'Starting Python… (the first time, it is fetched: about 10 MB)'
  const python = await loadPython()
  out.textContent = 'Running…'
  let printed = ''
  python.setStdout({ batched: text => { printed += `${text}\n` } })
  python.setStderr({ batched: text => { printed += `${text}\n` } })
  await python.loadPackagesFromImports(code)
  const result = await python.runPythonAsync(`${code}\n`)
  // A matplotlib figure is shown as a picture under the output.
  const figure = await python.runPythonAsync(`
import sys
_picture = ''
if 'matplotlib.pyplot' in sys.modules:
    import io, base64
    _plt = sys.modules['matplotlib.pyplot']
    if _plt.get_fignums():
        _buffer = io.BytesIO(); _plt.savefig(_buffer, format='png', dpi=110, bbox_inches='tight'); _plt.close('all')
        _picture = base64.b64encode(_buffer.getvalue()).decode()
_picture`) as string
  const shown = printed || (result !== undefined && result !== null ? String(result) : '')
  out.innerHTML = `${shown ? `<pre>${escape(shown)}</pre>` : figure ? '' : '<span class="run-quiet">Done, nothing printed.</span>'}${figure ? `<img alt="Figure" src="data:image/png;base64,${figure}">` : ''}`
}
async function drawPython(code: string, holder: HTMLElement) { runner(code, holder, 'Python', 'python') }

// JavaScript, in a worker of its own: it cannot touch the note or the app, and is stopped after ten seconds.
RUNS.javascript = (code, out) => new Promise<void>(resolve => {
  const source = `const lines = []; const show = (...parts) => lines.push(parts.map(part => typeof part === 'string' ? part : JSON.stringify(part)).join(' '));
self.console = { log: show, info: show, warn: show, error: show };
(async () => { try { const result = await (async () => { ${code}\n })(); if (result !== undefined) show(result) } catch (error) { lines.push(String(error)) } postMessage(lines.join('\\n')) })()`
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
  const worker = new Worker(url)
  const done = (text: string) => { worker.terminate(); URL.revokeObjectURL(url); out.innerHTML = text ? `<pre>${escape(text)}</pre>` : '<span class="run-quiet">Done, nothing printed.</span>'; resolve() }
  const timer = setTimeout(() => done('Stopped after ten seconds.'), 10_000)
  worker.onmessage = e => { clearTimeout(timer); done(String(e.data)) }
  worker.onerror = e => { clearTimeout(timer); e.preventDefault(); done(e.message) }
})
async function drawJavaScript(code: string, holder: HTMLElement) { runner(code, holder, 'JavaScript', 'javascript') }

// ── Algebra, worked by nerdamer and written out with KaTeX ──
async function drawAlgebra(text: string, holder: HTMLElement) {
  const loaded = await import('nerdamer') as unknown as { default: ((expression: string) => { toTeX?(): string; toString(): string }) & { convertToLaTeX(text: string): string } }
  const nerdamer = loaded.default
  const { default: katex } = await import('katex')
  const tex = (code: string) => katex.renderToString(code, { throwOnError: false, displayMode: false })
  const rows = text.split('\n').filter(line => line.trim()).map(line => {
    if (line.trim().startsWith('#')) return `<tr><td colspan="2" class="sum-note">${escape(line.replace(/^\s*#\s*/, ''))}</td></tr>`
    try {
      const asked = nerdamer(line)
      // "solve" answers with a list; each answer is shown.
      const answer = asked.toTeX ? asked.toTeX() : nerdamer.convertToLaTeX(asked.toString())
      const shownAsk = `<code>${escape(line)}</code>`
      return `<tr><td class="algebra-ask">${shownAsk}</td><td class="sum-answer">= ${tex(answer)}</td></tr>`
    } catch (error) {
      return `<tr><td>${escape(line)}</td><td><span class="sum-error">${escape(String((error as Error).message))}</span></td></tr>`
    }
  })
  holder.innerHTML = `<table class="sums algebra">${rows.join('')}</table>`
}

// ── A chart from a small table, drawn by Mermaid ──
// "pie" on the first line draws a pie; otherwise the first column runs along the bottom and each other column is
// a series: the first as bars, the rest as lines.
async function drawChart(text: string, holder: HTMLElement) {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'))
  const pie = /^pie\b/i.test(lines[0] ?? '')
  const title = (pie ? lines.shift()!.replace(/^pie\s*/i, '') : '') || ''
  const rows = lines.map(line => line.split(/\s*[,;\t|]\s*/).filter(cell => cell !== ''))
  const numeric = (cell: string) => /^-?[\d.]+%?$/.test(cell.replace(/[ ,](?=\d{3}\b)/g, ''))
  const header = rows[0] && !rows[0].slice(1).every(numeric) ? rows.shift()! : null
  const quote = (text: string) => `"${text.replace(/"/g, "'")}"`
  let code: string
  if (pie) {
    code = `pie${title ? ` title ${title}` : ''}\n${rows.map(row => `  ${quote(row[0])} : ${parseFloat(row[1])}`).join('\n')}`
  } else {
    const series = (header?.slice(1) ?? rows[0]?.slice(1).map((_, i) => `Series ${i + 1}`)) ?? []
    const values = series.map((_, column) => rows.map(row => parseFloat((row[column + 1] ?? '0').replace(/[ ,](?=\d{3}\b)/g, ''))))
    const all = values.flat().filter(Number.isFinite)
    code = ['xychart-beta',
      `  x-axis ${header ? `${quote(header[0])} ` : ''}[${rows.map(row => quote(row[0])).join(', ')}]`,
      `  y-axis ${series.length === 1 ? `${quote(series[0])} ` : ''}${Math.min(0, ...all)} --> ${Math.round(Math.max(...all) * 1.1)}`,
      ...values.map((list, i) => `  ${i === 0 ? 'bar' : 'line'} [${list.map(value => (Number.isFinite(value) ? value : 0)).join(', ')}]`),
    ].join('\n')
    if (series.length > 1) holder.dataset.legend = series.join(' · ')
  }
  const { default: mermaid } = await import('mermaid')
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: currentTheme() === 'dark' ? 'dark' : 'neutral', fontFamily: 'inherit' })
  try {
    holder.innerHTML = (await mermaid.render(`sidepage-chart-${Date.now()}${Math.random().toString(36).slice(2, 6)}`, code)).svg
    if (holder.dataset.legend) holder.insertAdjacentHTML('beforeend', `<p class="chart-legend">Bars: ${escape(holder.dataset.legend.split(' · ')[0])} · Lines: ${escape(holder.dataset.legend.split(' · ').slice(1).join(', '))}</p>`)
  } catch (error) { holder.innerHTML = failed('This chart has a mistake in it', error) }
}

// ── Music written in ABC notation, drawn as a score with a Play button (abcjs) ──
async function drawMusic(text: string, holder: HTMLElement) {
  const abcjs = await import('abcjs')
  const score = document.createElement('div')
  score.className = 'music-score'
  // Drawn off screen first: abcjs measures as it draws.
  score.style.cssText = 'position:fixed;left:-9999px;width:560px'
  document.body.append(score)
  abcjs.renderAbc(score, text, { staffwidth: 520, add_classes: true, foregroundColor: currentTheme() === 'dark' ? '#e8e8ea' : '#2e3035' })
  score.removeAttribute('style')
  holder.append(score)
  if (abcjs.synth.supportsAudio()) holder.insertAdjacentHTML('beforeend', `<div class="run-bar"><button type="button" class="play-button run-button" data-abc="${escape(text).replace(/"/g, '&quot;')}">▶ Play</button></div>`)
  listen()
}
let playing: { stop(): void; button: HTMLElement } | null = null
async function play(button: HTMLButtonElement, block: HTMLElement) {
  if (playing) { playing.stop(); const was = playing.button; playing = null; was.textContent = '▶ Play'; if (was === button) return }
  const abcjs = await import('abcjs')
  const hidden = document.createElement('div')
  const tune = abcjs.renderAbc(hidden, button.dataset.abc ?? block.querySelector('[data-abc]')?.getAttribute('data-abc') ?? '')[0]
  button.textContent = 'Loading the sounds…'
  try {
    const synth = new abcjs.synth.CreateSynth()
    await synth.init({ visualObj: tune })
    await synth.prime()
    void synth.start()
    playing = { stop: () => synth.stop(), button }
    button.textContent = '■ Stop'
  } catch { button.textContent = 'The sounds need the internet the first time' }
}

// ── Geometry you can drag (JSXGraph) ──
//   A = (0, 0)          a point          circle A 2       a circle round A of radius 2
//   line A B            a line           circle A B       a circle round A through B
//   segment A B         a segment        polygon A B C    a filled shape
//   triangle A B C      a triangle       y = sin(x)       a graph
async function drawGeometry(text: string, holder: HTMLElement) {
  holder.innerHTML = `<div class="geometry-live" data-geometry="${escape(text).replace(/"/g, '&quot;')}"></div>`
  listen()
}
async function mountGeometry(box: HTMLElement) {
  box.classList.add('mounted')
  const text = box.dataset.geometry ?? ''
  const [{ default: JXG }] = await Promise.all([import('jsxgraph'), import('../../node_modules/jsxgraph/distrib/jsxgraph.css')])
  const width = Math.min(560, Math.max(240, (box.parentElement?.clientWidth ?? 520) - 8))
  box.id ||= `sidepage-board-${Date.now()}${Math.random().toString(36).slice(2, 6)}`
  box.classList.add('jxgbox', 'geometry-board')
  box.style.width = `${width}px`
  box.style.height = `${Math.round(width * 0.66)}px`
  const points: Record<string, unknown> = {}
  const lines = text.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'))
  const coordinates = lines.flatMap(line => [...line.matchAll(/\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g)].map(match => [Number(match[1]), Number(match[2])]))
  const xs = coordinates.map(([x]) => x), ys = coordinates.map(([, y]) => y)
  const pad = 2
  const bounds: [number, number, number, number] = coordinates.length
    ? [Math.min(...xs, 0) - pad, Math.max(...ys, 0) + pad, Math.max(...xs, 0) + pad, Math.min(...ys, 0) - pad]
    : [-6, 5, 6, -5]
  const dark = currentTheme() === 'dark'
  const board = JXG.JSXGraph.initBoard(box.id, { boundingbox: bounds, axis: true, keepaspectratio: true, showCopyright: false, showNavigation: false, pan: { enabled: false }, defaultAxes: { x: { strokeColor: dark ? '#9a9ca5' : '#6d6f78' }, y: { strokeColor: dark ? '#9a9ca5' : '#6d6f78' } } } as never)
  const colour = dark ? '#8ecbff' : '#2f6fed'
  const named = (names: string[]) => names.map(name => points[name])
  const problems: string[] = []
  for (const line of lines) {
    let match: RegExpMatchArray | null
    try {
      if ((match = line.match(/^(\w+)\s*=\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/))) points[match[1]] = board.create('point', [Number(match[2]), Number(match[3])], { name: match[1], size: 3, color: colour })
      else if ((match = line.match(/^(?:y|f\(x\))\s*=\s*(.+)$/i))) {
        const { compile } = await import('mathjs')
        const formula = compile(match[1])
        board.create('functiongraph', [(x: number) => Number(formula.evaluate({ x })), bounds[0], bounds[2]], { strokeColor: colour, strokeWidth: 2 })
      } else if ((match = line.match(/^(line|segment)\s+(\w+)\s+(\w+)$/i))) board.create(match[1].toLowerCase(), named([match[2], match[3]]), { strokeColor: colour })
      else if ((match = line.match(/^circle\s+(\w+)\s+(-?[\d.]+)$/i))) board.create('circle', [points[match[1]], Number(match[2])], { strokeColor: colour })
      else if ((match = line.match(/^circle\s+(\w+)\s+(\w+)$/i))) board.create('circle', named([match[1], match[2]]), { strokeColor: colour })
      else if ((match = line.match(/^(polygon|triangle)\s+(.+)$/i))) board.create('polygon', named(match[2].split(/\s+/)), { fillColor: colour, fillOpacity: 0.15, borders: { strokeColor: colour } })
      else if ((match = line.match(/^angle\s+(\w+)\s+(\w+)\s+(\w+)$/i))) board.create('angle', named([match[1], match[2], match[3]]), { radius: 0.8, fillColor: colour, fillOpacity: 0.25 })
      else problems.push(line)
    } catch { problems.push(line) }
  }
  if (problems.length) box.insertAdjacentHTML('afterend', `<p class="diagram-error">Not understood: ${problems.map(escape).join(' · ')}</p>`)
}

// ── A molecule by its name: asked of PubChem for its structure (SMILES), then drawn as any other ──
export async function smilesOf(line: string): Promise<{ smiles: string; name?: string }> {
  const text = line.trim()
  // SMILES has no spaces and is mostly symbols and capitals ("CC(=O)O"); a name is a word ("caffeine").
  const looksLikeSmiles = !/\s/.test(text) && (/[=#()[\]@\d]/.test(text) || /^[BCNOPSFIclbrnos]+$/.test(text)) && !/^[a-z]{4,}$/.test(text)
  if (looksLikeSmiles) return { smiles: text }
  const answer = await (await webFetch(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(text)}/property/IsomericSMILES,SMILES,ConnectivitySMILES/JSON`)).json() as { PropertyTable?: { Properties?: Record<string, string>[] } }
  const found = answer.PropertyTable?.Properties?.[0]
  const smiles = found?.IsomericSMILES ?? found?.SMILES ?? found?.ConnectivitySMILES
  if (!smiles) throw new Error(`PubChem does not know “${text}”`)
  return { smiles, name: text }
}

export const MORE_DRAWN: Record<string, (text: string, holder: HTMLElement) => Promise<void>> = {
  python: drawPython, py: drawPython, javascript: drawJavaScript, js: drawJavaScript,
  algebra: drawAlgebra, chart: drawChart, music: drawMusic, abc: drawMusic, geometry: drawGeometry,
}
