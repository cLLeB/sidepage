import { useEffect, useRef, useState } from 'react'
import { Copy, Eye, LogOut, Swords, Users } from 'lucide-react'
import { onPlace, placeNow } from '../lib/platform'
import { placeName } from '../lib/library'
import { endDuel, follow, joinTogether, leaveTogether, myName, newRoomCode, say, sendScore, setMyName, startDuel, useTogether, validRoomCode } from '../lib/together'

// Study together: a room for a study group, each on their own device. See where the others are reading, follow one
// of them page by page, send a few words, and play a quiz duel on a page.
export default function TogetherView() {
  const room = useTogether()
  const [typed, setTyped] = useState('')
  const [name, setName] = useState(myName)
  const [message, setMessage] = useState('')
  const [here, setHere] = useState(placeNow)
  const [trouble, setTrouble] = useState('')
  useEffect(() => onPlace(setHere), [])

  if (room.status === 'off') return (
    <div className="note link-devices">
      <div className="review-empty ai-connect">
        <h2>Study together</h2>
        <p>A room for your study group, each on their own device: see where the others are reading, follow someone page by page, send a few words, and play a quiz duel on a page.</p>
        <label className="menu-row">Your name <input className="formula-input" value={name} onChange={e => setName(e.target.value)} placeholder="So the others know who you are" /></label>
        <button className="primary" disabled={!name.trim()} onClick={() => { setMyName(name); void joinTogether(newRoomCode()) }}><Users size={16} aria-hidden /> Start a room</button>
        <p className="ai-fine">Or join the room of someone else, with its code:</p>
        <form className="link-join" onSubmit={e => { e.preventDefault(); if (validRoomCode(typed) && name.trim()) { setMyName(name); void joinTogether(typed) } }}>
          <input className="formula-input" value={typed} onChange={e => setTyped(e.target.value)} placeholder="abcde-fghij" autoCapitalize="off" spellCheck={false} />
          <button className="soft" type="submit" disabled={!validRoomCode(typed) || !name.trim()}>Join</button>
        </form>
        <p className="ai-fine">The devices talk straight to one another, encrypted with the room’s code. Nothing goes through a server of Sidepage’s.</p>
      </div>
    </div>
  )

  return (
    <div className="guide together">
      <div className="study-sheet-row">
        <span className="eyebrow">Room</span>
        <b className="room-code">{room.code}</b>
        <button className="soft" onClick={() => void navigator.clipboard?.writeText(room.code)}><Copy size={14} aria-hidden /> Copy the code</button>
        <span className="spacer" />
        <button className="soft" onClick={() => void leaveTogether()}><LogOut size={14} aria-hidden /> Leave</button>
      </div>
      <p className="menu-note">Give the code to the others: they open Study together and join with it.</p>

      <h3>{`Here with you (${room.people.length})`}</h3>
      {!room.people.length && <p className="guide-wait">Waiting for the others to join…</p>}
      <div className="word-list">
        {room.people.map(person => (
          <div key={person.id} className="word-row">
            <div><b>{person.name}</b><p>{person.book ? `${person.book}${person.place ? `, ${placeName(person.place)}` : ''}` : 'Not reading a book just now'}</p></div>
            <button className={room.following === person.id ? 'primary' : 'soft'} title="Turn your pages with theirs (when you have the same book)" onClick={() => follow(person.id)}>
              <Eye size={14} aria-hidden /> {room.following === person.id ? 'Following' : 'Follow'}
            </button>
          </div>
        ))}
      </div>

      <h3>Quiz duel</h3>
      {room.duel ? <DuelPlay key={room.duel.id} /> : <>
        <p className="menu-note">Five questions from the page you are on, the same for everyone. The most right answers wins; the quickest breaks a tie.</p>
        <button className="primary" disabled={!here || !room.people.length} onClick={async () => setTrouble(await startDuel(here!.book, here!.place))}><Swords size={15} aria-hidden /> Start a duel on this page</button>
        {trouble && <p className="menu-note">{trouble}</p>}
      </>}

      <h3>Messages</h3>
      <div className="together-said">
        {room.said.map((line, i) => <p key={i} className={line.from === 'You' ? 'talk-answer' : 'talk-ask'}><b>{line.from}</b> {line.text}</p>)}
      </div>
      <form className="link-join" onSubmit={e => { e.preventDefault(); say(message); setMessage('') }}>
        <input className="formula-input" value={message} onChange={e => setMessage(e.target.value)} placeholder="A few words to the group" />
        <button className="soft" type="submit" disabled={!message.trim()}>Send</button>
      </form>
    </div>
  )
}

function DuelPlay() {
  const room = useTogether()
  const duel = room.duel!
  const [at, setAt] = useState(0)
  const [picked, setPicked] = useState<string[]>([])
  const started = useRef(Date.now())
  const right = picked.filter((choice, i) => choice === duel.answers[i]).length
  const done = picked.length >= duel.questions.length
  useEffect(() => { sendScore(right, Date.now() - started.current, done) }, [picked]) // eslint-disable-line react-hooks/exhaustive-deps
  const question = duel.questions[at]
  const choose = (choice: string) => { setPicked([...picked, choice]); setTimeout(() => setAt(at + 1), 700) }
  const board = [{ name: 'You', right, ms: Date.now() - started.current, done }, ...Object.values(room.scores)].sort((a, b) => b.right - a.right || a.ms - b.ms)
  return (
    <div className="duel">
      <p className="menu-note">{`${duel.from}’s duel on ${duel.book}, ${placeName(duel.place)}`}</p>
      {!done && question ? <>
        <p className="practice-score">{`Question ${at + 1} of ${duel.questions.length}`}</p>
        <p className="duel-question">{question.before}<b> ［ … ］ </b>{question.after}</p>
        <div className="quiz-choices">
          {question.choices.map(choice => {
            const answered = picked.length > at
            const mark = answered ? (choice === duel.answers[at] ? 'chip right' : choice === picked[at] ? 'chip wrong' : 'chip') : 'chip'
            return <button key={choice} className={mark} disabled={answered} onClick={() => choose(choice)}>{choice}</button>
          })}
        </div>
      </> : <p className="practice-score">{`You got ${right} of ${duel.questions.length}.`}</p>}
      <ol className="order-list duel-board">
        {board.map((score, i) => <li key={i}><b>{score.name}</b> <span className="menu-note">{`${score.right} right${score.done ? `, in ${Math.round(score.ms / 1000)} s` : ', still playing'}`}</span></li>)}
      </ol>
      {done && <button className="link-button" onClick={endDuel}>Close the duel</button>}
    </div>
  )
}
