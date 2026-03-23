"""Print all 50 mock subscribers as a formatted cheat-sheet table."""

import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from data.subscribers import SUBSCRIBERS

# Column widths
W_ID      = 7
W_NAME    = 26
W_MSISDN  = 15
W_ACCT    = 15
W_DAYS    = 12
W_BAL     = 12

BUCKET_LABEL = {
    (1,  30):  "  1-30d ",
    (31, 60):  " 31-60d ",
    (61, 90):  " 61-90d ",
    (91, 218): "91-218d ",
    (219,999): "  219d+ ",
}

def bucket(days):
    for (lo, hi), label in BUCKET_LABEL.items():
        if lo <= days <= hi:
            return label
    return "       "

header = (
    f"{'ID':<{W_ID}} "
    f"{'Name':<{W_NAME}} "
    f"{'MSISDN':<{W_MSISDN}} "
    f"{'Account':<{W_ACCT}} "
    f"{'Days OD':>{W_DAYS}} "
    f"{'Balance ZAR':>{W_BAL}} "
    f"Bucket"
)
sep = "-" * len(header)

print()
print("  VODACOM MOCK SUBSCRIBER CHEAT SHEET")
print(sep)
print(header)
print(sep)

for s in SUBSCRIBERS:
    msisdn = s["msisdn"].replace("+", "")   # strip leading + → 27XXXXXXXXX
    line = (
        f"{s['id']:<{W_ID}} "
        f"{s['name']:<{W_NAME}} "
        f"{msisdn:<{W_MSISDN}} "
        f"{s['account_number']:<{W_ACCT}} "
        f"{s['days_overdue']:>{W_DAYS}} "
        f"{'R {:,.2f}'.format(s['balance_owed']):>{W_BAL}} "
        f"{bucket(s['days_overdue'])}"
    )
    print(line)

print(sep)
print(f"  {len(SUBSCRIBERS)} subscribers total")
print()
