"""框架自检示例：离线可运行，不依赖任何被测系统。

真实用例请在本目录新增 ``test_*.py``，通过 ``page`` / ``context`` / ``settings``
等 fixture 操作 ``pages`` 层的页面对象，并在本层断言。

运行：
    pytest -s -v
"""

from __future__ import annotations

import pytest


_HTML = """
<html>
  <body>
    <h1 id="title">框架就绪</h1>
    <button id="btn" type="button">点我</button>
    <script>
      document.getElementById('btn').addEventListener('click', function () {
        document.getElementById('title').textContent = '已点击';
      });
    </script>
  </body>
</html>
"""


@pytest.mark.smoke
def test_page_fixture_renders(page) -> None:
    page.set_content(_HTML)
    assert page.locator("#title").inner_text() == "框架就绪"
    page.locator("#btn").click()
    assert page.locator("#title").inner_text() == "已点击"


def test_settings_fixture(settings) -> None:
    assert settings.base_url.startswith(("http://", "https://"))
