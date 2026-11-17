# -*- coding: utf-8 -*-
import json, io
data=json.load(io.open(r"E:\proptest\ai-test\_work\cases.json",encoding="utf-8"))
print(type(data))
if isinstance(data,dict):
    for k,v in data.items():
        print(k, type(v), len(v))
        if isinstance(v,list) and v:
            print(json.dumps(v[0],ensure_ascii=False,indent=1)[:800])
            break
