// Writes src-tauri/windows/hooks.nsh from the file types in tauri.conf.json, so the two never drift apart.
const fs = require('fs')
const conf = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'))
const pairs = conf.bundle.fileAssociations.flatMap(group => group.ext.map(ext => [ext, group.name]))
const each = macro => pairs.map(([ext, cls]) => `  !insertmacro ${macro} "${ext}" "${cls}"`).join('\n')
const text = `; Sidepage offered for every kind of file it opens (PDFs, documents, slides, books, comics, pictures) in Windows'
; "Open with" list and in Settings > Default apps, without taking any file type away from the app already chosen
; for it: Windows itself asks the reader. Written from the file types in tauri.conf.json.

!macro SIDEPAGE_TYPE EXT CLASS
  WriteRegStr SHCTX "Software\\Classes\\.\${EXT}\\OpenWithProgids" "\${CLASS}" ""
  WriteRegStr SHCTX "Software\\Classes\\Applications\\\${MAINBINARYNAME}.exe\\SupportedTypes" ".\${EXT}" ""
  WriteRegStr SHCTX "Software\\Sidepage\\Capabilities\\FileAssociations" ".\${EXT}" "\${CLASS}"
!macroend

!macro SIDEPAGE_UNTYPE EXT CLASS
  DeleteRegValue SHCTX "Software\\Classes\\.\${EXT}\\OpenWithProgids" "\${CLASS}"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\\Classes\\Applications\\\${MAINBINARYNAME}.exe" "FriendlyAppName" "\${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\\Classes\\Applications\\\${MAINBINARYNAME}.exe\\DefaultIcon" "" "$INSTDIR\\\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\\Classes\\Applications\\\${MAINBINARYNAME}.exe\\shell\\open\\command" "" '"$INSTDIR\\\${MAINBINARYNAME}.exe" "%1"'
  ; The app's place in Settings > Default apps.
  WriteRegStr SHCTX "Software\\Sidepage\\Capabilities" "ApplicationName" "\${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\\Sidepage\\Capabilities" "ApplicationDescription" "Read PDFs, books and documents with your notes beside them."
  WriteRegStr SHCTX "Software\\Sidepage\\Capabilities" "ApplicationIcon" "$INSTDIR\\\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\\RegisteredApplications" "Sidepage" "Software\\Sidepage\\Capabilities"
${each('SIDEPAGE_TYPE')}
  ; Explorer is told at once, so the lists are up to date without signing out.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue SHCTX "Software\\RegisteredApplications" "Sidepage"
  DeleteRegKey SHCTX "Software\\Sidepage\\Capabilities"
  DeleteRegKey SHCTX "Software\\Classes\\Applications\\\${MAINBINARYNAME}.exe"
${each('SIDEPAGE_UNTYPE')}
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
`
fs.writeFileSync('src-tauri/windows/hooks.nsh', text)
console.log(pairs.length, 'file types')
