# backend/services/cancellation.py
"""
Thread-safe cancellation pattern for long-running audio pipelines.
A CancellationToken is shared between the WebSocket handler and the
pipeline worker thread. The WS handler calls cancel() when the client
sends {"type": "cancel"}, and the pipeline checks check() between stages.
"""
import asyncio


class CancellationError(Exception):
    """Raised when a pipeline stage detects that cancellation was requested."""
    pass


class CancellationToken:
    """
    Thread-safe cancellation token backed by asyncio.Event.

    Usage:
        token = CancellationToken()
        # In WebSocket handler (async context):
        token.cancel()
        # In pipeline worker (sync or async context):
        token.check()  # raises CancellationError if cancelled
    """

    def __init__(self):
        self._event = asyncio.Event()

    def cancel(self) -> None:
        """Request cancellation. Thread-safe."""
        self._event.set()

    @property
    def is_cancelled(self) -> bool:
        """Check if cancellation has been requested without raising."""
        return self._event.is_set()

    def check(self) -> None:
        """
        Raise CancellationError if cancel() has been called.
        Call this between pipeline stages to allow early exit.
        """
        if self._event.is_set():
            raise CancellationError("Processing cancelled by user.")
