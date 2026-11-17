# -*- coding: utf-8 -*-
import json, io
data=json.load(io.open(r"E:\proptest\ai-test\_work\cases.json",encoding="utf-8"))
ids = [
 ("产品生产",["部件组装-021","部件组装-025","质检工作台-004","质检工作台-016"]),
 ("产品管理",["产品列表查询-006","产品列表查询-007","产品列表查询-008","产品删除-002"]),
]
out=io.open(r"E:\proptest\ai-test\_work\struct_mid.txt","w",encoding="utf-8")
for sheet, l in ids:
    idx={c.get("用例编号"):c for c in data[sheet]}
    for cid in l:
        c=idx[cid]
        out.write(f"\n{'='*70}\n{sheet}/{cid} 优先级:{c.get('优先级')}\n")
        for k in ["用例标题","测试点","前置条件","测试步骤","预期结果","备注"]:
            out.write(f"【{k}】{c.get(k,'')}\n")
out.close()
print("ok")
