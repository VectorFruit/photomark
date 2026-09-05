<div align="center">

# 📷 PhotoMark

**Photo EXIF watermark and frame studio built with Tauri 2.0 + Rust**

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

## Introduction

PhotoMark reads a photo's EXIF data and renders it into a framed image with a metadata watermark. The UI is TypeScript + Canvas; EXIF parsing and image output are handled in Rust. It runs on the system WebView through Tauri 2.0, so the package and memory footprint stay smaller than Electron alternatives.

## Install

### Arch Linux (AUR)

```bash
yay -S photomark
# or
paru -S photomark
```

## Features

### Frame templates

- **Classic bottom bar**: metadata strip under the photo, optional brand logo
- **Gallery border**: even margins with a centered caption at the bottom
- **Polaroid**: retro instant-print style
- **Minimal badge**: translucent capsule in the bottom-right corner

### Frame & settings

- Backgrounds: white, dark, frosted blur, custom color
- Adjustable: padding, bottom bar height, font size, font weight, corner radius, shadow, blur intensity, watermark vertical position
- Display options: camera model, lens, exposure parameters, date, custom signature; focal length as physical / 35mm equivalent / both
- Presets: 4 built-in combinations, plus save-your-own
- Brand logos auto-detected from EXIF, or selected manually
- Fonts: bundled Noto Sans SC / Noto Serif SC / Brass Mono, plus fonts installed on your system

### Interface

- Ambient light color follows the photo, three intensity levels, can be turned off
- 5 accent palettes; light / dark themes with follow-system mode; Chinese / English
- Collapsible photo list and settings panels; mouse-wheel zoom on the preview
- Keyboard shortcuts: ←/→ navigate, Space original, F fit, +/− zoom, E export, Delete remove, ? help
- Restores the last photo list on launch

### Export

- Formats: JPEG / PNG / WebP; JPEG quality adjustable 0–100
- Single and batch export at original resolution
- Filename templates with variables such as `{filename}`, `{model}`, `{date}`
- Previously imported photos use a disk thumbnail cache, so reopening is nearly instant

## Showcase

![Landscape example](docs/assets/DSC_0427_framed.jpg)

![Portrait example](docs/assets/DSC_0693_framed.jpg)

## Supported formats

- Input: JPG / JPEG / PNG / WebP / TIFF / TIF (TIFF on desktop; browser preview mode supports JPG / PNG / WebP)
- Export: JPEG (selectable quality), PNG, WebP

## Development

### Requirements

- Node.js >= 18
- Yarn
- Rust >= 1.80
- Linux system packages (Arch Linux example):

  ```bash
  sudo pacman -S --needed webkit2gtk-4.1 gtk3 libsoup3 cairo gdk-pixbuf2 glib2
  ```

### Local development

```bash
git clone https://github.com/vectorfruit/photomark.git
cd photomark
yarn install
yarn tauri dev
```

## License

This project is licensed under [GPL-3.0](./LICENSE).

Bundled fonts: [Noto Sans SC](https://fonts.google.com/noto/specimen/Noto+Sans+SC), [Noto Serif SC](https://fonts.google.com/noto/specimen/Noto+Serif+SC), [Brass Mono](https://fonts.google.com/specimen/Brass+Mono) (SIL Open Font License).
