import { useEffect, useState } from 'react'
import { MonitorSmartphone, X } from 'lucide-react'
import { baseName, fromShelf, goToPlace, onPlace, openBookByName, openFileNow, placeNow, shelf } from '../lib/platform'
import { placeName } from '../lib/library'
import { askForBook, forgetAway, useLink } from '../lib/link'

// Carrying on from your other device: when it was reading somewhere else a moment ago, one tap opens the same book
// at the same page here (or fetches the book from it, with its notes, when this device does not have it).
export default function CarryOn() {
  const link = useLink()
  const [here, setHere] = useState(placeNow)
  const [have, setHave] = useState<string | null | undefined>(undefined)
  useEffect(() => { const stop = onPlace(setHere); setHere(placeNow()); return stop }, [])
  const away = link.away
  useEffect(() => {
    setHave(undefined)
    if (away) void shelf().then(books => setHave(books.find(book => baseName(book.name) === baseName(away.book))?.name ?? null))
  }, [away])
  if (link.status !== 'linked' || !away || Date.now() - away.at > 6 * 3600_000) return null
  // Already reading the same thing here: nothing to carry on.
  if (here && baseName(here.book) === baseName(away.book) && here.place === away.place) return null
  const other = link.other?.device ?? 'other device'
  const go = () => {
    if (!have) { askForBook(away.book); forgetAway(); return }
    // Opened from the shelf itself, so it opens even when this window has not shown it yet.
    void fromShelf(have).then(file => { if (file) openFileNow(file); else openBookByName(have) })
    for (const delay of [800, 2000, 3500]) setTimeout(() => goToPlace({ book: have, place: away.place }), delay)
    forgetAway()
  }
  return (
    <div className="carry-on" role="status">
      <MonitorSmartphone size={16} aria-hidden />
      <span>{`On your ${other}: ${baseName(away.book)}${placeName(away.place) ? `, ${placeName(away.place)}` : ''}`}</span>
      <button className="primary" disabled={have === undefined} onClick={go}>{have === null ? 'Get it here' : 'Carry on here'}</button>
      <button className="menu-x" aria-label="Close" onClick={forgetAway}><X size={14} aria-hidden /></button>
    </div>
  )
}
