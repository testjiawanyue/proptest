# -*- coding: utf-8 -*-
import sys, json, io
sys.path.insert(0,r"E:\proptest\ai-test\_work")
import repairs_data as D1
import repairs_data2 as D2

data=json.load(io.open(r"E:\proptest\ai-test\_work\cases.json",encoding="utf-8"))
# 80 清单
pending80=set()
for sheet,cases in data.items():
    for c in cases:
        if "待确认" in (c.get("备注","") or ""):
            pending80.add((sheet,c["用例编号"]))

allkeys={}
for e in D1.EDITS:
    allkeys.setdefault((e["sheet"],e["oldid"]),[]).append("D1")
for e in D2.EDITS2:
    if e["target"]=="both":
        allkeys.setdefault((e["sheet"],e["oldid"]),[]).append("D2")

covered=set(k for k in allkeys if k in pending80)
missing=pending80-covered
extra_pending=[k for k in covered]
print("80待确认总数:",len(pending80))
print("被EDITS覆盖:",len(covered))
print("未覆盖:",len(missing))
for m in sorted(missing): print("  MISS:",m)
# 重复键
dups=[(k,v) for k,v in allkeys.items() if len(v)>1]
print("重复修改键:",dups)
