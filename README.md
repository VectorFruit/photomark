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

PhotoMark 是一个桌面应用，用于给照片添加 EXIF 参数水印与相框效果。前端使用 TypeScript 与 Canvas 渲染，后端使用 Rust 解析 EXIF 并处理图片输出。

项目采用 Tauri 2.0 构建，使用系统 WebView；相比常见的 Electron 方案，安装包与运行时通常更小。

## 安装

### Arch Linux (AUR)

已发布到 [AUR](https://aur.archlinux.org/packages/photomark)：

```bash
yay -S photomark
# 或
paru -S photomark
```

## 功能

### 相框模板

- **经典底栏**：底部参数栏，支持品牌 Logo
- **画廊相框**：全包围相框，底部居中显示参数
- **拍立得**：复古拍立得风格
- **极简微章**：右下角半透明玻璃胶囊水印

### 背景与参数

- 背景类型：白色、深色、毛玻璃、自定义颜色
- 可调节参数：边距、字号、字重、圆角、阴影、毛玻璃强度
- 可显示内容：相机型号、镜头型号、曝光参数、拍摄日期、自定义签名
- 品牌 Logo：根据 EXIF 自动匹配，也可手动选择

### 界面

- 深浅色主题，支持跟随系统
- 中文 / English 切换
- 80% ~ 150% 界面缩放
- 实时进度弹窗与操作提示

### 导出

- 格式：JPEG / PNG / WebP
- 品质：JPEG 100% / 95% / 90% / 85%
- 支持单张导出与批量导出
- 文件名模板支持 `{filename}`、`{model}`、`{date}` 等变量

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

## 打包

### Windows

```powershell
yarn install
yarn tauri build
# 产物位于 src-tauri/target/release/bundle/nsis/
```

### Arch Linux

项目根目录提供了 `PKGBUILD`。由于仓库自带 `src/` 目录会和 makepkg 的构建目录重名，建议在独立目录中构建：

```bash
mkdir -p photomark-build
cd photomark-build
cp /path/to/photomark/PKGBUILD .
makepkg -sric
```

### Linux AppImage

```bash
./build-appimage.sh
# 产物位于 dist-appimage/photomark-x86_64.AppImage
```

## 项目结构

```
photomark/
├── src-tauri/                 # Rust 后端
│   └── src/
│       ├── exif_reader.rs     # EXIF 解析
│       ├── image_engine.rs    # 图片解码、处理与批量导出
│       ├── commands.rs        # Tauri 命令与进度事件
│       ├── models.rs          # 数据结构
│       └── lib.rs             # 应用生命周期
├── src/                       # 前端
│   ├── renderer/
│   │   ├── canvasRenderer.ts  # 相框渲染
│   │   ├── blurEngine.ts      # 毛玻璃模糊
│   │   └── logoManager.ts     # 品牌 Logo 匹配
│   ├── main.ts                # 交互逻辑
│   ├── i18n.ts                # 国际化
│   ├── styles.css             # 样式
│   └── types.ts               # TypeScript 类型
├── public/logos/              # 品牌 Logo SVG
├── PKGBUILD
├── build-appimage.sh
└── LICENSE
```

## 商标声明

项目中出现的相机品牌名称、Logo 与商标归各自权利人所有。本项目仅用于 EXIF 元数据展示与事实性标识，与相关品牌没有商业关联、从属关系或官方授权。

## 参与贡献

欢迎提交 Issue 或 Pull Request。请参考 [CONTRIBUTING.md](./CONTRIBUTING.md)（或 [CONTRIBUTING.en.md](./CONTRIBUTING.en.md)）。

## 许可协议

本项目基于 [GNU General Public License v3.0 (GPLv3)](LICENSE) 开源。
