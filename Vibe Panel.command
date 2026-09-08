#!/bin/bash
set -u
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js，请先安装 Node.js 24 LTS：https://nodejs.org/"
  read -r -p "按回车关闭此窗口..."
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "未找到 npm，请重新安装 Node.js，并确保加入 PATH。"
  read -r -p "按回车关闭此窗口..."
  exit 1
fi
if [ ! -d node_modules ] || [ ! -d node_modules/ws ] || [ ! -d node_modules/cross-spawn ]; then
  echo "[1/2] 正在安装或更新 Vibe Panel 依赖..."
  if ! npm install; then
    echo "依赖安装失败，请检查网络后重试。"
    read -r -p "按回车关闭此窗口..."
    exit 1
  fi
fi
echo "[2/2] 正在检查 Agent 并连接手机 Relay..."
npm run connect
status=$?
if [ "$status" -ne 0 ]; then
  echo
  echo "Connector 没有启动。请确认已安装并登录 Codex 或 Claude Code。"
  read -r -p "按回车关闭此窗口..."
  exit "$status"
fi
