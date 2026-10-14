import { useEffect, useState } from 'react'
import { learningProgress, type Progress } from '../lib/review'

// How learning is going, drawn plainly: where the cards stand, what is coming, and how well things are remembered.
export default function LearningProgress() {
  const [progress, setProgress] = useState<Progress | null>(null)
  useEffect(() => { void learningProgress().then(setProgress) }, [])
  if (!progress || !progress.total) return null
  const most = Math.max(1, ...progress.ahead.map(day => day.due))
  const share = (part: number) => `${(part / progress.total) * 100}%`
  return (
    <div className="learning">
      <div className="learning-bar" role="img" aria-label={`${progress.known} known, ${progress.learning} learning, ${progress.fresh} new`}>
        <i className="known" style={{ width: share(progress.known) }} />
        <i className="learning-now" style={{ width: share(progress.learning) }} />
        <i className="fresh" style={{ width: share(progress.fresh) }} />
      </div>
      <div className="learning-key">
        <span><i className="known" />{progress.known} known</span>
        <span><i className="learning-now" />{progress.learning} learning</span>
        <span><i className="fresh" />{progress.fresh} new</span>
      </div>
      <div className="learning-figures">
        <span><b>{progress.answered ? Math.round((progress.remembered / progress.answered) * 100) : 0}%</b> remembered</span>
        <span><b>{progress.answered}</b> answers</span>
        <span><b>{progress.streak}</b> {progress.streak === 1 ? 'day' : 'days'} in a row</span>
      </div>
      <p className="eyebrow">The next two weeks</p>
      <div className="ahead">
        {progress.ahead.map((day, i) => (
          <div key={i} className="ahead-day" title={`${day.day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}: ${day.due} card${day.due === 1 ? '' : 's'}`}>
            <span className="ahead-count">{day.due || ''}</span>
            <i style={{ height: `${(day.due / most) * 100}%` }} />
            <span className="ahead-name">{i === 0 ? 'Today' : day.day.toLocaleDateString(undefined, { weekday: 'narrow' })}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
