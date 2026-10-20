"""把人工初筛挑出来的块移到待定区，并在 meta 里打标记

为什么不直接删除：
    1. 随时能恢复，万一挑错了
    2. 「切出 N 块 → 筛掉 M 块 → 有效 K 块」这条链本身就是汇报素材
       （课题挑战层要的正是「抓取→清洗→校核→入库」全流程）

用法：
    python tools/apply_review.py
    python tools/apply_review.py --restore 01_r1_g09    # 反悔了，恢复某一块

清单文件：data/review_reject.json
"""

import argparse
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REJECT_FILE = ROOT / "data" / "review_reject.json"
PROCESSED = ROOT / "data" / "processed"


def meta_files():
    return sorted(PROCESSED.glob("glyphs_*/meta_*.json"))


def glyph_dirs():
    return sorted(PROCESSED.glob("glyphs_*"))


def reject(records, gdir, ids_to_reject):
    rejected_dir = gdir / "_rejected"
    crop_rej = rejected_dir / "crop"
    bin_rej = rejected_dir / "bin"
    crop_rej.mkdir(parents=True, exist_ok=True)
    bin_rej.mkdir(parents=True, exist_ok=True)

    done, missing = 0, []
    for rec in records:
        name = rec["id"]
        parts = name.rsplit("_", 2)  # 01_r1_g09 -> ['01', 'r1', 'g09']
        if len(parts) != 3:
            continue
        page, col, g = parts
        key = f"{page}_{col}_{g}"
        if key not in ids_to_reject:
            continue
        for sub, dst in (("crop", crop_rej), ("bin", bin_rej)):
            src = gdir / sub / f"{name}.png"
            if src.exists():
                shutil.move(str(src), str(dst / f"{name}.png"))
        rec["status"] = "rejected"
        rec["note"] = (rec.get("note", "") + "；人工初筛剔除（无法识别）").strip("；")
        done += 1
        ids_to_reject.discard(key)

    missing = sorted(ids_to_reject)
    return done, missing


def restore(gid):
    """把某一块从待定区挪回来"""
    for gdir in glyph_dirs():
        mfiles = list(gdir.glob("meta_*.json"))
        if not mfiles:
            continue
        mf = mfiles[0]
        data = json.loads(mf.read_text(encoding="utf-8"))
        for rec in data["glyphs"]:
            if rec["id"] == gid and rec.get("status") == "rejected":
                for sub in ("crop", "bin"):
                    src = gdir / "_rejected" / sub / f"{gid}.png"
                    if src.exists():
                        shutil.move(str(src), str(gdir / sub / f"{gid}.png"))
                rec["status"] = "kept"
                rec["note"] = rec.get("note", "").replace("；人工初筛剔除（无法识别）", "")
                mf.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
                print(f"已恢复 {gid}")
                return
    print(f"没找到待恢复的块：{gid}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--restore", default=None, help="恢复某一块，例如 01_r1_g09")
    args = ap.parse_args()

    if args.restore:
        restore(args.restore)
        return

    if not REJECT_FILE.exists():
        print(f"找不到清单：{REJECT_FILE}")
        sys.exit(1)

    spec = json.loads(REJECT_FILE.read_text(encoding="utf-8"))
    ids_to_reject = set()
    for page, cols in spec.items():
        if page.startswith("_"):
            continue
        for col, nums in cols.items():
            for n in nums:
                ids_to_reject.add(f"{page}_{col}_g{n:02d}")

    print(f"清单共 {len(ids_to_reject)} 块待剔除")

    total_done, total_kept = 0, 0
    for mf in meta_files():
        gdir = mf.parent
        data = json.loads(mf.read_text(encoding="utf-8"))
        done, _ = reject(data["glyphs"], gdir, ids_to_reject)
        kept = sum(1 for r in data["glyphs"] if r.get("status") != "rejected")
        mf.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"  {mf.name}：剔除 {done} 块，保留 {kept} 块")
        total_done += done
        total_kept += kept

    leftover = sorted(ids_to_reject)
    print(f"\n合计：剔除 {total_done} 块，保留 {total_kept} 块")
    if leftover:
        print(f"以下 {len(leftover)} 个编号在 meta 里没找到（可能编号不存在），已跳过：")
        print("  " + ", ".join(leftover))


if __name__ == "__main__":
    main()
