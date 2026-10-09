# Cloudflare R2 受保护模型镜像

网站仍托管在 GitHub Pages。备用模型入口使用 **Workers Free + 私有 R2 bucket + SQLite Durable Object 配额**。R2 只存放当前已公开的两份运行模型，模型字节、版本号和 SHA-256 不变；不上传原始扫描、照片、个人回忆、备份或凭据。

## 私有存储与唯一入口

专用 bucket 名为 `jiedong-no1-2024-dorm-models`，使用 R2 Standard，始终保持私有。**禁止启用 `r2.dev` 或 R2 bucket 的公开自定义域名**，否则能绕过 Worker 的下载配额。浏览器只访问部署完成后得到的真实 Worker URL；Worker 通过 `MODELS` binding 读取对象，bucket 无需配置浏览器 CORS。

| 本地运行文件 | 对象键 / Worker 路径 | 大小 | SHA-256 |
| --- | --- | --- | --- |
| `public/models/classroom.glb` | `classroom.glb` / `/classroom.glb` | 18,003,044 字节 | `514d52df2db67e73497ec0e36eb68413557353d2d767151c225c11d20f86d16c` |
| `public/assets/repaired.glb` | `dorm.glb` / `/dorm.glb` | 9,397,120 字节 | `2ebfd3f314b9e95ab78cdf98bfbc2a58025af8bdf2f73073ba4ed37444852f57` |

仅存这两个对象，共 27,400,164 字节（约 27.4 MB），Worker 响应的 Content-Type 为 `model/gltf-binary`。Worker 只提供这两个路径的 GET 和 CORS OPTIONS，没有列表、上传、删除或管理接口；拒绝任意其他路径、查询参数、Cookie 和 Range 请求。

当前下载入口为 `https://jiedong-models-protected-mirror.ipad-pro-wasd.workers.dev`，分别使用上述两个路径。直接在地址栏打开不会携带 Origin，因此会被拒绝；模型由网页的 `fetch()` 下载。

## 每月配额与回退

两个模型共用一个 `DOWNLOAD_BUDGET` Durable Object，在每次真实 GET 读取 R2 **之前**，原子预留该模型完整大小及一次请求：

- 每个 UTC 自然月最多 `10,000,000,000` 字节（十进制 10 GB）。
- 同月最多 `1,000` 次镜像读取请求；任一限额达到后拒绝。
- 下载取消、传输中断或 R2 读取失败均不退还预留配额，避免并发和断线造成低计数。
- 超限返回 429；存储故障、配置错误或对象大小不符返回 503。现有加载器自动尝试下一源，最终回退 GitHub Pages。

月份以服务端 UTC 时间为准，新月替换同一条 `month / bytes / requests` 记录，不累积月度记录，也不记录用户 IP 或个人信息。没有公开查询、重置或修改配额的入口。限额在 [Wrangler 配置](infra/r2-mirror/wrangler.jsonc) 中设定，只可调低，不能超过上述上限。

Worker 的成功、错误和超限响应均使用 `Cache-Control: no-store`、`X-Content-Type-Options: nosniff` 和 `Vary: Origin`。网页仍把校验成功的完整 GLB 写入自己的 Cache Storage；**浏览器模型缓存命中不会请求 Worker，不消耗镜像配额**。

## CORS 与部署权限

Worker 只允许以下 Origin，不带凭据。CORS 用于限制浏览器跨站读取，不是身份认证；其他客户端仍可能伪造 Origin，但无法突破统一的月度额度：

```text
https://ywei25780-create.github.io
http://localhost:4174
http://127.0.0.1:4174
```

OPTIONS 只检查允许的 Origin、GET 方法和请求头，不访问 R2，也不预留配额。真实响应及允许 Origin 下的错误响应返回对应 `Access-Control-Allow-Origin`。不能只用命令行成功代替浏览器 CORS 验证。

部署使用 [infra/r2-mirror/wrangler.jsonc](infra/r2-mirror/wrangler.jsonc)，绑定私有 bucket 和 SQLite-backed `DownloadBudget`，保持 Workers Free，不启用付费 Workers。临时部署授权在验证后撤销；凭据不写入源代码、静态配置、构建产物或提交记录，`.wrangler/` 已加入忽略列表。

本项目的两份对象和受限请求量低于 R2 Standard 免费额度。Workers / Durable Objects 的 Free 平台额度用尽时请求失败，网页同样尝试 Pages；该网关不控制账户内其他项目的用量或收费。不要把账户套餐升级到 Paid 后仍理解为同样的免费保障。

## 接入现有加载器

部署成功并验证真实入口后，分别填写：

- `public/data/classroom-model.json` 的 `sources.backup`：真实 Worker URL 加 `/classroom.glb`。
- `public/model-sources.json` 的 `sources.backup`：真实 Worker URL 加 `/dorm.glb`。

没有真实 URL 时保持备用数组为空，不填占位地址。加载顺序仍为本地缓存 → `sources.domestic` → `sources.backup` → GitHub Pages。`sources.domestic` 当前为 `[]`；R2 放在备用源，不能视为中国大陆 CDN，尚无大陆速度保证，需用大陆直连设备实测。

相同字节的镜像不修改 `version`、`sha256` 或 `expectedBytes`，已有模型缓存继续命中。执行 `npm test`、`npm run check`、`npm run build` 并发布网站后配置生效。GitHub Pages 工作流只部署静态网站，Worker 单独部署。

## 验证

`tests/r2-mirror.test.ts` 覆盖精确字节 / 请求上限、跨月恢复、100 次并发预留、持久化失败闭锁、非法请求、CORS、R2 大小不符、取消不退配额及两份实际 GLB 响应的字节和 SHA-256。

部署后还需从 Pages 页面验证首次下载的真实进度与完整性、再次进入的浏览器缓存命中，以及 Worker 故障或 429 后的 Pages 回退；确认私有 bucket 没有 `r2.dev` 或公开 bucket 域名。

官方文档：[R2 Workers binding](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)、[SQLite Durable Object 存储](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)、[R2 免费额度与计费](https://developers.cloudflare.com/r2/pricing/)。
