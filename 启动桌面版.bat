@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 启动 Tauri 桌面开发版……
echo 需要 Node.js 20+、Rust stable、Windows WebView2 及 Tauri 系统依赖。
call npm run tauri:dev
if errorlevel 1 goto :error
exit /b 0
:error
echo.
echo 启动失败。请先阅读 README.md 的“运行 Tauri 桌面版”。
pause
exit /b 1
