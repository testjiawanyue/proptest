# ============================================================
# prop_new 一键更新脚本：同步远端代码 + 后端/前端构建
# 用法：
#   powershell -ExecutionPolicy Bypass -File E:\proptest\update-prop.ps1
#   powershell -ExecutionPolicy Bypass -File E:\proptest\update-prop.ps1 -Branch main -SkipBuild
# 参数：
#   -Branch        目标分支，默认 main（可选 codex/test）
#   -SkipBuild     跳过构建，仅同步代码
#   -SkipBackend   跳过后端构建
#   -SkipFrontend  跳过前端构建
# ============================================================

[CmdletBinding()]
param(
    [string]$Branch = "main",
    [switch]$SkipBuild,
    [switch]$SkipBackend,
    [switch]$SkipFrontend
)

$Repo      = "E:\proptest\prop_new"
$LogDir    = "E:\proptest\logs"
$LogFile   = Join-Path $LogDir "update-prop.log"
$StartTime = Get-Date

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $line = "[{0}] [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message
    Write-Host $line
    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

function Exit-Fail {
    param([string]$Message)
    Write-Log $Message "ERROR"
    exit 1
}

Write-Log "========== 更新开始（分支: $Branch）=========="

# ---------- 0. 仓库校验 ----------
if (-not (Test-Path (Join-Path $Repo ".git"))) {
    Exit-Fail "目录不是 git 仓库: $Repo"
}
Push-Location $Repo
trap { Pop-Location; exit 1 }

# ---------- 1. 拉取远端引用 ----------
Write-Log "执行 git fetch origin"
git fetch origin --prune
if ($LASTEXITCODE -ne 0) { Exit-Fail "git fetch 失败，检查网络或凭据" }

$localSha  = (git rev-parse HEAD).Trim()
$remoteSha = (git rev-parse "origin/$Branch").Trim()
if (-not $remoteSha -or $remoteSha -eq "") { Exit-Fail "远端不存在分支 origin/$Branch" }

Write-Log "本地  ${Branch} : $localSha"
Write-Log "远端 ${Branch} : $remoteSha"

# ---------- 2. 判断是否有新提交 ----------
if ($localSha -eq $remoteSha) {
    Write-Log "已是最新，无需更新"
    if (-not $SkipBuild) {
        Write-Log "提示：无新提交时默认不构建（可用 -SkipBuild 之外的构建需重新执行，或直接运行构建命令）"
    }
    Pop-Location
    Write-Log "========== 结束（无更新）=========="
    exit 0
}

# ---------- 3. 未提交改动检查 ----------
$dirty = (git status --porcelain | Measure-Object).Count
if ($dirty -gt 0) {
    Write-Log "检测到 $dirty 处未提交改动（多为自动生成文件/未跟踪SQL），将尝试快进合并" "WARN"
    git status --porcelain | ForEach-Object { Write-Log "  未提交: $_" "WARN" }
    Write-Log "若快进合并失败，请先手工处理冲突；脚本不会覆盖你的改动"
}

# ---------- 4. 快进合并 ----------
Write-Log "执行 git pull --ff-only origin $Branch"
git pull --ff-only origin $Branch
if ($LASTEXITCODE -ne 0) {
    Exit-Fail "快进合并失败，未覆盖任何本地改动；请人工处理后再运行"
}

$newSha = (git rev-parse HEAD).Trim()
Write-Log "更新成功: $localSha -> $newSha"

# ---------- 5. 构建 ----------
if ($SkipBuild) {
    Write-Log "已跳过构建（-SkipBuild）"
    Pop-Location
    Write-Log "========== 结束（已同步，未构建）=========="
    exit 0
}

# 5.1 后端构建
if ($SkipBackend) {
    Write-Log "已跳过后端构建（-SkipBackend）"
}
else {
    Write-Log "后端构建：mvn --no-transfer-progress -pl ruoyi-admin -am -DskipTests package"
    mvn --no-transfer-progress -pl ruoyi-admin -am -DskipTests package
    if ($LASTEXITCODE -ne 0) { Exit-Fail "后端构建失败" }
    Write-Log "后端构建成功"
}

# 5.2 前端构建
if ($SkipFrontend) {
    Write-Log "已跳过前端构建（-SkipFrontend）"
}
else {
    if (-not (Test-Path (Join-Path $Repo "ruoyi-ui\node_modules"))) {
        Write-Log "node_modules 缺失，执行 npm ci"
        Push-Location (Join-Path $Repo "ruoyi-ui")
        npm ci
        if ($LASTEXITCODE -ne 0) { Exit-Fail "npm ci 失败" }
        Pop-Location
    }
    Write-Log "前端构建：npm run build（ruoyi-ui）"
    Push-Location (Join-Path $Repo "ruoyi-ui")
    npm run build
    if ($LASTEXITCODE -ne 0) { Exit-Fail "前端构建失败" }
    Pop-Location
    Write-Log "前端构建成功"
}

Pop-Location
$Elapsed = (Get-Date) - $StartTime
Write-Log ("========== 结束（同步+构建完成，耗时 {0:N1} 分钟）==========" -f $Elapsed.TotalMinutes)
