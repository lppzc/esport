# Esports Timeline · 电竞比赛日程

多游戏电竞比赛日程网站：比赛以**垂直时间轴**按日展示，支持**按战队筛选**，
并严格区分不同游戏中**同名同 logo 的不同战队**。

![tech](https://img.shields.io/badge/React-18-61dafb) ![tech](https://img.shields.io/badge/TypeScript-5-3178c6) ![license](https://img.shields.io/badge/private-repo-orange)

## 项目组成

| 模块 | 路径 | 说明 |
| --- | --- | --- |
| 数据爬虫 | `vct_crawler.py` | 无畏契约 VCT 赛事数据（vct.qq.com） |
| 数据爬虫 | `dfpl_crawler.py` | 三角洲行动 DF 烽火职业联赛数据（df.qq.com） |
| 爬虫输出 | `output/`、`dfpl_output/` | 分层 JSON + 派生 CSV |
| 前端网站 | `web/` | React 18 + TypeScript + Rollup 静态站点 |

数据规模：**2 个游戏 · 134 支战队 · 952 场比赛**

## 快速开始

```bash
# 1. 网站开发（进入 web 目录）
cd web
npm install --ignore-scripts
npm run dev                 # http://127.0.0.1:5173

# 2. （可选）爬虫数据更新后重新生成前端数据
npm run build:data

# 3. 生产构建
npm run typecheck && npm run build   # -> web/dist/
```

爬虫依赖 Python 3.10+（标准库实现，无第三方依赖）：

```bash
python vct_crawler.py                # 全部官方展示赛事
python vct_crawler.py --game-id 1000068
python dfpl_crawler.py
```

## 核心特性

- ⏱ **时间轴展示**：按日分组的垂直时间轴，今日节点高亮、一键定位今天，
  支持 新→旧 / 旧→新 方向切换
- 🏆 **战队筛选**：按游戏分组的多选筛选面板 + 搜索；支持同时追踪多支
  跨游戏同名战队；游戏、状态（进行中/未开始/已结束）多维组合筛选
- 🔀 **同名战队区分**：不同游戏中同名（甚至同 logo）的战队是不同实体，
  以「游戏前缀:原始ID」全局唯一标识（详见下）
- 🎮 **双赛制支持**：VCT 的 A/B 对阵（比分）与 DFPL 的六队同场积分制（名次）各有专属卡片
- 🖤 **电竞深色主题**：LIVE 脉冲标记、胜者金色高亮、多队赛第一名金标、
  全站深色滚动条、响应式布局、长列表 `content-visibility` 渲染优化

## 同名战队如何区分（本项目的关键设计）

真实数据中存在 **16 个跨游戏重名战队**：`BLG / JDG / NOVA / Q9 / TEC / WBG …`
——例如「无畏契约的 BLG」与「三角洲行动的 BLG」名字和缩写完全相同，但是
**完全不同的战队**（不同俱乐部、不同 logo、不同选手阵容）。此外 VCT 内部
还存在两支不同的 NOVA。

三层防线保证绝不混淆：

1. **数据模型层**：战队全局唯一 ID 采用 `游戏前缀:原始ID` 格式
   （`vct:21` = 无畏契约 BLG，`dfpl:blg` = 三角洲 BLG，`vct:30` / `vct:96`
   = VCT 内部两支 NOVA），从 ID 体系上不可能串数据；
2. **筛选面板**：按游戏分组展示，搜索同名战队时不同游戏的条目并列出现，
   各带游戏徽章与该游戏下的 logo，可直观对比、同时勾选；
3. **展示层**：比赛卡片带游戏色徽章与左侧色条，已选战队 chips 标注所属游戏，
   混排浏览时一眼可辨。

## 数据流水线

```
vct_crawler.py ──▶ output/vct_data.json ─┐
                                         ├─▶ web/scripts/build-data.mjs
dfpl_crawler.py ─▶ dfpl_output/          │      （归一化：战队ID加游戏前缀、
    dfpl_data.json ──────────────────────┘       统一比赛 schema、排序）
                                                  │
                                                  ▼
                                        web/src/data/esports.json
                                                  │  rollup 打包时内联
                                                  ▼
                                        web/dist/ （纯静态，可任意托管）
```

统一的比赛 schema：

```ts
DuelMatch  { kind: 'duel',  teamAId, teamBId, scoreA, scoreB }  // VCT：A/B 对阵
MultiMatch { kind: 'multi', teamIds[], ranking[] }              // DFPL：多队同场积分制
```

## 文档

- [web/README.md](web/README.md) —— 前端架构、构建工具链、开发指南
- [docs/security-review.md](docs/security-review.md) —— 安全审查报告
- [docs/data-schema.md](docs/data-schema.md) —— 归一化数据结构字段说明
- 各爬虫输出目录内的 README 说明字段含义

## 目录结构

```
esport/
├── vct_crawler.py          # VCT 爬虫
├── dfpl_crawler.py         # DFPL 爬虫
├── output/                 # VCT 爬虫输出
├── dfpl_output/            # DFPL 爬虫输出
└── web/                    # 前端网站
    ├── scripts/            # build-data / build / dev 脚本
    ├── src/                # React 源码 + 内联数据
    └── dist/               # 构建产物（gitignore）
```

## 数据来源与声明

数据爬取自腾讯电竞官方页面（vct.qq.com / df.qq.com），仅用于学习研究。
战队名称与 logo 版权归各自俱乐部所有。
