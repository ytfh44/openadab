; ──────────────────────────────────────────────────────────
; OpenAdab NSIS custom installer script
;
; Downloads the latest opencode CLI binary from GitHub
; releases during installation and places it alongside
; the OpenAdab desktop app as a built-in dependency.
; ──────────────────────────────────────────────────────────

!macro customInstall
  ; Download opencode CLI to the installation directory
  DetailPrint "Downloading built-in opencode CLI..."
  
  ; The PowerShell script lives in resources/ (extraResources)
  StrCpy $0 "$INSTDIR\resources\download-opencode.ps1"
  
  IfFileExists $0 0 skipDownload
  
  ; Run PowerShell to download and extract opencode
  nsExec::ExecToStack 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$0" -OutputDir "$INSTDIR"'
  Pop $1  ; exit code
  Pop $2  ; output
  
  ${If} $1 != 0
    MessageBox MB_ICONWARNING|MB_OK \
      "Unable to download the built-in opencode CLI.$\n$\nYou can download it manually from https://github.com/anomalyco/opencode/releases/latest$\n$\nDetails: $2" \
      /SD IDOK
  ${Else}
    DetailPrint "opencode CLI installed successfully."
  ${EndIf}
  
  skipDownload:
  DetailPrint "OpenAdab installation complete."
!macroend

!macro customUninstall
  ; Clean up opencode files on uninstall
  IfFileExists "$INSTDIR\opencode.exe" 0 skipRemove
  Delete "$INSTDIR\opencode.exe"
  Delete "$INSTDIR\opencode-version.txt"
  skipRemove:
!macroend
