"""查演示例句的字凑齐了没

为什么单独做一个脚本：
    汇报要演「江山如画 / 厚德载物 / 宁静致远」，这 12 个字集不齐就演不出来。
    但库里到底有哪些、缺哪些，靠眼睛数卡片数不准。
    这个小工具直接扫字形库，一句话告诉你缺口。

用法（或双击根目录「查12字缺口.bat」）：
    python tools/check_goals.py
"""

import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROCESSED = ROOT / "data" / "processed"
GOALS = ROOT / "data" / "goals.json"
TEXT = ROOT / "data" / "metadata" / "多宝塔碑_释文.txt"

PER_SHOT = 200   # 一张滚动截图大约能切多少字（20 行 × 10 列）


def load_goals():
    if not GOALS.exists():
        return [], {}
    data = json.loads(GOALS.read_text(encoding="utf-8"))
    return data.get("sentences", []), data.get("variants", {})


def load_text():
    """读碑文释文；没有就返回空串（那就只查库、不查碑文）"""
    if not TEXT.exists():
        return ""
    body = []
    for line in TEXT.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        body.append("".join(s.split()))
    return "".join(body)


def scan_library():
    """把 meta 里所有填了字的记录收集起来：字 → [记录, ...]"""
    by_char = defaultdict(list)
    for mf in sorted(PROCESSED.glob("glyphs_*/meta_*.json")):
        data = json.loads(mf.read_text(encoding="utf-8"))
        page = mf.stem.replace("meta_", "")
        for rec in data.get("glyphs", []):
            if rec.get("status") == "rejected":
                continue
            ch = (rec.get("char") or "").strip()
            if not ch:
                continue
            by_char[ch].append({
                "id": rec["id"],
                "page": page,
                "pos": rec.get("src_page", ""),
                "verified": rec.get("verified", "未核对"),
                "by": rec.get("verified_by", ""),
                "nature": rec.get("nature", "原碑拓本"),
            })
    return by_char


def main():
    sentences, variants = load_goals()
    if not sentences:
        print("data/goals.json 里还没定例句，先定句子再查。")
        return

    chars = []
    for s in sentences:
        for ch in s:
            if ch not in chars:
                chars.append(ch)

    lib = scan_library()

    print("演示例句：" + " / ".join(sentences))
    print(f"去重后共 {len(chars)} 个字\n")

    have, lack = [], []
    for ch in chars:
        (have if lib.get(ch) else lack).append(ch)

    print(f"已有 {len(have)} / {len(chars)}")
    for ch in have:
        recs = lib[ch]
        r = recs[0]
        extra = f"  （另有 {len(recs) - 1} 个同字可选）" if len(recs) > 1 else ""
        print(f"  ✅ {ch}   {r['id']:<14} 第{r['page']}页 {r['pos'] or '位置未填'}"
              f"  {r['verified']}{('/' + r['by']) if r['by'] else ''}{extra}")

    if lack:
        print(f"\n还缺 {len(lack)} / {len(chars)}")
        print("  ❌ " + "  ".join(lack))
        print("\n  缺的字两条路：① 从现有页里补切（多半是切漏或被我误删）"
              "② 另找一页有这字的位置")
    else:
        print("\n🎉 十二个字齐了，可以直接演出了。")

    print("\n按句看：")
    for s in sentences:
        marks = "".join("✅" if lib.get(c) else "❌" for c in s)
        miss = "".join(c for c in s if not lib.get(c))
        tail = f"  还缺：{miss}" if miss else "  齐"
        print(f"  {s}  {marks}{tail}")

    total = sum(len(v) for v in lib.values())
    print(f"\n字形库当前共 {total} 个字块（去重后 {len(lib)} 个不同的字）")

    # ---- 碑文里有吗？在第几字？要截第几张图？----
    body = load_text()
    if not body:
        print("\n（没有释文文件，跳过碑文查字。把释文放进"
              " data/metadata/多宝塔碑_释文.txt 就能查。）")
        return

    print(f"\n{'=' * 56}\n碑文核查（释文 {len(body)} 字）")
    print("=" * 56)
    print(f"{'字':<4}{'碑文写法':<8}{'第几字':<10}{'第几张截图':<12}{'库里有了吗'}")
    for ch in chars:
        forms = variants.get(ch, [ch])
        found = None
        for f in forms:
            pos = [i + 1 for i, c in enumerate(body) if c == f]
            if pos:
                found = (f, pos)
                break
        if not found:
            print(f"{ch:<5}{'—':<9}{'碑中没有':<11}{'—':<13}★ 必须换字或借字")
            continue
        f, pos = found
        shots = sorted(set((p - 1) // PER_SHOT + 1 for p in pos))
        got = "✅ 已有" if lib.get(ch) else "❌ 还没切到"
        print(f"{ch:<5}{f:<9}{str(pos[:4]) + ('…' if len(pos) > 4 else ''):<11}"
              f"第{str(shots)}张{'':<4}{got}")

    miss_in_text = [c for c in chars
                    if not any(c2 in body for c2 in variants.get(c, [c]))]
    if miss_in_text:
        print(f"\n⚠️ 碑文里根本没有这几个字：{' '.join(miss_in_text)}")
        print("   这三句没法纯用《多宝塔碑》集出来，得换句子、或者从《颜勤礼碑》借字。")


if __name__ == "__main__":
    main()
