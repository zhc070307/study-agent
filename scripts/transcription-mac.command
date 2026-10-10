#!/bin/bash
cd "$(dirname "$0")/.." || exit 1
python3.12 packages/transcription/host.py "$@"
echo '转写后台已退出。按回车关闭。'
read -r
