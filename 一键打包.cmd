@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 未找到开发用 Node.js，请先按 README 配置 Node.js 24 或更高版本。
  pause
  exit /b 1
)
node "%~dp0scripts\package-one-click.mjs"
set "BREEZE_PACK_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %BREEZE_PACK_EXIT%
