; Extra NSIS steps for the RepTracker installer (electron-builder nsis.include).

; "Daily reminder" makes RepTracker start with Windows (main.js setBackground). Remove that
; start-up entry on a real uninstall, but not when an update replaces the app.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.reptracker.desktop"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.reptracker.desktop"
  ${endIf}
!macroend
