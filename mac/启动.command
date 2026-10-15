#!/bin/zsh
set -eu
cd -- "${0:A:h}/.."
if [[ ! -x runtime/ocr || ! -x runtime/venv/bin/python ]]; then
  print '请先运行 mac/安装.command'
  exit 1
fi
exec runtime/venv/bin/python service/server.py
