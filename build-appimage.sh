#!/usr/bin/env bash
# ==============================================================================
# AppImage Packaging Script for PhotoMark
# Compliant with official AppImage specifications: https://docs.appimage.org
# ==============================================================================

set -euo pipefail

APP_NAME="photomark"
APP_DISPLAY_NAME="PhotoMark"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${PROJECT_ROOT}/build-appimage-dir/AppDir"
OUTPUT_DIR="${PROJECT_ROOT}/dist-appimage"
ARCH="${ARCH:-x86_64}"
OUTPUT_APPIMAGE="${OUTPUT_DIR}/${APP_NAME}-${ARCH}.AppImage"

echo "================================================================"
echo " 构建目标: ${APP_DISPLAY_NAME} (${APP_NAME})"
echo " 技术架构: Tauri 2.0 (Rust 图像内核 + Vite 前端)"
echo " 目标架构: ${ARCH}"
echo "================================================================"

# 1. 编译前端与 Rust 原生可执行二进制
echo "==> 步骤 1/4: 编译前端与 Rust Release 二进制..."
cd "${PROJECT_ROOT}"

if [ ! -d "node_modules" ]; then
    yarn install
fi

yarn build
cargo build --release --manifest-path src-tauri/Cargo.toml

# 2. 构造标准 AppDir 结构
echo "==> 步骤 2/4: 构造标准 AppDir 目录结构..."
rm -rf "${APP_DIR}"
mkdir -p "${APP_DIR}/usr/bin"
mkdir -p "${APP_DIR}/usr/lib"
mkdir -p "${APP_DIR}/usr/share/applications"
mkdir -p "${APP_DIR}/usr/share/icons/hicolor/512x512/apps"

# 拷贝二进制主体
cp -a "${PROJECT_ROOT}/src-tauri/target/release/photomark" "${APP_DIR}/usr/bin/photomark"

# 拷贝图标
cp "${PROJECT_ROOT}/src-tauri/icons/icon.png" "${APP_DIR}/${APP_NAME}.png"
cp "${PROJECT_ROOT}/src-tauri/icons/icon.png" "${APP_DIR}/usr/share/icons/hicolor/512x512/apps/${APP_NAME}.png"
cp "${PROJECT_ROOT}/src-tauri/icons/icon.png" "${APP_DIR}/.DirIcon"

# 写入 Desktop Entry
cat << EOF > "${APP_DIR}/${APP_NAME}.desktop"
[Desktop Entry]
Name=${APP_DISPLAY_NAME}
GenericName=Photo EXIF Watermark & Frame Studio
Comment=A modern, ultra-lightweight photo EXIF watermark and frame studio
Exec=${APP_NAME} %U
Icon=${APP_NAME}
Terminal=false
Type=Application
Categories=Graphics;Photography;Utility;
MimeType=image/jpeg;image/png;image/tiff;image/webp;
StartupWMClass=${APP_NAME}
EOF
cp "${APP_DIR}/${APP_NAME}.desktop" "${APP_DIR}/usr/share/applications/"

# 3. 编写标准 AppRun 引导入口
echo "==> 步骤 3/4: 编写 AppRun 启动入口..."
cat << 'EOF' > "${APP_DIR}/AppRun"
#!/bin/sh
set -e
HERE="$(dirname "$(readlink -f "${0}")")"
export APPDIR="${HERE}"
export PATH="${HERE}/usr/bin:${PATH}"
export LD_LIBRARY_PATH="${HERE}/usr/lib:${LD_LIBRARY_PATH:-}"
export XDG_DATA_DIRS="${HERE}/usr/share:${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"
exec "${HERE}/usr/bin/photomark" "$@"
EOF
chmod +x "${APP_DIR}/AppRun"

# 4. 调用 appimagetool 封包
echo "==> 步骤 4/4: 使用 appimagetool 生成 AppImage..."
APPIMAGETOOL=""
if command -v appimagetool >/dev/null 2>&1; then
    APPIMAGETOOL="appimagetool"
elif [ -f "${PROJECT_ROOT}/appimagetool-x86_64.AppImage" ]; then
    APPIMAGETOOL="${PROJECT_ROOT}/appimagetool-x86_64.AppImage"
else
    echo "    下载官方 appimagetool..."
    curl -L -o "${PROJECT_ROOT}/appimagetool-x86_64.AppImage" \
      "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage"
    chmod +x "${PROJECT_ROOT}/appimagetool-x86_64.AppImage"
    APPIMAGETOOL="${PROJECT_ROOT}/appimagetool-x86_64.AppImage"
fi

mkdir -p "${OUTPUT_DIR}"
export ARCH="${ARCH}"
export APPIMAGE_EXTRACT_AND_RUN=1

${APPIMAGETOOL} --appimage-extract-and-run --no-appstream "${APP_DIR}" "${OUTPUT_APPIMAGE}" || \
${APPIMAGETOOL} --no-appstream "${APP_DIR}" "${OUTPUT_APPIMAGE}"

rm -rf "${PROJECT_ROOT}/build-appimage-dir"

echo "================================================================"
echo " [SUCCESS] AppImage 构建完成!"
echo " 产物路径: ${OUTPUT_APPIMAGE}"
echo "================================================================"
