import os
import uvicorn

if __name__ == "__main__":
    uvicorn.run("backend.app.main:app", host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "8000")), reload=os.getenv("APP_RELOAD", "false").lower() == "true")
