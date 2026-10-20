"""把待核对的卡片按人拆成几份，一人一份，互不打架

为什么要有这个：
    卡片是按"页/截图"生成的（一张截图 200 字），但干活的是人。
    一人发一整张 200 字的卡片太重，四个人又不好分一张图。
    所以按字数重新切成等份：1000 字 ÷ 4 人 = 每人 250 字。

用法：
    python tools/split_cards.py --per 250        # 每份 250 条
    python tools/split_cards.py --parts 4        # 均分成 4 份
    python tools/split_cards.py --per 250 --out data/cards/分组

输出：
    data/cards/分组/卡片_第1组.csv …… 卡片_第N组.csv
    同时打印每组的字号范围（碑文第几字到第几字），方便分派。
"""

import argparse
import csv
import json
import math
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))

ROOT = Path(__file__).resolve().parent.parent
CARD_DIR = ROOT / "data" / "cards"

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


def pick(row, prefix, default=""):
    for k, v in row.items():
        if k and k.strip().startswith(prefix):
            return (v or "").strip()
    return default


def sort_key(row):
    """按 页 → 卡内序号 排，保证和碑文顺序一致"""
    img = pick(row, "图片文件")
    page = Path(img).stem.split("_")[0] if img else "99"
    try:
        no = int(pick(row, "序号") or 0)
    except ValueError:
        no = 0
    return (page, no)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per", type=int, default=0, help="每份多少条")
    ap.add_argument("--parts", type=int, default=0, help="均分成几份")
    ap.add_argument("--prefilled", action="store_true",
                    help="只分「已预填字、只需核对」的条目（整幅碑文那种要认字的不算）")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    cards = sorted(CARD_DIR.glob("卡片_*.csv"))
    if not cards:
        print("data/cards/ 下没有卡片，先跑 build_cards.py")
        return

    rows = []
    for c in cards:
        rows.extend(read_rows(c))
    rows = [r for r in rows if pick(r, "图片文件")]
    if args.prefilled:
        skipped = len(rows) - len([r for r in rows if pick(r, "字")])
        rows = [r for r in rows if pick(r, "字")]
        if skipped:
            print(f"（跳过 {skipped} 条还没认字的条目——那些是整幅碑文切出来的，"
                  f"得先认字，不属于「核对」这一轮）")
    rows.sort(key=sort_key)
    total = len(rows)
    if not total:
        print("没有可分的条目。")
        return

    if args.per > 0:
        size = args.per
        parts = math.ceil(total / size)
    elif args.parts > 0:
        parts = args.parts
        size = math.ceil(total / parts)
    else:
        size, parts = 250, math.ceil(total / 250)
    print(f"待核对 {total} 条 → 每人 {size} 条，共 {parts} 份")

    out_dir = Path(args.out) if args.out else CARD_DIR / "分组"
    if out_dir.exists():
        for f in out_dir.glob("*.csv"):
            f.unlink()
    out_dir.mkdir(parents=True, exist_ok=True)

    header = list(rows[0].keys())
    for i in range(parts):
        chunk = rows[i * size:(i + 1) * size]
        if not chunk:
            break
        fpath = out_dir / f"卡片_第{i + 1}组.csv"
        with open(fpath, "w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=header)
            w.writeheader()
            w.writerows(chunk)

        first, last = chunk[0], chunk[-1]
        f_pos = pick(first, "出处位置") or pick(first, "碑名")
        l_pos = pick(last, "出处位置") or ""
        print(f"  第{i + 1}组：{len(chunk)} 条  "
              f"{pick(first, '字') or '?'}（{f_pos}） → "
              f"{pick(last, '字') or '?'}（{l_pos}）")

    # 每组再配一张只属于自己的总览图——别让人在 200 格的大图里找自己那 50 格
    try:
        import make_sheet
        print("\n为每组生成专属总览图：")
        for i in range(parts):
            csvf = out_dir / f"卡片_第{i + 1}组.csv"
            if csvf.exists():
                make_sheet.render(csvf, out_dir / f"第{i + 1}组_字块总览.png")
    except Exception as e:
        print(f"（总览图没生成：{e}）")

    print(f"\n分组卡片在 {out_dir.relative_to(ROOT)}，一人发一个文件就行。")
    print("每组只需填「核对人」一格；发现字错了就改「字」那格，并在备注说明。")


if __name__ == "__main__":
    main()
