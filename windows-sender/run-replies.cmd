@echo off
REM Task Scheduler runs this every ~5 min to post Joe-approved replies.
REM Adjust the repo path if yours differs.
cd /d F:\web-clients\joseph-sardella\thinkbigjoe
node windows-sender\run-replies.mjs >> windows-sender\replies.log 2>&1
