# 📷 PhotoMark

> A modern, ultra-lightweight photo EXIF watermark & frame studio.  
> 现代轻量级相机 EXIF 参数水印与相框工坊，基于 **Tauri 2.0 (Rust 图像内核 + Vite 前端)** Clean-Room 重构。

---

## ✨ 核心特性与优势

* **⚡ 极致轻量与极速启动**：基于 Rust 原生二进制与 WebKit 运行时，内存占用 <30MB，无庞大的 Electron 运行时与无用依赖。
* **🔍 纯 Rust 极速 EXIF 解析**：使用 `kamadak-exif` 解析相机机身（Make/Model）、镜头（Lens）、等效焦段、光圈、快门、ISO 与拍摄日期，告别 Perl / 外部 CLI 依赖。
* **🎨 多款精美相框模板**：
  - **经典底栏 (Classic Bottom Bar)**：专业相机参数底栏，支持左右分栏与品牌标识。
  - **画廊相框 (Gallery Border)**：全包围画廊式内衬装裱。
  - **毛玻璃虚化 (Frosted Blur Glass)**：自适应照片主色调背景高斯虚化 + 悬浮卡片。
  - **拍立得即显 (Polaroid Instant)**：复古拍立得白框与手写/打字机风信息。
  - **极简微章 (Minimal Badge)**：角落悬浮毛玻璃胶囊参数微章。
* **🏷️ 全相机品牌矢量 Logo 自动匹配**：内置 Sony、Canon、Nikon、Leica、Fujifilm、Hasselblad、Panasonic、Olympus、DJI、Ricoh、Apple、Zeiss 等品牌矢量 Logo。
* **🚀 多线程并行批量导出**：利用 Rust `rayon` 并行处理整个照片队列，支持 JPEG（质量自调）、PNG（无损）、WebP。

---

## 🛠️ 本地开发与运行

```bash
# 1. 安装依赖
yarn

# 2. 启动开发模式 (热重载)
yarn tauri dev
```

---

## 📦 打包与分发

### 1. Arch Linux (PKGBUILD)
```bash
makepkg -sric
```

### 2. AppImage 打包
```bash
./build-appimage.sh
```

---

## 📄 开源协议
MIT License © 2026 vectorfruit
