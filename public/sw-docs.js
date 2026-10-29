// Loaded by the web app's service worker. Older copies of it answered every page under /sidepage/ with the app,
// the documentation's pages included, which then showed blank. When this copy takes over, any documentation page
// left open is loaded again, now from the site itself. The reload is not waited for: it goes through this worker,
// which must have finished taking over first.
self.addEventListener('activate', event => {
  const claimed = self.clients.claim()
  event.waitUntil(claimed)
  claimed
    .then(() => self.clients.matchAll({ type: 'window' }))
    .then(pages => pages.filter(page => new URL(page.url).pathname.includes('/docs/')).forEach(page => { void page.navigate(page.url) }))
})
