# backend/services/ws_manager.py
"""
WebSocketManager — wraps a FastAPI WebSocket for type-safe message emission.

Each WebSocket connection gets its own manager instance with an isolated
session_id and temp directory. All messages are JSON frames with a "type"
discriminator field. The manager swallows WebSocketDisconnect exceptions
so callers don't need try/except around every send.
"""
import json
import uuid
import os
from typing import Any, Optional

from fastapi import WebSocket
from starlette.websockets import WebSocketDisconnect, WebSocketState


class WebSocketManager:
    """
    Per-connection WebSocket wrapper with typed message helpers.

    Attributes:
        ws: The underlying FastAPI WebSocket.
        session_id: Unique ID for this connection's file isolation.
        temp_dir: Absolute path to this session's temp directory.
    """

    def __init__(self, websocket: WebSocket):
        self.ws: WebSocket = websocket
        self.session_id: str = uuid.uuid4().hex
        self.temp_dir: str = os.path.abspath(f"temp/ws_{self.session_id}")
        os.makedirs(self.temp_dir, exist_ok=True)

    async def accept(self) -> None:
        """Accept the WebSocket connection."""
        await self.ws.accept()

    async def send_progress(self, stage: str, progress: float, message: str) -> None:
        """
        Send a progress frame to the client.

        Args:
            stage: Pipeline stage identifier (bpm_detection, bass_isolation, midi_conversion, quantization).
            progress: Progress value from 0.0 to 1.0.
            message: Human-readable status message.
        """
        await self._send_json({
            "type": "progress",
            "stage": stage,
            "progress": round(progress, 3),
            "message": message,
        })

    async def send_result(self, data: dict) -> None:
        """
        Send the final result frame. Merges {"type": "result"} into data.
        """
        await self._send_json({"type": "result", **data})

    async def send_multi_result(self, data: dict) -> None:
        """
        Send the final multi-stem result frame.
        """
        await self._send_json({"type": "multi_result", **data})

    async def send_error(self, message: str) -> None:
        """
        Send an error frame to the client.
        """
        await self._send_json({"type": "error", "message": message})

    async def receive_json(self) -> Optional[dict]:
        """
        Receive a JSON message from the client. Returns None on disconnect.
        """
        try:
            text = await self.ws.receive_text()
            return json.loads(text)
        except (WebSocketDisconnect, RuntimeError):
            return None
        except json.JSONDecodeError:
            return None

    async def receive_bytes(self) -> Optional[bytes]:
        """
        Receive binary data from the client. Returns None on disconnect.
        """
        try:
            return await self.ws.receive_bytes()
        except (WebSocketDisconnect, RuntimeError):
            return None

    async def close(self, code: int = 1000, reason: str = "") -> None:
        """Close the WebSocket connection gracefully."""
        try:
            if self.ws.client_state == WebSocketState.CONNECTED:
                await self.ws.close(code=code, reason=reason)
        except (WebSocketDisconnect, RuntimeError):
            pass

    @property
    def is_connected(self) -> bool:
        """Check if the WebSocket is still connected."""
        return self.ws.client_state == WebSocketState.CONNECTED

    async def _send_json(self, data: dict) -> None:
        """
        Internal: send a JSON dict. Swallows disconnect exceptions.
        """
        try:
            if self.ws.client_state == WebSocketState.CONNECTED:
                await self.ws.send_text(json.dumps(data))
        except (WebSocketDisconnect, RuntimeError):
            pass
