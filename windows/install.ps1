# Installs everything inside this tool's folder; nothing is installed system-wide.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
New-Item -ItemType Directory -Force runtime, models | Out-Null
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host '需要 uv。请先在 PowerShell 运行：winget install --id=astral-sh.uv -e ，然后重新打开窗口再运行本脚本。'
    exit 1
}
$env:UV_CACHE_DIR = Join-Path $PWD 'runtime\uv-cache'
$python = 'runtime\venv\Scripts\python.exe'
function Invoke-Step { & $args[0] @($args | Select-Object -Skip 1); if ($LASTEXITCODE) { throw "失败：$($args -join ' ')" } }
if (-not (Test-Path $python)) { Invoke-Step uv venv --python 3.12 runtime\venv }
Invoke-Step uv pip install --python $python -r service\requirements.txt -r windows\requirements.txt
if (-not (Test-Path models\en-zh.argosmodel)) {
    Invoke-Step curl.exe -L --fail --connect-timeout 20 --max-time 600 https://argos-net.com/v1/translate-en_zh-1_9.argosmodel -o models\en-zh.argosmodel.part
    Move-Item models\en-zh.argosmodel.part models\en-zh.argosmodel
}
Invoke-Step $python service\setup_model.py
Invoke-Step $python service\setup_direct_model.py
Invoke-Step $python service\ocr.py --warmup
Write-Host '安装完成。双击 windows\start.bat 启动本地服务。'
