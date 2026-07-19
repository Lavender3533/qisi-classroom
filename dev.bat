@echo off
cd /d %~dp0
echo 启动启思学堂 Tauri 开发环境...
call npm run tauri:dev
