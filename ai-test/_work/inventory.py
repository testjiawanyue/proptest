import json, re, io, sys
from collections import Counter, OrderedDict
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
with open(r"E:\proptest\ai-test\_work\cases.json", encoding="utf-8") as f:
    data = json.load(f)
out=[]
out.append("== 31条标注用例清单 ==")
n=0
for sheet, items in data.items():
    for d in items:
        note=d.get("备注","")
        m=re.findall(r"【(用例错误|用例存疑)】",note)
        if m:
            n+=1
            out.append(f"{n:>2}. [{sheet}] {d.get('用例编号','')} <{m[0]}> {d.get('用例标题','')[:28]}")
out.append("")
out.append("== 各Sheet功能点前缀及数量 ==")
for sheet, items in data.items():
    c=Counter()
    secs=OrderedDict()
    for d in items:
        tcid=d.get("用例编号","")
        pref=re.sub(r"-\d{3}(-错误)?$","",tcid)
        c[pref]+=1
        sec=d.get("所属章节","")
        secs.setdefault(pref,sec)
    out.append(f"-- {sheet} ({len(items)}条)")
    for pref,n2 in c.items():
        out.append(f"    {pref} x{n2}   章节:{secs[pref]}")
rep="\n".join(out)
with open(r"E:\proptest\ai-test\_work\inventory.txt","w",encoding="utf-8") as f:
    f.write(rep)
print(rep)