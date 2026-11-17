# -*- coding: utf-8 -*-
import os, io, re
root=r"E:\proptest\spec9-29\spec\docs\features"
out=io.open(r"E:\proptest\ai-test\_work\spec_search.txt","w",encoding="utf-8")
kw_groups = {
 "空白trim": ["首尾空白","纯空格","空格","trim","去除输入"],
 "长度": ["最大长度","字符","桁数","maxLength","长度上限"],
 "唯一": ["唯一","重名","重复","判重"],
 "置灰": ["置灰","置为灰色","不可点击","禁用","disabled"],
 "确认": ["二次确认","确认弹窗","确认框"],
}
files=[]
for d,_,fs in os.walk(root):
    for f in fs:
        if f=="spec.md": files.append(os.path.join(d,f))
files.sort()
for g,kws in kw_groups.items():
    out.write(f"\n{'#'*30} {g} {'#'*30}\n")
    for fp in files:
        feat=os.path.basename(os.path.dirname(fp))
        lines=io.open(fp,encoding="utf-8").read().splitlines()
        for i,l in enumerate(lines,1):
            if any(k in l for k in kws):
                out.write(f"{feat}:{i}: {l.strip()[:200]}\n")
out.close()
print("ok")
