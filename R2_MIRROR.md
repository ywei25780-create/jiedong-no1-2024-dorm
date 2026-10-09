# Cloudflare R2 模型镜像

网站仍托管在 GitHub Pages。R2 只存放当前已经公开的两份运行模型，文件内容保持不变；不上传原始扫描、照片、个人回忆、备份或 API 凭据。

## 账号与公共下载地址

使用自己的 Cloudflare 账号，由账号所有者完成 R2 开通及可能出现的付款方式或订阅确认。R2 有免费额度，超额的存储和请求会计费，不能将其理解为无限免费服务。

创建专用 bucket，上传：

| 本地运行文件 | 建议对象键 | 大小 | SHA-256 |
| --- | --- | --- | --- |
| `public/models/classroom.glb` | `classroom.glb` | 18,003,044 字节 | `514d52df2db67e73497ec0e36eb68413557353d2d767151c225c11d20f86d16c` |
| `public/assets/repaired.glb` | `dorm.glb` | 9,397,120 字节 | `2ebfd3f314b9e95ab78cdf98bfbc2a58025af8bdf2f73073ba4ed37444852f57` |

Content-Type 使用 `model/gltf-binary`。公开访问可以先使用 R2 的 Public Development URL 试验；`r2.dev` 有限速，正式长期使用建议绑定自己控制的自定义域名。实际大陆直连速度仍需测试，R2 不等于中国大陆 CDN。

## CORS

在 bucket Settings → CORS Policy 中粘贴 [infra/r2-cors.json](infra/r2-cors.json)。这是 Dashboard JSON 格式，允许 GitHub Pages 及当前本地预览匿名读取，不允许上传、删除或带凭据请求。

使用实际公开下载域名，不使用 S3 管理端点、不使用会过期的签名 URL。用浏览器从 Pages 发起下载，检查响应包含 `Access-Control-Allow-Origin: https://ywei25780-create.github.io`。命令行测试时也必须带上该 Origin，否则看不到 CORS 响应头。

## 接入现有加载器

获得可用公共 URL 并校验两份对象后，分别编辑：

- `public/data/classroom-model.json` 的 `sources.backup`：填写教室对象完整 URL。
- `public/model-sources.json` 的 `sources.backup`：填写宿舍对象完整 URL。

R2 放在备用源列表；真正的国内镜像可放在 `sources.domestic`。顺序为本地缓存 → 国内镜像 → R2/其他备用镜像 → GitHub Pages。

相同字节的镜像不修改 `version`、`sha256` 或 `expectedBytes`，已有模型缓存继续命中。执行 `npm test`、`npm run check`、`npm run build` 并发布后生效。没有真实 URL 时保持数组为空，不能把占位域名加入下载列表。

## 验证

首次进入应显示 R2/备用源下载的实际字节进度，文件大小及 SHA-256 与上述值相符；第二次进入读取浏览器缓存。R2 网络、CORS、HTTP 或完整性校验失败时应切换到 GitHub Pages。不能只用命令行成功代替浏览器 CORS 验证。

官方文档：[开通 R2](https://developers.cloudflare.com/r2/get-started/)、[公开 bucket](https://developers.cloudflare.com/r2/buckets/public-buckets/)、[CORS](https://developers.cloudflare.com/r2/buckets/cors/)、[免费额度与计费](https://developers.cloudflare.com/r2/pricing/)。
