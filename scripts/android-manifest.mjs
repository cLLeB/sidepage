// Adds to the generated Android project what Sidepage needs beyond Tauri's defaults: leave to use the
// microphone, for recording sound beside a note, and leave to install its own new versions (Android still asks the
// person each time). Run after `tauri android init`.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const find = dir => readdirSync(dir).flatMap(name => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? find(path) : name === 'AndroidManifest.xml' && path.includes('main') ? [path] : []
})
// The Google Play build updates through Play, whose rules forbid the leave to install apps: `--store` takes it out.
if (process.argv.includes('--store')) {
  for (const path of find('src-tauri/gen/android')) {
    const manifest = readFileSync(path, 'utf8')
    const kept = manifest.replace(/\s*<uses-permission android:name="android\.permission\.REQUEST_INSTALL_PACKAGES" \/>/g, '')
    if (kept !== manifest) { writeFileSync(path, kept); console.log('install permission taken out of', path) }
  }
  process.exit(0)
}
const WANTED = ['android.permission.INTERNET', 'android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS', 'android.permission.REQUEST_INSTALL_PACKAGES']
for (const path of find('src-tauri/gen/android')) {
  let manifest = readFileSync(path, 'utf8')
  const missing = WANTED.filter(name => !manifest.includes(name))
  if (!missing.length || !manifest.includes('<application')) continue
  manifest = manifest.replace('<application', `${missing.map(name => `<uses-permission android:name="${name}" />`).join('\n    ')}\n    <application`)
  writeFileSync(path, manifest)
  console.log('permissions added to', path)
}

const conf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'))
const types = [...new Set(conf.bundle.fileAssociations.map(type => type.mimeType).filter(Boolean)), 'application/octet-stream']
const filters = `
        <intent-filter>
            <action android:name="android.intent.action.VIEW" />
            <category android:name="android.intent.category.DEFAULT" />
            <category android:name="android.intent.category.BROWSABLE" />
            <data android:scheme="content" />
            <data android:scheme="file" />
${types.map(type => `            <data android:mimeType="${type}" />`).join('\n')}
        </intent-filter>
        <intent-filter>
            <action android:name="android.intent.action.SEND" />
            <category android:name="android.intent.category.DEFAULT" />
${types.map(type => `            <data android:mimeType="${type}" />`).join('\n')}
        </intent-filter>`
for (const path of find('src-tauri/gen/android')) {
  let manifest = readFileSync(path, 'utf8')
  if (manifest.includes('android.intent.action.SEND') || !manifest.includes('.MainActivity')) continue
  const start = manifest.indexOf('<activity')
  const close = manifest.indexOf('</activity>', start)
  if (start < 0 || close < 0) continue
  let activity = manifest.slice(start, close)
  if (!activity.includes('launchMode')) activity = activity.replace('<activity', '<activity\n            android:launchMode="singleTask"')
  manifest = manifest.slice(0, start) + activity + filters + '\n    ' + manifest.slice(close)
  writeFileSync(path, manifest)
  console.log('opening files added to', path)
}
