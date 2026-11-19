#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Convert every source file under the console folder to UTF-8.

Windows editors on zh-CN systems may save GBK; Python needs UTF-8.
ASCII-only source on purpose.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXTS = {".py", ".html", ".css", ".js", ".bat", ".md", ".txt"}

fixed = 0
for dp, dn, fn in os.walk(ROOT):
    if "__pycache__" in dp or "build" in dp or "dist" in dp:
        continue
    for f in fn:
        if os.path.splitext(f)[1].lower() not in EXTS:
            continue
        p = os.path.join(dp, f)
        raw = open(p, "rb").read()
        try:
            raw.decode("utf-8")
            continue
        except UnicodeDecodeError:
            pass
        txt = raw.decode("gbk", errors="replace")
        open(p, "wb").write(txt.encode("utf-8"))
        print("FIX", os.path.relpath(p, ROOT))
        fixed += 1

print("fixed", fixed, "file(s)")
sys.exit(0)
