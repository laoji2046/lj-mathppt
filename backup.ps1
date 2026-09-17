# LJ-MathSlides 备份脚本
#
# 用法：在工程根目录执行  powershell -File backup.ps1
#
# ⚠ 两个坑（都是实际踩过的）：
#  1. **不要用 Compress-Archive** ✗ —— 它会把目录结构**压平** ✓
#     同名文件互相覆盖 ✓ 恢复出来是一锅粥 ✗。必须用 .NET 的 CreateEntryFromFile 逐条写 ✓。
#  2. **Get-ChildItem 只有一个文件时返回单个对象** ✗ —— ArrayList.AddRange 会报类型错 ✓
#     所以一律写成 @(Get-ChildItem ...) 强制成数组 ✓。
#
# 备份内容：源码 + 素材（不含 node_modules / target / dist / exe）
# 额外：把 exe 与内容库（%APPDATA%\lj-mathslides\library.db）单独存一份 —— 那两样最不该丢。

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = (Get-Location).Path
if (-not (Test-Path (Join-Path $root 'package.json'))) {
  Write-Host '✗ 请在工程根目录执行（找不到 package.json）' -ForegroundColor Red
  exit 1
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'    # 带秒：同一分钟内跑两次也会同名，Create 会直接抛"文件已存在" ✗
$backupDir = Join-Path $root '_backup'
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$zipPath = Join-Path $backupDir ('save-' + $stamp + '.zip')

Write-Host '=== 收集文件（保留相对路径）===' -ForegroundColor Cyan
$files = New-Object System.Collections.ArrayList
foreach ($d in @('src', 'public', 'docs', 'images', '参考', 'jiaoxuekejian', '.probe')) {
  if (Test-Path $d) {
    $fs = @(Get-ChildItem $d -Recurse -File -ErrorAction SilentlyContinue)
    [void]$files.AddRange($fs)
    Write-Host ('  ' + $d.PadRight(16) + $fs.Count + ' 个')
  }
}
if (Test-Path 'src-tauri') {
  $fs = @(Get-ChildItem 'src-tauri' -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '\\target\\' })
  [void]$files.AddRange($fs)
  Write-Host ('  src-tauri(无 target) ' + $fs.Count + ' 个')
}
foreach ($f in @('package.json', 'package-lock.json', 'README.md', 'vite.config.ts', 'tsconfig.json', 'index.html', '.gitignore', 'clean-dist.cjs', 'dev.cmd', 'example-customized-calculators.html', 'backup.ps1')) {
  if (Test-Path $f) { [void]$files.Add((Get-Item $f)) }
}
Write-Host ('  合计 ' + $files.Count + ' 个文件')

Write-Host '=== 逐条写入压缩包（保留路径）===' -ForegroundColor Cyan
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }   # 双保险：万一还是撞名，先删掉再建
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
$n = 0
foreach ($f in $files) {
  try {
    $rel = $f.FullName.Substring($root.Length + 1)
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal)
    $n++
  } catch {
    Write-Host ('  跳过: ' + $f.Name) -ForegroundColor Yellow
  }
}
$zip.Dispose()
Write-Host ('  ✓ 写入 ' + $n + ' 项')

Write-Host '=== 额外备份：exe 与内容库 ===' -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path (Join-Path $backupDir 'exe') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $backupDir 'library') | Out-Null
$exe = 'lj-mathslides-demo\lj-mathslides.exe'
if (Test-Path $exe) {
  $ver = (Get-Item $exe).VersionInfo.FileVersion
  Copy-Item $exe (Join-Path $backupDir ('exe\lj-mathslides-' + $ver + '.exe')) -Force
  Write-Host ('  ✓ exe ' + $ver)
}
$db = Join-Path $env:APPDATA 'lj-mathslides\library.db'
if (Test-Path $db) {
  Copy-Item $db (Join-Path $backupDir ('library\library-' + $stamp + '.db')) -Force
  Write-Host '  ✓ 内容库（公式 / 试题 / 课件 / 图形）'
}

Write-Host ''
Write-Host ('备份完成: ' + $zipPath) -ForegroundColor Green
Write-Host ('           ' + [math]::Round((Get-Item $zipPath).Length / 1MB, 2) + ' MB')

# 保留最近 40 个源码备份，更早的提示用户自行处理（不自动删，避免误删）
$old = Get-ChildItem $backupDir -Filter 'save-*.zip' | Sort-Object LastWriteTime -Descending | Select-Object -Skip 40
if ($old) {
  Write-Host ''
  Write-Host ('提示: 现有 ' + (Get-ChildItem $backupDir -Filter 'save-*.zip').Count + ' 个源码备份，以下 ' + $old.Count + ' 个较早（未删除，请自行决定）:') -ForegroundColor Yellow
  $old | ForEach-Object { Write-Host ('  ' + $_.Name) }
}
