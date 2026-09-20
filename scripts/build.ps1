param([switch]$Install, [string]$Serial)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Push-Location $projectRoot
try {
    if (-not $env:JAVA_HOME) { $env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr' }
    if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
    & .\gradlew.bat assembleDebug
    if ($LASTEXITCODE -ne 0) { throw 'Сборка APK завершилась ошибкой.' }
    New-Item -ItemType Directory -Force artifacts | Out-Null
    Copy-Item -LiteralPath 'app\build\outputs\apk\debug\app-debug.apk' -Destination 'artifacts\unagi-demo.apk' -Force
    if ($Install) {
        $adbPath = Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'
        if (-not $Serial) {
            $deviceLines = & $adbPath devices
            $serials = @($deviceLines | Where-Object { $_ -match '^\S+\s+device$' } | ForEach-Object { ($_ -split '\s+')[0] })
            if ($serials.Count -ne 1) { throw 'Укажите -Serial: должен быть выбран ровно один телефон или эмулятор.' }
            $Serial = $serials[0]
        }
        & $adbPath -s $Serial install -r 'artifacts\unagi-demo.apk'
        if ($LASTEXITCODE -ne 0) { throw 'Не удалось установить APK.' }
        & $adbPath -s $Serial shell am start -n ru.unagi.mobile/.MainActivity
        if ($LASTEXITCODE -ne 0) { throw 'Не удалось запустить приложение.' }
    }
} finally { Pop-Location }
