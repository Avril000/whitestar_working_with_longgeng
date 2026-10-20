"""一条龙（反向）：组员填好的卡片 → 字形库 → 网页能用的数据

它做的事（按顺序）：
    1. 把三张 csv 的填写内容回填进字形库（meta + glyphs.json）
    2. 生成本地网页能直接读的 web/data.js，并把单字图同步过去
    3. 报一遍演示例句的缺口（哪 12 个字齐了没）
    4. 告诉你网页在哪，双击就能看

用法（或双击根目录「一键_收卡片.bat」）：
    python tools/pipeline_in.py
"""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"

# 关掉输出缓冲：不然父进程打印的内容会跑到子进程输出后面，看着像乱序
try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass


def run(script):
    r = subprocess.run([sys.executable, str(TOOLS / script)])
    if r.returncode != 0:
        print(f"\n[失败] {script} 出错了，先停在这里。")
        sys.exit(r.returncode)


def main():
    print("=" * 56)
    print("第一步：把卡片内容回填进字形库")
    print("=" * 56)
    run("merge_cards.py")

    print("\n" + "=" * 56)
    print("第二步：生成网页能读的数据（web/data.js）")
    print("=" * 56)
    run("build_manifest.py")

    print("\n" + "=" * 56)
    print("第三步：看看演示例句的字凑齐了没")
    print("=" * 56)
    run("check_goals.py")

    index = ROOT / "web" / "index.html"
    if index.exists():
        print("\n下一步：双击打开 web\\index.html，就能看到真字形了。")
        print("（断网也能开，不用起服务器）")


if __name__ == "__main__":
    main()
