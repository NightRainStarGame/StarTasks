@echo off
set ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk
set PATH=%PATH%;C:\Users\NRSG-\.cargo\bin;E:\Nodejs
cd /d E:\University\TaskManager\HTML\src-tauri\gen\android
rem .so 已手动放入 jniLibs（绕过 tauri CLI 的 symlink 限制），跳过 rust 重编任务
call gradlew.bat assembleArm64Debug -x rustBuildArm64Debug --no-daemon > E:\University\TaskManager\HTML\build-apk.log 2>&1
echo EXITCODE=%ERRORLEVEL% >> E:\University\TaskManager\HTML\build-apk.log
