# -*- coding: utf-8 -*-
import json, io, os, re
WORK=r"E:\proptest\ai-test"; CASEDIR=r"E:\proptest\case"
repaired=json.load(io.open(WORK+r"\_work\cases_repaired.json",encoding="utf-8"))
MDNAME={"基础设置":"基础设置模块测试用例.md","客户管理":"客户管理模块测试用例.md",
 "产品生产":"产品生产模块测试用例.md","产品管理":"产品管理模块测试用例.md",
 "订单管理":"订单管理模块测试用例.md","点检管理":"点检管理模块测试用例.md",
 "受付工作台":"受付工作台模块测试用例.md","作业管理":"作业管理模块测试用例.md",
 "首页看板":"首页看板模块测试用例.md"}
BLOCK_TMPL=(
"## {用例标题}\n### 用例编号\n{用例编号}\n### 测试点\n{测试点}\n### 优先级\n{优先级}\n"
"### 前置条件\n{前置条件}\n### 测试步骤\n{测试步骤}\n### 预期结果\n{预期结果}\n"
"### 测试结果\n\n### 备注\n{备注}\n")
def span_by_id(text,cid):
    pat=re.compile(r"### 用例编号[ \t]*\r?\n[ \t]*"+re.escape(cid)+r"[ \t]*\r?\n")
    m=pat.search(text)
    if not m: return None
    ls=text.rfind("\n## ",0,m.start()); start=0 if ls==-1 else ls+1
    nxt=text.find("\n## ",m.end()); end=len(text) if nxt==-1 else nxt+1
    return start,end
log=io.open(WORK+r"\_work\md_resync.txt","w",encoding="utf-8")
for sheet,cases in repaired.items():
    path=os.path.join(CASEDIR,MDNAME[sheet]); text=io.open(path,encoding="utf-8").read()
    n=0
    for c in cases:
        sp=span_by_id(text,c["用例编号"])
        if not sp:
            log.write(f"NOT FOUND {sheet}/{c['用例编号']}\n"); continue
        want=BLOCK_TMPL.format(**c)
        if text[sp[0]:sp[1]]!=want:
            text=text[:sp[0]]+want+text[sp[1]:]; n+=1
    io.open(path,"w",encoding="utf-8",newline="\n").write(text)
    log.write(f"{sheet}: {n} blocks refreshed\n")
log.close(); print("done")
