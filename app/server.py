"""FastAPI 应用与路由。"""
from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app import config
from app import settings as settings_store
from app.db import init_db
from app.services import agent as agent_service
from app.services import collect as collect_service
from app.services import notes as notes_service
from app.services.collect import CollectError


# ---------------------------------------------------------------- 请求体模型


class CollectIn(BaseModel):
    url: str


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
    source_url: str = ""
    source_snapshot: str = ""
    tags: list[str] = []


class NotePatch(BaseModel):
    title: str | None = None
    summary: str | None = None
    content: str | None = None
    points: list[str] | None = None
    source_url: str | None = None
    source_snapshot: str | None = None
    tags: list[str] | None = None


class ProviderGroup(BaseModel):
    model: str | None = None
    base_url: str | None = None
    api_key: str | None = None


class SettingsIn(BaseModel):
    provider: str | None = None
    claude: ProviderGroup | None = None
    openai: ProviderGroup | None = None


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

    # ------------------------------------------------ 采集

    @app.post("/api/collect")
    async def collect(payload: CollectIn) -> dict[str, Any]:
        try:
            return await collect_service.collect_url(payload.url)
        except CollectError as exc:
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

    # ------------------------------------------------ 笔记

    @app.get("/api/notes")
    def list_notes(
        q: str = Query(default=""),
        tag: str = Query(default=""),
    ) -> list[dict[str, Any]]:
        return notes_service.list_notes(_path(), q=q.strip(), tag=tag.strip())

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

    @app.get("/api/tags")
    def tags() -> list[str]:
        return notes_service.list_tags(_path())

    return app


# uvicorn 入口：uvicorn app.server:app
app = create_app()
