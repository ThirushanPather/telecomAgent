// Generates 50 mock Vodacom subscribers and seeds mockDb on module load.
// Collections lifecycle stages:
//   1-30 days    (~15) — Fresh arrears
//   31-60 days   (~10) — Early collections
//   61-90 days   (~10) — Soft collections
//   91-218 days  (~10) — Hard collections
//   219+ days    (~5)  — Legal / DCA

import mockDb from "./mockDb.js";

// ─── Name pools ───────────────────────────────────────────────────────────────

const firstNames = [
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
];

const lastNames = [
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
];

// SA Vodacom mobile prefixes (after country code drop: 0XX -> XX)
const networkPrefixes = [
  "60", "61", "62", "63", "64",
  "71", "72", "73", "74", "76",
  "78", "79", "82", "83", "84",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ri(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Returns an ISO date string N days before today.
function dateAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

// Generates a valid SA MSISDN: +27 followed by 9 digits.
function makeMsisdn() {
  const prefix = pick(networkPrefixes);
  const suffix = String(ri(1000000, 9999999));
  return `+27${prefix}${suffix}`;
}

// ─── Lifecycle profile per bucket ─────────────────────────────────────────────
// Returns the fields that correlate with how overdue the account is.

function profileFor(days) {
  if (days <= 30) {
    return {
      account_type: pick(["STANDARD", "STANDARD", "STANDARD", "TUC", "NVP"]),
      service_status: days <= 20 ? "ACTIVE" : pick(["ACTIVE", "SOFT_LOCKED"]),
      last_contact_method: pick(["SMS", "SMS", "NONE", "CALL"]),
      last_response: pick(["NO_ANSWER", "PTP", "NONE", "NO_ANSWER"]),
      last_contact_date: days <= 3 ? null : dateAgo(ri(1, Math.min(days - 1, 7))),
      open_epix_tickets: Math.random() < 0.15,
      bureau_listed: false,
      dca_placement: null,
    };
  }

  if (days <= 60) {
    return {
      account_type: pick(["STANDARD", "NVP", "TUC", "HIGH_RISK"]),
      service_status: pick(["SOFT_LOCKED", "SOFT_LOCKED", "SUSPENDED"]),
      last_contact_method: pick(["CALL", "SMS", "EMAIL"]),
      last_response: pick(["NO_ANSWER", "NO_ANSWER", "BROKEN_PTP", "DISPUTE"]),
      last_contact_date: dateAgo(ri(3, 14)),
      open_epix_tickets: Math.random() < 0.25,
      bureau_listed: false,
      dca_placement: null,
    };
  }

  if (days <= 90) {
    return {
      account_type: pick(["NVP", "HIGH_RISK", "STANDARD", "FPD"]),
      service_status: pick(["SUSPENDED", "SUSPENDED", "SOFT_LOCKED"]),
      last_contact_method: pick(["CALL", "CALL", "EMAIL", "SMS"]),
      last_response: pick(["NO_ANSWER", "DISPUTE", "BROKEN_PTP", "NO_ANSWER"]),
      last_contact_date: dateAgo(ri(7, 21)),
      open_epix_tickets: Math.random() < 0.3,
      bureau_listed: days > 75 ? Math.random() < 0.5 : false,
      dca_placement: null,
    };
  }

  if (days <= 218) {
    return {
      account_type: pick(["HIGH_RISK", "FPD", "NVP", "FPD"]),
      service_status: pick(["SUSPENDED", "DELETED"]),
      last_contact_method: pick(["CALL", "EMAIL", "SMS"]),
      last_response: pick(["NO_ANSWER", "NO_ANSWER", "DISPUTE", "BROKEN_PTP"]),
      last_contact_date: dateAgo(ri(14, 45)),
      open_epix_tickets: false,
      bureau_listed: true,
      dca_placement: days > 180 ? 1 : null,
    };
  }

  // Legal / DCA stage (219+ days)
  return {
    account_type: pick(["FPD", "NVP", "HIGH_RISK"]),
    service_status: "DELETED",
    last_contact_method: pick(["CALL", "EMAIL"]),
    last_response: pick(["NO_ANSWER", "DISPUTE"]),
    last_contact_date: dateAgo(ri(30, 90)),
    open_epix_tickets: false,
    bureau_listed: true,
    dca_placement: pick([1, 2, 3]),
  };
}

// ─── Build 50 subscribers ─────────────────────────────────────────────────────

const bucketDays = [
  ...Array.from({ length: 15 }, () => ri(1, 30)),
  ...Array.from({ length: 10 }, () => ri(31, 60)),
  ...Array.from({ length: 10 }, () => ri(61, 90)),
  ...Array.from({ length: 10 }, () => ri(91, 218)),
  ...Array.from({ length: 5 },  () => ri(219, 365)),
];

const subscribers = firstNames.map((firstName, i) => {
  const days = bucketDays[i];
  const profile = profileFor(days);

  return {
    id: `SUB-${String(i + 1).padStart(3, "0")}`,
    name: `${firstName} ${lastNames[i]}`,
    msisdn: makeMsisdn(),
    account_number: `VDC-${String(ri(100000000, 999999999))}`,
    days_overdue: days,
    balance_owed: parseFloat((ri(500, 15000) + ri(0, 99) / 100).toFixed(2)),
    ...profile,
  };
});

// ─── Seed ─────────────────────────────────────────────────────────────────────

mockDb.setSubscribers(subscribers);
console.log(`[DB] Seeded ${subscribers.length} subscribers.`);
