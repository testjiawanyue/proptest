import json, re, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
with open(r"E:\proptest\ai-test\_work\cases.json", encoding="utf-8") as f:
    data = json.load(f)
out=[]
for sheet, items in data.items():
    for d in items:
        note = d.get("备注","")
        tags = re.findall(r"【(用例错误|用例存疑)】", note)
        if tags:
            out.append("="*80)
            out.append(f"[{sheet}] {d.get('用例编号','')}  标注:{tags[0]}  优先级:{d.get('优先级','')}")
            out.append(f"标题: {d.get('用例标题','')}")
            out.append(f"测试点: {d.get('测试点','')}")
            out.append(f"章节: {d.get('所属章节','')}")
            out.append(f"前置: {d.get('前置条件','')}")
            out.append(f"步骤: {d.get('测试步骤','')}")
            out.append(f"预期: {d.get('预期结果','')}")
            out.append(f"备注: {note}")
rep="\n".join(out)
with open(r"E:\proptest\ai-test\_work\flagged.txt","w",encoding="utf-8") as f:
    f.write(rep)
print("flagged records:", sum(1 for s in data.values() for d in s if re.findall(r"【(用例错误|用例存疑)】", d.get("备注",""))))
print("chars:", len(rep))