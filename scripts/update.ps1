# 增量更新流水线（本地 Windows 用法）：
#   爬取最新数据 -> 快照 -> 合并进 data_store（保留官网已下架的历史比赛）
#   -> 重建前端 esports.json
#
# 用法:
#   powershell -File scripts/update.ps1            # 全量流水线
#   powershell -File scripts/update.ps1 -SkipVct   # 只更新 DFPL
#   powershell -File scripts/update.ps1 -SkipCrawl # 跳过爬取，仅合并已有快照
param(
    [switch]$SkipVct,
    [switch]$SkipDfpl,
    [switch]$SkipCrawl
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $SkipCrawl) {
    if (-not $SkipVct) {
        Write-Host "=== [1/4] 爬取 VCT（无畏契约）===" -ForegroundColor Cyan
        python vct_crawler.py --out-dir snapshots/vct
        if ($LASTEXITCODE -ne 0) { throw "VCT 爬虫失败 (exit $LASTEXITCODE)" }
    }
    if (-not $SkipDfpl) {
        Write-Host "=== [2/4] 爬取 DFPL（三角洲行动，全部赛季）===" -ForegroundColor Cyan
        python dfpl_crawler.py --all-seasons --out-dir snapshots/dfpl
        if ($LASTEXITCODE -ne 0) { throw "DFPL 爬虫失败 (exit $LASTEXITCODE)" }
    }
}

Write-Host "=== [3/4] 合并进持久存储（增量更新 + 历史保留）===" -ForegroundColor Cyan
node scripts/update.mjs
if ($LASTEXITCODE -ne 0) { throw "合并失败 (exit $LASTEXITCODE)" }

Write-Host "=== [4/4] 重建前端数据 ===" -ForegroundColor Cyan
node web/scripts/build-data.mjs
if ($LASTEXITCODE -ne 0) { throw "前端数据重建失败 (exit $LASTEXITCODE)" }

Write-Host ""
Write-Host "✔ 全部完成。data_store/ 为持久存储，web/src/data/esports.json 已刷新。" -ForegroundColor Green
Write-Host "  预览效果: cd web; npm run dev"
