"""Logging configuration and helper."""
import logging
import sys
from typing import Optional

from config import get_settings


def get_logger(name: str, level: Optional[str] = None) -> logging.Logger:
    """Get a configured logger for the given module name."""
    settings = get_settings()
    log_level_str = level or settings.log_level.upper()
    numeric_level = getattr(logging, log_level_str, logging.INFO)

    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setLevel(numeric_level)
        formatter = logging.Formatter(
            fmt="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
        handler.setFormatter(formatter)
        logger.addHandler(handler)

    logger.setLevel(numeric_level)
    return logger
