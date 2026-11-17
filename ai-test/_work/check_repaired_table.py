# -*- coding: utf-8 -*-
import io, re
text=io.open(r"E:\proptest\ai-test\03-testcase\testcase-analysis-repaired.md",encoding="utf-8").read()
lines=text.splitlines()
# section 3 rows
start=next(i for i,l in enumerate(lines) if l.startswith("## 3."))
rows=[l for l in lines[start:] if l.startswith("| TC-")]
bad=[l for l in rows if re.search(r"\|\s*\|", l.replace("| TC | Sheet/编号 | 待确认原因 | 需确认规则 | 确认对象 |",""))]
# count empty cells
empty=0
for l in rows:
    cells=[c.strip() for c in l.strip("|").split("|")]
    empty+=sum(1 for c in cells[2:] if not c)
out=io.open(r"E:\proptest\ai-test\_work\repaired_table_check.txt","w",encoding="utf-8")
out.write(f"待确认表格行数:{len(rows)} 空单元格数:{empty}\n")
for l in rows[:4]+rows[-2:]:
    out.write(l+"\n")
out.close(); print("ok")
