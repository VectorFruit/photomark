# 📷 PhotoMark 更新日志 (Changelog)

本文档记录了 **PhotoMark** 各版本的主要更新、修复与体验改进。

---

## 🚀 [v1.0.1] - 2026-08-18

### 🐛 缺陷修复 (Bug Fixes)
* **解决 AppImage 独立运行白屏与连接错误**：
  - 修复脱离开发环境独立启动 AppImage 时出现的 `Could not connect to localhost: Connection refused` 错误。
  - 重构打包构建管线，统一采用 `yarn tauri build --no-bundle`，将前端 HTML/CSS/JS 与 SVG 矢量资源完整内嵌至 Rust 原生二进制内部，实现 100% 离线自包含运行。

### ✨ 功能新增与优化 (Features & Improvements)
* **🪟 全平台 CI/CD 自动化构建**：
  - 接入 GitHub Actions 多平台矩阵，自动构建并发布 Linux 通用 AppImage（`photomark-linux-x86_64.AppImage`，仅 4.8MB）与 Windows 安装包（`PhotoMark_1.0.1_x64-setup.exe` 与 MSI）。
* **🖼️ 原画无损画质直通 (Master Export)**：
  - 彻底去除中间二次有损压缩环节，直接流式读取未解压的原始高分辨率照片数据。
  - 支持 **PNG（100% 逐像素点对点数学无损）** 与 **JPEG 100% 满品质** 原画输出。
* **🎨 自研多级金字塔高斯毛玻璃引擎**：
  - 实现纯 TypeScript 3-Pass 快速卷积高斯模糊算法，突破 Linux WebKitGTK 下 Canvas 硬件滤镜限制，输出深邃通透的真毛玻璃背景。
  - 支持毛玻璃模糊强度（15 ~ 150）实时滑动调节。
* **🔍 全局 UI 缩放与多屏适配**：
  - 顶部导航栏新增界面自由缩放控件（80% ~ 150%），完美适配 HiDPI 2K/4K 视网膜大屏与轻薄本。
* **🌓 深浅双色主题与交互调优**：
  - 修复深色模式下下拉选择框 `<select>` 与 `<option>` 的字体对比度。
  - 每个调节滑块均配有独立 `↺` 恢复默认值按钮与全局重置全部参数按钮。
  - 导入区域与选择框移除已不适用的 RAW 扩展名提示。

---

## 🌟 [v1.0.0] - 2026-08-18

### 初始发布 (Initial Release)
* 基于 **Tauri 2.0 + 纯 Rust 图像内核 + 现代化前端** 净室重构。
* 内存占用仅 **25MB ~ 30MB**，极速秒开。
* 纯 Rust `kamadak-exif` 解析相机机身、镜头、曝光三要素与拍摄日期。
* 内置 4 大相框模板（经典底栏、画廊相框、拍立得即显、极简微章）。
* 内置 20+ 款主流相机品牌矢量 Logo 自动匹配。
* 基于 Rust Rayon 多核并行批量导出与实时进度条。
* 采用 **GNU General Public License v3.0 (GPLv3)** 开源协议，并附加品牌商标免责声明。
