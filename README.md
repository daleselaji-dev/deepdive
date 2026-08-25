# DEEPDIVE · 深潜

> 洞穴潜水 · 侦探悬疑 · 心理恐怖 —— Web 可玩原型（第一章「寂静天坑事件」）
>
> *三个月前，萝拉·卡尔潜入「寂静之井」。昨天，她的手电还亮着。*

一名前警队搜救潜水员受托潜入尤卡坦半岛的虚构天坑「寂静之井」，调查传奇洞潜员失踪案。沿导览线下潜 45 米：写字板上的字迹越来越潦草，无线电里的声音越来越不对劲，而导览线的箭头——全部指向洞的深处。

## 快速预览

| 方式 | 说明 |
|---|---|
| **Windows EXE（推荐）** | 下载 [`release/DeepDive-win32-x64.zip`](release/DeepDive-win32-x64.zip)，**完整解压**后双击 **`DeepDive.exe`** |
| **网页单文件** | 双击 [`demo/DEEPDIVE.html`](demo/DEEPDIVE.html)（Chrome / Edge，无需服务器） |
| **开发模式** | 见下方命令 |

> - 若 SmartScreen 拦截：更多信息 → 仍要运行（未签名原型包）。  
> - 请不要只拷贝 `DeepDive.exe` 单独运行，必须保留同目录的 `ffmpeg.dll`、`resources/` 等文件。  
> - 旧版 zip 曾误删 `ffmpeg.dll` 导致无法启动，请使用本分支最新包。

## 运行

```bash
npm install
npm run dev           # 本地开发（局域网可访问，手机可直接连入体验）
npm run build         # 产物构建（含 TypeScript 严格检查）→ 单文件 HTML
npm run preview       # 预览构建产物
npm run demo:sync     # 构建并同步到 demo/DEEPDIVE.html
npm run desktop:dev   # Electron 窗口 + Vite 热更新
npm run package:win   # 重新打包 Windows EXE zip → release/
```

打开终端输出的地址即可游玩。**建议戴耳机、关灯。**

## 操作

| 平台 | 移动 | 视角 | 加速踢蹼（耗氧 ×2.2） |
|---|---|---|---|
| 桌面 | `W A S D` / 方向键 | 鼠标（点击画面锁定指针） | `Shift` |
| 手机 | 左下虚拟摇杆 | 右侧屏幕拖拽 | 摇杆推到外圈 |

- 靠近**写字板**自动拾取阅读（点击/按任意键收起，阅读时不耗氧）。
- 靠近**备用气瓶**自动补氧——注意标签上写了谁的名字。
- 两条结局路径：保住氧气抵达井底红幕 → 「红厅」；中途耗尽氧气 → 「浅睡」。两个都是结局。
- 质量档自动检测，可用 URL 参数覆盖：`?q=ultra` / `?q=high` / `?q=mobile`。

## 技术

Vite + TypeScript(strict) + Three.js。**零外部资产**：洞穴几何程序化生成（样条隧道+噪声位移）、纹理 Canvas 合成、全部音频 Web Audio 实时合成（环境低鸣/呼吸气泡/心跳/无线电静噪/惊吓 sting/红厅嗡鸣）。

```
src/
  main.ts            入口
  styles.css         标题首屏 / HUD / 写字板 / 结局画面
  game/
    Game.ts          状态机与主循环（title/play/hypoxia/redroom/ended）
    Cave.ts          「寂静之井」：样条隧道、导览线、光柱、红幕
    Player.ts        第一人称游动、隧道软约束、手电惯性
    Story.ts         叙事触发（写字板/无线电/环境事件/气瓶）
    Scare.ts         唯一一次编排式惊吓（频闪目击）
    RedRoom.ts       结局 A「红厅」（红帷幕/锯齿地纹/竹节虫）
    AudioEngine.ts   全程序化音频
    Hud.ts           潜水电脑表美学 HUD 与字幕/结局层
    Input.ts         键鼠 + 触控双摇杆
    quality.ts       质量分档（Ultra/High/Mobile）
    textures.ts      Canvas 程序化纹理
```

## 设计文档

| 文档 | 内容 |
|---|---|
| [docs/WORKFLOW.md](docs/WORKFLOW.md) | 研发工作流、迭代 loop、里程碑 |
| [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) | 故事设定、叙事大纲、节奏与 jump scare 原则、双结局、两种模式定义 |
| [docs/ART_DIRECTION.md](docs/ART_DIRECTION.md) | 视觉支柱、调色板、光照、UI、资产层级、移动端降级策略 |
| [docs/VIRAL_SOCIAL.md](docs/VIRAL_SOCIAL.md) | 首屏冲击设计、风格化钩子、社交转发机制、圈层传播与伦理红线 |

## 内容分级说明

本作包含心理恐怖元素与一次惊吓演出。故事纯属虚构，对真实洞潜文化（导览线、写字板、气体三分法则）做尊重性呈现，不影射任何真实事故与遇难者。
