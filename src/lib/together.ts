import { useSyncExternalStore } from 'react'
import type { MessageAction, Room } from '@trystero-p2p/core'
import { baseName, goToPlace, onPlace, openBookByName, placeNow, shelf } from './platform'
import { getPref, setPref } from './prefs'
import { newCode, validCode } from './link'

// Studying together, each on their own device: a room joined with a short code (Trystero: the devices find each
// other through public relays, then talk straight to one another, encrypted with the code). In the room you see
// who is there and where each is reading, can follow someone page by page, send short messages, and play a quiz
// duel on the page one of you is on. Nothing goes through a server of Sidepage's.

export type Person = { id: string; name: string; book: string; place: string }
export type Said = { from: string; text: string; at: number }
export type Question = { before: string; after: string; choices: string[] }
export type Duel = { id: string; from: string; book: string; place: string; questions: Question[]; answers: string[]; started: number }
export type Score = { name: string; right: number; ms: number; done: boolean }
type State = { code: string; status: 'off' | 'joining' | 'in'; people: Person[]; said: Said[]; following: string; duel: Duel | null; scores: Record<string, Score> }

let state: State = { code: '', status: 'off', people: [], said: [], following: '', duel: null, scores: {} }
const listeners = new Set<() => void>()
const change = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()) }
export const useTogether = () => useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => state)
export const myName = () => getPref('together-name', '')
export const setMyName = (name: string) => { setPref('together-name', name.slice(0, 40)); void actions?.hi.send({ name: name.slice(0, 40) }) }
export { newCode as newRoomCode, validCode as validRoomCode }

let room: Room | null = null
let stopPlace: (() => void) | null = null
let actions: {
  hi: MessageAction<{ name: string }>; at: MessageAction<{ book: string; place: string }>; say: MessageAction<{ text: string }>
  duel: MessageAction<Duel>; score: MessageAction<{ duel: string; right: number; ms: number; done: boolean }>
} | null = null
const tidy = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '')
const person = (id: string) => state.people.find(found => found.id === id)
const update = (id: string, patch: Partial<Person>) => change({
  people: person(id) ? state.people.map(found => (found.id === id ? { ...found, ...patch } : found)) : [...state.people, { id, name: 'Someone', book: '', place: '', ...patch }],
})
// Where you are reading: the book's name (not the file) and the place in it.
const here = () => { const now = placeNow(); return { book: now ? baseName(now.book) : '', place: now?.place ?? '' } }

export async function joinTogether(code: string) {
  if (!validCode(code)) return
  if (room) await leaveTogether()
  change({ code, status: 'joining', people: [], said: [], following: '', duel: null, scores: {} })
  const { joinRoom } = await import('trystero')
  const joined = joinRoom({ appId: 'io.github.clleb.sidepage.together', password: tidy(code) }, `together-${tidy(code).slice(0, 5)}`)
  room = joined
  const made = {
    hi: joined.makeAction<{ name: string }>('hi'), at: joined.makeAction<{ book: string; place: string }>('at'), say: joined.makeAction<{ text: string }>('say'),
    duel: joined.makeAction<Duel>('duel'), score: joined.makeAction<{ duel: string; right: number; ms: number; done: boolean }>('score'),
  }
  actions = made
  change({ status: 'in' })
  joined.onPeerJoin = id => {
    void made.hi.send({ name: myName() || 'Someone' }, { target: id })
    void made.at.send(here(), { target: id })
  }
  joined.onPeerLeave = id => change({ people: state.people.filter(found => found.id !== id), following: state.following === id ? '' : state.following })
  made.hi.onMessage = ({ name }, { peerId }) => update(peerId, { name: String(name).slice(0, 40) || 'Someone' })
  made.at.onMessage = async ({ book, place }, { peerId }) => {
    update(peerId, { book: String(book), place: String(place) })
    // Following someone: their page becomes yours, in the same book (opened if it is on this device).
    if (state.following !== peerId || !book) return
    const mine = (await shelf()).find(found => baseName(found.name) === book)
    if (!mine) return
    if (baseName(placeNow()?.book ?? '') !== book) { openBookByName(mine.name); setTimeout(() => goToPlace({ book: mine.name, place }), 1500) }
    else goToPlace({ book: mine.name, place })
  }
  made.say.onMessage = ({ text }, { peerId }) => change({ said: [...state.said, { from: person(peerId)?.name ?? 'Someone', text: String(text).slice(0, 500), at: Date.now() }].slice(-100) })
  made.duel.onMessage = (duel, { peerId }) => change({ duel: { ...duel, from: person(peerId)?.name ?? duel.from, started: Date.now() }, scores: {} })
  made.score.onMessage = ({ duel, right, ms, done }, { peerId }) => {
    if (state.duel?.id !== duel) return
    change({ scores: { ...state.scores, [peerId]: { name: person(peerId)?.name ?? 'Someone', right, ms, done } } })
  }
  // Tell the room each time you turn a page (a moment after, so flicking through sends only where you stop).
  let timer = 0
  stopPlace = onPlace(() => { clearTimeout(timer); timer = window.setTimeout(() => void made.at.send(here()), 700) })
}
export async function leaveTogether() {
  const leaving = room
  room = null; actions = null
  stopPlace?.(); stopPlace = null
  change({ code: '', status: 'off', people: [], said: [], following: '', duel: null, scores: {} })
  await leaving?.leave().catch(() => {})
}
export const follow = (id: string) => change({ following: state.following === id ? '' : id })
export function say(text: string) {
  const clean = text.trim().slice(0, 500)
  if (!clean || !actions) return
  void actions.say.send({ text: clean })
  change({ said: [...state.said, { from: 'You', text: clean, at: Date.now() }].slice(-100) })
}

// ── A quiz duel: the same questions for everyone, the most right answers (then the quickest) wins ──
export async function startDuel(book: string, place: string) {
  if (!actions) return 'Join a room first.'
  const { quizOf, termsOf } = await import('./insight')
  const terms = await termsOf(book)
  // The page you are on and the few after it, until there are five questions.
  const [, kind, number] = place.match(/^(page|section|slide)=(\d+)/) ?? []
  const places = kind ? Array.from({ length: 6 }, (_, i) => `${kind}=${Number(number) + i}`) : [place]
  const asked: Awaited<ReturnType<typeof quizOf>> = []
  for (const at of places) { if (asked.length >= 5) break; asked.push(...await quizOf(book, at, terms, 5 - asked.length)) }
  if (asked.length < 2) return 'Too few questions can be made from this page. Try a page with more text.'
  const duel: Duel = {
    id: Date.now().toString(36), from: myName() || 'Someone', book: baseName(book), place,
    questions: asked.map(question => ({ before: question.before, after: question.after, choices: question.choices })),
    answers: asked.map(question => question.answer), started: Date.now(),
  }
  void actions.duel.send(duel)
  change({ duel, scores: {} })
  return ''
}
export function sendScore(right: number, ms: number, done: boolean) {
  if (state.duel && actions) void actions.score.send({ duel: state.duel.id, right, ms, done })
}
export const endDuel = () => change({ duel: null, scores: {} })
