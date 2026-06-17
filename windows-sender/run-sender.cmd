@echo off
REM Task Scheduler runs this every ~10 min. The runner self-gates on the
REM dashboard config (enabled / working days / hours / pace), so it exits
REM quietly when it isn't time to send. Adjust the repo path if yours differs.
cd /d F:\web-clients\joseph-sardella\thinkbigjoe
node windows-sender\run-sender.mjs >> windows-sender\sender.log 2>&1
