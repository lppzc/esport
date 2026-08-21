# -*- coding: utf-8 -*-
"""
5EPlay 赛事数据中心 CS 赛程/战队爬虫
=====================================
数据源页面 : https://event.5eplay.com/csgo/matches  (React 单页应用)
实际数据接口(均为 5EPlay 转载的 HLTV 数据, 战队 id 形如 hltv_team_xxx):
  * 未开赛/进行中  GET  https://app.5eplay.com/api/tournament/session_list
                   params: game_status=1, game_type=1, page, limit
  * 已结束赛程     GET  https://app.5eplay.com/api/tournament/session_result_list
                   params: game_type=1, order_by=asc, page_size, page_token
                   (page_token = "YYYY-MM-DD HH:mm:ss,matchId1,matchId2,...", 按开赛时间回溯)
  * 战队世界排名   POST https://esports-data.5eplaycdn.com/v1/api/csgo/new/rank/team_list
                   body: {rank_type:"rank", sort_key:"rank", ...}

说明: hltv.org 本站被 Cloudflare Turnstile 拦截(403), 无法稳定抓取;
      5EPlay 数据即 HLTV 数据的镜像, 字段中保留 hltv_team_* 原始 id。

输出(保存于 out_dir, 默认 ./cs_output), 状态枚举与 VCT 日程统一(1未开始/2进行中/3已结束):
  * cs_data.json  —— 汇总 JSON(meta/events/teams/matches)
  * events.csv    —— 赛事表(锦标赛)
  * teams.csv     —— 战队表(含世界排名/Valve排名/积分)
  * matches.csv   —— 赛程表(未开赛+进行中+已结束, 含每图比分)
  * README.md     —— 字段说明

用法:
  python cs_crawler.py                          # 默认: 全部未开赛 + 最近10页已结束 + 全部战队排名
  python cs_crawler.py --result-pages 20        # 多抓一些历史赛程
  python cs_crawler.py --out-dir cs_output
依赖: pip install requests
"""

from __future__ import annotations

import argparse
import csv
import datetime as _dt
import json
import os
import re
import sys
from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

PAGE_URL = "https://event.5eplay.com/csgo/matches"
APP_BASE = "https://app.5eplay.com"
DATA_BASE = "https://esports-data.5eplaycdn.com"
DEFAULT_OUT_DIR = "cs_output"
TZ = _dt.timezone(_dt.timedelta(hours=8))  # 北京时间

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Referer": PAGE_URL,
    "Origin": "https://event.5eplay.com",
}

# 与 VCT 日程统一的状态枚举: 1=未开始 2=进行中 3=已结束
MATCH_STATUS = {1: "未开始", 2: "进行中", 3: "已结束"}


def make_session() -> requests.Session:
    s = requests.Session()
    s.headers.update(HEADERS)
    retry = Retry(
        total=3,
        backoff_factor=0.8,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(["GET", "POST"]),
    )
    s.mount("https://", HTTPAdapter(max_retries=retry, pool_connections=8, pool_maxsize=16))
    return s


def check(d: dict, url: str) -> dict:
    if d.get("errcode") not in (0, None) or d.get("success") is False:
        raise RuntimeError(f"接口返回错误 errcode={d.get('errcode')} url={url}")
    return d


def unix_to_iso(ts: Any) -> str:
    try:
        return _dt.datetime.fromtimestamp(int(ts), TZ).isoformat(timespec="seconds")
    except (TypeError, ValueError, OSError, OverflowError):
        return ""


def to_int(v: Any, default: int = 0) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------------------
# 接口抓取
# ---------------------------------------------------------------------------
def fetch_upcoming(session: requests.Session, limit: int = 50) -> list[dict]:
    """全部未开赛/进行中的比赛(game_status=1), 按 page 翻页直到为空。"""
    matches: list[dict] = []
    page = 1
    while True:
        url = f"{APP_BASE}/api/tournament/session_list"
        d = check(
            session.get(
                url,
                params={"game_status": 1, "game_type": 1, "grades": "", "page": page, "limit": limit},
                timeout=30,
            ).json(),
            url,
        )
        batch = (d.get("data") or {}).get("matches") or []
        if not batch:
            break
        matches.extend(batch)
        if len(batch) < limit:
            break
        page += 1
    return matches


def make_page_token(items: list[dict]) -> str:
    """按前端逻辑构造 page_token: 取本页最早一场的开赛时间 + 同时刻全部比赛 id。
    注意: 接口按时间升序返回, 页面显示为倒序, 前端取"最后一项"即本页最早一场。"""
    first_ts = items[0]["mc_info"]["plan_ts"]
    ids = [x["mc_info"]["id"] for x in items if x["mc_info"]["plan_ts"] == first_ts]
    t = _dt.datetime.fromtimestamp(int(first_ts), TZ)
    return t.strftime("%Y-%m-%d %H:%M:%S") + "," + ",".join(dict.fromkeys(ids))


def fetch_results(session: requests.Session, pages: int, page_size: int = 20) -> list[dict]:
    """已结束比赛(含每图比分), page_token 回溯翻页, 全局按比赛 id 去重。"""
    seen: dict[str, dict] = {}
    token: str | None = None
    for _ in range(max(1, pages)):
        params: dict[str, Any] = {
            "game_type": 1, "order_by": "asc", "grades": "", "page_size": page_size,
        }
        if token:
            params["page_token"] = token
        url = f"{APP_BASE}/api/tournament/session_result_list"
        d = check(session.get(url, params=params, timeout=30).json(), url)
        batch = (d.get("data") or {}).get("matches") or []
        if not batch:
            break
        new_ids = [m["mc_info"]["id"] for m in batch if m["mc_info"]["id"] not in seen]
        for m in batch:
            seen.setdefault(m["mc_info"]["id"], m)
        token = make_page_token(batch)
        if not new_ids:
            # 该页全部为重复数据(边界抖动), 继续回溯一页
            continue
    return list(seen.values())


def fetch_team_ranking(session: requests.Session) -> list[dict]:
    """战队世界排名列表(HLTV 榜单镜像), 翻页取全量。"""
    items: list[dict] = []
    page = 1
    while True:
        body = {
            "sort_value": "desc",
            "rank_type": "rank",
            "sort_key": "rank",
            "region": "全部赛区",
            "team_options": {
                "tt_ids": [], "time_value": "", "grade": [], "team_id": "",
                "time_type": "self", "tt_series": [], "maps": [], "page": page,
            },
        }
        url = f"{DATA_BASE}/v1/api/csgo/new/rank/team_list"
        d = check(session.post(url, json=body, timeout=30).json(), url)
        data = d.get("data") or {}
        batch = data.get("items") or []
        items.extend(batch)
        total_page = to_int(data.get("total_page"), 1)
        if page >= total_page or not batch:
            break
        page += 1
    return items


# ---------------------------------------------------------------------------
# 标准化(与 vct_crawler / dfpl_crawler 的日程格式对齐)
# ---------------------------------------------------------------------------
def normalize_event(tt: dict) -> dict:
    return {
        "event_id": tt.get("id", ""),
        "name_zh": tt.get("disp_name", ""),
        "city": tt.get("city_name", ""),
        "start_date": (tt.get("start_time") or "")[:10],
        "end_date": (tt.get("end_time") or "")[:10],
        "grade": tt.get("grade", ""),
        "grade_label": tt.get("grade_label", ""),
        "bonus": tt.get("bonus", ""),
        "logo_url": tt.get("logo", ""),
    }


def normalize_team_ref(info: dict) -> dict:
    return {
        "team_id": info.get("id", ""),
        "name": info.get("disp_name", ""),
        "logo": info.get("logo", ""),
        "rank": info.get("rank", ""),
    }


def unified_status(state: dict, start_ts: Any, now: _dt.datetime | None = None) -> int:
    """源数据 state.status: '0'=未开始 '2'=已结束; live_status=='1' 表示该场有直播安排/标记。

    注意: live_status='1' 不等于"正在进行"——未开赛的未来比赛也会带此标记(实测
    电竞世俱杯八强开赛前 8 小时即为 1)。因此判定"进行中"必须叠加时间闸门:
    仅当 live_status=1 且开赛时间已过才视为进行中, 否则未开赛的比赛会被错标。

    统一映射为 1=未开始 2=进行中 3=已结束(与 VCT matchStatusId 一致)。"""
    if str(state.get("status", "")) == "2":
        return 3
    if str(state.get("live_status", "")) == "1":
        if now is None:
            now = _dt.datetime.now(TZ)
        try:
            start = _dt.datetime.fromtimestamp(int(start_ts), TZ)
        except (TypeError, ValueError, OSError, OverflowError):
            return 1  # 开赛时间异常时保守处理为未开始
        if now >= start:
            return 2
    return 1


def normalize_match(item: dict) -> dict:
    mc = item.get("mc_info") or {}
    state = item.get("state") or {}
    tt = item.get("tt_info") or {}
    fmt = mc.get("format", "")
    maps = []
    for b in state.get("bout_states") or []:
        maps.append(
            {
                "map": b.get("map_name", ""),
                "score_a": to_int(b.get("t1_score")),
                "score_b": to_int(b.get("t2_score")),
                "winner": "A" if b.get("result") == "t1" else ("B" if b.get("result") == "t2" else ""),
            }
        )
    status_id = unified_status(state, mc.get("plan_ts"))
    return {
        "match_id": mc.get("id", ""),
        "event_id": tt.get("id", ""),
        "event_name": tt.get("disp_name", ""),
        "match_date": unix_to_iso(mc.get("plan_ts")),
        "start_timestamp": mc.get("plan_ts"),
        "status_id": status_id,
        "status_zh": MATCH_STATUS.get(status_id, "未知"),
        "team_a": normalize_team_ref(mc.get("t1_info") or {}),
        "team_b": normalize_team_ref(mc.get("t2_info") or {}),
        "score_a": to_int(state.get("t1_score")),
        "score_b": to_int(state.get("t2_score")),
        "match_format": f"BO{fmt}" if fmt else "",
        "stage": mc.get("tt_stage_desc", "") or mc.get("tt_stage", ""),
        "round_name": mc.get("round_name", ""),
        "odds": {
            "a": state.get("t1_odds", ""),
            "b": state.get("t2_odds", ""),
        },
        "maps": maps,
    }


def normalize_rank_team(item: dict) -> dict:
    f = item.get("field_values") or {}
    return {
        "team_id": item.get("team_id", ""),
        "name": item.get("team_name", ""),
        "logo": item.get("team_logo", ""),
        "country_logo": item.get("country_logo", ""),
        "world_rank": to_int(f.get("rank"), 0),
        "points": to_int(f.get("point"), 0),
        "valve_rank": to_int(f.get("valve_rank"), 0),
        "valve_points": to_int(f.get("valve_point"), 0),
        "region": f.get("region_name", ""),
        "event_ids": [],
    }


# ---------------------------------------------------------------------------
# 汇总 & 落盘
# ---------------------------------------------------------------------------
def build_data(upcoming: list[dict], results: list[dict], ranked_teams: list[dict]) -> dict:
    events: dict[str, dict] = {}
    teams: dict[str, dict] = {}
    matches: list[dict] = []

    for t in ranked_teams:
        nt = normalize_rank_team(t)
        teams[nt["team_id"]] = nt

    for raw in upcoming + results:
        m = normalize_match(raw)
        matches.append(m)
        tt = raw.get("tt_info") or {}
        if tt.get("id") and tt["id"] not in events:
            events[tt["id"]] = normalize_event(tt)
        for side in ("team_a", "team_b"):
            ref = m[side]
            if ref["team_id"] and ref["team_id"] not in teams:
                teams[ref["team_id"]] = {
                    "team_id": ref["team_id"],
                    "name": ref["name"],
                    "logo": ref["logo"],
                    "country_logo": "",
                    "world_rank": to_int(ref["rank"], 0),
                    "points": 0,
                    "valve_rank": 0,
                    "valve_points": 0,
                    "region": "",
                    "event_ids": [],
                }

    # 战队参赛赛事 id（与 VCT schema 对齐, 供数据合并层统计使用）
    for m in matches:
        eid = m["event_id"]
        if not eid:
            continue
        for side in ("team_a", "team_b"):
            team = teams.get(m[side]["team_id"])
            if team is not None and eid not in team.setdefault("event_ids", []):
                team["event_ids"].append(eid)

    # 赛事计数
    for e in events.values():
        e["match_count"] = sum(1 for m in matches if m["event_id"] == e["event_id"])
        e["teams_count"] = sum(1 for t in teams.values() if e["event_id"] in (t.get("event_ids") or []))

    matches.sort(key=lambda x: (x["start_timestamp"] or "", x["match_id"]))
    team_list = sorted(teams.values(), key=lambda t: (t["world_rank"] == 0, t["world_rank"], t["name"]))
    return {
        "meta": {
            "source_page": PAGE_URL,
            "api_base": [APP_BASE, DATA_BASE],
            "fetched_at": _dt.datetime.now().astimezone().isoformat(timespec="seconds"),
            "schema_version": "1.0",
            "status_enum": {"1": "未开始", "2": "进行中", "3": "已结束"},
        },
        "events": sorted(events.values(), key=lambda e: e["start_date"]),
        "teams": team_list,
        "matches": matches,
    }


def write_csv(path: str, header: list[str], rows: list[list], utf8_bom: bool = True) -> None:
    encoding = "utf-8-sig" if utf8_bom else "utf-8"
    with open(path, "w", newline="", encoding=encoding) as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


README_TEXT = """# 5EPlay CS 赛事数据(HLTV 数据镜像)

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
"""


def export_csv(data: dict, out_dir: str) -> list[str]:
    paths = []
    ev_rows = [
        [e["event_id"], e["name_zh"], e["city"], e["start_date"], e["end_date"],
         e["grade_label"], e["bonus"], e["logo_url"]]
        for e in data["events"]
    ]
    p = os.path.join(out_dir, "events.csv")
    write_csv(p, ["event_id", "name_zh", "city", "start_date", "end_date", "grade_label", "bonus", "logo_url"], ev_rows)
    paths.append(p)

    tm_rows = [
        [t["team_id"], t["name"], t["world_rank"], t["points"], t["valve_rank"],
         t["valve_points"], t["region"], t["logo"]]
        for t in data["teams"]
    ]
    p = os.path.join(out_dir, "teams.csv")
    write_csv(p, ["team_id", "name", "world_rank", "points", "valve_rank", "valve_points", "region", "logo"], tm_rows)
    paths.append(p)

    mt_rows = [
        [m["match_id"], m["event_id"], m["event_name"], m["match_date"], m["status_zh"],
         m["team_a"]["team_id"], m["team_a"]["name"], m["score_a"],
         m["team_b"]["team_id"], m["team_b"]["name"], m["score_b"],
         m["match_format"], m["stage"]]
        for m in data["matches"]
    ]
    p = os.path.join(out_dir, "matches.csv")
    write_csv(
        p,
        ["match_id", "event_id", "event_name", "match_date", "status_zh",
         "team_a_id", "team_a_name", "score_a", "team_b_id", "team_b_name", "score_b",
         "match_format", "stage"],
        mt_rows,
    )
    paths.append(p)
    return paths


def parse_args(argv=None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(
        description="爬取 5EPlay(HLTV 镜像)的 CS 赛程与战队数据(JSON + CSV)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument("--result-pages", type=int, default=10,
                    help="已结束赛程的抓取页数, 每页 20 场(默认 10 页)")
    ap.add_argument("--no-ranking", action="store_true", help="跳过战队世界排名抓取")
    ap.add_argument("--out-dir", type=str, default=DEFAULT_OUT_DIR, help="输出目录(默认 cs_output)")
    return ap.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    out_dir = args.out_dir
    os.makedirs(out_dir, exist_ok=True)
    session = make_session()

    print("[1/4] 抓取未开赛/进行中赛程 ...")
    upcoming = fetch_upcoming(session)
    print(f"  未开赛/进行中: {len(upcoming)} 场")

    print(f"[2/4] 抓取已结束赛程(最近 {args.result_pages} 页) ...")
    results = fetch_results(session, args.result_pages)
    print(f"  已结束: {len(results)} 场")

    print("[3/4] 抓取战队世界排名 ...")
    ranked = [] if args.no_ranking else fetch_team_ranking(session)
    print(f"  排名战队: {len(ranked)} 支")

    print("[4/4] 汇总标准化并写出文件 ...")
    data = build_data(upcoming, results, ranked)
    json_path = os.path.join(out_dir, "cs_data.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    csv_paths = export_csv(data, out_dir)
    with open(os.path.join(out_dir, "README.md"), "w", encoding="utf-8") as f:
        f.write(README_TEXT)

    n_status = {v: 0 for v in (1, 2, 3)}
    for m in data["matches"]:
        n_status[m["status_id"]] = n_status.get(m["status_id"], 0) + 1
    print()
    print(f"完成: {len(data['events'])} 个赛事 / {len(data['teams'])} 支战队 / {len(data['matches'])} 场比赛")
    print(f"  状态分布: 未开始 {n_status.get(1,0)} / 进行中 {n_status.get(2,0)} / 已结束 {n_status.get(3,0)}")
    print(f"输出目录: {os.path.abspath(out_dir)}")
    print(f"  JSON: {json_path}")
    for p in csv_paths:
        print(f"  CSV : {p}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
