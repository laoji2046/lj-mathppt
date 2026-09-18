#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MinerU 试卷解析 POC —— 把一张试卷（图片 / PDF / Office）转成 Markdown + 结构化 JSON。

只用 Python 标准库，零第三方依赖。

用法
----
  # 1) 免 Token 模式（轻量 API，只出 Markdown；单文件 <=10MB / <=20 页）
  python mineru_poc.py 试卷.jpg

  # 2) 精准模式（需 Token，出 Markdown + JSON + 裁好的图片；<=200MB / <=600 页）
  set MINERU_TOKEN=你的token          # Windows CMD
  $env:MINERU_TOKEN="你的token"       # Windows PowerShell
  export MINERU_TOKEN=你的token       # bash
  python mineru_poc.py 试卷.pdf --precision

  # 3) 不传文件，用官方样例先跑通链路
  python mineru_poc.py --demo

Token 免费申请：https://mineru.net/apiManage/token
"""

import argparse
import http.client
import io
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from collections import Counter
from urllib.parse import urlsplit

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

OFFICIAL_BASE = "https://mineru.net"
DEMO_URL = "https://cdn-mineru.openxlab.org.cn/demo/example.pdf"

BASE = OFFICIAL_BASE
PROXY = ""  # 非空时，上传与下载也一并走该代理（绕 CORS）

EP_AGENT_FILE = ""
EP_AGENT_URL = ""
EP_AGENT_QUERY = ""
EP_PREC_TASK = ""
EP_PREC_TASK_QUERY = ""
EP_PREC_UPLOAD = ""
EP_PREC_BATCH_QUERY = ""


def set_base(base):
    """切换 API 基址。非官方基址视为代理，上传/下载也走它。"""
    global BASE, PROXY
    global EP_AGENT_FILE, EP_AGENT_URL, EP_AGENT_QUERY
    global EP_PREC_TASK, EP_PREC_TASK_QUERY, EP_PREC_UPLOAD, EP_PREC_BATCH_QUERY
    BASE = base.rstrip("/")
    PROXY = "" if BASE == OFFICIAL_BASE else BASE
    EP_AGENT_FILE = BASE + "/api/v1/agent/parse/file"
    EP_AGENT_URL = BASE + "/api/v1/agent/parse/url"
    EP_AGENT_QUERY = BASE + "/api/v1/agent/parse/{}"
    EP_PREC_TASK = BASE + "/api/v4/extract/task"
    EP_PREC_TASK_QUERY = BASE + "/api/v4/extract/task/{}"
    EP_PREC_UPLOAD = BASE + "/api/v4/file-urls/batch"
    EP_PREC_BATCH_QUERY = BASE + "/api/v4/extract-results/batch/{}"


def route_upload(url):
    """经代理时，把 OSS 签名地址包一层。"""
    if not PROXY:
        return url
    return PROXY + "/upload?to=" + urllib.parse.quote(url, safe="")


def route_download(url):
    """经代理时，把结果包地址包一层。"""
    if not PROXY:
        return url
    return PROXY + "/download?to=" + urllib.parse.quote(url, safe="")


set_base(OFFICIAL_BASE)


# --------------------------------------------------------------------------
# HTTP 小工具
# --------------------------------------------------------------------------

def die(msg):
    print("\n[ERROR] " + str(msg), file=sys.stderr)
    sys.exit(1)


def is_url(s):
    return s.startswith("http://") or s.startswith("https://")


def http_json(method, url, payload=None, token=None, timeout=120):
    body = None
    headers = {}
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        die("HTTP {} {}\n{}".format(e.code, e.reason, detail))


def http_put_file(url, path, timeout=900):
    """PUT 上传到 OSS 签名地址。

    坑：urllib 会自作主张给带 body 的请求塞一个
    Content-Type: application/x-www-form-urlencoded，
    而 OSS 签名是按「空 Content-Type」计算的，一塞就 SignatureDoesNotMatch。
    所以这里必须绕开 urllib，直接用 http.client —— 它不会自动加 Content-Type。
    """
    data = pathlib.Path(path).read_bytes()
    parts = urlsplit(url)
    target = parts.path + (("?" + parts.query) if parts.query else "")
    conn_cls = (http.client.HTTPSConnection if parts.scheme == "https"
                else http.client.HTTPConnection)
    conn = conn_cls(parts.netloc, timeout=timeout)
    try:
        conn.request("PUT", target, body=data)
        resp = conn.getresponse()
        body = resp.read()
        if resp.status >= 400:
            die("上传失败 HTTP {} {}\n{}".format(
                resp.status, resp.reason, body.decode("utf-8", "replace")))
        return resp.status
    finally:
        conn.close()


def http_get_bytes(url, timeout=900):
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        die("下载失败 HTTP {} {}".format(e.code, e.reason))


def human(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return "{:.1f}{}".format(n, unit)
        n /= 1024.0
    return "{:.1f}TB".format(n)


# --------------------------------------------------------------------------
# 轮询
# --------------------------------------------------------------------------

def poll(query_url, token, args, picker, label="解析"):
    """通用轮询。picker(data) 返回非 None 即视为完成。"""
    t0 = time.time()
    last = None
    while True:
        r = http_json("GET", query_url, token=token)
        if r.get("code") != 0:
            die("查询失败: " + json.dumps(r, ensure_ascii=False))
        data = r.get("data") or {}

        state = data.get("state")
        if state == "failed":
            die("{}失败: err_code={} err_msg={}".format(
                label, data.get("err_code"), data.get("err_msg")))

        got = picker(data)
        if got:
            return got

        if state != last:
            print("    状态: {}".format(state))
            last = state

        elapsed = time.time() - t0
        if args.timeout and elapsed > args.timeout:
            die("等待超时（{}s）。可用 --timeout 调大。".format(args.timeout))
        time.sleep(args.interval)


# --------------------------------------------------------------------------
# 免 Token 模式（轻量 API，只出 Markdown）
# --------------------------------------------------------------------------

def run_agent(target, outdir, args):
    print("[1/4] 提交任务（轻量 API · 无需 Token）")

    if is_url(target):
        payload = {
            "url": target,
            "is_ocr": args.ocr,
            "enable_formula": True,
            "enable_table": True,
            "language": "ch",
        }
        if args.pages:
            payload["page_range"] = args.pages
        r = http_json("POST", EP_AGENT_URL, payload)
        if r.get("code") != 0:
            die("提交失败: " + json.dumps(r, ensure_ascii=False))
        task_id = r["data"]["task_id"]
    else:
        name = pathlib.Path(target).name
        payload = {
            "file_name": name,
            "is_ocr": args.ocr,
            "enable_formula": True,
            "enable_table": True,
            "language": "ch",
        }
        if args.pages:
            payload["page_range"] = args.pages
        r = http_json("POST", EP_AGENT_FILE, payload)
        if r.get("code") != 0:
            die("提交失败: " + json.dumps(r, ensure_ascii=False))
        task_id = r["data"]["task_id"]
        upload_url = r["data"]["file_url"]
        print("    task_id = {}".format(task_id))
        print("[2/4] 上传文件（{}）".format(human(pathlib.Path(target).stat().st_size)))
        http_put_file(route_upload(upload_url), target)

    print("[3/4] 等待解析…")
    md_url = poll(EP_AGENT_QUERY.format(task_id), None, args,
                  lambda d: d.get("markdown_url"))
    print("[4/4] 下载 Markdown")
    md = http_get_bytes(route_download(md_url)).decode("utf-8", "replace")
    out = pathlib.Path(outdir) / "full.md"
    out.write_text(md, encoding="utf-8")
    print("    -> {}".format(out))


# --------------------------------------------------------------------------
# 精准模式（需 Token，出 Markdown + JSON + 图片）
# --------------------------------------------------------------------------

def run_precision(target, outdir, args, token):
    print("[1/4] 提交任务（精准 API）")

    if is_url(target):
        payload = {
            "url": target,
            "is_ocr": args.ocr,
            "enable_formula": True,
            "enable_table": True,
            "language": "ch",
            "model_version": args.model,
        }
        if args.pages:
            payload["page_ranges"] = args.pages
        r = http_json("POST", EP_PREC_TASK, payload, token=token)
        if r.get("code") != 0:
            die("提交失败: " + json.dumps(r, ensure_ascii=False))
        task_id = r["data"]["task_id"]
        print("    task_id = {}".format(task_id))
        print("[2/4] 跳过上传（远端 URL）")
        query_url = EP_PREC_TASK_QUERY.format(task_id)
        picker = lambda d: d.get("full_zip_url")
    else:
        name = pathlib.Path(target).name
        payload = {
            "enable_formula": True,
            "enable_table": True,
            "language": "ch",
            "model_version": args.model,
            "files": [{"name": name, "is_ocr": args.ocr}],
        }
        if args.pages:
            payload["files"][0]["page_ranges"] = args.pages
        r = http_json("POST", EP_PREC_UPLOAD, payload, token=token)
        if r.get("code") != 0:
            die("提交失败: " + json.dumps(r, ensure_ascii=False))
        batch_id = r["data"]["batch_id"]
        upload_urls = r["data"]["file_urls"]
        print("    batch_id = {}".format(batch_id))
        print("[2/4] 上传文件（{}）".format(human(pathlib.Path(target).stat().st_size)))
        http_put_file(route_upload(upload_urls[0]), target)
        query_url = EP_PREC_BATCH_QUERY.format(batch_id)
        picker = lambda d: next(
            (x.get("full_zip_url") for x in (d.get("extract_result") or [])
             if x.get("state") == "done" and x.get("full_zip_url")), None)
        # 批量接口里失败要单独判
        def _batch_check(d):
            for x in (d.get("extract_result") or []):
                if x.get("state") == "failed":
                    die("解析失败: " + str(x.get("err_msg")))
        orig = picker
        picker = lambda d: (_batch_check(d), orig(d))[1]

    print("[3/4] 等待解析…")
    zip_url = poll(query_url, token, args, picker)
    print("[4/4] 下载并解压结果包")
    blob = http_get_bytes(route_download(zip_url))
    out = pathlib.Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        z.extractall(out)


# --------------------------------------------------------------------------
# 结果摘要
# --------------------------------------------------------------------------

def summarize(outdir):
    root = pathlib.Path(outdir)
    files = sorted(p for p in root.rglob("*") if p.is_file())
    if not files:
        print("\n（没有产出文件）")
        return

    print("\n=== 产物清单 ===")
    for p in files:
        print("  {:>9}  {}".format(human(p.stat().st_size), p.relative_to(root)))

    cls = [p for p in files if p.name.endswith("content_list.json")]
    if not cls:
        md = root / "full.md"
        if md.exists():
            text = md.read_text(encoding="utf-8")
            print("\n=== Markdown 预览（前 600 字）===")
            print(text[:600])
            print("\n提示：轻量 API 只出 Markdown，没有 bbox / 元素类型。")
            print("      要做「语义切题」需要精准模式（--precision）拿 content_list.json。")
        return

    data = json.loads(cls[0].read_text(encoding="utf-8"))
    print("\n=== 版面元素统计（{} 个）===".format(len(data)))
    for k, v in Counter(x.get("type") for x in data).most_common():
        print("  {:<14} {}".format(k, v))

    print("\n=== 元素样例（前 3 条）===")
    for x in data[:3]:
        s = json.dumps(x, ensure_ascii=False)
        print("  " + (s[:240] + "…" if len(s) > 240 else s))

    print("\n=== 有 bbox 的元素数 ===")
    withbox = sum(1 for x in data if x.get("bbox"))
    print("  {} / {}".format(withbox, len(data)))


# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(
        description="MinerU 试卷解析 POC",
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("target", nargs="?", help="试卷文件路径，或远程 URL")
    ap.add_argument("--demo", action="store_true", help="用官方样例跑通链路")
    ap.add_argument("--precision", action="store_true",
                    help="用精准 API（需 MINERU_TOKEN），输出 Markdown + JSON + 图片")
    ap.add_argument("--token", default=os.environ.get("MINERU_TOKEN", ""),
                    help="MinerU Token，默认读环境变量 MINERU_TOKEN")
    ap.add_argument("--base", default=OFFICIAL_BASE,
                    help="API 基址。指向代理（如 http://127.0.0.1:8787）时，"
                         "上传与下载也会走代理，且无需本地 Token")
    ap.add_argument("--model", default="vlm",
                    choices=["pipeline", "vlm"], help="精准模式的模型版本，默认 vlm")
    ap.add_argument("--ocr", action="store_true", help="强制启用 OCR（拍照件建议开）")
    ap.add_argument("--pages", default="", help="页码范围，如 1-5")
    ap.add_argument("--out", default="", help="输出目录，默认 out/<文件名>")
    ap.add_argument("--interval", type=int, default=5, help="轮询间隔秒，默认 5")
    ap.add_argument("--timeout", type=int, default=900, help="最长等待秒，默认 900")
    args = ap.parse_args()
    set_base(args.base)
    via_proxy = bool(PROXY)

    target = DEMO_URL if args.demo else args.target
    if not target:
        ap.print_help()
        sys.exit(1)
    if not args.demo and not is_url(target) and not pathlib.Path(target).exists():
        die("文件不存在: " + target)

    if args.out:
        outdir = args.out
    else:
        stem = "demo" if args.demo else pathlib.Path(target).stem
        outdir = str(pathlib.Path(__file__).parent / "out" / stem)
    pathlib.Path(outdir).mkdir(parents=True, exist_ok=True)

    if args.precision:
        if not args.token and not via_proxy:
            die("精准模式需要 Token。\n"
                "  1) 到 https://mineru.net/apiManage/token 免费申请\n"
                "  2) export MINERU_TOKEN=你的token  （或 --token 传入）\n"
                "  3) 或者用 --base 指向代理，由代理注入 Token")
        print("模式: 精准 API (model_version={})".format(args.model))
        if via_proxy:
            print("通道: 经代理 {}".format(BASE))
        print("输入: {}".format(target))
        print("输出: {}\n".format(outdir))
        # 经代理时 Token 由代理注入，这里不传
        run_precision(target, outdir, args, None if via_proxy else args.token)
    else:
        print("模式: 轻量 API (免 Token，仅 Markdown)")
        if via_proxy:
            print("通道: 经代理 {}".format(BASE))
        print("输入: {}".format(target))
        print("输出: {}\n".format(outdir))
        run_agent(target, outdir, args)

    print("\n完成。")
    summarize(outdir)


if __name__ == "__main__":
    main()
