# -*- coding: utf-8 -*-
import json, io
data=json.load(io.open(r"E:\proptest\ai-test\_work\cases.json",encoding="utf-8"))
ids = [
 ("订单管理",["新建订单-006","新建订单-007","订单详情-010","发货管理-012","发货管理-014"]),
 ("受付工作台",["正式NG登记-005","受付作业边界-001","履歴补充-053","履歴补充-054","工作台补充-080","工作台补充-081"]),
 ("产品生产",["衣体入库-006","衣体入库-011","衣体入库-020","部件组装-019"]),
 ("客户管理",["客户权限-003","客户权限-004"]),
]
out=io.open(r"E:\proptest\ai-test\_work\pending_missing.txt","w",encoding="utf-8")
for sheet, l in ids:
    idx={c.get("用例编号"):c for c in data[sheet]}
    for cid in l:
        c=idx[cid]
        out.write(f"\n{'='*70}\n{sheet}/{cid} 优先级:{c.get('优先级')}\n")
        for k in ["用例标题","测试点","前置条件","测试步骤","预期结果","备注"]:
            out.write(f"【{k}】{c.get(k,'')}\n")
out.close()
print("ok")
