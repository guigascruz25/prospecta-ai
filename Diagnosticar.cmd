@echo off
chcp 65001 >nul
pushd "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo Instale Node.js 24.x em https://nodejs.org/ e abra novamente.
 pause
 popd
 exit /b 1
)
node scripts\partner-doctor.mjs
set "PROSPECTA_EXIT=%ERRORLEVEL%"
if not "%PROSPECTA_EXIT%"=="0" echo A etapa falhou. Leia a mensagem acima antes de continuar.
pause
popd
exit /b %PROSPECTA_EXIT%
