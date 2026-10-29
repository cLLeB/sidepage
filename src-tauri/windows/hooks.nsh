; Sidepage offered for every kind of file it opens (PDFs, documents, slides, books, comics, pictures) in Windows'
; "Open with" list and in Settings > Default apps, without taking any file type away from the app already chosen
; for it: Windows itself asks the reader. Written from the file types in tauri.conf.json.

!macro SIDEPAGE_TYPE EXT CLASS
  WriteRegStr SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${CLASS}" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".${EXT}" ""
  WriteRegStr SHCTX "Software\Sidepage\Capabilities\FileAssociations" ".${EXT}" "${CLASS}"
!macroend

!macro SIDEPAGE_UNTYPE EXT CLASS
  DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${CLASS}"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  ; The app's place in Settings > Default apps.
  WriteRegStr SHCTX "Software\Sidepage\Capabilities" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Sidepage\Capabilities" "ApplicationDescription" "Read PDFs, books and documents with your notes beside them."
  WriteRegStr SHCTX "Software\Sidepage\Capabilities" "ApplicationIcon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\RegisteredApplications" "Sidepage" "Software\Sidepage\Capabilities"
  !insertmacro SIDEPAGE_TYPE "pdf" "Sidepage.Document"
  !insertmacro SIDEPAGE_TYPE "docx" "Sidepage.Document"
  !insertmacro SIDEPAGE_TYPE "doc" "Sidepage.Document"
  !insertmacro SIDEPAGE_TYPE "rtf" "Sidepage.Document"
  !insertmacro SIDEPAGE_TYPE "odt" "Sidepage.Document"
  !insertmacro SIDEPAGE_TYPE "pptx" "Sidepage.Document"
  !insertmacro SIDEPAGE_TYPE "ppt" "Sidepage.Document"
  !insertmacro SIDEPAGE_TYPE "pps" "Sidepage.Document"
  !insertmacro SIDEPAGE_TYPE "txt" "Sidepage.Document"
  !insertmacro SIDEPAGE_TYPE "md" "Sidepage.Document"
  !insertmacro SIDEPAGE_TYPE "markdown" "Sidepage.Document"
  !insertmacro SIDEPAGE_TYPE "html" "Sidepage.Document"
  !insertmacro SIDEPAGE_TYPE "htm" "Sidepage.Document"
  !insertmacro SIDEPAGE_TYPE "epub" "Sidepage.Book"
  !insertmacro SIDEPAGE_TYPE "mobi" "Sidepage.Book"
  !insertmacro SIDEPAGE_TYPE "azw" "Sidepage.Book"
  !insertmacro SIDEPAGE_TYPE "azw3" "Sidepage.Book"
  !insertmacro SIDEPAGE_TYPE "kf8" "Sidepage.Book"
  !insertmacro SIDEPAGE_TYPE "fb2" "Sidepage.Book"
  !insertmacro SIDEPAGE_TYPE "fbz" "Sidepage.Book"
  !insertmacro SIDEPAGE_TYPE "cbz" "Sidepage.Book"
  !insertmacro SIDEPAGE_TYPE "cbr" "Sidepage.Book"
  !insertmacro SIDEPAGE_TYPE "cb7" "Sidepage.Book"
  !insertmacro SIDEPAGE_TYPE "cbt" "Sidepage.Book"
  !insertmacro SIDEPAGE_TYPE "djvu" "Sidepage.Book"
  !insertmacro SIDEPAGE_TYPE "djv" "Sidepage.Book"
  !insertmacro SIDEPAGE_TYPE "jpg" "Sidepage.Picture"
  !insertmacro SIDEPAGE_TYPE "jpeg" "Sidepage.Picture"
  !insertmacro SIDEPAGE_TYPE "png" "Sidepage.Picture"
  !insertmacro SIDEPAGE_TYPE "gif" "Sidepage.Picture"
  !insertmacro SIDEPAGE_TYPE "webp" "Sidepage.Picture"
  !insertmacro SIDEPAGE_TYPE "bmp" "Sidepage.Picture"
  !insertmacro SIDEPAGE_TYPE "svg" "Sidepage.Picture"
  !insertmacro SIDEPAGE_TYPE "avif" "Sidepage.Picture"
  !insertmacro SIDEPAGE_TYPE "sidepage" "Sidepage.Bundle"
  ; Explorer is told at once, so the lists are up to date without signing out.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue SHCTX "Software\RegisteredApplications" "Sidepage"
  DeleteRegKey SHCTX "Software\Sidepage\Capabilities"
  DeleteRegKey SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe"
  !insertmacro SIDEPAGE_UNTYPE "pdf" "Sidepage.Document"
  !insertmacro SIDEPAGE_UNTYPE "docx" "Sidepage.Document"
  !insertmacro SIDEPAGE_UNTYPE "doc" "Sidepage.Document"
  !insertmacro SIDEPAGE_UNTYPE "rtf" "Sidepage.Document"
  !insertmacro SIDEPAGE_UNTYPE "odt" "Sidepage.Document"
  !insertmacro SIDEPAGE_UNTYPE "pptx" "Sidepage.Document"
  !insertmacro SIDEPAGE_UNTYPE "ppt" "Sidepage.Document"
  !insertmacro SIDEPAGE_UNTYPE "pps" "Sidepage.Document"
  !insertmacro SIDEPAGE_UNTYPE "txt" "Sidepage.Document"
  !insertmacro SIDEPAGE_UNTYPE "md" "Sidepage.Document"
  !insertmacro SIDEPAGE_UNTYPE "markdown" "Sidepage.Document"
  !insertmacro SIDEPAGE_UNTYPE "html" "Sidepage.Document"
  !insertmacro SIDEPAGE_UNTYPE "htm" "Sidepage.Document"
  !insertmacro SIDEPAGE_UNTYPE "epub" "Sidepage.Book"
  !insertmacro SIDEPAGE_UNTYPE "mobi" "Sidepage.Book"
  !insertmacro SIDEPAGE_UNTYPE "azw" "Sidepage.Book"
  !insertmacro SIDEPAGE_UNTYPE "azw3" "Sidepage.Book"
  !insertmacro SIDEPAGE_UNTYPE "kf8" "Sidepage.Book"
  !insertmacro SIDEPAGE_UNTYPE "fb2" "Sidepage.Book"
  !insertmacro SIDEPAGE_UNTYPE "fbz" "Sidepage.Book"
  !insertmacro SIDEPAGE_UNTYPE "cbz" "Sidepage.Book"
  !insertmacro SIDEPAGE_UNTYPE "cbr" "Sidepage.Book"
  !insertmacro SIDEPAGE_UNTYPE "cb7" "Sidepage.Book"
  !insertmacro SIDEPAGE_UNTYPE "cbt" "Sidepage.Book"
  !insertmacro SIDEPAGE_UNTYPE "djvu" "Sidepage.Book"
  !insertmacro SIDEPAGE_UNTYPE "djv" "Sidepage.Book"
  !insertmacro SIDEPAGE_UNTYPE "jpg" "Sidepage.Picture"
  !insertmacro SIDEPAGE_UNTYPE "jpeg" "Sidepage.Picture"
  !insertmacro SIDEPAGE_UNTYPE "png" "Sidepage.Picture"
  !insertmacro SIDEPAGE_UNTYPE "gif" "Sidepage.Picture"
  !insertmacro SIDEPAGE_UNTYPE "webp" "Sidepage.Picture"
  !insertmacro SIDEPAGE_UNTYPE "bmp" "Sidepage.Picture"
  !insertmacro SIDEPAGE_UNTYPE "svg" "Sidepage.Picture"
  !insertmacro SIDEPAGE_UNTYPE "avif" "Sidepage.Picture"
  !insertmacro SIDEPAGE_UNTYPE "sidepage" "Sidepage.Bundle"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
