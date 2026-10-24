"""把网页部署到班级共享服务器（副轨：在线展示）

设计原则（对应 docs/06 的双轨制）：
    主轨永远是本地双击 web/index.html——汇报演示以它为准，断网也不怕。
    这个脚本只负责副轨：把同一份静态文件传到服务器上跑一个静态服务。

    因为是纯静态（方案 C），服务器上不需要装任何东西，
    一行 python3 -m http.server 就够了，改文件也不用重新部署环境。

安全约定（红线，改之前先看 docs/06 第七节）：
    1. 只在服务器自己的目录 ~/jizi-19 里操作，绝不碰 /home/ubuntu/guji-jiaocuo
    2. 不执行 guji-restart.sh（那是古籍系统的）
    3. 服务器地址/账号/端口只存本地 deploy_config.json（已加 .gitignore），
       **密码一律不保存**：scp / ssh 会在窗口里问，自己敲，敲完就消失
    4. GitHub 才是正本，服务器只是副本

用法（平时双击根目录的「一键_部署到服务器.bat」即可）：
    python tools/deploy_server.py                 # 打包 + 上传 + 起服务 + 验证
    python tools/deploy_server.py --pack-only     # 只本地打包，不连服务器
"""

import argparse
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
DIST = ROOT / "dist"
PKG = DIST / "发布包"
CONFIG = ROOT / "deploy_config.json"

# 网页运行真正需要的东西：字形图已经以 base64 嵌进 data.js，
# web/glyphs/ 那 8MB 是给别的流程用的，服务器上一份都不用传
NEED = ["index.html", "style.css", "app.js", "data.js"]

try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass


def load_config():
    if CONFIG.exists():
        return json.loads(CONFIG.read_text(encoding="utf-8"))
    return {}


def save_config(cfg):
    CONFIG.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")


def pack():
    """把网页收成一个干净的发布包"""
    if PKG.exists():
        shutil.rmtree(PKG)
    PKG.mkdir(parents=True)

    total = 0
    for name in NEED:
        src = WEB / name
        if not src.exists():
            print(f"[停] 缺文件：{src}")
            sys.exit(1)
        shutil.copy2(src, PKG / name)
        total += src.stat().st_size
        print(f"  + {name}  {src.stat().st_size / 1024 / 1024:.2f} MB")

    for sub in ("assets",):
        d = WEB / sub
        if d.exists() and any(d.iterdir()):
            shutil.copytree(d, PKG / sub)
            print(f"  + {sub}/")

    print(f"  发布包就绪：{PKG}（{total / 1024 / 1024:.1f} MB，{len(NEED)} 个文件）")
    return PKG


def ssh_base(cfg):
    host, user = cfg["host"], cfg["user"]
    return ["-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pack-only", action="store_true", help="只本地打包，不连服务器")
    args = ap.parse_args()

    print("=" * 56)
    print(" 部署到班级服务器（副轨）")
    print("=" * 56)

    pkg = pack()
    if args.pack_only:
        print("\n（--pack-only，到此为止，没连服务器）")
        return

    cfg = load_config()
    cfg.setdefault("host", "81.71.14.93")
    cfg.setdefault("user", "guji")
    cfg.setdefault("dir", "jizi-19")

    print("\n服务器信息（只存在本地 deploy_config.json，不会进 git）")
    host = input(f"  地址（回车={cfg['host']}）: ").strip() or cfg["host"]
    user = input(f"  账号（回车={cfg['user']}）: ").strip() or cfg["user"]
    # 端口是服主分配的，每个人不同——不预设、不猜，每次由你确认
    default_port = str(cfg.get("port", ""))
    port = input(f"  端口号（你的专属端口{'，回车=' + default_port if default_port else '，必填'}）: ").strip()
    while not (port.isdigit() and 1000 <= int(port) <= 65535):
        port = input("  端口号要是 1000~65535 的数字，再输一次: ").strip()

    cfg.update({"host": host, "user": user, "port": int(port)})
    save_config(cfg)
    print(f"  已记住（下次直接回车即可）：{user}@{host}:{port}")

    target = f"{user}@{host}"
    remote_dir = cfg["dir"]
    files = [str(pkg / n) for n in NEED]

    print(f"\n—— 上传 {len(files)} 个文件 → ~/{remote_dir}/")
    print("  （窗口会问一次服务器密码，看不见输入是正常的，敲完回车就行）")
    sys.stdout.flush()
    cmd = ["scp", *ssh_base(cfg), *files, f"{target}:~/{remote_dir}/"]
    r = subprocess.run(cmd)
    if r.returncode != 0:
        print("\n[停] 上传失败。常见原因：密码输错 / 端口不对 / 服务器没开 SSH。")
        print("     把窗口里的报错原文发我，我看一眼。")
        sys.exit(r.returncode)

    print("\n—— 起静态服务（端口 %s）" % port)
    print("  （还要再问一次密码，同一个）")
    sys.stdout.flush()

    # ⚠️ 这里有两个坑，改之前先读：
    # 1）pkill -f 'http.server 端口' 会把**自己**也杀掉——这条 ssh 命令的命令行里
    #    就含这个字符串。写成 '[h]ttp.server' 是正则技巧：自身命令行是 "[h]ttp..."，
    #    不含 "http..."，于是只杀真正的服务进程。（2026-10-24 白星第一次部署就栽在这）
    # 2）别用 curl 在服务器上自检——curl 未必装了，一旦它返回非 0，
    #    明明起来了也会被判断成失败。改成我在本地探测端口，以事实为准。
    remote = (
        f"mkdir -p ~/{remote_dir} && cd ~/{remote_dir} && "
        f"PY=$(command -v python3 || command -v python) ; echo 解释器=$PY ; "
        f"pkill -f '[h]ttp.server {port}' 2>/dev/null ; "
        # 用「子 shell + 后台」启动：父 shell 不等它，stdout/stderr 全部落文件，
        # ssh 一退出也不会把服务带走（比直接 nohup ... & 稳）
        f"(nohup $PY -m http.server {port} --bind 0.0.0.0 "
        f"> server.log 2>&1 < /dev/null &) ; "
        f"sleep 3 ; "
        f"echo '--- 进程 ---' ; ps -ef | grep '[h]ttp.server {port}' | head -3 ; "
        f"echo '--- 日志 ---' ; tail -5 server.log 2>/dev/null"
    )
    r = subprocess.run(["ssh", *ssh_base(cfg), target, remote])
    if r.returncode != 0:
        print(f"\n（远程命令返回码 {r.returncode}（负数是被信号打断），"
              f"先不慌——下面我自己探一下端口）")

    # 成败以「外面真的能打开」为准，不看远程命令的脸色
    print("\n—— 验证（本地探测，最多等 12 秒）")
    ok = False
    for i in range(4):
        time.sleep(3)
        code = probe(host, int(port))
        if code:
            print(f"  第 {i + 1} 次探测：HTTP {code} ✓")
            ok = True
            break
        print(f"  第 {i + 1} 次探测：还没起来…")

    url = f"http://{host}:{port}/"
    print("\n" + "=" * 56)
    if ok:
        print(f" 部署完成 → {url}")
        print(" 打开看看能不能用；能用就发给组员一起玩。")
    else:
        print(" 文件传上去了，但端口还没起来。可能的原因：")
        print("   ① 服主还没在腾讯云防火墙放行这个端口（最常见）")
        print("   ② 服务器上没装 python3 / python")
        print("   ③ 端口被别人占了")
        print(" 把上面「解释器=」那一行发我，我一眼能看出是哪个。")
        print(" 另外可以直接问服主一句：5721 放行了吗？")
    print(" 提醒：汇报当天提前 30 分钟再确认一次（进程可能半夜挂掉）。")
    print(" 主轨别忘了：本地双击 web/index.html 才是保命的那一版。")
    print("=" * 56)


def probe(host, port, timeout=4):
    """从外面探一下这个端口到底能不能打开；返回 HTTP 状态码，不通返回 0"""
    import socket
    import urllib.request
    s = socket.socket()
    s.settimeout(timeout)
    try:
        if s.connect_ex((host, port)) != 0:
            return 0
    finally:
        s.close()
    try:
        r = urllib.request.urlopen(f"http://{host}:{port}/index.html", timeout=timeout)
        return r.status
    except Exception:
        return 0


if __name__ == "__main__":
    main()
