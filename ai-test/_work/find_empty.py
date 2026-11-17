# -*- coding: utf-8 -*-
import io
text=io.open(r"E:\proptest\ai-test\03-testcase\testcase-analysis-repaired.md",encoding="utf-8").read()
for l in text.splitlines():
    if l.startswith("| TC-"):
        cells=[c.strip() for c in l.strip("|").split("|")]
        if any(not c for c in cells[2:]):
            print(l[:400])
