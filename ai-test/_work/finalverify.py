# -*- coding: utf-8 -*-
import io, re
md=io.open(r"E:\proptest\case\产品管理模块测试用例.md",encoding="utf-8").read()
blocks=re.split(r"(?m)^(?=## )", md)
out=io.open(r"E:\proptest\ai-test\_work\del002_block.txt","w",encoding="utf-8")
for b in blocks:
    m=re.search(r"### 用例编号\s*\n([^\n]+)", b)
    if m and "产品删除-002" in m.group(1):
        out.write(b)
out.close()

# verify content of note-only cases
import json
data=json.load(io.open(r"E:\proptest\ai-test\_work\cases.json",encoding="utf-8"))
checks=[("作业管理","作业列表查询-006"),("作业管理","部件更换拆除-001"),("作业管理","部件更换拆除-003"),("作业管理","最终处理-005"),
        ("订单管理","新建订单-006"),("订单管理","新建订单-007"),("产品生产","衣体入库-020"),("产品生产","产品生产权限-004"),
        ("订单管理","发货管理-012"),("产品管理","产品列表数据关联-004"),("客户管理","客户列表查询-010"),
        ("产品生产","部件组装-019"),("产品生产","质检工作台-005"),("产品管理","产品列表查询-001")]
o2=io.open(r"E:\proptest\ai-test\_work\noteonly_check.txt","w",encoding="utf-8")
for s,cid in checks:
    for c in data[s]:
        if c["用例编号"]==cid:
            o2.write(f"\n{'='*60}\n{s}/{c['用例编号']}\n  标题:{c['用例标题']}\n  点:{c['测试点']}\n  前置:{c['前置条件']}\n  步骤:{c['测试步骤']}\n  预期:{c['预期结果']}\n  备注:{c['备注']}\n")
o2.close(); print("ok")
