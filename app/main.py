"""本地启动入口：python -m app.main"""
import uvicorn

if __name__ == "__main__":
    uvicorn.run("app.server:app", host="127.0.0.1", port=8000, reload=True)
