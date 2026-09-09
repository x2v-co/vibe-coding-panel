#!/bin/bash
cd "$(dirname "$0")" || exit 1
bash "Vibe Panel.sh" --setup-voice
result=$?
read -r -p '按回车关闭窗口…' _answer
exit "$result"
