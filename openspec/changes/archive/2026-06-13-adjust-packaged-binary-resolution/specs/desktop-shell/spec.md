## ADDED Requirement: Desktop shell shall support NSIS packaging with bundled dependencies
The desktop app SHALL be packaged as a reproducible NSIS installer that downloads the latest opencode CLI at install time.

### Scenario: NSIS installer downloads opencode
- **WHEN** the NSIS installer runs
- **THEN** it SHALL fetch `latest.json` from `https://github.com/anomalyco/opencode/releases/latest/download/latest.json`
- **AND** it SHALL select the correct asset (`opencode-windows-x64.zip` or `opencode-windows-arm64.zip`) based on `$env:PROCESSOR_ARCHITECTURE`
- **AND** it SHALL extract `opencode.exe` to the installation directory alongside `OpenAdab.exe`
- **AND** download failure SHALL be non-fatal, showing a warning with the manual download URL

### Scenario: Binary resolution works with spaces and Unicode in install path
- **WHEN** the app is installed to a path containing spaces, CJK characters, or other Unicode
- **THEN** all bundled binary resolution SHALL use `path.resolve()` on `process.resourcesPath` and its parent
- **AND** `child_process.spawn()` SHALL receive the resolved absolute path as the command
- **AND** no shell-based path joining or string interpolation SHALL be used for binary discovery

### Scenario: Clean uninstall removes bundled binaries
- **WHEN** the user uninstalls OpenAdab
- **THEN** the NSIS uninstaller SHALL remove `opencode.exe` and `opencode-version.txt` from the install directory
