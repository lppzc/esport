# 5EPlay CS 赛事数据(HLTV 数据镜像)

来源: https://event.5eplay.com/csgo/matches
说明: hltv.org 被 Cloudflare 拦截无法直接抓取; 5EPlay 的数据即 HLTV 数据(战队 id 形如 hltv_team_xxx)。

## 文件说明
| 文件 | 内容 |
| --- | --- |
| cs_data.json | 汇总分层 JSON(唯一完整数据源) |
| events.csv | 赛事/锦标赛表 |
| teams.csv | 战队表(含 HLTV 世界排名、Valve 排名、积分) |
| matches.csv | 赛程表(未开赛+进行中+已结束) |

## 关键字段
- 状态: `status_id` 1=未开始, 2=进行中, 3=已结束(与 VCT/DFPL 日程枚举一致)。
- `match_format`: BO1/BO3/BO5; `stage`: 赛程阶段(如"小组赛 第二轮")。
- `match_date`: 北京时间 ISO 8601。
- JSON 内 `matches[].maps[]` 为已结束比赛的每图比分。
- teams.csv `world_rank` 为 0 表示该队暂无 HLTV 排名(仅出现在赛程中)。

## 重新抓取
```bash
python cs_crawler.py                    # 全部未开赛 + 最近10页结果 + 全部战队排名
python cs_crawler.py --result-pages 20  # 更多历史赛程
```
