import { allCards } from './review'
import { baseName, loadNoteFile } from './platform'
import type { Box } from '../notes/PictureCards'

// Every flashcard as a real Anki deck (.apkg), opened by Anki on a computer and AnkiDroid or AnkiMobile on a phone:
// one sub-deck for each book, hidden-word cards as Anki's cloze cards, picture cards as pictures with the label
// covered on the front and shown on the back. Written by anki-apkg-export (sql.js underneath; its browser build needs its own matching wasm). Each card keeps its
// Sidepage name, so a later export updates the cards already in Anki instead of adding them twice.
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')

// The picture with one box covered (the front), or with that box outlined (the back), as JPEG bytes.
async function drawn(picture: Blob, boxes: Box[], ask: number, covered: boolean): Promise<Uint8Array> {
  const image = await createImageBitmap(picture)
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const pen = canvas.getContext('2d')!
  pen.drawImage(image, 0, 0)
  boxes.forEach((box, i) => {
    const [x, y, w, h] = [box.x * image.width, box.y * image.height, box.w * image.width, box.h * image.height]
    if (covered) {
      pen.fillStyle = i === ask ? '#e8833a' : '#9aa0a6'
      pen.fillRect(x, y, w, h)
    } else if (i === ask) {
      pen.strokeStyle = '#e8833a'
      pen.lineWidth = Math.max(3, image.width / 300)
      pen.strokeRect(x, y, w, h)
    }
  })
  const blob = await new Promise<Blob>(resolve => canvas.toBlob(made => resolve(made!), 'image/jpeg', 0.9))
  return new Uint8Array(await blob.arrayBuffer())
}

export async function ankiDeck(): Promise<{ bytes: Uint8Array; count: number }> {
  const [{ default: AnkiExport }, { default: wasmUrl }] = await Promise.all([import('anki-apkg-export'), import('sql.js/dist/sql-wasm-browser.wasm?url')])
  const deck = await AnkiExport.create('Sidepage', { locateFile: () => wasmUrl })
  try {
    let count = 0
    const pictures = new Map<string, Blob | null>()
    for (const card of await allCards()) {
      const book = baseName(card.book)
      const options = { noteId: `sidepage-${card.id}`, deck: `Sidepage::${book.replace(/::/g, ':')}`, tags: [book.replace(/\s+/g, '_')] }
      if (card.picture) {
        const { notebook, file, boxes, ask } = card.picture
        const key = `${notebook}/${file}`
        if (!pictures.has(key)) pictures.set(key, await loadNoteFile(notebook, file))
        const picture = pictures.get(key)
        if (!picture) continue
        const front = `${card.id}-front.jpg`, back = `${card.id}-back.jpg`
        deck.addMedia(front, await drawn(picture, boxes, ask, true))
        deck.addMedia(back, await drawn(picture, boxes, ask, false))
        deck.addCard(`<img src="${front}">`, `<img src="${back}">${card.back ? `<p>${escape(card.back)}</p>` : ''}`, options)
      } else if (card.front.includes('［ … ］') && card.back) {
        deck.addCloze(escape(card.front).replace('［ … ］', `{{c1::${escape(card.back)}}}`), '', options)
      } else if (card.back) {
        deck.addCard(escape(card.front), escape(card.back), options)
      } else continue
      count++
    }
    return { bytes: await deck.save(), count }
  } finally {
    deck.close()
  }
}
