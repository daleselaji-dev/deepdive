// DeepDive 便携宿主：
// 内嵌单文件游戏 HTML → 本机随机端口 HTTP 服务 →
// 优先以 Edge/Chrome 的 --app 模式打开独立窗口（Win10/11 必装 Edge），
// 窗口关闭进程即退出；找不到浏览器时回退系统默认浏览器 + 心跳看门狗兜底退出。
// 零安装、零注册表、零网络访问（只监听 127.0.0.1）。
package main

import (
	_ "embed"
	"bytes"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync/atomic"
	"time"
)

//go:embed game.html
var gameHTML []byte

var lastBeat atomic.Int64

func main() {
	addr := "127.0.0.1:0"
	if p := os.Getenv("DEEPDIVE_PORT"); p != "" {
		addr = "127.0.0.1:" + p
	}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		os.Exit(1)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	url := fmt.Sprintf("http://127.0.0.1:%d/", port)

	page := injectHeartbeat(gameHTML)
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(page)
	})
	mux.HandleFunc("/hb", func(w http.ResponseWriter, _ *http.Request) {
		lastBeat.Store(time.Now().UnixMilli())
		w.WriteHeader(http.StatusNoContent)
	})
	go func() { _ = http.Serve(ln, mux) }()

	lastBeat.Store(time.Now().UnixMilli())
	go watchdog()

	if cmd := launchAppWindow(url); cmd != nil {
		_ = cmd.Wait() // 独立 profile：窗口关闭 → 浏览器进程退出 → 宿主退出
		return
	}
	openDefaultBrowser(url)
	select {} // 心跳看门狗负责退出
}

// 页面每 3 秒向宿主报心跳；标签页关闭后 90 秒无心跳则自动退出（兜底防止进程残留）。
func injectHeartbeat(html []byte) []byte {
	hb := []byte(`<script>setInterval(function(){fetch('/hb').catch(function(){})},3000)</script></body>`)
	if i := bytes.LastIndex(html, []byte("</body>")); i >= 0 {
		out := make([]byte, 0, len(html)+len(hb))
		out = append(out, html[:i]...)
		out = append(out, hb...)
		out = append(out, html[i+len("</body>"):]...)
		return out
	}
	return append(html, hb...)
}

func watchdog() {
	const grace = 25 * time.Second // 浏览器启动宽限
	start := time.Now()
	for {
		time.Sleep(10 * time.Second)
		idle := time.Since(time.UnixMilli(lastBeat.Load()))
		if time.Since(start) > grace && idle > 90*time.Second {
			os.Exit(0)
		}
	}
}

// 以独立窗口（--app kiosk 风格，无地址栏/标签页）打开游戏。
func launchAppWindow(url string) *exec.Cmd {
	if runtime.GOOS != "windows" {
		return nil
	}
	pf := os.Getenv("ProgramFiles")
	pf86 := os.Getenv("ProgramFiles(x86)")
	local := os.Getenv("LocalAppData")
	candidates := []string{
		filepath.Join(pf86, `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(pf, `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(local, `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(pf, `Google\Chrome\Application\chrome.exe`),
		filepath.Join(pf86, `Google\Chrome\Application\chrome.exe`),
		filepath.Join(local, `Google\Chrome\Application\chrome.exe`),
	}
	profile := filepath.Join(os.TempDir(), "DeepDive.WebProfile")
	for _, exe := range candidates {
		if exe == "" {
			continue
		}
		if _, err := os.Stat(exe); err != nil {
			continue
		}
		cmd := exec.Command(exe,
			"--app="+url,
			"--user-data-dir="+profile,
			"--no-first-run",
			"--no-default-browser-check",
			"--disable-sync",
			"--start-maximized",
			"--autoplay-policy=no-user-gesture-required",
		)
		if err := cmd.Start(); err == nil {
			return cmd
		}
	}
	return nil
}

func openDefaultBrowser(url string) {
	switch runtime.GOOS {
	case "windows":
		_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		_ = exec.Command("open", url).Start()
	default:
		_ = exec.Command("xdg-open", url).Start()
	}
}
