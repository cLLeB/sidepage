import { useState } from 'react'
import { X } from 'lucide-react'
import { baseName, saveFileAs } from '../lib/platform'

// Making new PDFs from this one (pdf-lib): some of its pages on their own, or it with another PDF after it.
// The book itself is never changed.
export const pagesFrom = (text: string, most: number) => {
  const pages: number[] = []
  for (const part of text.split(/[,;\s]+/).filter(Boolean)) {
    const [a, b] = part.split(/[-–to]+/).map(Number)
    if (!a) continue
    for (let n = a; n <= Math.min(most, b || a); n++) if (n >= 1 && !pages.includes(n)) pages.push(n)
  }
  return pages
}

export function PageTools({ file, pages, current, onClose }: { file: File; pages: number; current: number; onClose(): void }) {
  const [wanted, setWanted] = useState(`${current}`)
  const [busy, setBusy] = useState('')
  const picked = pagesFrom(wanted, pages)
  const save = async () => {
    setBusy('Making the PDF…')
    try {
      const { PDFDocument } = await import('pdf-lib')
      const from = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true })
      const made = await PDFDocument.create()
      for (const page of await made.copyPages(from, picked.map(n => n - 1))) made.addPage(page)
      await saveFileAs(`${baseName(file.name)}, pages ${wanted.replace(/\s+/g, '')}.pdf`, await made.save())
      setBusy('')
    } catch { setBusy('This PDF could not be copied. A locked PDF cannot be.') }
  }
  const join = async (other: File) => {
    setBusy('Joining the two…')
    try {
      const { PDFDocument } = await import('pdf-lib')
      const made = await PDFDocument.create()
      for (const source of [file, other]) {
        const from = await PDFDocument.load(await source.arrayBuffer(), { ignoreEncryption: true })
        for (const page of await made.copyPages(from, from.getPageIndices())) made.addPage(page)
      }
      await saveFileAs(`${baseName(file.name)} and ${baseName(other.name)}.pdf`, await made.save())
      setBusy('')
    } catch { setBusy('These PDFs could not be joined. A locked PDF cannot be.') }
  }
  return (
    <div className="study-sheet" role="dialog" aria-label="New PDF from these pages">
      <div className="study-sheet-head"><b>New PDF from this one</b><button className="menu-x" aria-label="Close" onClick={onClose}><X size={16} aria-hidden /></button></div>
      <label className="menu-row">Pages <input className="formula-input" value={wanted} onChange={e => setWanted(e.target.value)} placeholder="3-7, 10" /></label>
      <p className="menu-note">{picked.length ? `${picked.length} page${picked.length === 1 ? '' : 's'}: ${picked.slice(0, 12).join(', ')}${picked.length > 12 ? '…' : ''}` : 'Write the pages, such as 3-7, 10.'}</p>
      <div className="study-sheet-row">
        <button className="primary" disabled={!picked.length || !!busy} onClick={() => void save()}>Save these pages as a PDF</button>
        <label className="soft file-button">Join another PDF after it<input type="file" accept="application/pdf,.pdf" onChange={e => { const other = e.target.files?.[0]; if (other) void join(other) }} /></label>
      </div>
      {busy && <p className="menu-note">{busy}</p>}
      <p className="menu-note small">The book itself stays as it is.</p>
    </div>
  )
}
