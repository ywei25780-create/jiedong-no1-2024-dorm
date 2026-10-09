# 模型下载源与浏览器缓存

模型几何、纹理和交互不变。HTML、JS、CSS 仍由 GitHub Pages 提供。

## 配置位置

宿舍配置位于 `public/model-sources.json`，教室配置位于 `public/data/classroom-model.json`。编辑后执行 `npm run build`，将源文件及生成的 `docs/` 一起提交、推送。

配置项的排列决定尝试顺序：本地缓存 → `sources.domestic` 国内镜像列表 → `sources.backup` 备用镜像列表 → GitHub Pages。`domestic` 当前为 `[]`；`backup` 已接入 `https://jiedong-models-protected-mirror.ipad-pro-wasd.workers.dev` 的 `/dorm.glb` 与 `/classroom.glb`。

镜像上的文件可以叫 `dorm.glb`，但内容必须与当前 `public/assets/repaired.glb` **逐字节相同**。GitHub Pages 上现有文件名和最终回退地址保持不变。相同地址会去重，空地址会跳过，本站回退源固定放在最后。不支持 URL 内嵌用户名和密码。

## 超时、进度与校验

- 等待首个非空数据块最多 60 秒，覆盖连接、响应头及首包阶段。
- 开始接收后，连续 90 秒没有收到新数据便切换。
- 每个源的整个传输阶段最多 600 秒（10 分钟）。每个源仅尝试一次，没有无限重试。教室和宿舍使用同样的时限。
- 页面离开或场景销毁时取消下载，不继续请求下一源。
- HTTP 非 200、跨域或网络错误、传输中断、大小不符、GLB 文件头不符、SHA-256 不符，均进入下一源。全部失败后显示各源的失败类别，并提供重新加载。
- 进度直接累计 `fetch()` 响应流的字节数，显示已下载 MB / 总 MB。MB 使用十进制：1 MB = 1,000,000 字节。
- 总大小使用发布配置中经过校验的 `expectedBytes`，不依赖镜像是否公开 Content-Length，也不会把 HTTP 压缩后的长度混作解压后的长度。切换源后进度归零，不把失败源的已收字节算入新文件。
- 宿舍应为 `9397120` 字节，SHA-256 为 `2ebfd3f314b9e95ab78cdf98bfbc2a58025af8bdf2f73073ba4ed37444852f57`；教室应为 `18003044` 字节，SHA-256 为 `514d52df2db67e73497ec0e36eb68413557353d2d767151c225c11d20f86d16c`。
- 完整下载且校验通过后生成 Blob / Object URL，由现有 GLTFLoader 加载；加载完成或解析失败后释放 Object URL。
- 下载成功后的 GLB 解析/内嵌图片解码错误会单独提示。由于各源应提供同样的校验通过文件，不为解析错误重复下载相同字节。

## 本地缓存与版本更新

使用 Cache Storage，不安装 Service Worker。缓存名为 `jiedong-no1-2024-dorm-models-v1`。缓存键包含模型 ID、版本号和 SHA-256，存储的是完整 GLB，不包含回忆内容。

后续访问先校验本地缓存；缓存有效时不会发起任何模型下载请求。小型 `model-sources.json` 仍会检查更新，最长等待 3 秒；网络不可用时使用构建中随网站发布的配置。HTML、JS、CSS 和导航数据仍按原网页加载，因此这不是完整离线网站。

教室的 `data/classroom-scene.json` 和 `data/classroom-model.json` 并行检查，最长等待 5 秒；网络失败时使用随构建发布的默认配置。当前模型的导航数据也内置于场景模块，匹配默认模型 SHA-256 与导航路径时无需单独下载导航，不会在模型下载之前因导航文件的短超时进入占位场景。若配置指向新的模型或自定义导航，则读取对应导航（最多 60 秒），避免使用不匹配的碰撞数据。返回首页后重新进入会清除上一次的占位和失败状态。

更新模型时同步修改 `version`、`sha256`、`expectedBytes` 并重新构建发布。任何版本号或 hash 变化都会自动绕过旧缓存。旧版本条目不再命中；为了防止仍打开旧网页的标签误删新缓存，不跨版本删除条目。浏览器可按存储策略回收旧条目。

缓存损坏时删除当前损坏条目并重新下载。缓存被禁用、隐私模式限制、容量不足或存储超时时，仍可以直接加载下载成功的模型，只是下次可能需要重新下载。缓存操作等待上限为 3 秒。不会申请额外权限，不会清理浏览器中的其他站点数据或宿舍回忆。

## 镜像 CORS 要求

使用 HTTPS，允许来自以下 Origin 的匿名 GET 请求：

```text
https://ywei25780-create.github.io
```

受保护 R2 Worker 的响应头（宿舍示例）：

```http
Access-Control-Allow-Origin: https://ywei25780-create.github.io
Content-Type: model/gltf-binary
Content-Length: 9397120
Access-Control-Expose-Headers: Content-Length
Cache-Control: no-store
X-Content-Type-Options: nosniff
Vary: Origin
```

本加载器使用 `credentials: omit`，不传 Cookie，不附加自定义请求头；不要用 `no-cors`，否则得到的 opaque 响应无法读取和校验。受保护 R2 Worker 仅允许 Pages Origin 及 `http://localhost:4174`、`http://127.0.0.1:4174`；CORS 在 Worker 中实现，私有 bucket 不需要浏览器 CORS。

如服务根据 Origin 动态返回允许域名，还应设置 `Vary: Origin`。使用 CDN 时，CDN 的实际响应（包括重定向后的最终响应）也必须满足 CORS，不能只在对象存储源站设置。公开下载地址不能返回登录页、防盗链提示页或过期签名错误页。

当前没有配置真实国内镜像。Cloudflare R2 作为备用源，尚无大陆速度保证；需用大陆直连手机实测，不能仅凭配置标签判断可达性。

R2 bucket `jiedong-no1-2024-dorm-models` 始终私有，禁止启用 `r2.dev` 或公开 bucket 域名。Workers Free 入口在每次 GET 前，统一原子预扣整个对象字节及一次读取；每个 UTC 自然月最多 `10,000,000,000` 字节 / `1,000` 次，取消或失败不退配额。超限 429、故障 503 或其他下载失败会进入现有 Pages 回退。浏览器模型缓存命中不请求 Worker、不计入配额。完整架构、权限与验证步骤见 [R2 镜像说明](R2_MIRROR.md)。

## 验证

`npm run test:loader` 覆盖优先级、HTTP/网络失败、首包/中途/总超时、真实字节进度、错误内容校验、缓存命中、版本/hash 失效、损坏缓存恢复、存储不可用和取消加载。浏览器还需检查跨域拒绝、跨域允许及实际 Cache Storage 命中。

配置与缓存遵循 [MDN CacheStorage](https://developer.mozilla.org/en-US/docs/Web/API/CacheStorage) 和 [CORS 响应头说明](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Access-Control-Expose-Headers)。
