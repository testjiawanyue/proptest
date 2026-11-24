# -*- coding: utf-8 -*-
"""W1-02/W1-03 质量基线与环境指纹采集器（只读）。"""
from __future__ import annotations
import hashlib, json, os, platform, re, shutil, socket, subprocess, sys, time, urllib.error, urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any
import openpyxl

VERSION = "1.1"
ROOT = Path(r"E:\proptest")
QUALITY_ROOT = ROOT / "systemquality"
PROP = ROOT / "prop_new"
V5 = ROOT / "case" / "outputs" / "测试用例汇总" / "测试用例汇总_V5.xlsx"
AUTO = ROOT / "auto-explore"
BUSINESS_SHEETS = ["基础设置","客户管理","产品生产","产品管理","订单管理","历史补录","点检管理","受付工作台","作业管理","首页看板","端到端补充用例","V5缺口补充用例"]

def now_iso() -> str:
    return datetime.now().astimezone().replace(microsecond=0).isoformat()

def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def file_meta(path: Path) -> dict:
    st = path.stat()
    return {"path": str(path), "sizeBytes": st.st_size, "lastWriteTime": datetime.fromtimestamp(st.st_mtime).astimezone().isoformat(), "sha256": sha256(path)}

def read_text(path: Path) -> str:
    data = path.read_bytes()
    for enc in ("utf-8-sig", "utf-8", "gb18030", "cp932", "latin1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            pass
    return data.decode("latin1", errors="replace")

def run(args: list[str], cwd: Path | None = None, timeout: int = 30, env: dict | None = None) -> dict:
    try:
        p = subprocess.run(args, cwd=str(cwd) if cwd else None, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout, env=env)
        return {"command": " ".join(args), "code": p.returncode, "stdout": p.stdout.strip(), "stderr": p.stderr.strip()}
    except Exception as exc:
        return {"command": " ".join(args), "error": str(exc)}

def first_line(result: dict) -> str:
    text = "\n".join(x for x in [result.get("stdout", ""), result.get("stderr", "")] if x)
    return next((x.strip() for x in text.splitlines() if x.strip()), result.get("error", ""))

def parse_env(path: Path) -> tuple[dict, str | None]:
    if not path.exists():
        return {}, None
    vals = {}
    for line in read_text(path).splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            vals[k.strip()] = v.strip().strip('\"').strip("'")
    return vals, sha256(path)

def parse_jdbc(url: str) -> dict:
    if not url:
        return {"configured": False}
    m = re.match(r"jdbc:mysql://([^/]+)/([^?]+)(?:\?(.*))?$", url, re.I)
    if not m:
        return {"configured": True, "parseStatus": "unparsed"}
    hp, db, query = m.groups()
    if "@" in hp:
        hp = hp.rsplit("@", 1)[1]
    host, port = hp.rsplit(":", 1) if ":" in hp else (hp, "3306")
    return {"configured": True, "host": host, "port": int(port), "database": db, "query": query or "", "parseStatus": "parsed"}

def files_under(path: Path, exclude: set[str] | None = None) -> list[Path]:
    exclude = exclude or set()
    if not path.exists():
        return []
    return [p for p in path.rglob("*") if p.is_file() and not any(part in p.parts for part in exclude)]

def capture_workbook() -> dict:
    wb = openpyxl.load_workbook(V5, read_only=True, data_only=True)
    business, status_totals, priority_totals, priority_status = [], {}, {}, {}
    for name in BUSINESS_SHEETS:
        rows = [r for r in wb[name].iter_rows(min_row=2, values_only=True) if len(r) > 3 and r[3] not in (None, "") and str(r[3]).strip()]
        statuses, priorities = {}, {}
        for r in rows:
            status = str(r[18]).strip() if len(r) > 18 and r[18] not in (None, "") else "空白"
            priority = str(r[5]).strip() if len(r) > 5 and r[5] not in (None, "") else "空白"
            statuses[status] = statuses.get(status, 0) + 1
            priorities[priority] = priorities.get(priority, 0) + 1
            status_totals[status] = status_totals.get(status, 0) + 1
            priority_totals[priority] = priority_totals.get(priority, 0) + 1
            priority_status.setdefault(priority, {})
            priority_status[priority][status] = priority_status[priority].get(status, 0) + 1
        business.append({"sheet": name, "effectiveRows": len(rows), "statusCounts": statuses, "priorityCounts": priorities})
    def nonempty(sheet: str, col: int) -> int:
        return sum(1 for r in wb[sheet].iter_rows(min_row=2, values_only=True) if col < len(r) and r[col] not in (None, "") and str(r[col]).strip())
    ids = {str(r[2]).strip() for r in wb["用例-需求映射"].iter_rows(min_row=2, values_only=True) if len(r) > 2 and r[2] not in (None, "") and str(r[2]).strip()}
    total = sum(x["effectiveRows"] for x in business)
    passed, not_run = status_totals.get("通过", 0), status_totals.get("未执行", 0)
    high = priority_status.get("高", {})
    high_total = priority_totals.get("高", 0)
    return {
        "file": file_meta(V5), "sheetCount": len(wb.sheetnames), "sheetNames": wb.sheetnames,
        "businessSheetCount": len(BUSINESS_SHEETS), "business": business,
        "totals": {
            "effectiveRows": total, "statusCounts": status_totals, "priorityCounts": priority_totals,
            "priorityStatus": priority_status, "passCount": passed, "passRate": round(passed/total, 6) if total else None,
            "notExecutedCount": not_run, "notExecutedRate": round(not_run/total, 6) if total else None,
            "highPriorityTotal": high_total, "highPriorityPassCount": high.get("通过", 0),
            "highPriorityPassRate": round(high.get("通过", 0)/high_total, 6) if high_total else None,
            "highPriorityNotExecutedCount": high.get("未执行", 0),
            "highPriorityNotExecutedRate": round(high.get("未执行", 0)/high_total, 6) if high_total else None,
        },
        "mapping": {"rowCount": nonempty("用例-需求映射", 2), "distinctCaseIds": len(ids)},
        "traceability": {"requirementRowCount": nonempty("需求追溯矩阵", 1)},
        "clarification": {"rowCount": nonempty("需求澄清清单", 1)},
        "baselineSpec": {"rowCount": nonempty("基线规格", 1)},
        "interpretation": "执行状态来自 V5 工作簿快照，不代表本次重新执行了测试。",
    }

def capture_tests() -> dict:
    prop_files = files_under(PROP, {".git", "node_modules", "target"})
    backend = [p for p in prop_files if p.suffix == ".java" and re.search(r"(Test|Tests|IT)\.java$", p.name)]
    frontend = [p for p in prop_files if p.suffix in {".mjs", ".js", ".ts"} and re.search(r"\.(test|spec)\.(mjs|js|ts)$", p.name)]
    bt = bp = bd = 0
    for p in backend:
        text = read_text(p)
        bt += len(re.findall(r"(?m)^\s*@Test\b", text))
        bp += len(re.findall(r"(?m)^\s*@ParameterizedTest\b", text))
        bd += len(re.findall(r"(?m)^\s*@Disabled\b", text))
    ft = fi = fs = 0
    for p in frontend:
        text = read_text(p)
        ft += len(re.findall(r"(?<![\w.])test\s*\(", text))
        fi += len(re.findall(r"(?<![\w.])it\s*\(", text))
        fs += len(re.findall(r"(?<![\w.])test\.skip\s*\(", text))
    return {"backendFiles": len(backend), "backendTestAnnotations": bt, "backendParameterizedAnnotations": bp,
            "backendDisabledAnnotations": bd, "backendTestMethodApprox": bt + bp,
            "frontendFiles": len(frontend), "frontendTestCallOccurrences": ft,
            "frontendItCallOccurrences": fi, "frontendSkippedCallOccurrences": fs,
            "note": "文件数可复现；方法/调用数为源码文本静态计数，不等同于实际执行数。"}

def capture_ai_test() -> dict:
    base = ROOT / "ai-test"
    stages = {}
    for d in sorted(p for p in base.iterdir() if p.is_dir() and p.name[:1].isdigit()):
        files = files_under(d)
        stages[d.name] = {"files": len(files), "latestWriteTime": max((datetime.fromtimestamp(p.stat().st_mtime).astimezone().isoformat() for p in files), default=None)}
    files = files_under(base, {".git"})
    ext = {}
    for p in files:
        ext[p.suffix.lower() or "(none)"] = ext.get(p.suffix.lower() or "(none)", 0) + 1
    return {"totalFiles": len(files), "stageCounts": stages, "extensionCounts": ext}

def capture_auto_explore() -> dict:
    batches = sorted((AUTO / "reports").glob("batch-*.json"), key=lambda p: p.stat().st_mtime, reverse=True)[:15]
    verdicts, items, result_count = {}, [], 0
    for p in batches:
        data = json.loads(read_text(p))
        results = data.get("results", [])
        result_count += len(results)
        counts = {}
        for r in results:
            v = str(r.get("verdict", "unknown"))
            counts[v] = counts.get(v, 0) + 1
            verdicts[v] = verdicts.get(v, 0) + 1
        items.append({"file": p.name, "generatedAt": data.get("generatedAt"), "resultCount": len(results), "verdicts": counts, "charters": [r.get("charterId") for r in results]})
    return {"batchCount": len(batches), "resultCount": result_count, "verdictCounts": verdicts,
            "passRate": round(verdicts.get("pass", 0)/result_count, 6) if result_count else None,
            "unconfirmedRate": round(verdicts.get("unconfirmed", 0)/result_count, 6) if result_count else None,
            "pendingRate": round(verdicts.get("pending", 0)/result_count, 6) if result_count else None,
            "latestGeneratedAt": items[0].get("generatedAt") if items else None, "batches": items,
            "interpretation": "最近 15 个批次是历史快照，不代表本次重新执行。"}
def capture_git_ci() -> tuple[dict, dict]:
    git = {
        "branch": run(["git", "rev-parse", "--abbrev-ref", "HEAD"], PROP).get("stdout", ""),
        "commit": run(["git", "rev-parse", "HEAD"], PROP).get("stdout", ""),
        "commitTime": run(["git", "show", "-s", "--format=%cI", "HEAD"], PROP).get("stdout", ""),
        "statusShort": run(["git", "status", "--short"], PROP).get("stdout", ""),
    }
    lines = [x for x in git["statusShort"].splitlines() if x.strip()]
    git["dirtyFileCount"] = len(lines)
    git["isClean"] = len(lines) == 0
    git["baselineNote"] = "基线采集时工作区已有变更；不得归因于质量体系采集。"
    ci = {name: (PROP / name).exists() for name in ["Jenkinsfile", ".gitlab-ci.yml", "azure-pipelines.yml", "bitbucket-pipelines.yml"]}
    workflow = PROP / ".github" / "workflows"
    ci["githubWorkflows"] = sorted(p.name for p in workflow.glob("*")) if workflow.exists() else []
    ci["detected"] = any(ci[k] for k in ["Jenkinsfile", ".gitlab-ci.yml", "azure-pipelines.yml", "bitbucket-pipelines.yml"]) or bool(ci["githubWorkflows"])
    return git, ci

def tcp_check(host: str, port: int, timeout: float = 1.2) -> dict:
    start = datetime.now()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return {"host": host, "port": port, "reachable": True, "latencyMs": int((datetime.now()-start).total_seconds()*1000)}
    except OSError as exc:
        return {"host": host, "port": port, "reachable": False, "latencyMs": int((datetime.now()-start).total_seconds()*1000), "error": exc.__class__.__name__}

def detect_backend_runtime() -> dict:
    """从运行中的 RuoYi 进程反查实际 JVM，避免只读取 PATH 中的 java。"""
    ps = (
        "$p=Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "
        "'com\\.ruoyi\\.RuoYiApplication' } | Sort-Object CreationDate -Descending | Select-Object -First 1; "
        "if ($p) { $p | Select-Object ProcessId,ParentProcessId,CreationDate,CommandLine | ConvertTo-Json -Compress }"
    )
    r = run(["powershell", "-NoProfile", "-Command", ps], timeout=20)
    raw = r.get("stdout", "").strip()
    if not raw:
        return {"detected": False, "error": first_line(r)}
    try:
        proc = json.loads(raw)
    except json.JSONDecodeError:
        return {"detected": False, "error": "后端进程信息解析失败"}
    command = proc.get("CommandLine", "") or ""
    m = re.search(r'"([A-Za-z]:\\[^"]*?java\.exe)"', command, re.I)
    if not m:
        m = re.search(r'([A-Za-z]:\\[^"\s]+?java\.exe)', command, re.I)
    java_path = m.group(1) if m else ""
    version = run([java_path, "-version"], timeout=20) if java_path else {}
    return {
        "detected": True,
        "processId": proc.get("ProcessId"),
        "parentProcessId": proc.get("ParentProcessId"),
        "creationDate": proc.get("CreationDate"),
        "javaPath": java_path,
        "javaVersionLine": first_line(version),
        "timezoneArgument": next((x for x in command.split() if "user.timezone=" in x), ""),
    }


def http_probe(name: str, url: str, required: bool = True) -> dict:
    started = time.perf_counter()
    req = urllib.request.Request(url, headers={"User-Agent": "PROP-Quality-Fingerprint/1.1"})
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            body = resp.read(2048)
            return {
                "name": name,
                "url": url,
                "required": required,
                "reachable": True,
                "status": resp.status,
                "contentType": resp.headers.get("Content-Type", ""),
                "latencyMs": round((time.perf_counter() - started) * 1000),
                "bodyBytesSampled": len(body),
            }
    except urllib.error.HTTPError as exc:
        return {
            "name": name,
            "url": url,
            "required": required,
            "reachable": True,
            "status": exc.code,
            "contentType": exc.headers.get("Content-Type", "") if exc.headers else "",
            "latencyMs": round((time.perf_counter() - started) * 1000),
            "error": exc.reason,
        }
    except Exception as exc:
        return {
            "name": name,
            "url": url,
            "required": required,
            "reachable": False,
            "status": None,
            "latencyMs": round((time.perf_counter() - started) * 1000),
            "error": type(exc).__name__,
        }


def mysql_runtime(database: str) -> dict:
    """执行只读查询；密码只通过 MYSQL_PWD 环境变量传递，不进入命令和产物。"""
    mysql = shutil.which("mysql")
    user, password = os.environ.get("PROP_DB_USERNAME", ""), os.environ.get("PROP_DB_PASSWORD", "")
    if not mysql or not database or not user or not password:
        return {"connected": False, "reason": "缺少 mysql 客户端或受控连接环境变量"}
    env = os.environ.copy()
    env["MYSQL_PWD"] = password
    base = [mysql, "--protocol=TCP", "-h", os.environ.get("PROP_DB_HOST", "127.0.0.1"),
            "-P", str(os.environ.get("PROP_DB_PORT", "13306")), "-u", user, database,
            "--default-character-set=utf8mb4", "-N", "--batch"]
    meta_sql = (
        "SELECT VERSION(),@@character_set_server,@@collation_server,@@global.time_zone,"
        "@@session.time_zone,NOW(),DATABASE();"
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE();"
    )
    meta = run([*base, "-e", meta_sql], timeout=20, env=env)
    if meta.get("code") != 0:
        return {"connected": False, "reason": first_line(meta)}
    rows = [x.split("\t") for x in meta.get("stdout", "").splitlines() if x.strip()]
    schema_sql = (
        "SELECT table_name,column_name,column_type,is_nullable,IFNULL(column_default,'') "
        "FROM information_schema.columns WHERE table_schema=DATABASE() "
        "ORDER BY table_name,ordinal_position;"
    )
    schema = run([*base, "-e", schema_sql], timeout=30, env=env)
    schema_digest = hashlib.sha256(schema.get("stdout", "").encode("utf-8")).hexdigest() if schema.get("code") == 0 else ""
    counts_sql = (
        "SELECT 'prop_order',COUNT(*) FROM prop_order UNION ALL "
        "SELECT 'prop_order_line',COUNT(*) FROM prop_order_line UNION ALL "
        "SELECT 'prop_shipment',COUNT(*) FROM prop_shipment UNION ALL "
        "SELECT 'prop_shipment_product',COUNT(*) FROM prop_shipment_product;"
    )
    counts = run([*base, "-e", counts_sql], timeout=20, env=env)
    count_map = {}
    if counts.get("code") == 0:
        for line in counts.get("stdout", "").splitlines():
            parts = line.split("\t")
            if len(parts) >= 2 and parts[1].isdigit():
                count_map[parts[0]] = int(parts[1])
    first = rows[0] if rows else []
    return {
        "connected": True,
        "serverVersion": first[0] if len(first) > 0 else "",
        "characterSetServer": first[1] if len(first) > 1 else "",
        "collationServer": first[2] if len(first) > 2 else "",
        "globalTimeZone": first[3] if len(first) > 3 else "",
        "sessionTimeZone": first[4] if len(first) > 4 else "",
        "serverNow": first[5] if len(first) > 5 else "",
        "database": first[6] if len(first) > 6 else database,
        "tableCount": int(rows[1][0]) if len(rows) > 1 and rows[1] and rows[1][0].isdigit() else None,
        "schemaDigest": schema_digest,
        "coreTableCounts": count_map,
        "queryMode": "read-only",
    }


def docker_runtime() -> dict:
    result = {}
    for name in ("prop-dev2-local-mysql", "prop-dev2-local-redis"):
        fmt = "{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.State.StartedAt}}|{{.Config.Image}}|{{.Image}}"
        r = run(["docker", "inspect", name, "--format", fmt], timeout=15)
        if r.get("code") != 0:
            result[name] = {"available": False, "error": first_line(r)}
            continue
        parts = r.get("stdout", "").split("|", 4)
        image_name = parts[3] if len(parts) > 3 else ""
        digest = run(["docker", "image", "inspect", image_name, "--format", "{{index .RepoDigests 0}}"], timeout=15)
        result[name] = {
            "available": True,
            "status": parts[0] if len(parts) > 0 else "",
            "health": parts[1] if len(parts) > 1 else "",
            "startedAt": parts[2] if len(parts) > 2 else "",
            "image": image_name,
            "imageId": parts[4] if len(parts) > 4 else "",
            "repoDigest": digest.get("stdout", "") if digest.get("code") == 0 else "",
        }
    return result


def capture_environment() -> dict:
    auto_env, auto_env_hash = parse_env(AUTO / ".env")
    front_env_path = PROP / "ruoyi-ui" / "env" / ".env.dev"
    front_env, front_env_hash = parse_env(front_env_path)
    db_env = parse_jdbc(os.environ.get("PROP_DB_URL", ""))
    db_host = db_env.get("host", auto_env.get("DB_HOST", "127.0.0.1"))
    db_port = int(db_env.get("port", auto_env.get("DB_PORT", "3306")))
    db_name = db_env.get("database", auto_env.get("DB_NAME", ""))
    redis_host = os.environ.get("PROP_REDIS_HOST", "localhost")
    redis_port = int(os.environ.get("PROP_REDIS_PORT", "6379"))
    front_port = int(front_env.get("VITE_PORT", "3000"))
    front_proxy = front_env.get("VITE_PROXY_TARGET", "http://localhost:8080")
    front_api = front_env.get("VITE_APP_BASE_API", "/dev-api")
    pom = read_text(PROP / "pom.xml")
    m = re.search(r"<java\.version>([^<]+)</java\.version>", pom)
    expected_java = m.group(1).strip() if m else None
    frontend_pkg = json.loads(read_text(PROP / "ruoyi-ui" / "package.json"))
    auto_pkg = json.loads(read_text(AUTO / "package.json"))
    mvn_path = shutil.which("mvn.cmd") or shutil.which("mvn") or r"D:\Maven\apache-maven-3.9.6\bin\mvn.cmd"
    commands = {
        "java": ["java", "-version"], "mvn": [mvn_path, "-version"], "node": ["node", "--version"],
        "npm": ["npm.cmd" if shutil.which("npm.cmd") else "npm", "--version"],
        "pnpm": ["pnpm.cmd" if shutil.which("pnpm.cmd") else "pnpm", "--version"],
        "git": ["git", "--version"], "mysql": ["mysql", "--version"], "docker": ["docker", "--version"],
        "dockerServer": ["docker", "info", "--format", "{{.ServerVersion}}"],
    }
    tools = {}
    for name, args in commands.items():
        r = run(args)
        tools[name] = {"available": "error" not in r and r.get("code") == 0, "versionLine": first_line(r), "path": shutil.which(args[0])}
    backend_java = detect_backend_runtime()
    pw_path = AUTO / "node_modules" / "playwright" / "package.json"
    playwright_pkg = json.loads(read_text(pw_path)) if pw_path.exists() else {}
    script = "const fs=require('fs'); const {chromium}=require('playwright'); const p=chromium.executablePath(); console.log(JSON.stringify({executablePath:p,exists:fs.existsSync(p)}));"
    cr = run(["node", "-e", script], AUTO)
    try:
        chromium = json.loads(cr.get("stdout", "{}"))
    except json.JSONDecodeError:
        chromium = {"parseStatus": "failed"}
    targets = [
        {"name": "frontend", "host": "127.0.0.1", "port": front_port, "required": True},
        {"name": "backend", "host": "127.0.0.1", "port": 8080, "required": True},
        {"name": "mysql", "host": "127.0.0.1", "port": db_port, "required": True},
        {"name": "redis", "host": "127.0.0.1", "port": redis_port, "required": True},
    ]
    if front_port != 3000:
        targets.append({"name": "viteDefaultUnused", "host": "127.0.0.1", "port": 3000, "required": False})
    reach = []
    for t in targets:
        r = tcp_check(t["host"], t["port"])
        r.update({"name": t["name"], "required": t["required"]})
        reach.append(r)
    http_checks = [
        http_probe("frontendLogin", f"http://127.0.0.1:{front_port}/"),
        http_probe("backendRoot", "http://127.0.0.1:8080/"),
        http_probe("backendHealthEnvelope", "http://127.0.0.1:8080/actuator/health", required=False),
        http_probe("backendRedisCaptcha", "http://127.0.0.1:8080/captchaImage"),
    ]
    db_runtime = mysql_runtime(db_name)
    containers = docker_runtime()
    configs = {
        "applicationYml": file_meta(PROP / "ruoyi-admin" / "src" / "main" / "resources" / "application.yml"),
        "applicationDruidYml": file_meta(PROP / "ruoyi-admin" / "src" / "main" / "resources" / "application-druid.yml"),
        "localApplicationOverride": file_meta(PROP / ".local" / "mysql" / "application-local.yml"),
        "composeLocal": file_meta(PROP / "compose.local.yaml"),
        "frontendDevEnv": file_meta(front_env_path),
        "viteBase": file_meta(PROP / "ruoyi-ui" / "config" / "vite" / "base.js"),
        "frontendPackageLock": file_meta(PROP / "ruoyi-ui" / "package-lock.json"),
        "autoExplorePackageLock": file_meta(AUTO / "package-lock.json"),
    }
    if auto_env_hash:
        configs["autoExploreEnv"] = {"path": str(AUTO / ".env"), "sha256": auto_env_hash, "content": "[已脱敏]"}
    runtime_material = {
        "projectCommit": capture_git_ci()[0].get("commit"),
        "frontendPort": front_port,
        "backendPort": 8080,
        "database": {"host": db_host, "port": db_port, "name": db_name, "schemaDigest": db_runtime.get("schemaDigest")},
        "redis": {"host": redis_host, "port": redis_port},
        "java": backend_java.get("javaVersionLine", ""),
        "node": tools["node"]["versionLine"],
        "maven": tools["mvn"]["versionLine"],
        "containerDigests": {k: v.get("repoDigest", "") for k, v in containers.items()},
        "configHashes": {k: v.get("sha256", "") for k, v in configs.items()},
    }
    environment_fingerprint = hashlib.sha256(
        json.dumps(runtime_material, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    required_unreachable = [x["name"] for x in reach if x["required"] and not x["reachable"]]
    failed_http = [x["name"] for x in http_checks if x["reachable"] and x.get("status") != 200]
    failed_http += [x["name"] for x in http_checks if not x["reachable"]]
    blocking_gaps = []
    if required_unreachable:
        blocking_gaps.append("核心端口不可达：" + "、".join(required_unreachable))
    if failed_http:
        blocking_gaps.append("运行态 HTTP 冒烟未全部通过：" + "、".join(failed_http))
    if not db_runtime.get("connected"):
        blocking_gaps.append("数据库只读查询未通过：" + db_runtime.get("reason", "未知原因"))
    for name, item in containers.items():
        if not item.get("available") or item.get("health") != "healthy":
            blocking_gaps.append(f"容器 {name} 未处于 healthy 状态")
    if not tools["dockerServer"]["available"]:
        blocking_gaps.append("Docker 服务端不可用")
    residual_risks = []
    detected_major = re.search(r'version "(\d+)', backend_java.get("javaVersionLine", ""))
    if expected_java and (not detected_major or detected_major.group(1) != expected_java):
        residual_risks.append(f"运行时 Java 与项目声明不一致：项目要求 {expected_java}，后端进程为 {backend_java.get('javaVersionLine', '未识别')}")
    if not auto_env.get("APP_ENV_FINGERPRINT"):
        residual_risks.append("auto-explore 未配置 APP_ENV_FINGERPRINT，当前防误连主要依赖 local/private 主机限制和人工复核")
    if not front_env_hash:
        residual_risks.append("前端 env/.env.dev 未读取到持久化端口配置")
    if not capture_git_ci()[0].get("isClean"):
        residual_risks.append("prop_new 工作区存在既有未提交改动，环境指纹绑定到当前提交但不代表工作树干净")
    return {
        "environmentId": f"ENV-{datetime.now().strftime('%Y-%m-%d')}-01",
        "capturedAt": now_iso(),
        "status": "captured" if not blocking_gaps else "captured-with-blockers",
        "environmentFingerprint": environment_fingerprint,
        "fingerprintMaterial": runtime_material,
        "host": {"hostname": socket.gethostname(), "user": os.environ.get("USERNAME") or os.environ.get("USER", ""),
                 "os": platform.system(), "osRelease": platform.release(), "osVersion": platform.version(),
                 "architecture": platform.machine(), "logicalCpuCount": os.cpu_count(),
                 "timezone": str(datetime.now().astimezone().tzinfo), "python": sys.version.split()[0]},
        "toolchain": {"expectedJava": expected_java, **tools, "backendRuntime": backend_java,
                      "frontendNodeEngine": frontend_pkg.get("engines", {}).get("node"),
                      "autoExploreNodeEngine": auto_pkg.get("engines", {}).get("node")},
        "project": {"path": str(PROP), "git": capture_git_ci()[0], "ci": capture_git_ci()[1]},
        "runtime": {
            "frontend": {"actualPort": front_port, "viteDefaultPort": 3000, "proxyTarget": front_proxy,
                         "baseApi": front_api, "envFilesFound": sorted(p.name for p in (PROP / "ruoyi-ui" / "env").glob(".env*")),
                         "autoExploreBaseUrl": auto_env.get("APP_BASE_URL", ""), "autoExploreApiPrefix": auto_env.get("APP_API_PREFIX", "")},
            "backend": {"port": 8080, "activeProfile": "druid,local", "dbUrlOverrideConfigured": bool(os.environ.get("PROP_DB_URL")),
                        "db": {"engine": "mysql", "host": db_host, "port": db_port, "database": db_name,
                               "jdbcConnectionTimeZone": re.search(r"connectionTimeZone=([^&]+)", db_env.get("query", "")).group(1) if re.search(r"connectionTimeZone=([^&]+)", db_env.get("query", "")) else ""},
                        "redis": {"host": redis_host, "port": redis_port}},
            "autoExplore": {"configuredKeys": sorted(auto_env.keys()), "loginUserConfigured": bool(auto_env.get("APP_LOGIN_USER")),
                            "loginPasswordConfigured": bool(auto_env.get("APP_LOGIN_PASSWORD")),
                            "environmentFingerprintConfigured": bool(auto_env.get("APP_ENV_FINGERPRINT")),
                            "dbUserConfigured": bool(auto_env.get("DB_USER")), "dbPasswordConfigured": bool(auto_env.get("DB_PASSWORD")),
                            "headless": auto_env.get("HEADLESS", ""), "maxStepsPerCharter": auto_env.get("MAX_STEPS_PER_CHARTER", ""),
                            "traceDir": auto_env.get("TRACE_DIR", ""), "allowCharterSql": auto_env.get("ALLOW_CHARTER_SQL", ""),
                            "llmModel": auto_env.get("LLM_MODEL", ""), "llmApiBaseConfigured": bool(auto_env.get("LLM_API_BASE")),
                            "llmApiKeyConfigured": bool(auto_env.get("LLM_API_KEY"))},
            "browser": {"playwrightVersion": playwright_pkg.get("version"), "chromium": chromium},
            "containers": containers,
        },
        "reachability": reach,
        "runtimeChecks": {"http": http_checks, "database": db_runtime},
        "configFingerprint": configs,
        "blockingGaps": blocking_gaps,
        "residualRisks": residual_risks,
        "gaps": residual_risks,
        "secretPolicy": "账号、密码、Token、API Key 和 JDBC 凭据未写入本文件。",
    }


def pct(value: float | None) -> str:
    return "未计算" if value is None else f"{value * 100:.1f}%"

def write_quality_md(data: dict, path: Path) -> None:
    v5, t = data["workbook"], data["workbook"]["totals"]
    lines = [
        "# 质量资产基线快照", "",
        f"- 基线编号：`{data['baselineId']}`", f"- 采集时间：`{data['capturedAt']}`",
        "- 采集方式：只读静态扫描，未重新执行测试或自动探索。", "", "## 1. 核心结论", "",
        f"- V5 工作簿共 {v5['sheetCount']} 张表，其中业务用例表 {v5['businessSheetCount']} 张。",
        f"- 有效业务用例 {t['effectiveRows']} 条：通过 {t['passCount']} 条（{pct(t['passRate'])}），未执行 {t['notExecutedCount']} 条（{pct(t['notExecutedRate'])}）。",
        f"- 高优先级用例 {t['highPriorityTotal']} 条：通过 {t['highPriorityPassCount']} 条（{pct(t['highPriorityPassRate'])}），未执行 {t['highPriorityNotExecutedCount']} 条（{pct(t['highPriorityNotExecutedRate'])}）。",
        f"- 后端测试文件 {data['testAssets']['backendFiles']} 个，`@Test` {data['testAssets']['backendTestAnnotations']} 个，`@ParameterizedTest` {data['testAssets']['backendParameterizedAnnotations']} 个。",
        f"- 前端测试文件 {data['testAssets']['frontendFiles']} 个，`test(` 静态出现 {data['testAssets']['frontendTestCallOccurrences']} 次。",
        f"- 最近 {data['autoExplore']['batchCount']} 个自动探索批次共 {data['autoExplore']['resultCount']} 个结果：pass {data['autoExplore']['verdictCounts'].get('pass', 0)}、unconfirmed {data['autoExplore']['verdictCounts'].get('unconfirmed', 0)}、pending {data['autoExplore']['verdictCounts'].get('pending', 0)}。",
        "", "> 测试方法和调用数是源码文本静态计数，不代表本次采集实际执行了这些测试。", "",
        "## 2. V5 业务用例状态", "", "| 状态 | 数量 |", "|---|---:|",
    ]
    for status, count in sorted(t["statusCounts"].items(), key=lambda x: (-x[1], x[0])):
        lines.append(f"| {status} | {count} |")
    lines += ["", "## 3. 各业务表", "", "| 业务表 | 有效行 | 通过 | 未执行 | 高优先级 |", "|---|---:|---:|---:|---:|"]
    for item in v5["business"]:
        lines.append(f"| {item['sheet']} | {item['effectiveRows']} | {item['statusCounts'].get('通过', 0)} | {item['statusCounts'].get('未执行', 0)} | {item['priorityCounts'].get('高', 0)} |")
    lines += ["", "## 4. 测试与追溯资产", "", "| 资产 | 数量 |", "|---|---:|",
              f"| V5 用例-需求映射行 | {v5['mapping']['rowCount']} |", f"| 映射中的不同用例编号 | {v5['mapping']['distinctCaseIds']} |",
              f"| 需求追溯矩阵行 | {v5['traceability']['requirementRowCount']} |", f"| 需求澄清清单行 | {v5['clarification']['rowCount']} |",
              f"| 基线规格行 | {v5['baselineSpec']['rowCount']} |", "", "## 5. 当前质量缺口", ""]
    for gap in data["qualityGaps"]:
        lines.append(f"- {gap}")
    lines += ["", "## 6. 数据来源与复现", "", f"- V5：`{v5['file']['path']}`", f"- SHA256：`{v5['file']['sha256']}`", f"- 采集脚本：`{data['reproduction']['script']}`"]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")

def write_environment_md(data: dict, path: Path) -> None:
    tools, reach, runtime = data["toolchain"], data["reachability"], data["runtime"]
    db = data["runtimeChecks"]["database"]
    lines = [
        "# 环境指纹与运行态复验", "",
        f"- 环境编号：`{data['environmentId']}`",
        f"- 环境指纹：`{data['environmentFingerprint']}`",
        f"- 采集时间：`{data['capturedAt']}`",
        f"- 状态：`{data['status']}`",
        "- 明文账号、密码、Token、API Key 和 JDBC 凭据未写入。", "",
        "## 1. 结论", "",
        f"- 核心端口检查：{'通过' if not data['blockingGaps'] else '存在阻断'}。",
        f"- 后端实际 JVM：`{tools['backendRuntime'].get('javaVersionLine', '未识别')}`。",
        f"- 项目声明 Java：`{tools['expectedJava']}`。",
        f"- 数据库结构摘要：`{db.get('schemaDigest', '未计算')}`。",
        f"- 数据库表数：`{db.get('tableCount')}`。", "",
        "## 2. 主机与工具链", "",
        "| 项目 | 值 |", "|---|---|",
        f"| 主机名 | `{data['host']['hostname']}` |",
        f"| 操作系统 | {data['host']['os']} {data['host']['osRelease']} |",
        f"| CPU 逻辑核数 | {data['host']['logicalCpuCount']} |",
        f"| 主机时区 | `{data['host']['timezone']}` |",
        f"| PATH 中 Java | `{tools['java']['versionLine']}` |",
        f"| 后端进程 Java | `{tools['backendRuntime'].get('javaVersionLine', '未识别')}` |",
        f"| Maven | `{tools['mvn']['versionLine']}` |",
        f"| Node.js | `{tools['node']['versionLine']}` |",
        f"| npm | `{tools['npm']['versionLine']}` |",
        f"| Playwright | `{runtime['browser'].get('playwrightVersion') or '未读取'}` |",
        f"| Chromium | {'存在' if runtime['browser'].get('chromium', {}).get('exists') else '缺失'} |", "",
        "## 3. 拓扑与端口", "",
        "| 目标 | 地址 | 必需 | 状态 |", "|---|---|---|---|",
    ]
    for item in reach:
        lines.append(
            f"| {item['name']} | `{item['host']}:{item['port']}` | {'是' if item.get('required') else '否'} | "
            f"{'可达' if item['reachable'] else '不可达'} |"
        )
    lines += [
        "", "> 前端实际端口来自 `ruoyi-ui/env/.env.dev` 的 `VITE_PORT=8090`；Vite 默认 3000 不是当前运行入口。", "",
        "## 4. 运行态检查", "",
        "| 检查 | 地址或对象 | 结果 |", "|---|---|---|",
    ]
    for item in data["runtimeChecks"]["http"]:
        lines.append(f"| {item['name']} | `{item['url']}` | HTTP {item.get('status', '不可达')} |")
    lines += [
        f"| MySQL | `{data['runtime']['backend']['db']['host']}:{data['runtime']['backend']['db']['port']}` | "
        f"{'已连接' if db.get('connected') else '未连接'}，版本 {db.get('serverVersion', '未知')} |",
        f"| 应用连接时区 | JDBC 参数 | `{data['runtime']['backend']['db'].get('jdbcConnectionTimeZone', '')}` |",
    ]
    for name, item in runtime["containers"].items():
        lines.append(f"| 容器 {name} | `{item.get('image', '')}` | {item.get('status', '')}/{item.get('health', '')} |")
    lines += ["", "## 5. 数据库基线", "", "| 项目 | 值 |", "|---|---|"]
    for key in ("database", "serverVersion", "characterSetServer", "collationServer", "globalTimeZone", "sessionTimeZone", "serverNow"):
        lines.append(f"| {key} | `{db.get(key, '')}` |")
    for key, value in db.get("coreTableCounts", {}).items():
        lines.append(f"| {key} 行数 | {value} |")
    lines += ["", "## 6. 配置与容器指纹", "", "| 对象 | SHA256 或摘要 |", "|---|---|"]
    for key, item in data["configFingerprint"].items():
        lines.append(f"| {key} | `{item.get('sha256', '')}` |")
    for key, item in runtime["containers"].items():
        lines.append(f"| {key} 镜像 | `{item.get('repoDigest', '')}` |")
    lines += ["", "## 7. 阻断项与残余风险", ""]
    if data.get("blockingGaps"):
        lines.extend(f"- 阻断：{x}" for x in data["blockingGaps"])
    else:
        lines.append("- 无运行态阻断项。")
    if data.get("residualRisks"):
        lines.extend(f"- 残余风险：{x}" for x in data["residualRisks"])
    else:
        lines.append("- 无已登记的残余风险。")
    lines += [
        "", "## 8. 标准启动顺序", "",
        "1. `docker compose -f compose.local.yaml start mysql redis`",
        "2. 确认 MySQL 13306 与 Redis 16379 健康。",
        "3. 以 JDK 17、`-Duser.timezone=Asia/Tokyo`、`druid,local` 启动后端，等待 8080 健康。",
        "4. 在 `ruoyi-ui` 执行 `npm run dev`，确认前端 8090 与 `/dev-api` 代理可用。",
        "5. 执行本采集脚本，确认状态为 `captured` 且阻断项为空。", "",
        "## 9. 复现方式", "",
        f"运行 `{data['reproduction']['script']}`。脚本只读取配置、版本、端口、HTTP、数据库结构和容器健康状态；不执行测试、不写业务数据。",
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    captured = now_iso()
    quality_dir, env_dir = QUALITY_ROOT / "baselines", QUALITY_ROOT / "environments"
    quality_dir.mkdir(parents=True, exist_ok=True)
    env_dir.mkdir(parents=True, exist_ok=True)
    git, ci = capture_git_ci()
    evidence_dir = QUALITY_ROOT / "evidence"
    evidence = [p for p in evidence_dir.iterdir() if p.is_dir() and any(p.iterdir())] if evidence_dir.exists() else []
    quality = {
        "baselineId": f"QB-{datetime.now().strftime('%Y-%m-%d')}-01", "capturedAt": captured,
        "scope": "PROP 订单管理到寄送和面单试点及现有质量资产", "mode": "read-only-static-snapshot",
        "workbook": capture_workbook(), "testAssets": capture_tests(), "aiTest": capture_ai_test(),
        "autoExplore": capture_auto_explore(), "project": {"git": git, "ci": ci},
        "evidence": {"formalPackageCount": len(evidence), "templateExists": (QUALITY_ROOT / "evidence-template.md").exists()},
        "qualityGaps": ["未发现持续集成配置。", "不存在正式变更证据包。", "V5 中大量用例仍未执行。", "自动探索结果不能直接作为硬门禁。"],
        "reproduction": {"script": str(QUALITY_ROOT / "tools" / "capture_w1_baseline.py"), "python": sys.version.split()[0],
                         "note": "只读采集，不执行构建、测试或数据库写入。"},
    }
    qjson = quality_dir / f"{datetime.now().strftime('%Y-%m-%d')}-quality-baseline.json"
    qmd = quality_dir / f"{datetime.now().strftime('%Y-%m-%d')}-quality-baseline.md"
    qjson.write_text(json.dumps(quality, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_quality_md(quality, qmd)
    env = capture_environment()
    env["capturedAt"] = captured
    env["reproduction"] = {"script": str(QUALITY_ROOT / "tools" / "capture_w1_baseline.py"), "python": sys.version.split()[0],
                           "note": "只读采集；核心服务或运行态检查失败时标记为 captured-with-blockers。"}
    ejson = env_dir / f"{datetime.now().strftime('%Y-%m-%d')}-environment-fingerprint.json"
    emd = env_dir / f"{datetime.now().strftime('%Y-%m-%d')}-environment-fingerprint.md"
    ejson.write_text(json.dumps(env, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_environment_md(env, emd)
    index = {"updatedAt": captured, "qualityBaseline": {"json": str(qjson), "markdown": str(qmd)},
             "environmentFingerprint": {"json": str(ejson), "markdown": str(emd)}}
    (quality_dir / "latest.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(index, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()