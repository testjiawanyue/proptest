param(
    [string]$LogFilePath
)

# PROP 标准测试环境后端启动脚本（JDK 17，隐藏运行）
# 只从用户环境变量读取数据库/Redis 等凭据，不输出明文。
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

$javaHome = "C:\Program Files\Java\jdk-17.0.2"
if (-not (Test-Path (Join-Path $javaHome "bin\java.exe"))) {
    throw "未找到 JDK 17：$javaHome"
}

$env:JAVA_HOME = $javaHome
$env:Path = "$javaHome\bin;D:\Maven\apache-maven-3.9.6\bin;$env:Path"

$required = @(
    "PROP_DB_URL", "PROP_DB_USERNAME", "PROP_DB_PASSWORD",
    "PROP_DRUID_USERNAME", "PROP_DRUID_PASSWORD", "PROP_TOKEN_SECRET",
    "PROP_REDIS_HOST", "PROP_REDIS_PORT", "PROP_REDIS_PASSWORD", "PROP_UPLOAD_PATH"
)
$reg = Get-ItemProperty -Path "HKCU:\Environment"
foreach ($name in $required) {
    $value = $reg.$name
    if ($null -eq $value -or [string]::IsNullOrWhiteSpace([string]$value)) {
        throw "缺少用户环境变量：$name"
    }
    Set-Item -Path "Env:$name" -Value $value
}

Set-Location "E:\proptest\prop_new"
$logDir = "E:\proptest\systemquality\environments"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
if ([string]::IsNullOrWhiteSpace($LogFilePath)) {
    $LogFilePath = Join-Path $logDir ("backend-jdk17-run-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
}
$log = [System.IO.Path]::GetFullPath($LogFilePath)
$logParent = Split-Path -Parent $log
if (-not (Test-Path -LiteralPath $logParent)) {
    New-Item -ItemType Directory -Path $logParent -Force | Out-Null
}
# 每次启动默认使用独立日志，避免旧后端进程持锁导致新进程无法启动。
"===== $(Get-Date -Format o) 启动 JDK 17 后端 =====" | Out-File -FilePath $log -Append -Encoding utf8

mvn --no-transfer-progress -q -f ruoyi-admin/pom.xml spring-boot:run `
  "-Dspring-boot.run.jvmArguments=-Duser.timezone=Asia/Tokyo" `
  "-Dspring-boot.run.profiles=druid,local" `
  "-Dspring-boot.run.arguments=--spring.config.additional-location=optional:file:../.local/mysql/" `
  2>&1 | Tee-Object -FilePath $log -Append
exit $LASTEXITCODE

