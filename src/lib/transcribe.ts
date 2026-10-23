// Speech written out as text by Whisper (OpenAI's open-source speech recogniser), run on the device through
// transformers.js. The recogniser is fetched once from the internet the first time (about 80 MB) and kept by the
// device after that; the recording itself never leaves the device. It tells the language by itself, French or
// English or any of ninety others.
export type Spoken = { from: number; text: string }
// The languages offered for a recording, and the names Whisper knows them by.
export const SPOKEN = { en: 'English', fr: 'French', es: 'Spanish', de: 'German', pt: 'Portuguese', it: 'Italian', nl: 'Dutch', ar: 'Arabic', zh: 'Chinese' } as const
const WHISPER_NAMES: Record<string, string> = { en: 'english', fr: 'french', es: 'spanish', de: 'german', pt: 'portuguese', it: 'italian', nl: 'dutch', ar: 'arabic', zh: 'chinese' }

// A recording as Whisper wants it: one channel, 16,000 samples a second.
async function samplesOf(sound: Blob): Promise<Float32Array> {
  const decoded = await new AudioContext().decodeAudioData(await sound.arrayBuffer())
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()
  return (await offline.startRendering()).getChannelData(0)
}

let recogniser: Promise<(audio: Float32Array, options: object) => Promise<unknown>> | null = null

// `language`: the language spoken ("fr", "en", …). Whisper is told it, and told to write it down as said: left
// to guess, it may write French speech out in English.
export async function writeOut(sound: Blob, language: string, onStep: (step: string) => void): Promise<Spoken[]> {
  if (!recogniser) {
    recogniser = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers')
      env.allowLocalModels = false
      const seen = new Map<string, number>()
      // A download that breaks off is tried again, twice, before giving up.
      const load = () => pipeline('automatic-speech-recognition', 'onnx-community/whisper-base', {
        dtype: 'q8',
        progress_callback: (update: { status: string; file?: string; loaded?: number; total?: number }) => {
          if (update.status !== 'progress' || !update.file || !update.total) return
          seen.set(update.file, (update.loaded ?? 0) / update.total)
          const share = [...seen.values()].reduce((sum, part) => sum + part, 0) / Math.max(seen.size, 1)
          onStep(`Fetching the speech recogniser… ${Math.round(share * 100)}%`)
        },
      })
      for (let attempt = 1; ; attempt++) {
        try { return await load() as unknown as (audio: Float32Array, options: object) => Promise<unknown> }
        catch (error) { if (attempt >= 3) throw error; onStep('The download broke off; trying again…'); await new Promise(resolve => setTimeout(resolve, 3000 * attempt)) }
      }
    })()
    recogniser.catch(() => { recogniser = null })
  }
  const listen = await recogniser
  onStep('Listening to the recording…')
  const audio = await samplesOf(sound)
  onStep(`Writing out ${Math.round(audio.length / 16000 / 60) || 1} min of speech…`)
  const heard = await listen(audio, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true, language: WHISPER_NAMES[language] ?? language, task: 'transcribe' }) as { text: string; chunks?: { timestamp: [number, number | null]; text: string }[] }
  const parts = heard.chunks?.length ? heard.chunks : [{ timestamp: [0, null] as [number, number | null], text: heard.text }]
  // Whisper hands back short pieces; they are gathered into passages of about half a minute each.
  const passages: Spoken[] = []
  for (const part of parts) {
    const text = part.text.trim()
    if (!text) continue
    const last = passages.at(-1)
    if (last && part.timestamp[0] - last.from < 30) last.text += ` ${text}`
    else passages.push({ from: Math.max(0, Math.floor(part.timestamp[0])), text })
  }
  return passages
}
