import json
import os
from pathlib import Path
from typing import Optional

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .config import MASTER_KEY_PATH, SETTINGS_PATH, DEFAULT_BASE_URL, DEFAULT_MODELS


def _load_or_create_master_key() -> bytes:
    if MASTER_KEY_PATH.exists():
        raw = MASTER_KEY_PATH.read_bytes()
        if len(raw) != 32:
            raise RuntimeError("Invalid local master key")
        return raw
    key = AESGCM.generate_key(bit_length=256)
    MASTER_KEY_PATH.write_bytes(key)
    try:
        os.chmod(MASTER_KEY_PATH, 0o600)
    except OSError:
        pass
    return key


def encrypt_secret(value: str) -> dict:
    key = _load_or_create_master_key()
    nonce = os.urandom(12)
    encrypted = AESGCM(key).encrypt(nonce, value.encode("utf-8"), None)
    return {"nonce": nonce.hex(), "ciphertext": encrypted.hex()}


def decrypt_secret(payload: dict) -> str:
    key = _load_or_create_master_key()
    nonce = bytes.fromhex(payload["nonce"])
    encrypted = bytes.fromhex(payload["ciphertext"])
    return AESGCM(key).decrypt(nonce, encrypted, None).decode("utf-8")


def load_provider_settings(include_secret: bool = False) -> dict:
    data = {
        "base_url": DEFAULT_BASE_URL,
        "models": DEFAULT_MODELS.copy(),
        "has_api_key": False,
        "api_key_masked": "",
    }
    if SETTINGS_PATH.exists():
        saved = json.loads(SETTINGS_PATH.read_text("utf-8"))
        data["base_url"] = saved.get("base_url") or DEFAULT_BASE_URL
        data["models"].update(saved.get("models") or {})
        enc = saved.get("api_key")
        if enc:
            try:
                secret = decrypt_secret(enc)
                data["has_api_key"] = True
                data["api_key_masked"] = mask_key(secret)
                if include_secret:
                    data["api_key"] = secret
            except Exception:
                data["has_api_key"] = False
    return data


def save_provider_settings(base_url: str, models: dict, api_key: Optional[str] = None) -> dict:
    current = {}
    if SETTINGS_PATH.exists():
        current = json.loads(SETTINGS_PATH.read_text("utf-8"))
    payload = {
        "base_url": base_url.strip().rstrip("/"),
        "models": {**DEFAULT_MODELS, **(models or {})},
    }
    if api_key and api_key.strip():
        payload["api_key"] = encrypt_secret(api_key.strip())
    elif current.get("api_key"):
        payload["api_key"] = current["api_key"]
    SETTINGS_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), "utf-8")
    return load_provider_settings(False)


def mask_key(value: str) -> str:
    if len(value) <= 8:
        return "•" * len(value)
    return value[:4] + "•" * max(8, len(value) - 8) + value[-4:]
