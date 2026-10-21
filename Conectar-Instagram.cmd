@echo off
chcp 65001 >nul
pushd "%~dp0"
node scripts\partner-chrome.mjs
if errorlevel 1 pause
popd
