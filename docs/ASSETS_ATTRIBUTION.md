# DEEPDIVE · 外部资产来源与授权（ASSETS ATTRIBUTION）

> 原则（docs/WORKFLOW.md §3.4）：只使用 **CC0（公有领域）** 与 **CC-BY（署名）** 授权的公开资产；
> 每一项外部资产必须在本文件登记 **来源 / 作者 / 授权 / 本仓库所做改动**。
> 禁止使用来源不明或授权不清的资产。

## 1. 三维模型（`src/assets/models/`）

| 文件 | 内容 | 作者 / 版权 | 授权 | 来源 | 本仓库改动 |
|---|---|---|---|---|---|
| `src/assets/models/barramundi.glb` | 尖吻鲈（Barramundi Fish）PBR 模型——用作银汉鱼群 / 盲眼洞鱼 / 巡游大鱼的共用几何 | © 2017, Public（Microsoft 制作并捐赠，标注 "Microsoft for Everything"） | **CC0 1.0 Universal**（公有领域） | [Khronos glTF-Sample-Assets · BarramundiFish](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/BarramundiFish)（镜像清单见 `scripts/fetch-assets.cjs`） | 贴图缩尺至 256px 并转 WebP、几何保持原拓扑（12.49MB → 160KB）；运行时按用途调色（银青群体色 / 无色素苍白 / 深水压暗） |

**说明**：曾评估 poly.pizza（Quaternius / Google Poly 镜像）的海龟等 CC0/CC-BY 模型，
但该站为 JS 动态渲染、无稳定直链，不满足「镜像可复现下载」要求，故未采用；
其余生物（水母 / 奇虾 / 潜水员 NPC）为程序化建模，无外部来源。

## 2. 其余资产

- **纹理**：全部由 `src/game/textures.ts` 运行时 Canvas 程序化合成，无外部来源。
- **音频**：全部由 `src/game/AudioEngine.ts` 运行时 Web Audio 程序化合成，无外部来源。
- **字体**：使用系统字体栈，未内嵌任何字体文件。

## 3. 下载与压缩管线

外部模型经 `scripts/fetch-assets.cjs` 下载（含镜像清单与校验），再用
[glTF-Transform](https://gltf-transform.dev/)（MIT）做贴图缩尺与 meshopt 压缩后入库。
压缩不改变模型署名要求；改动内容（缩尺/量化/删节点）逐项记录在上表「本仓库改动」列。

## 4. 尊重声明

「洞潜安全模拟」模式参考公开洞潜安全教育文献中的**事故类型分类**（能见度丧失、
导览线方向错误、气体管理失败、失散潜伴、减压停失败），内容全部虚构，
不使用真实遇难者姓名，不影射任何一起具体真实事故。向洞潜安全教育社区致敬。
