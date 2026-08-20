# 安全审查报告 · Esports Timeline

- **审查对象**：`esport` 仓库全部自研代码与数据产物
- **审查范围**：
  - 爬虫：`vct_crawler.py`、`dfpl_crawler.py`
  - 构建链：`web/scripts/`（build-data / build / build-lib / dev）、`web/rollup.config.mjs`
  - 前端：`web/src/` 全部 TS/TSX、`index.html`、`package.json`
  - 数据产物：`output/`、`dfpl_output/`、`web/src/data/esports.json`、`web/dist/`
- **审查方法**：静态代码通读 + 关键模式检索（密钥 / 危险 API / 路径穿越）+ `npm audit` 依赖审计 + 对开发服务器路径穿越防护的**动态实弹测试（30+ 种变体）**

## 总体结论

**通过，可以安全推送到 private 仓库。** 仓库内容（代码 + 数据 + git 历史）中不含任何凭据、密钥、个人敏感信息，生产依赖 0 已知漏洞。审查发现 1 个高危运行时缺陷（H-1，仅影响本机 `npm run dev` 的开发者，与仓库内容泄露无关）——**已在推送前修复并通过 PoC 回归验证**。

## 发现汇总

| 编号 | 级别 | 位置 | 问题 | 状态 |
| --- | --- | --- | --- | --- |
| H-1 | 高 | `web/scripts/dev.mjs` | dev 服务器路径遍历（实弹验证可绕过） | ✅ **已修复并验证** |
| L-1 | 低 | `web/rollup.config.mjs` | JSON 插件未校验即内联为 JS（供应链面） | ✅ **已修复** |
| I-1 | 信息 | `web/scripts/dev.mjs` | 缺 `X-Content-Type-Options: nosniff` | ✅ 已加 |
| I-2 | 信息 | 托管层 | 静态站点无 CSP | 可选（公开部署时） |
| I-3 | 信息 | `TeamLogo.tsx` | 外链 logo 暴露访客 IP 至第三方 CDN | 已知取舍 |
| I-4 | 信息 | 爬虫 | CSV 公式注入（理论性，需上游接口被控） | 建议加固 |
| I-5 | 信息 | 爬虫 | `requests` 未锁版本，README 依赖描述与代码不符 | 建议修正 |

## H-1（高）dev 服务器路径遍历 —— 已修复

**原缺陷**（三层组合失效）：

1. `%2f` 解码后产生前导 `//`，躲过针对 `..` 开头的前缀剥离正则（Windows 上
   `normalize("/../../x")` 返回 `\\..\\..\\x`，开头是 `\\` 不匹配正则）；
2. `join(dist, "\\..\\..\\x")` 把 `\\..` 当作从盘符根回溯，结果逃出 `dist`；
3. `file.startsWith(dist)` 无分隔符边界，`dist-demo` 等兄弟目录可通过检查。

**实弹 PoC**（修复前返回 200 读出 dist 外文件）：

```
GET /%2f%2e%2e%2fdist-demo%2fproof.txt   →  200, 返回 web\dist-demo\proof.txt
```

影响：同一盘符上任意深度文件读取（node 进程权限内）。其余 30+ 变体
（`../`、`%2e%2e`、`%5C`、盘符绝对路径、`\\?\`、UNC、`..;`、`....//` 等）
原本已被 WHATWG URL 解析器拦截，仅 `%2f` 前导双斜杠一族存活。

**修复**（`path.relative` 包含判断，不依赖字符串前缀技巧）：

```js
const safe = normalize(pathname).replace(/^[\\/]+/, '');   // 剥净前导斜杠
const file = join(dist, safe);
const rel = relative(dist, file);
if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.includes('\0')) → 403
```

**修复后回归验证**：

| 载荷 | 结果 |
| --- | --- |
| `/%2f%2e%2e%2fdist-demo%2fproof.txt` | 403 已拦截 |
| `/%2F%2E%2E%2F%2E%2E%2Fvct_crawler.py` | 403 已拦截 |
| `/%2f..%2f..%2f..%2fWindows%2fwin.ini` | 403 已拦截 |
| `/../../vct_crawler.py`、`/..%2f..%2fpackage.json` 等 | 404 未泄露 |
| `/`、`/app.js`、`/app.css`、`/data/esports.json` | 200 正常 |

## L-1（低）rollup JSON 插件未校验即内联 —— 已修复

原实现把 `.json` 文件内容直接拼接为 `const data = ${code}`——若依赖包中被
投毒一个"伪 JSON 实为 JS"的文件，构建时会被执行。已改为先 `JSON.parse`
校验、再 `JSON.stringify` 重新序列化内联，非法 JSON 直接构建报错。

## 其余信息级发现

- **I-2 CSP**：纯静态 + 构建期内联数据、React 默认转义，当前无注入通道；
  公开托管时建议在托管层加 CSP。
- **I-3 logo 热链**：战队 logo 直接引用腾讯 CDN，访客 IP/Referer 会暴露给
  第三方；如在意可本地化（注意版权）。
- **I-4 CSV 公式注入**：爬虫将上游字符串原样写 CSV，若字段以 `= + - @`
  开头，Excel 打开可能被解释为公式。攻击前提是官方接口被控，可能性极低。
  建议写出前对公式字符开头单元格加 `'` 前缀。
- **I-5 依赖描述**：爬虫用了 `requests` 但无 `requirements.txt`，建议补
  `requests>=2.32,<3` 并修正 README。

## 已验证的安全优势

1. **无密钥泄露**：全库（含 git 历史全量 diff）检索 password/secret/token/
   api_key/authorization/cookie 零命中；
2. **XSS 面近乎为零**：无 `dangerouslySetInnerHTML`/`innerHTML`/`eval`/
   `new Function`，全部渲染走 React 默认转义；`img src` 无 `javascript:` 注入面；
3. **无 SSRF 面**：爬虫仅请求硬编码 HTTPS 端点，CLI 参数无法注入 URL，
   TLS 校验默认开启（无 `verify=False`）；
4. **依赖干净**：`npm audit`（含 dev）0 漏洞；运行时依赖仅 react/react-dom；
   安装使用 `--ignore-scripts` 规避 postinstall 供应链攻击；构建链全程
   进程内（Rollup API + 手写 `node:http`），无子进程；
5. **数据无敏感 PII**：`players.csv` 扫描手机号/身份证/邮箱零命中，
   `real_name` 为官网公开名单；前端发布产物已剔除全部选手个人数据；
6. **仓库卫生**：`.gitignore` 正确排除 `node_modules/`、`dist/`、`.npm-cache/`，
   `git ls-files` 确认三者未被跟踪。

## 建议行动清单（剩余项）

1. [ ] 爬虫 CSV 导出加公式字符消毒（I-4，约 5 行）
2. [ ] 补 `requirements.txt` 并统一 README 依赖描述（I-5）
3. [ ] （可选）公开部署时配置 CSP（I-2）、评估 logo 本地化（I-3）

---
*本报告基于审查时点的代码快照生成；H-1 / L-1 / I-1 的修复已包含在当前提交中。后续代码变更请同步更新。*
