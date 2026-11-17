param(
  [Parameter(Mandatory = $true)][string]$Workbook,
  [Parameter(Mandatory = $true)][string]$Pdf
)

$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $Pdf) { Remove-Item -LiteralPath $Pdf -Force }
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$book = $null
try {
  $book = $excel.Workbooks.Open($Workbook, 0, $true)
  $sheetCount = $book.Worksheets.Count
  $missing = [System.Reflection.Missing]::Value
  $book.PrintOut($missing, $missing, $missing, $false, 'Microsoft Print to PDF 在 PORTPROMPT:', $true, $true, $Pdf, $false)
  Start-Sleep -Seconds 3
  [pscustomobject]@{
    sheets = $sheetCount
    outputExists = Test-Path -LiteralPath $Pdf
    outputBytes = if (Test-Path -LiteralPath $Pdf) { (Get-Item -LiteralPath $Pdf).Length } else { 0 }
    activePrinter = $excel.ActivePrinter
  } | ConvertTo-Json
}
finally {
  if ($book) { $book.Close($false) }
  $excel.Quit()
  [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
}
