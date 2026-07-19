#!/bin/bash
set -e

cd "$(dirname "$0")"
echo "启动启思学堂 Tauri 开发环境..."
npm run tauri:dev
