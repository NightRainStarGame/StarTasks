@echo off
set SM=C:\Users\NRSG-\AppData\Local\Android\Sdk\cmdline-tools\latest\bin\sdkmanager.bat
cd /d E:\University\TaskManager\HTML
echo y|"%SM%" --licenses > ndk-licenses.log 2>&1
"%SM%" "ndk;27.0.12077973" "cmake;3.22.1" > ndk-install.log 2>&1
echo DONE >> ndk-install.log
