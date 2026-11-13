import { useEffect, useState } from 'react'
import { Laptop, Send, Smartphone, Unlink } from 'lucide-react'
import { canRunTools, fromShelf, onPlace, placeNow, baseName } from '../lib/platform'
import { newCode, sendBook, startLink, stopLink, useLink, validCode } from '../lib/link'

// Linking this device with another of the reader's own: one shows a code, the other types it. From then on the
// two find each other whenever Sidepage is open on both.
export default function LinkView() {
  const link = useLink()
  const [typed, setTyped] = useState('')
  const [here, setHere] = useState(placeNow)
  const [sending, setSending] = useState('')
  useEffect(() => { const stop = onPlace(setHere); setHere(placeNow()); return stop }, [])
  const book = here?.book ?? ''
  const other = link.other?.device ?? 'other device'

  const send = async () => {
    const file = await fromShelf(book)
    if (!file) return
    setSending('Packing the book and its notes…')
    try {
      await sendBook(file, share => setSending(`Sending… ${Math.round(share * 100)}%`))
      setSending(`Sent. It opens on your ${other}.`)
    } catch (error) {
      setSending(String((error as Error)?.message ?? error))
    }
    setTimeout(() => setSending(''), 6000)
  }

  if (!link.code) {
    return (
      <div className="note link-devices">
        <div className="review-empty ai-connect">
          <h2>Link your devices</h2>
          <p>Link your phone or tablet with your computer. Then you can ask the AI on your computer from your phone (with your Claude, ChatGPT or Gemini plan, and no key), and send a book with all its notes from one device to the other.</p>
          <button className="primary" onClick={() => void startLink(newCode())}>{canRunTools ? <Laptop size={16} aria-hidden /> : <Smartphone size={16} aria-hidden />} Start a link on this device</button>
          <p className="ai-fine">It shows a code to type on your other device.</p>
          <form className="link-join" onSubmit={e => { e.preventDefault(); if (validCode(typed)) void startLink(typed) }}>
            <label className="ai-field">Or type the code shown on your other device
              <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="abcde-fghjk" autoCapitalize="none" autoComplete="off" spellCheck={false} />
            </label>
            <button className="soft" disabled={!validCode(typed)}>Link the devices</button>
          </form>
          <p className="ai-fine">No account is needed. The devices talk straight to each other, encrypted with the code. Sidepage must be open on both.</p>
        </div>
      </div>
    )
  }
  return (
    <div className="note link-devices">
      <div className="review-empty ai-connect">
        <h2>Link your devices</h2>
        {link.status === 'linked'
          ? <p className="link-status on"><span className="ai-dot" /> {`Linked with your ${other}`}</p>
          : <p className="link-status"><span className="ai-dot" /> Waiting for your other device…</p>}
        {link.status !== 'linked' && <>
          <p>On your other device, open Sidepage, then More, Link devices, and type this code:</p>
          <p className="link-code">{link.code}</p>
          <p className="ai-fine">Both devices need the internet to find each other. The code is asked for only once.</p>
        </>}
        {link.status === 'linked' && <>
          {!canRunTools && link.other?.computer && <p>{link.other.tools.length ? 'Ask AI now uses the AI app on your computer. Keep Sidepage open on the computer.' : 'No AI app is installed on your computer yet: install Claude Code, Codex or Gemini CLI there.'}</p>}
          {canRunTools && <p>{`Your ${other} can now ask the AI app on this computer. Keep Sidepage open here.`}</p>}
          <button className="primary" disabled={!book || !!sending} onClick={() => void send()}><Send size={16} aria-hidden /> {book ? `Send ${baseName(book)} and its notes to your ${other}` : 'Open a book to send it'}</button>
          {sending && <p className="ai-fine">{sending}</p>}
        </>}
        <button className="soft" onClick={() => void stopLink()}><Unlink size={15} aria-hidden /> Unlink</button>
      </div>
    </div>
  )
}
