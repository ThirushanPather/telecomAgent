"""
Mock subscriber data — ported from poc/data/subscribers.js.
Uses a seeded RNG (seed=42) so the 50 records are identical on every restart.
Same name pools, same SA MSISDN format, same lifecycle bucket distribution.
"""

import random
from datetime import date, timedelta

_rng = random.Random(42)

# ── Name pools ──────────────────────────────────────────────────────────────

FIRST_NAMES = [
    "Thabo", "Sipho", "Nomsa", "Zanele", "Lerato",
    "Mpho", "Kagiso", "Thandeka", "Siyabonga", "Nokwanda",
    "Rethabile", "Lwazi", "Nhlanhla", "Palesa", "Ayanda",
    "Dumisani", "Nompumelelo", "Sifiso", "Lindiwe", "Mthokozisi",
    "Precious", "Bongani", "Fikile", "Lungelo", "Nokuthula",
    "Teboho", "Nozipho", "Sandile", "Hlengiwe", "Mandla",
    "Refiloe", "Sibonelo", "Ntombi", "Thulisile", "Lwandile",
    "Kuhle", "Ntsika", "Simangele", "Mlungisi", "Zodwa",
    "Vusi", "Nothando", "Musa", "Busisiwe", "Thulani",
    "Nonhlanhla", "Sibusiso", "Khanyisile", "Mduduzi", "Ntombizodwa",
]

LAST_NAMES = [
    "Dlamini", "Nkosi", "Mthembu", "Zulu", "Ndlovu",
    "Khumalo", "Mkhize", "Shabalala", "Mabaso", "Cele",
    "Ntuli", "Nxumalo", "Ngcobo", "Majola", "Sithole",
    "Zwane", "Gumbi", "Mbatha", "Hlongwane", "Mdlalose",
    "Buthelezi", "Nzama", "Mthethwa", "Ngubane", "Msomi",
    "Mnguni", "Nxele", "Sibiya", "Ngema", "Msweli",
    "Maphumulo", "Khoza", "Mhlongo", "Shange", "Mthiyane",
    "Dube", "Hadebe", "Vilakazi", "Mthanti", "Ngwenya",
    "Molefe", "Mahlangu", "Motsepe", "Bhengu", "Myeni",
    "Naidoo", "Pillay", "Govender", "Patel", "Singh",
]

# SA Vodacom mobile prefixes (digits after +27)
_NETWORK_PREFIXES = [
    "60", "61", "62", "63", "64",
    "71", "72", "73", "74", "76",
    "78", "79", "82", "83", "84",
]


# ── Helpers ──────────────────────────────────────────────────────────────────

def _ri(lo: int, hi: int) -> int:
    return _rng.randint(lo, hi)


def _pick(arr: list):
    return _rng.choice(arr)


def _date_ago(days: int) -> str:
    return (date.today() - timedelta(days=days)).isoformat()


def _make_msisdn() -> str:
    return f"+27{_pick(_NETWORK_PREFIXES)}{_ri(1_000_000, 9_999_999)}"


# ── Lifecycle profile per bucket ─────────────────────────────────────────────

def _profile_for(days: int) -> dict:
    if days <= 30:
        return {
            "account_type": _pick(["STANDARD", "STANDARD", "STANDARD", "TUC", "NVP"]),
            "service_status": "ACTIVE" if days <= 20 else _pick(["ACTIVE", "SOFT_LOCKED"]),
            "last_contact_method": _pick(["SMS", "SMS", "NONE", "CALL"]),
            "last_response": _pick(["NO_ANSWER", "PTP", "NONE", "NO_ANSWER"]),
            "last_contact_date": None if days <= 3 else _date_ago(_ri(1, min(days - 1, 7))),
            "open_epix_tickets": _rng.random() < 0.15,
            "bureau_listed": False,
            "dca_placement": None,
        }

    if days <= 60:
        return {
            "account_type": _pick(["STANDARD", "NVP", "TUC", "HIGH_RISK"]),
            "service_status": _pick(["SOFT_LOCKED", "SOFT_LOCKED", "SUSPENDED"]),
            "last_contact_method": _pick(["CALL", "SMS", "EMAIL"]),
            "last_response": _pick(["NO_ANSWER", "NO_ANSWER", "BROKEN_PTP", "DISPUTE"]),
            "last_contact_date": _date_ago(_ri(3, 14)),
            "open_epix_tickets": _rng.random() < 0.25,
            "bureau_listed": False,
            "dca_placement": None,
        }

    if days <= 90:
        return {
            "account_type": _pick(["NVP", "HIGH_RISK", "STANDARD", "FPD"]),
            "service_status": _pick(["SUSPENDED", "SUSPENDED", "SOFT_LOCKED"]),
            "last_contact_method": _pick(["CALL", "CALL", "EMAIL", "SMS"]),
            "last_response": _pick(["NO_ANSWER", "DISPUTE", "BROKEN_PTP", "NO_ANSWER"]),
            "last_contact_date": _date_ago(_ri(7, 21)),
            "open_epix_tickets": _rng.random() < 0.3,
            "bureau_listed": _rng.random() < 0.5 if days > 75 else False,
            "dca_placement": None,
        }

    if days <= 218:
        return {
            "account_type": _pick(["HIGH_RISK", "FPD", "NVP", "FPD"]),
            "service_status": _pick(["SUSPENDED", "DELETED"]),
            "last_contact_method": _pick(["CALL", "EMAIL", "SMS"]),
            "last_response": _pick(["NO_ANSWER", "NO_ANSWER", "DISPUTE", "BROKEN_PTP"]),
            "last_contact_date": _date_ago(_ri(14, 45)),
            "open_epix_tickets": False,
            "bureau_listed": True,
            "dca_placement": 1 if days > 180 else None,
        }

    # Legal / DCA (219+ days)
    return {
        "account_type": _pick(["FPD", "NVP", "HIGH_RISK"]),
        "service_status": "DELETED",
        "last_contact_method": _pick(["CALL", "EMAIL"]),
        "last_response": _pick(["NO_ANSWER", "DISPUTE"]),
        "last_contact_date": _date_ago(_ri(30, 90)),
        "open_epix_tickets": False,
        "bureau_listed": True,
        "dca_placement": _pick([1, 2, 3]),
    }


# ── Build 50 subscribers ──────────────────────────────────────────────────────

def _build() -> list:
    bucket_days = (
        [_ri(1, 30)    for _ in range(15)]
        + [_ri(31, 60)  for _ in range(10)]
        + [_ri(61, 90)  for _ in range(10)]
        + [_ri(91, 218) for _ in range(10)]
        + [_ri(219, 365) for _ in range(5)]
    )

    result = []
    for i, (first, last) in enumerate(zip(FIRST_NAMES, LAST_NAMES)):
        days = bucket_days[i]
        balance = round(_ri(500, 15000) + _ri(0, 99) / 100, 2)
        result.append({
            "id": f"SUB-{str(i + 1).zfill(3)}",
            "name": f"{first} {last}",
            "msisdn": _make_msisdn(),
            "account_number": f"VDC-{_ri(100_000_000, 999_999_999)}",
            "days_overdue": days,
            "balance_owed": balance,
            **_profile_for(days),
        })
    return result


SUBSCRIBERS: list[dict] = _build()


# ── Public helpers ────────────────────────────────────────────────────────────

def get_subscriber_by_id(id: str) -> dict | None:
    return next((s for s in SUBSCRIBERS if s["id"] == id), None)


def get_subscriber_by_account(account_number: str) -> dict | None:
    return next((s for s in SUBSCRIBERS if s["account_number"] == account_number), None)


def update_subscriber(id: str, updates: dict) -> dict | None:
    """Mutates the subscriber dict in-place (mirrors mockDb.updateSubscriber)."""
    sub = get_subscriber_by_id(id)
    if sub is None:
        return None
    sub.update(updates)
    return sub


def get_all_subscribers() -> list:
    return SUBSCRIBERS
