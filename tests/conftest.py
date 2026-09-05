"""共享测试夹具。"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.db import init_db


@pytest.fixture
def db_path(tmp_path):
    """一个已建好表的临时 SQLite 数据库路径。"""
    path = tmp_path / "test.db"
    init_db(path)
    return path


@pytest.fixture
def client(db_path):
    """基于临时数据库的 FastAPI 测试客户端。"""
    from app.server import create_app

    app = create_app(str(db_path))
    with TestClient(app) as c:
        yield c


@pytest.fixture
def sample_html() -> str:
    return """<!DOCTYPE html>
<html lang="zh">
<head><meta charset="utf-8"><title>注意力机制入门</title></head>
<body>
<nav>导航链接</nav>
<article>
  <h1>注意力机制入门</h1>
  <p>注意力机制让模型在处理当前位置时，关注序列中更重要的其他位置。</p>
  <p>它的核心是查询、键、值的加权求和。这一思想被广泛应用于大语言模型。</p>
  <p>理解注意力机制，是理解 Transformer 的第一步。</p>
</article>
<footer>版权信息</footer>
</body>
</html>"""
