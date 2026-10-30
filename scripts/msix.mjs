// Packs Sidepage for the Microsoft Store as an MSIX, from a release build made with SIDEPAGE_STORE=msstore (so it
// leaves updates to the Store). The Store signs the package when it is submitted, so it is left unsigned here.
//   node scripts/msix.mjs <path to sidepage.exe> <output .msix>
// The identity below is the one Partner Center gave Sidepage (Product identity); it must not change.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'

const [exe, out] = process.argv.slice(2)
if (!exe || !out) { console.error('usage: node scripts/msix.mjs <sidepage.exe> <out.msix>'); process.exit(1) }

const IDENTITY = {
  name: 'CalebKwabenaKyereBoateng.Sidepage',
  publisher: 'CN=6EE69D7C-8974-4D42-8DAD-1C77D5292526',
  publisherDisplayName: 'Caleb Kwabena Kyere Boateng',
}
const conf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'))
// The Store wants four numbers, the last one 0.
const version = `${conf.version}.0`

// The kinds of file Sidepage opens, grouped as in the installer (Document, Book, Picture, Bundle).
const groups = new Map()
for (const type of conf.bundle.fileAssociations) {
  const group = groups.get(type.name) ?? { description: type.description, ext: [] }
  group.ext.push(...type.ext)
  groups.set(type.name, group)
}
const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const associations = [...groups].map(([name, group]) => `
        <uap:Extension Category="windows.fileTypeAssociation">
          <uap:FileTypeAssociation Name="${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}">
            <uap:DisplayName>${escape(group.description)}</uap:DisplayName>
            <uap:SupportedFileTypes>
${group.ext.map(ext => `              <uap:FileType>.${ext}</uap:FileType>`).join('\n')}
            </uap:SupportedFileTypes>
          </uap:FileTypeAssociation>
        </uap:Extension>`).join('')

const manifest = `<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap rescap">
  <Identity Name="${IDENTITY.name}" Publisher="${IDENTITY.publisher}" Version="${version}" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>Sidepage</DisplayName>
    <PublisherDisplayName>${escape(IDENTITY.publisherDisplayName)}</PublisherDisplayName>
    <Logo>Assets\\StoreLogo.png</Logo>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Resources>
    <Resource Language="en-us" />
    <Resource Language="fr-fr" />
  </Resources>
  <Applications>
    <Application Id="Sidepage" Executable="sidepage.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="Sidepage"
        Description="Read PDFs, books and documents with your notes beside them."
        BackgroundColor="transparent"
        Square150x150Logo="Assets\\Square150x150Logo.png"
        Square44x44Logo="Assets\\Square44x44Logo.png">
        <uap:DefaultTile Wide310x150Logo="Assets\\Wide310x150Logo.png" Square71x71Logo="Assets\\Square71x71Logo.png" Square310x310Logo="Assets\\Square310x310Logo.png" />
      </uap:VisualElements>
      <Extensions>${associations}
      </Extensions>
    </Application>
  </Applications>
  <Capabilities>
    <Capability Name="internetClient" />
    <rescap:Capability Name="runFullTrust" />
    <DeviceCapability Name="microphone" />
  </Capabilities>
</Package>
`

const layout = join(dirname(out), 'msix-layout')
rmSync(layout, { recursive: true, force: true })
mkdirSync(join(layout, 'Assets'), { recursive: true })
cpSync(exe, join(layout, 'sidepage.exe'))
cpSync('src-tauri/msix/Assets', join(layout, 'Assets'), { recursive: true })
writeFileSync(join(layout, 'AppxManifest.xml'), manifest)

// makeappx from the newest Windows SDK on this machine (GitHub's Windows machines carry one too).
const kits = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin'
const sdk = readdirSync(kits).filter(name => /^10\./.test(name)).sort().reverse().find(name => existsSync(join(kits, name, 'x64', 'makeappx.exe')))
if (!sdk) { console.error('makeappx.exe not found: install the Windows SDK'); process.exit(1) }
execFileSync(join(kits, sdk, 'x64', 'makeappx.exe'), ['pack', '/d', layout, '/p', out, '/o'], { stdio: 'inherit' })
console.log(`Packed ${out} (version ${version})`)
