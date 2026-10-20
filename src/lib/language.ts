import { getPref, setPref } from './prefs'

// The language of Sidepage's own words: its buttons, menus and messages. The words are written in English in the
// app; in French, each piece of interface text is swapped for its French as it appears on screen (and swapped back
// when English is chosen again). What the reader brought — book pages, notes, mind maps, drawings, titles — is
// left exactly as it is.
export type Language = 'en' | 'fr'
export const LANGUAGES: Record<Language, string> = { en: 'English', fr: 'Français' }
export const uiLanguage = () => getPref<Language>('language', 'en')
// For dates and times written out ("mardi 20 octobre"): the interface's language, or the device's own.
export const uiLocale = () => (uiLanguage() === 'fr' ? 'fr-FR' : undefined)

// Places whose words are the reader's, never the app's.
const CONTENT = [
  '.ProseMirror', '.textLayer', '.pdfViewer', 'foliate-view', '.office-host', '.text-host', '.plain-text', '.html-frame',
  '.excalidraw', '.mindmap-note', '.curl-book', '.flipbook', '.ppt-host', '.slide-book', '.djvu-page', '.image-host',
  '.kin', '.gist', '.quiz-item p', '.review-front', '.review-back', '.highlight-text', '.highlight-comment', '.cite pre',
  '.book-name', '.hero-title', '.bound-title', '.plan-name', '.timeline span', '.translate-from', '.translate-to', '.meaning',
  '.diff-line', '.remembered q', '.exam-miss p', '.exam-choice', '.chip:not(.home *)', '.teach textarea', '.dv-default-tab-content',
  'input', 'textarea',
].join(', ')
// …but a tab's title starts with the app's word for the panel ("Notes · …"), which is translated by pattern.
const TAB = '.dv-default-tab-content'

let table: Record<string, string> = {}
let patterns: [RegExp, string | ((...parts: string[]) => string)][] = []
const originals = new Map<Node, string>()
const originalAttributes = new Map<Element, Record<string, string>>()
const ATTRIBUTES = ['title', 'aria-label', 'placeholder', 'data-placeholder']
let watcher: MutationObserver | null = null
let busy = false

// What the translator itself wrote: never taken for new English text and translated again.
const written = new Set<string>()
function french(text: string): string | null {
  if (written.has(text)) return null
  const plain = text.trim()
  if (!plain || !/[A-Za-z]/.test(plain)) return null
  const exact = table[plain]
  if (exact !== undefined) return text.replace(plain, exact)
  for (const [pattern, swap] of patterns) {
    const match = plain.match(pattern)
    if (!match) continue
    const out = typeof swap === 'string' ? plain.replace(pattern, swap) : swap(...(match as unknown as string[]))
    // A part matched by a pattern may itself be interface text ("Theme: Dark" → "Thème : Sombre").
    return text.replace(plain, out.replace(/(?<=: )(.+)$/, part => table[part] ?? part))
  }
  return null
}

function translateText(node: Text) {
  const parent = node.parentElement
  if (!parent) return
  const inTab = parent.closest(TAB)
  if (!inTab && parent.closest(CONTENT)) return
  const before = node.data
  if (inTab && !/^(Notes|Canvas|Mind map) · /.test(before)) return
  const after = french(before)
  if (after === null || after === before) return
  if (!originals.has(node)) originals.set(node, before)
  written.add(after)
  node.data = after
}
function translateAttributes(element: Element) {
  if (element.closest('.ProseMirror') && !element.matches('[data-placeholder]')) return
  for (const name of ATTRIBUTES) {
    const value = element.getAttribute(name)
    if (!value) continue
    const after = french(value)
    if (after === null || after === value) continue
    const kept = originalAttributes.get(element) ?? {}
    if (!(name in kept)) kept[name] = value
    originalAttributes.set(element, kept)
    written.add(after)
    element.setAttribute(name, after)
  }
}
function translateTree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return translateText(root as Text)
  if (!(root instanceof Element)) return
  translateAttributes(root)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) translateText(node as Text)
    else translateAttributes(node as Element)
  }
}

async function start() {
  const { FRENCH, FRENCH_PATTERNS } = await import('./french')
  table = FRENCH
  patterns = FRENCH_PATTERNS
  document.documentElement.lang = 'fr'
  busy = true
  translateTree(document.body)
  busy = false
  watcher = new MutationObserver(changes => {
    if (busy) return
    busy = true
    for (const change of changes) {
      if (change.type === 'characterData') {
        if (written.has((change.target as Text).data)) continue
        // The app changed this text again (a count went up): what it now says is the new English.
        originals.delete(change.target)
        translateText(change.target as Text)
      } else if (change.type === 'attributes') {
        const kept = originalAttributes.get(change.target as Element)
        if (kept && change.attributeName) delete kept[change.attributeName]
        translateAttributes(change.target as Element)
      } else change.addedNodes.forEach(translateTree)
    }
    // The changes just made by the translator itself are dropped, not answered.
    watcher?.takeRecords()
    busy = false
  })
  watcher.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES })
}
function stop() {
  watcher?.disconnect()
  watcher = null
  for (const [node, text] of originals) if ((node as Text).isConnected) (node as Text).data = text
  for (const [element, kept] of originalAttributes) for (const [name, value] of Object.entries(kept)) element.setAttribute(name, value)
  originals.clear()
  originalAttributes.clear()
  document.documentElement.lang = 'en'
}

export function setLanguage(language: Language) {
  setPref('language', language)
  stop()
  if (language === 'fr') void start()
}
if (uiLanguage() === 'fr') void start()
