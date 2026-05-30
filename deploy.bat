@echo off
REM ============================================================================
REM Deploy script for StockWatchList
REM Usage: Double-click deploy.bat or run from command line
REM Project: stockwatchlist-momentum
REM ============================================================================

cd /d "%~dp0"
echo Deploying StockWatchList to Firebase (stockwatchlist-momentum)...
npx firebase deploy --project stockwatchlist-momentum
echo.
echo Done.
pause