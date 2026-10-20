@echo off
chcp 65001 >nul
set "PROSPECTA_CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%PROSPECTA_CHROME%" set "PROSPECTA_CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not exist "%PROSPECTA_CHROME%" set "PROSPECTA_CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%PROSPECTA_CHROME%" (echo Instale o Google Chrome pelo site oficial. & pause & exit /b 1)
start "" "%PROSPECTA_CHROME%" --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --user-data-dir="%~dp0.chrome-profile" --no-first-run https://www.instagram.com/
echo Entre na sua conta na janela dedicada. Não envie senha nem código pelo chat.
