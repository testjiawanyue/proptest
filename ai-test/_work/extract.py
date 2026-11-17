import openpyxl, json, os, re, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
p = r"E:\proptest\case\outputs\测试用例汇总\测试用例汇总_修改标注.xlsx"
wb = openpyxl.load_workbook(p, read_only=True, data_only=True)
data = {}
total = 0
for ws in wb.worksheets:
    rows = list(ws.iter_rows(values_only=True))
    header = [str(c).strip() if c is not None else "" for c in rows[0]]
    items = []
    for r in rows[1:]:
        if all(c is None or str(c).strip()=="" for c in r):
            continue
        d = {}
        for i, h in enumerate(header):
            v = r[i] if i < len(r) else None
            d[h] = ("" if v is None else str(v).strip())
        items.append(d)
    data[ws.title] = items
    total += len(items)
wb.close()
os.makedirs(r"E:\proptest\ai-test\_work", exist_ok=True)
with open(r"E:\proptest\ai-test\_work\cases.json", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=1)
print("sheets:", list(data.keys()))
print("total cases:", total)
for k,v in data.items():
    print(f"  {k}: {len(v)}")