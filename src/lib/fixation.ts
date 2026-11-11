// Fixation reading: the first letters of each word set in bold, so the eye is led along the line and the mind
// fills in the rest (the idea of Bionic Reading). The splitting of words is text-vide's.
const MARK = 'sp-fix'
const SKIP = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'KBD', 'SAMP', 'TEXTAREA', 'svg', 'math', 'B', 'STRONG'])
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function fixate(root: Element | null | undefined) {
  if (!root || root.querySelector(`b.${MARK}`)) return
  const { textVide } = await import('text-vide')
  const doc = root.ownerDocument
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node => {
      if (!/\p{L}{2}/u.test(node.nodeValue ?? '')) return NodeFilter.FILTER_REJECT
      for (let up = node.parentElement; up && up !== root; up = up.parentElement) if (SKIP.has(up.tagName)) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  for (const node of nodes) {
    const holder = doc.createElement('span')
    holder.className = `${MARK}-run`
    holder.innerHTML = textVide(escape(node.nodeValue ?? ''), { sep: [`<b class="${MARK}">`, '</b>'] })
    node.replaceWith(holder)
  }
}

// Back to the words as they were.
export function unfixate(root: Element | null | undefined) {
  for (const run of root?.querySelectorAll(`span.${MARK}-run`) ?? []) run.replaceWith(run.ownerDocument.createTextNode(run.textContent ?? ''))
  root?.normalize()
}

export const fixationCSS = `b.${MARK} { font-weight: 700 !important; }`
