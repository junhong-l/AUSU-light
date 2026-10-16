@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 24 or refresh PATH, then retry.
  pause
  exit /b 1
)
if not exist "node_modules\node-hid\package.json" (
  echo Project dependencies are missing. Run: npm.cmd install
  pause
  exit /b 1
)
if not exist "node_modules\lucide\package.json" (
  echo Project dependencies are missing. Run: npm.cmd install
  pause
  exit /b 1
)
node src/server.js --open
if errorlevel 1 pause