"""Preview entrypoint: serves the PPRC API under /api for the platform ingress."""
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from fastapi import FastAPI  # noqa: E402

from app.main import app as pprc_api, lifespan as pprc_lifespan  # noqa: E402


@asynccontextmanager
async def lifespan(root: FastAPI):
    # Mounted sub-apps do not run their own lifespan, so run it here.
    async with pprc_lifespan(pprc_api):
        if os.environ.get("PPRC_SEED_DEMO") == "true":
            from scripts.seed_fresh_club import seed

            await seed("admin", "Club Administrator", True)
        yield


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)
app.mount("/api", pprc_api)
