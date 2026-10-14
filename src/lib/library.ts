import { shelf } from './platform'

// The words of each book, kept so that every book can be searched at once. A book's words are gathered the
// first time it is opened (a PDF page by page, a book chapter by chapter) and kept on this device.
//   place: where that stretch of text is — "page=12" in a PDF, "section=3" in a book.
export type Stretch = { place: string; text: string }
export type BookHit = { book: string; place: string; before: string; match: string; after: string }

const key = (book: string) => `text:${book}`

export async function hasWords(book: string) {
  const { get } = await import('idb-keyval')
  return !!(await get(key(book)))
}

export async function keepWords(book: string, stretches: Stretch[]) {
  const { set } = await import('idb-keyval')
  try {
    await set(key(book), stretches.filter(stretch => stretch.text.trim()))
  } catch {
    // Out of room: the book still reads; it just cannot be found by its words.
  }
}

// Every place in every opened book where the words occur: a few per book, so one long book does not crowd
// out the rest.
export async function searchBooks(query: string, perBook = 4, most = 40): Promise<BookHit[]> {
  const { get } = await import('idb-keyval')
  const wanted = query.toLowerCase()
  const hits: BookHit[] = []
  for (const book of await shelf()) {
    const stretches = (await get<Stretch[]>(key(book.name))) ?? []
    let found = 0
    for (const stretch of stretches) {
      const at = stretch.text.toLowerCase().indexOf(wanted)
      if (at < 0) continue
      const clean = (text: string) => text.replace(/\s+/g, ' ')
      hits.push({
        book: book.name,
        place: stretch.place,
        before: clean(stretch.text.slice(Math.max(0, at - 50), at)),
        match: stretch.text.slice(at, at + query.length),
        after: clean(stretch.text.slice(at + query.length, at + query.length + 70)),
      })
      if (++found >= perBook) break
      if (hits.length >= most) return hits
    }
  }
  return hits
}

// What to call a place when it is shown to the reader.
export const placeName = (place: string) => {
  const page = place.match(/^page=(\d+)/)?.[1]
  const section = place.match(/^section=(\d+)/)?.[1]
  return page ? `p. ${page}` : section ? `part ${Number(section) + 1}` : ''
}

// How many letters of a book's words are kept: next to none means a scanned book, its pages only pictures.
export async function lettersKept(book: string) {
  const { get } = await import('idb-keyval')
  return ((await get<Stretch[]>(key(book))) ?? []).reduce((sum, stretch) => sum + stretch.text.length, 0)
}
