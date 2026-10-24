"""锚点查验图：把每页「首三块 + 尾三块」拼成一张图，给人工扫一眼

为什么要有这一步：
    切字是程序按网格切的，切得整不整齐、首尾有没有多切到界面上的按钮，
    程序自己看不出来。但人对着一排字扫一眼就知道——
    这六个字和释文对得上，说明这一页的对应关系是对的。

    看一张图就能确认一批页，比逐页去数快得多，也是整条管线里
    唯一刻意留给人来判断的环节（其余全部自动）。

用法：
    python tools/make_anchor_check.py --plan plan.json --text 释文.txt
        --plan 里写着每页首块/末块对应碑文第几字（由 wizard.py 生成）
"""

import argparse
import json
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent.parent
PROCESSED = ROOT / "data" / "processed"
DIST = ROOT / "dist"

INK = (26, 26, 26)
PAPER = (251, 249, 243)
HI, LO = 150, 60
CELL = 118          # 每个字块的边长
GAP = 12
LEAD = 34           # 每页左侧标签的宽度
FONT_CANDIDATES = [
    Path("C:/Windows/Fonts/msyh.ttc"),
    Path("C:/Windows/Fonts/simhei.ttf"),
    Path("C:/Windows/Fonts/simsun.ttc"),
]


def font(size):
    for p in FONT_CANDIDATES:
        if p.exists():
            try:
                return ImageFont.truetype(str(p), size)
            except Exception:
                continue
    return ImageFont.load_default()


def to_alpha_ink(src: Image.Image) -> Image.Image:
    """黑底白字的 crop → 透明底墨色字"""
    g = ImageOps.autocontrast(src.convert("L"), cutoff=2)
    lut = [0 if v <= LO else (255 if v >= HI else int(255 * (v - LO) / (HI - LO)))
           for v in range(256)]
    out = Image.new("RGB", g.size, INK).convert("RGBA")
    out.putalpha(g.point(lut))
    return out


def is_dark(im):
    return im.convert("L").resize((1, 1), Image.BOX).getpixel((0, 0)) < 128


def cell_image(path: Path):
    """一张 crop 图 → 宣纸底、字撑满的方块"""
    im = Image.open(path)
    if is_dark(im):
        im = to_alpha_ink(im)
    else:
        im = im.convert("RGBA")
    box = im.split()[3].getbbox()
    if box:
        im = im.crop(box)
    w, h = im.size
    scale = min(CELL / w, CELL / h)
    im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
    canvas = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    canvas.paste(im, ((CELL - im.width) // 2, (CELL - im.height) // 2), im)
    bg = Image.new("RGBA", (CELL, CELL), PAPER + (255,))
    bg.alpha_composite(canvas)
    return bg.convert("RGB")


def load_text(path):
    body = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        body.append("".join(s.split()))
    return "".join(body)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", required=True, help="wizard 生成的对应关系 json")
    ap.add_argument("--text", required=True, help="碑文释文 txt")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
    full = load_text(args.text)

    pages = sorted(plan.keys())
    f18, f14 = font(18), font(14)
    rows = len(pages)

    # 每页一行：顶部一行说明（页名 + 推算的起止 + 首尾字预览），下面六个字块
    W = 24 + 6 * CELL + 6 * GAP + 130
    ROW = CELL + 46
    H = rows * ROW + 76
    img = Image.new("RGB", (W, H), (245, 242, 235))
    d = ImageDraw.Draw(img)
    d.text((16, 14), "锚点查验：每页首三块 / 尾三块，和释文对得上就说明这一页切对了",
           font=f18, fill=INK)

    y = 48
    for page in pages:
        info = plan[page]
        gstart, gtail, start = info["gstart"], info["gtail"], info["start"]
        meta = PROCESSED / f"glyphs_{page}" / f"meta_{page}.json"
        if not meta.exists():
            d.text((16, y + 40), f"第 {page} 页还没切字", font=f14, fill=(150, 40, 40))
            y += ROW
            continue

        data = json.loads(meta.read_text(encoding="utf-8"))
        # 只拿正式切出的块（页名_G编号）；手工补的块（页名_H01）不在碑文锚点里，
        # 混进尾三块会让尾字预览对不上释文
        blocks = sorted([g for g in data["glyphs"]
                         if re.match(rf"^{page}_G\d+$", g["id"])],
                        key=lambda g: g.get("read_order") or 0)

        picks = blocks[:3] + blocks[-3:] if len(blocks) >= 6 else blocks
        x = 24
        for g in picks:
            raw = PROCESSED / f"glyphs_{page}" / "crop" / f"{g['id']}.png"
            if raw.exists():
                img.paste(cell_image(raw), (x, y + 22))
            d.text((x + 2, y + 24 + CELL), g["id"].split("_")[-1],
                   font=f14, fill=(110, 105, 95))
            x += CELL + GAP

        n0, n1 = start, start + (gtail - gstart)
        w0 = "".join(full[n0 - 1:n0 + 2]) if n0 >= 1 and n0 <= len(full) else "?"
        w1 = "".join(full[max(0, n1 - 3):n1]) if n1 <= len(full) else "?"
        d.text((24, y + 2), f"{page}　碑文第 {n0}~{n1} 字　　首：{w0}　　尾：{w1}",
               font=f14, fill=(60, 70, 110))
        y += ROW

    out = Path(args.out) if args.out else DIST / "锚点查验.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, "PNG")
    print(f"  锚点查验图 → {out}")


if __name__ == "__main__":
    main()
