; ──────────────────────────────────────────────────────────
; OpenAdab NSIS custom installer script
;
; Downloads the latest opencode CLI binary from GitHub
; releases during installation and places it alongside
; the OpenAdab desktop app as a built-in dependency.
; ──────────────────────────────────────────────────────────

!macro customInstall
  DetailPrint "Downloading built-in opencode CLI..."
  StrCpy $0 "$INSTDIR\resources\download-opencode.ps1"
  IfFileExists $0 0 skipDownload
  nsExec::ExecToStack 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$0" -OutputDir "$INSTDIR"'
  Pop $1
  Pop $2
  ${If} $1 != 0
    MessageBox MB_ICONEXCLAMATION|MB_OK "openadab CLI download failed (exit code $1).$\nYou can install it manually from: https://github.com/anomalyco/opencode/releases/latest"
  ${Else}
    DetailPrint "opencode CLI installed successfully."
  ${EndIf}
  skipDownload:
  DetailPrint "OpenAdab installation complete."
!macroend

!macro customUnInstall
  IfFileExists "$INSTDIR\opencode.exe" 0 skipRemove
  Delete "$INSTDIR\opencode.exe"
  Delete "$INSTDIR\opencode-version.txt"
  skipRemove:
!macroend