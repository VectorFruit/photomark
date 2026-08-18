# Maintainer: vectorfruit <vectorfruit@local>

pkgname=photomark
pkgver=0.1.0
pkgrel=1
pkgdesc="A modern, ultra-lightweight photo EXIF watermark and frame studio (Clean-Room Tauri 2.0 implementation)"
arch=('x86_64')
url="https://github.com/vectorfruit/photomark"
license=('GPL-3.0-or-later')
depends=(
  'cairo'
  'gdk-pixbuf2'
  'glib2'
  'glibc'
  'gtk3'
  'libsoup3'
  'pango'
  'webkit2gtk-4.1'
)
makedepends=(
  'cargo'
  'git'
  'nodejs>=18'
  'rust'
  'yarn'
)

prepare() {
  cd "${srcdir}/${pkgname}"

  # 配置本地 yarn 缓存与国内镜像源
  export YARN_CACHE_FOLDER="${srcdir}/yarn-cache"
  yarn config set registry https://registry.npmmirror.com || true
  yarn install
}

build() {
  cd "${srcdir}/${pkgname}"

  export NODE_ENV=production
  # 1. 编译前端产物
  yarn build

  # 2. 编译 Rust 原生二进制
  cargo build --release --manifest-path src-tauri/Cargo.toml
}

package() {
  cd "${srcdir}/${pkgname}"

  # 1. 安装原生二进制文件至 /usr/bin/photomark
  install -Dm755 src-tauri/target/release/photomark "${pkgdir}/usr/bin/${pkgname}"

  # 2. 安装 Desktop 入口
  install -d "${pkgdir}/usr/share/applications"
  cat << 'EOF' > "${pkgdir}/usr/share/applications/${pkgname}.desktop"
[Desktop Entry]
Name=PhotoMark
Name[zh_CN]=照片水印相框
GenericName=Photo EXIF Watermark & Frame Studio
GenericName[zh_CN]=照片 EXIF 参数相框与水印工坊
Comment=A modern, ultra-lightweight photo EXIF watermark and frame studio
Comment[zh_CN]=现代轻量级相机 EXIF 参数水印与相框处理工具
Exec=/usr/bin/photomark %U
Icon=photomark
Terminal=false
Type=Application
StartupNotify=true
StartupWMClass=photomark
Categories=Graphics;Photography;Utility;
MimeType=image/jpeg;image/png;image/tiff;image/webp;
EOF
  chmod 644 "${pkgdir}/usr/share/applications/${pkgname}.desktop"

  # 3. 安装图标至 hicolor 主题目录
  install -Dm644 src-tauri/icons/32x32.png "${pkgdir}/usr/share/icons/hicolor/32x32/apps/${pkgname}.png"
  install -Dm644 src-tauri/icons/128x128.png "${pkgdir}/usr/share/icons/hicolor/128x128/apps/${pkgname}.png"
  install -Dm644 src-tauri/icons/icon.png "${pkgdir}/usr/share/icons/hicolor/512x512/apps/${pkgname}.png"
  install -Dm644 src-tauri/icons/icon.png "${pkgdir}/usr/share/pixmaps/${pkgname}.png"
}
