"""FastAPI 应用与路由。"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app import config
from app import settings as settings_store
from app.config import frontend_dist_dir
from app.db import init_db
from app.services import agent as agent_service
from app.services import collect as collect_service
from app.services import events as events_service
from app.services import export as export_service
from app.services import folders as folders_service
from app.services import notes as notes_service
from app.services.collect import CollectError


# ---------------------------------------------------------------- 请求体模型


class CollectIn(BaseModel):
    url: str


class CollectFilePathIn(BaseModel):
    """桌面版专用：直接读取本机路径上的文档(由 run_desktop 标记环境后开放)。"""
    path: str
    force_ocr: bool = False


class SummarizeIn(BaseModel):
    title: str = ""
    content: str


class AskIn(BaseModel):
    note_id: int
    question: str


class NoteIn(BaseModel):
    title: str = ""
    summary: str = ""
    content: str = ""
    points: list[str] = []
    comments: list[dict[str, Any]] = []
    source_url: str = ""
    source_snapshot: str = ""
    folder_id: int | None = None


class NotePatch(BaseModel):
    title: str | None = None
    summary: str | None = None
    content: str | None = None
    points: list[str] | None = None
    comments: list[dict[str, Any]] | None = None
    source_url: str | None = None
    source_snapshot: str | None = None
    folder_id: int | None = None


class FolderIn(BaseModel):
    name: str


class FolderPatch(BaseModel):
    name: str


class EventIn(BaseModel):
    title: str
    kind: str = "todo"
    color: str = "green"
    recur: str = "none"
    start_ts: int
    end_ts: int | None = None
    all_day: bool = False
    done: bool = False
    note_id: int | None = None


class EventPatch(BaseModel):
    title: str | None = None
    kind: str | None = None
    color: str | None = None
    recur: str | None = None
    start_ts: int | None = None
    end_ts: int | None = None
    all_day: bool | None = None
    done: bool | None = None
    note_id: int | None = None


class ProviderGroup(BaseModel):
    model: str | None = None
    base_url: str | None = None
    api_key: str | None = None


class SettingsIn(BaseModel):
    provider: str | None = None
    claude: ProviderGroup | None = None
    openai: ProviderGroup | None = None
    deepseek: ProviderGroup | None = None
    qwen: ProviderGroup | None = None


class SettingsTestIn(BaseModel):
    """测试连接用的临时配置(可含用户刚输入、尚未保存的 Key)。"""
    provider: str
    base_url: str | None = None
    model: str | None = None
    api_key: str | None = None


def create_app(db_path: str | None = None, settings_path: str | None = None) -> FastAPI:
    db_path = db_path or str(config.db_path())
    settings_path = settings_path or str(settings_store.settings_path())

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        init_db(db_path)
        yield

    app = FastAPI(title="RedNote", lifespan=lifespan)
    app.state.db_path = db_path
    app.state.settings_path = settings_path

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def _path() -> str:
        return app.state.db_path

    def _settings_path() -> str:
        return app.state.settings_path

    # ------------------------------------------------ 设置

    @app.get("/api/settings")
    def get_settings() -> dict[str, Any]:
        cfg = settings_store.load(_settings_path())
        return {"settings": settings_store.public_view(cfg), "active": settings_store.active_provider(cfg)}

    @app.put("/api/settings")
    def put_settings(payload: SettingsIn) -> dict[str, Any]:
        patch = payload.model_dump(exclude_unset=True)
        # 去除未提供的嵌套空组，避免误清空已有配置
        patch = {k: v for k, v in patch.items() if v is not None}
        try:
            cfg = settings_store.apply_patch(patch, _settings_path())
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        settings_store.save(cfg, _settings_path())
        return {"settings": settings_store.public_view(cfg), "active": settings_store.active_provider(cfg)}

    @app.post("/api/settings/test")
    async def test_settings(payload: SettingsTestIn) -> dict[str, Any]:
        """用(临时输入的或已保存的)配置发一条极小请求，验证模型连通性。"""
        from app.services import providers

        provider = payload.provider
        if provider == "mock" or provider not in settings_store.PROVIDERS:
            raise HTTPException(status_code=400, detail="请先选择一个真实模型（如 DeepSeek / 通义千问）再测试")
        group: dict[str, Any] = {}
        for key in ("base_url", "model", "api_key"):
            value = getattr(payload, key)
            if value is not None and str(value).strip():
                group[key] = str(value).strip()
        # 未显式填写的字段回落到已保存配置(如之前存过的 Key)，便于测“已存配置”
        stored = (settings_store.load(_settings_path()) or {}).get(provider) or {}
        for key in ("base_url", "model", "api_key"):
            if key not in group and stored.get(key):
                group[key] = stored[key]
        cfg: dict[str, Any] = {"provider": provider, provider: group}
        try:
            reply = await providers.test_connection(cfg)
        except providers.ProviderError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:  # noqa: BLE001 - 兜底，保证有可展示的失败原因
            raise HTTPException(status_code=400, detail=f"测试失败：{exc}") from exc
        return {"ok": True, "reply": reply[:80]}

    # ------------------------------------------------ 采集

    @app.post("/api/collect")
    async def collect(payload: CollectIn) -> dict[str, Any]:
        try:
            return await collect_service.collect_url(payload.url)
        except CollectError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/collect/file")
    async def collect_file(
        file: UploadFile = File(...),
        force_ocr: str = Form("0"),
    ) -> dict[str, Any]:
        """拖拽导入本地文档：PDF / DOCX / TXT / Markdown(扫描件自动 OCR)。"""
        from app.services import fileparse

        data = await file.read()
        try:
            fileparse.check_size(len(data))
            return fileparse.parse_bytes(file.filename, data, force_ocr=force_ocr.lower() in ("1", "true"))
        except fileparse.FileParseError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/collect/filepath")
    async def collect_filepath(payload: CollectFilePathIn) -> dict[str, Any]:
        """桌面版专用：读取本机路径上的文件(原生对话框选择)，供“打开本地文件/OCR重试”使用。"""
        from app.services import fileparse

        if os.getenv("REDNOTE_DESKTOP") != "1":
            raise HTTPException(status_code=403, detail="该接口仅在桌面版可用")
        path = Path(payload.path).expanduser()
        try:
            data = path.read_bytes()
        except FileNotFoundError as exc:
            raise HTTPException(status_code=400, detail="找不到该文件（可能已被移动或删除）") from exc
        except OSError as exc:
            raise HTTPException(status_code=400, detail=f"无法读取文件：{exc}") from exc
        try:
            fileparse.check_size(len(data))
            return fileparse.parse_bytes(path.name, data, force_ocr=payload.force_ocr)
        except fileparse.FileParseError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    # ------------------------------------------------ Agent

    def _current_provider():
        from app.services import providers

        cfg = settings_store.load(_settings_path())
        return providers.build_provider(cfg)

    @app.post("/api/agent/summarize")
    async def summarize(payload: SummarizeIn) -> dict[str, Any]:
        try:
            return await agent_service.summarize(
                payload.title, payload.content, provider=_current_provider()
            )
        except agent_service.AgentError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    @app.post("/api/agent/ask")
    async def ask(payload: AskIn) -> dict[str, Any]:
        note = notes_service.get_note(_path(), payload.note_id)
        if not note:
            raise HTTPException(status_code=404, detail="笔记不存在")
        try:
            answer = await agent_service.ask(
                note, payload.question, provider=_current_provider()
            )
        except agent_service.AgentError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        return {"answer": answer}

    @app.post("/api/agent/explain")
    async def explain(payload: SummarizeIn) -> dict[str, Any]:
        try:
            return await agent_service.explain(
                payload.title, payload.content, provider=_current_provider()
            )
        except agent_service.AgentError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    # ------------------------------------------------ 笔记

    @app.get("/api/notes")
    def list_notes(
        q: str = Query(default=""),
        folder: int | None = Query(default=None),
    ) -> list[dict[str, Any]]:
        return notes_service.list_notes(_path(), q=q.strip(), folder=folder)

    @app.get("/api/notes/{note_id}")
    def get_note(note_id: int) -> dict[str, Any]:
        note = notes_service.get_note(_path(), note_id)
        if not note:
            raise HTTPException(status_code=404, detail="笔记不存在")
        return note

    @app.post("/api/notes", status_code=201)
    def create_note(payload: NoteIn) -> dict[str, Any]:
        return notes_service.create_note(_path(), payload.model_dump())

    @app.patch("/api/notes/{note_id}")
    def update_note(note_id: int, payload: NotePatch) -> dict[str, Any]:
        patch = payload.model_dump(exclude_unset=True)
        try:
            note = notes_service.update_note(_path(), note_id, patch)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if not note:
            raise HTTPException(status_code=404, detail="笔记不存在")
        return note

    @app.delete("/api/notes/{note_id}", status_code=204)
    def delete_note(note_id: int) -> None:
        if not notes_service.delete_note(_path(), note_id):
            raise HTTPException(status_code=404, detail="笔记不存在")

    # ------------------------------------------------ 收藏夹

    @app.get("/api/folders")
    def list_folders() -> list[dict[str, Any]]:
        return folders_service.list_folders(_path())

    @app.post("/api/folders", status_code=201)
    def create_folder(payload: FolderIn) -> dict[str, Any]:
        try:
            return folders_service.create_folder(_path(), payload.name)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.patch("/api/folders/{folder_id}")
    def rename_folder(folder_id: int, payload: FolderPatch) -> dict[str, Any]:
        try:
            folder = folders_service.rename_folder(_path(), folder_id, payload.name)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if not folder:
            raise HTTPException(status_code=404, detail="收藏夹不存在")
        return folder

    @app.delete("/api/folders/{folder_id}", status_code=204)
    def delete_folder(folder_id: int) -> None:
        if not folders_service.delete_folder(_path(), folder_id):
            raise HTTPException(status_code=404, detail="收藏夹不存在")

    # ------------------------------------------------ 日历(日程/待办)

    def _event_err(action: str) -> None:
        raise HTTPException(status_code=400, detail=action)

    @app.get("/api/events")
    def list_events(
        start: int | None = Query(default=None),
        end: int | None = Query(default=None),
    ) -> list[dict[str, Any]]:
        return events_service.list_events(_path(), start, end)

    @app.post("/api/events", status_code=201)
    def create_event(payload: EventIn) -> dict[str, Any]:
        try:
            return events_service.create_event(_path(), payload.model_dump())
        except ValueError as exc:
            _event_err(str(exc))
            raise

    @app.patch("/api/events/{event_id}")
    def update_event(event_id: int, payload: EventPatch) -> dict[str, Any]:
        try:
            event = events_service.update_event(_path(), event_id, payload.model_dump(exclude_unset=True))
        except ValueError as exc:
            _event_err(str(exc))
            raise
        if not event:
            raise HTTPException(status_code=404, detail="事项不存在")
        return event

    @app.delete("/api/events/{event_id}", status_code=204)
    def delete_event(event_id: int) -> None:
        if not events_service.delete_event(_path(), event_id):
            raise HTTPException(status_code=404, detail="事项不存在")

    # ------------------------------------------------ 导出 / 备份

    def _attachment(filename: str) -> dict[str, str]:
        return {"Content-Disposition": f'attachment; filename="{filename}"'}

    @app.get("/api/export/notes.md")
    def export_notes_md() -> Response:
        notes = notes_service.list_notes(_path())
        body = export_service.notes_to_markdown(notes)
        return Response(
            content=body,
            media_type="text/markdown; charset=utf-8",
            headers=_attachment("rednote-notes.md"),
        )

    @app.get("/api/notes/{note_id}/export.md")
    def export_note_md(note_id: int) -> Response:
        note = notes_service.get_note(_path(), note_id)
        if not note:
            raise HTTPException(status_code=404, detail="笔记不存在")
        return Response(
            content=export_service.note_to_markdown(note),
            media_type="text/markdown; charset=utf-8",
            headers=_attachment(f"note-{note_id}.md"),
        )

    @app.get("/api/export/backup.db")
    def export_backup_db() -> Response:
        payload = export_service.sqlite_backup_bytes(_path())
        return Response(
            content=payload,
            media_type="application/vnd.sqlite3",
            headers=_attachment("rednote-backup.db"),
        )

    # ------------------------------------------------ 前端静态托管(生产/桌面)

    dist = frontend_dist_dir()
    if dist is not None:
        assets = dist / "assets"
        if assets.is_dir():
            app.mount("/assets", StaticFiles(directory=str(assets)), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        def spa(full_path: str) -> Response:
            # SPA 回退：存在的文件直接给，其余交给 index.html 处理前端路由
            if full_path:
                candidate = (dist / full_path).resolve()
                root = dist.resolve()
                if candidate.is_file() and candidate.is_relative_to(root):
                    return FileResponse(candidate)
            index = dist / "index.html"
            if index.is_file():
                return FileResponse(index)
            return Response("前端未构建：请先在 frontend/ 目录执行 npm run build", status_code=404)

    return app


# uvicorn 入口：uvicorn app.server:app
app = create_app()
