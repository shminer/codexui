@echo off
setlocal EnableExtensions DisableDelayedExpansion

for %%I in ("%~dp0..") do set "ROOT=%%~fI"

if defined PREFIX (
  set "INSTALL_PREFIX=%PREFIX%"
) else if defined CODEX_MOBILE_PREFIX (
  set "INSTALL_PREFIX=%CODEX_MOBILE_PREFIX%"
) else (
  for /f "usebackq delims=" %%I in (`npm prefix --global`) do set "INSTALL_PREFIX=%%I"
)

if not defined INSTALL_PREFIX (
  echo Could not determine the global npm prefix.
  exit /b 1
)

pushd "%ROOT%" || exit /b 1

call pnpm run build
if errorlevel 1 goto :failure

call npm install --global --prefix "%INSTALL_PREFIX%" "%ROOT%"
if errorlevel 1 goto :failure

echo Installed codexui and codexui-safe under %INSTALL_PREFIX%.
echo Ensure %INSTALL_PREFIX% is in PATH.
popd
exit /b 0

:failure
set "EXIT_CODE=%ERRORLEVEL%"
popd
exit /b %EXIT_CODE%
