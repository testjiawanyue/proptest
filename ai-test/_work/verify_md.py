# -*- coding: utf-8 -*-
import io, re, os, json
CASEDIR=r"E:\proptest\case"
MDNAME={"基础设置":"基础设置模块测试用例.md","客户管理":"客户管理模块测试用例.md",
 "产品生产":"产品生产模块测试用例.md","产品管理":"产品管理模块测试用例.md",
 "订单管理":"订单管理模块测试用例.md","点检管理":"点检管理模块测试用例.md",
 "受付工作台":"受付工作台模块测试用例.md","作业管理":"作业管理模块测试用例.md",
 "首页看板":"首页看板模块测试用例.md"}
repaired=json.load(io.open(r"E:\proptest\ai-test\_work\cases_repaired.json",encoding="utf-8"))
out=io.open(r"E:\proptest\ai-test\_work\md_verify.txt","w",encoding="utf-8")
for sheet,fn in MDNAME.items():
    text=io.open(os.path.join(CASEDIR,fn),encoding="utf-8").read()
    # extract blocks id + each field presence
    blocks=re.split(r"(?m)^(?=## )",text)
    ids=[]; bad=[]
    for b in blocks:
        m=re.search(r"### 用例编号[ \t]*\n([^\n#]+)",b)
        if not m: continue
        cid=m.group(1).strip(); ids.append(cid)
        for f in ["### 测试点","### 优先级","### 前置条件","### 测试步骤","### 预期结果","### 测试结果","### 备注"]:
            if f not in b: bad.append(cid+":"+f)
        # result empty
        rm=re.search(r"### 测试结果\s*\n(.*?)\n### ",b,re.S)
        if rm and rm.group(1).strip(): bad.append(cid+":测试结果非空")
    want=[c["用例编号"] for c in repaired[sheet]]
    miss=set(want)-set(ids); extra=set(ids)-set(want)
    dup=[i for i in set(ids) if ids.count(i)>1]
    out.write(f"{sheet}: md={len(ids)} want={len(want)} 缺:{sorted(miss)} 余:{sorted(extra)} 重:{dup} 结构问题:{bad[:5]}\n")
out.close(); print("ok")
