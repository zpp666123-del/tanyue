@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在执行 TypeScript 检查、核心测试、构建和文件完整性检查……
call npm run verify
if errorlevel 1 goto :error
echo.
echo 全部验证通过。
pause
exit /b 0
:error
echo.
echo 验证失败，请查看上方错误信息。
pause
exit /b 1
