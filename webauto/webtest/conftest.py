"""Global pytest/Playwright diagnostics.

The page objects, business flows and tests remain unaware of recording and
reporting. The standard pytest-playwright ``context`` and ``page`` fixtures
are overridden here so every test context is traced and video-enabled.
"""

from __future__ import annotations

import hashlib
import os
import shutil
from pathlib import Path
from typing import Any

import pytest

from business.auth_flow import AuthFlow
from common.config import DEFAULT_BASE_URL, Settings, settings_from_env
from data.factory import ensure_seed_data

try:  # Allure is optional when only running pytest locally.
    import allure
except ImportError:  # pragma: no cover - depends on the test environment
    allure = None  # type: ignore[assignment]


_ARTIFACTS: dict[int, list[dict[str, Any]]] = {}
_CONTEXT_META: dict[int, dict[str, Any]] = {}


def _base_url(config) -> str:
    try:
        cli = config.getoption("base_url", default=None)
    except (AttributeError, ValueError):
        cli = None
    return (cli or os.getenv("WEBTEST_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")


def _safe_test_name(nodeid: str) -> str:
    """Return a stable, Windows-safe and bounded artifact name."""
    readable = "".join(char if char.isalnum() or char in "._-" else "_" for char in nodeid)
    readable = readable.strip("._") or "test"
    digest = hashlib.sha1(nodeid.encode("utf-8")).hexdigest()[:10]
    return f"{readable[:110]}_{digest}"


def _make_artifact_dirs(root: Path) -> dict[str, Path]:
    directories = {
        "videos": root / "videos",
        "screenshots": root / "screenshots",
        "allure": root / "allure-results",
    }
    for path in directories.values():
        path.mkdir(parents=True, exist_ok=True)
    return directories


def _needs_diagnostics(item: pytest.Item) -> bool:
    """Return whether pytest reported a failure or an expected failure."""
    return any(
        bool(
            getattr(getattr(item, f"rep_{phase}", None), "failed", False)
            or getattr(getattr(item, f"rep_{phase}", None), "wasxfail", False)
        )
        for phase in ("setup", "call", "teardown")
    )


def _new_meta(item: pytest.Item, artifact_dir: Path) -> dict[str, Any]:
    dirs = _make_artifact_dirs(artifact_dir)
    name = _safe_test_name(item.nodeid)
    video_dir = dirs["videos"] / name
    video_dir.mkdir(parents=True, exist_ok=True)
    meta: dict[str, Any] = {
        "item": item,
        "name": name,
        "video_dir": video_dir,
        "pages": [],
        "screenshots": [],
        "videos": [],
        "finalized": False,
        "allure_attached": False,
    }
    _ARTIFACTS.setdefault(id(item), []).append(meta)
    return meta


def _register_page(meta: dict[str, Any], page: Any) -> None:
    if page not in meta["pages"]:
        meta["pages"].append(page)


def _capture_screenshots(meta: dict[str, Any], pages: list[Any], artifact_dir: Path) -> None:
    if not _needs_diagnostics(meta["item"]):
        return
    for index, page in enumerate(pages, start=1):
        try:
            if page.is_closed():
                continue
            path = artifact_dir / "screenshots" / f"{meta['name']}_{index}.png"
            page.screenshot(path=str(path), full_page=True)
            meta["screenshots"].append(Path(path))
        except Exception:
            # Diagnostics must never mask the original test failure.
            continue


def _finalize_context(meta: dict[str, Any], context: Any, artifact_dir: Path) -> None:
    if meta["finalized"]:
        return
    meta["finalized"] = True

    pages = list(meta["pages"])
    try:
        pages.extend(page for page in context.pages if page not in pages)
    except Exception:
        pass

    _capture_screenshots(meta, pages, artifact_dir)

    try:
        context.close()
    except Exception:
        pass

    # Playwright flushes recordings when the context closes. Scan the directory
    # directly instead of relying on page.video.path(), which is version- and
    # lifecycle-sensitive after context shutdown.
    try:
        recorded_videos = sorted(meta["video_dir"].rglob("*.webm"))
    except OSError:
        recorded_videos = []
    for index, source in enumerate(recorded_videos, start=1):
        try:
            target = meta["video_dir"] / f"{meta['name']}_{index}.webm"
            if source.resolve() != target.resolve():
                if target.exists():
                    target.unlink()
                shutil.move(str(source), str(target))
            meta["videos"].append(target)
        except Exception:
            continue

    if _needs_diagnostics(meta["item"]):
        _attach_allure(meta)
    _CONTEXT_META.pop(id(context), None)


def _attach_allure(meta: dict[str, Any]) -> None:
    if allure is None or meta["allure_attached"]:
        return
    meta["allure_attached"] = True
    for path in [*meta["screenshots"], *meta["videos"]]:
        if not path.exists():
            continue
        try:
            if path.suffix.lower() == ".png":
                attachment_type = getattr(getattr(allure, "attachment_type", None), "PNG", "image/png")
            else:
                attachment_type = getattr(getattr(allure, "attachment_type", None), "WEBM", "video/webm")
            allure.attach.file(str(path), name=path.name, attachment_type=attachment_type)
        except Exception:
            continue


def _context_kwargs(request: pytest.FixtureRequest, base_url: str, video_dir: Path) -> dict[str, Any]:
    try:
        kwargs = dict(request.getfixturevalue("browser_context_args"))
    except pytest.FixtureLookupError:
        kwargs = {}
    kwargs.setdefault("base_url", base_url)
    kwargs["record_video_dir"] = str(video_dir)
    return kwargs


@pytest.fixture(scope="session")
def base_url(request) -> str:
    return _base_url(request.config)


@pytest.fixture(scope="session")
def settings(base_url: str) -> Settings:
    """Shared environment configuration."""
    return settings_from_env(base_url)


@pytest.fixture
def artifact_dir() -> Path:
    path = Path(__file__).parent / "reports"
    _make_artifact_dirs(path)
    return path


def _start_context(browser: Any, base_url: str, request: pytest.FixtureRequest, artifact_dir: Path):
    meta = _new_meta(request.node, artifact_dir)
    context = browser.new_context(**_context_kwargs(request, base_url, meta["video_dir"]))
    _CONTEXT_META[id(context)] = meta
    return context, meta


@pytest.fixture
def context(browser, base_url, request, artifact_dir):
    """Replacement for pytest-playwright's context fixture with diagnostics."""
    context, meta = _start_context(browser, base_url, request, artifact_dir)
    yield context
    _finalize_context(meta, context, artifact_dir)


@pytest.fixture
def page(context, request):
    """Replacement page fixture; its context owns closing and diagnostics."""
    meta = _CONTEXT_META[id(context)]
    page = context.new_page()
    _register_page(meta, page)
    yield page


@pytest.fixture
def authenticated_context(browser, base_url, request, artifact_dir):
    """Unified authenticated context entry point, with the same diagnostics."""
    context, meta = _start_context(browser, base_url, request, artifact_dir)
    yield context
    _finalize_context(meta, context, artifact_dir)


@pytest.fixture
def traced_page(authenticated_context, request):
    """A traced page for tests that explicitly request this fixture."""
    meta = _CONTEXT_META[id(authenticated_context)]
    page = authenticated_context.new_page()
    _register_page(meta, page)
    yield page


@pytest.fixture
def logged_in_page(page, settings):
    """Return a page that has completed the real login flow.

    登录后立即 ensure_seed_data：后端 jacket seed data（PTG）是多条
    生产链路测试的前置依赖，放在 fixture 里统一保障，比在每条业务流
    里单独调用更可靠（直接 ``ProductionIntakePage().open()`` 的测试
    也能拿到 seed data）。
    """
    AuthFlow(page, settings).login()
    ensure_seed_data(page, settings.base_url)
    return page


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item: pytest.Item, call: pytest.CallInfo):
    outcome = yield
    report = outcome.get_result()
    setattr(item, f"rep_{report.when}", report)

    # Fixture teardown has completed by the time the teardown report exists.
    # A video is deleted only when setup, call and teardown all succeeded.
    if report.when == "teardown":
        reports = _ARTIFACTS.pop(id(item), [])
        failed = _needs_diagnostics(item)
        for meta in reports:
            if failed:
                _attach_allure(meta)
                continue
            videos = list(meta["videos"])
            try:
                videos.extend(meta["video_dir"].glob("*.webm"))
            except OSError:
                pass
            for video in videos:
                try:
                    video.unlink(missing_ok=True)
                except Exception:
                    pass
            try:
                meta["video_dir"].rmdir()
            except OSError:
                pass
