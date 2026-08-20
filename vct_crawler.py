# -*- coding: utf-8 -*-
"""
VCT(无畏契约) 赛事官网赛程/战队爬虫
====================================
数据源页面 : https://vct.qq.com/schedule.html  (Vue 单页应用)
实际数据接口:
  * 赛事列表   GET https://val.native.game.qq.com/esports/v1/data/VAL_SGameList_display.json
  * 赛事详情   GET https://val.native.game.qq.com/esports/v1/data/VAL_Game_{gameId}.json   (含参赛战队/选手)
  * 赛事赛程   GET https://val.native.game.qq.com/esports/v1/data/VAL_Match_{gameId}.json  (含全部比赛)

输出(保存于 out_dir, 默认 ./output):
  * vct_data.json   —— 汇总 JSON(标准分层结构, 见脚本内 SCHEMA 注释)
  * events.csv      —— 赛事表
  * teams.csv       —— 战队表
  * players.csv     —— 选手表
  * matches.csv     —— 赛程表
  * README.md       —— 字段说明

用法:
  python vct_crawler.py                 # 爬取官网展示的全部赛事(display.officialSite=true)
  python vct_crawler.py --game-id 1000068,1000060
                                        # 只爬指定赛事(逗号分隔)
  python vct_crawler.py --workers 4 --out-dir output
                                        # 并发数 / 输出目录
依赖: pip install requests
"""

from __future__ import annotations

import argparse
import csv
import datetime as _dt
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------
PAGE_URL = "https://vct.qq.com/schedule.html"
API_BASE = "https://val.native.game.qq.com/esports/v1/data/"
DEFAULT_OUT_DIR = "output"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Referer": PAGE_URL,
}

# 比赛状态: matchStatusId -> 中文
MATCH_STATUS = {1: "未开始", 2: "进行中", 3: "已结束"}

# 赛事状态: gameStatusId -> 中文(与接口内 gameStatus 文本一致, 兜底用)
GAME_STATUS = {1: "未开始", 2: "进行中", 3: "已结束"}


# ---------------------------------------------------------------------------
# 请求封装(带重试)
# ---------------------------------------------------------------------------
def make_session() -> requests.Session:
    s = requests.Session()
    s.headers.update(HEADERS)
    retry = Retry(
        total=3,
        backoff_factor=0.8,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(["GET"]),
    )
    s.mount("https://", HTTPAdapter(max_retries=retry, pool_connections=8, pool_maxsize=16))
    return s


def get_json(session: requests.Session, url: str, timeout: int = 20) -> dict:
    """GET 并校验接口返回 {status:0, msg:...}, 失败抛异常。"""
    r = session.get(url, timeout=timeout)
    r.raise_for_status()
    data = r.json()
    if data.get("status") != 0:
        raise RuntimeError(f"API error status={data.get('status')} url={url}")
    return data


# ---------------------------------------------------------------------------
# 数据标准化(标准分层结构)
# ---------------------------------------------------------------------------
def iso_date(value: str) -> str:
    """'2026-08-23T00:00:00+08:00' -> '2026-08-23'"""
    if not value:
        return ""
    try:
        return value[:10]
    except Exception:
        return value


def normalize_events(session: requests.Session) -> list[dict]:
    """拉取赛事列表并归一化(仅保留官网展示的赛事)。"""
    data = get_json(session, API_BASE + "VAL_SGameList_display.json")
    events = []
    for item in data.get("msg", []):
        disp = item.get("display") or {}
        if not disp.get("officialSite"):
            continue  # 与官网左侧筛选栏一致: 只保留官方展示赛事
        events.append(
            {
                "event_id": item.get("secondLevelGameId"),
                "name_zh": item.get("secondLevelGameName", ""),
                "name_en": item.get("secondLevelGameEnName", ""),
                "year": item.get("gameYear"),
                "first_level_game_id": item.get("firstLevelGameId"),
                "start_date": iso_date(item.get("sDate")),
                "end_date": iso_date(item.get("eDate")),
                "status_id": item.get("gameStatusId"),
                "status_zh": item.get("gameStatus") or GAME_STATUS.get(item.get("gameStatusId"), ""),
                "logo_url": item.get("logoURL", ""),
                "stream_cover_url": item.get("streamCoverURL", ""),
                "desc": item.get("secondLevelGameDesc", ""),
                "is_default": bool(disp.get("default")),
            }
        )
    events.sort(key=lambda e: (e["start_date"] or ""))
    return events


def normalize_team(item: dict) -> dict:
    players = []
    for p in item.get("players") or []:
        players.append(
            {
                "player_id": p.get("playerId"),
                "nickname": p.get("nickName", ""),
                "real_name": p.get("realName", ""),
                "game_nickname": p.get("gameNickName", ""),
                "avatar": p.get("avatar", ""),
                "is_main": str(p.get("mainPlayer")) == "1",
                "is_active": str(p.get("active")) == "1",
                "is_focus": bool(p.get("focusPlayer")),
                "desc": p.get("description", ""),
            }
        )
    return {
        "team_id": item.get("teamId"),
        "sp_name": item.get("teamSpName", ""),      # 常用简称(如 EDG / JDG)
        "short_name": item.get("teamShortName", ""),
        "full_name": item.get("teamName", ""),
        "light_logo": item.get("teamLightLogo", ""),
        "dark_logo": item.get("teamDarkLogo", ""),
        "division": item.get("division", ""),
        "division_id": item.get("divisionId"),
        "coach": item.get("coach", ""),
        "desc": item.get("teamDesc", ""),
        "players": players,
    }


def normalize_match(item: dict, team_index: dict) -> dict:
    def team_ref(team_id, side_key):
        name = ""
        t = item.get(side_key)
        if isinstance(t, dict):
            name = t.get("teamSpName", "")
        else:
            t = team_index.get(team_id)
            if t:
                name = t["sp_name"]
        return {"team_id": team_id, "name": name}

    small = []
    for sm in item.get("smallMatches") or []:
        small.append(
            {
                "small_match_id": sm.get("sMatchId"),
                "name": sm.get("sMatchName", ""),
                "title": sm.get("sTitle", ""),
                "order": sm.get("order"),
                "video_id": sm.get("sVID", ""),
                "image": sm.get("sIMG", ""),
            }
        )
    live = item.get("live") or {}
    return {
        "match_id": item.get("bMatchId"),
        "event_id": item.get("secondLevelGameId"),
        "event_name": item.get("secondLevelGameName", ""),
        "match_name": item.get("bMatchName", ""),
        "match_date": item.get("matchDate", ""),
        "status_id": item.get("matchStatusId"),
        "status_zh": MATCH_STATUS.get(item.get("matchStatusId"), ""),
        "team_a": team_ref(item.get("teamAId"), "teamA"),
        "team_b": team_ref(item.get("teamBId"), "teamB"),
        "score_a": item.get("scoreA", 0),
        "score_b": item.get("scoreB", 0),
        "match_type": item.get("matchType", ""),
        "match_format": item.get("matchFormat", ""),
        "match_mode": item.get("matchMode", ""),
        "group_name": item.get("groupName", ""),
        "progress": item.get("progress"),
        "live": {
            "anchor_id": live.get("anchorId"),
            "focus_match": live.get("focusMatch"),
            "cloud_stream_id": live.get("cloudStreamId"),
        },
        "small_matches": small,
    }


def fetch_event_data(session: requests.Session, event: dict) -> dict:
    """抓取单个赛事: 详情(战队/选手) + 赛程, 返回归一化结果。"""
    gid = event["event_id"]
    game = get_json(session, f"{API_BASE}VAL_Game_{gid}.json")
    match = get_json(session, f"{API_BASE}VAL_Match_{gid}.json")

    game_msg = game.get("msg") or {}
    teams = [normalize_team(t) for t in game_msg.get("teams") or []]
    team_index = {t["team_id"]: t for t in teams}
    matches = [normalize_match(m, team_index) for m in match.get("msg") or []]
    matches.sort(key=lambda m: m["match_date"] or "")

    return {"event_id": gid, "teams": teams, "matches": matches}


# ---------------------------------------------------------------------------
# 汇总 & 落盘
# ---------------------------------------------------------------------------
def merge_all(events: list[dict], results: list[dict]) -> dict:
    """把各赛事的战队/赛程合并为分层结构, 战队跨赛事去重并记录参赛赛事。"""
    team_map: dict[int, dict] = {}
    all_matches = []
    event_map = {e["event_id"]: e for e in events}
    event_by_match = {}

    for r in results:
        gid = r["event_id"]
        if r["teams"]:
            event_map[gid]["teams_count"] = len(r["teams"])
        for t in r["teams"]:
            tid = t["team_id"]
            if tid not in team_map:
                team_map[tid] = {k: v for k, v in t.items() if k != "players"}
                team_map[tid]["event_ids"] = []
                team_map[tid]["players"] = t["players"]
            team_map[tid]["event_ids"].append(gid)
            # 选手归属战队信息补全
            for p in t["players"]:
                p.setdefault("team_id", tid)
                p.setdefault("team_sp_name", t["sp_name"])
        for m in r["matches"]:
            m.setdefault("event_name", event_map.get(gid, {}).get("name_zh", ""))
            all_matches.append(m)

    teams = list(team_map.values())
    teams.sort(key=lambda t: (t["sp_name"] or ""))
    all_matches.sort(key=lambda m: m["match_date"] or "")
    for e in events:
        e.setdefault("teams_count", 0)
        e["match_count"] = sum(1 for m in all_matches if m["event_id"] == e["event_id"])

    players = []
    for t in teams:
        players.extend(t["players"])

    return {
        "meta": {
            "source_page": PAGE_URL,
            "api_base": API_BASE,
            "generator": os.path.basename(__file__),
            "fetched_at": _dt.datetime.now().astimezone().isoformat(timespec="seconds"),
            "schema_version": "1.0",
        },
        "events": events,
        "teams": teams,
        "players": players,
        "matches": all_matches,
    }


def write_csv(path: str, header: list[str], rows: list[list], utf8_bom: bool = True) -> None:
    """写 CSV(默认带 UTF-8 BOM, 便于 Excel 直接打开中文不乱码)。"""
    encoding = "utf-8-sig" if utf8_bom else "utf-8"
    with open(path, "w", newline="", encoding=encoding) as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def export_csv(data: dict, out_dir: str) -> list[str]:
    """导出 CSV 表, 返回生成的文件路径列表。"""
    paths = []

    # events.csv
    ev_rows = [
        [
            e["event_id"], e["name_zh"], e["name_en"], e["year"], e["start_date"],
            e["end_date"], e["status_zh"], e["teams_count"], e["match_count"],
            e["is_default"], e["logo_url"],
        ]
        for e in data["events"]
    ]
    ev_csv = os.path.join(out_dir, "events.csv")
    write_csv(
        ev_csv,
        ["event_id", "name_zh", "name_en", "year", "start_date", "end_date",
         "status_zh", "teams_count", "match_count", "is_default", "logo_url"],
        ev_rows,
    )
    paths.append(ev_csv)

    # teams.csv
    tm_rows = [
        [
            t["team_id"], t["sp_name"], t["short_name"], t["full_name"], t["division"],
            t["division_id"], t["coach"], t["desc"], t["light_logo"], t["dark_logo"],
            len(t["players"]), ";".join(str(x) for x in t["event_ids"]),
        ]
        for t in data["teams"]
    ]
    tm_csv = os.path.join(out_dir, "teams.csv")
    write_csv(
        tm_csv,
        ["team_id", "sp_name", "short_name", "full_name", "division", "division_id",
         "coach", "desc", "light_logo", "dark_logo", "players_count", "event_ids"],
        tm_rows,
    )
    paths.append(tm_csv)

    # players.csv
    pl_rows = [
        [
            p["player_id"], p["nickname"], p["real_name"], p["game_nickname"],
            p.get("team_id", ""), p.get("team_sp_name", ""), p["avatar"],
            p["is_main"], p["is_active"], p["is_focus"], p["desc"],
        ]
        for p in data["players"]
    ]
    pl_csv = os.path.join(out_dir, "players.csv")
    write_csv(
        pl_csv,
        ["player_id", "nickname", "real_name", "game_nickname", "team_id",
         "team_sp_name", "avatar", "is_main", "is_active", "is_focus", "desc"],
        pl_rows,
    )
    paths.append(pl_csv)

    # matches.csv
    mt_rows = [
        [
            m["match_id"], m["event_id"], m["event_name"], m["match_name"],
            m["match_date"], m["status_zh"],
            m["team_a"]["team_id"], m["team_a"]["name"],
            m["team_b"]["team_id"], m["team_b"]["name"],
            m["score_a"], m["score_b"], m["match_type"], m["match_format"],
            m["match_mode"], m["group_name"], m["progress"],
        ]
        for m in data["matches"]
    ]
    mt_csv = os.path.join(out_dir, "matches.csv")
    write_csv(
        mt_csv,
        ["match_id", "event_id", "event_name", "match_name", "match_date", "status_zh",
         "team_a_id", "team_a_name", "team_b_id", "team_b_name", "score_a", "score_b",
         "match_type", "match_format", "match_mode", "group_name", "progress"],
        mt_rows,
    )
    paths.append(mt_csv)
    return paths


README_TEXT = """# VCT 无畏契约赛事数据(爬取自 https://vct.qq.com/schedule.html)

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
"""


def write_readme(out_dir: str) -> str:
    path = os.path.join(out_dir, "README.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write(README_TEXT)
    return path


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
def parse_args(argv=None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(
        description="爬取 VCT 无畏契约赛事官网的赛程与战队数据(JSON + CSV)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument("--game-id", type=str, default="",
                    help="只爬指定赛事(secondLevelGameId), 逗号分隔; 缺省爬全部官方展示赛事")
    ap.add_argument("--out-dir", type=str, default=DEFAULT_OUT_DIR, help="输出目录(默认 output)")
    ap.add_argument("--workers", type=int, default=8, help="并发抓取线程数(默认 8)")
    return ap.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    out_dir = args.out_dir
    os.makedirs(out_dir, exist_ok=True)

    session = make_session()

    print("[1/4] 拉取赛事列表 ...")
    events = normalize_events(session)
    if not events:
        print("错误: 未获取到赛事列表", file=sys.stderr)
        return 1

    if args.game_id.strip():
        wanted = {int(x) for x in args.game_id.split(",") if x.strip()}
        events = [e for e in events if e["event_id"] in wanted]
        missing = wanted - {e["event_id"] for e in events}
        if missing:
            print(f"警告: 以下赛事 id 不存在或未在官网展示: {sorted(missing)}", file=sys.stderr)

    print(f"[2/4] 开始抓取 {len(events)} 个赛事(每赛事 2 个接口, 并发 {args.workers}) ...")
    results: list[dict] = []
    failed: list[tuple[int, str]] = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        future_map = {pool.submit(fetch_event_data, session, e): e for e in events}
        done = 0
        for fut in as_completed(future_map):
            e = future_map[fut]
            done += 1
            try:
                results.append(fut.result())
                print(f"  [{done}/{len(events)}] {e['event_id']} {e['name_zh']} OK")
            except Exception as exc:  # noqa: BLE001
                failed.append((e["event_id"], str(exc)))
                print(f"  [{done}/{len(events)}] {e['event_id']} {e['name_zh']} 失败: {exc}")

    print("[3/4] 汇总并标准化数据 ...")
    data = merge_all(events, results)
    if failed:
        data["meta"]["failed_events"] = [{"event_id": i, "error": m} for i, m in failed]

    json_path = os.path.join(out_dir, "vct_data.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print("[4/4] 导出 CSV ...")
    csv_paths = export_csv(data, out_dir)
    readme_path = write_readme(out_dir)

    n_teams = len(data["teams"])
    n_players = len(data["players"])
    n_matches = len(data["matches"])
    print()
    print(f"完成: {len(events)} 个赛事 / {n_teams} 支战队 / {n_players} 名选手 / {n_matches} 场比赛")
    if failed:
        print(f"警告: {len(failed)} 个赛事抓取失败 -> {[i for i, _ in failed]}")
    print(f"输出目录: {os.path.abspath(out_dir)}")
    print(f"  JSON: {json_path}")
    for p in csv_paths:
        print(f"  CSV : {p}")
    print(f"  说明: {readme_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
