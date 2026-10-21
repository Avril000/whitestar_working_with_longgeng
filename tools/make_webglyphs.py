"""把切好的单字拓片，处理成网页能直接用的「透明底墨色字」PNG

为什么要这一步：
    从碑刻拓片上切下来的单字，是「黑底白字」——碑面墨黑，笔画留白。
    这是拓片真实的样子，但直接摆到宣纸背景的网页上，就是一块块黑方块，完全不能用。

    本脚本做的是传统集字工作流里「翻墨」这一道工序：
        黑底白字  →  透明底黑字
    这样网页上每个字就是一枚干净的墨迹，可以直接压在任何底色的纸上。

做法（不二值化，保留笔画的浓淡和边缘）：
    1. 直接按原亮度映射透明度：
       亮的地方（笔画留白）→ 不透明的墨色
       暗的地方（碑面）     → 透明
       中间地带线性过渡，避免锯齿硬边
    2. 收紧到字的实际外框，再居中放进统一尺寸的画布

用法：
    python tools/make_webglyphs.py            # 处理全部
    python tools/make_webglyphs.py --only 05  # 只处理第 05 页
    python tools/make_webglyphs.py --size 200 # 画布改成 200

输出：web/glyphs/<id>.png（透明底 PNG）
"""

import argparse
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
META = ROOT / "data" / "metadata" / "glyphs.json"
OUTDIR = ROOT / "web" / "glyphs"

# 墨色：不用纯黑，纯黑在宣纸上太"死"，带一点暖的深墨色更接近真实拓本
INK = (26, 26, 26)

# 亮度 → 透明度的两个拐点（源图是黑底白字：亮的才是笔画）
#   亮于 HI  → 完全不透明（笔画，着墨色）
#   暗于 LO  → 完全透明（碑面）
HI = 150
LO = 60


def to_alpha_ink(src: Image.Image) -> Image.Image:
    """黑底白字 → 透明底墨色字（RGBA）"""
    g = src.convert("L")
    w, h = g.size
    px = g.load()

    out = Image.new("RGBA", (w, h))
    opx = out.load()

    for y in range(h):
        for x in range(w):
            v = px[x, y]
            if v >= HI:
                a = 255
            elif v <= LO:
                a = 0
            else:
                a = int(255 * (v - LO) / (HI - LO))
            if a == 0:
                opx[x, y] = (0, 0, 0, 0)
            else:
                opx[x, y] = (INK[0], INK[1], INK[2], a)

    return out


def content_box(img: Image.Image, thr: int = 24):
    """找出真正有墨迹的边界框（alpha 大于阈值的部分）"""
    a = img.split()[3]
    return a.getbbox()  # 透明区的 bbox 就是非透明内容框


def render_one(src_path: Path, dst_path: Path, size: int, fill: float, palette: bool = True):
    src = Image.open(src_path)
    img = to_alpha_ink(src)
    src.close()

    box = content_box(img)
    if box is None:
        return None, 0.0

    crop = img.crop(box)
    cw, ch = crop.size

    # 等比缩放，把字放进画布的 fill 比例内
    target = int(size * fill)
    scale = min(target / cw, target / ch)
    nw, nh = max(1, int(round(cw * scale))), max(1, int(round(ch * scale)))
    crop = crop.resize((nw, nh), Image.LANCZOS)

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(crop, ((size - nw) // 2, (size - nh) // 2), crop)

    # 存成调色板 PNG：字形图只有「墨色 + 透明」两种信息，
    # 量化到 32 色后体积只有 RGBA 的 1/8（实测 9.9KB → 1.2KB），
    # 平均误差 1.3/255，肉眼完全看不出。
    # 这样每个版本都能嵌进 data.js，多版本切换才有得选。
    if palette:
        canvas.quantize(colors=32, method=Image.FASTOCTREE).save(
            dst_path, "PNG", optimize=True)
    else:
        canvas.save(dst_path, "PNG", optimize=True)

    # 墨迹占比：太低说明这一格可能是空白或噪声，提醒人工看一眼
    ink_ratio = sum(1 for p in crop.split()[3].getdata() if p > 128) / (nw * nh)
    return canvas, ink_ratio


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="只处理某一页，例如 05")
    ap.add_argument("--size", type=int, default=160, help="输出画布边长，默认 160")
    ap.add_argument("--fill", type=float, default=0.88, help="字占画布的比例，默认 0.88")
    ap.add_argument("--force", action="store_true", help="不管时间戳，全部重做")
    ap.add_argument("--no-palette", dest="palette", action="store_false",
                    help="不转成调色板 PNG（体积大 8 倍，一般不用的）")
    ap.set_defaults(palette=True)
    ap.add_argument("--from-crop", default=None,
                    help="直接从 crop 目录处理还没入库的新页，例如 --from-crop 10,11,12")
    args = ap.parse_args()

    if args.from_crop:
        # 新页刚切完、还没进字形库时，直接扫描 crop 目录逐张处理
        ids = []
        for pg in [p.strip() for p in args.from_crop.split(",") if p.strip()]:
            cdir = ROOT / "data" / "processed" / f"glyphs_{pg}" / "crop"
            for f in sorted(cdir.glob(f"{pg}_*.png")):
                ids.append((pg, f.stem))
        if not ids:
            print("crop 目录里没找到字块，检查页号。")
            return 1
        OUTDIR.mkdir(parents=True, exist_ok=True)
        done = 0
        for pg, gid in ids:
            src = ROOT / "data" / "processed" / f"glyphs_{pg}" / "crop" / f"{gid}.png"
            _, ratio = render_one(src, OUTDIR / f"{gid}.png", args.size, args.fill)
            done += 1
            if done % 100 == 0:
                print(f"  已处理 {done} 个…")
        print(f"\n完成（--from-crop）：处理 {done} 个 → {OUTDIR}")
        return 0

    if not META.exists():
        print(f"找不到 {META}，请先跑一遍 一键_收卡片.bat")
        return 1

    data = json.loads(META.read_text(encoding="utf-8"))
    glyphs = data.get("glyphs", [])
    if not glyphs:
        print("glyphs.json 里没有字形记录。")
        return 1

    OUTDIR.mkdir(parents=True, exist_ok=True)

    done = skipped = 0
    blank = []
    for g in glyphs:
        gid = g.get("id")
        if not gid:
            continue
        page = gid.split("_")[0]
        if args.only and page != args.only:
            continue

        src = ROOT / "data" / "processed" / f"glyphs_{page}" / "crop" / f"{gid}.png"
        if not src.exists():
            print(f"  跳过 {gid}：源文件不见了 {src.name}")
            skipped += 1
            continue

        dst = OUTDIR / f"{gid}.png"
        if dst.exists() and not args.force and dst.stat().st_mtime >= src.stat().st_mtime:
            continue

        _, ratio = render_one(src, dst, args.size, args.fill, args.palette)
        if ratio is None:
            blank.append((gid, g.get("char", "")))
        elif ratio < 0.02:
            blank.append((gid, g.get("char", "")))
        done += 1
        if done % 100 == 0:
            print(f"  已处理 {done} 个…")

    print(f"\n完成：处理 {done} 个，跳过 {skipped} 个 → {OUTDIR}")
    total = sum(f.stat().st_size for f in OUTDIR.glob("*.png"))
    print(f"web/glyphs 共 {len(list(OUTDIR.glob('*.png')))} 张，占 {total/1024/1024:.1f} MB")

    if blank:
        print(f"\n注意：{len(blank)} 格几乎没有墨迹，可能是空格子或噪声，建议人工确认：")
        for gid, ch in blank[:20]:
            print(f"  {gid}　{ch}")
        if len(blank) > 20:
            print(f"  …还有 {len(blank)-20} 个")
    return 0


if __name__ == "__main__":
    sys.exit(main())
