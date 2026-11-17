# -*- coding: utf-8 -*-
import json, io, re
data=json.load(io.open(r"E:\proptest\ai-test\_work\cases.json",encoding="utf-8"))

# 80 list from scan
pending = []
for sheet,cases in data.items():
    for c in cases:
        if "待确认" in (c.get("备注","") or ""):
            pending.append((sheet,c.get("用例编号"),c.get("备注","")))

out=io.open(r"E:\proptest\ai-test\_work\pending_context.txt","w",encoding="utf-8")
for i,(sheet,cid,note) in enumerate(pending,1):
    segs=[]
    for m in re.finditer(r".{0,18}待确认.{0,30}", note):
        segs.append(m.group(0).replace("\n"," "))
    out.write(f"{i:>2}. {sheet}/{cid}\n")
    for s in segs:
        out.write(f"     …{s}…\n")
out.close()

# dump unseen cases
need = [
 ("基础设置",["基础数据-009","基础数据-019","作业选项-009","作业选项-011","作业选项-012"]),
 ("受付工作台",["履歴补充-053","履歴补充-054"]),
]
o2=io.open(r"E:\proptest\ai-test\_work\unseen_cases.txt","w",encoding="utf-8")
for sheet,l in need:
    idx={c.get("用例编号"):c for c in data[sheet]}
    for cid in l:
        c=idx[cid]
        o2.write(f"\n{'='*70}\n{sheet}/{cid} 优先级:{c.get('优先级')}\n")
        for k in ["用例标题","测试点","前置条件","测试步骤","预期结果","备注"]:
            o2.write(f"【{k}】{c.get(k,'')}\n")
o2.close()
print("pending count:", len(pending))
