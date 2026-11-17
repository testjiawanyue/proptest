"""软断言收集器：一条用例可暴露多个不符合项，最后统一判定并一次性报告。"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class CheckResult:
    name: str
    passed: bool
    detail: str = ""


class Checks:
    def __init__(self, case_id: str):
        self.case_id = case_id
        self.results: list[CheckResult] = []

    def expect(self, name: str, condition: bool, detail: str = "") -> None:
        self.results.append(CheckResult(name, bool(condition), detail))

    def expect_equal(self, name: str, actual: object, expected: object) -> None:
        self.expect(name, actual == expected, f"期望={expected!r}，实际={actual!r}")

    @property
    def failures(self) -> list[CheckResult]:
        return [result for result in self.results if not result.passed]

    def finish(self) -> None:
        if self.failures:
            lines = [f"[{self.case_id}] 共 {len(self.failures)} 项不符合预期："]
            for result in self.failures:
                lines.append(f"  - {result.name}" + (f"（{result.detail}）" if result.detail else ""))
            raise AssertionError("\n".join(lines))
