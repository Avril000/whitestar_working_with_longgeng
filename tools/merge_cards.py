"""把组员填好的卡片合并回字形库

流程闭环的最后一步：
    切字 → 初筛 → 生成卡片 → 组员填写 → 【本脚本回填】 → 构建网页数据

用法：
    python tools/merge_cards.py

判定规则：
    字 与 核对人 都填了  → verified = 已核对
    备注里写了"存疑"     → verified = 存疑
    字 没填              → 保持 未核对，不入库

注意：本脚本只更新 meta 与 data/metadata/glyphs.json，
      网页数据要再跑一次 python tools/build_manifest.py
"""

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROCESSED = ROOT / "data" / "processed"
PAGES_INFO = ROOT / "data" / "pages_info.json"
CARD_DIR = ROOT / "data" / "cards"
LIB = ROOT / "data" / "metadata" / "glyphs.json"

BOOK_KEY = {"多宝塔碑": "dbt", "颜勤礼碑": "yql"}

# 列名按「前缀」匹配，不写死全名。
# 这样组员（或 Excel）动不了列结构的前提下，即使表头文字微调也能读对。
FIELDS = {
    "char":     "字",
    "src_page": "出处位置",
    "by":       "核对人",
    "note":     "备注",
    "image":    "图片文件",
    "book":     "碑名",
    "edition":  "版本",
    "holder":   "馆藏机构",
    "nature":   "性质",
    "url":      "来源URL",
}


def pick(row, key, default=""):
    """按前缀取列值，容忍表头被改动"""
    want = FIELDS[key]
    for k, v in row.items():
        if k and k.strip().startswith(want):
            return (v or "").strip()
    return default


def read_rows(path):
    """读 csv，兼容 Excel 另存为时的编码差异

    Excel 打开带 BOM 的 UTF-8 csv 没问题，但「另存为」时如果选了
    普通的「CSV(逗号分隔)」，会按系统 ANSI(GBK) 写回，BOM 也没了。
    所以这里依次尝试 utf-8-sig / gbk，谁先成功用谁。
    """
    last = None
    for enc in ("utf-8-sig", "gbk", "utf-8"):
        try:
            with open(path, encoding=enc, newline="") as f:
                return list(csv.DictReader(f))
        except UnicodeDecodeError as e:
            last = e
    raise last


def main():
    cards = sorted(CARD_DIR.glob("卡片_*.csv"))
    if not cards:
        print(f"找不到卡片：{CARD_DIR}/卡片_*.csv")
        return

    rows = []
    for c in cards:
        part = read_rows(c)
        print(f"  {c.name}  {len(part)} 条")
        rows.extend(part)

    filled = [r for r in rows if pick(r, "char")]
    print(f"\n卡片共 {len(rows)} 条，其中已填 {len(filled)} 条")

    if not filled:
        print("还没有填写内容，先发给组员吧")
        return

    touched = {}
    for r in filled:
        img = pick(r, "image")
        if not img:
            continue
        gid = Path(img).stem                    # 01_r1_g01 或手工块 01_H01
        page = gid.split("_")[0]
        book_name = pick(r, "book", "多宝塔碑")
        note = pick(r, "note")
        by = pick(r, "by")

        rec_update = {
            "char": pick(r, "char"),
            "src_page": pick(r, "src_page"),
            "verified_by": by,
            "nature": pick(r, "nature", "原碑拓本"),
            "book": BOOK_KEY.get(book_name, "dbt"),
            "edition": pick(r, "edition"),
            "holder": pick(r, "holder"),
            "src_url": pick(r, "url"),
            "note": note,
            "verified": "存疑" if "存疑" in note else ("已核对" if by else "未核对"),
        }
        touched.setdefault(page, {})[gid] = rec_update

    for page, updates in touched.items():
        gdir = PROCESSED / f"glyphs_{page}"
        mfiles = list(gdir.glob("meta_*.json"))
        if not mfiles:
            print(f"  跳过第 {page} 页：找不到目录")
            continue
        mf = mfiles[0]
        data = json.loads(mf.read_text(encoding="utf-8"))

        by_id = {r["id"]: r for r in data["glyphs"]}
        for gid, upd in updates.items():
            if gid in by_id:
                by_id[gid].update(upd)
            else:
                upd["id"] = gid
                data["glyphs"].append(upd)
        mf.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"  第 {page} 页：更新 {len(updates)} 条")

    # 汇总成前端用的字形库（只收已填写字的记录）
    lib = {"books": {}, "glyphs": []}
    if LIB.exists():
        lib = json.loads(LIB.read_text(encoding="utf-8"))

    merged = 0
    for gdir in sorted(PROCESSED.glob("glyphs_*")):
        for mf in gdir.glob("meta_*.json"):
            data = json.loads(mf.read_text(encoding="utf-8"))
            for rec in data["glyphs"]:
                if not rec.get("char") or rec.get("status") == "rejected":
                    continue
                gid = rec["id"]
                book_name = rec.get("book", "多宝塔碑")
                bk = BOOK_KEY.get(book_name, "dbt")
                lib["books"].setdefault(bk, {"name": book_name, "author": "颜真卿"})
                item = {
                    "id": gid,
                    "char": rec["char"],
                    "book": bk,
                    "nature": rec.get("nature", "原碑拓本"),
                    "edition": rec.get("edition", ""),
                    "holder": rec.get("holder", ""),
                    "src_url": rec.get("src_url", ""),
                    "src_page": rec.get("src_page", ""),
                    "image": f"glyphs/{gid}.png",
                    "verified": rec.get("verified", "未核对"),
                    "by": rec.get("verified_by", ""),
                    "note": rec.get("note", ""),
                }
                exist = next((x for x in lib["glyphs"] if x["id"] == gid), None)
                if exist:
                    exist.update(item)
                else:
                    lib["glyphs"].append(item)
                    merged += 1

    LIB.parent.mkdir(parents=True, exist_ok=True)
    LIB.write_text(json.dumps(lib, ensure_ascii=False, indent=2), encoding="utf-8")

    ok = sum(1 for g in lib["glyphs"] if g["verified"] == "已核对")
    warn = sum(1 for g in lib["glyphs"] if g["verified"] == "存疑")
    print(f"\n字形库现在有 {len(lib['glyphs'])} 条（新增 {merged} 条）")
    print(f"  已核对 {ok} 条，存疑 {warn} 条")
    print("\n下一步：python tools/build_manifest.py")


if __name__ == "__main__":
    main()
