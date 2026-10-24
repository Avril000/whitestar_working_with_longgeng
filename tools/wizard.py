"""投递箱制卡向导：只处理 data/inbox/ 里这一批页图

为什么要有这个：
    以前的出包脚本是全量扫描 data/processed/，所有碑、所有页混在一起。
    页一多就容易踩坑（两块碑的碑文字号都从 1 开始，去重就撞车过），
    而且每加一块碑都要长庚手动登记 pages_info.json。

    现在的规矩：**这一轮要做什么，就往 data/inbox/ 放什么**。
    向导只碰投递箱里的东西，问几个必答的问题，然后一条龙跑完：
    切字 → 锚点查验 → 对号入座 → 制卡 → 打包 → 归档投递箱。

    管线里唯一留给人的判断就是锚点查验——程序不知道切出来的字
    是不是和释文对得上，人扫一眼就知道。这也是整个流程准确率的关键。

用法（白星平时只用这个）：
    双击「一键_投递制卡.bat」

    python tools/wizard.py --dry        # 只预览每一步会做什么，不动任何文件
"""

import argparse
import datetime as dt
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INBOX = ROOT / "data" / "inbox"
PROCESSED = ROOT / "data" / "processed"
PAGES_INFO = ROOT / "data" / "pages_info.json"
META_DIR = ROOT / "data" / "metadata"
CARDS = ROOT / "data" / "cards"
DIST = ROOT / "dist"
TOOLS = ROOT / "tools"

sys.path.insert(0, str(TOOLS))
try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass


def run(script, *args, dry=False):
    """调用同目录脚本；--dry 时只打印要跑的命令"""
    cmd = [sys.executable, str(TOOLS / script), *map(str, args)]
    if dry:
        print("  （演练）" + " ".join(Path(c).name if i == 1 else str(c)
                                      for i, c in enumerate(cmd)))
        return 0
    sys.stdout.flush()
    r = subprocess.run(cmd)
    sys.stdout.flush()
    if r.returncode != 0:
        print(f"\n[失败] {script} 返回码 {r.returncode}，先停在这里。"
              f"处理过的东西都还在，修好后重新双击即可（已切过的页会自动跳过）。")
        sys.exit(r.returncode)
    return r.returncode


def ask(prompt, default=""):
    """问一个问题，回车 = 用默认值"""
    tip = f"（回车={default}）" if default != "" else ""
    s = input(f"\n{prompt} {tip}: ").strip()
    return s or default


def blocks_of(page):
    """这一页切出了多少个正式字块"""
    mf = PROCESSED / f"glyphs_{page}" / f"meta_{page}.json"
    if not mf.exists():
        return 0
    data = json.loads(mf.read_text(encoding="utf-8"))
    import re
    return len([g for g in data["glyphs"] if re.match(rf"^{page}_G\d+$", g["id"])])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true", help="只预览，不动文件")
    args = ap.parse_args()

    print("=" * 56)
    print(" 投递箱制卡向导")
    print(" 这一轮要做什么，就往 data/inbox/ 放什么；")
    print(" 答完下面几个问题，其余自动。")
    print("=" * 56)

    # ---------- 1. 扫投递箱 ----------
    inbox_pngs = sorted(p for p in INBOX.glob("*.png"))
    inbox_txts = sorted(p for p in INBOX.glob("*.txt"))
    if not inbox_pngs:
        print(f"\n[停] {INBOX} 里没有页图。")
        print("     把这一轮要做的页面截图放进来（文件名就是页码，如 y01.png），")
        print("     再重新双击。放什么、怎么命名，看同目录的 README.md。")
        return
    pages = [p.stem for p in inbox_pngs]
    print(f"\n投递箱里有 {len(pages)} 张页图：{', '.join(pages)}")
    if inbox_txts:
        print(f"另有释文文件：{', '.join(t.name for t in inbox_txts)}")

    info = json.loads(PAGES_INFO.read_text(encoding="utf-8")) \
        if PAGES_INFO.exists() else {}

    # ---------- 2. 碑 ----------
    books = []
    for k, v in info.items():
        if k.startswith("_") or not isinstance(v, dict):
            continue
        b = v.get("book", "")
        if b and b not in books:
            books.append(b)
    print("\n—— 这批图属于哪块碑？" + "-" * 30)
    for i, b in enumerate(books, 1):
        n_pages = sum(1 for k, v in info.items()
                      if not k.startswith("_") and isinstance(v, dict)
                      and v.get("book") == b)
        print(f"  {i}. {b}（已有 {n_pages} 页）")
    print(f"  {len(books) + 1}. 新碑（要填名字、链接和释文）")
    pick = ask("输入序号", "")
    while not (pick.isdigit() and 1 <= int(pick) <= len(books) + 1):
        pick = ask("输入上面的序号（数字）", pick if pick.isdigit() else "")
    book = books[int(pick) - 1] if int(pick) <= len(books) else ""

    text_path = None
    if not book:  # 新碑
        book = ask("新碑的名字（如：玄秘塔碑）", "")
        while not book:
            book = ask("名字不能为空，再输入一次", "")
        url = ask("珍宝馆链接（没有就回车）", "")
        holder = ask("馆藏机构", "西安碑林博物馆藏")
        # 释文：投递箱里放的 txt 优先，其次问路径
        if inbox_txts:
            t = inbox_txts[0]
            use = ask(f"用投递箱里的 {t.name} 当释文？回车=是 / 输入 n 换别的",
                      "是")
            if use.lower().startswith("n"):
                t = Path(ask("释文 txt 的完整路径", ""))
            text_path = t if Path(t).exists() else None
        else:
            tp = ask("释文 txt 路径（可以把文件直接拖进这个窗口）", "")
            text_path = Path(tp.strip('"')) if tp else None
        while text_path is None or not text_path.exists():
            text_path = Path(ask("找不到那个文件，再输一次路径（必填，对号入座全靠它）", "").strip('"'))
        # 归位到 data/metadata/，命名统一「碑名_释文.txt」
        dst = META_DIR / f"{book}_释文.txt"
        if not dst.exists():
            shutil.copy2(text_path, dst)
            print(f"  释文已收好 → {dst}")
        text_path = dst
    else:
        old = META_DIR / f"{book}_释文.txt"
        if old.exists():
            text_path = old
        else:
            # 老数据里释文文件名可能带书名号，兜底搜一下
            hits = list(META_DIR.glob(f"*{book}*释文*.txt")) + \
                   list(META_DIR.glob(f"*{book}*.txt"))
            text_path = hits[0] if hits else None
        while text_path is None or not Path(text_path).exists():
            text_path = Path(ask(f"没找到《{book}》的释文 txt，输一次路径", "").strip('"'))

    # ---------- 3. 起始字号 / 重叠 ----------
    print("\n—— 对应关系，两个数" + "-" * 30)
    print(" （如果这批接着这块碑上一批的，就填上一批最后一个字的下一号；全新的一批回车即可）")
    start = int(ask("这批第一格对应碑文第几字", "1"))
    overlap = int(ask("相邻两张截图重叠几个字（滚屏截图每次重复的部分）", "10"))

    # ---------- 4. 确定 url / 馆藏（新碑用输入的，老碑从同碑旧页继承） ----------
    if book in books:
        sample = next((v for k, v in info.items()
                       if not k.startswith("_") and isinstance(v, dict)
                       and v.get("book") == book and k not in pages), {})
        url, holder = sample.get("url", ""), sample.get("holder", "")
    # 新碑时 url/holder 已在提问环节赋值

    # ---------- 5. 登记 pages_info + 拷页图 ----------
    print("\n—— 登记页信息" + "-" * 34)
    today = dt.date.today().strftime("%Y-%m-%d")
    for i, page in enumerate(pages, 1):
        info[page] = {
            "image_no": f"第{i}张",
            "url": url,
            "book": book,
            "edition": "原碑",
            "holder": holder,
            "nature": "原碑拓本",
            "mode": "grid",
            "order": "row",
            "note": f"投递箱进料（{today}）",
        }
    if not args.dry:
        PAGES_INFO.write_text(
            json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"  已登记 {len(pages)} 页 → data/pages_info.json")
        for p in inbox_pngs:
            shutil.copy2(p, PROCESSED / p.name)
        print("  页图已就位 → data/processed/")
    else:
        print("  （演练）将登记这些页并拷贝页图")

    # ---------- 6. 切字 ----------
    print("\n—— 切字（grid 模式，一格一字）" + "-" * 28)
    for page in pages:
        n = blocks_of(page)
        if n and not args.dry:
            print(f"  第 {page} 页已有 {n} 个字块，跳过切字")
            continue
        run("crop_grid.py", PROCESSED / f"{page}.png", "--order", "row", dry=args.dry)

    # ---------- 7. 推算每页起始 + 锚点查验 ----------
    print("\n—— 推算每页对应关系" + "-" * 32)
    plan, starts = {}, {}
    cur = start
    for page in pages:
        n = blocks_of(page)
        starts[page] = cur
        gcount = n if n else 0
        plan[page] = {"gstart": 1, "gtail": gcount, "start": cur}
        cur = cur + gcount - overlap
        print(f"  {page}: {gcount} 块 → 碑文第 {starts[page]}~{starts[page] + gcount - 1} 字")

    anchor_png = DIST / f"锚点查验_{book}_{dt.date.today().strftime('%Y%m%d')}.png"
    print()
    run("make_anchor_check.py", "--plan", _plan_file(plan), "--text", text_path,
        "--out", anchor_png, dry=args.dry)

    if args.dry:
        print("\n（演练结束，以上就是要跑的步骤，没动任何文件）")
        return

    try:
        os.startfile(anchor_png)
        print(f"  已打开查验图：{anchor_png}")
    except Exception:
        print(f"  请手动打开查验图：{anchor_png}")

    # ---------- 8. 人工核对锚点（管线里唯一的人工判断） ----------
    print("\n—— 看图核对锚点" + "-" * 36)
    print(" 每页首三块/尾三块和释文对得上，就说明这一页切对了。")
    fix = ask("全都对得上直接回车；有不对的页，输入页名（空格分隔），我们逐页修", "")
    while fix:
        for page in fix.split():
            if page not in pages:
                print(f"  {page} 不在这批里，跳过")
                continue
            g = int(ask(f"{page}：首块是 G 几？（默认 1）", "1"))
            s = int(ask(f"{page}：G{g} 对应碑文第几字？", str(starts[page])))
            starts[page] = s
            plan[page] = {"gstart": g, "gtail": blocks_of(page), "start": s}
            # 修正后，后面的页按「本页末字 + 1 - overlap」重新顺推
            cur = s + (blocks_of(page) - g + 1) - overlap
            for later in pages[pages.index(page) + 1:]:
                starts[later] = cur
                plan[later] = {"gstart": 1, "gtail": blocks_of(later), "start": cur}
                cur = cur + blocks_of(later) - overlap
            print(f"  {page} 已修正；后面的页已按新起点重新顺推")
        run("make_anchor_check.py", "--plan", _plan_file(plan), "--text", text_path,
            "--out", anchor_png)
        try:
            os.startfile(anchor_png)
        except Exception:
            pass
        fix = ask("再看一眼新的查验图。还有要修的吗？回车=没有了", "")

    # ---------- 9. 对号入座 ----------
    print("\n—— 对号入座（填字）" + "-" * 32)
    for page in pages:
        p = plan[page]
        extra = ["--text", text_path]
        if p["gstart"] != 1:
            extra += ["--gstart", p["gstart"]]
        run("apply_text.py", page, "--start", p["start"], *extra)

    # ---------- 10. 制卡 + 打包（只制这一批） ----------
    print("\n—— 制卡（只制这一批，不碰别的页）" + "-" * 24)
    run("build_cards.py", *pages)
    print("\n—— 打包发放" + "-" * 40)
    run("pack_cards.py", *pages)

    # ---------- 11. 归档投递箱 ----------
    done_dir = INBOX / f"_已处理_{dt.date.today().strftime('%Y%m%d')}"
    done_dir.mkdir(exist_ok=True)
    for p in inbox_pngs + inbox_txts:
        shutil.move(str(p), done_dir / p.name)
    print(f"\n投递箱已清空，这批原图归档 → {done_dir.relative_to(ROOT)}")

    # ---------- 总结 ----------
    zips = sorted(DIST.glob(f"卡片包_第*页_{dt.date.today().strftime('%Y%m%d')}.zip"))
    print("\n" + "=" * 56)
    print(" 完成！发给组员的包：")
    for z in zips:
        print(f"   {z}")
    print(" 组员照包里的《填写说明》核对；交回后双击「一键_收卡片.bat」入库。")
    print("=" * 56)


def _plan_file(plan):
    """把 plan 落成临时文件给 make_anchor_check 用"""
    p = DIST / "_plan.json"
    p.write_text(json.dumps(plan, ensure_ascii=False), encoding="utf-8")
    return p


if __name__ == "__main__":
    main()
