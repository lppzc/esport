# 归一化数据结构（web/src/data/esports.json）

由 `web/scripts/build-data.mjs` 生成。数据来源优先级：
**增量合并存储 `data_store/`**（比分最新、含官网已下架的历史比赛）>
原始爬虫输出 `output/`、`dfpl_output/` 与 `cs_output/`（首次基线）。

增量合并由 `scripts/merge-data.mjs` 完成（`scripts/update.mjs` 编排）：

- 新快照中存在的比赛**整条覆盖**——比分、状态、名次、进度全部随之刷新；
- 存储中有、新快照中没有的比赛**保留不删**（官网下架的历史比赛不丢），
  并在该记录上追加 `missing_from_source: true` 与 `missing_since: <ISO时间>` 标记；
- 战队/赛事取并集，字段以新数据为准（保证下架比赛的战队引用仍可解析）；
- `meta.merge_history` 记录最近 50 次合并的统计（新增/更新/缺失保留数）。

## 顶层结构

```jsonc
{
  "generatedAt": "2026-08-20T...",   // 生成时间 ISO 8601
  "games":  [ Game, ... ],           // 游戏定义（固定 3 个）
  "teams":  [ Team, ... ],           // 全部战队
  "matches": [ Match, ... ]          // 全部比赛（按 startTime 升序）
}
```

## Game

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 游戏 ID：`vct` / `dfpl` / `cs` |
| `name` | string | 中文名（无畏契约 / 三角洲行动 / 反恐精英） |
| `sub` | string | 副标题（VALORANT · VCT / DF 烽火职业联赛 / Counter-Strike · HLTV） |
| `color` | string | 主题色，用于徽章、色条、筛选态 |

## Team

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | **全局唯一**：`游戏前缀:原始ID`。VCT 用 `vct:<team_id>`（如 `vct:21`）；DFPL 用 `dfpl:<club_id>`（如 `dfpl:blg`）；CS 用 `cs:<team_id>`（如 `cs:hltv_team_13924`）。同名战队因前缀不同天然隔离 |
| `gameId` | string | 所属游戏 |
| `name` | string | 展示名（缩写，如 BLG、成都AG、Falcons） |
| `fullName` | string | 全名（与 name 相同时为空字符串） |
| `logo` | string | logo URL（VCT 取 dark_logo 优先；DFPL 取最新赛季 logo；CS 取 5EPlay 镜像 logo） |

### 生成规则

- **VCT**：每条爬虫 team 记录即一支战队——注意 VCT 内部本身存在两支
  不同的 NOVA（`vct:30` / `vct:96`），均独立保留；
- **DFPL**：同一俱乐部在 S1/S2 赛季各有一条记录（名字、logo 相同），
  按 `club_id` 合并为一个战队实体，取最新赛季的名称与 logo；
  `club_id === 'dd'`（"待定"占位队伍）被排除；
- **CS**：每条爬虫 team 记录即一支战队（5EPlay 为 HLTV 数据镜像，
  战队原始 id 形如 `hltv_team_*` 或 `csgo_tm_*`，原样保留）。

## Match（联合类型，按 `kind` 区分）

公共字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | `游戏前缀:原始ID` |
| `gameId` | string | 所属游戏 |
| `kind` | `'duel' \| 'multi'` | 赛制 |
| `startTime` | string | 开始时间，带 +08:00 时区的 ISO 8601（北京时间） |
| `status` | `'finished' \| 'live' \| 'upcoming' \| 'canceled'` | 状态 |
| `eventName` | string | 赛事名（如「2026 VCT CN联赛第二赛段」「CCT 2026 欧洲系列赛 第7季」） |
| `stage` | string | 阶段（小组赛/季后赛/常规赛…） |
| `subStage` | string | 子阶段（组别·周次/轮次/进度，点号连接） |
| `format` | string | 赛制（BO3/BO5…，可为空） |

`kind: 'duel'`（VCT / CS）附加字段：

| 字段 | 说明 |
| --- | --- |
| `teamAId` / `teamBId` | A/B 队的全局战队 ID |
| `scoreA` / `scoreB` | A/B 队胜场数（未开始时为 0） |

`kind: 'multi'`（DFPL）附加字段：

| 字段 | 说明 |
| --- | --- |
| `teamIds` | 参赛战队全局 ID 列表（通常 6 支） |
| `ranking` | 按名次排序的战队 ID（第一名在前），仅已结束时有意义 |

### 状态映射

| VCT `status_id` | DFPL `status_id` | CS `status_id` | 归一化 status |
| --- | --- | --- | --- |
| 1 | 1 | 1 | `upcoming` |
| 2 | 3 | 2 | `live` |
| 3 | 4 | 3 | `finished` |
| — | 2 | — | `canceled` |

### 过滤规则

- 参赛队伍未公布（VCT team_id 为空 / DFPL 有效队数 < 2 / CS 队伍为 TBD）的比赛**不输出**；
- 战队 ID 必须能回溯到 teams 表，否则丢弃（保证引用完整性）。

## 前端消费方式

`web/src/data.ts` 将 JSON 转 `EsportsData` 并提供：
`gameById` / `teamById` 索引 Map、`matchTeamIds(match)`（统一取参赛队）、
`matchCountByTeamId`（每队场次，筛选面板展示）、
北京时间日期分组工具（`dateKeyOf` / `todayKey` / `formatDateLabel` / `formatTime`）。
rollup 打包时 JSON 以 `inline-json` 插件内联为 JS 模块，无需运行时 fetch。
