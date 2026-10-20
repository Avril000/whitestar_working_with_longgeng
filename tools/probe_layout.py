"""版面体检：把一张图的"文字怎么排的"用数字和 ASCII 图打印出来

为什么要有这个：
    切字参数对不对，取决于图上的字是怎么排的。
    竖排碑文（一长列一长列）和字帖网格（一格一字）需要完全不同的切法。
    这个工具不看图、只算数，把版面结构翻译成人能读的报告 + ASCII 缩略图，
    好让人不用打开图片也能判断该用什么参数。

用法：
    python tools/probe_layout.py data/processed/04.png
    python tools/probe_layout.py data/processed/04.png --rows 60 --cols 150
"""

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

RAMP = " .:-=+*#%@"


def otsu(gray):
    hist, _ = np.histogram(gray.ravel(), bins=256, range=(0, 256))
    total = hist.sum()
    w = np.cumsum(hist)
    b = np.cumsum(hist * np.arange(256))
    mt = b[-1] / total
    var = (mt * w - b) ** 2 / (w * (total - w) + 1e-9)
    return int(np.argmax(var))


def bands(mask, axis, min_gap=6, thr=0.004):
    """找沿某轴的"内容带"：把连续空白（占比 < thr 的行/列）当成分隔"""
    prof = mask.mean(axis=1 if axis == 0 else 0)  # axis=0 → 按行
    on = prof > thr
    out, start = [], None
    for i, v in enumerate(on):
        if v and start is None:
            start = i
        elif not v and start is not None:
            out.append((start, i - 1)); start = None
    if start is not None:
        out.append((start, len(on) - 1))
    if not out:
        return [], prof
    # 把间隔太近的带合并（同一个字被笔画断开）
    merged = [list(out[0])]
    for s, e in out[1:]:
        if s - merged[-1][1] < min_gap:
            merged[-1][1] = e
        else:
            merged.append([s, e])
    return [tuple(m) for m in merged], prof


def ascii_view(fg, rows=48, cols=140):
    h, w = fg.shape
    rh, rw = max(1, h // rows), max(1, w // cols)
    out = []
    for r in range(rows):
        y0, y1 = r * rh, min(h, (r + 1) * rh)
        if y0 >= h:
            break
        line = []
        for c in range(cols):
            x0, x1 = c * rw, min(w, (c + 1) * rw)
            if x0 >= w:
                break
            d = fg[y0:y1, x0:x1].mean()
            line.append(RAMP[min(len(RAMP) - 1, int(d * len(RAMP)))])
        out.append("".join(line))
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--rows", type=int, default=48)
    ap.add_argument("--cols", type=int, default=140)
    ap.add_argument("--no-ascii", action="store_true")
    args = ap.parse_args()

    p = Path(args.image)
    if not p.exists():
        print(f"找不到图片：{p}")
        sys.exit(1)

    img = np.asarray(Image.open(p).convert("RGB"))
    h, w, _ = img.shape
    gray = img.mean(axis=2)
    thr = otsu(gray.astype(np.uint8))
    fg = gray > thr

    # 红像素占比（网格线 / 印章常常是红的）
    r, g, b = img[:, :, 0], img[:, :, 1], img[:, :, 2]
    red = (r.astype(int) - (g.astype(int) + b.astype(int)) / 2) > 40
    print(f"图片：{p.name}   {w} x {h}")
    print(f"Otsu 阈值 = {thr}，前景（字）占比 {fg.mean() * 100:.2f}%")
    print(f"红色像素占比 {red.mean() * 100:.2f}%" +
          ("   ← 有红网格线或印章" if red.mean() > 0.01 else ""))

    rb, rowprof = bands(fg, 0)
    cb, colprof = bands(fg, 1)
    print(f"\n横向内容带 {len(rb)} 段，纵向内容带 {len(cb)} 段")

    def summarize(bs, name):
        if not bs:
            return
        sizes = [e - s + 1 for s, e in bs]
        gaps = [bs[i + 1][0] - bs[i][1] - 1 for i in range(len(bs) - 1)]
        print(f"  {name}：宽度 中位数 {int(np.median(sizes))} "
              f"最小 {min(sizes)} 最大 {max(sizes)}")
        if gaps:
            print(f"    间隔 中位数 {int(np.median(gaps))} 最小 {min(gaps)} 最大 {max(gaps)}")

    summarize(rb, "行")
    summarize(cb, "列")

    if not args.no_ascii:
        print(f"\n版面 ASCII 图（{args.rows} 行 x {args.cols} 列，"
              f"字符越密 = 笔画越多）：")
        print(ascii_view(fg, args.rows, args.cols))


if __name__ == "__main__":
    main()
