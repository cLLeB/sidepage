import { useRef, useState } from 'react'

// Speaking instead of typing: a recording made on the device, written out by the speech recogniser (Whisper, see
// transcribe.ts), and handed back as text. Nothing leaves the device.
export function useDictate(language: string, onText: (text: string) => void) {
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState('')
  const recorder = useRef<MediaRecorder | null>(null)
  const toggle = async () => {
    if (recording) return recorder.current?.stop()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const pieces: Blob[] = []
      const take = new MediaRecorder(stream)
      take.ondataavailable = e => pieces.push(e.data)
      take.onstop = async () => {
        stream.getTracks().forEach(track => track.stop())
        setRecording(false)
        try {
          const { writeOut } = await import('./transcribe')
          const heard = (await writeOut(new Blob(pieces, { type: take.mimeType }), language, setBusy)).map(part => part.text).join(' ').trim()
          setBusy('')
          if (heard) onText(heard)
        } catch {
          setBusy('The speech recogniser could not be fetched. It needs the internet the first time.')
        }
      }
      recorder.current = take
      take.start()
      setRecording(true)
      setBusy('')
    } catch {
      setBusy('Sidepage could not use the microphone.')
    }
  }
  return { recording, busy, toggle }
}
