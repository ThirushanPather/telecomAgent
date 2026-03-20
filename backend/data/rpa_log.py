"""
In-memory RPA action log — ported from poc/data/mockDb.js (rpaActionLog section).
Resets on each server restart (same behaviour as the JS version).
"""

RPA_LOG: list[dict] = []


def append_rpa_action(action: dict) -> dict:
    RPA_LOG.append(action)
    return action


def get_rpa_log() -> list:
    return RPA_LOG
