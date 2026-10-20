"""生成待填写的核对卡片（csv）

设计原则：
    我预填的字段放后面，组员要填的放前面。
    组员只需要填 4 格：字、出处位置、核对人、备注。其余都是我锁定的。

    为什么用 csv 而不是纯 txt：
        csv 本质也是纯文本，但 Excel / WPS 双击就能变成表格，
        一格一格填不会串行，填完我能用程序零误差读回来。
        文件带 BOM 头，保证 Excel 打开中文不乱码。

    手工补充块：
        白星手工拆的字，按「页名_H01.png」这样的名字放进
        data/processed/glyphs_XX/crop/ 里，本脚本会自动识别并纳入卡片，
        原编号那一列会显示「手工」，不用额外登记。

用法：
    python tools/build_cards.py
"""

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROCESSED = ROOT / "data" / "processed"
PAGES_INFO = ROOT / "data" / "pages_info.json"
OUT_DIR = ROOT / "data" / "cards"

HEADER = [
    "序号", "原编号",
    "字（必填）", "出处位置（必填：第几行第几列）", "核对人（必填）", "备注（选填）",
    "珍宝馆图号", "来源页", "来源URL", "碑名", "版本", "馆藏机构", "性质", "图片文件",
]


def collect():
    """收集所有保留下来的字块，按 页 → 列（右起）→ 序 排序"""
    rows = []
    for gdir in sorted(PROCESSED.glob("glyphs_*")):
        mfiles = list(gdir.glob("meta_*.json"))
        if not mfiles:
            continue
        mf = mfiles[0]
        page = mf.stem.replace("meta_", "")
        data = json.loads(mf.read_text(encoding="utf-8"))

        known = set()
        for rec in data["glyphs"]:
            if rec.get("status") == "rejected":
                continue
            known.add(rec["id"])
            if rec.get("char"):
                continue  # 已经核过的不再进卡片
            rows.append((page, rec["col_from_right"], rec["index_in_col"], rec["id"], rec))

        # 手工补充块：crop 目录里有、但 meta 里没有的（白星手工拆的字）
        crop_dir = gdir / "crop"
        if crop_dir.exists():
            new_manual = []
            for p in sorted(crop_dir.glob(f"{page}_*.png")):
                gid = p.stem
                if gid in known:
                    continue
                new_manual.append(gid)
                rows.append((page, 99, 0, gid, {
                    "id": gid, "char": "", "nature": "原碑拓本",
                    "col_from_right": 99, "index_in_col": 0,
                    "bbox": [0, 0, 0, 0], "verified": "未核对",
                    "verified_by": "", "note": "手工补充块",
                }))

            # 登记进 meta，避免以后被残留清理误伤
            if new_manual:
                for gid in new_manual:
                    data["glyphs"].append({
                        "id": gid, "char": "", "ai_guess": "",
                        "page": page + ".png", "col_from_right": 99,
                        "index_in_col": 0, "bbox": [0, 0, 0, 0],
                        "nature": "原碑拓本", "verified": "未核对",
                        "verified_by": "", "note": "手工补充块",
                    })
                mf.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
                print(f"  第 {page} 页登记手工块 {len(new_manual)} 个：{', '.join(new_manual)}")

    rows.sort(key=lambda x: (x[0], x[1], x[2], x[3]))
    return rows


def main():
    info = {}
    if PAGES_INFO.exists():
        info = json.loads(PAGES_INFO.read_text(encoding="utf-8"))

    rows = collect()
    if not rows:
        print("没有待核对的字块")
        return

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # 按页分组，一页一个文件
    by_page = {}
    for r in rows:
        by_page.setdefault(r[0], []).append(r)

    total = 0
    for page in sorted(by_page):
        items = by_page[page]
        pi = info.get(page, {})
        out = OUT_DIR / f"卡片_{page}页.csv"

        # utf-8-sig = 带 BOM，Excel 打开中文不乱码
        with open(out, "w", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f)
            w.writerow(HEADER)
            for i, (pg, col, idx, gid, rec) in enumerate(items, 1):
                manual = rec.get("note") == "手工补充块"
                w.writerow([
                    f"{i:03d}",
                    "手工" if manual else gid,
                    "", "", "", "",
                    pi.get("image_no", ""),
                    page + ".png",
                    pi.get("url", ""),
                    pi.get("book", "多宝塔碑"),
                    pi.get("edition", ""),
                    pi.get("holder", ""),
                    rec.get("nature", "原碑拓本"),
                    f"crop/{gid}.png",
                ])
        total += len(items)
        print(f"  卡片_{page}页.csv  {len(items)} 条")

    print(f"\n共 {total} 条，分 {len(by_page)} 个文件，在 data/cards/ 下")
    print("组员只需填前 6 列里的 4 格：字、出处位置（第几行第几列）、核对人、备注")
    print("珍宝馆图号已预填，出处位置只填行和列就行")


if __name__ == "__main__":
    main()
