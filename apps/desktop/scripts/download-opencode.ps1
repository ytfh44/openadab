<#
.SYNOPSIS
    Downloads the latest opencode CLI binary from GitHub releases and extracts it
    to the specified output directory.

.DESCRIPTION
    Queries the GitHub releases API for anomalmyco/opencode to find the latest version,
    then downloads the appropriate Windows binary (x64 or ARM64) and extracts it.
    Uses latest.json from the release to determine the version tag.

.PARAMETER OutputDir
    Directory where the opencode binary should be placed.

.PARAMETER Architecture
    Target architecture: "x64" or "arm64". Auto-detected when not specified.

.EXAMPLE
    .\download-opencode.ps1 -OutputDir "C:\Program Files\OpenAdab"
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$OutputDir,

    [Parameter(Mandatory = $false)]
    [ValidateSet("x64", "arm64")]
    [string]$Architecture = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# Resolve architecture
if (-not $Architecture) {
    $arch = if ([Environment]::Is64BitOperatingSystem) {
        if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
    } else {
        "x64"
    }
} else {
    $arch = $Architecture
}

# Determine asset filename pattern
$releaseBaseUrl = "https://github.com/anomalyco/opencode/releases"
$latestJsonUrl = "$releaseBaseUrl/latest/download/latest.json"

try {
    Write-Host "Fetching latest release info from $latestJsonUrl ..."
    $latestJson = Invoke-RestMethod -Uri $latestJsonUrl -TimeoutSec 30
    $version = $latestJson.version
    Write-Host "Latest opencode version: $version"
} catch {
    Write-Error "Failed to fetch latest.json: $_"
    exit 1
}

# Determine the CLI zip asset name based on architecture
$assetName = switch ($arch) {
    "x64"   { "opencode-windows-x64.zip" }
    "arm64" { "opencode-windows-arm64.zip" }
}

$downloadUrl = "$releaseBaseUrl/download/v$version/$assetName"
$zipPath = Join-Path $env:TEMP "opencode-$version-$arch.zip"
$extractDir = Join-Path $env:TEMP "opencode-extract"

try {
    # Download
    Write-Host "Downloading opencode CLI from $downloadUrl ..."
    Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath -TimeoutSec 300

    # Extract
    Write-Host "Extracting opencode CLI ..."
    if (Test-Path $extractDir) {
        Remove-Item -Recurse -Force $extractDir
    }
    Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

    # Find and copy the opencode binary
    $binaryName = if ($arch -eq "arm64") { "opencode.exe" } else { "opencode.exe" }
    $binaryPath = Join-Path $extractDir "opencode.exe"
    
    if (-not (Test-Path $binaryPath)) {
        # Search for it recursively
        $found = Get-ChildItem -Path $extractDir -Recurse -Filter "opencode.exe" | Select-Object -First 1
        if ($found) {
            $binaryPath = $found.FullName
        }
    }

    if (-not (Test-Path $binaryPath)) {
        Write-Error "opencode.exe not found in extracted archive"
        exit 1
    }

    # Ensure output directory exists
    if (-not (Test-Path $OutputDir)) {
        New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
    }

    $destPath = Join-Path $OutputDir "opencode.exe"
    Copy-Item -Path $binaryPath -Destination $destPath -Force
    Write-Host "opencode CLI installed to $destPath"

    # Write version file for reference
    $versionFile = Join-Path $OutputDir "opencode-version.txt"
    "v$version" | Set-Content -Path $versionFile -Encoding UTF8

} catch {
    Write-Error "Failed to download or extract opencode: $_"
    exit 1
} finally {
    # Cleanup
    if (Test-Path $zipPath) {
        Remove-Item -Force $zipPath -ErrorAction SilentlyContinue
    }
    if (Test-Path $extractDir) {
        Remove-Item -Recurse -Force $extractDir -ErrorAction SilentlyContinue
    }
}

Write-Host "opencode CLI setup complete."
