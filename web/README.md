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

## 部署与缓存（nginx）

生产构建产物带 **content hash**：`dist/app.<hash>.js` / `dist/app.<hash>.css`，
文件名由内容决定——内容变则文件名变；`dist/index.html` 自动引用带 hash 的
实际文件名。据此可对静态资源设置**永不重新下载**的长缓存，同时保证发版后
用户立即拿到新版本。

### nginx 配置示例

```nginx
# ── 电竞赛程站点缓存策略（按需调整路径前缀）──────────────────────

# 1) 入口 HTML：每次都向服务器校验（命中则 304，开销极小）。
#    它是唯一指向新 hash 文件名的入口，绝不能长缓存。
location = /index.html {
    add_header Cache-Control "no-cache";
}

# 2) 带 hash 的构建产物：内容变 → 文件名变 → URL 变，
#    同名 URL 内容永不改变，可安全缓存一年、免重新下载。
#    注意正则必须是 [\w-]+：Rollup 的 hash 是 base64url 字符集
#    （含大小写字母，如 app.DO1SlR4W.js），不是纯十六进制！
location ~* ^/app\.[\w-]+\.(js|css)$ {
    add_header Cache-Control "public, immutable, max-age=31536000";
}

# 3) 其余文件（如 data/esports.json）：短缓存兜底。
#    data/esports.json 是 CI 每 2 小时更新的活数据，只作核对用途
#    （运行时数据已内联进 app.<hash>.js），绝不能 immutable。
location / {
    add_header Cache-Control "public, max-age=300";
}
```

### 注意事项（踩坑点）

1. **hash 字符集不是十六进制**。Rollup 的 `[hash]` 用 base64url 编码，
   产出形如 `app.DO1SlR4W.js` 的文件名。nginx 正则写 `[0-9a-f]+` 会
   匹配不到文件，缓存规则整条失效——必须用 `[\w-]+`。
2. **数据内联在 JS 里，`immutable` 因此是安全的**。赛程数据在构建时
   打包进 `app.<hash>.js`：CI 更新数据 → 重新构建 → JS 内容变 → hash 变
   → 新 URL，浏览器自动绕过旧缓存。不需要为数据单独做缓存穿透。
3. **`index.html` 必须 `no-cache`**（校验式缓存，不是 `no-store`）。
   它是新旧产物唯一的切换开关；配合 ETag/Last-Modified 命中时只回 304。
4. **旧 hash 文件每次构建会被清空**（build 前全量 rm dist）。部署新版本
   与个别用户已打开的旧页面之间理论上存在一个极小的 404 窗口，刷新即恢复；
   如需零窗口可部署时保留上一版 hash 文件。
5. **`add_header` 的继承陷阱**：nginx 中 location 内一旦出现 `add_header`，
   就不再继承上层块的任何 `add_header`。若 http/server 层还有安全响应头
   （如 `X-Content-Type-Options`），需在每个 location 里重复声明。
6. **子路径部署**：本站资源引用为相对路径（`./app.xxx.js`），可部署在任意
   子路径下；此时上述正则去掉 `^` 锚点或加上路径前缀，如
   `~* ^/esports/app\.[\w-]+\.(js|css)$`。
7. **改过 rollup 配置后要重启 dev 服务器**：`npm run dev` 的 watch 重建
   使用启动时加载进内存的旧配置，不重启会继续产出无 hash 的 `app.js`。

### 验证缓存生效

```bash
curl -sI https://your-domain/app.DO1SlR4W.js | grep -i cache-control
# 期待：public, immutable, max-age=31536000
curl -sI https://your-domain/ | grep -i cache-control
# 期待：no-cache
```

## 响应式与扩展约定

### 断点

| 档位 | 断点 | 行为 |
| --- | --- | --- |
| 手机 | `≤ 680px` | 战队筛选面板为**底部抽屉**；页头说明折叠为 `<details>`；筛选栏滚动后进入紧凑态；触控目标加大 |
| 平板 | `681–1024px` | 默认布局（与桌面一致，列宽自适应） |
| 桌面 | `> 1024px` | 内容列宽 1080px；面板为居中模态框 |

新增响应式行为时遵守同一断点，不引入新分界线。

### 层级刻度（z-index）

`styles.css` 的 `:root` 定义了层级令牌，新组件一律引用、不要写裸数字：

```css
--z-sticky: 40;    /* sticky 元素（筛选栏） */
--z-overlay: 50;   /* 全屏遮罩 */
--z-dialog: 51;    /* 面板/对话框本体 */
```

### 新增弹层的模式

战队筛选面板（`TeamPicker`）确立了移动端弹层模式，后续「按赛事筛选」
「收藏面板」等直接复用同一套结构：

- 移动端：底部抽屉（`bottom: 0`、`max-height: 86dvh`、上圆角、
  `sheet-up` 上滑动画、`env(safe-area-inset-bottom)` 底部安全区）；
- 桌面端：居中模态框（`translate(-50%, -50%)`、`pop` 缩放动画）；
- 滚动容器（面板 body）必须有 `min-height: 0` + `overscroll-behavior: contain`，
  否则移动端会出现「面板滚不动、背景在滚」的穿透问题；
- 打开期间锁页面滚动用 body `position: fixed` 方案（iOS Safari 对
  `overflow: hidden` 不生效），关闭时还原并恢复滚动位置——参考
  `TeamPicker.tsx` 的 useEffect。

### 其他约定

- 触控目标命中区 ≥ 40px（视觉尺寸可以小，用伪元素扩命中区，如 `.chip-x::after`）；
- 动画尊重 `prefers-reduced-motion`；键盘焦点用 `:focus-visible` 焦点环；
- 移动端不自动聚焦输入框（软键盘会遮挡底部抽屉）。

## 同名战队区分

见[根 README](../README.md#同名战队如何区分本项目的关键设计)与
[数据结构文档](../docs/data-schema.md)——战队全局 ID 为 `游戏前缀:原始ID`
（如 `vct:21` 与 `dfpl:blg` 是两支不同的 BLG），筛选/展示全链路不串数据。
