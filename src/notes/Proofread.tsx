import { useEffect, useState } from 'react'
import { SpellCheck, X } from 'lucide-react'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { webFetch } from '../lib/net'

// Spelling and grammar, by LanguageTool (open source; its free public service): the note's text is sent, the
// mistakes come back with suggestions, and a suggestion tapped is put in its place in the note. The language is
// told from the text itself, so French notes are checked in French.
type Issue = { message: string; from: number; to: number; found: string; fixes: string[]; kind: string }

// The note's text with, for each letter, where it stands in the editor's document.
function textOf(crepe: Crepe) {
  let text = ''
  const at: number[] = []
  crepe.editor.action(ctx => {
    const { doc } = ctx.get(editorViewCtx).state
    doc.descendants((node, pos) => {
      if (node.isText && node.text) { for (let i = 0; i < node.text.length; i++) { text += node.text[i]; at.push(pos + i) } }
      else if (node.isBlock && text && !text.endsWith('\n')) { text += '\n'; at.push(-1) }
    })
  })
  return { text, at }
}

export function Proofread({ crepe, onClose }: { crepe: Crepe | null; onClose(): void }) {
  const [issues, setIssues] = useState<Issue[] | 'checking' | 'failed' | null>(null)
  const [language, setLanguage] = useState('')
  const check = async () => {
    if (!crepe) return
    setIssues('checking')
    const { text, at } = textOf(crepe)
    try {
      const body = new URLSearchParams({ text: text.slice(0, 20000), language: 'auto' })
      const answer = await webFetch('https://api.languagetool.org/v2/check', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() })
      const found = await answer.json() as { language?: { name: string }; matches: { message: string; offset: number; length: number; replacements: { value: string }[]; rule: { issueType: string } }[] }
      setLanguage(found.language?.name ?? '')
      setIssues(found.matches.filter(match => at[match.offset] >= 0 && at[match.offset + match.length - 1] >= 0).map(match => ({
        message: match.message,
        from: at[match.offset], to: at[match.offset + match.length - 1] + 1,
        found: text.slice(match.offset, match.offset + match.length),
        fixes: match.replacements.slice(0, 4).map(fix => fix.value),
        kind: match.rule.issueType,
      })))
    } catch {
      setIssues('failed')
    }
  }
  // Put a suggestion in place, and move the later issues along by the change in length.
  const fix = (issue: Issue, by: string) => {
    if (!crepe || !Array.isArray(issues)) return
    crepe.editor.action(ctx => {
      const view = ctx.get(editorViewCtx)
      if (view.state.doc.textBetween(issue.from, issue.to) !== issue.found) return
      view.dispatch(view.state.tr.insertText(by, issue.from, issue.to))
    })
    const shift = by.length - (issue.to - issue.from)
    setIssues(issues.filter(other => other !== issue).map(other => (other.from > issue.from ? { ...other, from: other.from + shift, to: other.to + shift } : other)))
  }
  const show = (issue: Issue) => crepe?.editor.action(ctx => {
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, issue.from, issue.to)).scrollIntoView())
    view.focus()
  })
  useEffect(() => { void check() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="proofread">
      <div className="proofread-head">
        <SpellCheck size={16} aria-hidden />
        <strong>Spelling and grammar</strong>
        {language && <span className="viewer-pos">{language}</span>}
        <span className="spacer" />
        <button className="tool quiet" aria-label="Check again" title="Check again" onClick={() => void check()}>↻</button>
        <button className="tool quiet" aria-label="Close spelling and grammar" onClick={onClose}><X size={16} aria-hidden /></button>
      </div>
      {issues === 'checking' && <p className="menu-note">Checking the note…</p>}
      {issues === 'failed' && <p className="menu-note">The checker is on the internet, and it cannot be reached just now.</p>}
      {Array.isArray(issues) && issues.length === 0 && <p className="menu-note">No mistakes found.</p>}
      {Array.isArray(issues) && issues.map((issue, i) => (
        <div key={i} className={`issue ${issue.kind}`}>
          <button className="issue-found" onClick={() => show(issue)}>{issue.found}</button>
          <span className="issue-message">{issue.message}</span>
          <span className="issue-fixes">{issue.fixes.map(by => <button key={by} className="chip" onClick={() => fix(issue, by)}>{by || '(remove)'}</button>)}</span>
        </div>
      ))}
      <p className="menu-note small">Checked by LanguageTool, a free online service: the note's text is sent there.</p>
    </div>
  )
}
