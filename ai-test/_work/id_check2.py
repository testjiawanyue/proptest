# -*- coding: utf-8 -*-
import json, io, re
data=json.load(io.open(r"E:\proptest\ai-test\_work\cases.json",encoding="utf-8"))

def find(sheet,cid):
    for c in data[sheet]:
        if c.get("用例编号")==cid: return c
    return None

# 编号占用检查
suf = [("基础设置","基础数据-001"),("基础设置","基础数据-002"),("基础设置","基础数据-011"),
       ("基础设置","作业选项-002"),("基础设置","作业选项-003"),("基础设置","作业选项-016"),("基础设置","作业选项-018"),
       ("产品生产","部件组装-001"),("产品生产","部件组装-009"),("产品生产","部件组装-010"),
       ("产品生产","质检工作台-006"),
       ("产品管理","产品列表查询-004"),("产品管理","产品部件操作-010")]
out=io.open(r"E:\proptest\ai-test\_work\id_occupy.txt","w",encoding="utf-8")
for s,cid in suf:
    c=find(s,cid)
    out.write(f"{s}/{cid}: {'被占用 -> '+c['用例标题'] if c else '空闲'}\n")
# 同时列出各sheet基础数据等功能点的最大编号，供重分配
out.close()
print("ok")
