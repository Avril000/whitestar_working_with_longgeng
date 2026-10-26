"""把组员填好的卡片合并回字形库

流程闭环的最后一步：
    切字 → 初筛 → 生成卡片 → 组员填写 → 【本脚本回填】 → 构建网页数据

用法：
    python tools/merge_cards.py

判定规则：
    字 与 核对人 都填了  → verified = 已核对
    备注里写了"存疑"     → verified = 存疑
    字 没填              → 保持 未核对，不入库
    备注/出处栏写了「弃」 → **干脆不要**，标 rejected（见下面 DROP_MARK）

注意：本脚本只更新 meta 与 data/metadata/glyphs.json，
      网页数据要再跑一次 python tools/build_manifest.py

剔除的字不是删掉，是标成 status=rejected：
    - 字形库和网页都不会收它（汇总时跳过）
    - 但**原卡片、原图、剔除清单都还在**，随时能恢复
    - 剔除清单写在 data/metadata/存疑剔除_YYYYMMDD.json
"""

import csv
import json
import re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROCESSED = ROOT / "data" / "processed"
PAGES_INFO = ROOT / "data" / "pages_info.json"
# ⚠️ 只收「回收区」这一个文件夹里的卡片，不扫整个 cards 目录。
# cards 根目录下还堆着历史卡片：旧分组卡片、抽样件、_原件_ 备份……
# 一起扫进来会把**没人核对过的脏数据**混进字形库——
# 2026-10-26 就多混了 41 条（都是"未核对"，还和已入库的字撞了 39 组）。
# 规矩：**制卡发到 dist/_pack_XX，收回来的放进 data/cards/回收/**，两处对称。
CARD_DIR = ROOT / "data" / "cards" / "回收"
LIB = ROOT / "data" / "metadata" / "glyphs.json"

BOOK_KEY = {"多宝塔碑": "dbt", "颜勤礼碑": "yql"}
BOOK_NAME = {"dbt": "多宝塔碑", "yql": "颜勤礼碑"}


def book_key(v):
    """把"碑名"或"碑代号"统一成代号（dbt / yql）。

    ⚠️ meta 里和 glyphs.json 里存的**都是代号**，不是碑名。
    以前汇总时拿代号去 BOOK_KEY（碑名→代号）里查，查不到就默认 dbt——
    于是颜勤礼碑的 1400 多条字**全被打成多宝塔碑**（2026-10-26 发现）。
    两块碑的序号都是从 1 开始的，碑号一错就全串了，所以这里两头都认。"""
    v = (v or "").strip()
    if v in BOOK_KEY:
        return BOOK_KEY[v]
    if v in BOOK_NAME:
        return v
    return "dbt"

# ---------- 弃字规则（白星 2026-10-26 定）----------
#
# DROP_MARK 是**给组员用的标识符**：备注栏（或出处栏）写一个「弃」，这条就不要了。
# 为什么要有这么个东西：以前全靠组员组织语言（"疑似不是同一个字""模糊认不出"……），
# 每个人写法都不一样，程序读不全，只能我一条条猜。标识符把这件事变成**一个字**——
# 组员不用想措辞，程序也不会漏读。
# 为什么选「弃」：中文、语义一目了然，一个字就打完，不比符号慢。
#
# ⚠️ 单看「弃」一个字会**误伤**：白星自己写的备注「末行非整行被切字丢弃」里就有这个字，
#    干跑时那两条手工补的字差点被弃掉（2026-10-26 发现）。
#    所以判定是三选一：① 带方括号的【弃】；② 整栏就一个「弃」字；
#    ③ 去掉「丢弃 / 废弃 / 抛弃」这类自然语言复合词之后，还剩一个裸的「弃」。
#    这样"太模糊了，弃"照样认得出来，而"被切字丢弃"不会被误伤。
#
# ⚠️ 这条红线的原因：给用户一个**可能是错的字**，比留空更糟。
#    和"缺字绝不造假"是同一条——空着是诚实，错了是欺骗。
DROP_MARK = "【弃】"
DROP_BARE = "弃"
DROP_EXCLUDE = ("丢弃", "废弃", "弃用", "抛弃", "放弃", "舍弃")

# 这一轮颜勤礼碑，组员是用自然语言写的（标识符还没发明出来），
# 白星 2026-10-26 逐条拍板：**全部弃掉**——"影响阅读"就意味着可能认错。
# 固化成规则，以后别的碑再遇到同样的措辞，按同一个标准处理，不用再问一遍。
DROP_PHRASES = (
    "完全无法阅读", "无法阅读", "辨认不出", "不知道什么字",   # 彻底读不了
    "不是同一个字", "不确定是不是同一个字",                   # 图和字对不上
    "有些影响阅读", "有点影响阅读",                           # 漫漶，可能认错
)

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


def drop_reason(row):
    """这条该不该弃？要弃就返回理由（一句话），不用弃返回 None。

    ⚠️ **备注栏和出处位置栏都要查**——组员可能把犹豫写进「出处位置」栏而不是「备注」栏，
    只查备注会漏（2026-10-24 就漏过 10 条）。
    """
    blob = (pick(row, "note") or "") + " " + (pick(row, "src_page") or "")
    if DROP_MARK in blob:
        return f'标识符「{DROP_MARK}」'
    if blob.strip() == DROP_BARE:
        return f'标识符「{DROP_BARE}」'
    rest = blob
    for w in DROP_EXCLUDE:          # 先把自然语言里的复合词摘掉，再看有没有裸的「弃」
        rest = rest.replace(w, "")
    if DROP_BARE in rest:
        return f'标识符「{DROP_BARE}」'
    for p in DROP_PHRASES:
        if p in blob:
            return p
    # 备注说"应该是某字"，可字列还是另一个字 → 组员认为字错了却没改字列。
    # 这种最容易混进库变成错字，一律弃。真要改，请把「字」列改成那个字再交回来。
    m = re.search(r"应该是\s*([^\s，,、。）)]+)", blob)
    if m:
        want, got = m.group(1), pick(row, "char")
        if want != got:
            return f'备注说应该是「{want}」，字列却是「{got}」'
    return None


def main():
    cards = sorted(CARD_DIR.glob("卡片_*.csv"))
    if not cards:
        print(f"\n回收区里还没有卡片：{CARD_DIR}")
        print("  组员交回来的 csv，放进这个文件夹再跑：")
        print(f"    {CARD_DIR}\\卡片_y01页.csv  这样")
        print("  （别放进 cards 根目录——那里堆着历史卡片，会被一起读进去）")
        return

    rows = []
    for c in cards:
        part = read_rows(c)
        print(f"  {c.name}  {len(part)} 条")
        for row in part:
            row["_src_file"] = c.name   # 剔除清单要记下来自哪张卡片，方便回头翻
        rows.extend(part)

    filled = [r for r in rows if pick(r, "char")]
    print(f"\n卡片共 {len(rows)} 条，其中已填 {len(filled)} 条")

    if not filled:
        print("还没有填写内容，先发给组员吧")
        return

    touched = {}
    dropped = []
    for r in filled:
        img = pick(r, "image")
        if not img:
            continue
        gid = Path(img).stem                    # 01_r1_g01 或手工块 01_H01
        page = gid.split("_")[0]
        book_name = pick(r, "book", "多宝塔碑")
        note = pick(r, "note")
        by = pick(r, "by")
        reason = drop_reason(r)

        rec_update = {
            "char": pick(r, "char"),
            "src_page": pick(r, "src_page"),
            "verified_by": by,
            "nature": pick(r, "nature", "原碑拓本"),
            "book": book_key(book_name),
            "edition": pick(r, "edition"),
            "holder": pick(r, "holder"),
            "src_url": pick(r, "url"),
            "note": note,
            "verified": "已剔除" if reason else
                        ("存疑" if "存疑" in note else ("已核对" if by else "未核对")),
        }
        if reason:
            rec_update["status"] = "rejected"   # 汇总时会跳过它，不进字形库
            dropped.append({
                "file": r.get("_src_file", ""),
                "gid": gid,
                "char": pick(r, "char"),
                "book": book_name,
                "src_page": pick(r, "src_page"),
                "note": note,
                "by": by,
                "reason": reason,
            })
        touched.setdefault(page, {})[gid] = rec_update

    if dropped:
        log = LIB.parent / f"存疑剔除_{date.today():%Y%m%d}.json"
        log.write_text(json.dumps(dropped, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n按规则剔除 {len(dropped)} 条（原卡片和原图都还在，随时能恢复）")
        print(f"  清单：{log.name}")
        for d in dropped[:6]:
            print(f"    {d['gid']} 【{d['char']}】 {d['src_page']}　{d['note']}　← {d['reason']}")
        if len(dropped) > 6:
            print(f"    …（共 {len(dropped)} 条，全在清单里）")

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

    # 汇总成前端用的字形库
    # ⚠️ 每次都从逐页 meta **全量重建**，不做增量合并。
    #   增量合并不可能删东西：一条记录一旦进过库，就算后来被弃掉、被清空，
    #   它还会赖在 glyphs.json 里（10-26 踩过：回滚了 glyphs.json 也没用，
    #   因为脏数据写在 meta 里，重新汇总又长回来）。
    #   真身是 data/processed/glyphs_*/meta_*.json —— 要回滚得回滚那一层。
    lib = {"books": {}, "glyphs": []}

    merged = 0
    unsigned = []      # 填了字但没人签核对人的——按「宁缺毋滥」不进库，但要报出来
    for gdir in sorted(PROCESSED.glob("glyphs_*")):
        for mf in gdir.glob("meta_*.json"):
            data = json.loads(mf.read_text(encoding="utf-8"))
            for rec in data["glyphs"]:
                if not rec.get("char") or rec.get("status") == "rejected":
                    continue
                gid = rec.get("id")
                if not gid:
                    continue          # 没有 id 的脏数据跳过，别混进字形库
                # ⚠️ 进库的三道关：有字、没被弃、有人签过字。
                #   卡片上「核对人」是必填栏——没人签字的字，宁可留空也不给。
                #   （10-26 踩过：抽样残余件里 41 条脚本预填、核对人空白的字混进了库）
                if rec.get("verified", "未核对") == "未核对" or not rec.get("verified_by"):
                    unsigned.append(gid)
                    continue
                bk = book_key(rec.get("book"))
                book_name = BOOK_NAME[bk]
                # 直接赋值不 setdefault：万一上次写入了错的碑名，这次要能改回来
                lib["books"][bk] = {"name": book_name, "author": "颜真卿"}
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
    print(f"\n字形库现在有 {len(lib['glyphs'])} 条")
    for bk, b in sorted(lib["books"].items()):
        n = sum(1 for g in lib["glyphs"] if g["book"] == bk)
        print(f"  {b['name']}（{bk}）{n} 条")
    print(f"  已核对 {ok} 条，存疑 {warn} 条")

    if unsigned:
        print(f"\n⚠️ 还有 {len(unsigned)} 条填了字但没写核对人，按规矩没进库：")
        print("   " + "、".join(unsigned[:12]) + ("…" if len(unsigned) > 12 else ""))
        print("   （卡片上「核对人」是必填栏。补上名字再跑一次就进库了）")

    print("\n下一步：python tools/build_manifest.py")


if __name__ == "__main__":
    main()
