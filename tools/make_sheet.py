"""把待核对的字块拼成缩略图网格（contact sheet），方便人工认字

用法：
    python tools/make_sheet.py          # 三页全做，输出 sheet_01.png / sheet_02.png / sheet_03.png
    python tools/make_sheet.py 02       # 只做第 2 页

为什么按卡片而不是按 meta 排：
    组员手里拿的是 csv 卡片，卡片上有「序号」（001、002……）。
    这张 sheet 的每个格子左上角写的编号，和卡片序号一一对应，
    组员看一眼图、找到号、在 csv 那一行填字就行，不用来回比对文件名。

输出位置：
    data/processed/glyphs_XX/card_sheet.png
"""

import argparse
import csv
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
PROCESSED = ROOT / "data" / "processed"
CARD_DIR = ROOT / "data" / "cards"


def read_rows(path):
    """读 csv，兼容 Excel 另存为的 GBK 编码"""
    for enc in ("utf-8-sig", "gbk", "utf-8"):
        try:
            with open(path, encoding=enc, newline="") as f:
                return list(csv.DictReader(f))
        except UnicodeDecodeError:
            continue
    return []


def pick(row, prefix, default=""):
    for k, v in row.items():
        if k and k.strip().startswith(prefix):
            return (v or "").strip()
    return default


def render(csv_path, out_path, cols=8, cell=110, base_dir=None):
    """把任意一张卡片 csv 画成总览图"""
    csv_path = Path(csv_path)
    rows = read_rows(csv_path)
    if not rows:
        print(f"  跳过：{csv_path.name} 是空的")
        return None
    crop_root = Path(base_dir) if base_dir else PROCESSED

    def crop_of(gid):
        page = gid.split("_")[0]
        return crop_root / f"glyphs_{page}" / "crop" / f"{gid}.png"

    return _draw(rows, Path(out_path), crop_of, cols, cell)


def _draw(rows, out, crop_of, cols, cell):
    label_h = 18
    nrows = (len(rows) + cols - 1) // cols
    W, H = cols * cell, nrows * (cell + label_h) + 8

    sheet = Image.new("RGB", (W, H), (250, 249, 243))
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("consola.ttf", 13)
    except OSError:
        font = ImageFont.load_default()

    missing = 0
    for i, row in enumerate(rows):
        r, c = divmod(i, cols)
        x, y = c * cell, r * (cell + label_h)
        no = pick(row, "序号") or f"{i + 1:03d}"
        img_rel = pick(row, "图片文件")
        gid = Path(img_rel).stem if img_rel else ""
        manual = pick(row, "原编号") == "手工"
        guess = pick(row, "字")

        draw.rectangle([x, y, x + cell - 1, y + label_h - 1],
                       fill=(252, 236, 232) if manual else (232, 230, 222))
        label = f"{no}{' 手' if manual else ''}{' ' + guess if guess else ''}"
        draw.text((x + 5, y + 2), label,
                  fill=(150, 40, 30) if manual else (40, 40, 40), font=font)

        p = crop_of(gid) if gid else None
        if p is not None and p.exists():
            g = Image.open(p).convert("RGB")
            g.thumbnail((cell - 10, cell - 10))
            sheet.paste(g, (x + (cell - g.width) // 2, y + label_h + (cell - g.height) // 2))
        else:
            missing += 1
            draw.text((x + 12, y + label_h + 40), "缺图", fill=(200, 60, 60), font=font)

        draw.rectangle([x, y, x + cell - 1, y + label_h + cell - 1], outline=(206, 200, 188))

    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    msg = f"  {out.name}：{len(rows)} 格"
    if missing:
        msg += f"（{missing} 格缺图）"
    print(msg)
    return out


def make_page(page, cols=8, cell=110):
    card = CARD_DIR / f"卡片_{page}页.csv"
    if not card.exists():
        print(f"  跳过第 {page} 页：没有 {card.name}（先跑 build_cards.py）")
        return

    rows = read_rows(card)
    if not rows:
        print(f"  跳过第 {page} 页：卡片是空的")
        return

    out = PROCESSED / f"glyphs_{page}" / "card_sheet.png"
    crop_dir = PROCESSED / f"glyphs_{page}" / "crop"
    _draw(rows, out, lambda gid: crop_dir / f"{gid}.png", cols, cell)
    print(f"    → {out}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pages", nargs="*", help="只做指定页，如 02；不填则全做")
    ap.add_argument("--cols", type=int, default=8)
    ap.add_argument("--cell", type=int, default=110)
    args = ap.parse_args()

    pages = args.pages or [p.name.replace("glyphs_", "")
                           for p in sorted(PROCESSED.glob("glyphs_*"))]
    for pg in pages:
        make_page(pg, args.cols, args.cell)


if __name__ == "__main__":
    main()
