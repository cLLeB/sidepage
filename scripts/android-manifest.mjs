// Adds to the generated Android project what Sidepage needs beyond Tauri's defaults: leave to use the
// microphone, for recording sound beside a note. Run after `tauri android init`.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const find = dir => readdirSync(dir).flatMap(name => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? find(path) : name === 'AndroidManifest.xml' && path.includes('main') ? [path] : []
})
const WANTED = ['android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS']
for (const path of find('src-tauri/gen/android')) {
  let manifest = readFileSync(path, 'utf8')
  const missing = WANTED.filter(name => !manifest.includes(name))
  if (!missing.length || !manifest.includes('<application')) continue
  manifest = manifest.replace('<application', `${missing.map(name => `<uses-permission android:name="${name}" />`).join('\n    ')}\n    <application`)
  writeFileSync(path, manifest)
  console.log('microphone permission added to', path)
}
