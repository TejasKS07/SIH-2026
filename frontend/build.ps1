param (
    [string]$Target = "all",
    [string]$Browser = "chrome"
)

$RootDir = $PSScriptRoot
$DistDir = Join-Path $RootDir "dist"
$ManifestsDir = Join-Path $RootDir "manifests"
$SharedFolders = @("background", "content", "icons", "sidepanel", "stt", "utils")
if (Test-Path (Join-Path $RootDir "models")) {
    $SharedFolders += "models"
}

function Build-Browser([string]$BrowserName, [string]$ManifestSource) {
    $OutDir = Join-Path $DistDir $BrowserName
    Write-Host "Building for $BrowserName -> $OutDir" -ForegroundColor Cyan

    if (Test-Path $OutDir) {
        Remove-Item -Recurse -Force $OutDir
    }
    $null = New-Item -ItemType Directory -Force -Path $OutDir

    foreach ($folder in $SharedFolders) {
        $src = Join-Path $RootDir $folder
        $dest = Join-Path $OutDir $folder
        if (Test-Path $src) {
            Copy-Item -Recurse -Force $src $dest
        }
    }

    $manifestSrcPath = Join-Path $ManifestsDir $ManifestSource
    if (-not (Test-Path $manifestSrcPath)) {
        $manifestSrcPath = Join-Path $RootDir $ManifestSource
    }
    $manifestDestPath = Join-Path $OutDir "manifest.json"
    Copy-Item -Force $manifestSrcPath $manifestDestPath

    Write-Host "  [OK] $BrowserName build complete: $OutDir" -ForegroundColor Green
}

function Switch-Manifest([string]$BrowserName) {
    $src = Join-Path $ManifestsDir "manifest.$BrowserName.json"
    if (-not (Test-Path $src)) {
        $src = Join-Path $RootDir "manifest.$BrowserName.json"
    }
    $dest = Join-Path $RootDir "manifest.json"
    if (Test-Path $src) {
        Copy-Item -Force $src $dest
        Write-Host "[OK] Root manifest.json switched to $BrowserName configuration!" -ForegroundColor Green
    } else {
        Write-Host "Error: $src not found." -ForegroundColor Red
    }
}

if ($Target -eq "switch") {
    Switch-Manifest $Browser
    exit 0
}

if ($Target -eq "firefox") {
    Build-Browser "firefox" "manifest.firefox.json"
} elseif ($Target -eq "chrome") {
    Build-Browser "chrome" "manifest.chrome.json"
} elseif ($Target -eq "edge") {
    Build-Browser "edge" "manifest.chrome.json"
} elseif ($Target -eq "safari") {
    Build-Browser "safari" "manifest.safari.json"
} else {
    Write-Host "Building all browser targets..." -ForegroundColor Yellow
    Build-Browser "chrome" "manifest.chrome.json"
    Build-Browser "firefox" "manifest.firefox.json"
    Build-Browser "edge" "manifest.chrome.json"
    Build-Browser "safari" "manifest.safari.json"
    Write-Host "`nAll browser builds ready in $DistDir!" -ForegroundColor Green
}
