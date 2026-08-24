<div align="center">

# 📷 PhotoMark

**A Tauri 2.0 + Rust photo EXIF watermark & frame tool**

[![CI & AppImage Build](https://github.com/vectorfruit/photomark/actions/workflows/ci.yml/badge.svg)](https://github.com/vectorfruit/photomark/actions/workflows/ci.yml)
[![AUR](https://img.shields.io/aur/version/photomark?label=AUR&color=1793d1)](https://aur.archlinux.org/packages/photomark)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8D8.svg?logo=tauri&logoColor=white)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-1.80+-dea584.svg?logo=rust&logoColor=white)](https://www.rust-lang.org)
[![Vite](https://img.shields.io/badge/Vite-6.0+-646CFF.svg?logo=vite&logoColor=white)](https://vitejs.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

</div>

> **Language / 语言:** [English](./README.en.md) | [中文](./README.md)

---

## Overview

PhotoMark is a desktop application for adding EXIF metadata watermarks and frame effects to photos. The frontend is built with TypeScript and Canvas; the backend uses Rust to parse EXIF data and process image output.

It is built with Tauri 2.0 and the system WebView, which usually results in a smaller installer and smaller runtime footprint than Electron-based applications.

## Installation

### Arch Linux (AUR)

Available in the [AUR](https://aur.archlinux.org/packages/photomark):

```bash
yay -S photomark
# or
paru -S photomark
```

## Features

### Frame templates

- **Classic bottom bar**: metadata bar with optional brand logo
- **Gallery border**: full frame with centered captions below the photo
- **Polaroid**: retro instant-photo style
- **Minimal badge**: semi-transparent glass capsule in the bottom-right corner

### Backgrounds & settings

- Background types: white, dark, frosted blur, custom color
- Adjustable: padding, font size, font weight, corner radius, shadow, blur intensity
- Display options: camera model, lens model, exposure parameters, date, custom signature
- Brand logos: auto-detected from EXIF, or selected manually

### Interface

- Light / dark themes, including follow-system mode
- Chinese / English language switching
- 80% – 150% UI scaling
- Live progress dialogs and toast notifications

### Export

- Formats: JPEG / PNG / WebP
- JPEG quality: 100% / 95% / 90% / 85%
- Single-photo and batch export
- Filename templates with variables such as `{filename}`, `{model}`, `{date}`

## Showcase

![Landscape result](docs/assets/DSC_0427_framed.jpg)

![Portrait result](docs/assets/DSC_0693_framed.jpg)

## Supported formats

- Input: JPG / JPEG / PNG / WebP / TIFF / TIF (TIFF is supported in the desktop app; browser preview mode supports JPG / PNG / WebP only)
- Export: JPEG (selectable quality), PNG, WebP

## Development

### Prerequisites

- Node.js >= 18
- Yarn
- Rust >= 1.80
- Linux system dependencies (Arch Linux example):

  ```bash
  sudo pacman -S --needed webkit2gtk-4.1 gtk3 libsoup3 cairo gdk-pixbuf2 glib2
  ```

### Run locally

```bash
git clone https://github.com/vectorfruit/photomark.git
cd photomark
yarn install
yarn tauri dev
```

## Build & distribution

### Windows

```powershell
yarn install
yarn tauri build
# Output is located at src-tauri/target/release/bundle/nsis/
```

### Arch Linux

A `PKGBUILD` is included at the project root. Because the repository already contains a `src/` directory (which conflicts with makepkg's build directory), build it from a separate directory:

```bash
mkdir -p photomark-build
cd photomark-build
cp /path/to/photomark/PKGBUILD .
makepkg -sric
```

### Linux AppImage

```bash
./build-appimage.sh
# Output is located at dist-appimage/photomark-x86_64.AppImage
```

## Project structure

```
photomark/
├── src-tauri/                 # Rust backend
│   └── src/
│       ├── exif_reader.rs     # EXIF parsing
│       ├── image_engine.rs    # Image decoding, processing and batch export
│       ├── commands.rs        # Tauri commands and progress events
│       ├── models.rs          # Data models
│       └── lib.rs             # Application lifecycle
├── src/                       # Frontend
│   ├── renderer/
│   │   ├── canvasRenderer.ts  # Frame rendering
│   │   ├── blurEngine.ts      # Frosted blur
│   │   └── logoManager.ts     # Brand logo matching
│   ├── main.ts                # Interaction logic
│   ├── i18n.ts                # Internationalization
│   ├── styles.css             # Styles
│   └── types.ts               # TypeScript types
├── public/logos/              # Brand logo SVGs
├── PKGBUILD
├── build-appimage.sh
└── LICENSE
```

## Trademark disclaimer

Camera brand names, logos and trademarks appearing in this project belong to their respective owners. They are used solely for EXIF metadata display and factual indication, with no commercial affiliation, dependency, or official endorsement.

## Contributing

Issues and Pull Requests are welcome. See [CONTRIBUTING.en.md](./CONTRIBUTING.en.md) (or [CONTRIBUTING.md](./CONTRIBUTING.md) in Chinese).

## License

This project is released under the [GNU General Public License v3.0 (GPLv3)](LICENSE).
