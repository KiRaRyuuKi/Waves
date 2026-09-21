param(
  [string]$Base = "server\storage\generate\video"
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = (Resolve-Path (Join-Path $scriptDir "..")).Path

Write-Output "WAVES:STAGE AnimateDiff — mengunduh motion adapter dan CLIP Vision..."

# 1) Motion adapter
Write-Output "WAVES:LOG [1/2] Motion Adapter AnimateDiff v1-5-2..."
& (Join-Path $projectRoot "scripts\dl_model.ps1") -RepoId "guoyww/animatediff-motion-adapter-v1-5-2" -Base "$Base" -Folder "animate-diff/motion-adapter" -KeepRoot -Exclude "diffusion_pytorch_model.safetensors,README.md,.gitattributes"
if ($LASTEXITCODE -ne 0) { Write-Output "WAVES:ERROR Motion adapter gagal (exit $LASTEXITCODE)"; exit $LASTEXITCODE }

# 2) CLIP Vision
Write-Output "WAVES:LOG [2/2] CLIP Vision ViT-Large/14..."
& (Join-Path $projectRoot "scripts\dl_model.ps1") -RepoId "openai/clip-vit-large-patch14" -Base "$Base" -Folder "animate-diff/clip-vit-large" -KeepRoot -Exclude "pytorch_model.bin,flax_model.msgpack,tf_model.h5,README.md,.gitattributes"
if ($LASTEXITCODE -ne 0) { Write-Output "WAVES:ERROR CLIP Vision gagal (exit $LASTEXITCODE)"; exit $LASTEXITCODE }

Write-Output "WAVES:STAGE Verifikasi AnimateDiff..."
$check1 = Join-Path $projectRoot "$Base/animate-diff/motion-adapter/diffusion_pytorch_model.fp16.safetensors"
$check2 = Join-Path $projectRoot "$Base/animate-diff/clip-vit-large/model.safetensors"
if ((Test-Path $check1) -and (Test-Path $check2)) {
    Write-Output "WAVES:LOG AnimateDiff terpasang lengkap."
} else {
    Write-Output "WAVES:LOG Peringatan: salah satu file AnimateDiff belum terdeteksi."
}

Write-Output "WAVES:DONE"
