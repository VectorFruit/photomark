# 🤝 PhotoMark Contributing Guide

Thank you for your interest in **PhotoMark**! We welcome community bug reports, feature suggestions, and code contributions.

To keep the codebase clean, stable, and efficient to collaborate on, please read this guide carefully before submitting code.

> **Language / 语言:** [English](./CONTRIBUTING.en.md) | [中文](./CONTRIBUTING.md)

---

## 🛠️ Local Development Environment

### 1. Base environment
- **Node.js**: >= 18.0.0
- **Yarn**: >= 1.22.0
- **Rust**: >= 1.80.0 (recommended: `rustup toolchain install stable`)
- **Tauri CLI**: 2.0+

### 2. System dependencies (Linux)
Arch Linux example:
```bash
sudo pacman -S --needed webkit2gtk-4.1 gtk3 libsoup3 cairo gdk-pixbuf2 glib2
```

### 3. Install & Run
```bash
# Clone the repository
git clone https://github.com/vectorfruit/photomark.git
cd photomark

# Install frontend dependencies
yarn install

# Start the dev server and Tauri debug window (with hot reload)
yarn tauri dev
```

---

## 📂 Project Core Modules

* **Rust backend (`src-tauri/src/`)**
  - `exif_reader.rs`: extracts camera make, model, lens, aperture, shutter, ISO and other EXIF metadata from original images at high speed.
  - `image_engine.rs`: image decoding, color space handling, lossless original binary reading and saving.
  - `commands.rs`: Tauri IPC command registration and async event emitters (parsing progress, batch progress).
* **Frontend renderer (`src/renderer/`)**
  - `canvasRenderer.ts`: 2D Canvas vector layout/redraw for each frame template.
  - `blurEngine.ts`: in-house 3-Pass convolution multi-level downsampled Gaussian blur, delivering frosted-glass quality efficiently on any WebKitGTK platform.
  - `logoManager.ts`: camera manufacturer fuzzy matching and vector SVG caching.
* **State & main controller (`src/main.ts`)**
  - Handles queue management, drag-and-drop import, debounced live preview, light/dark theme switching, UI scaling, and export flows.

---

## 🎨 How to Extend Features

### 1. Add a new camera brand logo
1. Prepare two high-resolution vector SVG files: dark variant (`brand-b.svg`) and light variant (`brand-w.svg`).
2. Place them in `public/logos/`.
3. Register the brand in `BRAND_LOGOS` inside `src/renderer/logoManager.ts` and add detection rules to `detectBrandId(make, model)` for the EXIF make/model strings.
4. Add an option in the brand dropdown `<select id="cfg-brand-logo">` in `index.html`.

### 2. Add a new frame template
1. Add the new template identifier to the `FrameTemplateId` type in `src/types.ts`.
2. Implement the corresponding rendering function, e.g. `renderMyNewTemplate(...)`, in `src/renderer/canvasRenderer.ts`.
3. Add the corresponding card to the template grid in `index.html` and configure styles in `src/styles.css`.

---

## 📝 Commit Convention

We follow the standard [Conventional Commits](https://www.conventionalcommits.org/). The commit message format is:

```
<type>(<scope>): <description>
```

### Common types
* `feat`: new feature
* `fix`: bug fix
* `perf`: performance improvement
* `refactor`: code refactoring (no external behavior change)
* `style`: formatting or UI style changes
* `docs`: documentation changes
* `chore`: build configuration, dependency updates, misc tasks

### Examples
```bash
git commit -m "feat(renderer): add vintage polaroid frame template"
git commit -m "fix(exif): fix focal length parsing on legacy manual lenses"
git commit -m "perf(blur): optimize box blur array iteration using TypedArrays"
```

---

## 🚀 Submitting a Pull Request (PR)

1. Fork this project and create your feature branch from `master`:
   ```bash
   git checkout -b feat/my-new-feature
   ```
2. Write code, run local formatting and type checks:
   ```bash
   yarn build
   cargo check --manifest-path src-tauri/Cargo.toml
   ```
3. Ensure all changes compile without warnings.
4. Commit and push to your fork:
   ```bash
   git push origin feat/my-new-feature
   ```
5. Open a Pull Request on GitHub with a detailed description of the motivation, verification steps, and screenshots.

---

## 📄 License

By contributing to **PhotoMark**, you agree that your contributions are released under the [GNU General Public License v3.0 (GPLv3)](LICENSE).
