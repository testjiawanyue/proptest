# -*- coding: utf-8 -*-
import json, io, re, os
data=json.load(io.open(r"E:\proptest\ai-test\_work\cases.json",encoding="utf-8"))
M = {
 "基础设置":"基础设置模块测试用例.md","客户管理":"客户管理模块测试用例.md",
 "产品生产":"产品生产模块测试用例.md","产品管理":"产品管理模块测试用例.md",
 "订单管理":"订单管理模块测试用例.md","点检管理":"点检管理模块测试用例.md",
 "受付工作台":"受付工作台模块测试用例.md","作业管理":"作业管理模块测试用例.md",
 "首页看板":"首页看板模块测试用例.md",
}
out=io.open(r"E:\proptest\ai-test\_work\md_locate.txt","w",encoding="utf-8")
for sheet,cases in data.items():
    md=io.open(os.path.join(r"E:\proptest\case",M[sheet]),encoding="utf-8").read()
    # 用例块: ### 用例编号\n<id>
    ids=re.findall(r"### 用例编号\s*\n([^\n#]+)", md)
    ids=[x.strip() for x in ids]
    xids=set(c["用例编号"] for c in cases)
    miss=[i for i in xids if i not in ids]
    extra=[i for i in ids if i not in xids]
    dup=[i for i in set(ids) if ids.count(i)>1]
    out.write(f"{sheet}: xlsx={len(xids)} md={len(ids)} 缺:{len(miss)} 余:{len(extra)} 重:{len(dup)}\n")
    if miss: out.write("   缺: "+", ".join(miss[:15])+"\n")
    if extra: out.write("   余: "+", ".join(extra[:15])+"\n")
    if dup: out.write("   重: "+", ".join(dup[:15])+"\n")
out.close(); print("ok")
