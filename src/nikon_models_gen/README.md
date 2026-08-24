# Nikon 相机全世代视觉字体与矢量化重构系统
> **Nikon Camera Typography & Vectorization System**
>
> 完整收录并高精度重构 Nikon 单反（D 系列）与微单（Z 系列）全世代机身文字标识、字符构件与排版工具。
>
> 官方认证源：[Nikon 下载中心 (Nikon Download Center)](https://downloadcenter.nikonimglib.com/zh-cn/index.html)

---

## 目录
- [一、 系统架构与视觉规范划分](#一-系统架构与视觉规范划分)
  - [1.1 Nikon D 系列单反排版系统（DSLR / F卡口）](#11-nikon-d-系列单反排版系统dslr--f卡口)
  - [1.2 Nikon Z 系列微单排版系统（Mirrorless / Z卡口）](#12-nikon-z-系列微单排版系统mirrorless--z卡口)
- [二、 官方合法型号数据库与鉴权机制](#二-官方合法型号数据库与鉴权机制)
- [三、 标准化几何网格定义](#三-标准化几何网格定义)
- [四、 双字形库资源清单](#四-双字形库资源清单)
  - [4.1 D 系列单反字形库 (`d_glyphs/`)](#41-d-系列单反字形库-d_glyphs)
  - [4.2 Z 系列微单字形库 (`z_glyphs/`)](#42-z-系列微单字形库-z_glyphs)
- [五、 算法与图像处理核心技术](#五-算法与图像处理核心技术)
- [六、 统一 CLI 排版工具使用指南 (`nikon_typography.py`)](#六-统一-cli-排版工具使用指南-nikon_typographypy)
- [七、 预置生成型号 SVG 清单](#七-预置生成型号-svg-清单)

---

## 一、 系统架构与视觉规范划分

本系统严格遵循 Nikon 官方工业设计历史与品牌识别手册（Brand Guidelines），将字形划分为两个互不混用的独立视觉系统：

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ 1. Nikon D 系列（数码单反系统 DSLR / F卡口）                                  │
│    • 前缀标志：双线空心衬线大写字母 D (glyph_D.svg)                          │
│    • 中/入门机型数字：专属工业模板切缝体 0~9 (glyph_0.svg ~ glyph_9.svg)      │
│    • 顶级旗舰机型数字：个位数专属双线空心体 (glyph_2_outline ~ glyph_6_outline) │
│    • 旗舰机型后缀：80% 比例双线空心字母 H, X 与小写 s (D2H, D3X, D2Xs, D4s)   │
│    • 特殊版本后缀：A (D810A 天体摄影版), E (D800E 去低通滤镜版)                │
│    • 复古单反手写字母：f (Df 复古全画幅)                                      │
├────────────────────────────────────────────────────────────────────────────┤
│ 2. Nikon Z 系列（微单系统 Mirrorless / Z卡口）                              │
│    • 核心品牌标：双线黑板体 ℤ (glyph_Z.svg) 作为独立卡口品牌 Logo            │
│    • 现代数字：全新设计的现代无衬线几何字体 0, 3, 5, 6, 7, 8, 9               │
│    • 世代标识：罗马数字衬线体 II, III                                       │
│    • 电影/新世代字母：现代无衬线字母 R (源自 ZR.png)                         │
│    • 复古微单系列：专属手写斜体衬线字母 f, c (用于 Z f 与 Z fc)               │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 二、 官方合法型号数据库与鉴权机制

系统实时同步自 [Nikon 官方下载中心 (Nikon Download Center)](https://downloadcenter.nikonimglib.com/zh-cn/index.html) 的官方产品数据，建立了完整的合法机型白名单（收录于 [`nikon_official_models.json`](nikon_official_models.json)）：

* **D 系列数码单反照相机（官方收录全部 50 款机型）**：
  `D200`, `D2H`, `D2Hs`, `D2X`, `D2Xs`, `D3`, `D300`, `D300S`, `D3000`, `D3100`, `D3200`, `D3300`, `D3400`, `D3500`, `D3S`, `D3X`, `D4`, `D40`, `D40X`, `D4S`, `D5`, `D50`, `D500`, `D5000`, `D5100`, `D5200`, `D5300`, `D5500`, `D5600`, `D6`, `D60`, `D600`, `D610`, `D70`, `D70s`, `D700`, `D7000`, `D7100`, `D7200`, `D750`, `D7500`, `D780`, `D80`, `D800`, `D800E`, `D810`, `D810A`, `D850`, `D90`, `Df`
* **Z 系列微单照相机 / 电影机（官方收录全部机型）**：
  `Z 30`, `Z 5`, `Z 50`, `Z 6`, `Z 6II`, `Z 7`, `Z 7II`, `Z 8`, `Z 9`, `Z f`, `Z fc`, `Z50II`, `Z5II`, `Z6III`, `ZR`

> [!IMPORTANT]
> **官方白名单鉴权规则**：用户通过 CLI 请求生成型号时，系统默认进行合法性校验。若输入非官方型号（如 `D9999` 或 `Z99`），系统将**直接拒绝生成**并推荐最相似的官方合法型号。

---

## 三、 标准化几何网格定义

* **大字标准字高（Standard Cap Height）**：$H = 395.00\text{ px}$
* **对齐画布标准高（Standard Canvas Height）**：$H_{\text{canvas}} = 413.00\text{ px}$
* **统一基准底线（Baseline Position）**：位于画布 $Y = 403.00\text{ px}$
* **复合路径填充规则**：统一采用 `fill-rule="evenodd"` 确保内外环与孔洞精准镂空。

---

## 四、 双字形库资源清单

字形库提供两种版本：
1. **紧凑单字版 (`glyph_*.svg`)**：`viewBox` 紧贴字符外边界，原点归零 $(0, 0)$。
2. **基线对齐版 (`glyph_*_aligned.svg`)**：统一画布高度与基线位置，可直接并列排版。

### 4.1 D 系列单反字形库 (`d_glyphs/`)

| 字形 Key | 紧凑版 SVG | 基线对齐版 SVG | 尺寸规格 (W×H) | 设计类型与来源 |
| :--- | :--- | :--- | :--- | :--- |
| **`D`** | `glyph_D.svg` | `glyph_D_aligned.svg` | `303.00 × 390.00` | 双线空心衬线大写字母 (D5600.png) |
| **`0`** | `glyph_0.svg` | `glyph_0_aligned.svg` | `303.00 × 395.00` | 工业模板切缝体，左右对称双半瓣 |
| **`1`** | `glyph_1.svg` | `glyph_1_aligned.svg` | `155.61 × 395.00` | 工业模板切缝体，左上衬线旗块 + 右立柱 |
| **`2`** | `glyph_2.svg` | `glyph_2_aligned.svg` | `250.51 × 395.00` | 工业模板切缝体，顶部圆弧 + 斜颈切缝 (D200.png) |
| **`3`** | `glyph_3.svg` | `glyph_3_aligned.svg` | `252.33 × 395.00` | 工业模板切缝体，顶折 + 中段切缝 + 下开口弧 |
| **`4`** | `glyph_4.svg` | `glyph_4_aligned.svg` | `294.40 × 395.00` | 工业模板切缝体，三角横梁切缝 (D40.png) |
| **`5`** | `glyph_5.svg` | `glyph_5_aligned.svg` | `275.00 × 392.00` | 工业模板切缝体，顶横 + 竖折 + 开口弧 (D5600.png) |
| **`6`** | `glyph_6.svg` | `glyph_6_aligned.svg` | `276.00 × 395.00` | 工业模板切缝体，跑道形椭圆 + 顶部切口 |
| **`7`** | `glyph_7.svg` | `glyph_7_aligned.svg` | `286.85 × 395.00` | 工业模板切缝体，顶横 + 亚像素平滑斜干 (D7500.png) |
| **`8`** | `glyph_8.svg` | `glyph_8_aligned.svg` | `279.37 × 395.00` | 工业模板切缝体，双对称孔洞垂直切缝 (D850.png) |
| **`9`** | `glyph_9.svg` | `glyph_9_aligned.svg` | `290.38 × 395.00` | 工业模板切缝体，顶部闭环 + 下开口弧 (D90.png) |
| **`2_outline`** | `glyph_2_outline.svg` | `glyph_2_outline_aligned.svg` | `250.62 × 395.00` | 旗舰双线空心体 (D2H.png) |
| **`3_outline`** | `glyph_3_outline.svg` | `glyph_3_outline_aligned.svg` | `295.33 × 395.00` | 旗舰双线空心体 (D3X.png) |
| **`4_outline`** | `glyph_4_outline.svg` | `glyph_4_outline_aligned.svg` | `331.68 × 395.00` | 旗舰双线空心体 (D4.png) |
| **`5_outline`** | `glyph_5_outline.svg` | `glyph_5_outline_aligned.svg` | `287.36 × 395.00` | 旗舰双线空心体 (D5.png) |
| **`6_outline`** | `glyph_6_outline.svg` | `glyph_6_outline_aligned.svg` | `287.73 × 395.00` | 旗舰双线空心体 (D6.png) |
| **`H`** | `glyph_H.svg` | `glyph_H_aligned.svg` | `304.21 × 316.32` | 旗舰 80% 双线空心小大写后缀 (D2H.png) |
| **`X`** | `glyph_X.svg` | `glyph_X_aligned.svg` | `294.63 × 315.12` | 旗舰 80% 双线空心小大写后缀 (D3X.png) |
| **`f`** | `glyph_f.svg` | `glyph_f_aligned.svg` | `262.84 × 325.25` | 复古单反斜体手写衬线字母 (Df.png) |
| **`s`** | `glyph_s.svg` | `glyph_s_aligned.svg` | `143.20 × 243.70` | 旗舰 62% 小写字母后缀 (D2Xs.png / D4s) |
| **`A`** | `glyph_A.svg` | `glyph_A_aligned.svg` | `261.31 × 284.10` | 天体摄影版专用实心大写后缀 (D810A.png) |
| **`E`** | `glyph_E.svg` | `glyph_E_aligned.svg` | `175.80 × 299.90` | 去低通滤镜特别版实心大写后缀 (D800E.png) |

---

### 4.2 Z 系列微单字形库 (`z_glyphs/`)

| 字形 Key | 紧凑版 SVG | 基线对齐版 SVG | 尺寸规格 (W×H) | 比例与特征说明 |
| :--- | :--- | :--- | :--- | :--- |
| **`Z`** | `glyph_Z.svg` | `glyph_Z_aligned.svg` | `468.00 × 395.70` | 100% 大字高双线黑板体 ℤ 品牌标 |
| **`f` / `F`** | `glyph_f.svg` | `glyph_f_aligned.svg` | `274.60 × 339.30` | 复古斜体衬线字母，含 89px 下降部 (Zfc.png) |
| **`c`** | `glyph_c.svg` | `glyph_c_aligned.svg` | `169.70 × 185.20` | 复古斜体衬线字母，42% x-height 高度 (Zfc.png) |
| **`0`** | `glyph_0.svg` | `glyph_0_aligned.svg` | `179.30 × 272.90` | 69% 现代无衬线实心跑道形数字 (Z50.png) |
| **`3`** | `glyph_3.svg` | `glyph_3_aligned.svg` | `164.50 × 272.40` | 69% 现代无衬线实心平顶圆弧数字 (Z30.png) |
| **`5`** | `glyph_5.svg` | `glyph_5_aligned.svg` | `157.20 × 268.30` | 68% 现代无衬线实心折笔数字 (Z50.png) |
| **`6`** | `glyph_6.svg` | `glyph_6_aligned.svg` | `186.10 × 291.90` | 74% 现代无衬线实心闭环数字 (Z6III.png) |
| **`7`** | `glyph_7.svg` | `glyph_7_aligned.svg` | `166.60 × 264.00` | 67% 现代无衬线实心斜干数字 (Z7II.png) |
| **`8`** | `glyph_8.svg` | `glyph_8_aligned.svg` | `194.20 × 292.60` | 74% 现代无衬线实心双闭环数字 (Z8.png) |
| **`9`** | `glyph_9.svg` | `glyph_9_aligned.svg` | `173.40 × 273.10` | 69% 现代无衬线实心闭环数字 (Z9.png) |
| **`II`** | `glyph_II.svg` | `glyph_II_aligned.svg` | `166.60 × 211.60` | 53% 罗马数字衬线世代标 (Z7II.png) |
| **`III`** | `glyph_III.svg` | `glyph_III_aligned.svg` | `243.70 × 233.70` | 59% 罗马数字衬线世代标 (Z6III.png) |
| **`R`** | `glyph_R.svg` | `glyph_R_aligned.svg` | `199.50 × 281.40` | 71% 现代无衬线大写字母 (ZR.png) |

---

## 五、 算法与图像处理核心技术

1. **亚像素等值线轮廓提取（Subpixel Marching Squares）**
2. **道格拉斯-普克（RDP）折线化简（容差 $\epsilon = 0.5\text{ px}$）**
3. **亚像素高阶多项式曲率拟合（Polynomial Spline Curve Fitting）**
4. **平行双线线性回归与几何解析**
5. **分层嵌套轮廓拓扑分析（Hierarchical Counter Extraction）**

---

## 六、 统一 CLI 排版工具使用指南 (`nikon_typography.py`)

### 1. 官方合法机型生成（默认严格校验）

```bash
# 生成官方认证 D 系列单反
python3 nikon_typography.py -c "D850"  -o D850.svg
python3 nikon_typography.py -c "D6"    -o D6.svg
python3 nikon_typography.py -c "D810A" -o D810A.svg
python3 nikon_typography.py -c "D800E" -o D800E.svg
python3 nikon_typography.py -c "D2Xs"  -o D2Xs.svg
python3 nikon_typography.py -c "Df"    -o Df.svg

# 生成官方认证 Z 系列微单
python3 nikon_typography.py -c "Z5II"  -o Z5II.svg
python3 nikon_typography.py -c "Zf"    -o Zf.svg
python3 nikon_typography.py -c "Zfc"   -o Zfc.svg
python3 nikon_typography.py -c "Z6III" -o Z6III.svg
python3 nikon_typography.py -c "Z7II"  -o Z7II.svg
```

### 2. 官方机型清单与在线同步

```bash
# 查看所有官方收录合法型号
python3 nikon_typography.py --list-official

# 在线同步官方下载中心最新数据
python3 nikon_typography.py --sync-official
```

### 3. 非法型号拦截测试

```bash
# 输入非官方虚构型号（将被系统拒绝并给出相近官方推荐）
python3 nikon_typography.py -c "D9999"
# 输出: ❌ [Nikon 官方下载中心规范拒绝]: 'D9999' 不是 Nikon 官方合法相机型号！

# 强制生成自定义非官方测试型号（需添加 --allow-custom）
python3 nikon_typography.py -c "D9999" --allow-custom -o custom_test.svg
```

---

## 七、 预置生成型号 SVG 清单

| 系统 | 型号 SVG 文件 | 尺寸 (W×H) | 核心设计特征 |
| :--- | :--- | :--- | :--- |
| **Z 微单** | [`Z5II.svg`](Z5II.svg) | `928.78 × 440.00` | 双线 ℤ + 无衬线 `5` + 罗马数字 `II` |
| **Z 微单** | [`Zf.svg`](Zf.svg) | `869.80 × 529.07` | 双线 ℤ + 复古斜体 `f`（含 89px Descender） |
| **Z 微单** | [`Zfc.svg`](Zfc.svg) | `1038.90 × 529.07` | 双线 ℤ + 复古斜体 `fc` 连笔 |
| **Z 微单** | [`Z6III.svg`](Z6III.svg) | `843.70 × 440.00` | 双线 ℤ + 无衬线 `6` + 罗马数字 `III` |
| **Z 微单** | [`Z7II.svg`](Z7II.svg) | `746.60 × 440.00` | 双线 ℤ + 无衬线 `7` + 罗马数字 `II` |
| **Z 微单** | [`Z9.svg`](Z9.svg) | `822.28 × 435.00` | 双线 ℤ + 旗舰无衬线 `9` |
| **Z 微单** | [`Z8.svg`](Z8.svg) | `843.08 × 435.00` | 双线 ℤ + 旗舰无衬线 `8` |
| **Z 微单** | [`Z50.svg`](Z50.svg) | `903.00 × 435.00` | 双线 ℤ + 无衬线 `50` |
| **D 单反** | [`Df.svg`](Df.svg) | `603.84 × 495.20` | 空心 D + 复古斜体衬线 `f` |
| **D 单反** | [`D810A.svg`](D810A.svg) | `1440.28 × 435.00` | 空心 D + 模板切缝 `810` + 天体摄影后缀 `A` |
| **D 单反** | [`D800E.svg`](D800E.svg) | `1498.77 × 435.00` | 空心 D + 模板切缝 `800` + 特别版后缀 `E` |
| **D 单反** | [`D2Xs.svg`](D2Xs.svg) | `1149.63 × 435.00` | 空心 D + 旗舰空心 `2` + 旗舰 `X` + 旗舰小写 `s` |
| **D 单反** | [`D6.svg`](D6.svg) | `724.17 × 435.00` | 空心 D + 旗舰空心双线 `6` |
| **D 单反** | [`D5.svg`](D5.svg) | `674.86 × 435.00` | 空心 D + 旗舰空心双线 `5` |
| **D 单反** | [`D4.svg`](D4.svg) | `719.18 × 435.00` | 空心 D + 旗舰空心双线 `4` |
| **D 单反** | [`D3X.svg`](D3X.svg) | `981.93 × 435.00` | 空心 D + 旗舰空心 `3` + 旗舰后缀 `X` |
| **D 单反** | [`D2H.svg`](D2H.svg) | `942.33 × 435.00` | 空心 D + 旗舰空心 `2` + 旗舰后缀 `H` |
| **D 单反** | [`D850.svg`](D850.svg) | `1273.86 × 435.00` | 空心 D + 模板切缝 `850` |
| **D 单反** | [`D7500.svg`](D7500.svg) | `1608.85 × 435.00` | 空心 D + 模板切缝 `7500` |
| **D 单反** | [`D40.svg`](D40.svg) | `741.80 × 435.00` | 空心 D + 模板切缝 `40` |
| **品牌标** | [`blackboard_z.svg`](blackboard_z.svg) | `817.00 × 699.00` | 原始高精度 Blackboard Bold ℤ |
