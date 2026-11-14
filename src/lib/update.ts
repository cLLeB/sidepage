import { isMobile, isTauri, openOutside } from './platform'
import { getPref } from './prefs'

// Keeping Sidepage up to date.
//   • On a computer: Tauri's updater fetches the new version (signed with Sidepage's key, checked before it is
//     installed) and Sidepage starts again on request.
//   • On Android: the new APK, signed with the same key as the one installed, so it installs over it. Sidepage
//     fetches it itself and hands it to Android's installer, which asks the person to confirm.
//   • The web app updates itself through its service worker.
// `install` fetches the new version; `apply`, where there is one, puts it in place (Android's installer).
export type Update = { version: string; notes: string; install(onProgress: (share: number) => void): Promise<void>; apply?(): Promise<void>; ready?: boolean }

// What Sidepage's Android screen offers for fetching and installing its new version (missing before 0.41.6).
type AndroidUpdates = { download(url: string): void; install(): boolean }
const androidUpdates = () => (window as { SidepageUpdates?: AndroidUpdates }).SidepageUpdates

const RELEASES = 'https://api.github.com/repos/cLLeB/sidepage/releases/latest'
const newer = (a: string, b: string) => {
  const [x, y] = [a, b].map(version => version.replace(/^v/, '').split('.').map(Number))
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  return false
}

// Google Play and the Microsoft Store update the copies they installed, and their rules forbid an app updating
// itself: a build made for a store never looks.
export const updatesHere = isTauri && !__STORE__

export async function findUpdate(): Promise<Update | null> {
  if (!updatesHere) return null
  if (!isMobile) {
    const { check } = await import('@tauri-apps/plugin-updater')
    const found = await check()
    if (!found) return null
    return {
      version: found.version,
      notes: found.body ?? '',
      install: async onProgress => {
        let total = 0, got = 0
        await found.downloadAndInstall(event => {
          if (event.event === 'Started') total = event.data.contentLength ?? 0
          if (event.event === 'Progress') { got += event.data.chunkLength; if (total) onProgress(got / total) }
        })
      },
    }
  }
  // Android: the latest release, if it is newer than this copy and carries an APK.
  const { getVersion } = await import('@tauri-apps/api/app')
  const [mine, answer] = await Promise.all([getVersion(), fetch(RELEASES, { headers: { Accept: 'application/vnd.github+json' } })])
  if (!answer.ok) return null
  const release = await answer.json() as { tag_name: string; body?: string; assets: { name: string; browser_download_url: string }[] }
  const apk = release.assets.find(asset => asset.name.endsWith('_android.apk'))
  if (!apk || !newer(release.tag_name, mine)) return null
  const version = release.tag_name.replace(/^v/, ''), notes = release.body ?? ''
  const android = androidUpdates()
  if (!android) return { version, notes, install: async () => { await openOutside(apk.browser_download_url) } }
  return {
    version, notes,
    install: onProgress => new Promise((resolve, reject) => {
      const heard = (event: Event) => {
        const told = (event as CustomEvent<{ state: string; share?: number; message?: string }>).detail
        if (told.state === 'progress') return onProgress(told.share ?? 0)
        window.removeEventListener('sidepage:android-update', heard)
        if (told.state === 'done') { onProgress(1); resolve() } else reject(new Error(told.message ?? 'The download broke off.'))
      }
      window.addEventListener('sidepage:android-update', heard)
      android.download(apk.browser_download_url)
    }),
    apply: async () => { if (!android.install()) throw new Error('The new version could not be opened.') },
  }
}

export async function restart() {
  const { relaunch } = await import('@tauri-apps/plugin-process')
  await relaunch()
}

export const updatesByThemselves = () => getPref('auto-update', true)
export const canUpdateInPlace = isTauri && !isMobile && !__STORE__
// Fetched inside Sidepage, with its progress shown: on a computer, and on Android from 0.41.6.
export const fetchesItself = canUpdateInPlace || (updatesHere && !!androidUpdates())
