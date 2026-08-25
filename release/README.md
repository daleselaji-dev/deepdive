# DEEPDIVE Windows 桌面包

解压 **`DeepDive-win32-x64.zip`** 后，双击 **`DeepDive.exe`** 即可游玩（无需安装 Node / 浏览器）。

## 系统要求

- Windows 10 / 11 x64
- 建议独立显卡或较新的核显（WebGL 2）
- 戴耳机体验更佳

## 说明

- 首次启动可能被 Windows SmartScreen 拦截（未签名原型包属正常），选择「更多信息」→「仍要运行」。
- 绿色便携包，不写注册表；删文件夹即卸载。
- 为控制体积已裁掉部分 Chromium 附加组件（Vulkan/SwiftShader、ffmpeg、多余语言包）；原型游玩不受影响。
- 若需重新打包：在仓库根目录执行 `npm install && npm run package:win`。
