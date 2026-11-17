<#
.SYNOPSIS
  飞书「测试问题跟踪」多维表格记录工具（Open API 方式）
.DESCRIPTION
  支持 add / list / update / delete / fields / batch 六种操作。
  凭证与表配置在同目录 config.json；tenant_access_token 自动缓存与刷新。
.EXAMPLE
  .\feishu-bug.ps1 add -Description "登录页按钮无响应" -Priority P1
  .\feishu-bug.ps1 add -Description "并发编辑无提示" -Priority P0 -Remark "双会话复现"
  .\feishu-bug.ps1 list
  .\feishu-bug.ps1 update -RecordId recXXXX -Priority P0 -Status 修复中
  .\feishu-bug.ps1 delete -RecordId recXXXX
  .\feishu-bug.ps1 batch -FromJson .\bugs.json
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('add', 'list', 'update', 'delete', 'fields', 'batch')]
  [string]$Command = 'list',

  [string]$Description,
  [string]$Type,
  [ValidateSet('P0', 'P1', 'P2', '')][string]$Priority,
  [string]$Reporter,
  [string[]]$Status,
  [string]$Remark,
  [datetime]$Date,
  [string]$RecordId,
  [string]$FromJson
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$config = Get-Content (Join-Path $scriptDir 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$tokenCache = Join-Path $scriptDir '.token-cache.json'
$baseUri = "https://open.feishu.cn/open-apis/bitable/v1/apps/$($config.appToken)/tables/$($config.tableId)"

function Get-TenantToken {
  if (Test-Path $tokenCache) {
    $cache = Get-Content $tokenCache -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([datetime]::Parse($cache.expiresAt) -gt (Get-Date).AddMinutes(5)) { return $cache.token }
  }
  $resp = Invoke-RestMethod -Method Post `
    -Uri 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal' `
    -ContentType 'application/json' `
    -Body (@{ app_id = $config.appId; app_secret = $config.appSecret } | ConvertTo-Json)
  if ($resp.code -ne 0) { throw "获取 tenant_access_token 失败: $($resp.msg)" }
  @{ token = $resp.tenant_access_token; expiresAt = (Get-Date).AddSeconds($resp.expire).ToString('o') } |
    ConvertTo-Json | Set-Content $tokenCache -Encoding UTF8
  return $resp.tenant_access_token
}

function Invoke-BitableApi {
  param([string]$Method, [string]$Path, [object]$Body)
  $headers = @{ Authorization = "Bearer $(Get-TenantToken)" }
  $uri = "$baseUri$Path"
  if ($Body) {
    $json = $Body | ConvertTo-Json -Depth 8 -Compress
    return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers `
      -ContentType 'application/json' -Body ([System.Text.Encoding]::UTF8.GetBytes($json))
  }
  return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers
}

function Get-OverrideValue {
  param([hashtable]$Override, [string]$Key)
  if ($Override -and $Override.ContainsKey($Key)) {
    $v = $Override[$Key]
    if ($null -ne $v -and '' -ne [string]$v) { return $v }
  }
  return $null
}

function Build-Fields {
  param([hashtable]$Override)
  $fields = @{}
  $type = Get-OverrideValue $Override 'type';       if (-not $type) { $type = $Type };           if (-not $type) { $type = $config.defaults.type }
  $reporter = Get-OverrideValue $Override 'reporter'; if (-not $reporter) { $reporter = $Reporter }; if (-not $reporter) { $reporter = $config.defaults.reporter }
  $status = Get-OverrideValue $Override 'status';   if (-not $status) { $status = $Status };     if (-not $status) { $status = @($config.defaults.status) }
  $desc = Get-OverrideValue $Override 'description'; if (-not $desc) { $desc = $Description }
  $prio = Get-OverrideValue $Override 'priority';   if (-not $prio) { $prio = $Priority }
  $remark = Get-OverrideValue $Override 'remark';   if (-not $remark) { $remark = $Remark }
  $dateRaw = Get-OverrideValue $Override 'date'

  if ($desc) { $fields['问题描述'] = [string]$desc }
  if ($type) { $fields['类型'] = [string]$type }
  if ($prio) { $fields['优先级'] = [string]$prio }
  if ($reporter) { $fields['提出方'] = [string]$reporter }
  if ($status) {
    $vals = @($status | ForEach-Object { [string]$_ })
    if ($vals.Count -eq 1) { $fields['当前状态'] = $vals[0] } else { $fields['当前状态'] = $vals }
  }
  if ($remark) { $fields['备注说明'] = [string]$remark }
  $dateValue = if ($dateRaw) { [datetime]::Parse([string]$dateRaw) } elseif ($Date) { $Date } else { Get-Date }
  $fields['反馈时间'] = [int64](($dateValue.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds)
  return $fields
}
function Add-Record {
  param([hashtable]$Override = @{})
  $fields = Build-Fields -Override $Override
  if (-not $fields['问题描述']) { throw '缺少问题描述（-Description）' }
  $resp = Invoke-BitableApi -Method Post -Path '/records' -Body @{ fields = $fields }
  if ($resp.code -ne 0) { throw "新增失败: code=$($resp.code) msg=$($resp.msg)" }
  return $resp.data.record
}

function Get-FieldValue {
  param($Fields, [string]$Name)
  $prop = $Fields.PSObject.Properties[$Name]
  if ($prop) { return $prop.Value }
  return $null
}

function Show-Record {
  param($Record)
  $f = $Record.fields
  $desc = Get-FieldValue $f '问题描述'
  if (-not $desc) { $desc = '(空)' }
  $desc = [string]$desc
  if ($desc.Length -gt 30) { $desc = $desc.Substring(0, 30) + '…' }
  $status = Get-FieldValue $f '当前状态'
  [pscustomobject]@{
    RecordId = $Record.record_id
    描述     = $desc
    类型     = (Get-FieldValue $f '类型')
    优先级   = (Get-FieldValue $f '优先级')
    提出方   = (Get-FieldValue $f '提出方')
    状态     = if ($status) { ($status -join '/') } else { '' }
  }
}
switch ($Command) {
  'add' {
    $rec = Add-Record
    Write-Host "已新增记录 $($rec.record_id)" -ForegroundColor Green
    Show-Record $rec | Format-List
  }
  'batch' {
    if (-not $FromJson -or -not (Test-Path $FromJson)) { throw 'batch 需要 -FromJson 指定 JSON 文件（数组，元素含 description/priority/type/reporter/status/remark/date）' }
    $items = Get-Content $FromJson -Raw -Encoding UTF8 | ConvertFrom-Json
    $ok = 0; $fail = 0
    foreach ($item in $items) {
      $override = @{}
      foreach ($p in $item.PSObject.Properties) { $override[$p.Name] = $p.Value }
      try { $null = Add-Record -Override $override; $ok++; Write-Host "OK  $($override.description.Substring(0, [Math]::Min(30, $override.description.Length)))" }
      catch { $fail++; Write-Warning "失败: $($override.description) -> $($_.Exception.Message)" }
    }
    Write-Host "批量完成：成功 $ok，失败 $fail" -ForegroundColor Green
  }
  'list' {
    $resp = Invoke-BitableApi -Method Get -Path '/records?page_size=100'
    if ($resp.code -ne 0) { throw "查询失败: $($resp.msg)" }
    $resp.data.items | ForEach-Object { Show-Record $_ } | Format-Table -AutoSize
  }
  'update' {
    if (-not $RecordId) { throw 'update 需要 -RecordId' }
    $fields = @{}
    if ($Description) { $fields['问题描述'] = $Description }
    if ($Type) { $fields['类型'] = $Type }
    if ($Priority) { $fields['优先级'] = $Priority }
    if ($Reporter) { $fields['提出方'] = $Reporter }
    if ($Status) { $fields['当前状态'] = @($Status) }
    if ($Remark) { $fields['备注说明'] = $Remark }
    if ($Date) { $fields['反馈时间'] = [int64](($Date.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds) }
    if (-not $fields.Count) { throw '没有要更新的字段' }
    $resp = Invoke-BitableApi -Method Put -Path "/records/$RecordId" -Body @{ fields = $fields }
    if ($resp.code -ne 0) { throw "更新失败: code=$($resp.code) msg=$($resp.msg)" }
    Write-Host "已更新 $RecordId" -ForegroundColor Green
    $fresh = Invoke-BitableApi -Method Get -Path "/records/$RecordId"
    Show-Record $fresh.data.record | Format-List
  }
  'delete' {
    if (-not $RecordId) { throw 'delete 需要 -RecordId' }
    $resp = Invoke-BitableApi -Method Delete -Path "/records/$RecordId"
    if ($resp.code -ne 0) { throw "删除失败: code=$($resp.code) msg=$($resp.msg)" }
    Write-Host "已删除 $RecordId" -ForegroundColor Green
  }
  'fields' {
    $resp = Invoke-BitableApi -Method Get -Path '/fields?page_size=100'
    $resp.data.items | ForEach-Object {
      $prop = $_.PSObject.Properties["property"]; $opts = ""; if ($prop -and $prop.Value -and $prop.Value.PSObject.Properties["options"]) { $opts = ($prop.Value.options | ForEach-Object { $_.name }) -join "/" }
      [pscustomobject]@{ 字段 = $_.field_name; 类型码 = $_.type; 选项 = $opts }
    } | Format-Table -AutoSize
  }
}
