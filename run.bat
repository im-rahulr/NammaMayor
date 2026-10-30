@echo off
setlocal EnableExtensions
title NammaMayor - Dev Server
cd /d "%~dp0"

echo ============================================
echo   NammaMayor - local dev server
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js was not found on PATH.
    echo         Install Node.js from https://nodejs.org/ and try again.
    echo.
    pause
    exit /b 1
)

for /f "delims=" %%v in ('node -v') do set "NODEVER=%%v"
echo Node.js %NODEVER% found.

if not exist "node_modules\vite\bin\vite.js" (
    echo.
    echo [1/4] Installing dependencies, this can take a few minutes...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo.
        echo [ERROR] npm install failed. Check the messages above.
        echo.
        pause
        exit /b 1
    )
)

if not exist ".env" if exist ".env.example" (
    copy /y ".env.example" ".env" >nul
    echo Created .env from .env.example - add your API keys before using the AI features.
)

echo.
echo [2/4] Refreshing file timestamps to the current time...
rem A downloaded project keeps the modification dates baked into its zip, so
rem every file looks months old. Rewrite them with PowerShell before Vite
rem starts, otherwise the dev server would treat the whole tree as changed.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$now = Get-Date; $files = @(Get-ChildItem -LiteralPath '%~dp0' -Recurse -File | Where-Object { $_.FullName -notmatch '\\(node_modules|\.git|dist|\.output|coverage|\.tanstack)\\' }); foreach ($file in $files) { $file.LastWriteTime = $now }; Write-Host ('       ' + $files.Count + ' files stamped to ' + $now.ToString('dd-MM-yyyy HH:mm:ss'))"
if errorlevel 1 (
    echo.
    echo [WARN] Timestamp refresh failed - PowerShell was unavailable.
    echo        Continuing with the original file dates.
)

echo.
echo [3/4] Starting the dev server...
echo       The browser opens automatically once Vite is ready.
echo       Keep this window open. Press Ctrl+C to stop.
echo.

call npm run dev -- --open

echo.
echo [4/4] Dev server stopped.
echo       Re-running this script re-stamps the timestamps to the new current time.
pause
