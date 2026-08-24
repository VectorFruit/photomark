#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Nikon 全世代相机视觉排版与矢量化系统 (统一整合版 + 官方合法型号鉴权)
Nikon Dual-System Typography & Vectorization Engine (Unified Edition with Official Whitelist)

数据源：Nikon 官方下载中心 (https://downloadcenter.nikonimglib.com/zh-cn/index.html)
核心规则：严格基于官方发布的数码单反照相机 (D系列) 与 微单数码照相机 (Z系列) 白名单，非法/虚构型号默认拒绝生成。

整合支持两大独立设计规范：
1. Nikon D 系列单反排版系统 (DSLR / F-Mount)：
   - 品牌大写 'D' (双线空心衬线)
   - 0~9 专属工业模板切缝体 (D850, D7500, D40 等)
   - 2~6 旗舰专属双线空心体 (D1~D6)
   - 'H', 'X', 's' 旗舰后缀 (D2H, D3X, D2Xs, D4s)
   - 'A', 'E' 特殊版本后缀 (D810A 天体摄影, D800E 去低通滤镜)
   - 'f' 复古单反手写斜体衬线字母 (Df)
   - 存放于 d_glyphs/

2. Nikon Z 系列微单排版系统 (Mirrorless / Z-Mount)：
   - 核心品牌标 'Z' (双线黑板体 ℤ)
   - 现代几何无衬线数字 0, 3, 5, 6, 7, 8, 9 (约 70% 字高比)
   - 罗马数字世代标 'II', 'III' (约 55%~59% 字高比)
   - 现代无衬线字母 'R' (源自 ZR.png)
   - 复古斜体手写衬线字母 'f' / 'F' (含 89px 下降部), 'c' (组合为 Z f / Z fc)
   - 存放于 z_glyphs/
"""

import os
import sys
import re
import json
import difflib
import argparse
import urllib.request
from typing import Dict, List, Tuple, Optional, Any, Set
import xml.etree.ElementTree as ET

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image


# ==============================================================================
# 1. 核心图像处理与几何算法
# ==============================================================================

def rdp_2d(points: np.ndarray, epsilon: float = 0.5) -> np.ndarray:
    """Ramer-Douglas-Peucker (RDP) 折线化简算法 (保证亚像素级几何保真度)"""
    if len(points) < 3:
        return points
    start, end = points[0], points[-1]
    vec = end - start
    vec_len = np.hypot(vec[0], vec[1])
    if vec_len == 0:
        dists = np.hypot(points[:, 0] - start[0], points[:, 1] - start[1])
    else:
        dists = np.abs(vec[0] * (points[:, 1] - start[1]) - vec[1] * (points[:, 0] - start[0])) / vec_len
    max_idx = int(np.argmax(dists))
    if dists[max_idx] > epsilon:
        left = rdp_2d(points[:max_idx + 1], epsilon)
        right = rdp_2d(points[max_idx:], epsilon)
        return np.vstack((left[:-1], right))
    else:
        return np.vstack((start, end))


# ==============================================================================
# 2. 官方合法型号数据库管理器 (Nikon Download Center Sync)
# ==============================================================================

class NikonOfficialCatalog:
    """Nikon 官方下载中心合法相机型号库"""

    XML_URL = "https://downloadcenter.nikonimglib.com/zh-cn/1/product_data.xml"
    CACHE_FILE = "nikon_official_models.json"

    # 内置官方基准型号（涵盖历史所有 D 系列与 Z 系列数码相机）
    BUILTIN_D_SERIES = [
        "D1", "D1H", "D1X", "D2H", "D2Hs", "D2X", "D2Xs", "D3", "D3S", "D3X",
        "D4", "D4S", "D5", "D6", "D40", "D40X", "D50", "D60", "D70", "D70s",
        "D80", "D90", "D100", "D200", "D300", "D300S", "D500", "D600", "D610",
        "D700", "D750", "D780", "D800", "D800E", "D810", "D810A", "D850", "Df",
        "D3000", "D3100", "D3200", "D3300", "D3400", "D3500",
        "D5000", "D5100", "D5200", "D5300", "D5500", "D5600",
        "D7000", "D7100", "D7200", "D7500"
    ]

    BUILTIN_Z_SERIES = [
        "Z 30", "Z 5", "Z 50", "Z 6", "Z 6II", "Z 7", "Z 7II", "Z 8", "Z 9",
        "Z f", "Z fc", "Z50II", "Z5II", "Z6III", "ZR"
    ]

    def __init__(self):
        self.d_models: Set[str] = set()
        self.z_models: Set[str] = set()
        self.normalized_map: Dict[str, str] = {}  # normalized_key -> official_display_name
        self.load_models()

    def load_models(self):
        """加载官方型号库（优先读取本地 JSON 缓存，否则使用内置基准）"""
        if os.path.exists(self.CACHE_FILE):
            try:
                with open(self.CACHE_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    d_list = data.get("d_series_dslr", [])
                    z_list = data.get("z_series_mirrorless", [])
                    self._register_models(d_list, z_list)
                    return
            except Exception:
                pass

        self._register_models(self.BUILTIN_D_SERIES, self.BUILTIN_Z_SERIES)

    def _register_models(self, d_list: List[str], z_list: List[str]):
        self.d_models = set(d_list)
        # 微单只保留 Z 系列机型
        self.z_models = set([m for m in z_list if m.startswith("Z") or m.startswith("z") or m == "ZR"])
        self.normalized_map.clear()

        for m in self.d_models:
            norm = self.normalize_key(m)
            self.normalized_map[norm] = m

        for m in self.z_models:
            norm = self.normalize_key(m)
            self.normalized_map[norm] = m

    @staticmethod
    def normalize_key(text: str) -> str:
        """格式标准化：去除空格、下划线并转换为全小写以便宽容度匹配"""
        return text.replace(" ", "").replace("_", "").replace("-", "").lower()

    def sync_from_official_web(self) -> Tuple[int, int]:
        """从 Nikon 官方下载中心 XML 同步最新合法型号数据 (微单仅保留 Z 系列)"""
        req = urllib.request.Request(self.XML_URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            content = resp.read()
            root = ET.fromstring(content)

        d_series = []
        z_series = []

        for cat in root.findall(".//category"):
            cname = cat.attrib.get("name")
            if cname == "数码单镜反光照相机":
                for prod in cat.findall(".//product"):
                    d_series.append(prod.attrib.get("name"))
            elif cname in ["微型单电相机", "电影摄影机"]:
                for prod in cat.findall(".//product"):
                    pname = prod.attrib.get("name")
                    if pname.startswith("Z") or pname == "ZR":
                        z_series.append(pname)

        # 合并历史内置型号（确保 D1/D100 等早期经典单反不因官方下载中心归档而丢失）
        full_d = sorted(list(set(d_series + self.BUILTIN_D_SERIES)))
        full_z = sorted(list(set(z_series + self.BUILTIN_Z_SERIES)))

        data = {
            "source": "https://downloadcenter.nikonimglib.com/zh-cn/index.html",
            "last_updated": "2026-08-24",
            "d_series_dslr": full_d,
            "z_series_mirrorless": full_z
        }

        with open(self.CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        self._register_models(full_d, full_z)
        return len(full_d), len(full_z)

    def validate(self, input_text: str) -> Tuple[bool, Optional[str], Optional[str], List[str]]:
        """
        校验输入型号是否合法：
        返回: (is_valid, official_name, system_type, suggestions)
        """
        norm_input = self.normalize_key(input_text)
        if norm_input in self.normalized_map:
            official_name = self.normalized_map[norm_input]
            system_type = "z" if norm_input.startswith("z") else "d"
            return True, official_name, system_type, []

        # 查找最相似的官方合法型号推荐
        all_norm_keys = list(self.normalized_map.keys())
        close_matches = difflib.get_close_matches(norm_input, all_norm_keys, n=4, cutoff=0.4)
        suggestions = [self.normalized_map[k] for k in close_matches]
        return False, None, None, suggestions


# ==============================================================================
# 3. 统一字形库管理与渲染引擎
# ==============================================================================

class NikonTypographySystem:
    """Nikon 双系统统一字形管理与自由拼装排版器"""

    def __init__(self, d_glyphs_dir: str = "d_glyphs", z_glyphs_dir: str = "z_glyphs"):
        self.d_glyphs_dir = d_glyphs_dir
        self.z_glyphs_dir = z_glyphs_dir
        self.standard_cap_h = 395.0
        self.standard_view_h = 413.0
        self.standard_baseline_y = 403.0

        # 直接使用实体目录管理，完全不依赖软链接
        os.makedirs(self.d_glyphs_dir, exist_ok=True)
        os.makedirs(self.z_glyphs_dir, exist_ok=True)

        self.catalog = NikonOfficialCatalog()
        self.d_glyphs: Dict[str, Dict[str, Any]] = {}
        self.z_glyphs: Dict[str, Dict[str, Any]] = {}
        
        self.reload_all_glyphs()

    def reload_all_glyphs(self):
        """重新解析加载两大字形库"""
        self.d_glyphs = self._load_glyphs_from_dir(self.d_glyphs_dir)
        self.z_glyphs = self._load_glyphs_from_dir(self.z_glyphs_dir)

    def _load_glyphs_from_dir(self, directory: str) -> Dict[str, Dict[str, Any]]:
        result = {}
        if not os.path.exists(directory):
            return result
        for fname in sorted(os.listdir(directory)):
            if fname.startswith("glyph_") and not fname.endswith("_aligned.svg") and fname.endswith(".svg"):
                g_key = fname[len("glyph_"):-len(".svg")]
                svg_path = os.path.join(directory, fname)
                tree = ET.parse(svg_path)
                root = tree.getroot()
                vb = root.attrib.get("viewBox", "0 0 300 395").split()
                w, h = float(vb[2]), float(vb[3])
                path_elem = root.find(".//{http://www.w3.org/2000/svg}path")
                d_str = path_elem.attrib.get("d", "") if path_elem is not None else ""
                result[g_key] = {
                    "width": w,
                    "height": h,
                    "path_d": d_str
                }
        return result

    # --------------------------------------------------------------------------
    # 智能排版总入口 (带官方白名单鉴权校验)
    # --------------------------------------------------------------------------
    def compose(
        self,
        text: str,
        output_svg: Optional[str] = None,
        system: str = "auto",
        kerning: Optional[float] = None,
        fill_color: str = "#231f20",
        force_flagship: bool = False,
        allow_custom: bool = False
    ) -> str:
        clean_text = text.strip()

        # 1. 官方合法型号鉴权
        is_valid, official_name, detected_system, suggestions = self.catalog.validate(clean_text)
        if not is_valid and not allow_custom:
            sugg_str = "、".join(suggestions) if suggestions else "（无相近型号）"
            error_msg = (
                f"\n❌ [Nikon 官方下载中心规范拒绝]: '{clean_text}' 不是 Nikon 官方合法相机型号！\n"
                f"   • 官方认证源: https://downloadcenter.nikonimglib.com/zh-cn/index.html\n"
                f"   • 您是否想拼装以下官方型号: {sugg_str}\n"
                f"   • 提示: 若需强制生成非官方自定义/测试型号，请在命令后加上 '--allow-custom' 参数。"
            )
            raise ValueError(error_msg)

        # 2. 确定排版系统与机型名称
        if is_valid and official_name:
            target_name = official_name.replace(" ", "")
            target_system = detected_system if system == "auto" else system.lower()
        else:
            target_name = clean_text
            target_system = ("z" if clean_text.upper().startswith("Z") else "d") if system == "auto" else system.lower()

        # 3. 分流执行对应系统排版
        if target_system == "z":
            return self.compose_z(target_name, output_svg, fill_color)
        else:
            return self.compose_d(target_name, output_svg, kerning, fill_color, force_flagship)

    # --------------------------------------------------------------------------
    # D 系列单反排版引擎
    # --------------------------------------------------------------------------
    def compose_d(
        self,
        text: str,
        output_svg: Optional[str] = None,
        kerning: Optional[float] = None,
        fill_color: str = "#231f20",
        force_flagship: bool = False
    ) -> str:
        clean_text = text.strip()

        # 特殊复古单反：Nikon Df
        if clean_text.upper() in ["DF", "D_F"]:
            return self._compose_df(output_svg, fill_color)

        current_x = 0.0
        char_nodes = []
        pad_y = 20.0
        pad_x = 20.0
        default_kerning = 24.5 if kerning is None else kerning

        # 判断是否为个位数顶级旗舰机型 (D1~D6, D2H, D2Hs, D2X, D2Xs, D3, D3S, D3X, D4, D4S, D5, D6)
        # 仅当 D 之后只有一位数字 1~6 且后续无其他数字时，才判定为个位数旗舰 (如 D200, D300, D3000, D5600 均为普通数字机型)
        upper_text = clean_text.upper().replace(" ", "").replace("_", "").replace("-", "")
        is_flagship = force_flagship or bool(re.match(r"^D[1-6]([A-Z]*)$", upper_text))

        i = 0
        while i < len(clean_text):
            ch = clean_text[i]
            glyph_key = ch

            # 旗舰数字替换 (仅替换 D 之后的第一位数字，如 D2H 中的 2, D6 中的 6)
            if is_flagship and i == 1 and ch in ["2", "3", "4", "5", "6"]:
                if f"{ch}_flagship" in self.d_glyphs:
                    glyph_key = f"{ch}_flagship"
                elif f"{ch}_outline" in self.d_glyphs:
                    glyph_key = f"{ch}_outline"

            # 旗舰后缀 S 字母替换
            if is_flagship and i > 1 and ch.upper() == 'S':
                if "S_flagship" in self.d_glyphs:
                    glyph_key = "S_flagship"
                elif "s" in self.d_glyphs:
                    glyph_key = "s"

            # 大小写查找匹配
            if glyph_key not in self.d_glyphs:
                if ch.upper() in self.d_glyphs:
                    glyph_key = ch.upper()
                elif ch.lower() in self.d_glyphs:
                    glyph_key = ch.lower()
                else:
                    raise ValueError(
                        f"字符 '{ch}' 不在 D 系列字形库 ({self.d_glyphs_dir}/) 中！可用字形: {list(self.d_glyphs.keys())}"
                    )

            g_info = self.d_glyphs[glyph_key]
            w, h = g_info["width"], g_info["height"]
            path_d = g_info["path_d"]

            # 后缀小大写/小写字母 (H, X, s, A, E) 底部基线对齐
            offset_y = pad_y + (self.standard_cap_h - h)

            char_nodes.append(
                f'    <!-- Glyph: {glyph_key} (X={current_x:.1f}) -->\n'
                f'    <g id="d-glyph-{glyph_key}" transform="translate({current_x:.2f}, {offset_y:.2f})">\n'
                f'      <path d="{path_d}" />\n'
                f'    </g>'
            )

            current_x += w + default_kerning
            i += 1

        total_width = round(current_x - default_kerning, 2)
        total_height = round(self.standard_cap_h + pad_y * 2, 2)
        viewbox_w = round(total_width + pad_x * 2, 2)

        svg_content = f"""<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 {viewbox_w:.2f} {total_height:.2f}"
     width="{viewbox_w:.2f}" height="{total_height:.2f}">
  <!-- Nikon D-Series DSLR Model: "{clean_text}" | Total Width: {total_width:.2f} px -->
  <g id="nikon-{clean_text}" transform="translate({pad_x:.2f}, 0)" fill="{fill_color}" fill-rule="evenodd">
{chr(10).join(char_nodes)}
  </g>
</svg>"""

        if output_svg:
            with open(output_svg, "w", encoding="utf-8") as f:
                f.write(svg_content)

        return svg_content

    def _compose_df(self, output_svg: Optional[str], fill_color: str) -> str:
        """为 Nikon Df 专用复古衬线排版"""
        w_d, d_d = self.d_glyphs["D"]["width"], self.d_glyphs["D"]["path_d"]
        f_key = "f" if "f" in self.d_glyphs else "f_df"
        w_f, d_f = self.d_glyphs[f_key]["width"], self.d_glyphs[f_key]["path_d"]
        pad_x, pad_top = 25.0, 20.0
        y_base = pad_top + self.standard_cap_h  # 基线在 Y = 415.0 px

        pos_y_d = round(y_base - self.d_glyphs["D"]["height"], 2)
        pos_y_f = round(y_base - 265.05, 2)
        pos_x_f = round(w_d - 12.0, 2)
        total_w = round(pos_x_f + w_f, 2)
        total_h = round(y_base + 60.20 + 20.0, 2)  # 495.20
        view_w = round(total_w + pad_x * 2, 2)

        svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {view_w:.2f} {total_h:.2f}" width="{view_w:.2f}" height="{total_h:.2f}">
  <!-- Model: Nikon Df (Double-Struck Serif D + Cursive Italic f | Baseline Aligned at Y={y_base:.2f}px) -->
  <g id="nikon-Df" transform="translate({pad_x:.2f}, 0)" fill="{fill_color}" fill-rule="evenodd">
    <g id="glyph-D" transform="translate(0.00, {pos_y_d:.2f})"><path d="{d_d}" /></g>
    <g id="glyph-f" transform="translate({pos_x_f:.2f}, {pos_y_f:.2f})"><path d="{d_f}" /></g>
  </g>
</svg>"""
        if output_svg:
            with open(output_svg, "w", encoding="utf-8") as f:
                f.write(svg)
        return svg

    # --------------------------------------------------------------------------
    # Z 系列微单排版引擎
    # --------------------------------------------------------------------------
    def compose_z(
        self,
        text: str,
        output_svg: Optional[str] = None,
        fill_color: str = "#231f20"
    ) -> str:
        clean_text = text.strip()

        # 复古机型 Zf / Zfc 专用排版
        if clean_text.upper() in ["ZF", "Z_F"]:
            return self._compose_zf(output_svg, fill_color)
        if clean_text.upper() in ["ZFC", "Z_FC"]:
            return self._compose_zfc(output_svg, fill_color)

        # 现代无衬线型号 (Z9, Z8, Z7II, Z6III, Z5II, Z50, Z30, ZR)
        tokens = self._tokenize_z(clean_text)
        
        pad_x = 25.0
        pad_top = 20.0
        y_base = pad_top + self.standard_cap_h  # 基线在 Y = 415.0 px

        current_x = 0.0
        char_nodes = []

        for token in tokens:
            if token not in self.z_glyphs:
                raise ValueError(f"字符/符号 '{token}' 不在 Z 系列字形库 ({self.z_glyphs_dir}/) 中！可用字形: {list(self.z_glyphs.keys())}")

            g_info = self.z_glyphs[token]
            w, h = g_info["width"], g_info["height"]
            path_d = g_info["path_d"]

            if token == "Z":
                pos_y = round(y_base - self.standard_cap_h, 2)
                char_nodes.append(
                    f'    <!-- Glyph: Z (Width: {w:.2f}px) -->\n'
                    f'    <g id="z-glyph-Z" transform="translate({current_x:.2f}, {pos_y:.2f})">\n'
                    f'      <path d="{path_d}" />\n'
                    f'    </g>'
                )
                current_x += w + 60.0  # Z 与后续数字之间保持标准光学字距
            elif token in ["II", "III"]:
                pos_y = round(y_base - h, 2)
                current_x += 15.0  # 罗马数字与前置数字间距
                char_nodes.append(
                    f'    <!-- Generation: {token} (Width: {w:.2f}px) -->\n'
                    f'    <g id="z-generation-{token}" transform="translate({current_x:.2f}, {pos_y:.2f})">\n'
                    f'      <path d="{path_d}" />\n'
                    f'    </g>'
                )
                current_x += w
            else:
                # 现代无衬线数字与字母
                pos_y = round(y_base - h, 2)
                char_nodes.append(
                    f'    <!-- Numeral: {token} (Width: {w:.2f}px) -->\n'
                    f'    <g id="z-glyph-{token}" transform="translate({current_x:.2f}, {pos_y:.2f})">\n'
                    f'      <path d="{path_d}" />\n'
                    f'    </g>'
                )
                current_x += w + 12.0

        total_width = round(current_x - (12.0 if tokens[-1] not in ["Z", "II", "III"] else 0.0), 2)
        total_height = round(y_base + 25.0, 2)
        viewbox_w = round(total_width + pad_x * 2, 2)

        svg_content = f"""<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 {viewbox_w:.2f} {total_height:.2f}"
     width="{viewbox_w:.2f}" height="{total_height:.2f}">
  <!-- Nikon Z Mirrorless Model: "{clean_text}" | Baseline Aligned at Y={y_base:.2f}px -->
  <g id="nikon-{clean_text}" transform="translate({pad_x:.2f}, 0)" fill="{fill_color}" fill-rule="evenodd">
{chr(10).join(char_nodes)}
  </g>
</svg>"""

        if output_svg:
            with open(output_svg, "w", encoding="utf-8") as f:
                f.write(svg_content)

        return svg_content

    def _tokenize_z(self, text: str) -> List[str]:
        t = text.replace(" ", "").replace("_", "")
        tokens = []
        if t.startswith("Z") or t.startswith("z"):
            tokens.append("Z")
            t = t[1:]
        
        gen = ""
        if t.endswith("III") or t.endswith("iii"):
            gen = "III"
            t = t[:-3]
        elif t.endswith("II") or t.endswith("ii"):
            gen = "II"
            t = t[:-2]

        for char in t:
            tokens.append(char)

        if gen:
            tokens.append(gen)
        return tokens

    def _compose_zf(self, output_svg: Optional[str], fill_color: str) -> str:
        w_z, d_z = self.z_glyphs["Z"]["width"], self.z_glyphs["Z"]["path_d"]
        f_key = "F" if "F" in self.z_glyphs else "f"
        w_f, d_f = self.z_glyphs[f_key]["width"], self.z_glyphs[f_key]["path_d"]
        pad_x, pad_top = 25.0, 20.0
        y_base = pad_top + self.standard_cap_h
        pos_y_z = round(y_base - self.standard_cap_h, 2)
        pos_y_f = round(y_base - 249.13, 2)
        pos_x_f = round(w_z + 78.74, 2)
        total_w = round(pos_x_f + w_f, 2)
        total_h = round(y_base + 89.07 + 25.0, 2)
        view_w = round(total_w + pad_x * 2, 2)

        svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {view_w:.2f} {total_h:.2f}" width="{view_w:.2f}" height="{total_h:.2f}">
  <!-- Nikon Z f (Blackboard Bold ℤ + Italic Serif f | Baseline Aligned at Y={y_base:.2f}px) -->
  <g id="nikon-Z-f" transform="translate({pad_x:.2f}, 0)" fill="{fill_color}" fill-rule="evenodd">
    <g id="glyph-Z" transform="translate(0.00, {pos_y_z:.2f})"><path d="{d_z}" /></g>
    <g id="glyph-f" transform="translate({pos_x_f:.2f}, {pos_y_f:.2f})"><path d="{d_f}" /></g>
  </g>
</svg>"""
        if output_svg:
            with open(output_svg, "w", encoding="utf-8") as f:
                f.write(svg)
        return svg

    def _compose_zfc(self, output_svg: Optional[str], fill_color: str) -> str:
        w_z, d_z = self.z_glyphs["Z"]["width"], self.z_glyphs["Z"]["path_d"]
        f_key = "F" if "F" in self.z_glyphs else "f"
        w_f, d_f = self.z_glyphs[f_key]["width"], self.z_glyphs[f_key]["path_d"]
        w_c, d_c = self.z_glyphs["c"]["width"], self.z_glyphs["c"]["path_d"]
        pad_x, pad_top = 25.0, 20.0
        y_base = pad_top + self.standard_cap_h
        pos_y_z = round(y_base - self.standard_cap_h, 2)
        pos_y_f = round(y_base - 249.13, 2)
        pos_y_c = round(y_base - 166.52, 2)
        pos_x_f = round(w_z + 78.74, 2)
        pos_x_c = round(pos_x_f + w_f, 2)
        total_w = round(pos_x_c + w_c, 2)
        total_h = round(y_base + 89.07 + 25.0, 2)
        view_w = round(total_w + pad_x * 2, 2)

        svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {view_w:.2f} {total_h:.2f}" width="{view_w:.2f}" height="{total_h:.2f}">
  <!-- Nikon Z fc (Blackboard Bold ℤ + Italic Serif fc | Baseline Aligned at Y={y_base:.2f}px) -->
  <g id="nikon-Z-fc" transform="translate({pad_x:.2f}, 0)" fill="{fill_color}" fill-rule="evenodd">
    <g id="glyph-Z" transform="translate(0.00, {pos_y_z:.2f})"><path d="{d_z}" /></g>
    <g id="glyph-f" transform="translate({pos_x_f:.2f}, {pos_y_f:.2f})"><path d="{d_f}" /></g>
    <g id="glyph-c" transform="translate({pos_x_c:.2f}, {pos_y_c:.2f})"><path d="{d_c}" /></g>
  </g>
</svg>"""
        if output_svg:
            with open(output_svg, "w", encoding="utf-8") as f:
                f.write(svg)
        return svg


# ==============================================================================
# 4. CLI 主函数
# ==============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Nikon 全世代相机视觉排版与矢量化系统 (带 Nikon 官方下载中心合法型号鉴权)"
    )
    parser.add_argument("-c", "--compose", type=str, default=None, help="拼装相机型号 (如: D850, D6, D5, D2Xs, D810A, D800E, Df, Z5II, Zf, Zfc, Z6III, Z9)")
    parser.add_argument("-o", "--output", type=str, default=None, help="输出 SVG 文件路径")
    parser.add_argument("-s", "--system", choices=["auto", "d", "z"], default="auto", help="强制指定排版系统 (默认: auto 智能自动识别)")
    parser.add_argument("-k", "--kerning", type=float, default=None, help="自定义字间距 (px)")
    parser.add_argument("--color", type=str, default="#231f20", help="SVG 填充颜色 (默认: #231f20)")
    parser.add_argument("--flagship", action="store_true", help="D 系列强制使用个位数旗舰机双线空心数字")
    parser.add_argument("--allow-custom", action="store_true", help="强制允许生成非官方未收录的自定义型号")
    parser.add_argument("--list-official", action="store_true", help="列出 Nikon 官方下载中心收录的所有合法机型清单")
    parser.add_argument("--sync-official", action="store_true", help="在线同步 Nikon 官方下载中心最新型号数据库")
    parser.add_argument("--d-dir", type=str, default="d_glyphs", help="D 系列字形实体目录 (默认: d_glyphs/)")
    parser.add_argument("--z-dir", type=str, default="z_glyphs", help="Z 系列字形实体目录 (默认: z_glyphs/)")

    args = parser.parse_args()

    engine = NikonTypographySystem(d_glyphs_dir=args.d_dir, z_glyphs_dir=args.z_dir)

    # 1. 在线同步功能
    if args.sync_official:
        print("⏳ 正在从 Nikon 官方下载中心同步最新型号列表...")
        num_d, num_z = engine.catalog.sync_from_official_web()
        print(f"✓ 同步完成！已更新 {num_d} 款 D 系列单反型号与 {num_z} 款 Z 系列微单型号。")
        return

    # 2. 列出官方合法清单
    if args.list_official:
        print("=" * 75)
        print("📷 Nikon 官方合法相机型号全清单 (来源: Nikon 官方下载中心):")
        print(f"\n【D 系列单反照相机 (共 {len(engine.catalog.d_models)} 款)】:")
        d_sorted = sorted(list(engine.catalog.d_models))
        for idx in range(0, len(d_sorted), 8):
            print("  " + "  ".join(f"{m:<8}" for m in d_sorted[idx:idx+8]))

        print(f"\n【Z 系列微单照相机 (共 {len(engine.catalog.z_models)} 款)】:")
        z_sorted = sorted(list(engine.catalog.z_models))
        for idx in range(0, len(z_sorted), 6):
            print("  " + "  ".join(f"{m:<10}" for m in z_sorted[idx:idx+6]))
        print("=" * 75)
        return

    # 3. 拼装生成型号
    if args.compose:
        out_name = args.output if args.output else f"{args.compose.replace(' ', '')}.svg"
        try:
            engine.compose(
                text=args.compose,
                output_svg=out_name,
                system=args.system,
                kerning=args.kerning,
                fill_color=args.color,
                force_flagship=args.flagship,
                allow_custom=args.allow_custom
            )
            print(f"✓ 校验通过，成功排版生成官方认证机型矢量 SVG: {out_name}")
        except ValueError as e:
            print(e)
            sys.exit(1)
    else:
        print("=" * 75)
        print(f"✓ Nikon 官方认证排版系统已就绪:")
        print(f"   • D 系列官方机型库: 共 {len(engine.catalog.d_models)} 款 | 本地字形库 [{args.d_dir}/]: 共 {len(engine.d_glyphs)} 款字形")
        print(f"   • Z 系列官方机型库: 共 {len(engine.catalog.z_models)} 款 | 本地字形库 [{args.z_dir}/]: 共 {len(engine.z_glyphs)} 款字形")
        print("=" * 75)
        print("💡 使用方式示例:")
        print("   python3 nikon_typography.py -c D850     # 拼装官方合法 D 系列型号")
        print("   python3 nikon_typography.py -c Z5II     # 拼装官方合法 Z 系列型号")
        print("   python3 nikon_typography.py --list-official   # 查看所有官方收录合法型号")


if __name__ == "__main__":
    main()
