# VCT 无畏契约赛事数据(爬取自 https://vct.qq.com/schedule.html)

由 `vct_crawler.py` 生成。接口基址: `https://val.native.game.qq.com/esports/v1/data/`

## 文件说明
| 文件 | 内容 |
| --- | --- |
| vct_data.json | 汇总分层 JSON(唯一完整数据源) |
| events.csv | 赛事表 |
| teams.csv | 战队表 |
| players.csv | 选手表 |
| matches.csv | 赛程表 |

## 关键字段
- 状态: `status_id` 1=未开始, 2=进行中, 3=已结束; 对应 `status_zh` 中文。
- teams.csv `event_ids`: 该战队参加过的赛事 id, 分号分隔。
- matches.csv 每行一场比赛; `score_a/score_b` 为 A/B 队胜场数; `progress` 为进度说明(可为空)。
- `match_date` 为带时区的 ISO 时间(北京时间 UTC+8)。
- JSON 内 `teams[].players[]` 为战队选手名单; `matches[].small_matches[]` 为各小局回放信息。

## 重新抓取
```bash
python vct_crawler.py                 # 全部官方展示赛事
python vct_crawler.py --game-id 1000068
```
