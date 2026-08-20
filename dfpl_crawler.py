# -*- coding: utf-8 -*-
"""
DF 烽火职业联赛赛程、战队爬虫

数据源页面: https://df.qq.com/cp/DFPL/#/course
实际接口:
  POST https://df.timi-esports.qq.com/df/GetKVConfig
  POST https://df.timi-esports.qq.com/df/getDfScheduleList
  POST https://df.timi-esports.qq.com/df/getDfTeamList

默认抓取官网当前赛季。输出 JSON、CSV，适合后续入库或分析。

用法:
  python dfpl_crawler.py
  python dfpl_crawler.py --season-id DFPL2026S1
  python dfpl_crawler.py --all-seasons --out-dir dfpl_output

依赖:
  pip install requests
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import os
import sys
from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

PAGE_URL = "https://df.qq.com/cp/DFPL/#/course"
BASE_URL = "https://df.timi-esports.qq.com"
OUT_DIR = "dfpl_output"
CONFIG_IDS = [
    "seasonid_dfpl", "cur_stage_dfpl", "MatchDetail_config_dfpl",
    "VideoTag_config_dfpl", "HomeJump_config_dfpl", "TeamInfo_config_dfpl",
    "LiveStream_config_dfpl", "DefaultStream_config_dfpl", "max_mvp_config_dfpl",
    "final_stage_card_config_dfpl", "follow_dfpl", "team_view_dfpl",
]
STATUS = {0: "未知", 1: "未开始", 2: "已取消", 3: "进行中", 4: "已结束"}
SETTLEMENT_TYPE = {0: "无", 1: "积分", 2: "排名"}

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "Origin": "https://df.qq.com",
    "Referer": "https://df.qq.com/cp/DFPL/",
}


def make_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(HEADERS)
    retry = Retry(
        total=3,
        backoff_factor=0.7,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(["POST"]),
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=4, pool_maxsize=8)
    session.mount("https://", adapter)
    return session


def post_json(session: requests.Session, path: str, payload: dict[str, Any]) -> dict[str, Any]:
    response = session.post(BASE_URL + path, json=payload, timeout=30)
    response.raise_for_status()
    data = response.json()
    if data.get("result") not in (None, 0):
        raise RuntimeError(f"接口返回错误 result={data.get('result')}: {path}")
    return data


def parse_config_value(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return value


def load_config(session: requests.Session) -> dict[str, Any]:
    result = post_json(session, "/df/GetKVConfig", {"config_id": CONFIG_IDS})
    raw = result.get("data") or {}
    return {key: parse_config_value(value) for key, value in raw.items()}


def season_catalog(config: dict[str, Any]) -> list[dict[str, str]]:
    seasons = []
    detail = config.get("MatchDetail_config_dfpl") or []
    if isinstance(detail, list):
        for item in detail:
            if isinstance(item, dict) and item.get("seasonid"):
                seasons.append({
                    "season_id": str(item["seasonid"]),
                    "season_name": item.get("season_name", ""),
                })
    return seasons


def stage_index(config: dict[str, Any], season_id: str) -> dict[str, dict[str, str]]:
    """将配置中的 scheduleid 映射到赛段、轮次、分组。"""
    index: dict[str, dict[str, str]] = {}
    details = config.get("MatchDetail_config_dfpl") or []
    if not isinstance(details, list):
        return index
    season = next((x for x in details if x.get("seasonid") == season_id), None)
    for stage in (season or {}).get("stages", []):
        for item in stage.get("schedule_list", []):
            index[item.get("scheduleid", "")] = {
                "stage_id": stage.get("stageid", ""),
                "stage_name": stage.get("stage_name", ""),
                "round_name": item.get("round_name", ""),
                "group_name": item.get("group_name", ""),
                "week_num": item.get("week_num"),
                "win_team_num": item.get("win_team_num"),
                "green_tag_num": item.get("green_tag_num"),
            }
    return index


def team_info_index(config: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """TeamInfo_config_dfpl: [{teamid, sort, img}, ...]，teamid 含赛季前缀，直接按 teamid 索引。"""
    info = config.get("TeamInfo_config_dfpl") or []
    if not isinstance(info, list):
        return {}
    return {str(x.get("teamid", "")): x for x in info if isinstance(x, dict)}


def unix_to_iso(value: Any) -> str:
    try:
        timestamp = int(value)
        return dt.datetime.fromtimestamp(timestamp, dt.timezone.utc).astimezone().isoformat(timespec="seconds")
    except (TypeError, ValueError, OSError, OverflowError):
        return ""


def normalize_team(
    item: dict[str, Any],
    season_id: str,
    info_index: dict[str, dict[str, Any]],
    view_index: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    team_id = item.get("teamid", "")
    info = info_index.get(team_id) or {}
    view = view_index.get(team_id) or {}
    return {
        "team_id": team_id,
        "club_id": item.get("clubid", ""),
        "name_zh": item.get("team_name", ""),
        "name_en": item.get("team_name_en", ""),
        "logo_url": item.get("team_logo", "") or info.get("img", ""),
        "season_id": season_id,
        "sort": info.get("sort"),
        "jump_url": view.get("jump_url", ""),
    }


def normalize_schedule(
    item: dict[str, Any], season_id: str, team_index: dict[str, dict[str, Any]], stage_map: dict[str, dict[str, str]]
) -> dict[str, Any]:
    schedule_id = item.get("scheduleid", "")
    metadata = stage_map.get(schedule_id, {})
    team_ids = [x for x in str(item.get("team_list") or "").split(";") if x]
    result_ids = [x for x in str(item.get("schedule_result") or "").split(";") if x]
    teams = []
    for rank, team_id in enumerate(team_ids, 1):
        team = team_index.get(team_id, {})
        teams.append({
            "rank": result_ids.index(team_id) + 1 if team_id in result_ids else 0,
            "team_id": team_id,
            "name_zh": team.get("name_zh", "待定"),
            "name_en": team.get("name_en", ""),
            "logo_url": team.get("logo_url", ""),
            "result_order": rank,
        })
    return {
        "schedule_id": schedule_id,
        "season_id": season_id,
        "stage_id": metadata.get("stage_id", ""),
        "stage_name": metadata.get("stage_name", ""),
        "round_name": metadata.get("round_name", ""),
        "group_name": metadata.get("group_name", ""),
        "week_num": metadata.get("week_num"),
        "start_timestamp": item.get("start_timestamp"),
        "start_time": unix_to_iso(item.get("start_timestamp")),
        "status_id": item.get("schedule_status"),
        "status_zh": STATUS.get(item.get("schedule_status"), "未知"),
        "bo_total": item.get("bo_total"),
        "settlement_type_id": item.get("settlement_type"),
        "settlement_type": SETTLEMENT_TYPE.get(item.get("settlement_type"), ""),
        "win_team_num": item.get("win_team_num", metadata.get("win_team_num")),
        "green_tag_num": item.get("green_tag_num", metadata.get("green_tag_num")),
        "team_ids": team_ids,
        "result_team_ids": result_ids,
        "teams": teams,
        "replays": [
            {
                "replay_id": replay.get("id"),
                "title": replay.get("title", ""),
                "video_id": replay.get("vid", ""),
                "small_round": replay.get("small_round"),
                "create_time": replay.get("create_time", ""),
            }
            for replay in item.get("reply_list") or []
        ],
    }


def flatten_players(data: dict[str, Any]) -> list[dict[str, Any]]:
    """接口当前仅提供战队信息；保留统一 players 字段，方便后续接口扩展。"""
    return []


def write_csv(path: str, headers: list[str], rows: list[list[Any]]) -> None:
    with open(path, "w", encoding="utf-8-sig", newline="") as file:
        writer = csv.writer(file)
        writer.writerow(headers)
        writer.writerows(rows)


def export_files(data: dict[str, Any], out_dir: str) -> None:
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "dfpl_data.json"), "w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)

    seasons = data["seasons"]
    write_csv(
        os.path.join(out_dir, "seasons.csv"),
        ["season_id", "season_name"],
        [[x["season_id"], x["season_name"]] for x in seasons],
    )
    write_csv(
        os.path.join(out_dir, "teams.csv"),
        ["team_id", "club_id", "name_zh", "name_en", "logo_url", "season_id", "sort", "jump_url"],
        [[t[k] for k in ["team_id", "club_id", "name_zh", "name_en", "logo_url", "season_id", "sort", "jump_url"]]
         for t in data["teams"]],
    )
    write_csv(
        os.path.join(out_dir, "schedules.csv"),
        ["schedule_id", "season_id", "stage_id", "stage_name", "round_name", "group_name",
         "week_num", "start_time", "status_id", "status_zh", "bo_total", "settlement_type",
         "team_ids", "result_team_ids"],
        [[
            s["schedule_id"], s["season_id"], s["stage_id"], s["stage_name"], s["round_name"],
            s["group_name"], s["week_num"], s["start_time"], s["status_id"], s["status_zh"],
            s["bo_total"], s["settlement_type"], ";".join(s["team_ids"]), ";".join(s["result_team_ids"]),
        ] for s in data["schedules"]],
    )
    readme = """# DF 烽火职业联赛数据

来源: https://df.qq.com/cp/DFPL/#/course

- `dfpl_data.json`: 完整标准 JSON，包含赛事、战队、赛程、回放和原始配置摘要。
- `seasons.csv`: 赛季列表。
- `teams.csv`: 战队列表。
- `schedules.csv`: 赛程列表。

赛程状态: `1=未开始`、`2=已取消`、`3=进行中`、`4=已结束`。
`start_time` 是本地时区 ISO 8601 时间；`bo_total` 表示该场比赛的局数配置。
"""
    with open(os.path.join(out_dir, "README.md"), "w", encoding="utf-8") as file:
        file.write(readme)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="爬取 DF 烽火职业联赛赛程与战队数据")
    parser.add_argument("--season-id", help="指定赛季，例如 DFPL2026S2；默认当前赛季")
    parser.add_argument("--all-seasons", action="store_true", help="抓取配置中的全部赛季")
    parser.add_argument("--out-dir", default=OUT_DIR, help="输出目录，默认 dfpl_output")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    session = make_session()
    print("[1/3] 获取赛季配置 ...")
    config = load_config(session)
    catalog = season_catalog(config)
    current = str(config.get("seasonid_dfpl") or "")

    if args.all_seasons:
        season_ids = [x["season_id"] for x in catalog]
    elif args.season_id:
        season_ids = [args.season_id]
    else:
        season_ids = [current]
    season_ids = list(dict.fromkeys(x for x in season_ids if x))
    if not season_ids:
        print("错误：没有可用赛季 ID", file=sys.stderr)
        return 1

    season_names = {x["season_id"]: x["season_name"] for x in catalog}
    all_teams: list[dict[str, Any]] = []
    all_schedules: list[dict[str, Any]] = []
    print(f"[2/3] 抓取 {len(season_ids)} 个赛季 ...")
    for season_id in season_ids:
        team_result = post_json(session, "/df/getDfTeamList", {"season_id": season_id})
        schedule_result = post_json(session, "/df/getDfScheduleList", {"season_id": season_id})
        view = config.get("team_view_dfpl") or {}
        view_index = {x.get("teamid"): x for x in view.get("teams", [])} if isinstance(view, dict) else {}
        info_index = team_info_index(config)
        teams = [normalize_team(x, season_id, info_index, view_index) for x in team_result.get("data") or []]
        team_index = {x["team_id"]: x for x in teams}
        stages = stage_index(config, season_id)
        schedules = [normalize_schedule(x, season_id, team_index, stages) for x in schedule_result.get("data") or []]
        all_teams.extend(teams)
        all_schedules.extend(schedules)
        print(f"  {season_id} {season_names.get(season_id, '')}: {len(teams)} 支战队 / {len(schedules)} 场赛程")

    data = {
        "meta": {
            "source_page": PAGE_URL,
            "api_base": BASE_URL,
            "fetched_at": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
            "current_season_id": current,
            "season_ids": season_ids,
            "schema_version": "1.0",
        },
        "seasons": [x for x in catalog if x["season_id"] in season_ids],
        "teams": all_teams,
        "players": flatten_players(data={}),
        "schedules": sorted(all_schedules, key=lambda x: (x["start_timestamp"] or "", x["schedule_id"])),
    }
    print("[3/3] 写入标准 JSON 和 CSV ...")
    export_files(data, args.out_dir)
    print(f"完成：{len(data['seasons'])} 个赛季 / {len(data['teams'])} 支战队 / {len(data['schedules'])} 场赛程")
    print(f"输出目录：{os.path.abspath(args.out_dir)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
