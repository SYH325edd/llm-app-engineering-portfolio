from fastapi import APIRouter


router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "mode": "safe"}


@router.get("/readiness")
def readiness() -> dict[str, str]:
    return {"status": "ready", "mode": "safe"}
