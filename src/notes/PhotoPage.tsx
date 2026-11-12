import { useState } from 'react'
import { Camera, X } from 'lucide-react'

// A photo of a printed page (a paper book, a handout, a board): its words into the notes, or only the passages you
// ran a highlighter over. The words are read on the device (Tesseract).
export default function PhotoPage({ onPut, onClose }: { onPut(markdown: string): void; onClose(): void }) {
  const [picture, setPicture] = useState<HTMLCanvasElement | null>(null)
  const [shown, setShown] = useState('')
  const [busy, setBusy] = useState('')
  const take = async (file: File) => {
    const image = await createImageBitmap(file)
    // Big enough to read small print, no bigger: the reader slows with size.
    const scale = Math.min(1, 2400 / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(image.width * scale)
    canvas.height = Math.round(image.height * scale)
    canvas.getContext('2d', { willReadFrequently: true })!.drawImage(image, 0, 0, canvas.width, canvas.height)
    setPicture(canvas)
    setShown(canvas.toDataURL('image/jpeg', 0.7))
    setBusy('')
  }
  const read = async (onlyMarked: boolean) => {
    if (!picture) return
    setBusy('Reading the page…')
    try {
      const { readPhoto } = await import('../lib/ocr')
      const found = await readPhoto(picture, share => setBusy(`Reading the page… ${Math.round(share * 100)}%`))
      if (onlyMarked) {
        if (!found.marked.length) { setBusy('No highlighted words were found. Take the photo in good light, straight on.'); return }
        onPut(found.marked.map(passage => `> ${passage}`).join('\n\n'))
      } else {
        if (!found.text.trim()) { setBusy('No words were found on this photo.'); return }
        onPut(found.text)
      }
      onClose()
    } catch {
      setBusy('The text reader could not be fetched. It needs the internet the first time.')
    }
  }
  return (
    <div className="study-sheet photo-page" role="dialog" aria-label="Text from a photo of a page">
      <div className="study-sheet-head"><b>Text from a photo of a page</b><button className="menu-x" aria-label="Close" onClick={onClose}><X size={16} aria-hidden /></button></div>
      <p className="menu-note">A page of a paper book, a handout, a board. On a phone or tablet, the camera opens.</p>
      <label className="soft file-button"><Camera size={15} aria-hidden /> {picture ? 'Another photo' : 'Take or choose a photo'}
        <input type="file" accept="image/*" capture="environment" onChange={e => { const file = e.target.files?.[0]; if (file) void take(file) }} />
      </label>
      {shown && <img className="photo-preview" src={shown} alt="The photo" />}
      {picture && <div className="study-sheet-row">
        <button className="primary" disabled={busy.startsWith('Reading')} onClick={() => void read(false)}>Every word of the page</button>
        <button className="soft" disabled={busy.startsWith('Reading')} onClick={() => void read(true)}>Only what I highlighted</button>
      </div>}
      {busy && <p className="menu-note">{busy}</p>}
    </div>
  )
}
