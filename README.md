<div align="center">

# 📷 PhotoMark

**基于 Tauri 2.0 + Rust 的照片 EXIF 水印与相框工具**

[![CI & AppImage Build](https://github.com/vectorfruit/photomark/actions/workflows/ci.yml/badge.svg)](https://github.com/vectorfruit/photomark/actions/workflows/ci.yml)
[![AUR](https://img.shields.io/aur/version/photomark?label=AUR&color=1793d1)](https://aur.archlinux.org/packages/photomark)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8D8.svg?logo=tauri&logoColor=white)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-1.80+-dea584.svg?logo=rust&logoColor=white)](https://www.rust-lang.org)
[![Vite](https://img.shields.io/badge/Vite-6.0+-646CFF.svg?logo=vite&logoColor=white)](https://vitejs.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

</div>

> **语言 / Language:** [中文](./README.md) | [English](./README.en.md)

---

## 简介

PhotoMark 读取照片的 EXIF 信息，给照片加上相框和参数水印。界面用 TypeScript 和 Canvas 渲染，EXIF 解析和图片输出由 Rust 完成，基于 Tauri 2.0 运行在系统 WebView 上，安装包和内存占用比 Electron 方案小。

## 安装

### Arch Linux (AUR)

```bash
yay -S photomark
# 或
paru -S photomark
```

## 功能

### 相框模板

- **经典底栏**：照片下方是参数栏，可带品牌 Logo
- **画廊相框**：四边留白，参数居中在底部
- **拍立得**：复古拍立得样式
- **极简微章**：右下角半透明胶囊水印

### 相框与参数

- 背景：白色、深色、毛玻璃、自定义颜色
- 可调项：边距、底栏高度、字号、字重、圆角、阴影、毛玻璃强度、水印上下位置
- 可显示内容：相机型号、镜头、曝光参数、拍摄日期、自定义签名；焦距可选实际值 / 35mm 等效 / 两者
- 预设：内置 4 种常用组合，可以把当前配置保存为自定义预设
- 品牌 Logo 按 EXIF 自动匹配，也可手动指定
- 字体：内置思源黑体 / 思源宋体 / Brass Mono，也可选用本机安装的字体

### 界面

- 环境光颜色可跟随照片主色，强度分三档，可关闭
- 5 组主题色；深浅色主题，可跟随系统；中英双语
- 照片列表和设置面板可折叠；预览区可用滚轮缩放
- 快捷键：←/→ 切换照片，Space 按住看原图，F 适应屏幕，+/− 缩放，E 导出，Delete 移除，? 帮助
- 启动时恢复上次的照片列表

### 导出

- 格式：JPEG / PNG / WebP；JPEG 质量 0–100 连续可调
- 单张与批量导出，保持原分辨率
- 文件名模板支持 `{filename}`、`{model}`、`{date}` 等变量
- 导出过的照片再次导入时使用磁盘缩略图缓存，几乎不用等待

## 效果预览

![横构图效果](docs/assets/DSC_0427_framed.jpg)

![竖构图效果](docs/assets/DSC_0693_framed.jpg)

## 支持的格式

- 输入：JPG / JPEG / PNG / WebP / TIFF / TIF（桌面端支持 TIFF；浏览器预览模式仅支持 JPG / PNG / WebP）
- 导出：JPEG（可选品质）、PNG、WebP

## 开发

### 环境要求

- Node.js >= 18
- Yarn
- Rust >= 1.80
- Linux 系统依赖（Arch Linux 示例）：

  ```bash
  sudo pacman -S --needed webkit2gtk-4.1 gtk3 libsoup3 cairo gdk-pixbuf2 glib2
  ```

### 本地开发

```bash
git clone https://github.com/vectorfruit/photomark.git
cd photomark
yarn install
yarn tauri dev
```

## 许可证

本项目基于 [GPL-3.0](./LICENSE) 协议开源。

内置字体：[Noto Sans SC](https://fonts.google.com/noto/specimen/Noto+Sans+SC)、[Noto Serif SC](https://fonts.google.com/noto/specimen/Noto+Serif+SC)、[Brass Mono](https://fonts.google.com/specimen/Brass+Mono)（SIL Open Font License）。
