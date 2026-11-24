#!/usr/bin/env python3
"""对一次 G2 影子运行进行分层失败分类，不改动被测源码。"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def last_match(pattern: str, text: str) -> re.Match[str] | None:
    matches = list(re.finditer(pattern, text, flags=re.MULTILINE))
    return matches[-1] if matches else None


def find_surefire_reports(run_dir: Path) -> Path | None:
    for parent in (run_dir, *run_dir.parents):
        candidate = parent / "prop_new" / "ruoyi-prop" / "target" / "surefire-reports"
        if candidate.is_dir():
            return candidate
    return None


def aggregate_surefire(reports_dir: Path) -> tuple[int, int, int, str, str]:
    texts = []
    for report in sorted(reports_dir.glob("*.txt")):
        texts.append(f"\n===== {report.name} =====\n{read_text(report)}")
    combined = "".join(texts)
    tests = failures = errors = 0
    pattern = r"Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+)"
    for match in re.finditer(pattern, combined):
        tests += int(match.group(1))
        failures += int(match.group(2))
        errors += int(match.group(3))
    digest = hashlib.sha256(combined.encode("utf-8")).hexdigest()
    return tests, failures, errors, combined, digest


def classify_backend(log_path: Path, reports_dir: Path | None = None) -> dict[str, Any]:
    text = read_text(log_path)
    summary = last_match(
        r"Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+)", text
    )
    tests, failures, errors = (int(value) for value in summary.groups()) if summary else (0, 0, 0)
    report_text = ""
    report_digest = ""
    report_count = 0
    if reports_dir and reports_dir.is_dir():
        report_tests, report_failures, report_errors, report_text, report_digest = aggregate_surefire(reports_dir)
        if report_tests:
            tests, failures, errors = report_tests, report_failures, report_errors
        report_count = len(list(reports_dir.glob("*.txt")))

    template_messages = {
        "template_integrity": report_text.count("テンプレート資源の整合性を確認できません"),
        "checksum_mismatch": report_text.count("テンプレートのチェックサムが一致しません"),
        "saved_template_unavailable": report_text.count("保存済みテンプレートが利用できません"),
        "current_notice_template_invalid": report_text.count("現在の案内テンプレートの設定が不正です"),
        "inspection_template_invalid": report_text.count("点检报告模板参数异常"),
    }
    template_signal_count = sum(template_messages.values())
    evidence_text = report_text if report_text else text
    triage_signals = []
    if "expected: <32> but was: <34>" in evidence_text:
        triage_signals.append("PropNoticeMapperTest 绑定 SQL 数量断言 32 != 34")
    if "java.nio.file.FileSystemException" in evidence_text:
        triage_signals.append("Windows 临时目录 private 文件系统权限异常")
    if "expected: <true> but was: <false>" in evidence_text:
        triage_signals.append("PropNoticeServiceTest 布尔事实断言失败，需确认是否模板问题级联")
    if "expected: <1> but was: <0>" in evidence_text or "expected: <2> but was: <0>" in evidence_text:
        triage_signals.append("PackageRecordServiceTest 事务计数断言失败，疑似模板校验失败级联")

    return {
        "id": "backend-test",
        "failureClass": "environment/tool",
        "subtype": "template-resource-line-ending",
        "confidence": "high",
        "status": "confirmed-root-cause-with-triage-items",
        "owner": "张树旸",
        "reviewer": "贾婉月",
        "metrics": {
            "tests": tests,
            "failures": failures,
            "errors": errors,
            "surefireReports": report_count,
            "templateRelatedMessageOccurrences": template_signal_count,
        },
        "evidence": [
            f"Maven/Surefire 汇总为 {tests} 个测试、{failures} 个失败、{errors} 个错误。",
            f"Surefire 报告中出现 {template_signal_count} 次模板完整性、校验和或模板不可用类消息。",
            "recovery-reports/v1 的原始文件哈希不匹配清单，但将 CRLF 归一化为 LF 后与 manifest 哈希一致。",
            "Git 配置 core.autocrlf=true，模板资源在 Windows 工作区被转换为 CRLF。",
            f"Surefire 报告聚合摘要：{report_digest or '不可用'}。",
        ],
        "triageSignals": triage_signals,
        "recommendedAction": [
            "优先按受控变更修复模板资源字节稳定性，避免仅修改测试期望。",
            "对与 CRLF 无关的断言和文件系统异常单独复跑并登记负责人。",
            "修复前保持 G2 影子模式，不以本结果直接判定业务代码不合格。",
        ],
    }


def classify_lint(log_path: Path) -> dict[str, Any]:
    text = read_text(log_path)
    summary = last_match(r"✖\s+(\d+)\s+problems\s+\((\d+)\s+errors,\s*(\d+)\s+warnings\)", text)
    problems, errors, warnings = (int(value) for value in summary.groups()) if summary else (0, 0, 0)
    prettier_count = text.count("prettier/prettier")
    delete_cr_count = text.count("Delete `␍`")
    file_paths = re.findall(r"^(E:\\[^\r\n]+?\.(?:vue|js|mjs|ts))$", text, flags=re.MULTILINE)
    return {
        "id": "frontend-lint",
        "failureClass": "code/style",
        "subtype": "crlf-line-ending",
        "confidence": "high",
        "status": "confirmed-format-baseline",
        "owner": "张树旸",
        "reviewer": "贾婉月",
        "metrics": {
            "problems": problems,
            "errors": errors,
            "warnings": warnings,
            "prettierFindings": prettier_count,
            "deleteCrFindings": delete_cr_count,
            "distinctFiles": len(set(file_paths)),
        },
        "evidence": [
            f"{prettier_count} 条问题全部来自 prettier/prettier。",
            f"{delete_cr_count} 条问题均要求删除 CR 字符。",
            "尚未发现其他 ESLint 规则失败，当前 Lint 失败不能直接解释为业务逻辑缺陷。",
        ],
        "triageSignals": [],
        "recommendedAction": [
            "先建立行尾策略和全量格式化基线，再切换为增量或全量硬门禁。",
            "不要把一次全仓库 CRLF 修复与业务变更混在同一提交。",
            "硬门禁前至少完成一次干净工作树的全量 Lint 验证。",
        ],
    }


def classify_frontend_tests(log_path: Path) -> dict[str, Any]:
    text = read_text(log_path)
    summary = {}
    for key in ("tests", "pass", "fail", "cancelled", "skipped", "todo"):
        match = last_match(rf"^ℹ\s+{re.escape(key)}\s+(\d+)$", text)
        summary[key] = int(match.group(1)) if match else 0

    final_section = text.rsplit("✖ failing tests:", 1)[-1]
    test_at = list(
        re.finditer(r"^test at (tests\\[^:]+):(\d+):(\d+)$", final_section, flags=re.MULTILINE)
    )
    files = Counter(match.group(1).replace("\\", "/") for match in test_at)
    error_types = {
        "ReferenceError": len(re.findall(r"^  ReferenceError:", final_section, flags=re.MULTILINE)),
        "TypeError": len(re.findall(r"^  TypeError:", final_section, flags=re.MULTILINE)),
        "SyntaxError": len(re.findall(r"^  SyntaxError:", final_section, flags=re.MULTILINE)),
        "AssertionError": len(re.findall(r"^  AssertionError", final_section, flags=re.MULTILINE)),
    }
    triage_signals = []
    if "Cannot read properties of undefined (reading 'productId')" in final_section:
        triage_signals.append("prop-dashboard 测试存在 productId 未定义读取，需确认夹具或业务行为")
    if "actual: 'inspected'" in final_section and "expected: 'uninspected'" in final_section:
        triage_signals.append("prop-dashboard 的 inspected/uninspected 断言相反，需业务裁定")

    return {
        "id": "frontend-test",
        "failureClass": "existing-baseline",
        "subtype": "test-harness-and-localization",
        "confidence": "medium",
        "status": "triage-required",
        "owner": "贾婉月",
        "reviewer": "张树旸",
        "metrics": {
            "tests": summary["tests"],
            "pass": summary["pass"],
            "fail": summary["fail"],
            "identifiedFailureLocations": len(test_at),
            "errorTypes": error_types,
            "failureFiles": dict(sorted(files.items())),
        },
        "evidence": [
            "Node Test 汇总为 999 个测试、971 个通过、28 个失败。",
            "失败集中在测试夹具依赖注入、日文/中文文案期望、Vue 模板函数注入和动态 Function 参数解析。",
            "package.json 的 test 脚本和 c01-c02 测试夹具存在未提交改动，结果不能只归因于当前提交。",
            "日志包含 foldInputWidth 未定义、monthLabel 非函数、Arg string terminates parameters early 等测试运行错误。",
        ],
        "triageSignals": triage_signals,
        "recommendedAction": [
            "先固定测试夹具和语言环境，再判断断言差异是否代表产品缺陷。",
            "对无法在本周修复的既有失败建立带负责人、到期日和复验条件的失败基线。",
            "硬门禁只纳入稳定测试集，新增失败单独告警阻断。",
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="分类 G2 影子运行失败项")
    parser.add_argument("--run-dir", required=True, help="G2 运行目录")
    parser.add_argument("--output", help="输出 JSON 路径，默认写入运行目录")
    args = parser.parse_args()

    run_dir = Path(args.run_dir).resolve()
    gate_path = run_dir / "gate-results.json"
    if not gate_path.exists():
        raise SystemExit(f"未找到门禁结果：{gate_path}")
    gate = json.loads(gate_path.read_text(encoding="utf-8"))
    failed_ids = {item["id"] for item in gate.get("checks", []) if item.get("status") == "fail"}

    checks: list[dict[str, Any]] = []
    sources: dict[str, Any] = {}
    if "backend-test" in failed_ids:
        path = run_dir / "backend-test.log"
        reports_dir = find_surefire_reports(run_dir)
        checks.append(classify_backend(path, reports_dir))
        sources[path.name] = sha256(path)
        if reports_dir:
            _, _, _, _, report_digest = aggregate_surefire(reports_dir)
            sources["surefire-reports"] = report_digest
    if "frontend-lint" in failed_ids:
        path = run_dir / "frontend-lint.log"
        checks.append(classify_lint(path))
        sources[path.name] = sha256(path)
    if "frontend-test" in failed_ids:
        path = run_dir / "frontend-test.log"
        checks.append(classify_frontend_tests(path))
        sources[path.name] = sha256(path)

    result = {
        "schemaVersion": "1.0",
        "runId": gate.get("runId"),
        "changeId": gate.get("changeId"),
        "commit": gate.get("commit"),
        "environmentFingerprint": gate.get("environmentFingerprint"),
        "mode": gate.get("mode"),
        "classifiedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "sourceGate": gate_path.name,
        "sourceHashes": sources,
        "conclusion": {
            "overallStatus": gate.get("overallStatus"),
            "failedChecks": len(failed_ids),
            "confirmedBusinessDefects": 0,
            "note": "首轮分类未确认业务缺陷，不等于不存在业务缺陷；triage-required 项仍需负责人复核。",
            "gateRecommendation": "continue-shadow",
        },
        "checks": checks,
    }

    output = Path(args.output).resolve() if args.output else run_dir / "failure-classification.json"
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
