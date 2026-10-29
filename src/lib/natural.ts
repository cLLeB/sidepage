// Natural voices: Piper (Rhasspy's open neural voices, the ones Home Assistant speaks with), run on the device
// through ONNX Runtime by piper-tts-web. Each voice is fetched once (about 60 MB) and kept by the device; after
// that, reading aloud needs no internet. They read French, English and some thirty other languages, and they work
// where the device has no voices of its own (Android's WebView, usually).
import { getPref } from './prefs'

// The voices offered for each language, best first. The first one is used unless another is chosen.
export const NATURAL_VOICES: Record<string, { id: string; name: string }[]> = {
  en: [
    { id: 'en_US-hfc_female-medium', name: 'Hannah (American)' },
    { id: 'en_US-hfc_male-medium', name: 'Henry (American)' },
    { id: 'en_US-lessac-medium', name: 'Linda (American)' },
    { id: 'en_US-ryan-medium', name: 'Ryan (American)' },
    { id: 'en_GB-alba-medium', name: 'Alba (Scottish)' },
    { id: 'en_GB-alan-medium', name: 'Alan (British)' },
    { id: 'en_GB-jenny_dioco-medium', name: 'Jenny (British)' },
  ],
  fr: [
    { id: 'fr_FR-siwis-medium', name: 'Siwis (femme)' },
    { id: 'fr_FR-tom-medium', name: 'Tom (homme)' },
    { id: 'fr_FR-upmc-medium', name: 'Jessica (femme)' },
    { id: 'fr_FR-gilles-low', name: 'Gilles (homme)' },
  ],
  es: [{ id: 'es_ES-sharvard-medium', name: 'Sharvard' }, { id: 'es_MX-claude-high', name: 'Claude (México)' }],
  de: [{ id: 'de_DE-thorsten-medium', name: 'Thorsten' }, { id: 'de_DE-kerstin-low', name: 'Kerstin' }],
  pt: [{ id: 'pt_BR-faber-medium', name: 'Faber (Brasil)' }, { id: 'pt_PT-tugão-medium', name: 'Tugão (Portugal)' }],
  it: [{ id: 'it_IT-riccardo-x_low', name: 'Riccardo' }],
}
export const naturalVoiceFor = (language: string) => {
  const offered = NATURAL_VOICES[language] ?? NATURAL_VOICES.en
  const chosen = getPref(`natural-voice-${language}`, '')
  return offered.find(voice => voice.id === chosen)?.id ?? offered[0].id
}

// ONNX Runtime's own engine files, of the same version as the library the app carries.
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/'
type Session = { predict(text: string): Promise<Blob> }
let session: { voice: string; ready: Promise<Session> } | null = null

export function naturalSession(voice: string, onStep?: (step: string) => void): Promise<Session> {
  if (session?.voice === voice) return session.ready
  const ready = (async () => {
    const piper = await import('@mintplex-labs/piper-tts-web')
    const seen = new Map<string, number>()
    piper.TtsSession._instance = null
    return piper.TtsSession.create({
      voiceId: voice,
      wasmPaths: { ...piper.TtsSession.WASM_LOCATIONS, onnxWasm: ORT },
      progress: progress => {
        if (!progress.total) return
        seen.set(progress.url, progress.loaded / progress.total)
        const share = [...seen.values()].reduce((sum, part) => sum + part, 0) / seen.size
        onStep?.(`Fetching the voice… ${Math.round(share * 100)}%`)
      },
    }) as Promise<Session>
  })()
  session = { voice, ready }
  ready.catch(() => { if (session?.ready === ready) session = null })
  return ready
}

// One sentence as sound. The sentences are made ahead of time by the reader (see speech.ts), so one is ready
// while the one before is still being heard.
export async function naturalSound(sentence: string, language: string, onStep?: (step: string) => void): Promise<Blob> {
  const speaker = await naturalSession(naturalVoiceFor(language), onStep)
  return speaker.predict(sentence)
}

// Which voices are on this device already.
export async function storedVoices(): Promise<string[]> {
  try { return await (await import('@mintplex-labs/piper-tts-web')).stored() } catch { return [] }
}
