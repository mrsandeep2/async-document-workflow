import os
import uuid
import aiofiles
from pathlib import Path
from fastapi import UploadFile
from app.core.config import settings


class FileStorageService:
    """Abstraction over local disk storage. Swap implementation for S3 etc."""

    def __init__(self):
        self.upload_dir = Path(settings.UPLOAD_DIR)
        self.upload_dir.mkdir(parents=True, exist_ok=True)

    async def save(self, file: UploadFile) -> tuple[str, str, int]:
        """Save uploaded file. Returns (stored_filename, file_path, file_size)."""
        ext = Path(file.filename).suffix
        stored_name = f"{uuid.uuid4()}{ext}"
        file_path = self.upload_dir / stored_name

        content = await file.read()
        async with aiofiles.open(file_path, "wb") as f:
            await f.write(content)

        return stored_name, str(file_path), len(content)

    def delete(self, file_path: str) -> None:
        try:
            os.remove(file_path)
        except FileNotFoundError:
            pass

    def read_bytes(self, file_path: str) -> bytes:
        with open(file_path, "rb") as f:
            return f.read()


file_storage = FileStorageService()
