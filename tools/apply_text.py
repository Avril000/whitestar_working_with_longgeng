"""把碑文释文按顺序"对号入座"到某一页切好的字块上

为什么要有这个：
    珍宝馆「单字临摹」页是按碑文顺序排的，而且页面上的字**可以整页复制成文本**。
    既然有文本，就不用人眼去认小字了——按序号一一对应即可，准确率 100%。

【2026-10-21 白星定稿的新流程】完全准确，宁可多花时间：
    1. 长庚先切好 crop
    2. 白星看一遍 crop，报两个锚点：
       「首个可辨认字是 G11（溟），最后一个是 G220（石）」
    3. 长庚按锚点填，并自动验证首尾自洽，对不上就拒绝写入

用法：
    python tools/apply_text.py 09 --gstart 11 --start 821 --gtail 220 --verify 石
        含义：第 09 页从 G11 号格开始是有效字，G11 = 碑文第 821 字；
             末块 G220 应当是第 821+(220-11)=1030 字，且那个字必须是「石」，
             验证不过就拒绝写入。

    python tools/apply_text.py 06 --start 201 --dry      # 只预览不写入
    废格处理：--gstart 之前的格子视为废格（截图 UI / 空白），
             会从 meta 删除并把 crop 图挪进 _rejected/，绝不进卡片。
"""

import argparse
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROCESSED = ROOT / "data" / "processed"
TEXT = ROOT / "data" / "metadata" / "多宝塔碑_释文.txt"

try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass


def load_text(path):
    """读释文：跳过 # 注释行，其余行的空白全部去掉后连成一串"""
    body = []
    for line in path.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        body.append("".join(s.split()))
    return "".join(body)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("page", help="页序号，如 09")
    ap.add_argument("--start", type=int, default=1,
                    help="首个有效字块对应释文第几字（默认 1）")
    ap.add_argument("--gstart", type=int, default=None,
                    help="首个有效字块的格子号，如 11 表示 G11；之前的格子按废格处理")
    ap.add_argument("--gtail", type=int, default=None,
                    help="末个有效字块的格子号，如 220 表示 G220（用于尾锚验证）")
    ap.add_argument("--verify", default=None,
                    help="尾锚验证：末块必须等于这个字，如 --verify 石")
    ap.add_argument("--text", default=None, help="释文文件路径")
    ap.add_argument("--dry", action="store_true", help="只预览对应关系，不写入")
    args = ap.parse_args()

    gdir = PROCESSED / f"glyphs_{args.page}"
    metas = sorted(gdir.glob("meta_*.json"))
    if not metas:
        print(f"[停] 找不到 {gdir}/meta_*.json，先跑 crop_grid.py 切字")
        return
    mf = metas[0]

    tpath = Path(args.text) if args.text else TEXT
    if not tpath.exists():
        print(f"[停] 找不到释文：{tpath}")
        return
    body = load_text(tpath)
    print(f"释文 {len(body)} 字（{tpath.name}）")

    data = json.loads(mf.read_text(encoding="utf-8"))
    all_glyphs = sorted(data["glyphs"], key=lambda r: r.get("read_order", 0))
    print(f"第 {args.page} 页共 {len(all_glyphs)} 个字块")

    # ---- 废格处理：--gstart 之前的块，从 meta 删除、crop 图挪进 _rejected ----
    waste = []
    if args.gstart:
        waste = [g for g in all_glyphs
                 if int(g["id"].split("_G")[1]) < args.gstart]
        if waste and not args.dry:
            rej = gdir / "_rejected"
            rej.mkdir(exist_ok=True)
            moved = 0
            for g in waste:
                src = gdir / "crop" / f"{g['id']}.png"
                if src.exists():
                    shutil.move(str(src), str(rej / src.name))
                    moved += 1
            data["glyphs"] = [g for g in data["glyphs"] if g not in waste]
            mf.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"废格处理：G01~G{args.gstart-1} 共 {len(waste)} 块移出"
              f"（crop 图 {moved} 张 → _rejected/），不进卡片、不进网页")
        elif waste:
            print(f"（--dry）将把 G01~G{args.gstart-1} 共 {len(waste)} 块按废格移出")

    # 有效块 = meta 现有块刨除废格（dry 模式下废格还没真删，内存里刨除）
    glyphs = [g for g in all_glyphs if g not in waste]
    print(f"有效字块 {len(glyphs)} 个（{glyphs[0]['id']} ~ {glyphs[-1]['id']}）")

    need = args.start - 1 + len(glyphs)
    if need > len(body):
        print(f"[停] 释文不够长：本页需要到第 {need} 字，释文只有 {len(body)} 字。"
              f"检查 --start 是不是填错了。")
        return

    print(f"对应范围：释文第 {args.start} ~ {need} 字")

    # ---- 尾锚验证：白星报的最后一个可辨认字，必须和推算位置一致 ----
    if args.gtail and args.verify:
        tail = next((g for g in glyphs if g["id"] == f"{args.page}_G{args.gtail}"), None)
        if tail is None:
            print(f"[停] 找不到尾块 {args.page}_G{args.gtail}，检查 --gtail")
            return
        tail_pos = args.start + glyphs.index(tail)
        actual = body[tail_pos - 1]
        if actual != args.verify:
            print(f"[停] 尾锚验证失败：按当前对齐，{tail['id']} 应为释文第 {tail_pos} 字，"
                  f"释文上是「{actual}」，不是「{args.verify}」。")
            print("     说明起始位置不对——检查 --start / --gstart，或释文/截图有缺字。")
            return
        print(f"尾锚验证通过：{tail['id']} = 释文第 {tail_pos} 字 = 「{actual}」 ✓")

    if args.dry:
        print("\n（--dry 模式，不写入）对应关系预览：")
        for g in glyphs[:8]:
            n = args.start + glyphs.index(g)
            print(f"  {g['id']}  →  第{n}字  {body[n-1]}")
        print("  ...")
        last = glyphs[-1]
        n = args.start + glyphs.index(last)
        print(f"  {last['id']}  →  第{n}字  {body[n-1]}")
        return

    for g in glyphs:
        n = args.start + glyphs.index(g)
        ch = body[n - 1]
        g["ai_guess"] = ch
        g["order_in_text"] = n
        g["src_page"] = f"碑文第{n}字"
        g["note"] = "长庚按珍宝馆释文对号入座，请核对"
    data["text_source"] = tpath.name
    data["text_start"] = args.start

    mf.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n已写入 {mf.name}：第 {args.start}~{need} 字")
    print("  前 10 个：", "".join(body[args.start - 1:args.start + 9]))
    print("  后 10 个：", "".join(body[need - 10:need]))


if __name__ == "__main__":
    main()
