import { useEffect, useState } from 'react'
import { ImagePlus, RotateCw, ScanText, ZoomIn, ZoomOut } from 'lucide-react'
import { readText } from '../lib/ocr'
import { Tool } from '../ui'
import { baseName, sendClip, sendQuote } from '../lib/platform'

// A single picture (JPG, PNG, GIF, WebP, …), shown to fit the panel. Tap it to see it at full size and scroll.
export default function ImageView({ file }: { file: File }) {
  const [url, setUrl] = useState('')
  const [full, setFull] = useState(false)
  const [turn, setTurn] = useState(0)
  const [busy, setBusy] = useState('')
  const words = async () => {
    setBusy('Reading the text…')
    try {
      const text = await readText(file, share => setBusy(`Reading the text… ${Math.round(share * 100)}%`))
      if (text) sendQuote({ text, source: baseName(file.name) })
      setBusy(text ? '' : 'No words found in this picture')
    } catch {
      setBusy('The text reader could not be fetched. It needs the internet the first time.')
    }
    setTimeout(() => setBusy(''), 6000)
  }

  useEffect(() => {
    const made = URL.createObjectURL(file)
    setUrl(made)
    return () => URL.revokeObjectURL(made)
  }, [file])

  // The picture as it is shown (turned or not), sent to the notes like a clip from a page.
  const intoNotes = async () => {
    const picture = await createImageBitmap(file)
    const sideways = turn % 180 !== 0
    const scale = Math.min(1, 1600 / Math.max(picture.width, picture.height))
    const sheet = document.createElement('canvas')
    sheet.width = (sideways ? picture.height : picture.width) * scale
    sheet.height = (sideways ? picture.width : picture.height) * scale
    const ctx = sheet.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, sheet.width, sheet.height)
    ctx.translate(sheet.width / 2, sheet.height / 2)
    ctx.rotate((turn * Math.PI) / 180)
    ctx.drawImage(picture, (-picture.width * scale) / 2, (-picture.height * scale) / 2, picture.width * scale, picture.height * scale)
    sendClip({ image: sheet.toDataURL('image/jpeg', 0.9), source: baseName(file.name), book: file.name, place: 'page=1' })
  }

  return (
    <div className="viewer">
      <div className="viewer-bar">
        <Tool icon={full ? ZoomOut : ZoomIn} label={full ? 'Fit to the panel' : 'Full size'} onClick={() => setFull(!full)} />
        <Tool icon={RotateCw} label="Turn" hint="Turn the picture a quarter" onClick={() => setTurn((turn + 90) % 360)} />
        {busy && <span className="viewer-pos">{busy}</span>}
        <span className="spacer" />
        <Tool icon={ScanText} label="Read text" hint="Put the words in this picture into your notes" onClick={() => void words()} />
        <Tool icon={ImagePlus} label="Put in my notes" hint="Add this picture to the notes beside it" onClick={() => void intoNotes()} />
      </div>
      <div className={full ? 'viewer-body image-host full' : 'viewer-body image-host'}>
        {url && <img src={url} alt={file.name} style={{ transform: turn ? `rotate(${turn}deg)` : undefined }} onClick={() => setFull(!full)} />}
      </div>
    </div>
  )
}
