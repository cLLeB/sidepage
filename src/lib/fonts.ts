// Typefaces made for easier reading, from Fontsource (each under the SIL Open Font License):
//   OpenDyslexic          heavier bottoms that keep letters from turning round, for readers with dyslexia
//   Atkinson Hyperlegible from the Braille Institute: letters told apart at a glance, for low vision
//   Lexend                wider letters and spacing, shown to ease reading fluency
// The files are part of the app (they work offline). A book's pages live in a frame of their own, so their
// @font-face rules are handed to it as text (see BookView), as well as given to the app itself here.
import dyslexic400 from '@fontsource/opendyslexic/files/opendyslexic-latin-400-normal.woff2?url'
import dyslexic700 from '@fontsource/opendyslexic/files/opendyslexic-latin-700-normal.woff2?url'
import hyperlegible400 from '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff2?url'
import hyperlegible700 from '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-normal.woff2?url'
import lexend400 from '@fontsource/lexend/files/lexend-latin-400-normal.woff2?url'
import lexend700 from '@fontsource/lexend/files/lexend-latin-700-normal.woff2?url'

const faces: [string, string, number][] = [
  ['OpenDyslexic', dyslexic400, 400], ['OpenDyslexic', dyslexic700, 700],
  ['Atkinson Hyperlegible', hyperlegible400, 400], ['Atkinson Hyperlegible', hyperlegible700, 700],
  ['Lexend', lexend400, 400], ['Lexend', lexend700, 700],
]
export const fontFaces = () => faces.map(([family, url, weight]) =>
  `@font-face { font-family: '${family}'; src: url('${new URL(url, document.baseURI).href}') format('woff2'); font-weight: ${weight}; font-style: normal; font-display: swap; }`).join('\n')

let added = false
export function addReadingFonts() {
  if (added) return
  added = true
  const style = document.createElement('style')
  style.textContent = fontFaces()
  document.head.append(style)
}
