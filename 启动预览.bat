@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "dist\index.html" (
  echo 未找到 dist\index.html，正在构建……
  call npm run build || goto :error
)
echo.
echo 弹阅预览服务即将启动：http://127.0.0.1:4173
echo 关闭本窗口即可停止服务。
echo.
node tools\dev-server.mjs --port 4173 --dir dist --open
goto :eof
:error
echo.
echo 启动失败，请确认已安装 Node.js 20+ 和 TypeScript。
pause
exit /b 1
