param (
    [string]$ModelId = "Xenova/whisper-small.en"
)

$ErrorActionPreference = "Stop"
$ScriptDir = $PSScriptRoot
$TargetDir = Join-Path $ScriptDir "models\$ModelId"
$OnnxDir = Join-Path $TargetDir "onnx"

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host " Downloading Whisper Model for 100% Offline Fast Load" -ForegroundColor Cyan
Write-Host " Model: $ModelId" -ForegroundColor Yellow
Write-Host " Destination: $TargetDir" -ForegroundColor Yellow
Write-Host "========================================================`n" -ForegroundColor Cyan

if (-not (Test-Path $OnnxDir)) {
    $null = New-Item -ItemType Directory -Force -Path $OnnxDir
}

$BaseUrl = "https://huggingface.co/$ModelId/resolve/main"

$Files = @(
    "config.json",
    "generation_config.json",
    "preprocessor_config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "vocab.json",
    "merges.txt",
    "normalizer.json",
    "special_tokens_map.json",
    "onnx/encoder_model_quantized.onnx",
    "onnx/decoder_model_merged_quantized.onnx"
)

foreach ($file in $Files) {
    $dest = Join-Path $TargetDir $file
    $url = "$BaseUrl/$file"

    if (Test-Path $dest) {
        $size = (Get-Item $dest).Length
        if ($size -gt 0) {
            Write-Host "  [SKIP] $file already exists ($([math]::Round($size / 1MB, 2)) MB)" -ForegroundColor DarkGray
            continue
        }
    }

    Write-Host "  [DOWNLOADING] $file ..." -ForegroundColor Green
    & curl.exe -s -L "$url" -o "$dest"

    if (-not (Test-Path $dest) -or (Get-Item $dest).Length -eq 0) {
        Write-Host "  [WARN] Could not download $file (or optional file)" -ForegroundColor Yellow
        if (Test-Path $dest) { Remove-Item $dest }
    } else {
        $downloadedSize = (Get-Item $dest).Length
        Write-Host "  [DONE] $file ($([math]::Round($downloadedSize / 1MB, 2)) MB)" -ForegroundColor Green
    }
}

Write-Host "`nModel $ModelId successfully bundled into extension folder!" -ForegroundColor Cyan
Write-Host "The extension will now load this model instantly from local disk with 0 network calls.`n" -ForegroundColor Green
