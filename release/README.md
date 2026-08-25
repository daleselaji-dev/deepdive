# DEEPDIVE Windows 桌面包

## 正确打开方式

1. **完整解压** `DeepDive-win32-x64.zip`（不要只抽出 exe）
2. 进入解压出的 `DeepDive-win32-x64` 文件夹
3. 双击 **`DeepDive.exe`**
4. 若 SmartScreen 提示：更多信息 → 仍要运行

同目录必须保留：`ffmpeg.dll`、`resources/`、`*.pak`、`icudtl.dat` 等。单独复制 exe 无法运行。

## 备用：网页版

仓库 `demo/DEEPDIVE.html` 可直接用 Chrome / Edge 双击打开（单文件，无需服务器）。

## 系统要求

- Windows 10 / 11 x64
- 支持 WebGL 的显卡/核显
- 建议戴耳机

## 重新打包

```bash
npm install && npm run package:win
```
