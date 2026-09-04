from __future__ import annotations

import logging
from logging.config import dictConfig
from typing import Any

LOG_FORMAT = "%(asctime)s | %(levelname)s | %(name)s | %(message)s"


def configure_logging(log_level: str) -> None:
    """Configure application and Uvicorn logs with one consistent format."""

    normalized_level = log_level.upper()
    if normalized_level not in logging.getLevelNamesMapping():
        raise ValueError(f"Unknown log level: {log_level}")

    config: dict[str, Any] = {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "default": {
                "format": LOG_FORMAT,
            }
        },
        "handlers": {
            "console": {
                "class": "logging.StreamHandler",
                "formatter": "default",
                "stream": "ext://sys.stdout",
            }
        },
        "root": {
            "handlers": ["console"],
            "level": normalized_level,
        },
        # Uvicorn installs its own handlers unless we explicitly replace them.
        "loggers": {
            "uvicorn": {
                "handlers": ["console"],
                "level": normalized_level,
                "propagate": False,
            },
            "uvicorn.access": {
                "handlers": ["console"],
                "level": normalized_level,
                "propagate": False,
            },
        },
    }

    dictConfig(config)
