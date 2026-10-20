"""网格切字：专治「单字临摹」这类已经排好一格一字的字帖页

和 crop_glyphs.py 的区别：
    crop_glyphs.py 面向整幅碑文（竖排长列），靠列投影 + 连通域去猜字在哪。
    本脚本面向"字帖网格"——图上已经是 3 行 × 10 列、一格一个字，
    再让算法去猜就多此一举了，直接量出网格线、按格子切，又快又准。

网格怎么量出来的：
    这类图的格子之间是亮色分隔线（或空白），会贯穿整幅的高/宽。
    所以统计"每一列有多少亮像素"，几乎全亮的列就是竖分隔线；
    横线同理。线找到了，格子就是线与线之间。

用法：
    python tools/crop_grid.py data/processed/04.png
    python tools/crop_grid.py data/processed/04.png --rows 3 --cols 10   # 手动指定，跳过自动检测
    python tools/crop_grid.py data/processed/04.png --order col          # 竖排顺序（右列优先）
    python tools/crop_grid.py data/processed/04.png --start 1            # 本页第 1 个字是碑文第几字
    python tools/crop_grid.py data/processed/04.png --debug              # 打印检测到的网格线
"""

import argparse
import datetime as dt
import json
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image

try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass


def otsu(gray):
    hist, _ = np.histogram(gray.ravel(), bins=256, range=(0, 256))
    total = hist.sum()
    w = np.cumsum(hist)
    b = np.cumsum(hist * np.arange(256))
    mt = b[-1] / total
    return int(np.argmax((mt * w - b) ** 2 / (w * (total - w) + 1e-9)))


def find_lines(prof, frac=0.75, min_len=3):
    """找贯穿型的分隔线：该行/列上有 frac 以上的像素是亮的"""
    on = prof > frac
    lines, start = [], None
    for i, v in enumerate(on):
        if v and start is None:
            start = i
        elif not v and start is None:
            continue
        elif not v:
            if i - start >= min_len:
                lines.append((start + i - 1) // 2)
            start = None
    if start is not None and len(on) - start >= min_len:
        lines.append((start + len(on) - 1) // 2)
    return lines


def cells_from_lines(limits, size, edge=8):
    """把分隔线转换成格子区间 [(起, 止), ...]"""
    bounds = [0] + limits + [size]
    out = []
    for i in range(len(bounds) - 1):
        a, b = bounds[i], bounds[i + 1]
        if b - a < 40:      # 太窄的不是格子
            continue
        out.append((a + edge, b - edge))
    return out


def auto_grid(fg, debug=False):
    """自动量出网格：返回 (行区间列表, 列区间列表)"""
    h, w = fg.shape
    rowprof = fg.mean(axis=1)
    colprof = fg.mean(axis=0)

    vlines = find_lines(colprof)   # 竖线 → 沿 x
    hlines = find_lines(rowprof)   # 横线 → 沿 y

    if debug:
        print(f"  竖分隔线 {len(vlines)} 条，位置 {vlines[:20]}")
        print(f"  横分隔线 {len(hlines)} 条，位置 {hlines[:20]}")

    if len(vlines) >= 2 and len(hlines) >= 2:
        cols = cells_from_lines(vlines, w)
        rows = cells_from_lines(hlines, h)
        if len(cols) >= 2 and len(rows) >= 1:
            return rows, cols

    # 兜底：分隔线没量出来，就按"内容带"找（亮像素成团的地方）
    def bands(prof, thr=0.02, min_gap=8):
        on = prof > thr
        out, s = [], None
        for i, v in enumerate(on):
            if v and s is None:
                s = i
            elif not v and s is not None:
                out.append([s, i - 1]); s = None
        if s is not None:
            out.append([s, len(on) - 1])
        m = [list(out[0])] if out else []
        for s, e in out[1:]:
            if s - m[-1][1] < min_gap:
                m[-1][1] = e
            else:
                m.append([s, e])
        return [tuple(x) for x in m]

    return bands(rowprof), bands(colprof)


def drop_partial(bands, ratio=0.8):
    """丢掉残缺的首尾行/列

    滚动截图（以及网页本身的白边）经常让第一格或最后一格只截到一半，
    或者带一整条浏览器白边被误判成网格线。
    判据很简单：和中间的格子比，明显矮一截的就是残缺的，直接不要。
    """
    if len(bands) < 2:
        return bands, []
    sizes = [b - a for a, b in bands]
    med = float(np.median(sizes))
    keep, dropped = [], []
    for (a, b), s in zip(bands, sizes):
        (keep if s >= med * ratio else dropped).append((a, b))
    return keep, dropped


def strip_frame(sub, th=0.9, max_strip=0.45):
    """去掉格子边框：边框是"整行/整列几乎全亮"的线，从四边往里剥"""
    h, w = sub.shape
    y0, y1, x0, x1 = 0, h, 0, w
    ly, lx = int(h * max_strip), int(w * max_strip)
    rp = sub.mean(axis=1)
    while y1 - y0 > 20 and y0 < ly and rp[y0] > th:
        y0 += 1
    while y1 - y0 > 20 and (h - y1) < ly and rp[y1 - 1] > th:
        y1 -= 1
    cp = sub[y0:y1].mean(axis=0)
    while x1 - x0 > 20 and x0 < lx and cp[x0] > th:
        x0 += 1
    while x1 - x0 > 20 and (w - x1) < lx and cp[x1 - 1] > th:
        x1 -= 1
    return y0, y1, x0, x1


def trim_box(fg, y0, y1, x0, x1, min_fill=0.004):
    """在格子里先去边框、再收紧到字的实际外框；空格子返回 None"""
    sub = fg[y0:y1, x0:x1]
    if sub.size == 0:
        return None
    sy0, sy1, sx0, sx1 = strip_frame(sub)
    sub = sub[sy0:sy1, sx0:sx1]
    if sub.size == 0:
        return None
    rows = np.where(sub.any(axis=1))[0]
    cols = np.where(sub.any(axis=0))[0]
    if len(rows) == 0 or len(cols) == 0:
        return None
    fill = sub.mean()
    if fill < min_fill or fill > 0.92:
        return None          # 太空 or 整块都是亮（可能是分隔线残留）
    return (y0 + sy0 + rows[0], y0 + sy0 + rows[-1] + 1,
            x0 + sx0 + cols[0], x0 + sx0 + cols[-1] + 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("-o", "--out", default=None)
    ap.add_argument("--rows", type=int, default=0, help="手动指定行数（0=自动）")
    ap.add_argument("--cols", type=int, default=0, help="手动指定列数（0=自动）")
    ap.add_argument("--order", choices=["row", "col"], default="row",
                    help="阅读顺序：row=从左到右、从上到下；col=竖排（右列优先，列内从上到下）")
    ap.add_argument("--start", type=int, default=0,
                    help="本页第 1 个字对应碑文第几字（>0 时写进 meta 的 order_in_text）")
    ap.add_argument("--pad", type=float, default=0.04,
                    help="字的四周留白比例。别调大：留白会把刚去掉的格子边框又带回来")
    ap.add_argument("--debug", action="store_true")
    args = ap.parse_args()

    src = Path(args.image)
    if not src.exists():
        print(f"找不到图片：{src}")
        sys.exit(1)

    out_dir = Path(args.out) if args.out else src.parent / ("glyphs_" + src.stem)
    # 已有的结果先归档，绝不直接删
    if (out_dir / "crop").exists() and any((out_dir / "crop").glob("*.png")):
        stale = out_dir / "_stale" / dt.datetime.now().strftime("%Y%m%d-%H%M%S")
        stale.mkdir(parents=True, exist_ok=True)
        shutil.move(str(out_dir / "crop"), str(stale / "crop"))
        for mf in out_dir.glob("meta_*.json"):
            shutil.move(str(mf), str(stale / mf.name))
        print(f"  旧结果已归档到 {stale.name}/")

    crop_dir = out_dir / "crop"
    crop_dir.mkdir(parents=True, exist_ok=True)

    img = np.asarray(Image.open(src).convert("RGB"))
    H, W, _ = img.shape
    gray = img.mean(axis=2)
    thr = otsu(gray.astype(np.uint8))
    fg = gray > thr
    print(f"{src.name}  {W}x{H}  Otsu={thr}  亮像素占比 {fg.mean()*100:.1f}%（亮=笔画）")

    rows, cols = auto_grid(fg, args.debug)

    # 手动指定时按等分切，最稳
    if args.rows > 0 and args.cols > 0:
        rows = [(int(H * i / args.rows), int(H * (i + 1) / args.rows)) for i in range(args.rows)]
        cols = [(int(W * i / args.cols), int(W * (i + 1) / args.cols)) for i in range(args.cols)]
        print(f"  手动网格：{args.rows} 行 × {args.cols} 列")

    rows, dropped_rows = drop_partial(rows)
    cols, dropped_cols = drop_partial(cols)
    if dropped_rows or dropped_cols:
        print(f"  丢弃残缺行 {len(dropped_rows)} 行 / 残缺列 {len(dropped_cols)} 列"
              f"（首尾截一半的，不是完整的格）")

    print(f"  网格：{len(rows)} 行 × {len(cols)} 列"
          f"  → 最多 {len(rows) * len(cols)} 个字")
    if not rows or not cols:
        print("[停] 没能量出网格。用 --rows/--cols 手动指定试试。")
        sys.exit(1)

    # 决定遍历顺序
    seq = []
    if args.order == "row":
        for ri, (y0, y1) in enumerate(rows):
            for ci, (x0, x1) in enumerate(cols):
                seq.append((ri, ci, y0, y1, x0, x1))
    else:  # col：从最右一列开始，列内从上到下
        for ci in range(len(cols) - 1, -1, -1):
            x0, x1 = cols[ci]
            for ri, (y0, y1) in enumerate(rows):
                seq.append((ri, ci, y0, y1, x0, x1))

    base = src.stem
    records, idx = [], 0
    for ri, ci, y0, y1, x0, x1 in seq:
        box = trim_box(fg, y0, y1, x0, x1)
        if box is None:
            continue
        gy0, gy1, gx0, gx1 = box
        tile = img[gy0:gy1, gx0:gx1]

        # 留白用黑色补，而不是从原图往外扩——
        # 往外扩会把刚去掉的格子边框又带回来，切出来的字边上带一圈亮线。
        py = int((gy1 - gy0) * args.pad)
        px = int((gx1 - gx0) * args.pad)
        if py > 0 or px > 0:
            canvas = np.zeros((tile.shape[0] + 2 * py, tile.shape[1] + 2 * px, 3),
                              dtype=tile.dtype)
            canvas[py:py + tile.shape[0], px:px + tile.shape[1]] = tile
            tile = canvas

        idx += 1
        name = f"{base}_G{idx:02d}"
        Image.fromarray(tile).save(crop_dir / f"{name}.png")
        rec = {
            "id": name,
            "char": "",
            "ai_guess": "",
            "page": src.name,
            "mode": "grid",
            "grid_row": ri + 1,
            "grid_col": ci + 1,
            "read_order": idx,
            "col_from_right": 1,      # 让 build_cards 按 read_order 排序
            "index_in_col": idx,
            "bbox": [int(gy0), int(gy1), int(gx0), int(gx1)],
            "nature": "原碑拓本",
            "verified": "未核对",
            "verified_by": "",
            "src_page": "",
            "note": "单字临摹网格切出",
        }
        if args.start > 0:
            rec["order_in_text"] = args.start + idx - 1
            rec["src_page"] = f"碑文第{args.start + idx - 1}字"
        records.append(rec)

    meta = {
        "source": src.name,
        "mode": "grid",
        "order": args.order,
        "grid": {"rows": len(rows), "cols": len(cols)},
        "threshold": thr,
        "generated": dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "glyphs": records,
    }
    (out_dir / f"meta_{src.stem}.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n切出 {len(records)} 个字 → {crop_dir}")
    print(f"  阅读顺序：{args.order}"
          f"{'（从左到右、从上到下）' if args.order == 'row' else '（右列优先、列内从上到下）'}")
    if args.start > 0:
        print(f"  碑文序号：本页第 1 个字 = 碑文第 {args.start} 字")


if __name__ == "__main__":
    main()
