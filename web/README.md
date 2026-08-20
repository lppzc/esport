# web/ —— 电竞赛程前端

React 18 + TypeScript + Rollup 构建的纯静态站点。

## 技术架构

```
src/main.tsx          入口（StrictMode + createRoot）
src/App.tsx           筛选状态管理（游戏/状态/战队/排序）+ 布局
src/data.ts           数据索引（teamById/gameById）、时间工具（北京时间）
src/types.ts          Game/Team/Match 联合类型定义
src/styles.css        全站样式（CSS 变量主题、深色滚动条）
src/data/esports.json 归一化数据（由 scripts/build-data.mjs 生成，打包时内联）
src/components/
  Timeline.tsx        时间轴（按日分组、今天高亮、空状态）
  MatchCard.tsx       比赛卡片（duel 对阵比分 / multi 多队名次两种赛制）
  TeamPicker.tsx      战队筛选面板（按游戏分组 + 搜索，memo 优化）
  TeamLogo.tsx        战队 logo（加载失败回退为按战队 ID 着色的色块）
scripts/
  build-data.mjs      爬虫 JSON → esports.json 归一化（战队 ID 加游戏前缀）
  build-lib.mjs       rollup 编程式构建核心（进程内，无子进程）
  build.mjs           生产构建入口 -> dist/
  dev.mjs             零依赖静态服务器 + fs.watch 自动重建
rollup.config.mjs     自定义插件：css 收集 / json 内联 / NODE_ENV 替换 / html 生成
```

### 为什么是 Rollup 而不是 Vite/esbuild？

本项目的构建/开发工具链必须**全程进程内执行**（不 spawn 子进程），
以适配受限沙箱环境。Rollup 的 native binding 通过 dlopen 加载、
TypeScript 编译走 ts API，均无子进程；dev 服务器用 `node:http` 手写。

## 命令

```bash
npm install --ignore-scripts   # 安装依赖（跳过 postinstall）
npm run build:data             # 从 ../output ../dfpl_output 重新生成 src/data/esports.json
npm run typecheck              # tsc --noEmit
npm run build                  # 生产构建 -> dist/（纯静态可托管）
npm run dev                    # 开发服务器 http://127.0.0.1:5173（watch 重建）
```

## 性能设计

- 战队筛选面板：`Intl.Collator` 排序器只创建一次、列表模块级预排序，
  搜索只做线性过滤；条目 `memo` 隔离 + 稳定回调，打字时仅命中项重渲染；
  遮罩层不用 `backdrop-filter`（避免滚动时持续大面积重绘）
- 时间轴长列表（952 场）：比赛卡片 `content-visibility: auto` +
  `contain-intrinsic-size`，视口外卡片跳过渲染
- 数据打包内联，无运行时网络请求（除战队 logo 图片懒加载）

## 同名战队区分

见[根 README](../README.md#同名战队如何区分本项目的关键设计)与
[数据结构文档](../docs/data-schema.md)——战队全局 ID 为 `游戏前缀:原始ID`
（如 `vct:21` 与 `dfpl:blg` 是两支不同的 BLG），筛选/展示全链路不串数据。
