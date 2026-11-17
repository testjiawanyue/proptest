# -*- coding: utf-8 -*-
import sys, json, io, os, re, copy
sys.path.insert(0,r"E:\proptest\ai-test\_work")
import repairs_data as D1
import repairs_data2 as D2
import openpyxl
from openpyxl.styles import PatternFill, Alignment

WORK=r"E:\proptest\ai-test"
CASEDIR=r"E:\proptest\case"
SRCXLSX=CASEDIR+r"\outputs\测试用例汇总\测试用例汇总_修改标注.xlsx"
OUTXLSX=CASEDIR+r"\outputs\测试用例汇总\测试用例汇总_V2.xlsx"
MDNAME={"基础设置":"基础设置模块测试用例.md","客户管理":"客户管理模块测试用例.md",
 "产品生产":"产品生产模块测试用例.md","产品管理":"产品管理模块测试用例.md",
 "订单管理":"订单管理模块测试用例.md","点检管理":"点检管理模块测试用例.md",
 "受付工作台":"受付工作台模块测试用例.md","作业管理":"作业管理模块测试用例.md",
 "首页看板":"首页看板模块测试用例.md"}
FIELDMAP={"用例标题":"用例标题","测试点":"测试点","优先级":"优先级","前置条件":"前置条件",
 "测试步骤":"测试步骤","预期结果":"预期结果","测试结果":"测试结果","备注":"备注"}

orig=json.load(io.open(WORK+r"\_work\cases.json",encoding="utf-8"))
data=copy.deepcopy(orig)

# index
idxmap={}
for sheet,cases in data.items():
    m={c["用例编号"]:i for i,c in enumerate(cases)}
    idxmap[sheet]=m

applied=[]  # final rows with old/new
for e in D1.EDITS:
    i=idxmap[e["sheet"]][e["oldid"]]
    c=data[e["sheet"]][i]
    old=copy.deepcopy(c)
    for k,v in e["fields"].items():
        c[k]=v
    c["用例编号"]=e["newid"]
    # rebuild index entry
    del idxmap[e["sheet"]][e["oldid"]]; idxmap[e["sheet"]][e["newid"]]=i
    applied.append(dict(sheet=e["sheet"],oldid=e["oldid"],newid=e["newid"],
        status=e["status"],old=old,new=copy.deepcopy(c),basis=e["basis"],issue=e["orig_issue"],target="both"))
mdonly=[]
for e in D2.EDITS2:
    if e["target"]=="md":
        # fetch content from original (block exists only in md); synthesize new block from fields
        mdonly.append(e); continue
    i=idxmap[e["sheet"]][e["oldid"]]
    c=data[e["sheet"]][i]
    old=copy.deepcopy(c)
    for k,v in e["fields"].items():
        c[k]=v
    if e["newid"]!=e["oldid"]:
        c["用例编号"]=e["newid"]
        del idxmap[e["sheet"]][e["oldid"]]; idxmap[e["sheet"]][e["newid"]]=i
    applied.append(dict(sheet=e["sheet"],oldid=e["oldid"],newid=e["newid"],
        status=e["status"],old=old,new=copy.deepcopy(c),basis=e["basis"],issue=e["orig_issue"],target="both"))

# ---------- validations ----------
errs=[]
for sheet,cases in data.items():
    ids=[c["用例编号"] for c in cases]
    if len(ids)!=len(set(ids)):
        errs.append(f"{sheet} 编号重复")
    for c in cases:
        if (c.get("测试结果") or "").strip()!="":
            errs.append(f"{sheet}/{c['用例编号']} 测试结果非空")
        for k in ["用例标题","测试点","前置条件","测试步骤","预期结果"]:
            if not (c.get(k) or "").strip():
                errs.append(f"{sheet}/{c['用例编号']} 字段{k}为空")
# uniqueness across all sheets
allids=[c["用例编号"] for cases in data.values() for c in cases]
if len(allids)!=len(set(allids)): errs.append("全局编号重复")
print("总用例:",len(allids),"修改行:",len(applied),"md-only:",len(mdonly))
print("校验错误:",errs if errs else "无")

# save repaired json
json.dump(data,io.open(WORK+r"\_work\cases_repaired.json","w",encoding="utf-8"),ensure_ascii=False,indent=1)

# ---------- V2 xlsx ----------
wb=openpyxl.load_workbook(SRCXLSX)
HIGHLIGHT=PatternFill(start_color="FFF2CC",end_color="FFF2CC",fill_type="solid")
rowmarks={}
for sheet,cases in orig.items():
    rowmarks[sheet]={c["用例编号"] for c in cases}
changed_by_sheet={}
for a in applied:
    changed_by_sheet.setdefault(a["sheet"],{})[a["oldid"]]=a
for ws in wb.worksheets:
    header=[c.value for c in ws[1]]
    colidx={str(h).strip():j+1 for j,h in enumerate(header) if h}
    idcol=colidx["用例编号"]
    for r in range(2,ws.max_row+1):
        v=ws.cell(row=r,column=idcol).value
        if v is None: continue
        oldid=str(v).strip()
        ch=changed_by_sheet.get(ws.title,{}).get(oldid)
        if not ch: continue
        nc=ch["new"]
        for xlsxfield,j in colidx.items():
            key=FIELDMAP.get(xlsxfield)
            if key and key in nc:
                cell=ws.cell(row=r,column=j)
                val=nc[key]
                cell.value=val if val!="" else None
        # highlight whole used row
        for j in range(1,len(header)+1):
            ws.cell(row=r,column=j).fill=HIGHLIGHT
wb.save(OUTXLSX)
print("xlsx saved:",OUTXLSX)

# ---------- module md sync ----------
BLOCK_TMPL=(
"## {用例标题}\n### 用例编号\n{用例编号}\n### 测试点\n{测试点}\n### 优先级\n{优先级}\n"
"### 前置条件\n{前置条件}\n### 测试步骤\n{测试步骤}\n### 预期结果\n{预期结果}\n"
"### 测试结果\n\n### 备注\n{备注}\n")

def find_block_span(text, oldid):
    pat=re.compile(r"### 用例编号[ \t]*\r?\n[ \t]*"+re.escape(oldid)+r"[ \t]*\r?\n")
    m=pat.search(text)
    if not m: return None
    ls=text.rfind("\n## ",0,m.start())
    start = 0 if ls==-1 else ls+1
    nxt=text.find("\n## ",m.end())
    end = len(text) if nxt==-1 else nxt+1
    return start,end

counts_md={}
for sheet in data:
    path=os.path.join(CASEDIR,MDNAME[sheet])
    text=io.open(path,encoding="utf-8").read()
    n=0
    for ch in [a for a in applied if a["sheet"]==sheet]:
        span=find_block_span(text,ch["oldid"])
        if not span: raise SystemExit(f"md block not found {sheet}/{ch['oldid']}")
        block=BLOCK_TMPL.format(**ch["new"])
        text=text[:span[0]]+block+text[span[1]:]
        n+=1
    io.open(path,"w",encoding="utf-8",newline="\n").write(text)
    counts_md[sheet]=n
# md-only blocks (rewrite via fields synthesized)
for e in mdonly:
    path=os.path.join(CASEDIR,MDNAME[e["sheet"]])
    text=io.open(path,encoding="utf-8").read()
    span=find_block_span(text,e["oldid"])
    if not span: raise SystemExit("md-only not found "+e["oldid"])
    c={"用例编号":e["newid"],"优先级":"高","测试结果":""}
    c.update(e["fields"])
    block=BLOCK_TMPL.format(**c)
    text=text[:span[0]]+block+text[span[1]:]
    io.open(path,"w",encoding="utf-8",newline="\n").write(text)
    counts_md[e["sheet"]]=counts_md.get(e["sheet"],0)+1
print("md blocks updated:",counts_md)
