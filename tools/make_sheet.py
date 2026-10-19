"""把切好的字块拼成一张缩略图网格（contact sheet），方便人工核对

用法：
    python tools/make_sheet.py data/processed/glyphs_01
    python tools/make_sheet.py data/processed/glyphs_01 -o sheet_01.png --cols 10

说明：
    人工核对时不用一张张点开看，打开 sheet 图就能总览全部字块。
    每个格子上方标注编号（与 meta_*.json 里的 id 一致）。
"""

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("glyph_dir", help="crop_glyphs.py 的输出目录（含 crop/ 与 meta_*.json）")
    ap.add_argument("-o", "--out", default=None)
    ap.add_argument("--cols", type=int, default=10)
    ap.add_argument("--cell", type=int, default=96, help="每格尺寸（像素）")
    args = ap.parse_args()

    gdir = Path(args.glyph_dir)
    crop_dir = gdir / "crop"
    metas = sorted(gdir.glob("meta_*.json"))
    if not metas or not crop_dir.exists():
        print(f"目录不对：{gdir} 下应有 crop/ 与 meta_*.json")
        sys.exit(1)

    records = []
    for m in metas:
        data = json.loads(m.read_text(encoding="utf-8"))
        records.extend(data.get("glyphs", []))

    cell = args.cell
    cols = args.cols
    label_h = 16
    rows = (len(records) + cols - 1) // cols
    W, H = cols * cell, rows * (cell + label_h) + 10

    sheet = Image.new("RGB", (W, H), (250, 249, 243))
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("consola.ttf", 12)
    except OSError:
        font = ImageFont.load_default()

    for i, rec in enumerate(records):
        r, c = divmod(i, cols)
        x, y = c * cell, r * (cell + label_h)
        name = rec["id"]
        img_path = crop_dir / f"{name}.png"
        draw.rectangle([x, y, x + cell - 1, y + label_h - 1], fill=(230, 228, 220))
        guess = rec.get("ai_guess") or "?"
        draw.text((x + 4, y + 2), f"{name.split('_', 1)[1]} {guess}", fill=(40, 40, 40), font=font)
        if img_path.exists():
            g = Image.open(img_path).convert("RGB")
            g.thumbnail((cell - 8, cell - 8))
            gx = x + (cell - g.width) // 2
            gy = y + label_h + (cell - g.height) // 2
            sheet.paste(g, (gx, gy))
        draw.rectangle([x, y, x + cell - 1, y + label_h + cell - 1], outline=(210, 206, 196))

    out = Path(args.out) if args.out else gdir / "sheet.png"
    sheet.save(out)
    print(f"共 {len(records)} 块，输出 {out}")


if __name__ == "__main__":
    main()
