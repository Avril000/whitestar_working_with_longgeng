"""按页打包核对任务：一页一个 zip，包里直接带单字图

为什么这样打包（白星 2026-10-21 定）：
    1. **不再分组**——整页为单位发放，多点少点都正常
    2. **不用总览图**——直接给单字图，组员对着"图片文件"列找图核对，
      看到的就是最终要入库的那张（翻墨后的透明底墨字，已合成宣纸白底）
    3. **一页一个包**——文件太大时拆分灵活，想发给谁、发几页都自由

包的内容：
    卡片包_第XX页_日期.zip
    ├─ 卡片_XX页.csv
    ├─ 填写说明.md
    └─ 单字图/XX_G01.png …（按卡片顺序，文件名与 csv 的"图片文件"列一致）

用法：
    python tools/pack_cards.py                     # 所有有卡片的页，各打一个包
    python tools/pack_cards.py 10 11               # 只打这两页
    python tools/pack_cards.py --one               # 合成一个总包（不拆分）
"""

import csv
import shutil
import sys
import zipfile
from datetime import datetime
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CARD_DIR = ROOT / "data" / "cards"
GLYPH_DIR = ROOT / "web" / "glyphs"
CROP_DIR = ROOT / "data" / "processed"
DIST = ROOT / "dist"
PAPER = (251, 249, 243)   # 宣纸色，和网页一致

try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass


def read_rows(path):
    for enc in ("utf-8-sig", "gbk", "utf-8"):
        try:
            with open(path, encoding=enc, newline="") as f:
                return list(csv.DictReader(f))
        except UnicodeDecodeError:
            continue
    return []


def gid_of(row):
    """从「图片文件」列取出字块 id（crop/10_G01.png → 10_G01）"""
    img = row.get("图片文件") or ""
    return Path(img).stem if img else ""


def make_preview(gid, out_path, size=170):
    """透明底墨字 → 宣纸底 PNG（组员在图片查看器里也能看清）"""
    src = GLYPH_DIR / f"{gid}.png"
    if src.exists():
        im = Image.open(src).convert("RGBA")
    else:
        # 兜底：网页图还没生成时，直接用 crop 原图（黑底白字）
        page = gid.split("_")[0]
        raw = CROP_DIR / f"glyphs_{page}" / "crop" / f"{gid}.png"
        if not raw.exists():
            return False
        im = Image.open(raw).convert("RGBA")
    bg = Image.new("RGBA", (size, size), PAPER + (255,))
    im2 = im.resize((size, size), Image.LANCZOS)
    bg.alpha_composite(im2)
    bg.convert("RGB").save(out_path, "PNG", optimize=True)
    return True


def pack_page(page, cards, stamp, keep_dir=True):
    rows = read_rows(cards)
    if not rows:
        print(f"  第 {page} 页卡片是空的，跳过")
        return None

    work = DIST / f"_pack_{page}"
    if work.exists():
        shutil.rmtree(work)
    (work / "单字图").mkdir(parents=True)

    shutil.copy(cards, work / cards.name)
    note = CARD_DIR / "填写说明.md"
    if note.exists():
        shutil.copy(note, work / "填写说明.md")

    ok = miss = 0
    for r in rows:
        gid = gid_of(r)
        if not gid:
            continue
        if make_preview(gid, work / "单字图" / f"{gid}.png"):
            ok += 1
        else:
            miss += 1

    zip_path = DIST / f"卡片包_第{page}页_{stamp}.zip"
    if zip_path.exists():
        zip_path.unlink()
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(work.rglob("*")):
            z.write(f, f.relative_to(work))

    if not keep_dir:
        shutil.rmtree(work)

    mb = zip_path.stat().st_size / 1024 / 1024
    print(f"  第 {page} 页：{len(rows)} 条 + 单字图 {ok} 张 → {zip_path.name}（{mb:.1f} MB）"
          + (f"　缺图 {miss} 张" if miss else ""))
    return zip_path


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    one = "--one" in sys.argv

    cards = sorted(CARD_DIR.glob("卡片_*页.csv"))
    if args:
        cards = [c for c in cards if c.stem.replace("卡片_", "").replace("页", "") in args]
    if not cards:
        print("没有可打包的卡片（data/cards/卡片_XX页.csv）")
        return

    DIST.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d")
    print(f"开始打包（{stamp}）：共 {len(cards)} 页\n")

    made = []
    for c in cards:
        page = c.stem.replace("卡片_", "").replace("页", "")
        p = pack_page(page, c, stamp)
        if p:
            made.append(p)

    if one and len(made) > 1:
        allz = DIST / f"卡片包_全部_{stamp}.zip"
        with zipfile.ZipFile(allz, "w", zipfile.ZIP_DEFLATED) as z:
            for p in made:
                z.write(p, p.name)
        print(f"\n另存合并包：{allz.name}")

    print(f"\n完成：{len(made)} 个包在 dist/ 下")
    print("包里：卡片 csv + 单字图（就是最终入库的那张）+ 填写说明，没有总览图")


if __name__ == "__main__":
    main()
