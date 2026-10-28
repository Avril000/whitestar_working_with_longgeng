"""生成「简繁/异体反查表」，让网页上输入简体也能查到碑里的繁体字

为什么要有这个：
    碑上刻的是繁体（書、畫、寧…），用户敲的是简体（书、画、宁…）。
    以前这张表是**手写在 data/goals.json 里的**，只写了演示例句那 12 个字。
    于是用户输入「书」→ 表里没有 → 直接判缺字；输入「書」→ 库里有 → 能查出来。
    2026-10-28 白星就是在颜勤礼碑上试「书」试出来的。
    这不是某一块碑的毛病：**任何不在这 12 个字里的简体字都查不出来**。

为什么不继续手写：
    手写字表永远追不上库里的 1193 个字，而且第三块碑进来还得再写一遍。

所以改成**从库里反推**：
    对库里每一个真实存在的写法 C（多半是繁体），算出它的简体（和繁体）形式 v，
    记一条 "v 可能指的是 C"。这样表里每一条都**保证指向库里真有的字**——
    不会像手写表那样指着库里没有的字空转。

    ⚠️ 反向是关键：不是"猜库里可能有什么繁体字"，而是"库里这个字，用户会怎么敲"。

方向是双向的：
    繁 → 简（t2s）：库里「書」→ 用户敲「书」    ✅ 主要用途
    简 → 繁（s2t）：库里「静」→ 用户敲「靜」    ✅ 库里存的是简体时的反向兜底

多对一是正常的（「乾」「幹」都对应「干」），所以值是**候选列表**，
由前端 mapChar() 挑"当前这块碑里真有的那一个"。

用法（或双击根目录「一键_更新简繁表.bat」）：
    python tools/build_variants.py

依赖：opencc-python-reimplemented（只在本脚本里用，生成的 json 是静态的，
      网页和 build_manifest 都不需要它——换台机器没装也不影响）。

"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "metadata" / "glyphs.json"
DST = ROOT / "data" / "metadata" / "简繁对照.json"

try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass


def load_opencc():
    """拿两个方向的转换器；没装就返回 None，让调用方决定怎么办"""
    try:
        import opencc
    except ImportError:
        return None
    return {
        "t2s": opencc.OpenCC("t2s").convert,   # 繁 → 简
        "s2t": opencc.OpenCC("s2t").convert,  # 简 → 繁
    }


def main():
    if not SRC.exists():
        print(f"[停] 找不到字形库：{SRC}")
        return 1

    conv = load_opencc()
    if conv is None:
        # 不阻塞整条管线：沿用上一版的表，只提醒。
        # （表是静态 json，已经跟着仓库走，网页完全不依赖 opencc。）
        if DST.exists():
            print("[提示] 未安装 opencc，沿用现有的简繁对照表。")
            print("       要更新就先装：pip install opencc-python-reimplemented")
            return 0
        print("[停] 未安装 opencc，而且还没有对照表可用。")
        print("     先装：pip install opencc-python-reimplemented")
        return 1

    data = json.loads(SRC.read_text(encoding="utf-8"))
    glyphs = data.get("glyphs", [])

    # 库里真实存在的写法（去重、排序，保证每次生成的结果稳定）
    chars = sorted({g["char"] for g in glyphs if g.get("char")})
    if not chars:
        print("[停] 字形库里一个字都没有。")
        return 1

    table = {}
    for c in chars:
        for conv_fn in (conv["t2s"], conv["s2t"]):
            v = conv_fn(c)
            # 只收"单字 → 单字"的对应：一对多（如「發」→ 「发」是 1:1，
            # 但有些字会被转成词组）会让索引变脏
            if not v or len(v) != 1 or v == c:
                continue
            bucket = table.setdefault(v, [])
            if c not in bucket:
                bucket.append(c)

    # 同碑优先：候选排序按"库里条数多的在前"，让常见写法排在前面
    cnt = {}
    for g in glyphs:
        ch = g.get("char")
        if ch:
            cnt[ch] = cnt.get(ch, 0) + 1
    for v in table:
        table[v].sort(key=lambda c: (-cnt.get(c, 0), c))

    payload = {
        "_说明": (
            "由 tools/build_variants.py 自动生成，请勿手工修改。"
            "键 = 用户可能敲进去的写法（简体或繁体）；值 = 碑上真实存在的写法（候选列表）。"
            "改库之后重跑本脚本即可；网页和 build_manifest 都不依赖 opencc。"
        ),
        "_生成自": f"{len(chars)} 个库内写法",
        "map": table,
    }
    DST.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # 顺手看看覆盖得怎么样：库里的繁体字，有几个能反查到简体
    covered = sum(1 for c in chars if conv["t2s"](c) != c)
    print(f"已生成 {DST}")
    print(f"  库内写法 {len(chars)} 个，其中 {covered} 个有对应的简体写法")
    print(f"  反查条目 {len(table)} 条（用户敲这些字，就能找到碑里的字）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
