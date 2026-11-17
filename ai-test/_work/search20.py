# -*- coding: utf-8 -*-
import os, io
root=r"E:\proptest\spec9-29\spec\docs"
out=io.open(r"E:\proptest\ai-test\_work\search_20.txt","w",encoding="utf-8")
for d,_,fs in os.walk(root):
    for f in fs:
        if f.endswith(".md"):
            fp=os.path.join(d,f)
            try: lines=io.open(fp,encoding="utf-8").read().splitlines()
            except: continue
            for i,l in enumerate(lines,1):
                if "20日" in l or "20 日" in l or ("基准月" in l and ("日" in l)):
                    rel=os.path.relpath(fp,root)
                    out.write(f"{rel}:{i}: {l.strip()[:250]}\n")
out.close()
print("ok")
