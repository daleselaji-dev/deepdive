# DEEPDIVE · 外部资产来源与授权（ASSETS ATTRIBUTION）

> 原则（docs/WORKFLOW.md §3.4）：只使用 **CC0（公有领域）** 与 **CC-BY（署名）** 授权的公开资产；
> 每一项外部资产必须在本文件登记 **来源 / 作者 / 授权 / 本仓库所做改动**。
> 禁止使用来源不明或授权不清的资产。

## 1. 三维模型（`src/assets/models/`）

| 文件 | 内容 | 作者 / 版权 | 授权 | 来源 | 本仓库改动 |
|---|---|---|---|---|---|
| `src/assets/models/barramundi.glb` | 尖吻鲈（Barramundi Fish）PBR 模型——用作银汉鱼群 / 盲眼洞鱼 / 巡游大鱼的共用几何 | © 2017, Public（Microsoft 制作并捐赠，标注 "Microsoft for Everything"） | **CC0 1.0 Universal**（公有领域） | [Khronos glTF-Sample-Assets · BarramundiFish](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/BarramundiFish)（镜像清单见 `scripts/fetch-assets.cjs`） | 贴图 256px + WebP、meshopt 压缩（12.49MB → 61.5KB）；运行时按用途调色（银青群体色 / 无色素苍白 / 深水压暗） |
| `src/assets/models/lantern.glb` | 黄铜提灯 PBR 模型——沉船船头「还亮着的提灯」 | © 2017, Microsoft（sbtron 制作并捐赠） | **CC0 1.0 Universal** | [Khronos glTF-Sample-Assets · Lantern](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Lantern) | 贴图 128px + WebP、轻度简化 + meshopt（9.2MB → 29.1KB）；运行时铜绿锈色偏 + 幽绿自发光 |
| `src/assets/models/camera.glb` | 古董木三脚架相机 PBR 模型——沉船年代的「底片匣之谜」可观察遗物 | © 2018, UX3D（Maximillan Kamps 制作） | **CC0 1.0 Universal** | [Khronos glTF-Sample-Assets · AntiqueCamera](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/AntiqueCamera) | 贴图 96px + WebP、简化 + meshopt（17.54MB → 107KB）；运行时钙化色偏 |
| `src/assets/models/chest.glb` | 木质物资箱（Pirate Kit）——沉船「从里面打开的箱子」可观察遗物 | © Kenney（kenney.nl，"Pirate Kit"） | **CC0 1.0 Universal** | [pmndrs/market-assets 镜像 · chest](https://github.com/pmndrs/market-assets/tree/main/files/models/chest)（原始出处 kenney.nl） | 转 GLB、贴图 128px、meshopt（→6.8KB）；运行时沉水暗绿色偏 |
| `src/assets/models/barrel.glb` | 木桶（Pirate Kit）——沉船货物碎场装饰 ×3 | © Kenney（kenney.nl，"Pirate Kit"） | **CC0 1.0 Universal** | [pmndrs/market-assets 镜像 · barrel](https://github.com/pmndrs/market-assets/tree/main/files/models/barrel) | 转 GLB、meshopt（→6.9KB）；运行时暗化并倾倒摆放 |
| `src/assets/models/fishbones.glb` | 鱼骨骸（Pirate Kit）——洞底自然沉积装饰 | © Kenney（kenney.nl，"Pirate Kit"） | **CC0 1.0 Universal** | [pmndrs/market-assets 镜像 · fish-bones](https://github.com/pmndrs/market-assets/tree/main/files/models/fish-bones) | 转 GLB、meshopt（→6.1KB）；运行时骨白色调 |

**说明**：曾评估 poly.pizza（Quaternius / Google Poly 镜像）的海龟等 CC0/CC-BY 模型，
但该站为 JS 动态渲染、无稳定直链，不满足「镜像可复现下载」要求，故未采用；
Quaternius 鱼类包（cute_fish_pack 等）为卡通低模风格，与本作写实暗色美术方向冲突，亦未采用。
其余生物（水母 / 桨足类 / 奇虾 / 蝙蝠 / 潜水员 NPC）为程序化建模，无外部来源。
pmndrs/market-assets 为社区资产镜像库，本仓库仅取其中 `creator: kenney` 的条目（Kenney 全部作品以 CC0 发布于 kenney.nl）。

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
