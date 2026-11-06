@echo off
chcp 65001 >nul
cd /d "%~dp0"
where npm >nul 2>&1
if errorlevel 1 (
  echo Node.js nao foi encontrado. Instale em https://nodejs.org e tente de novo.
  pause
  exit /b 1
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo Instalando o Converts. A primeira vez pode demorar alguns minutos.
  call npm install
  if errorlevel 1 (
    echo.
    echo A instalacao falhou.
    pause
    exit /b 1
  )
)
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
