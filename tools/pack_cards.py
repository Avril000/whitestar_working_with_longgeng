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

from PIL import Image, ImageOps

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


INK = (26, 26, 26)     # 与 make_webglyphs.py 保持一致：带一点暖的深墨色
HI, LO = 150, 60       # 亮度→透明度的两个拐点（源图黑底白字：亮的才是笔画）


def to_alpha_ink(src: Image.Image) -> Image.Image:
    """黑底白字的 crop 原图 → 透明底墨色字（RGBA）

    和 make_webglyphs.py 的 to_alpha_ink 是同一套阈值，
    但这里用 point() 查表代替逐像素循环——一包上千张图，速度差几十倍。
    """
    # 先自动色阶：手工补的块背景常是中灰而非纯黑，
    # 直接套阈值会翻出一层灰雾。拉伸一下，黑就是黑、白就是白。
    g = ImageOps.autocontrast(src.convert("L"), cutoff=2)
    lut = [0 if v <= LO else (255 if v >= HI else int(255 * (v - LO) / (HI - LO)))
           for v in range(256)]
    alpha = g.point(lut)
    out = Image.new("RGB", g.size, INK).convert("RGBA")
    out.putalpha(alpha)
    return out


def is_dark(im: Image.Image) -> bool:
    """是不是黑底（拓片原样）？缩到 1×1 就是全图平均亮度（BOX 取样最准，也最快）"""
    return im.convert("L").resize((1, 1), Image.BOX).getpixel((0, 0)) < 128


def trim_frame(im: Image.Image, max_frac=0.3):
    """裁掉被当成笔画的装裱边。

    手工补的块四周常带一圈浅色残边，翻墨时整条边全变成墨。
    识别特征：边框是"整行/整列都是墨"（alpha 行均值极高），
    字不可能占满一整行——所以从每侧往里裁，均值一直很高就一直裁。
    """
    try:
        import numpy as np
    except ImportError:
        return im
    a = np.asarray(im.split()[3], dtype=float)
    h, w = a.shape
    lim = int(min(h, w) * max_frac)

    def scan(vals):
        n = 0
        for v in vals:
            if v < 170:
                break
            n += 1
        return n

    rows, cols = a.mean(axis=1), a.mean(axis=0)
    top, bottom = scan(rows), scan(rows[::-1])
    left, right = scan(cols), scan(cols[::-1])
    if top + bottom + left + right:
        return im.crop((left, top, w - right, h - bottom))
    return im


def make_preview(gid, out_path, size=170, fill=0.88):
    """透明底墨字 → 宣纸底 PNG（组员在图片查看器里也能看清）"""
    src = GLYPH_DIR / f"{gid}.png"
    if src.exists():
        im = Image.open(src).convert("RGBA")
    else:
        # 兜底：网页图还没生成时（这一批还没收回来），用 crop 原图。
        # 原图是黑底白字，必须先翻墨——不然组员拿到的是一片黑，
        # 跟说明里写的「宣纸底墨色字」也对不上。
        # 处理步骤对齐 make_webglyphs.render_one（裁字→放大→居中），
        # 这样组员核对时看到的效果和最终入库的图基本一致。
        page = gid.split("_")[0]
        raw = CROP_DIR / f"glyphs_{page}" / "crop" / f"{gid}.png"
        if not raw.exists():
            return False
        raw_im = Image.open(raw)
        if is_dark(raw_im):
            im = trim_frame(to_alpha_ink(raw_im))
        else:
            im = raw_im.convert("RGBA")
        box = im.split()[3].getbbox()
        if box:
            crop = im.crop(box)
            cw, ch = crop.size
            target = max(1, int(size * fill))
            scale = min(target / cw, target / ch)
            nw, nh = max(1, int(round(cw * scale))), max(1, int(round(ch * scale)))
            crop = crop.resize((nw, nh), Image.LANCZOS)
            canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
            canvas.paste(crop, ((size - nw) // 2, (size - nh) // 2), crop)
            im = canvas
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
