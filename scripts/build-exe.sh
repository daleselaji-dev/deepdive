#!/usr/bin/env bash
# 一键产出 Windows 便携 EXE 与单文件网页版：
#   npm run package:win
# 产物：
#   release/DeepDive-win64.zip     ← 解压后双击 DeepDive.exe（约 3–4 MB）
#   release/web/DEEPDIVE.html      ← Chrome/Edge 直接双击可玩的单文件网页版
# 依赖：node + go ≥1.22（Linux/macOS/WSL 均可交叉编译，无需 Windows 机器）
set -euo pipefail
cd "$(dirname "$0")/.."

echo "→ 构建单文件网页（vite-plugin-singlefile）…"
npm run build:single

mkdir -p release/web release/DeepDive-win64
cp dist/index.html release/web/DEEPDIVE.html

echo "→ 交叉编译 Windows x64 EXE（Go 便携宿主）…"
cp dist/index.html exe-host/game.html
(
  cd exe-host
  GOOS=windows GOARCH=amd64 CGO_ENABLED=0 \
    go build -trimpath -ldflags "-s -w -H=windowsgui" \
    -o ../release/DeepDive-win64/DeepDive.exe .
)

cp dist/index.html "release/DeepDive-win64/DEEPDIVE-网页备用.html"
cat > "release/DeepDive-win64/使用说明.txt" <<'EOF'
DEEP DIVE ·《蓝井》 Windows 便携版
====================================

1. 双击 DeepDive.exe 启动（无需安装，绿色便携）
2. 若 Windows SmartScreen 提示「已保护你的电脑」：
   点击「更多信息」→「仍要运行」
3. 游戏会以独立窗口打开（使用系统自带的 Edge 内核）
   关闭窗口即退出，不留任何后台进程
4. 建议佩戴耳机；含恐怖内容与闪光画面

若 EXE 无法启动（极少数精简系统没有 Edge/Chrome）：
   用任意浏览器双击「DEEPDIVE-网页备用.html」即可游玩

操作：WASD 游动 · 鼠标视角 · Space/Shift 升降
      F 手电 · E 查看线索 · Tab 案件档案 · Esc 暂停

隐私说明：本程序只监听本机 127.0.0.1 随机端口，
不访问网络、不写注册表、不留存文件。
EOF

echo "→ 打包 zip…"
(
  cd release
  rm -f DeepDive-win64.zip
  zip -r -9 -q DeepDive-win64.zip DeepDive-win64
)

echo "→ 完成："
ls -la release/DeepDive-win64.zip release/web/DEEPDIVE.html
