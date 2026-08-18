# 🤝 PhotoMark 贡献指南 (Contributing Guide)

感谢您对 **PhotoMark** 项目的关注！我们非常欢迎来自社区的 Issue 报告、功能建议和代码贡献。

为了保证代码库的整洁、稳定与高效协作，请在提交代码前仔细阅读本指南。

---

## 🛠️ 本地开发环境准备

### 1. 基础环境
- **Node.js**: >= 18.0.0
- **Yarn**: >= 1.22.0
- **Rust**: >= 1.80.0 (推荐 `rustup toolchain install stable`)
- **Tauri CLI**: 2.0+

### 2. 系统依赖 (Linux)
以 Arch Linux 为例：
```bash
sudo pacman -S --needed webkit2gtk-4.1 gtk3 libsoup3 cairo gdk-pixbuf2 glib2
```

### 3. 安装与运行
```bash
# 克隆仓库
git clone https://github.com/vectorfruit/photomark.git
cd photomark

# 安装前端依赖
yarn install

# 启动开发服务器与 Tauri 调试窗口 (支持热重载)
yarn tauri dev
```

---

## 📂 项目核心模块指引

* **Rust 后端 (`src-tauri/src/`)**：
  - `exif_reader.rs`：负责从原始图片中极速提取相机厂商、型号、镜头、光圈、快门、ISO 等 EXIF 元数据。
  - `image_engine.rs`：负责图像解码、色彩空间管理、原画无损二进制读取与保存。
  - `commands.rs`：Tauri IPC 命令注册与异步事件发射器（解析进度、批量进度）。
* **前端渲染器 (`src/renderer/`)**：
  - `canvasRenderer.ts`：负责各相框模板的 2D Canvas 矢量排版重绘。
  - `blurEngine.ts`：自研 3-Pass 卷积多级降采样高斯模糊算法，确保在任何 WebKitGTK 平台下均能高效输出毛玻璃质感。
  - `logoManager.ts`：相机厂商名称模糊匹配与矢量 SVG 缓存。
* **状态与主控 (`src/main.ts`)**：
  - 负责队列管理、拖拽导入、实时预览防抖、深浅主题切换、UI 缩放调节与导出流程。

---

## 🎨 如何扩展功能

### 1. 添加新的相机品牌 Logo
1. 准备两套高清晰度矢量 SVG 文件：深色版（`brand-b.svg`）和浅色版（`brand-w.svg`）。
2. 将文件放置在 `public/logos/` 目录下。
3. 在 `src/renderer/logoManager.ts` 中的 `BRAND_ALIASES` 字典中添加对应的识别别名：
   ```typescript
   'mybrand': ['mybrand', 'my brand', 'brand_name_in_exif'],
   ```
4. 在 `index.html` 的品牌下拉菜单 `<select id="cfg-brand-logo">` 中添加选项。

### 2. 添加新的相框模板
1. 在 `src/types.ts` 中的 `FrameTemplateId` 类型中加入新的模板标识符。
2. 在 `src/renderer/canvasRenderer.ts` 中实现对应的渲染函数 `renderMyNewTemplate(...)`。
3. 在 `index.html` 的相框模板网格中新增对应卡片，并在 `src/styles.css` 中配置样式。

---

## 📝 提交信息规范 (Commit Convention)

我们遵循标准 [Conventional Commits](https://www.conventionalcommits.org/) 规范。提交信息格式如下：

```
<type>(<scope>): <description>
```

### 常用 Type 标识：
* `feat`: 新增功能（Feature）
* `fix`: 修复缺陷（Bug Fix）
* `perf`: 性能优化（Performance Improvement）
* `refactor`: 代码重构（不影响外部功能的代码优化）
* `style`: 代码格式、UI 样式调整
* `docs`: 文档变动
* `chore`: 构建配置、依赖项更新等杂项

### 提交示例：
```bash
git commit -m "feat(renderer): add vintage polaroid frame template"
git commit -m "fix(exif): fix focal length parsing on legacy manual lenses"
git commit -m "perf(blur): optimize box blur array iteration using TypedArrays"
```

---

## 🚀 提交 Pull Request (PR)

1. Fork 本项目并基于 `master` 分支创建您自己的特性分支：
   ```bash
   git checkout -b feat/my-new-feature
   ```
2. 编写代码并进行本地格式化与类型检查：
   ```bash
   yarn build
   cargo check --manifest-path src-tauri/Cargo.toml
   ```
3. 确保所有修改编译通过且无 Warning。
4. 提交代码并推送至您的 Fork 仓库：
   ```bash
   git push origin feat/my-new-feature
   ```
5. 在 GitHub 仓库发起 Pull Request，并详细描述修改动机、验证步骤与效果截图。

---

## 📄 协议

当您向 **PhotoMark** 贡献代码时，即表示您同意将所提交的代码以 [GNU General Public License v3.0 (GPLv3)](LICENSE) 协议发布。
