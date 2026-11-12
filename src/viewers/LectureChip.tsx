import { useEffect, useState } from 'react'
import { Headphones } from 'lucide-react'
import { baseName, lectureMarks, onLectureMarks, playSound, type LectureMark } from '../lib/platform'

// On a page or slide that was showing while a lecture was recorded beside the notes: hear the lecture from the
// moment it came up (the latest recording, if there are several).
export default function LectureChip({ book, place }: { book: string; place: string }) {
  const notebook = baseName(book)
  const [marks, setMarks] = useState<LectureMark[]>([])
  useEffect(() => {
    const read = () => void lectureMarks(notebook).then(setMarks)
    read()
    return onLectureMarks(changed => { if (changed === notebook) read() })
  }, [notebook])
  const here = marks.filter(mark => mark.place === place).at(-1)
  if (!here) return null
  const clock = `${Math.floor(here.t / 60)}:${String(here.t % 60).padStart(2, '0')}`
  return (
    <button className="viewer-pos plan-pill lecture-chip" title="Hear the lecture recorded with your notes from when this came up" onClick={() => playSound({ notebook, sound: here.sound, t: here.t })}>
      <Headphones size={13} aria-hidden /> {`Lecture from ${clock}`}
    </button>
  )
}
