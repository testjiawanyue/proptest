# -*- coding: utf-8 -*-
import openpyxl, json, io, sys

orig = openpyxl.load_workbook(r"E:\proptest\case\outputs\测试用例汇总\测试用例汇总.xlsx", data_only=True)
marked = openpyxl.load_workbook(r"E:\proptest\case\outputs\测试用例汇总\测试用例汇总_修改标注.xlsx", data_only=True)

FIELDS = ["序号","所属章节","用例标题","用例编号","测试点","优先级","前置条件","测试步骤","预期结果","测试结果","备注"]

def rows(ws):
    out=[]
    header=None
    for r in ws.iter_rows(values_only=True):
        if header is None:
            header=[str(c).strip() if c is not None else "" for c in r]
            continue
        if all(c is None or str(c).strip()=="" for c in r):
            continue
        d={}
        for i,h in enumerate(header):
            d[h]=("" if i>=len(r) or r[i] is None else str(r[i]).strip())
        out.append(d)
    return header,out

report=io.open(r"E:\proptest\ai-test\_work\xlsx_diff.txt","w",encoding="utf-8")
ndiff=0
for sn in orig.sheetnames:
    wo=orig[sn]; wm=marked[sn]
    ho,ro=rows(wo); hm,rm=rows(wm)
    report.write(f"===== SHEET: {sn}  orig={len(ro)} marked={len(rm)} =====\n")
    if len(ro)!=len(rm):
        report.write("  !!! ROW COUNT DIFF\n")
    for i,(a,b) in enumerate(zip(ro,rm)):
        diffs=[]
        for k in set(list(a.keys())+list(b.keys())):
            va=a.get(k,""); vb=b.get(k,"")
            if va!=vb:
                diffs.append((k,va,vb))
        if diffs:
            ndiff+=1
            cid=a.get("用例编号") or b.get("用例编号")
            report.write(f"-- row{i+1} id={cid}\n")
            for k,va,vb in diffs:
                report.write(f"   [{k}]\n     原: {va[:300]}\n     改: {vb[:300]}\n")
report.write(f"\nTOTAL DIFF ROWS: {ndiff}\n")
report.close()
print("done", ndiff)
