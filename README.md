<div align="center">

# 📷 PhotoMark

**现代极速相机 EXIF 参数水印与相框工坊**  
*A modern, ultra-lightweight photo EXIF watermark & frame studio built with Tauri 2.0 and Rust.*

[![CI & AppImage Build](https://github.com/vectorfruit/photomark/actions/workflows/ci.yml/badge.svg)](https://github.com/vectorfruit/photomark/actions/workflows/ci.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8D8.svg?logo=tauri&logoColor=white)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-1.80+-dea584.svg?logo=rust&logoColor=white)](https://www.rust-lang.org)
[![Vite](https://img.shields.io/badge/Vite-6.0+-646CFF.svg?logo=vite&logoColor=white)](https://vitejs.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

</div>

---

## 🌟 为什么选择 PhotoMark？

市面上的摄影相框工具往往基于体积臃肿的 Electron 架构（动辄消耗 300MB+ 内存），或依赖 Perl、ImageMagick 等外部复杂 CLI 管道，运行缓慢且容易崩溃。

**PhotoMark** 采用 **Clean-Room（净室）架构重构**，基于 **Tauri 2.0 + 纯 Rust 内核** 与 **现代化 WebKit/Canvas 前端** 构建：

* 🚀 **极速冷启 & 超轻内存**：内存占用仅约 **25MB ~ 30MB**（相比传统工具降低 90%）。
* 🦀 **纯 Rust 极速 EXIF 解析**：使用 `kamadak-exif` 解析机身、镜头、焦段、光圈、快门、ISO 等核心参数，零外部依赖。
* 🖼️ **原画无损画质直通**：绕过二次压缩损耗，以 100% 原始分辨率读取与重绘，支持最高品质 JPEG、PNG（100% 无损）与 WebP。
* ⚡ **多核并行批量处理**：Rust `rayon` 多线程并发写入，上百张照片秒级导出。
* 🎨 **高阶自研毛玻璃与阴影引擎**：多级金字塔高斯模糊算法，配合通透的照片立体投影。

---

## ✨ 核心特性

### 1. 四大多功能精美相框模板
* **经典底栏 (`Classic Bottom Bar`)**：专业相机参数底栏，支持左右分栏排版与品牌标识。
* **画廊相框 (`Gallery Border`)**：全包围画廊式内衬装裱，下方优雅居中排列 Logo 与参数。
* **拍立得即显 (`Polaroid Instant`)**：复古拍立得白框，搭配打字机风格参数排版与复古时间印。
* **极简微章 (`Minimal Badge`)**：照片右下角半透明毛玻璃胶囊浮动水印。

### 2. 相框质感与可调毛玻璃
* **质感模式**：纯白相框、深黑相框、✨ 毛玻璃虚化、自定义色彩。
* **可调毛玻璃模糊度**：自研 3-Pass 卷积模糊引擎，支持 15 ~ 150 深度渐变调节。
* **立体投影与圆角**：自由调节主图阴影深度（Drop Shadow）与圆角弧度。

### 3. 相机品牌矢量 Logo 自动匹配
内置 20+ 款主流相机与光学品牌高精度矢量 Logo，根据 EXIF 自动识别并匹配深浅色版：
* 索尼 (Sony)、佳能 (Canon)、尼康 (Nikon)、徕卡 (Leica)、富士 (Fujifilm)
* 哈苏 (Hasselblad)、松下 (Panasonic)、奥林巴斯 (Olympus)、大疆 (DJI)、理光 (Ricoh)、蔡司 (Zeiss)、苹果 (Apple) 等。

### 4. 极致人机交互体验
* **实时进度条**：Tauri 2.0 异步事件驱动，照片解析与批量导出具备实时动态进度弹窗。
* **深浅双色主题**：支持 `☀️ 浅色模式` 与 `🌙 深色模式` 一键切换，偏好持久化。
* **UI 界面自由缩放**：提供 80% ~ 150% 界面缩放，完美适配 HiDPI 2K/4K 大屏与轻薄本。
* **一键重置**：每个调节滑块均配有独立 `↺` 重置按钮，并支持一键恢复全局默认配置。

---

## 📸 支持的图像格式

* **输入格式**：`JPG` / `JPEG` / `PNG` / `WebP` / `TIFF` / `TIF`
* **导出格式**：
  * **JPEG**：支持 100% (原始最高质量)、95%、90%、85% 质量调节
  * **PNG**：100% 逐像素点对点数学无损
  * **WebP**：现代高效率编码

---

## 🛠️ 快速开始

### 前置要求
* [Node.js](https://nodejs.org/) (>= 18) 与 [Yarn](https://yarnpkg.com/)
* [Rust](https://www.rust-lang.org/) (>= 1.80) 与 `cargo`
* Linux 系统依赖（Arch Linux 示例）：
  ```bash
  sudo pacman -S --needed webkit2gtk-4.1 gtk3 libsoup3 cairo gdk-pixbuf2 glib2
  ```

### 本地开发与调试
```bash
# 1. 克隆代码仓库
git clone https://github.com/vectorfruit/photomark.git
cd photomark

# 2. 安装前端依赖
yarn install

# 3. 启动桌面端开发调试模式 (带热重载)
yarn tauri dev
```

---

## 📦 打包与分发

### 1. Windows 安装包构建 (.exe / .msi)
在 Windows 环境下（PowerShell 或 CMD）执行：
```powershell
yarn install
yarn tauri build
# 产物位于 src-tauri/target/release/bundle/nsis/ (包含安装包与可执行文件)
```

### 2. Arch Linux 原生打包 (PKGBUILD)
项目根目录内置标准 `PKGBUILD`，直接执行：
```bash
makepkg -sric
```

### 3. Linux AppImage 打包
执行内置自动化封包脚本，生成符合 [AppImage 官方规范](https://docs.appimage.org) 的跨发行版通用单文件：
```bash
./build-appimage.sh
# 产物位于 dist-appimage/photomark-x86_64.AppImage
```

---

## 📂 项目结构

```
photomark/
├── src-tauri/                 # Rust 原生后端
│   ├── src/
│   │   ├── exif_reader.rs     # 纯 Rust EXIF 解析
│   │   ├── image_engine.rs    # 图像解码、原画无损直通与 Rayon 批处理
│   │   ├── commands.rs        # Tauri 2.0 IPC 指令集与进度事件发射器
│   │   ├── models.rs          # 强类型数据定义
│   │   └── lib.rs             # Tauri 插件与生命周期
│   ├── Cargo.toml             # Rust 依赖配置
│   └── tauri.conf.json        # Tauri 应用与窗口配置
├── src/                       # 前端交互与渲染
│   ├── renderer/
│   │   ├── canvasRenderer.ts  # 核心相框渲染引擎（矢量等比缩放）
│   │   ├── blurEngine.ts      # 自研多级金字塔高斯模糊卷积算法
│   │   └── logoManager.ts     # 相机品牌矢量 Logo 自动匹配与缓存
│   ├── main.ts                # 主控控制器（事件绑定、UI 缩放、主题切换）
│   ├── styles.css             # 深浅双模现代设计系统
│   └── types.ts               # TypeScript 接口模型
├── public/logos/              # 20+ 款品牌高精度矢量 SVG
├── PKGBUILD                   # Arch Linux 打包规范
├── build-appimage.sh          # AppImage 一键打包脚本
├── CONTRIBUTING.md            # 贡献指南
├── LICENSE                    # GNU General Public License v3.0
└── README.md                  # 项目说明
```

---

## ⚖️ 商标免责声明 (Trademark Disclaimer)

本软件中包含的所有相机品牌名称、徽标及商标（包括但不限于 Leica, Hasselblad, Sony, Canon, Nikon, Fujifilm 等）均归其各自的商标注册所有者所有。本项目引用上述标识仅用于 EXIF 元数据可视化展示与事实指示，与各品牌方无任何商业关联、从属关系或官方授权背书。

---

## 🤝 参与贡献

欢迎提交 Issue 或 Pull Request！详细贡献规范请参考 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 📄 开源协议

本项目基于 **[GNU General Public License v3.0 (GPLv3)](LICENSE)** 开源。
