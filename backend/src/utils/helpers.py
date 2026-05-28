"""
Utility Helpers
================
Shared utilities used across the project.
"""

import sys
import logging
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

logger = logging.getLogger("smartpark.utils")


def get_device():
    """Get the best available computation device."""
    if torch.cuda.is_available():
        device = torch.device("cuda")
        logger.info(f"🔥 Using GPU: {torch.cuda.get_device_name(0)}")
    else:
        device = torch.device("cpu")
        logger.info("💻 Using CPU")
    return device


def format_params(count):
    """Format parameter count with K/M suffix."""
    if count >= 1_000_000:
        return f"{count / 1_000_000:.1f}M"
    elif count >= 1_000:
        return f"{count / 1_000:.1f}K"
    return str(count)


def format_time(seconds):
    """Format seconds into human-readable string."""
    if seconds < 60:
        return f"{seconds:.1f}s"
    elif seconds < 3600:
        m, s = divmod(seconds, 60)
        return f"{int(m)}m {int(s)}s"
    else:
        h, remainder = divmod(seconds, 3600)
        m, s = divmod(remainder, 60)
        return f"{int(h)}h {int(m)}m"
