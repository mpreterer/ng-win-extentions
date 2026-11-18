; Uninstall: remove the "start with Windows" entry, unless this is an update.
; Удаление: убрать автозапуск (кроме обновления поверх).
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.New Year Effects"
  ${endIf}
!macroend
