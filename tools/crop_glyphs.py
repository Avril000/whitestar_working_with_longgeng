"""页图 → 自动切字（列投影 + 连通域混合法）

针对《多宝塔碑》这类拓本页图的特点做了四件事：
    1. 剔除朱红印章（红像素不算前景，否则印章会把几列字粘成一团）
    2. Otsu 自适应二值化（拓本墨色斑驳，固定阈值不行）
    3. 竖排切分：先按 x 投影切出"列"，再在每列内用连通域分析找"字"
       （连通域按笔画块找字，能分开间距小但笔画不相连的字，
        解决小字夹注「其七」「天同」这类投影谷太浅导致的粘连）
    4. 输出两种图：crop/ 原样裁切（保留拓本质感，界面展示用）
                   bin/  反相二值（白底黑字，后续算相似度用）

用法：
    python tools/crop_glyphs.py data/processed/01.png
    python tools/crop_glyphs.py data/processed/01.png -o data/processed/glyphs/01

输出：
    <输出目录>/crop/页名_rC列_序号.png   原样裁切
    <输出目录>/bin/页名_rC列_序号.png   二值反相
    <输出目录>/meta_页名.json           每个字的坐标与元信息
    <输出目录>/debug_页名.png           分割线叠加图（调参用，确认无误后可删）

注意：meta 里只有坐标与文件名，**不填字是什么**。
      字的识别走「AI 初判 → 人工复核」流程，见 tools/ai_first_guess.py。
"""

import argparse
import json
import statistics
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage
from PIL import Image, ImageDraw


def otsu_threshold(gray: np.ndarray) -> int:
    """大津法：自动找前景/背景分界阈值"""
    hist, _ = np.histogram(gray, bins=256, range=(0, 256))
    total = gray.size
    sum_all = np.dot(np.arange(256), hist)
    sum_b, w_b, best, thr = 0.0, 0, 0.0, 128
    for t in range(256):
        w_b += hist[t]
        if w_b == 0:
            continue
        w_f = total - w_b
        if w_f == 0:
            break
        sum_b += t * hist[t]
        m_b = sum_b / w_b
        m_f = (sum_all - sum_b) / w_f
        var_between = w_b * w_f * (m_b - m_f) ** 2
        if var_between > best:
            best, thr = var_between, t
    return thr


def strip_red(img: np.ndarray) -> np.ndarray:
    """把朱红印章像素压成黑（背景）。拓本白字才要，黑底图上印章是红字"""
    r = img[:, :, 0].astype(np.int16)
    g = img[:, :, 1].astype(np.int16)
    b = img[:, :, 2].astype(np.int16)
    red = (r > 100) & (r > g * 1.2) & (r > b * 1.2)
    out = img.copy()
    out[red] = 0
    return out


def smooth(a: np.ndarray, k: int = 5) -> np.ndarray:
    """一维移动平均平滑"""
    if k <= 1:
        return a
    pad = np.pad(a, (k // 2, k // 2), mode="edge")
    kernel = np.ones(k) / k
    return np.convolve(pad, kernel, mode="valid")


def runs_from_mask(mask: np.ndarray, min_len: int):
    """把布尔序列里连续为 True 的段找出来，太短的丢掉"""
    runs, start = [], None
    for i, v in enumerate(mask):
        if v and start is None:
            start = i
        elif not v and start is not None:
            runs.append((start, i))
            start = None
    if start is not None:
        runs.append((start, len(mask)))
    return [(a, b) for a, b in runs if b - a >= min_len]


def find_columns(fg: np.ndarray, min_col_width: int, ratio: float):
    """按 x 方向投影切列。拓本竖排：一列就是一行字"""
    proj = smooth(fg.sum(axis=0).astype(float), 7)
    peak = proj.max()
    if peak <= 0:
        return []
    mask = proj > ratio * peak
    return runs_from_mask(mask, min_col_width)


def find_glyphs_in_column(fg: np.ndarray, col: tuple, min_area: int):
    """列内找字：连通域分析法。

    相比投影法，连通域按「笔画块」找字，能分开间距小但笔画不相连的字
    （比如小字夹注「其七」「天同」这类投影谷太浅导致粘连的情况）。
    """
    x0, x1 = col
    sub = fg[:, x0:x1]
    labeled, n = ndimage.label(sub)
    boxes = []
    for i, sl in enumerate(ndimage.find_objects(labeled)):
        if sl is None:
            continue
        area = int((labeled[sl] == i + 1).sum())
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if area < min_area or h < 16 or w < 10:
            continue
        boxes.append((sl[0].start, sl[0].stop))
    boxes.sort()
    return boxes


def estimate_min_area(fg: np.ndarray) -> int:
    """自适应最小面积：以全图连通域面积为参考，过滤斑驳噪点"""
    labeled, n = ndimage.label(fg)
    if n == 0:
        return 300
    sizes = np.bincount(labeled.ravel())[1:]
    real = sizes[sizes > 300]  # 字的面积通常远大于斑驳点
    if len(real) == 0:
        return 400
    return int(max(300, np.median(real) * 0.22))


def pad_box(y0, y1, x0, x1, img_h, img_w, pad_ratio=0.06):
    """外扩一点，避免切掉笔画边缘"""
    h, w = y1 - y0, x1 - x0
    py, px = int(h * pad_ratio), int(w * pad_ratio)
    return (max(0, y0 - py), min(img_h, y1 + py), max(0, x0 - px), min(img_w, x1 + px))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("-o", "--out", default=None)
    ap.add_argument("--col-ratio", type=float, default=0.08,
                    help="列投影阈值（占最大投影比例），字粘连成一片就调大")
    ap.add_argument("--min-col", type=int, default=28, help="最小列宽（像素）")
    ap.add_argument("--min-area", type=int, default=0,
                    help="最小字块面积（像素）。默认 0 = 按全图自适应估计")
    args = ap.parse_args()

    img_path = Path(args.image)
    if not img_path.exists():
        print(f"找不到图片：{img_path}")
        sys.exit(1)

    out_dir = Path(args.out) if args.out else img_path.parent / ("glyphs_" + img_path.stem)
    crop_dir = out_dir / "crop"
    bin_dir = out_dir / "bin"
    crop_dir.mkdir(parents=True, exist_ok=True)
    bin_dir.mkdir(parents=True, exist_ok=True)

    img = np.asarray(Image.open(img_path).convert("RGB")).copy()
    img = strip_red(img)
    gray = img.mean(axis=2)

    thr = otsu_threshold(gray.astype(np.uint8))
    # 拓本：白字黑底 → 灰度高于阈值的是字
    fg = gray > thr
    print(f"Otsu 阈值 = {thr}，前景占比 {fg.mean() * 100:.1f}%")

    img_h, img_w = fg.shape
    cols = find_columns(fg, args.min_col, args.col_ratio)
    print(f"检出 {len(cols)} 列（从右往左编号 r1, r2, ...）")

    min_area = args.min_area if args.min_area > 0 else estimate_min_area(fg)
    print(f"最小字块面积 = {min_area} 像素{'（自适应）' if args.min_area == 0 else ''}")

    # 第一遍：先把所有框收集起来，用中位数判断哪些块可疑
    boxes = []
    base = img_path.stem
    for col_idx, (cx0, cx1) in enumerate(reversed(cols)):  # 竖排从右往左读
        glyphs = find_glyphs_in_column(fg, (cx0, cx1), min_area)
        for gi, (gy0, gy1) in enumerate(glyphs):
            y0, y1, x0, x1 = pad_box(gy0, gy1, cx0, cx1, img_h, img_w)
            boxes.append((col_idx + 1, gi + 1, int(y0), int(y1), int(x0), int(x1)))

    med_h = statistics.median([b[3] - b[2] for b in boxes]) if boxes else 0
    med_w = statistics.median([b[5] - b[4] for b in boxes]) if boxes else 0

    # 第二遍：出图，并给可疑块自动写提示（人工核对时的抓手）
    records = []
    warned = 0
    for col, gi, y0, y1, x0, x1 in boxes:
        name = f"{base}_r{col}_g{gi:02d}"
        h, w = y1 - y0, x1 - x0

        Image.fromarray(img[y0:y1, x0:x1]).save(crop_dir / f"{name}.png")
        bin_img = (fg[y0:y1, x0:x1] ^ True).astype(np.uint8) * 255  # 反相：白底黑字
        Image.fromarray(bin_img).save(bin_dir / f"{name}.png")

        notes = []
        if med_h and h < med_h * 0.55:
            notes.append("疑似过小，可能是残笔或噪点")
        if med_h and h > med_h * 1.6:
            notes.append("疑似粘连了两个字")
        if med_w and w > med_w * 1.5:
            notes.append("异常偏宽，可能横跨两列")
        if notes:
            warned += 1

        records.append({
            "id": name,
            "char": "",               # 留空：走初判 + 人工复核
            "ai_guess": "",           # 初判建议，人工核完后誊进 char
            "page": img_path.name,
            "col_from_right": col,
            "index_in_col": gi,
            "bbox": [x0, y0, x1, y1],
            "nature": "原碑拓本",
            "verified": "未核对",
            "verified_by": "",
            "note": "；".join(notes),
        })

    meta_path = out_dir / f"meta_{base}.json"
    meta_path.write_text(
        json.dumps({"image": img_path.name, "threshold": int(thr), "glyphs": records},
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    # 调参用的叠加图：分割线画在原图上
    debug = Image.open(img_path).convert("RGB")
    d = ImageDraw.Draw(debug)
    for cx0, cx1 in cols:
        d.rectangle([cx0, 0, cx1 - 1, img_h - 1], outline=(0, 160, 255), width=2)
        for gy0, gy1 in find_glyphs_in_column(fg, (cx0, cx1), min_area):
            d.line([(cx0, gy0), (cx1, gy0)], fill=(255, 200, 0), width=2)
            d.line([(cx0, gy1), (cx1, gy1)], fill=(255, 120, 0), width=2)
    debug.save(out_dir / f"debug_{base}.png")

    print(f"切出 {len(records)} 个字块")
    print(f"输出目录：{out_dir}")
    print("请先看 debug_*.png 检查分割线，不合适就调 --col-ratio / --glyph-ratio 重跑")


if __name__ == "__main__":
    main()
