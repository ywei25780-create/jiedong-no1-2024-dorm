# 高二教室时光机 · 与宿舍联合

教室入口为 `?space=classroom`，宿舍入口为网站根路径，两处均有互通按钮。无需后端、账户、付费服务或外部 JavaScript CDN。采用现有 Vite + React + TypeScript + Three.js，继续使用多源下载和浏览器模型缓存。教室模块和 GLB 按需载入。

## 启动

Node.js 24 推荐，最低版本 22.13。

```sh
npm ci
npm run dev
```

在终端显示的 `/jiedong-no1-2024-dorm/?space=classroom` 路径打开教室。生产版用 `npm run build`、`npm run preview`。

## 本次扫描实际内容

ZIP 校验通过：10,974 个文件，含 2 个 OBJ、1 个 MTL、1 个 USDZ、1 张贴图、扫描照片、深度/置信度图、相机 JSON 与 ARKit world map。没有 GLB。扫描文件夹日期为 2023-06-25；这是导出记录，并未自动写成个人回忆的日期。

本次从 `textured_output.obj` + MTL 指定的 JPEG 转换。原始 240,340 个顶点中有未被面引用的顶点，运行文件按实际 position/UV 组合建立 229,148 个顶点；完整保留 371,311 个三角面的形状和位置，没有减面或重建课桌。OBJ 的 V 轴转换为 glTF 纹理约定，法线依据几何计算；使用原扫描颜色的 unlit 材质。米制 Y 向上，范围约 9.17 × 10.39 × 3.71 m。

原贴图为 11,264 × 11,264。完整贴图转换副本保存在本地工作目录，不在发布目录内。线上运行副本使用 4,096 × 4,096 JPEG，几何不变，文件 18,003,044 字节。SHA256：`514d52df2db67e73497ec0e36eb68413557353d2d767151c225c11d20f86d16c`。

地板中性背衬和简化碰撞栅格为辅助结构，不是扫描修复。扫描的墙面/天花缺口、书本和椅子变形仍保留。碰撞以桌椅高度的连续扫描区域建立障碍，忽略小型离散碰撞噪点；它不更改显示模型。初始站立点位于内部可走过道，人眼高 1.65 m，速度 1.3 m/s，Shift 1.75 倍。

## 操作

- 电脑：WASD 行走，Shift 加速，按住鼠标拖动环顾；「鼠标环顾」开启锁定，Esc 释放。方向键可调整视线。
- 手机：左下摇杆移动，右侧拖动环顾。自由观察可用双指操作。
- 自由观察 / 俯视：OrbitControls 绕场景观察；俯视裁去高处扫描面。继续漫游恢复此前位置与朝向。
- 热点：进入编辑模式，点击真实扫描表面创建。拖动用于环顾，不创建热点。「重新点选位置」移动现有热点，不新增副本。支持修改与删除。
- 相册：支持多照片、视频、录音，照片缩放、左右切换、方向键与横向滑动、全屏；按年份筛选、日期排序。媒体声音默认关闭，开启后才有声音；不会加入未提供的背景音。
- 场景参数：可改出生位置、行走高度、速度、碰撞半径，保存到当前浏览器或导出配置。出生点必须位于可走区域。

## 添加记忆并正式发布

1. 开启编辑模式，点击模型表面，填写标题、时间（`YYYY` / `YYYY-MM` / `YYYY-MM-DD`）、描述、标签。
2. 将授权照片、视频和录音放入 `public/memories/`。编辑器里填写 `memories/…` 相对路径，不加 `public/`。添加多个媒体，每个媒体可填自己的时间与说明。
3. 修改自动存为当前浏览器 localStorage 草稿。点击相册列表的「导出 JSON」备份。刷新会恢复草稿，清理浏览器数据会清掉草稿，因此应导出。
4. 要公开，先审阅文件，再把导出的 JSON 替换为 `public/data/hotspots.json`。重新构建、提交、推送。这一步不会由静态页面自动完成。
5. 「导入 JSON」校验完整结构后替换草稿；格式错误、重复 ID、危险路径或无效坐标会拒绝导入，保留旧数据。

浏览器选择的本地文件只支持临时预览：不上传、不写入 JSON、不在刷新后保留。文字/坐标草稿的持久化不依赖临时文件。正式媒体通过资源路径绑定。未填写的回忆显示「待补充回忆」，公开初始热点为空，不编造当年座位或故事。

热点 JSON 顶层为 `schemaVersion: 1`、`spaceId: classroom`、`coordinateSpace: model-local`、`hotspots: []`。热点包含 id/title/description/date/position/tags/media。媒体包含 id/type/src/caption/date，type 为 image/video/audio。position 是模型局部坐标，旋转/平移/缩放后通过模型矩阵保持绑定；不直接把世界坐标当成热点坐标。

## 替换模型、配置镜像和变换

真实运行模型为 `public/models/classroom.glb`。下载源、版本、大小与 hash 在 `public/data/classroom-model.json`。镜像留空，国内 → 备用 → 本站按顺序；单源总时限 180 秒，首包 8 秒，停滞 12 秒。下载为 Blob 后交给 GLTFLoader。模型缓存按 modelId/version/hash 分开，更新模型时同时更改 sha256、expectedBytes 和 version。CORS 规则见 [MODEL_LOADING.md](MODEL_LOADING.md)。

变换与行走配置在 `public/data/classroom-scene.json`；导航在 `public/data/classroom-navigation.json`。transform 的 rotationDegrees 按度数填写。配置中的 floorY/spawn 为场景坐标；平移或缩放模型时需要同步校准地面与出生位置，绕 X/Z 改正坐标轴后需要重新生成导航。热点仍绑定模型局部坐标。

若有 OBJ，可使用转换脚本（Python + numpy + scipy + Pillow）：

```sh
python scripts/convert-classroom.py scan.obj texture.jpg classroom.glb --texture-size 4096
```

脚本会同时生成 `.navigation.json` 与 `.report.json`，原文件不修改。无 `--texture-size` 时保留完整 JPEG。转换新的扫描后需检查地图/出生点、复制导航与更新配置；不要把一个模型的导航套到另一间房。

## GitHub Pages

已有网站可继续从 main / docs 部署。已提供 `.github/workflows/pages.yml` 自动测试、构建和上传部署产物；要启用它，在仓库 Settings → Pages → Source 选择 GitHub Actions，再推送 main。该工作流只上传构建后的 docs，不上传扫描工作目录。采用 [GitHub 官方 Pages 工作流](https://github.com/actions/starter-workflows/blob/main/pages/static.yml) 的部署动作。

Vite base 默认 `/jiedong-no1-2024-dorm/`。换仓库名需同步修改 vite.config.ts 的 base。不要用 file:// 打开 HTML。当前运行模型小于 GitHub 单文件 100 MB 限制，未使用 Git LFS；原扫描 ZIP、OBJ、USDZ、ARKit、扫描帧和本地草稿不应提交。

## 检查与常见故障

```sh
npm test
npm run check
npm run build
```

- 显示占位：真实模型或导航未加载，页面显示具体原因并可重新尝试。占位不代表真实教室已载入，禁止在它上面编辑真实热点。
- 校验不通过：替换 GLB 后未更新大小/hash，或镜像返回了 HTML 登录页。
- 直连慢：填写已配置 CORS 的镜像；本站仍继承 GitHub Pages 的网络条件。首次下载约 18 MB，后续可复用模型缓存。
- 图片不显示：路径应为 `memories/…`，确认文件位于 public、大小写一致且已构建部署。公开视频/录音格式还需浏览器支持。
- 草稿不可保存：隐私模式或存储配额可能受限，页面会提示，请立即导出 JSON。
- 无法全屏/锁定：受浏览器平台限制时可拖动环顾，手机使用系统浏览器菜单。

媒体和扫描内容有各自的权利与隐私范围。扫描帧未自动做成公开相册；公开前应核对书本、纸张与墙上文字以及可识别的人物。本地测试不会把这些内容发送到外部服务。
