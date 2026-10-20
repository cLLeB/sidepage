import { useEffect, useRef, useState } from 'react'
import { Check, Trash2, X } from 'lucide-react'
import { loadNote, loadNoteFile, saveNote, saveNoteFile } from '../lib/platform'

// Picture cards: a diagram with its labels covered. Each covered label is a card of its own: the picture
// with that one box hidden is the question, the box uncovered is the answer. (Known elsewhere as "image
// occlusion".) The picture is kept in the book's notebook, the boxes in picture-cards.json beside it.
export type Box = { x: number; y: number; w: number; h: number; label?: string }
export type PictureCardSet = { id: string; file: string; source: string; place?: string; boxes: Box[] }
export const PICTURE_CARDS = 'picture-cards.json'

export async function pictureCardsOf(notebook: string): Promise<PictureCardSet[]> {
  return JSON.parse((await loadNote(notebook, PICTURE_CARDS)) ?? '[]')
}

export async function addPictureCards(notebook: string, image: Blob, set: Omit<PictureCardSet, 'id' | 'file'>) {
  const id = Date.now().toString(36)
  const file = `card-${id}.jpg`
  await saveNoteFile(notebook, file, image)
  await saveNote(notebook, PICTURE_CARDS, JSON.stringify([...(await pictureCardsOf(notebook)), { ...set, id, file }]))
}

// Draw boxes over the parts to hide. Drag to make a box; tap a box to name what is under it or remove it.
export function PictureCardMaker({ image, onSave, onCancel }: { image: string; onSave(boxes: Box[]): void; onCancel(): void }) {
  const [boxes, setBoxes] = useState<Box[]>([])
  const [drawing, setDrawing] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [chosen, setChosen] = useState<number | null>(null)
  const sheet = useRef<HTMLDivElement>(null)
  const share = (e: React.PointerEvent) => {
    const r = sheet.current!.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }
  const finish = () => {
    if (!drawing) return
    const round = (n: number) => Math.round(n * 10000) / 10000
    const box = { x: Math.min(drawing.x0, drawing.x1), y: Math.min(drawing.y0, drawing.y1), w: Math.abs(drawing.x1 - drawing.x0), h: Math.abs(drawing.y1 - drawing.y0) }
    setDrawing(null)
    if (box.w > 0.015 && box.h > 0.012) { setBoxes([...boxes, { x: round(box.x), y: round(box.y), w: round(box.w), h: round(box.h) }]); setChosen(boxes.length) }
  }
  return (
    <div className="palette-shade" onClick={onCancel}>
      <div className="palette card-maker" role="dialog" aria-label="Make picture cards" onClick={e => e.stopPropagation()}>
        <div className="card-maker-head">
          <strong>Cover what you want to be asked</strong>
          <span>Drag a box over each label. Every box becomes a card.</span>
        </div>
        <div className="card-maker-stage">
          <div
            ref={sheet} className="card-sheet"
            onPointerDown={e => {
              if ((e.target as HTMLElement).closest('.occlusion')) return
              e.currentTarget.setPointerCapture(e.pointerId)
              const at = share(e)
              setChosen(null)
              setDrawing({ x0: at.x, y0: at.y, x1: at.x, y1: at.y })
            }}
            onPointerMove={e => { if (drawing) { const at = share(e); setDrawing({ ...drawing, x1: at.x, y1: at.y }) } }}
            onPointerUp={finish}
          >
            <img src={image} alt="" draggable={false} />
            {boxes.map((box, i) => (
              <button
                key={i} className={chosen === i ? 'occlusion on' : 'occlusion'}
                style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }}
                onClick={() => setChosen(chosen === i ? null : i)}
              >{i + 1}</button>
            ))}
            {drawing && <span className="occlusion drawing" style={{ left: `${Math.min(drawing.x0, drawing.x1) * 100}%`, top: `${Math.min(drawing.y0, drawing.y1) * 100}%`, width: `${Math.abs(drawing.x1 - drawing.x0) * 100}%`, height: `${Math.abs(drawing.y1 - drawing.y0) * 100}%` }} />}
          </div>
        </div>
        {chosen !== null && boxes[chosen] && (
          <div className="find-strip">
            <span className="viewer-pos">Box {chosen + 1}</span>
            <input
              autoFocus value={boxes[chosen].label ?? ''} placeholder="What is under it (optional, shown as the answer)"
              onChange={e => setBoxes(boxes.map((box, i) => (i === chosen ? { ...box, label: e.target.value } : box)))}
              onKeyDown={e => { if (e.key === 'Enter') setChosen(null) }}
            />
            <button className="tool" aria-label="Remove this box" title="Remove this box" onClick={() => { setBoxes(boxes.filter((_, i) => i !== chosen)); setChosen(null) }}><Trash2 size={17} aria-hidden /></button>
          </div>
        )}
        <div className="lookup-actions">
          <span className="viewer-pos">{`${boxes.length} card${boxes.length === 1 ? '' : 's'}`}</span>
          <span className="spacer" />
          <button className="soft" onClick={onCancel}><X size={17} aria-hidden /> Cancel</button>
          <button className="primary" disabled={!boxes.length} onClick={() => onSave(boxes)}><Check size={17} aria-hidden /> Make the cards</button>
        </div>
      </div>
    </div>
  )
}

// One picture card in review: every box covered (so neighbouring labels give nothing away), the asked-for
// one marked; turned over, the asked-for box opens.
export function PictureCard({ notebook, file, boxes, ask, turned }: { notebook: string; file: string; boxes: Box[]; ask: number; turned: boolean }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let made = ''
    void loadNoteFile(notebook, file).then(blob => { if (blob) setUrl(made = URL.createObjectURL(blob)) })
    return () => { if (made) URL.revokeObjectURL(made) }
  }, [notebook, file])
  if (!url) return <div className="review-note">Fetching the picture…</div>
  return (
    <div className="card-sheet asking">
      <img src={url} alt="" />
      {boxes.map((box, i) => (
        <span
          key={i} className={i === ask ? (turned ? 'occlusion asked open' : 'occlusion asked') : 'occlusion still'}
          style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }}
        >{i === ask && !turned ? '?' : ''}</span>
      ))}
    </div>
  )
}
