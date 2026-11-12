import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { baseName, sendQuote } from '../lib/platform'
import { placeName } from '../lib/library'
import { loadEveryday, sentencesOf, termsOf, everyday } from '../lib/insight'
import { addStudyCards } from '../lib/methods'

// Tools for the words selected on a page: draw a formula as a graph with sliders for its constants (function-plot
// and math.js), convert a measurement into other units (math.js), and make fill-in-the-gap cards from a passage.
export type Selected = { kind: 'plot' | 'units' | 'cloze'; text: string; place: string }

// ── A formula as it is printed, made into one math.js can read ──
export function readableFormula(text: string) {
  return text.replace(/[−–]/g, '-').replace(/[×·∙⋅]/g, '*').replace(/÷/g, '/').replace(/²/g, '^2').replace(/³/g, '^3').replace(/√\s*\(/g, 'sqrt(').replace(/√\s*(\w+)/g, 'sqrt($1)')
    .replace(/π/g, 'pi').replace(/θ/g, 'theta').replace(/λ/g, 'lambda').replace(/ω/g, 'omega').replace(/α/g, 'alpha').replace(/β/g, 'beta').replace(/μ/g, 'mu').replace(/\s+/g, ' ').trim()
}

function Sheet({ title, onClose, children }: { title: string; onClose(): void; children: React.ReactNode }) {
  return (
    <div className="study-sheet" role="dialog" aria-label={title}>
      <div className="study-sheet-head"><b>{title}</b><button className="menu-x" aria-label="Close" onClick={onClose}><X size={16} aria-hidden /></button></div>
      {children}
    </div>
  )
}

export function SelectionSheet({ book, selected, onClose }: { book: string; selected: Selected; onClose(): void }) {
  if (selected.kind === 'plot') return <FormulaSheet book={book} selected={selected} onClose={onClose} />
  if (selected.kind === 'units') return <UnitsSheet text={selected.text} onClose={onClose} />
  return <ClozeSheet book={book} selected={selected} onClose={onClose} />
}

// ── Plot this formula ──
function FormulaSheet({ book, selected, onClose }: { book: string; selected: Selected; onClose(): void }) {
  const [formula, setFormula] = useState(() => {
    const plain = readableFormula(selected.text)
    // "y = 3x^2 + 2", "F = k x": the right-hand side is drawn.
    const sides = plain.split('=')
    return (sides.length > 1 ? sides.at(-1)! : plain).trim().replace(/(\d)([a-z(])/gi, '$1*$2')
  })
  const [shape, setShape] = useState<{ variable: string; constants: string[]; error: string; value?: string }>({ variable: 'x', constants: [], error: '' })
  const [values, setValues] = useState<Record<string, number>>({})
  const host = useRef<HTMLDivElement>(null)
  // Which letter runs along the bottom (x, else t, else the first), and which are constants to slide.
  useEffect(() => {
    void import('mathjs').then(({ parse, evaluate }) => {
      try {
        const node = parse(formula)
        const names = [...new Set(node.filter(part => part.type === 'SymbolNode' && !(part as unknown as { name: string }).name.match(/^(pi|e|i|sqrt|sin|cos|tan|log|exp|ln|abs)$/)).map(part => (part as unknown as { name: string }).name))]
        const isCall = new Set(node.filter(part => part.type === 'FunctionNode').map(part => (part as unknown as { fn: { name: string } }).fn.name))
        const free = names.filter(name => !isCall.has(name))
        if (!free.length) return setShape({ variable: '', constants: [], error: '', value: String(evaluate(formula)) })
        const variable = free.includes('x') ? 'x' : free.includes('t') ? 't' : free[0]
        setShape({ variable, constants: free.filter(name => name !== variable), error: '' })
      } catch (error) { setShape({ variable: 'x', constants: [], error: String((error as Error).message) }) }
    })
  }, [formula])
  useEffect(() => {
    const el = host.current
    if (!el || shape.error || !shape.variable) return
    let cancelled = false
    void Promise.all([import('function-plot'), import('mathjs')]).then(([loaded, { compile }]) => {
      if (cancelled) return
      // A CommonJS module: its function may come wrapped once more.
      const wrapped = loaded as unknown as { default: unknown }
      const functionPlot = (typeof wrapped.default === 'function' ? wrapped.default : (wrapped.default as { default: unknown }).default) as typeof import('function-plot').default
      const compiled = compile(formula)
      const scope = Object.fromEntries(shape.constants.map(name => [name, values[name] ?? 1]))
      el.replaceChildren()
      try {
        functionPlot({ target: el, width: Math.min(560, el.clientWidth || 520), height: 300, grid: true, data: [{ graphType: 'polyline', fn: (scopeIn: { x: number }) => Number(compiled.evaluate({ ...scope, [shape.variable]: scopeIn.x })) }] } as never)
      } catch (error) { el.textContent = String((error as Error).message) }
    })
    return () => { cancelled = true }
  }, [formula, shape, values])
  const toNotes = () => {
    const fixed = shape.constants.reduce((text, name) => text.replace(new RegExp(`\\b${name}\\b`, 'g'), String(values[name] ?? 1)), formula)
    sendQuote({ text: `\`\`\`plot\ny = ${shape.variable && shape.variable !== 'x' ? fixed.replace(new RegExp(`\\b${shape.variable}\\b`, 'g'), 'x') : fixed}\n\`\`\``, source: '', book, place: selected.place, table: true })
  }
  return (
    <Sheet title="Plot this formula" onClose={onClose}>
      <label className="menu-row">Formula <input className="formula-input" value={formula} onChange={e => setFormula(e.target.value)} spellCheck={false} /></label>
      {shape.error ? <p className="menu-note">{`This formula could not be read: ${shape.error}. Change it above.`}</p>
        : shape.value !== undefined ? <p className="practice-score">{`= ${shape.value}`}</p>
        : <>
          <p className="menu-note">{`Drawn against ${shape.variable}${shape.constants.length ? `. Slide the constants to see what each one does.` : '.'}`}</p>
          {shape.constants.map(name => (
            <label key={name} className="menu-row slider-row">
              <b>{name}</b>
              <input type="range" min={-10} max={10} step={0.1} value={values[name] ?? 1} onChange={e => setValues({ ...values, [name]: Number(e.target.value) })} />
              <span>{(values[name] ?? 1).toFixed(1)}</span>
            </label>
          ))}
          <div ref={host} className="formula-plot" />
          <div className="study-sheet-row"><button className="soft" onClick={toNotes}>Put the graph in my notes</button></div>
        </>}
    </Sheet>
  )
}

// ── Convert a measurement into other units ──
const FAMILIES: [string, string[]][] = [
  ['m', ['mm', 'cm', 'm', 'km', 'in', 'ft', 'yd', 'mi', 'nmi']],
  ['kg', ['mg', 'g', 'kg', 'tonne', 'oz', 'lb', 'stone']],
  ['Pa', ['Pa', 'kPa', 'MPa', 'bar', 'atm', 'psi', 'mmHg']],
  ['J', ['J', 'kJ', 'cal', 'kcal', 'Wh', 'kWh', 'eV', 'BTU']],
  ['K', ['degC', 'degF', 'K']],
  ['m/s', ['m/s', 'km/h', 'mph', 'knot', 'ft/s']],
  ['m^3', ['mL', 'L', 'm^3', 'cup', 'floz', 'gal']],
  ['s', ['ms', 's', 'min', 'h', 'day', 'week', 'year']],
  ['W', ['mW', 'W', 'kW', 'MW', 'hp']],
  ['N', ['N', 'kN', 'lbf', 'dyn']],
  ['m^2', ['mm^2', 'cm^2', 'm^2', 'hectare', 'km^2', 'sqft', 'acre']],
  ['Hz', ['Hz', 'kHz', 'MHz', 'GHz', 'rpm']],
  ['V', ['mV', 'V', 'kV']],
  ['A', ['uA', 'mA', 'A']],
  ['ohm', ['ohm', 'kohm', 'Mohm']],
  ['b', ['b', 'B', 'kB', 'MB', 'GB', 'TB']],
]
const SAID: Record<string, string> = { degC: '°C', degF: '°F', uA: 'µA', 'm^3': 'm³', 'm^2': 'm²', 'cm^2': 'cm²', 'mm^2': 'mm²', 'km^2': 'km²', ohm: 'Ω', kohm: 'kΩ', Mohm: 'MΩ', floz: 'fl oz', sqft: 'sq ft' }
function UnitsSheet({ text, onClose }: { text: string; onClose(): void }) {
  const [rows, setRows] = useState<{ unit: string; value: string }[] | null>(null)
  const [trouble, setTrouble] = useState('')
  useEffect(() => {
    void import('mathjs').then(math => {
      // The micro sign is a prefix here (500 µm), not the Greek letter of a formula.
      const plain = readableFormula(text.replace(/[µμ](?=[a-zA-Z])/g, 'u')).replace(/(\d),(\d{3})/g, '$1$2').replace(/°\s*C\b/g, 'degC').replace(/°\s*F\b/g, 'degF').replace(/Ω/g, 'ohm').replace(/µ|μ/g, 'u')
      const found = plain.match(/(-?\d+(?:\.\d+)?(?:e-?\d+)?)\s*([a-zA-Z°/^\d]+(?:\s*\/\s*[a-zA-Z]+)?)/)
      try {
        if (!found) throw new Error('no measurement')
        const amount = math.unit(Number(found[1]), found[2].replace(/\s+/g, ''))
        const family = FAMILIES.find(([base]) => { try { return amount.equalBase(math.unit(1, base)) } catch { return false } })
        if (!family) throw new Error('no family')
        // A unit this version of math.js does not know is left out, not the whole list.
        setRows(family[1].flatMap(unit => {
          let value: number
          try { value = amount.toNumber(unit) } catch { return [] }
          return [{ unit: SAID[unit] ?? unit, value: Math.abs(value) >= 1e6 || (Math.abs(value) < 1e-3 && value !== 0) ? value.toExponential(3) : value.toLocaleString(undefined, { maximumSignificantDigits: 5 }) }]
        }))
      } catch { setTrouble('Select a number with its unit, such as “25 psi”, “3.5 kg” or “120 km/h”.') }
    })
  }, [text])
  return (
    <Sheet title={`“${text.slice(0, 40)}” in other units`} onClose={onClose}>
      {trouble ? <p className="menu-note">{trouble}</p> : !rows ? <p className="guide-wait">Converting…</p> : (
        <table className="sums units">{rows.map(row => <tr key={row.unit}><td>{row.value}</td><td className="sum-answer">{row.unit}</td></tr>)}</table>
      )}
    </Sheet>
  )
}

// ── Fill-in-the-gap cards from a passage: each of its sentences with one of the book's terms taken out ──
function ClozeSheet({ book, selected, onClose }: { book: string; selected: Selected; onClose(): void }) {
  const [cards, setCards] = useState<{ front: string; back: string; keep: boolean }[] | null>(null)
  const [made, setMade] = useState('')
  useEffect(() => {
    void (async () => {
      await loadEveryday()
      const terms = (await termsOf(book, 60)).map(term => term.term).filter(term => !everyday(term))
      const sentences = sentencesOf(selected.text).length ? sentencesOf(selected.text) : [selected.text]
      const out: { front: string; back: string; keep: boolean }[] = []
      for (const sentence of sentences) {
        // The book's own terms first; failing them, the longest uncommon word of the sentence.
        const lower = sentence.toLowerCase()
        const term = terms.filter(name => new RegExp(`(^|[^\\p{L}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'u').test(lower)).sort((a, b) => b.length - a.length)[0]
          ?? (sentence.match(/\p{L}{7,}/gu) ?? []).filter(word => !everyday(word)).sort((a, b) => b.length - a.length)[0]
        if (!term) continue
        const at = lower.indexOf(term.toLowerCase())
        out.push({ front: `${sentence.slice(0, at)}［ … ］${sentence.slice(at + term.length)}`, back: sentence.slice(at, at + term.length), keep: true })
      }
      setCards(out)
    })()
  }, [book, selected.text])
  const kept = useMemo(() => cards?.filter(card => card.keep) ?? [], [cards])
  return (
    <Sheet title="Gap cards from this passage" onClose={onClose}>
      {!cards ? <p className="guide-wait">Finding the words to hide…</p> : !cards.length ? <p className="guide-wait">No word of this passage is one of the book’s terms.</p> : <>
        <p className="menu-note">Each sentence with one of the book’s terms hidden. Untick the ones you do not want.</p>
        <div className="word-list">
          {cards.map((card, i) => (
            <label key={i} className="word-row cloze-row">
              <input type="checkbox" checked={card.keep} onChange={e => setCards(cards.map((other, j) => (j === i ? { ...other, keep: e.target.checked } : other)))} />
              <div><p className="cloze-front">{card.front}</p><b>{card.back}</b></div>
            </label>
          ))}
        </div>
        <div className="study-sheet-row">
          <button className="primary" disabled={!kept.length} onClick={async () => {
            const count = await addStudyCards(book, kept.map(card => ({ front: card.front, back: card.back, place: selected.place })))
            setMade(`${count} card${count === 1 ? '' : 's'} made: they come up in Review`)
          }}>{`Make ${kept.length} card${kept.length === 1 ? '' : 's'}`}</button>
          {made && <span>{made}</span>}
        </div>
        <p className="menu-note small">{`From ${baseName(book)}, ${placeName(selected.place)}`}</p>
      </>}
    </Sheet>
  )
}
