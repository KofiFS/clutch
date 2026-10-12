; Extra installer steps for Clutch (electron-builder includes this file).

; Uninstalling removes "Start with Windows". Updates also run the old uninstaller, so only do
; it on a real uninstall, or every update would quietly switch the setting off.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Clutch"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.iceko.clutch"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Clutch"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.iceko.clutch"
  ${endIf}
!macroend
