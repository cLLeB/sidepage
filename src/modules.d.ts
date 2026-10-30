/// <reference types="vite-plugin-pwa/client" />
declare module 'foliate-js/*'
declare module 'page-flip'

// The app's version, from package.json (vite.config.ts).
declare const __APP_VERSION__: string
// The store the build is for ('play'), or '' for builds from GitHub (vite.config.ts).
declare const __STORE__: string
