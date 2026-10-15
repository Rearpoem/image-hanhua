#!/bin/zsh
set -eu
cd -- "${0:A:h}/.."
mkdir -p runtime/swift-cache models
if ! command -v uv >/dev/null; then
  print '需要 uv 和 Python 3.12。请安装后再运行；未修改系统环境。'
  exit 1
fi
export UV_CACHE_DIR="$PWD/runtime/uv-cache"
if [[ ! -x runtime/venv/bin/python ]]; then
  uv venv --python 3.12 runtime/venv
fi
uv pip install --python runtime/venv/bin/python -r service/requirements.txt
if [[ ! -f models/en-zh.argosmodel ]]; then
  curl -L --fail --connect-timeout 20 --max-time 600 https://argos-net.com/v1/translate-en_zh-1_9.argosmodel -o models/en-zh.argosmodel.part
  mv models/en-zh.argosmodel.part models/en-zh.argosmodel
fi
runtime/venv/bin/python service/setup_model.py
runtime/venv/bin/python service/setup_direct_model.py
xcrun swiftc -O -module-cache-path runtime/swift-cache mac/ocr.swift -o runtime/ocr
print '安装完成。双击 mac/启动.command 启动本地服务。'
