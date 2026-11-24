# -*- coding: utf-8 -*-
"""G2 影子门禁编排器（首轮只记录，不自动阻断）。"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(r"E:\proptest")
QUALITY = ROOT / "systemquality"
PROP = ROOT / "prop_new"
FRONTEND = PROP / "ruoyi-ui"
ENV_JSON = QUALITY / "environments" / "2026-11-23-environment-fingerprint.json"
JAVA_HOME = Path(r"C:\Program Files\Java\jdk-17.0.2")
MAVEN_HOME = Path(r"D:\Maven\apache-maven-3.9.6")
GATES = QUALITY / "gates"

SECRET_RULES = [
    ("private-key", re.compile(r"-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----")),
    ("aws-access-key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("github-token", re.compile(r"\bghp_[A-Za-z0-9]{30,}\b")),
    ("openai-style-key", re.compile(r"\bsk-[A-Za-z0-9]{20,}\b")),
    ("generic-secret-assignment", re.compile(r"(?i)\b(?:api[_-]?key|secret|password|token)\b\s*[:=]\s*[\"'][^\"'$<{][^\"']{7,}[\"']")),
]


def now() -> str:
    return datetime.now().astimezone().replace(microsecond=0).isoformat()


def slug(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-")
    return cleaned or datetime.now().strftime("RUN-%Y%m%d-%H%M%S")


def load_user_environment() -> dict[str, str]:
    env = dict(os.environ)
    if os.name == "nt":
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as key:
                index = 0
                while True:
                    try:
                        name, value, _ = winreg.EnumValue(key, index)
                    except OSError:
                        break
                    if name and value is not None and name not in env:
                        env[name] = str(value)
                    index += 1
        except Exception:
            pass
    env["JAVA_HOME"] = str(JAVA_HOME)
    env["PATH"] = f"{JAVA_HOME / 'bin'};{MAVEN_HOME / 'bin'};{env.get('PATH', '')}"
    env["NO_COLOR"] = "1"
    env["CI"] = "1"
    return env


def run_capture(command: str, cwd: Path, env: dict[str, str], timeout: int) -> dict:
    started = time.perf_counter()
    try:
        proc = subprocess.run(
            ["cmd.exe", "/d", "/s", "/c", command],
            cwd=str(cwd), env=env, capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=timeout,
        )
        return {
            "exitCode": proc.returncode,
            "stdout": proc.stdout,
            "stderr": proc.stderr,
            "durationSec": round(time.perf_counter() - started, 2),
            "timedOut": False,
        }
    except subprocess.TimeoutExpired as exc:
        return {
            "exitCode": None,
            "stdout": (exc.stdout or "") if isinstance(exc.stdout, str) else "",
            "stderr": (exc.stderr or "") if isinstance(exc.stderr, str) else "",
            "durationSec": round(time.perf_counter() - started, 2),
            "timedOut": True,
            "error": f"命令超过 {timeout} 秒",
        }
    except FileNotFoundError as exc:
        return {
            "exitCode": None, "stdout": "", "stderr": "",
            "durationSec": round(time.perf_counter() - started, 2),
            "timedOut": False, "error": f"工具不存在：{exc}",
        }
    except Exception as exc:
        return {
            "exitCode": None, "stdout": "", "stderr": "",
            "durationSec": round(time.perf_counter() - started, 2),
            "timedOut": False, "error": f"{type(exc).__name__}: {exc}",
        }


def changed_files() -> list[str]:
    env = load_user_environment()
    files: set[str] = set()
    for command in (
        ["git", "diff", "--name-only", "HEAD"],
        ["git", "ls-files", "--others", "--exclude-standard"],
    ):
        try:
            p = subprocess.run(command, cwd=str(PROP), capture_output=True, text=True, encoding="utf-8", errors="replace", env=env, timeout=20)
            if p.returncode == 0:
                files.update(x.strip() for x in p.stdout.splitlines() if x.strip())
        except Exception:
            pass
    return sorted(files)


def secret_scan(run_dir: Path) -> dict:
    files = changed_files()
    findings = []
    scanned = 0
    for rel in files:
        path = (PROP / rel).resolve()
        if not str(path).startswith(str(PROP.resolve())) or not path.is_file():
            continue
        if any(part in {".git", "node_modules", "target", "dist"} for part in path.parts):
            continue
        if path.stat().st_size > 2 * 1024 * 1024:
            continue
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except Exception:
            continue
        scanned += 1
        for line_no, line in enumerate(lines, 1):
            for rule, pattern in SECRET_RULES:
                if pattern.search(line):
                    findings.append({
                        "file": rel,
                        "line": line_no,
                        "rule": rule,
                        "maskedLength": len(line),
                        "valueWritten": False,
                    })
                    break
    report = {
        "status": "pass" if not findings else "fail",
        "scannedFiles": scanned,
        "changedFiles": files,
        "findingCount": len(findings),
        "findings": findings,
        "note": "只记录规则、文件和行号，不回写命中值。",
    }
    (run_dir / "secret-scan.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def build_checks() -> list[dict]:
    mvn = MAVEN_HOME / "bin" / "mvn.cmd"
    npm = shutil.which("npm.cmd") or "npm.cmd"
    return [
        {"id": "backend-build", "name": "后端构建", "category": "build", "cwd": PROP, "command": f'{mvn} --no-transfer-progress -q -pl ruoyi-admin -am -DskipTests install', "timeout": 600},
        {"id": "backend-test", "name": "后端单元与集成测试", "category": "test", "cwd": PROP, "command": f'{mvn} --no-transfer-progress -q test', "timeout": 900},
        {"id": "frontend-typecheck", "name": "前端类型检查", "category": "static", "cwd": FRONTEND, "command": f'{npm} run typecheck', "timeout": 300},
        {"id": "frontend-lint", "name": "前端 Lint", "category": "static", "cwd": FRONTEND, "command": f'{npm} run lint', "timeout": 300},
        {"id": "frontend-test", "name": "前端 Node Test", "category": "test", "cwd": FRONTEND, "command": f'{npm} test', "timeout": 600},
        {"id": "frontend-build", "name": "前端生产构建", "category": "build", "cwd": FRONTEND, "command": f'{npm} run build:prod', "timeout": 600},
    ]


def classify(check: dict, result: dict, secret: dict | None) -> str:
    if result.get("timedOut"):
        return "environment/timeout"
    if result.get("exitCode") is None:
        return "tool-error"
    if check["id"] == "secret-scan" and secret and secret.get("findingCount"):
        return "security/secret"
    mapping = {
        "build": "code/build",
        "static": "code/static",
        "test": "test/failure",
        "security": "security/secret",
    }
    return mapping.get(check["category"], "unknown")


def main() -> int:
    parser = argparse.ArgumentParser(description="G2 影子门禁编排器")
    parser.add_argument("--change-id", default="", help="变更号；缺省生成 DRYRUN 标识")
    parser.add_argument("--checks", default="all", help="all 或逗号分隔的检查 ID")
    parser.add_argument("--mode", default="shadow", choices=["shadow", "enforce"], help="首轮默认 shadow")
    parser.add_argument("--timeout", type=int, default=900, help="单项命令默认超时秒数")
    args = parser.parse_args()

    if not JAVA_HOME.exists():
        raise SystemExit(f"未找到 JDK 17：{JAVA_HOME}")
    change_id = slug(args.change_id or datetime.now().strftime("DRYRUN-%Y%m%d-%H%M%S"))
    run_id = f"G2-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{change_id}"
    run_dir = GATES / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    env = load_user_environment()

    git_commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=PROP, capture_output=True, text=True, encoding="utf-8", errors="replace").stdout.strip()
    git_status = subprocess.run(["git", "status", "--short"], cwd=PROP, capture_output=True, text=True, encoding="utf-8", errors="replace").stdout.splitlines()
    environment_fingerprint = ""
    if ENV_JSON.exists():
        try:
            environment_fingerprint = json.loads(ENV_JSON.read_text(encoding="utf-8")).get("environmentFingerprint", "")
        except Exception:
            environment_fingerprint = ""

    all_checks = build_checks()
    requested = {x.strip() for x in args.checks.split(",") if x.strip()}
    selected = all_checks if "all" in requested else [x for x in all_checks if x["id"] in requested]
    if not selected:
        raise SystemExit("没有匹配的检查项")
    if "all" in requested:
        selected = [*selected, {"id": "secret-scan", "name": "Secret 扫描", "category": "security", "cwd": PROP, "command": "", "timeout": 60}]

    results = []
    for check in selected:
        if check["id"] == "secret-scan":
            started = time.perf_counter()
            secret = secret_scan(run_dir)
            result = {"exitCode": 0 if secret["status"] == "pass" else 1, "stdout": "", "stderr": "", "timedOut": False}
            duration = round(time.perf_counter() - started, 2)
            log_path = "secret-scan.json"
        else:
            command = check["command"]
            result = run_capture(command, check["cwd"], env, min(args.timeout, check["timeout"]))
            duration = result.get("durationSec", 0)
            safe_id = re.sub(r"[^A-Za-z0-9._-]+", "-", check["id"])
            log_path = f"{safe_id}.log"
            (run_dir / log_path).write_text(
                f"# command\n{command}\n\n# exitCode\n{result.get('exitCode')}\n\n# stdout\n{result.get('stdout', '')}\n\n# stderr\n{result.get('stderr', '')}\n",
                encoding="utf-8",
            )
            secret = None
        passed = result.get("exitCode") == 0 and not result.get("timedOut")
        status = "pass" if passed else "fail"
        results.append({
            "id": check["id"],
            "name": check["name"],
            "category": check["category"],
            "status": status,
            "exitCode": result.get("exitCode"),
            "timedOut": result.get("timedOut", False),
            "durationSec": duration,
            "command": check.get("command", "内置只读扫描"),
            "logPath": log_path,
            "failureClass": "" if passed else classify(check, result, secret),
            "error": result.get("error", ""),
        })

    failed = [x for x in results if x["status"] != "pass"]
    payload = {
        "schemaVersion": "1.0",
        "gateId": "G2",
        "gateName": "提交前门禁",
        "mode": args.mode,
        "hardGateEffective": args.mode == "enforce",
        "shadowWouldBlock": bool(failed),
        "overallStatus": "pass" if not failed else "fail",
        "runId": run_id,
        "changeId": change_id,
        "createdAt": now(),
        "commit": git_commit,
        "workingTreeDirty": bool(git_status),
        "gitStatus": git_status,
        "environmentFingerprint": environment_fingerprint,
        "javaHome": str(JAVA_HOME),
        "checks": results,
        "failureSummary": {
            "failed": len(failed),
            "total": len(results),
            "classes": sorted({x["failureClass"] for x in failed if x["failureClass"]}),
        },
        "decisionRule": "shadow 模式只记录，不改变交付决定；enforce 模式任一项失败即阻断。",
    }
    (run_dir / "gate-results.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# G2 影子门禁结果", "",
        f"- 运行号：`{run_id}`", f"- 变更号：`{change_id}`", f"- 模式：`{args.mode}`",
        f"- 提交：`{git_commit}`", f"- 环境指纹：`{environment_fingerprint}`",
        f"- 总体结果：`{payload['overallStatus']}`", f"- 影子本应阻断：`{payload['shadowWouldBlock']}`", "",
        "| 检查 | 分类 | 结果 | 耗时 | 失败分类 | 日志 |", "|---|---|---|---:|---|---|",
    ]
    for item in results:
        lines.append(f"| {item['name']} | {item['category']} | {item['status']} | {item['durationSec']}s | {item['failureClass'] or '-'} | `{item['logPath']}` |")
    lines += ["", "> shadow 模式下本结果不直接阻断开发；失败项必须由责任人分类、修复或进入例外流程。"]
    (run_dir / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(json.dumps({
        "runId": run_id,
        "mode": args.mode,
        "overallStatus": payload["overallStatus"],
        "shadowWouldBlock": payload["shadowWouldBlock"],
        "failed": payload["failureSummary"]["failed"],
        "total": payload["failureSummary"]["total"],
        "results": str(run_dir / "gate-results.json"),
        "summary": str(run_dir / "summary.md"),
    }, ensure_ascii=False, indent=2))
    return 0 if args.mode == "shadow" or not failed else 1


if __name__ == "__main__":
    sys.exit(main())
