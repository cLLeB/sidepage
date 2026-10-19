import { isTauri } from './platform'

// Asking a service on the internet. In the installed app the request is made by the app itself, outside its
// web view: a phone's web view can refuse a page's requests to other sites that an ordinary browser allows.
export async function webFetch(url: string): Promise<Response> {
  if (isTauri) {
    const { fetch: nativeFetch } = await import('@tauri-apps/plugin-http')
    return nativeFetch(url, { method: 'GET', connectTimeout: 15_000 })
  }
  return fetch(url)
}
