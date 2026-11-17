# -*- coding: utf-8 -*-
import json, io, re
data=json.load(io.open(r"E:\proptest\ai-test\_work\cases.json",encoding="utf-8"))

out=io.open(r"E:\proptest\ai-test\_work\scan_flags.txt","w",encoding="utf-8")
total=0
cats={}
pending=[]
for sheet,cases in data.items():
    total+=len(cases)
    for c in cases:
        note=c.get("备注","") or ""
        cid=c.get("用例编号","")
        tags=re.findall(r"【[^】]+】",note)
        for t in tags:
            cats.setdefault(t,[]).append(f"{sheet}/{cid}")
        if "待确认" in note:
            pending.append(f"{sheet}/{cid}")
out.write(f"总用例: {total}\n\n== 标签统计 ==\n")
for t,v in sorted(cats.items(),key=lambda x:-len(x[1])):
    out.write(f"{t} x{len(v)}\n")
out.write(f"\n含'待确认'字样: {len(pending)}\n")
for p in pending:
    out.write(p+"\n")
out.close()
print("ok")
