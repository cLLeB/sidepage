import { baseName } from './platform'
import { plans } from './reading'
import { learningProgress } from './review'

// Reading plans and flashcard reviews put into the reader's own calendar (Google, Outlook, Apple, any): an
// iCalendar file written by `ics`. Each plan becomes a daily reminder to read until its day, and the day itself;
// each of the coming days with cards to go over gets a short review, with a reminder.
type Moment = [number, number, number, number, number]
const at = (day: Date, hour: number): Moment => [day.getFullYear(), day.getMonth() + 1, day.getDate(), hour, 0]
const dayOf = (day: Date): [number, number, number] => [day.getFullYear(), day.getMonth() + 1, day.getDate()]
const reminder = (description: string) => [{ action: 'display' as const, description, trigger: { minutes: 5, before: true } }]

export async function calendarFile(readAt = 19, reviewAt = 18): Promise<{ text: string; count: number }> {
  const { createEvents } = await import('ics')
  const events: import('ics').EventAttributes[] = []
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0)
  for (const [fileName, plan] of Object.entries(plans())) {
    const by = new Date(`${plan.by}T00:00:00`)
    if (by < midnight) continue
    const book = baseName(fileName)
    // In local time, like the reminder itself.
    const until = `${plan.by.replace(/-/g, '')}T235959`
    events.push({
      uid: `sidepage-read-${encodeURIComponent(fileName)}@sidepage`, title: `Read ${book}`,
      description: `Today's share of ${book}, to finish it by ${by.toLocaleDateString()}. Sidepage shows how far to read.`,
      start: at(midnight, readAt), startInputType: 'local', startOutputType: 'local', duration: { minutes: 30 },
      recurrenceRule: `FREQ=DAILY;UNTIL=${until}`, alarms: reminder(`Read ${book}`), categories: ['Reading'],
    })
    const after = new Date(by.getTime() + 86_400_000)
    events.push({ uid: `sidepage-finish-${encodeURIComponent(fileName)}@sidepage`, title: `Finish ${book}`, start: dayOf(by), end: dayOf(after), categories: ['Reading'] })
  }
  const { ahead } = await learningProgress(30)
  for (const { day, due } of ahead) {
    if (!due) continue
    const minutes = Math.min(60, Math.max(10, Math.round(due / 4)))
    events.push({
      uid: `sidepage-review-${dayOf(day).join('-')}@sidepage`, title: `Flashcards: ${due} to go over`,
      description: 'Open Sidepage and choose Review to go over the cards whose time has come.',
      start: at(day, reviewAt), startInputType: 'local', startOutputType: 'local', duration: { minutes },
      alarms: reminder(`${due} flashcards to go over`), categories: ['Study'],
    })
  }
  const { error, value } = createEvents(events, { productId: 'Sidepage', calName: 'Sidepage reading' })
  if (error || !value) throw error ?? new Error('The calendar could not be written.')
  return { text: value, count: events.length }
}
