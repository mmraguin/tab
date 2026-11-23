/* tab — read-only budget dashboard.
   Same Apps Script GET endpoint and column mapping as before.
   Code style: var, function declarations, string concatenation. */

var WEBHOOK = 'https://script.google.com/macros/s/AKfycbxpw8-x47yAOgE8pez3NU3hPddIXJH4cM3a6Hq9G7vx9Es8CnHDHQOuH4aAyzpxdbWQfw/exec';
// Same key and shape as the previous tab: the logger reads this cache on the same origin
var CACHE_KEY = 'tab_v1';
var STALE_MS = 5 * 60 * 1000;

var ACCOUNTS = ['BDO', 'BPI', 'Cash', 'GCash', 'Grab Wallet', 'Maribank', 'Maya', 'Shopee Pay', 'UnionBank', 'UnionBank Credit'];
var ACCOUNT_GROUPS = [
  { key: 'banks', label: 'Banks', kind: 'Bank', items: ['BDO', 'BPI', 'UnionBank', 'Maribank'] },
  { key: 'wallets', label: 'Cash & wallets', kind: 'Wallet', items: ['Cash', 'GCash', 'Maya', 'Grab Wallet', 'Shopee Pay'] }
];
var CREDIT_ACCOUNTS = ['UnionBank Credit'];

var raw = null;          // { b, a, s, as }
var lastUp = null;       // Date of last successful fetch (or cache timestamp)
var fromCache = false;
var fetchState = 'idle'; // idle | loading | error
var fetchError = '';
var viewMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
var tab = 'home';
var P = null;            // parsed month
var actFilter = 'all';
var actQuery = '';
var accFilter = 'all';
var accIdx = 0;
var hideNums = false;
var insSel = null;
var goalFilter = 'all';
var goalIdx = 0;
var insPeriod = 'month';

/* ── Utilities ─────────────────────────────────────────── */

function parseDate(v) {
  if (v == null) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  var s = String(v).trim();
  if (!s || s === '-' || s === '--') return null;
  if (/^[A-Za-z]/.test(s)) return null;
  if (s.indexOf('T') > -1) {
    var ts = new Date(s);
    if (!isNaN(ts.getTime())) return new Date(ts.getFullYear(), ts.getMonth(), ts.getDate());
    return null;
  }
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(+m[3], +m[1] - 1, +m[2]);
  var m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m2) return new Date(+m2[1], +m2[2] - 1, +m2[3]);
  if (/^\d+$/.test(s)) {
    var n = parseInt(s, 10);
    if (n > 40000 && n < 60000) {
      var e = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
      return new Date(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate());
    }
  }
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function pn(v) {
  if (typeof v === 'number') return v;
  return parseFloat(String(v || '0').replace(/[^0-9.\-]/g, '')) || 0;
}

function peso(n) {
  return mask('₱' + Math.abs(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
}

function signed(n) {
  return (n < 0 ? '−' : '') + peso(n);
}

function short(n) {
  var a = Math.abs(n);
  if (a >= 1e6) return mask('₱' + (a / 1e6).toFixed(2) + 'M');
  if (a >= 1e3) return mask('₱' + (a / 1e3).toFixed(0) + 'k');
  return mask('₱' + a.toFixed(0));
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function monthLabel(d) {
  return d.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
}

function dayLabel(d) {
  if (!d) return 'No date';
  var t = new Date();
  var today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  var diff = Math.round((today - d) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' });
}

function ago(date) {
  var m = Math.round((Date.now() - date.getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  var h = Math.round(m / 60);
  if (h < 24) return h + ' h ago';
  return Math.round(h / 24) + ' d ago';
}

/* ── Parse (mirrors tab's parseAll; same column indices) ── */

function parseMonth(r, vm, vy) {
  var bRows = r.b.filter(function(row) {
    var d = parseDate(row[5]);
    return d && d.getMonth() === vm && d.getFullYear() === vy;
  });

  var categories = [];
  bRows.forEach(function(row) {
    var cat = String(row[7] || '').trim();
    var grp = String(row[6] || '').trim();
    var catId = String(row[3] || '').trim();
    if (!cat || !grp || !catId) return;
    var ta = pn(row[12]);
    var act = pn(row[13]);
    categories.push({
      catId: catId, cat: cat, group: grp, grpSort: pn(row[4]),
      totalAssigned: ta, activity: act, actAmt: Math.abs(act),
      available: pn(row[15]), yearlyGoal: pn(row[8]), goal: pn(row[9])
    });
  });

  var rta = 0, prevNW = null;
  var sRows = r.s.map(function(sr) { return { d: parseDate(sr[0]), row: sr }; })
    .filter(function(x) { return x.d; });
  sRows.forEach(function(x) {
    if (x.d.getMonth() === vm && x.d.getFullYear() === vy) rta = pn(x.row[9]);
  });

  var monthAct = r.a.filter(function(row) {
    var d = parseDate(row[7]);
    return d && d.getMonth() === vm && d.getFullYear() === vy;
  });

  function type(row) { return String(row[8]).trim(); }
  var totalInc = 0, totalExp = 0, totalReimb = 0;
  monthAct.forEach(function(row) {
    var t = type(row);
    if (t === 'Income') totalInc += Math.abs(pn(row[9]));
    else if (t === 'Expense') totalExp += Math.abs(pn(row[9]));
    else if (t === 'Reimbursement') totalReimb += Math.abs(pn(row[9]));
  });
  var netExp = Math.max(totalExp - totalReimb, 0);

  var txns = monthAct.filter(function(row) { return type(row) !== 'Balance'; }).map(function(row) {
    var t = type(row).toLowerCase();
    var amt = pn(row[9]);
    if (t === 'reimbursement') amt = Math.abs(amt);
    return {
      date: parseDate(row[6]), type: t, amount: amt,
      merchant: String(row[10] || '').trim(), payment: String(row[11] || '').trim(),
      cat: String(row[12] || '').trim(), group: String(row[13] || '').trim(), memo: String(row[14] || '').trim()
    };
  }).sort(function(a, b) { return (b.date || 0) - (a.date || 0); });
  txns.forEach(function(t, i) { t._i = i; });

  // AccountSnapshot: per-account rows (cols A–E) and monthly net-worth total (cols I–J)
  var accountSnap = {};
  var nwSeries = [];
  r.as.forEach(function(row) {
    var d = parseDate(row[0]);
    if (d && d.getMonth() === vm && d.getFullYear() === vy) {
      var acc = String(row[1] || '').trim();
      if (acc) accountSnap[acc] = { cashStart: pn(row[2]), activity: pn(row[3]), cashEnd: pn(row[4]) };
    }
    var dt = parseDate(row[8]);
    if (dt && String(row[9]).trim() !== '') nwSeries.push({ d: dt, v: pn(row[9]) });
  });
  nwSeries.sort(function(a, b) { return a.d - b.d; });
  var viewKey = vy * 12 + vm;
  var byKey = {};
  nwSeries.forEach(function(x) { byKey[x.d.getFullYear() * 12 + x.d.getMonth()] = x.v; });
  nwSeries = [];
  for (var k = viewKey - 5; k <= viewKey; k++) {
    nwSeries.push({ d: new Date(Math.floor(k / 12), k % 12, 1), v: byKey[k] === undefined ? null : byKey[k] });
  }

  var netWorth = null;
  if (byKey[viewKey] !== undefined) netWorth = byKey[viewKey];
  if (byKey[viewKey - 1] !== undefined) prevNW = byKey[viewKey - 1];

  // Per-account balance: AccountSnapshot preferred, latest Balance row as fallback
  var accBals = {}, accSource = {};
  ACCOUNTS.forEach(function(acc) {
    if (accountSnap[acc]) { accBals[acc] = accountSnap[acc].cashEnd; accSource[acc] = 'snapshot'; return; }
    var rows = r.a.filter(function(row) {
      return String(row[8]).trim() === 'Balance' && String(row[11] || '').trim() === acc;
    }).sort(function(a, b) { return (parseDate(b[6]) || 0) - (parseDate(a[6]) || 0); });
    accBals[acc] = rows.length ? pn(rows[0][9]) : 0;
    accSource[acc] = rows.length ? 'balance-row' : 'none';
  });

  var txnsByAcc = {};
  ACCOUNTS.forEach(function(acc) {
    txnsByAcc[acc] = txns.filter(function(t) { return t.payment === acc; });
  });

  var assignedAll = 0;
  bRows.forEach(function(row) { assignedAll += pn(row[12]); });

  return {
    categories: categories, overspent: categories.filter(function(c) { return c.available < 0; }),
    rta: rta, totalInc: totalInc, totalExp: totalExp, netExp: netExp, assignedAll: assignedAll,
    txns: txns, accountSnap: accountSnap, accBals: accBals, accSource: accSource, txnsByAcc: txnsByAcc,
    netWorth: netWorth, prevNW: prevNW, nwSeries: nwSeries
  };
}

function normalize(j) {
  function rows(a, test) { return (a || []).filter(function(row) { return test(row); }); }
  return {
    b: rows(j.budget, function(r) { return parseDate(r[5]); }),
    a: rows(j.activity, function(r) { return parseDate(r[7]) || String(r[8]).trim() === 'Balance'; }),
    s: rows(j.snapshot, function(r) { return parseDate(r[0]); }),
    as: j.accountSnapshot || []
  };
}

/* ── Fetch & cache ─────────────────────────────────────── */

function saveCache(j) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      b: j.budget, a: j.activity, s: j.snapshot, as: j.accountSnapshot || null, ts: lastUp.toISOString()
    }));
  } catch (e) {}
}

function loadCache() {
  try {
    var c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (!c || !c.b || !c.a || !c.s) return false;
    raw = normalize({ budget: c.b, activity: c.a, snapshot: c.s, accountSnapshot: c.as });
    lastUp = new Date(c.ts);
    fromCache = true;
    return true;
  } catch (e) { return false; }
}

function loadData() {
  fetchState = 'loading';
  fetchError = '';
  paint();
  fetch(WEBHOOK + '?_=' + Date.now(), { cache: 'no-store' })
    .then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function(j) {
      if (j.status === 'error') throw new Error(j.message);
      if (!j.budget || !j.activity || !j.snapshot) throw new Error('Missing tabs in response');
      raw = normalize(j);
      lastUp = new Date();
      fromCache = false;
      fetchState = 'idle';
      saveCache(j);
    })
    .catch(function(e) {
      fetchState = 'error';
      fetchError = e.message || 'Network error';
    })
    .then(function() { paint(); });
}

/* ── View helpers ──────────────────────────────────────── */

var ICON = {
  ok: '<svg class="state-ico state-ok" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/></svg>',
  warn: '<svg class="state-ico state-warn" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.01"/></svg>',
  err: '<svg class="state-ico state-err" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16v.01"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>'
};

function bar(pct, cls, mark) {
  var w = Math.max(0, Math.min(100, pct));
  return '<div class="bar ' + (cls || '') + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(w) + '">' +
    '<i style="width:' + w + '%"></i>' +
    (mark != null ? '<span class="bar-mark" style="left:' + Math.min(99, mark) + '%"></span>' : '') + '</div>';
}

function txnRow(t, showAcct) {
  // Memo leads; category, merchant and account support it
  var title = t.memo || t.merchant || t.cat || (t.type.charAt(0).toUpperCase() + t.type.slice(1));
  var typeLabel = t.type.charAt(0).toUpperCase() + t.type.slice(1);
  var meta = [typeLabel];
  if (t.cat && t.cat !== title) meta.push(t.cat);
  if (t.merchant && t.merchant !== title && t.merchant !== t.cat) meta.push(t.merchant);
  if (showAcct && t.payment) meta.push(t.payment);
  var amtCls = t.type === 'income' || t.type === 'reimbursement' ? 'amt-in' : (t.type === 'expense' ? '' : 'amt-xfer');
  var sign = t.type === 'income' || t.type === 'reimbursement' ? '+' : (t.amount < 0 ? '−' : '');
  return '<button class="row" role="listitem" data-txn="' + t._i + '">' +
    txnTile(t) +
    '<div class="row-main"><div class="t-card">' + esc(title) + '</div>' +
    '<div class="t-caption">' + esc(meta.join(' · ')) + '</div></div>' +
    '<div class="row-end"><div class="t-amount num ' + amtCls + '">' + sign + peso(t.amount) + '</div></div></button>';
}

function emptyState(msg) { return '<div class="empty">' + esc(msg) + '</div>'; }


ICON.bell = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15zM10 21h4"/></svg>';
ICON.alert = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.01"/></svg>';
ICON.assign = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/></svg>';
ICON.bank = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10l9-6 9 6M5 10v8M10 10v8M14 10v8M19 10v8M3 20h18"/></svg>';
ICON.wallet = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a1 1 0 0 1-1-1zM4 7l11-3v3M16 14h2"/></svg>';
ICON.credit = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/></svg>';
ICON.spark = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/></svg>';
ICON.up = '<svg class="tri" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6l7 12H5z" fill="currentColor"/></svg>';
ICON.down = '<svg class="tri" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 18L5 6h14z" fill="currentColor"/></svg>';


/* ── Category identity: one colour per group, one icon per category ── */

var G = {
  bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
  home: '<path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
  building: '<path d="M5 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M15 10h4a1 1 0 0 1 1 1v10M3 21h18M9 8h2M9 12h2M9 16h2"/>',
  cart: '<path d="M3 4h2l2.5 11h10l2-8H6.5"/><circle cx="9" cy="20" r="1"/><circle cx="17" cy="20" r="1"/>',
  basket: '<path d="M4 9h16l-1.5 10h-13zM8 9l3-5M16 9l-3-5"/>',
  cross: '<path d="M9 4h6v5h5v6h-5v5H9v-5H4V9h5z"/>',
  pill: '<path d="M10.5 20.5a4.95 4.95 0 0 1-7-7l10-10a4.95 4.95 0 0 1 7 7zM8.5 8.5l7 7"/>',
  leaf: '<path d="M5 19c0-9 5-14 15-14 0 10-5 15-14 15zM5 19l8-8"/>',
  car: '<path d="M4 16v-4l2-5h12l2 5v4M4 16h16M4 16v2M20 16v2"/><circle cx="7.5" cy="13" r=".6"/><circle cx="16.5" cy="13" r=".6"/>',
  paw: '<circle cx="6.5" cy="10" r="1.6"/><circle cx="10" cy="6.5" r="1.6"/><circle cx="14" cy="6.5" r="1.6"/><circle cx="17.5" cy="10" r="1.6"/><path d="M8 17c0-3 2-5 4-5s4 2 4 5c0 2-2 2.5-4 2.5S8 19 8 17z"/>',
  scissors: '<circle cx="6" cy="7" r="2.5"/><circle cx="6" cy="17" r="2.5"/><path d="M8 8.5L20 18M8 15.5L20 6"/>',
  box: '<path d="M3 8l9-4 9 4v8l-9 4-9-4zM3 8l9 4 9-4M12 12v8"/>',
  utensils: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 2-3 5-3 8h3v10"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5a3 3 0 0 1 0 6M18 14c2 .7 3 3 3 6"/>',
  bag: '<path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/>',
  dots: '<circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/>',
  flask: '<path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3M7.5 15h9"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  gift: '<path d="M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7C10 7 8 6 8 4s3-2 4 3c1-5 4-5 4-3s-2 3-4 3"/>',
  wrench: '<path d="M14.5 6.5a4 4 0 0 0-5 5L3 18l3 3 6.5-6.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5z"/>',
  repeat: '<path d="M17 3l3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 0 1-3 3H4"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18"/>',
  laptop: '<rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M2 19h20"/>',
  plane: '<path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  layers: '<path d="M12 4l9 5-9 5-9-5zM3 14l9 5 9-5"/>',
  arrowIn: '<path d="M7 7l10 10M17 9v8H9"/>',
  swap: '<path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>'
};

var GROUP_ICON = { fixed: 'home', essentials: 'basket', pets: 'paw', lifestyle: 'sparkle', sinking: 'layers', emergency: 'shield', goals: 'target', unused: 'dots' };
var CAT_ICON = [
  [/electric/i, 'bolt'], [/cellphone|phone/i, 'phone'], [/association|dues/i, 'building'], [/grocer/i, 'cart'],
  [/doctor|medical/i, 'cross'], [/medicine/i, 'pill'], [/supplement/i, 'leaf'], [/transpo|car maint|^car$/i, 'car'],
  [/pet food|litter/i, 'box'], [/groom/i, 'scissors'], [/vet|pet/i, 'paw'], [/eating|dining|food/i, 'utensils'],
  [/self care|beauty/i, 'sparkle'], [/social|family/i, 'users'], [/shopping/i, 'bag'], [/^others?$|misc/i, 'dots'],
  [/lab/i, 'flask'], [/eyes?$/i, 'eye'], [/gift/i, 'gift'], [/home maint/i, 'wrench'], [/subscription/i, 'repeat'],
  [/job/i, 'briefcase'], [/tech/i, 'laptop'], [/vacation|travel/i, 'plane'], [/therapy/i, 'heart'], [/stellar/i, 'star']
];

function slug(g) { return String(g || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function kslug(g) { return GROUP_ICON[slug(g)] ? slug(g) : 'other'; }
function kclass(g) { return 'k-' + kslug(g); }
function kvar(g) { return 'var(--c-' + kslug(g) + ')'; }

function glyph(name) {
  return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (G[name] || G.dots) + '</svg>';
}

function iconName(cat, group) {
  for (var i = 0; i < CAT_ICON.length; i++) if (CAT_ICON[i][0].test(cat || '')) return CAT_ICON[i][1];
  return GROUP_ICON[slug(group)] || 'dots';
}

function ktile(name, group, size) {
  return '<span class="kt ' + kclass(group) + (size ? ' ' + size : '') + '">' + glyph(name) + '</span>';
}

function txnTile(t) {
  if (t.type === 'income' || t.type === 'reimbursement') return '<span class="kt k-income">' + glyph('arrowIn') + '</span>';
  if (t.type === 'transfer' || !t.cat) return '<span class="kt k-other">' + glyph(t.type === 'transfer' ? 'swap' : 'dots') + '</span>';
  return ktile(iconName(t.cat, t.group), t.group);
}



/* ── Hide numbers ──────────────────────────────────────── */

function mask(s) { return s; }
// Only each tab's big headline number is hidden by the eye
function hmask(s) { return hideNums ? String(s).replace(/[0-9]/g, '\u2022') : s; }
function hshort(n) { return hmask(short(n)); }

// Hero money: small peso sign, whole pesos large, decimals small
function money(n, hero) {
  var s = hero ? hmask(peso(n)) : peso(n);
  var i = s.indexOf('.');
  var whole = s.slice(1, i), dec = s.slice(i);
  return (n < 0 ? '−' : '') + '<span class="cur">₱</span>' + whole + '<span class="dec">' + dec + '</span>';
}

/* ── History helpers (Budget sheet holds every month) ───── */

function catHistory(catId, col, n) {
  if (!raw._bi) {
    raw._bi = {};
    raw.b.forEach(function(row) {
      var d = parseDate(row[5]);
      if (d) raw._bi[String(row[3]).trim() + '|' + monthKey(d)] = row;
    });
  }
  var k = monthKey(viewMonth), out = [];
  for (var i = k - n + 1; i <= k; i++) {
    var row = raw._bi[catId + '|' + i];
    out.push({ d: new Date(Math.floor(i / 12), i % 12, 1), v: row ? pn(row[col]) : null });
  }
  return out;
}

/* ── Line chart (history solid, projection dashed, tap a point to read it) ── */

function chartW(sheet) {
  var w = (typeof window !== 'undefined' && window.innerWidth) || 390;
  var inner = sheet ? (w >= 900 ? 480 : w) - 64 : (w >= 900 ? Math.min(w - 200, 760) - 96 : w - 64);
  return Math.max(240, Math.min(inner, 700));
}

function lineChart(o) {
  var s = o.series, W = chartW(o.sheet), H = 150, iL = 28, iR = 28, pT = 28, pB = 28;
  var vals = [];
  s.forEach(function(x) { if (x.v !== null) vals.push(x.v); });
  if (!vals.length) return '';
  var mx = Math.max.apply(null, vals.concat(o.target || [])), mn = Math.min.apply(null, vals);
  if (o.zero) mn = Math.min(0, mn);
  if (mx === mn) mx = mn + 1;
  var span = mx - mn; mx += span * 0.06; if (!o.zero) mn -= span * 0.06;
  var step = (W - iL - iR) / (s.length - 1 || 1);
  function X(i) { return iL + i * step; }
  function Y(v) { return pT + (1 - (v - mn) / (mx - mn)) * (H - pT - pB); }
  var every = s.length > 7 ? 2 : 1;
  var firstProj = -1;
  s.forEach(function(x, i) { if (x.proj && firstProj < 0) firstProj = i; });

  var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.label || 'Chart') + '">';
  if (firstProj > 0) {
    svg += '<rect x="' + X(firstProj - 1).toFixed(1) + '" y="' + (pT - 8) + '" width="' + (W - iR + 8 - X(firstProj - 1)).toFixed(1) + '" height="' + (H - pT - pB + 8) + '" rx="8" class="chart-proj"/>';
  }
  if (o.target) {
    var ty = Y(o.target);
    svg += '<line x1="' + iL + '" x2="' + (W - iR) + '" y1="' + ty.toFixed(1) + '" y2="' + ty.toFixed(1) + '" class="chart-target"/>' +
      '<text class="chart-axis" x="' + iL + '" y="' + (ty - 6).toFixed(1) + '">Target ' + mask(short(o.target)) + '</text>';
  }
  svg += '<line x1="' + iL + '" x2="' + (W - iR) + '" y1="' + Y(o.zero ? 0 : mn).toFixed(1) + '" y2="' + Y(o.zero ? 0 : mn).toFixed(1) + '" class="chart-grid"/>';
  s.forEach(function(x, i) {
    if (i % every === 0 || (every === 1 && i === s.length - 1)) {
      svg += '<text class="chart-axis' + (x.proj ? ' is-proj' : '') + '" x="' + X(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + x.d.toLocaleDateString('en-PH', { month: 'short' }) + '</text>';
    }
  });
  var path = '', pen = false, lastHist = -1;
  s.forEach(function(x, i) {
    if (x.proj) return;
    if (x.v === null) { pen = false; return; }
    path += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(x.v).toFixed(1) + ' ';
    pen = true; lastHist = i;
  });
  if (o.area) {
    var base = Y(o.zero ? 0 : mn).toFixed(1), run = [];
    function flush() {
      if (run.length > 1) {
        var d = 'M' + X(run[0]).toFixed(1) + ' ' + base;
        run.forEach(function(i) { d += ' L' + X(i).toFixed(1) + ' ' + Y(s[i].v).toFixed(1); });
        svg += '<path d="' + d + ' L' + X(run[run.length - 1]).toFixed(1) + ' ' + base + ' Z" class="chart-area"/>';
      }
      run = [];
    }
    s.forEach(function(x, i) { if (!x.proj && x.v !== null) run.push(i); else flush(); });
    flush();
  }
  svg += '<path d="' + path + '" class="chart-line"/>';
  if (firstProj > 0 && lastHist >= 0) {
    var pp = 'M' + X(lastHist).toFixed(1) + ' ' + Y(s[lastHist].v).toFixed(1) + ' ';
    s.forEach(function(x, i) { if (x.proj) pp += 'L' + X(i).toFixed(1) + ' ' + Y(x.v).toFixed(1) + ' '; });
    svg += '<path d="' + pp + '" class="chart-line is-proj"/>';
  }
  var maxV = Math.max.apply(null, vals), lastIdx = lastHist;
  var defRead = '';
  s.forEach(function(x, i) {
    if (x.v === null) return;
    var read = x.d.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }) + (x.proj ? ' (projected)' : '') + ' · ' + peso(x.v);
    if (i === lastIdx) defRead = read;
    var isLast = i === lastIdx;
    svg += '<g class="pt' + (x.proj ? ' is-proj' : '') + '" data-read="' + esc(read) + '" tabindex="0" role="button" aria-label="' + esc(read) + '">' +
      '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(x.v).toFixed(1) + '" r="16" class="hit"/>' +
      '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(x.v).toFixed(1) + '" r="' + (isLast ? 5 : 3.5) + '" class="dot' + (isLast ? ' is-now' : '') + '"/></g>';
    if (isLast || (!x.proj && x.v === maxV && !o.noMax)) {
      svg += '<text class="chart-val" x="' + X(i).toFixed(1) + '" y="' + (Y(x.v) - 11).toFixed(1) + '" text-anchor="middle">' + mask(short(x.v)) + '</text>';
    }
  });
  return '<div class="chart-box ' + (o.cls || '') + '"><div class="readout num" aria-live="polite">' + esc(mask(defRead)) + '</div>' + svg + '</svg></div>';
}

function goalChart(g) {
  var hist = catHistory(g.catId, 15, 6);
  var series = hist.map(function(x) { return { d: x.d, v: x.v === null ? null : Math.max(0, x.v), proj: false }; });
  var last = null;
  series.forEach(function(x) { if (x.v !== null) last = x; });
  var v0 = last ? last.v : null;
  if (v0 !== null && g.monthlyEff > 0 && v0 < g.target) {
    var k = Math.min(6, Math.ceil((g.target - v0) / g.monthlyEff));
    var base = monthKey(viewMonth);
    for (var i = 1; i <= k; i++) {
      series.push({ d: new Date(Math.floor((base + i) / 12), (base + i) % 12, 1), v: Math.min(g.target, v0 + g.monthlyEff * i), proj: true });
    }
  }
  return lineChart({ series: series, target: g.target, zero: true, area: true, cls: kclass(g.group), label: g.name + ' saved over time with projection', noMax: true });
}

/* ── Sheets ────────────────────────────────────────────── */

var sheetPrev = null;

function openSheet(title, html, keepPrev) {
  var sheet = document.getElementById('sheet'), scrim = document.getElementById('scrim');
  if (keepPrev && !sheet.hidden) sheetPrev = { title: document.getElementById('sheetTitle').textContent, html: document.getElementById('sheetBody').innerHTML };
  else sheetPrev = null;
  document.getElementById('sheetTitle').textContent = title;
  document.getElementById('sheetBody').innerHTML = html;
  document.getElementById('sheetBody').scrollTop = 0;
  if (!sheet.hidden) return;
  lastFocus = document.activeElement;
  sheet.hidden = false; scrim.hidden = false;
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(function() {
    sheet.classList.add('is-open'); scrim.classList.add('is-open');
    document.getElementById('sheetClose').focus();
  });
}

function txnSheetHtml(t) {
  var inflow = t.type === 'income' || t.type === 'reimbursement';
  var h = (sheetPrev ? '<button class="link-btn" data-back="1">‹ Back</button>' : '') +
    '<div class="txn-hero">' + txnTile(t) + '<div class="row-main"><span class="t-card">' + esc(t.memo || t.merchant || t.cat || t.type) + '</span>' +
    '<span class="t-caption">' + esc(t.date ? t.date.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '') + '</span></div></div>' +
    '<div class="t-display num txn-amt ' + (inflow ? 'amt-in' : '') + '">' + (inflow ? '+' : (t.amount < 0 ? '−' : '')) + money(Math.abs(t.amount)) + '</div>' +
    '<section class="panel rows">' + kv('Type', t.type.charAt(0).toUpperCase() + t.type.slice(1));
  if (t.cat) h += kv('Category', esc(t.cat));
  if (t.group) h += kv('Group', esc(t.group));
  if (t.payment) h += kv('Account', esc(t.payment));
  if (t.memo) h += kv('Memo', esc(t.memo));
  return h + '</section>';
}

function openTxn(i) {
  var t = P.txns[i];
  if (!t) return;
  openSheet('Transaction', '', true);
  document.getElementById('sheetBody').innerHTML = txnSheetHtml(t);
}

function catSheetHtml(catId) {
  var c = null;
  P.categories.forEach(function(x) { if (x.catId === catId) c = x; });
  if (!c) return '';
  var pct = c.totalAssigned > 0 ? c.actAmt / c.totalAssigned * 100 : 0;
  var spent = catHistory(catId, 13, 6).map(function(x) { return { d: x.d, v: x.v === null ? null : Math.abs(x.v), proj: false }; });
  var tx = P.txns.filter(function(t) { return t.cat === c.cat && t.group === c.group; });
  var h = (sheetPrev ? '<button class="link-btn" data-back="1">\u2039 Back</button>' : '') + '<div class="txn-hero">' + ktile(iconName(c.cat, c.group), c.group) + '<div class="row-main"><span class="t-card">' + esc(c.cat) + '</span><span class="t-caption">' + esc(c.group) + '</span></div></div>' +
    '<div class="t-display num">' + money(c.available) + '</div><span class="t-label" style="margin-top:-12px">left this month</span>' +
    bar(pct, c.available < 0 ? 'is-over' : (pct >= 80 ? 'is-warn' : '')) +
    '<section class="panel rows">' + kv('Monthly goal', c.goal > 0 ? peso(c.goal) : 'Not set', !(c.goal > 0)) + kv('Assigned', peso(c.totalAssigned)) + kv('Spent', peso(c.actAmt)) + kv('Left', signed(c.available)) + '</section>' +
    '<div class="section"><h3 class="t-card">Spent by month</h3><div class="panel pad">' +
    lineChart({ sheet: true, series: spent, zero: true, area: true, cls: kclass(c.group), label: c.cat + ' spending by month' }) + '</div></div>' +
    '<div class="section"><h3 class="t-card">Transactions</h3>';
  if (tx.length) { h += '<div class="panel rows" role="list">'; tx.forEach(function(t) { h += txnRow(t, true); }); h += '</div>'; }
  else h += '<div class="panel">' + emptyState('No transactions this month.') + '</div>';
  return h + '</div>';
}

function openCat(catId) {
  var wasOpen = !document.getElementById('sheet').hidden;
  openSheet('Category', '', wasOpen);
  document.getElementById('sheetBody').innerHTML = catSheetHtml(catId);
}


function accHistory(acc, n) {
  if (!raw._ai) {
    raw._ai = {};
    raw.as.forEach(function(row) {
      var d = parseDate(row[0]);
      if (d) raw._ai[String(row[1] || '').trim() + '|' + monthKey(d)] = row;
    });
  }
  var k = monthKey(viewMonth), out = [];
  for (var i = k - n + 1; i <= k; i++) {
    var row = raw._ai[acc + '|' + i];
    out.push({ d: new Date(Math.floor(i / 12), i % 12, 1), v: row ? pn(row[4]) : null, proj: false });
  }
  return out;
}

function miniDonut(segs, cv, cl) {
  var tot = 0;
  segs.forEach(function(x) { tot += x.v; });
  var c = 2 * Math.PI * 40, off = 0;
  var svg = '<svg class="donut" viewBox="0 0 100 100" role="img" aria-label="' + esc(cl) + '"><circle cx="50" cy="50" r="40" fill="none" stroke="var(--elevated)" stroke-width="12"/>';
  segs.forEach(function(x) {
    var len = tot > 0 ? x.v / tot * c : 0;
    svg += '<circle cx="50" cy="50" r="40" fill="none" stroke="' + x.color + '" stroke-width="12" stroke-dasharray="' + Math.max(len - (segs.length > 1 ? 2 : 0), 0.5).toFixed(2) + ' ' + c.toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 50 50)"/>';
    off += len;
  });
  return svg + '<text x="50" y="50" text-anchor="middle" class="donut-v">' + cv + '</text><text x="50" y="65" text-anchor="middle" class="donut-l">' + esc(cl) + '</text></svg>';
}

function miniLegend(items) {
  var h = '<div class="mini-legend">';
  items.forEach(function(x) { h += '<span><i style="background:' + x.color + '"></i>' + esc(x.name) + ' <b class="num">' + x.text + '</b></span>'; });
  return h + '</div>';
}

var PALETTE = ['var(--lilac)', 'var(--lime)', 'var(--coral)', 'var(--sunset)', 'var(--sage)', 'var(--peach)', 'var(--c-fixed)', 'var(--c-emergency)'];

function accountsTop(p) {
  var f = accFilter, list = accountList(), h = '', segs = [], cv, cl, title, caption, cells;
  if (f === 'all') {
    var nw = p.netWorth;
    if (nw == null) { nw = 0; ACCOUNTS.forEach(function(a) { nw += p.accBals[a] || 0; }); }
    var ref = nwRef(p), sub;
    if (ref && p.netWorth != null) {
      var d = p.netWorth - ref.v;
      sub = '<div class="delta ' + (d >= 0 ? 'up' : 'down') + ' num">' + (d >= 0 ? ICON.up : ICON.down) + '<b>' + Math.abs(d / Math.abs(ref.v) * 100).toFixed(1) + '%</b><span>since ' + ref.label + '</span></div>';
    } else sub = '<div class="hero-note"><span>Across all accounts</span></div>';
    h += heroCard('Net worth', money(nw, true), sub);
    var banks = groupSum(ACCOUNT_GROUPS[0].items), wal = groupSum(ACCOUNT_GROUPS[1].items), cr = groupSum(CREDIT_ACCOUNTS);
    h += strip([{ label: 'Banks', value: peso(banks) }, { label: 'Wallets', value: peso(wal) }, { label: 'Credit', value: peso(cr) }]);
    if (banks > 0) segs.push({ name: 'Banks', v: banks, color: 'var(--c-fixed)' });
    if (wal > 0) segs.push({ name: 'Wallets', v: wal, color: 'var(--c-essentials)' });
    cv = short(Math.max(banks, 0) + Math.max(wal, 0)); cl = 'in accounts'; title = 'By account type'; caption = '';
  } else {
    var total = 0, pos = 0, act = 0, n = 0;
    list.forEach(function(a, i) {
      var v = p.accBals[a.name] || 0, sn = p.accountSnap[a.name];
      total += v; if (sn) act += sn.activity; n += (p.txnsByAcc[a.name] || []).length;
      if (v > 0) { pos += v; segs.push({ name: a.name, v: v, color: PALETTE[i % PALETTE.length] }); }
    });
    var lbl = f === 'credit' ? 'Credit balance' : (f === 'banks' ? 'Banks' : 'Cash & wallets');
    h += heroCard(lbl, money(total, true), '<div class="hero-note"><span>' + list.length + ' account' + (list.length === 1 ? '' : 's') + '</span></div>');
    h += strip([{ label: 'Accounts', value: String(list.length) }, { label: 'Net activity', value: (act >= 0 ? '+' : '\u2212') + peso(act) }, { label: 'Transactions', value: String(n) }]);
    cv = short(pos); cl = 'in ' + (f === 'banks' ? 'banks' : (f === 'wallets' ? 'wallets' : 'credit')); title = 'By account'; caption = '';
  }
  h += breakdownCard(title, caption, segs, cv, cl, null);
  var pts = p.nwSeries.filter(function(x) { return x.v !== null; });
  if (f === 'all' && pts.length > 1) {
    h += '<section class="section"><div class="section-head"><h2 class="t-card">Net worth</h2><span class="t-caption">Last 6 months</span></div><div class="panel pad">' +
      lineChart({ series: p.nwSeries.map(function(x) { return { d: x.d, v: x.v, proj: false }; }), area: true, label: 'Net worth by month' }) + '</div></section>';
  }
  return h;
}

var CK = { lilac: 'ck-lilac', cobalt: 'ck-sunset', lime: 'ck-lime', coral: 'ck-coral', dark: 'ck-dark' };


/* ── Shared hero / strip / breakdown pattern ───────────── */

var EYE_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
var EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 6.2A9.8 9.8 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.2 3.7M6.5 7.6A17 17 0 0 0 2 12s4 6 10 6c1.4 0 2.7-.3 3.9-.8M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

function eyeBtn() {
  return '<button class="eye" data-eye="1" aria-pressed="' + hideNums + '" aria-label="' + (hideNums ? 'Show headline amounts' : 'Hide headline amounts') + '">' + (hideNums ? EYE_OFF : EYE_ON) + '</button>';
}

function heroCard(label, valueHtml, subHtml, linkHtml) {
  return '<section class="hero"><div class="hero-label"><span class="t-label">' + label + '</span>' + eyeBtn() + (linkHtml || '') + '</div>' +
    '<span class="t-display num hero-amount">' + valueHtml + '</span>' + (subHtml || '') + '</section>';
}

function strip(cells) {
  var h = '<section class="metrics3">';
  cells.forEach(function(c) {
    var inner = '<span class="t-label">' + esc(c.label) + '</span><span class="t-amount num">' + c.value + '</span>';
    h += c.go ? '<button class="metric" data-go="' + c.go + '">' + inner + '</button>' : '<div class="metric">' + inner + '</div>';
  });
  return h + '</section>';
}

function bigDonut(segs, cv, cl, attr) {
  var tot = 0;
  segs.forEach(function(x) { tot += x.v; });
  var c = 2 * Math.PI * 40, off = 0;
  var svg = '<svg class="donut" viewBox="0 0 100 100" role="img" aria-label="' + esc(cl) + '"><circle cx="50" cy="50" r="40" fill="none" stroke="var(--elevated)" stroke-width="12"/>';
  segs.forEach(function(x) {
    var len = tot > 0 ? x.v / tot * c : 0;
    svg += '<circle' + (attr ? ' class="seg" ' + attr + '="' + esc(x.name) + '"' : '') + ' cx="50" cy="50" r="40" fill="none" stroke="' + x.color + '" stroke-width="12" stroke-dasharray="' + Math.max(len - (segs.length > 1 ? 2 : 0), 0.5).toFixed(2) + ' ' + c.toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 50 50)"/>';
    off += len;
  });
  return svg + '<text x="50" y="48" text-anchor="middle" class="donut-v">' + cv + '</text><text x="50" y="62" text-anchor="middle" class="donut-l">' + esc(cl) + '</text></svg>';
}

function breakdownCard(title, caption, segs, cv, cl, attr) {
  var tot = 0;
  segs.forEach(function(x) { tot += x.v; });
  var h = '<section class="section"><div class="section-head"><h2 class="t-card">' + title + '</h2>' + (caption ? '<span class="t-caption">' + caption + '</span>' : '') + '</div><div class="panel pad">';
  if (tot <= 0) return h + emptyState('Nothing to show yet.') + '</div></section>';
  var lg = '<ul class="legend">';
  segs.forEach(function(x) {
    var tag = attr ? 'button' : 'div';
    lg += '<li><' + tag + ' class="leg"' + (attr ? ' ' + attr + '="' + esc(x.name) + '"' : '') + '><i style="background:' + x.color + '"></i><span>' + esc(x.name) + '</span><b class="num">' + Math.round(x.v / tot * 100) + '%</b></' + tag + '></li>';
  });
  var long = false;
  segs.forEach(function(x) { if (String(x.name).length > 13) long = true; });
  return h + '<div class="donut-wrap' + (long ? ' is-stack' : '') + '">' + bigDonut(segs, cv, cl, attr) + lg + '</ul></div></div></section>';
}

/* ── Dismissible alerts ────────────────────────────────── */

function dismissedMap() {
  try { return JSON.parse(localStorage.getItem('tab_dismissed') || '{}'); } catch (e) { return {}; }
}
function saveDismissed(m) {
  try { localStorage.setItem('tab_dismissed', JSON.stringify(m)); } catch (e) {}
}
function showToast(msg, key) {
  var t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status');
    document.body.appendChild(t);
  }
  t.innerHTML = '<span>' + esc(msg) + '</span><button data-undo="' + esc(key) + '">Undo</button>';
  t.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(function() { t.classList.remove('show'); }, 5000);
}
function alertRow(key, go, tileCls, icon, title, caption) {
  return '<div class="row has-x"><button class="row-link" data-go="' + go + '"><span class="ico-tile ' + tileCls + '">' + icon + '</span>' +
    '<span class="row-main"><span class="t-card">' + title + '</span><span class="t-caption">' + caption + '</span></span></button>' +
    '<button class="x" data-dismiss="' + esc(key) + '" aria-label="Dismiss alert"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>';
}

function goalsTop() {
  var list = goalList(), saved = 0, target = 0, funded = 0, segs = [];
  list.forEach(function(g) { saved += Math.max(0, g.available); target += g.target; if (g.pct >= 100) funded++; });
  if (goalFilter === 'all') {
    var by = {}, order = [];
    list.forEach(function(g) { if (by[g.group] === undefined) { by[g.group] = 0; order.push(g.group); } by[g.group] += Math.max(0, g.available); });
    order.forEach(function(k) { if (by[k] > 0) segs.push({ name: k, v: by[k], color: kvar(k) }); });
  } else {
    list.forEach(function(g, i) { if (g.available > 0) segs.push({ name: g.name, v: g.available, color: PALETTE[i % PALETTE.length] }); });
  }
  var pct = target > 0 ? Math.round(saved / target * 100) : 0;
  var label = goalFilter === 'all' ? 'Saved across ' + list.length + ' goals' : (list.length ? esc(list[0].group) : '') + ' saved';
  return heroCard(label, money(saved, true), '<div class="hero-note"><span class="num">of ' + peso(target) + ' yearly target \u00b7 ' + pct + '%</span></div>') +
    strip([{ label: 'Target', value: peso(target) }, { label: 'Still needed', value: peso(Math.max(0, target - saved)) }, { label: 'Funded', value: funded + ' of ' + list.length }]) +
    breakdownCard(goalFilter === 'all' ? 'Where it sits' : 'By goal', 'Tap to open', segs, short(saved), 'saved', 'data-gseg');
}


/* ── Global search (every month) ───────────────────────── */

function allTxnList() {
  if (raw._all) return raw._all;
  var out = [];
  raw.a.forEach(function(row) {
    var type = String(row[8]).trim();
    if (type === 'Balance') return;
    var t = type.toLowerCase(), amt = pn(row[9]);
    if (t === 'reimbursement') amt = Math.abs(amt);
    out.push({
      date: parseDate(row[6]) || parseDate(row[7]), type: t, amount: amt,
      merchant: String(row[10] || '').trim(), payment: String(row[11] || '').trim(),
      cat: String(row[12] || '').trim(), group: String(row[13] || '').trim(), memo: String(row[14] || '').trim()
    });
  });
  out.sort(function(a, b) { return (b.date || 0) - (a.date || 0); });
  out.forEach(function(t, i) { t._gi = i; });
  raw._all = out;
  return out;
}

function srRow(kind, idx, tile, title, caption, right) {
  return '<button class="row" role="listitem" data-sr="' + kind + ':' + idx + '">' + tile +
    '<div class="row-main"><div class="t-card">' + esc(title) + '</div><div class="t-caption">' + esc(caption) + '</div></div>' +
    (right ? '<div class="row-end"><div class="t-amount num">' + right + '</div></div>' : '') + '</button>';
}

function searchHtml(q) {
  q = String(q || '').trim().toLowerCase();
  if (!raw) return emptyState('Data is still loading.');
  if (q.length < 2) return emptyState('Search memos, merchants, categories, accounts or goals, across every month.');
  var num = q.replace(/[,₱\s]/g, '');
  var isNum = /^\d+(\.\d+)?$/.test(num);
  var tx = allTxnList().filter(function(t) {
    if ((t.memo + ' ' + t.merchant + ' ' + t.cat + ' ' + t.group + ' ' + t.payment + ' ' + t.type).toLowerCase().indexOf(q) > -1) return true;
    return isNum && Math.abs(t.amount).toFixed(2).indexOf(num) > -1;
  });
  var cats = P ? P.categories.filter(function(c) { return (c.cat + ' ' + c.group).toLowerCase().indexOf(q) > -1; }) : [];
  var accs = ACCOUNTS.filter(function(a) { return a.toLowerCase().indexOf(q) > -1; });
  var goals = P ? goalsOf(P).filter(function(g) { return (g.name + ' ' + g.group).toLowerCase().indexOf(q) > -1; }) : [];
  var h = '';
  if (tx.length) {
    h += '<h3 class="t-section">Transactions · ' + tx.length + '</h3><div class="panel rows" role="list">';
    tx.slice(0, 20).forEach(function(t) {
      var d = t.date ? t.date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
      var sign = t.type === 'income' || t.type === 'reimbursement' ? '+' : (t.amount < 0 ? '−' : '');
      h += srRow('txn', t._gi, txnTile(t), t.memo || t.merchant || t.cat || t.type, [d, t.cat, t.payment].filter(Boolean).join(' · '), sign + peso(t.amount));
    });
    h += '</div>' + (tx.length > 20 ? '<p class="t-caption">Showing the latest 20. Add more of the memo to narrow it down.</p>' : '');
  }
  if (cats.length) {
    h += '<h3 class="t-section">Categories</h3><div class="panel rows" role="list">';
    cats.slice(0, 6).forEach(function(c) { h += srRow('cat', c.catId, ktile(iconName(c.cat, c.group), c.group), c.cat, c.group + ' · this month', signed(c.available) + ' left'); });
    h += '</div>';
  }
  if (accs.length) {
    h += '<h3 class="t-section">Accounts</h3><div class="panel rows" role="list">';
    accs.forEach(function(a) { h += srRow('acc', a, '<span class="kt k-other">' + glyph('bank') + '</span>', a, 'Account', signed(P.accBals[a] || 0)); });
    h += '</div>';
  }
  if (goals.length) {
    h += '<h3 class="t-section">Goals</h3><div class="panel rows" role="list">';
    goals.slice(0, 6).forEach(function(g) { h += srRow('goal', g.catId, ktile(iconName(g.full, g.group), g.group), g.name, g.group + ' · ' + Math.round(g.pct) + '% saved', peso(g.available)); });
    h += '</div>';
  }
  return h || emptyState('Nothing matches “' + q + '”.');
}

function openSearch() {
  document.getElementById('top').classList.add('searching');
  document.getElementById('searchbar').hidden = false;
  document.getElementById('results').hidden = false;
  var gq = document.getElementById('gq');
  gq.value = '';
  renderResults();
  gq.focus();
}
function closeSearch() {
  document.getElementById('top').classList.remove('searching');
  document.getElementById('searchbar').hidden = true;
  document.getElementById('results').hidden = true;
}
function renderResults() {
  document.getElementById('results').innerHTML = searchHtml(document.getElementById('gq').value);
}
function searchGo(code) {
  var i = code.indexOf(':'), kind = code.slice(0, i), key = code.slice(i + 1);
  closeSearch();
  if (kind === 'txn') {
    var t = allTxnList()[+key];
    if (!t) return;
    openSheet('Transaction', '', false);
    document.getElementById('sheetBody').innerHTML = txnSheetHtml(t);
  } else if (kind === 'cat') openCat(key);
  else if (kind === 'acc') openAccount(key);
  else if (kind === 'goal') {
    goalFilter = 'all'; goalIdx = 0;
    goalList().forEach(function(g, n) { if (g.catId === key) goalIdx = n; });
    setTab('goals');
  }
}

/* ── Notifications (bell) ──────────────────────────────── */

var notifOpen = false;

function notifCandidates() {
  var p = P, dis = dismissedMap(), mk = monthKey(viewMonth), list = [];
  if (!p) return list;
  if (p.overspent.length) {
    var k1 = 'over:' + mk + ':' + p.overspent.map(function(c) { return c.catId; }).sort().join(',');
    list.push({ key: k1, go: 'budget', tone: 'warn', icon: ICON.alert, dismissed: !!dis[k1],
      title: p.overspent.length + (p.overspent.length === 1 ? ' category overspent' : ' categories overspent'),
      caption: p.overspent.slice(0, 3).map(function(c) { return c.cat; }).join(', ') });
  }
  if (p.rta < -1) {
    var k2 = 'oa:' + mk;
    list.push({ key: k2, go: 'budget', tone: 'err', icon: ICON.alert, dismissed: !!dis[k2], title: 'Over-assigned by ' + peso(p.rta), caption: 'Assigned more than you have' });
  }
  if (p.rta > 1) {
    var k3 = 'un:' + mk;
    list.push({ key: k3, go: 'budget', tone: '', icon: ICON.assign, dismissed: !!dis[k3], title: peso(p.rta) + ' left to assign', caption: 'Not yet given a job' });
  }
  return list;
}

function notifHtml() {
  var all = notifCandidates();
  var live = all.filter(function(n) { return !n.dismissed; });
  var gone = all.length - live.length;
  var h = '';
  if (live.length) {
    h += '<div class="panel rows" role="list">';
    live.forEach(function(n) { h += alertRow(n.key, n.go, n.tone, n.icon, esc(n.title), esc(n.caption)); });
    h += '</div>';
  } else h += '<div class="panel">' + emptyState('You’re all caught up.') + '</div>';
  if (gone > 0) h += '<button class="link-btn" data-restore="1" style="align-self:flex-start;padding-left:0">Restore ' + gone + ' dismissed</button>';
  return h;
}

function openNotifs() { notifOpen = true; openSheet('Notifications', notifHtml(), false); }
function renderNotifs() { document.getElementById('sheetBody').innerHTML = notifHtml(); }

function updateBell() {
  var b = document.getElementById('bellBadge'), btn = document.getElementById('bellBtn');
  var n = raw && P ? notifCandidates().filter(function(x) { return !x.dismissed; }).length : 0;
  b.hidden = n === 0;
  b.textContent = n;
  btn.setAttribute('aria-label', n ? 'Notifications, ' + n + ' new' : 'Notifications');
}

/* ── Shared pieces ─────────────────────────────────────── */

function ring(pct, tone) {
  var p = Math.max(0, Math.min(100, pct));
  var c = 2 * Math.PI * 15;
  return '<svg class="ring ' + (tone || '') + '" viewBox="0 0 36 36" role="img" aria-label="' + Math.round(p) + ' percent">' +
    '<circle cx="18" cy="18" r="15" class="ring-track"/>' +
    '<circle cx="18" cy="18" r="15" class="ring-arc" stroke-dasharray="' + (c * p / 100).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 18 18)"/></svg>';
}

function monthKey(d) { return d.getFullYear() * 12 + d.getMonth(); }

function groupSum(list) {
  var t = 0;
  list.forEach(function(a) { t += P.accBals[a] || 0; });
  return t;
}

function greeting() {
  var h = new Date().getHours();
  return h < 12 ? 'Good morning,' : (h < 18 ? 'Good afternoon,' : 'Good evening,');
}

function goalsOf(p) {
  var out = [];
  var order = ['sinking', 'emergency', 'goals'];
  p.categories.forEach(function(c) {
    var key = slug(c.group).replace(/^goal$/, 'goals');
    if (order.indexOf(key) < 0) return;
    var target = c.yearlyGoal > 0 ? c.yearlyGoal : c.goal * 12;
    if (target <= 0) return;
    out.push({
      catId: c.catId, key: key, name: c.cat.replace(/ Fund$/i, ''), full: c.cat, group: c.group, available: c.available, target: target,
      monthly: c.goal, monthlyEff: c.goal > 0 ? c.goal : target / 12, implied: !(c.goal > 0), assigned: c.totalAssigned, pct: Math.max(0, c.available) / target * 100, gsort: order.indexOf(key)
    });
  });
  out.sort(function(a, b) { return a.gsort - b.gsort; });
  return out;
}

function navLink(go, inner, cls) {
  return '<button class="' + cls + '" data-go="' + go + '">' + inner + '</button>';
}

/* ── Home ──────────────────────────────────────────────── */

function viewHome() {
  var p = P;
  var now = new Date();
  var dim = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
  var isCur = viewMonth.getMonth() === now.getMonth() && viewMonth.getFullYear() === now.getFullYear();
  var moPct = Math.round((isCur ? now.getDate() : dim) / dim * 100);
  var budPct = p.assignedAll > 0 ? Math.round(p.netExp / p.assignedAll * 100) : 0;
  var cls = budPct > moPct + 10 ? 'is-over' : (budPct > moPct - 5 ? 'is-warn' : '');
  var paceTxt = cls === 'is-over' ? 'Ahead of pace' : (cls === 'is-warn' ? 'Close to pace' : 'On track');

  var h = '<section class="greet"><div><p class="greet-a">' + greeting() + '</p><h2 class="greet-b">Miles.</h2></div><img class="greet-logo" src="Images/logo.png" alt="tab"></section>';

  // Net worth hero, with the headline strip (Left to assign leads)
  var nw = p.netWorth;
  var ref = nwRef(p), sub = '';
  if (ref) {
    var d = nw - ref.v;
    sub = '<div class="delta ' + (d >= 0 ? 'up' : 'down') + ' num">' + (d >= 0 ? ICON.up : ICON.down) + '<b>' + Math.abs(d / Math.abs(ref.v) * 100).toFixed(1) + '%</b>' +
      '<span>' + (d >= 0 ? '+' : '\u2212') + hmask(peso(d)) + ' since ' + ref.label + '</span></div>';
  }
  h += heroCard('Net worth', nw == null ? '\u2014' : money(nw, true), sub, '<button class="link-btn push" data-go="accounts">Accounts \u203a</button>');
  h += strip([
    { label: 'Left to assign', value: signed(p.rta), go: 'budget' },
    { label: 'Spent', value: peso(p.netExp), go: 'insights' },
    { label: 'Income', value: peso(p.totalInc), go: 'activity' }
  ]);

  // Account totals
  var banks = groupSum(ACCOUNT_GROUPS[0].items), wal = groupSum(ACCOUNT_GROUPS[1].items), cr = groupSum(CREDIT_ACCOUNTS);
  h += '<section class="tiles" aria-label="Account totals">' +
    tile('bank', 'Banks', (banks < 0 ? '\u2212' : '') + short(banks)) + tile('wallet', 'Wallets', (wal < 0 ? '\u2212' : '') + short(wal)) + tile('credit', 'Credit', (cr < 0 ? '\u2212' : '') + short(cr)) + '</section>';

  // Spending
  h += '<button class="panel pad card-btn" data-go="insights" aria-label="Spending this month, open insights"><div class="split"><span class="t-card">This month <span class="dim">· Spending</span></span><span class="t-card num">' + budPct + '%</span></div>' +
    '<div class="t-amount num" style="margin:8px 0 12px">' + peso(p.netExp) + ' <span class="dim">of ' + peso(p.assignedAll) + '</span></div>' +
    bar(budPct, cls, moPct) +
    '<p class="t-caption" style="margin-top:8px">' + paceTxt + ' · ' + moPct + '% of the month has passed (white mark)</p></button>';

  // Goals closest to done (alerts live in the bell)
  var items = '';
  goalsOf(p).sort(function(a, b) { return b.pct - a.pct; }).slice(0, 2).forEach(function(g) {
    items += navLink('goals', '<span class="ico-tile ringwrap">' + ring(g.pct, kclass(g.group)) + '</span><span class="row-main"><span class="t-card">' + esc(g.name) +
      '</span><span class="t-caption num">' + peso(g.available) + ' of ' + peso(g.target) + '</span></span><span class="t-card num">' + Math.round(g.pct) + '%</span>', 'row');
  });
  h += '<section class="section"><div class="section-head"><h2 class="t-card">Goals in progress</h2><button class="link-btn" data-go="goals">View all</button></div>' +
    '<div class="panel rows" role="list">' + (items || emptyState('No goals with a target yet.')) + '</div></section>';

  // Recent
  h += '<section class="section"><div class="section-head"><h2 class="t-card">Recent activity</h2><button class="link-btn" data-go="activity">View all</button></div>';
  if (p.txns.length) {
    h += '<div class="panel rows" role="list">';
    p.txns.slice(0, 4).forEach(function(t) { h += txnRow(t, true); });
    h += '</div>';
  } else h += '<div class="panel">' + emptyState('No transactions this month.') + '</div>';
  return h + '</section>';
}

function tile(icon, label, val) {
  return '<button class="tile" data-goacc="' + (icon === 'bank' ? 'banks' : (icon === 'wallet' ? 'wallets' : 'credit')) + '"><span class="tile-ico">' + ICON[icon] + '</span><span class="t-caption" style="color:var(--text-2)">' + label + '</span><span class="t-amount num">' + val + '</span></button>';
}

// Latest recorded net worth before the viewed month (falls back past gaps)
function nwRef(p) {
  if (p.netWorth == null) return null;
  for (var i = p.nwSeries.length - 2; i >= 0; i--) {
    var x = p.nwSeries[i];
    if (x.v !== null && x.v !== 0) return { v: x.v, label: x.d.toLocaleDateString('en-PH', { month: 'short' }) };
  }
  return null;
}

/* ── Accounts ──────────────────────────────────────────── */

var ACC_TONE = {
  'UnionBank Credit': 'ub-gold', 'UnionBank': 'ub-play', 'BDO': 'bdo', 'BPI': 'bpi', 'Maribank': 'mari',
  'GCash': 'gcash', 'Maya': 'maya', 'Shopee Pay': 'shopee', 'Grab Wallet': 'grab'
};
function accTone(name) { return ACC_TONE[name] || 'plain'; }

function accountList() {
  var cr = CREDIT_ACCOUNTS.map(function(a) { return { name: a, kind: 'Credit', tone: accTone(a) }; });
  var bk = ACCOUNT_GROUPS[0].items.map(function(a) { return { name: a, kind: 'Bank', tone: accTone(a) }; });
  var wl = ACCOUNT_GROUPS[1].items.map(function(a) { return { name: a, kind: 'Wallet', tone: accTone(a) }; });
  if (accFilter === 'credit') return cr;
  if (accFilter === 'banks') return bk;
  if (accFilter === 'wallets') return wl;
  return cr.concat(bk, wl);
}

// Prev / next buttons for the card carousels (shown only with a mouse; touch swipes)
function carNav(id) {
  return '<div class="car-nav"><button class="icon-btn" data-car="-1" data-for="' + id + '" aria-label="Previous card">' + ICON.prev + '</button>' +
    '<button class="icon-btn" data-car="1" data-for="' + id + '" aria-label="Next card">' + ICON.next + '</button></div>';
}

function viewAccounts() {
  var p = P;
  var list = accountList();
  if (accIdx >= list.length) accIdx = 0;
  var h = '<div class="page-title"><h2 class="t-title">Accounts</h2></div>';
  h += '<div class="chips" role="group" aria-label="Account type">';
  [['all', 'All'], ['credit', 'Credit'], ['banks', 'Banks'], ['wallets', 'Wallets']].forEach(function(f) {
    h += '<button class="chip" data-accf="' + f[0] + '" aria-pressed="' + (accFilter === f[0]) + '">' + f[1] + '</button>';
  });
  h += '</div>' + accountsTop(p) + carNav('cards') + '<div class="cards" id="cards" tabindex="0" aria-label="Accounts">';
  list.forEach(function(a, i) {
    var bal = p.accBals[a.name] || 0;
    var n = (p.txnsByAcc[a.name] || []).length;
    h += '<div class="acard acc-' + a.tone + '" data-i="' + i + '">' +
      '<div class="ac-top"><span class="ac-name">' + esc(a.name) + '</span><span class="ac-kind">' + a.kind + '</span></div>' +
      '<div class="ac-bal"><span class="ac-lbl">' + (a.kind === 'Credit' && bal < 0 ? 'Balance owed' : 'Balance') + '</span><span class="ac-amt num">' + money(bal) + '</span></div>' +
      '<div class="ac-foot num">' + n + ' txn' + (n === 1 ? '' : 's') + ' this month</div></div>';
  });
  h += '</div><div class="dots" id="dots" aria-hidden="true">';
  list.forEach(function(a, i) { h += '<i class="' + (i === accIdx ? 'on' : '') + '"></i>'; });
  h += '</div><div id="accDetail">' + accDetail(list[accIdx]) + '</div>';
  return h;
}

function accDetail(a) {
  var p = P;
  if (!a) return '';
  var bal = p.accBals[a.name] || 0;
  var snap = p.accountSnap[a.name];
  var txns = p.txnsByAcc[a.name] || [];
  var h = '<section class="panel rows"><div class="kv"><span class="t-card">' + esc(a.name) + '</span><span class="t-caption">' + a.kind + '</span></div>' +
    kv(a.kind === 'Credit' && bal < 0 ? 'Balance owed' : 'Current balance', signed(bal));
  if (snap) {
    h += kv('Start of month', signed(snap.cashStart)) + kv('Net activity', (snap.activity >= 0 ? '+' : '−') + peso(snap.activity));
  } else {
    h += kv('Source', P.accSource[a.name] === 'balance-row' ? 'Last recorded balance' : 'No balance recorded');
  }
  if (a.kind === 'Credit') h += kv('Limit and due date', 'Not tracked yet', true);
  var hist = lineChart({ series: accHistory(a.name, 6), area: true, cls: 'ck-acc-' + a.tone, label: a.name + ' balance by month' });
  h += '</section><section class="section"><div class="section-head"><h2 class="t-card">Balance history</h2><span class="t-caption">Last 6 months</span></div><div class="panel pad">' +
    (hist || '<p class="t-caption">No month-end balances recorded yet.</p>') + '</div></section>' +
    '<section class="section"><div class="section-head"><h2 class="t-card">Transactions</h2>' +
    (txns.length > 4 ? '<button class="link-btn" data-acc="' + esc(a.name) + '">View all ' + txns.length + '</button>' : '') + '</div>';
  if (txns.length) {
    h += '<div class="panel rows" role="list">';
    txns.slice(0, 4).forEach(function(t) { h += txnRow(t, false); });
    h += '</div>';
  } else h += '<div class="panel">' + emptyState('No transactions this month.') + '</div>';
  return h + '</section>';
}

function kv(k, v, dim) {
  return '<div class="kv"><span class="t-label">' + k + '</span><span class="t-amount num' + (dim ? ' dim' : '') + '">' + v + '</span></div>';
}

/* ── Activity ──────────────────────────────────────────── */

function viewActivity() {
  var h = '<div class="page-title"><h2 class="t-title">Activity</h2></div>' +
    '<div class="section"><div class="chips" role="group" aria-label="Filter by type">';
  [['all', 'All'], ['expense', 'Expenses'], ['income', 'Income'], ['transfer', 'Transfers']].forEach(function(f) {
    h += '<button class="chip" data-filter="' + f[0] + '" aria-pressed="' + (actFilter === f[0]) + '">' + f[1] + '</button>';
  });
  return h + '</div><div id="actList">' + activityList() + '</div></div>';
}

function activityList() {
  var q = actQuery.toLowerCase();
  var list = P.txns.filter(function(t) {
    if (actFilter === 'expense' && t.type !== 'expense') return false;
    if (actFilter === 'income' && t.type !== 'income' && t.type !== 'reimbursement') return false;
    if (actFilter === 'transfer' && t.type !== 'transfer') return false;
    if (!q) return true;
    return (t.merchant + ' ' + t.cat + ' ' + t.memo + ' ' + t.payment).toLowerCase().indexOf(q) > -1;
  });
  if (!list.length) return emptyState(q ? 'No transactions match “' + actQuery + '”.' : 'No transactions for this filter.');
  var total = 0;
  list.forEach(function(t) { if (t.type === 'expense') total += Math.abs(t.amount); });
  var h = '<div class="t-caption" style="padding:8px 0">' + list.length + ' transaction' + (list.length === 1 ? '' : 's') +
    (total ? ' · <span class="num">' + peso(total) + '</span> in expenses' : '') + '</div>';
  var lastKey = null, open = false;
  list.slice(0, 200).forEach(function(t) {
    var key = t.date ? t.date.toDateString() : 'none';
    if (key !== lastKey) {
      if (open) h += '</div>';
      h += '<div class="date-head">' + esc(dayLabel(t.date)) + '</div><div class="panel rows" role="list">';
      open = true; lastKey = key;
    }
    h += txnRow(t, true);
  });
  if (open) h += '</div>';
  if (list.length > 200) h += '<div class="t-caption" style="padding:12px 0">Showing the latest 200.</div>';
  return h;
}

/* ── Budget (one bar per group; categories are plain rows) ─ */

function gauge(spent, assigned, left) {
  var pct = assigned > 0 ? Math.min(spent / assigned * 100, 100) : 0;
  var len = Math.PI * 80;
  return '<section class="gauge"><svg viewBox="0 0 200 112" role="img" aria-label="' + Math.round(pct) + ' percent of assigned budget spent">' +
    '<defs><linearGradient id="gg" x1="0" x2="1" y1="0" y2="0"><stop offset="0" class="gs0"/><stop offset="1" class="gs1"/></linearGradient></defs>' +
    '<path d="M20 100 A80 80 0 0 1 180 100" class="g-track"/>' +
    '<path d="M20 100 A80 80 0 0 1 180 100" class="g-fill" stroke-dasharray="' + (len * pct / 100).toFixed(1) + ' ' + len.toFixed(1) + '"/></svg>' +
    '<div class="g-center"><span class="t-display num">' + hshort(left) + '</span><span class="t-label">left to spend of ' + short(assigned) + '</span></div>' +
    '<div class="g-foot"><div><span class="t-amount num">' + peso(spent) + '</span><span class="t-caption">spent</span></div>' +
    '<div class="r"><span class="t-amount num">' + peso(assigned) + '</span><span class="t-caption">assigned</span></div></div></section>';
}

function budgetData() {
  var groups = {}, order = [], A = 0, S = 0, L = 0;
  P.categories.forEach(function(c) {
    if (/^(income|balance)$/i.test(c.group)) return;
    if (!c.totalAssigned && !c.actAmt && !c.available) return;
    if (!groups[c.group]) { groups[c.group] = { name: c.group, sort: c.grpSort, cats: [], A: 0, S: 0, L: 0, over: 0 }; order.push(c.group); }
    var g = groups[c.group];
    g.cats.push(c); g.A += c.totalAssigned; g.S += c.actAmt; g.L += c.available; if (c.available < 0) g.over++;
    A += c.totalAssigned; S += c.actAmt; L += c.available;
  });
  order.sort(function(a, b) { return groups[a].sort - groups[b].sort; });
  order.forEach(function(n) { groups[n].pct = groups[n].A > 0 ? groups[n].S / groups[n].A * 100 : 0; });
  return { groups: groups, order: order, A: A, S: S, L: L };
}

function viewBudget() {
  var b = budgetData(), p = P;
  var h = '<div class="page-title"><h2 class="t-title">Budget</h2></div>';
  var note = p.rta > 1 ? 'Not yet given a job' : (p.rta < -1 ? 'Over-assigned' : 'Fully assigned');
  h += heroCard('Left to assign', money(p.rta, true), '<div class="hero-note"><span>' + note + '</span></div>');
  h += strip([{ label: 'Assigned', value: peso(b.A) }, { label: 'Spent', value: peso(b.S) }, { label: 'Remaining', value: signed(b.L) }]);
  if (!b.order.length) return h + '<div class="panel">' + emptyState('No budget categories for this month.') + '</div>';

  var segs = [];
  b.order.forEach(function(n) { if (b.groups[n].A > 0) segs.push({ name: n, v: b.groups[n].A, color: kvar(n) }); });
  h += breakdownCard('Where it\u2019s assigned', 'Tap for categories', segs, short(b.A), 'assigned', 'data-grp');

  h += '<section class="section"><div class="section-head"><h2 class="t-card">Groups</h2><span class="t-caption">Spent so far</span></div><div class="bgrid">';
  b.order.forEach(function(n) {
    var g = b.groups[n];
    h += '<button class="bcard ' + kclass(n) + (g.over ? ' is-over' : '') + '" data-grp="' + esc(n) + '">' +
      '<span class="bc-top">' + ktile(GROUP_ICON[slug(n)] || 'dots', n) + ring(g.pct, kclass(n) + (g.over ? ' over' : '')) + '</span>' +
      '<span class="t-card">' + esc(n) + '</span>' +
      '<span class="bc-left num">' + signed(g.L) + '</span>' +
      '<span class="t-caption num">' + (g.over ? '<b class="state-err">' + g.over + ' over</b> \u00b7 ' : '') + short(g.S) + ' of ' + short(g.A) + ' spent</span></button>';
  });
  return h + '</div></section>';
}

function groupSheetHtml(name) {
  var g = budgetData().groups[name];
  if (!g) return '';
  var h = '<div class="txn-hero">' + ktile(GROUP_ICON[slug(name)] || 'dots', name) + '<div class="row-main"><span class="t-card">' + esc(name) + '</span><span class="t-caption">' + g.cats.length + ' categories</span></div></div>' +
    '<div class="t-display num">' + money(g.L) + '</div><span class="t-label" style="margin-top:-12px">left this month</span>' +
    '<section class="panel rows">' + kv('Assigned', peso(g.A)) + kv('Spent', peso(g.S)) + kv('Left', signed(g.L)) + '</section>' +
    '<div class="section"><h3 class="t-card">Categories</h3><div class="panel rows" role="list">';
  g.cats.forEach(function(c) {
    var pct = c.totalAssigned > 0 ? c.actAmt / c.totalAssigned * 100 : 0;
    var over = c.available < 0;
    h += '<button class="row" role="listitem" data-cat="' + c.catId + '">' + ktile(iconName(c.cat, c.group), c.group) +
      '<div class="row-main"><span class="t-card">' + esc(c.cat) + '</span><span class="t-caption num">' + peso(c.actAmt) + ' of ' + peso(c.totalAssigned) + ' spent</span></div>' +
      '<div class="row-end"><span class="t-amount num' + (over ? ' state-err' : '') + '">' + signed(c.available) + '</span>' + (over ? '<span class="t-caption state-err">over</span>' : '') + '</div>' +
      ring(pct, kclass(c.group) + (over ? ' over' : '') + ' sm') + '</button>';
  });
  return h + '</div></div>';
}

function openGrp(name) { openSheet(name, groupSheetHtml(name), false); }

/* ── Insights ──────────────────────────────────────────── */

var DONUT = ['var(--d1)', 'var(--d2)', 'var(--d3)', 'var(--d4)', 'var(--d5)'];

function spendFor(fromKey, toKey) {
  var groups = {}, cats = {}, total = 0, income = 0;
  raw.a.forEach(function(row) {
    var d = parseDate(row[7]);
    if (!d) return;
    var k = monthKey(d);
    if (k < fromKey || k > toKey) return;
    var t = String(row[8]).trim();
    var amt = Math.abs(pn(row[9]));
    var g = String(row[13] || '').trim() || 'Other';
    var cn = String(row[12] || '').trim() || 'Uncategorised';
    if (!cats[g]) cats[g] = {};
    if (t === 'Expense') { groups[g] = (groups[g] || 0) + amt; total += amt; cats[g][cn] = (cats[g][cn] || 0) + amt; }
    else if (t === 'Reimbursement') { groups[g] = (groups[g] || 0) - amt; total -= amt; cats[g][cn] = (cats[g][cn] || 0) - amt; }
    else if (t === 'Income') income += amt;
  });
  Object.keys(groups).forEach(function(g) { if (groups[g] <= 0) delete groups[g]; });
  return { groups: groups, cats: cats, total: Math.max(total, 0), income: income };
}

function periodRange() {
  var k = monthKey(viewMonth);
  if (insPeriod === '3m') return { from: k - 2, to: k, pf: k - 5, pt: k - 3, label: 'previous 3 months' };
  if (insPeriod === 'year') {
    var jan = viewMonth.getFullYear() * 12;
    return { from: jan, to: k, pf: jan - 12, pt: k - 12, label: 'same months last year' };
  }
  return { from: k, to: k, pf: k - 1, pt: k - 1, label: 'last month' };
}

function segColor(s, i) { return s.name === 'Others' ? 'var(--c-other)' : kvar(s.name); }

function donutSegs(groups) {
  var keys = Object.keys(groups).sort(function(a, b) { return groups[b] - groups[a]; });
  var segs = keys.slice(0, 4).map(function(g) { return { name: g, v: groups[g] }; });
  var rest = 0, restNames = [];
  keys.slice(4).forEach(function(g) { rest += groups[g]; restNames.push(g); });
  if (rest > 0) segs.push({ name: 'Others', v: rest, members: restNames });
  return segs;
}

function donut(groups, total, sel) {
  var segs = donutSegs(groups);
  var r = 40, c = 2 * Math.PI * r, off = 0, gap = segs.length > 1 ? 2 : 0, selSeg = null;
  var svg = '<svg class="donut' + (sel ? ' has-sel' : '') + '" viewBox="0 0 100 100" role="group" aria-label="Spending by group">' +
    '<circle cx="50" cy="50" r="' + r + '" fill="none" stroke="var(--elevated)" stroke-width="12"/>';
  segs.forEach(function(s, i) {
    var len = s.v / total * c;
    var on = sel === s.name;
    if (on) selSeg = s;
    svg += '<circle class="seg' + (on ? ' is-sel' : '') + '" data-seg="' + esc(s.name) + '" cx="50" cy="50" r="' + r + '" fill="none" stroke="' + segColor(s, i) + '" stroke-width="' + (on ? 15 : 12) + '" stroke-dasharray="' + Math.max(len - gap, 0.5).toFixed(2) + ' ' + c.toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 50 50)"/>';
    off += len;
  });
  var cv = selSeg ? selSeg.v : total, cl = selSeg ? selSeg.name : 'spent';
  svg += '<text x="50" y="48" text-anchor="middle" class="donut-v">' + short(cv) + '</text><text x="50" y="62" text-anchor="middle" class="donut-l">' + esc(cl) + '</text></svg>';
  var legend = '<ul class="legend">';
  segs.forEach(function(s, i) {
    legend += '<li><button class="leg' + (sel === s.name ? ' is-sel' : '') + '" data-seg="' + esc(s.name) + '" aria-pressed="' + (sel === s.name) + '"><i style="background:' + segColor(s, i) + '"></i><span>' + esc(s.name) + '</span><b class="num">' + Math.round(s.v / total * 100) + '%</b></button></li>';
  });
  return '<div class="donut-wrap">' + svg + legend + '</ul></div>';
}

function segDetail(cur, sel) {
  if (!sel) return '<p class="t-caption" style="margin-top:12px">Tap a slice or a group to see what\u2019s inside it.</p>';
  var segs = donutSegs(cur.groups), seg = null;
  segs.forEach(function(s) { if (s.name === sel) seg = s; });
  if (!seg) return '';
  var rows = [];
  if (seg.members) seg.members.forEach(function(g) { rows.push({ name: g, v: cur.groups[g], group: g, isGroup: true }); });
  else Object.keys(cur.cats[sel] || {}).forEach(function(cn) { if (cur.cats[sel][cn] > 0) rows.push({ name: cn, v: cur.cats[sel][cn], group: sel }); });
  rows.sort(function(a, b) { return b.v - a.v; });
  var h = '<div class="seg-detail">';
  rows.slice(0, 6).forEach(function(r) {
    h += '<div class="row">' + ktile(r.isGroup ? (GROUP_ICON[slug(r.group)] || 'dots') : iconName(r.name, r.group), r.group, 'sm') +
      '<div class="row-main"><span class="t-card">' + esc(r.name) + '</span></div>' +
      '<div class="row-end"><span class="t-amount num">' + peso(r.v) + '</span><span class="t-caption num">' + Math.round(r.v / seg.v * 100) + '%</span></div></div>';
  });
  return h + '</div>';
}

function viewInsights() {
  var rg = periodRange();
  var cur = spendFor(rg.from, rg.to), prev = spendFor(rg.pf, rg.pt);
  if (insSel && !cur.groups[insSel] && insSel !== 'Others') insSel = null;
  var h = '<div class="page-title"><h2 class="t-title">Insights</h2></div><div class="chips" role="group" aria-label="Period">';
  [['month', 'This month'], ['3m', '3 months'], ['year', 'This year']].forEach(function(f) {
    h += '<button class="chip" data-per="' + f[0] + '" aria-pressed="' + (insPeriod === f[0]) + '">' + f[1] + '</button>';
  });
  h += '</div>';

  h += '<section class="hero"><div class="hero-label"><span class="t-label">Spending</span>' + eyeBtn() + '</div><span class="t-display num hero-amount">' + money(cur.total, true) + '</span>';
  var change = null;
  if (prev.total > 0) {
    change = (cur.total - prev.total) / prev.total * 100;
    h += '<div class="delta ' + (change <= 0 ? 'up' : 'down') + ' num">' + (change <= 0 ? ICON.down : ICON.up) + '<b>' + Math.abs(change).toFixed(0) + '%</b><span>' +
      (change <= 0 ? 'less' : 'more') + ' than ' + rg.label + ' (' + peso(prev.total) + ')</span></div>';
  } else {
    h += '<div class="hero-note"><span>No spending recorded in ' + rg.label + ' to compare.</span></div>';
  }
  h += '</section>';

  var net = cur.income - cur.total;
  h += '<section class="metrics3"><div class="metric"><span class="t-label">Income</span><span class="t-amount num">' + peso(cur.income) + '</span></div>' +
    '<div class="metric"><span class="t-label">Spent</span><span class="t-amount num">' + peso(cur.total) + '</span></div>' +
    '<div class="metric"><span class="t-label">' + (net >= 0 ? 'Left over' : 'Shortfall') + '</span><span class="t-amount num">' + peso(net) + '</span></div></section>';

  h += '<section class="section"><div class="section-head"><h2 class="t-card">By category group</h2></div><div class="panel pad">' +
    (cur.total > 0 ? donut(cur.groups, cur.total, insSel) + segDetail(cur, insSel) : emptyState('No spending in this period.')) + '</div></section>';

  var nwPts = P.nwSeries.filter(function(x) { return x.v !== null; });
  if (nwPts.length > 1) {
    h += '<section class="section"><div class="section-head"><h2 class="t-card">Net worth</h2><span class="t-caption">Last 6 months</span></div><div class="panel pad">' + lineChart({ series: P.nwSeries.map(function(x) { return { d: x.d, v: x.v, proj: false }; }), area: true, label: 'Net worth by month' }) + '</div></section>';
  }

  // Insight lines — computed from the numbers above only
  var lines = [];
  if (change !== null) lines.push('You spent ' + Math.abs(change).toFixed(0) + '% ' + (change <= 0 ? 'less' : 'more') + ' than ' + rg.label + '.');
  var keys = Object.keys(cur.groups).sort(function(a, b) { return cur.groups[b] - cur.groups[a]; });
  if (keys.length && cur.total > 0) lines.push(keys[0] + ' is your largest group at ' + Math.round(cur.groups[keys[0]] / cur.total * 100) + '% of spending.');
  if (cur.income > 0) lines.push('Spending is ' + Math.round(cur.total / cur.income * 100) + '% of income in this period.');
  if (lines.length) {
    h += '<section class="section">';
    lines.forEach(function(l) { h += '<div class="insight">' + ICON.spark + '<span>' + esc(l) + '</span></div>'; });
    h += '</section>';
  }
  return h;
}


/* ── Goals (swipeable cards, same pattern as Accounts) ──── */

function goalMix(all) {
  var by = {}, tgt = {}, order = [];
  all.forEach(function(g) {
    if (!by[g.group]) { by[g.group] = 0; tgt[g.group] = 0; order.push(g.group); }
    by[g.group] += Math.max(0, g.available); tgt[g.group] += g.target;
  });
  var tot = 0;
  order.forEach(function(k) { tot += by[k]; });
  if (tot <= 0) return '';
  var r = 40, c = 2 * Math.PI * r, off = 0;
  var svg = '<svg class="donut" viewBox="0 0 100 100" role="img" aria-label="Savings by goal type"><circle cx="50" cy="50" r="40" fill="none" stroke="var(--elevated)" stroke-width="12"/>';
  order.forEach(function(k) {
    var len = by[k] / tot * c;
    svg += '<circle cx="50" cy="50" r="40" fill="none" stroke="' + kvar(k) + '" stroke-width="12" stroke-dasharray="' + Math.max(len - 2, 0.5).toFixed(2) + ' ' + c.toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 50 50)"/>';
    off += len;
  });
  svg += '<text x="50" y="48" text-anchor="middle" class="donut-v">' + short(tot) + '</text><text x="50" y="62" text-anchor="middle" class="donut-l">saved</text></svg>';
  var lg = '<ul class="legend">';
  order.forEach(function(k) {
    lg += '<li><div class="leg"><i style="background:' + kvar(k) + '"></i><span>' + esc(k) + '</span><b class="num">' + Math.round(by[k] / tgt[k] * 100) + '%</b></div></li>';
  });
  return '<section class="section"><div class="section-head"><h2 class="t-card">Where it sits</h2><span class="t-caption">% of each target</span></div><div class="panel pad"><div class="donut-wrap">' + svg + lg + '</ul></div></div></section>';
}

function goalList() {
  var all = goalsOf(P);
  if (goalFilter === 'all') return all;
  return all.filter(function(g) { return g.key === goalFilter; });
}

function viewGoals() {
  var all = goalsOf(P);
  var list = goalList();
  if (goalIdx >= list.length) goalIdx = 0;
  var saved = 0, target = 0;
  all.forEach(function(g) { saved += Math.max(0, g.available); target += g.target; });

  var h = '<div class="page-title"><h2 class="t-title">Goals</h2></div>';
  if (!all.length) return h + '<div class="panel">' + emptyState('No goals with a target this month.') + '</div>';


  h += '<div class="chips" role="group" aria-label="Goal type">';
  [['all', 'All'], ['sinking', 'Sinking'], ['emergency', 'Emergency'], ['goals', 'Goals']].forEach(function(f) {
    h += '<button class="chip" data-goalf="' + f[0] + '" aria-pressed="' + (goalFilter === f[0]) + '">' + f[1] + '</button>';
  });
  h += '</div>' + goalsTop() + carNav('gcards') + '<div class="cards" id="gcards" tabindex="0" aria-label="Goals">';
  list.forEach(function(g, i) {
    var done = g.pct >= 100;
    h += '<div class="gcard ' + kclass(g.group) + '" data-i="' + i + '">' +
      '<div class="ac-top"><span class="gc-ico">' + glyph(iconName(g.full, g.group)) + '</span><span class="ac-kind">' + esc(g.group) + '</span></div>' +
      '<div class="gc-mid"><span class="gc-name">' + esc(g.name) + '</span>' +
      '<span class="ac-amt num">' + money(g.available) + '</span><span class="gc-of num">of ' + peso(g.target) + '</span></div>' +
      '<div class="gc-foot"><span class="num">' + (done ? 'Funded' : Math.round(g.pct) + '% saved') + '</span>' + ring(g.pct, 'on-card') + '</div></div>';
  });
  h += '</div><div class="dots" id="gdots" aria-hidden="true">';
  list.forEach(function(g, i) { h += '<i class="' + (i === goalIdx ? 'on' : '') + '"></i>'; });
  return h + '</div><div id="goalDetail">' + goalDetail(list[goalIdx]) + '</div>';
}

function goalSegTap(name) {
  if (goalFilter === 'all') {
    var key = slug(name).replace(/^goal$/, 'goals');
    goalFilter = key; goalIdx = 0;
  } else {
    var list = goalList();
    for (var i = 0; i < list.length; i++) if (list[i].name === name) goalIdx = i;
  }
  paint();
  var el = document.getElementById('gcards');
  if (el && el.firstElementChild) el.scrollLeft = goalIdx * (el.firstElementChild.offsetWidth + 12);
}

function goalDetail(g) {
  if (!g) return '';
  var left = Math.max(0, g.target - g.available);
  var months;
  if (left <= 0) months = 'Funded';
  else { var m = Math.ceil(left / g.monthlyEff); months = m + ' month' + (m === 1 ? '' : 's'); }
  return '<section class="panel rows"><div class="kv"><span class="row-id">' + ktile(iconName(g.full, g.group), g.group, 'sm') + '<span class="t-card">' + esc(g.name) + '</span></span><span class="t-caption">' + esc(g.group) + '</span></div>' +
    kv('Saved', peso(g.available)) + kv('Yearly target', peso(g.target)) + kv('Still needed', peso(left)) +
    kv('Monthly goal', g.monthly > 0 ? peso(g.monthly) : '—') + kv('Assigned this month', peso(g.assigned)) +
    kv(g.implied ? 'Time to go at target \u00f7 12' : 'Time to go at monthly goal', months) + '</section>' +
    '<div class="section"><div class="section-head"><h3 class="t-card">Progress</h3><span class="t-caption">Dashed = ' + (g.implied ? 'at target \u00f7 12 a month' : 'if you keep funding the monthly goal') + '</span></div><div class="panel pad">' + goalChart(g) + '</div></div>' +
    '<p class="t-caption">Target is the yearly goal, or the monthly goal × 12 when no yearly goal is set.</p>';
}


function viewSkeleton() {
  return '<div class="hero" aria-busy="true" aria-label="Loading"><div class="skel skel-line" style="width:96px"></div><div class="skel skel-hero"></div></div>' +
    '<div class="skel skel-block"></div><div class="skel skel-block"></div>';
}

function viewError() {
  return '<div class="panel notice">' + ICON.err + '<div class="notice-body"><span class="t-card">Couldn’t load your data</span>' +
    '<span class="t-label">' + esc(fetchError) + '. Nothing is saved on this device yet.</span></div>' +
    '<button class="btn" id="retry">Retry</button></div>';
}

/* ── Paint ─────────────────────────────────────────────── */

function syncLine() {
  var el = document.getElementById('sync');
  var btn = document.getElementById('refresh');
  btn.classList.toggle('is-loading', fetchState === 'loading');
  el.className = 'sync';
  if (fetchState === 'loading') { el.innerHTML = lastUp ? 'Updating… <b>showing ' + ago(lastUp) + '</b>' : 'Loading…'; return; }
  if (fetchState === 'error' && lastUp) { el.className = 'sync is-error'; el.innerHTML = 'Offline · <b>data from ' + ago(lastUp) + '</b>'; return; }
  if (fetchState === 'error') { el.className = 'sync is-error'; el.textContent = 'Not updated'; return; }
  if (!lastUp) { el.textContent = ''; return; }
  var stale = Date.now() - lastUp.getTime() > STALE_MS;
  if (fromCache || stale) { el.className = 'sync is-stale'; el.innerHTML = '⚠ <b>Saved copy</b> · ' + ago(lastUp); }
  else { el.className = 'sync is-live'; el.innerHTML = 'Updated <b>' + lastUp.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }) + '</b>'; }
}

function paint() {
  document.getElementById('mlabel').textContent = monthLabel(viewMonth);
  var now = new Date();
  document.getElementById('nextM').disabled = monthKey(viewMonth) >= monthKey(now);
  syncLine();

  var nav = document.querySelectorAll('.nav-item');
  for (var i = 0; i < nav.length; i++) {
    var on = nav[i].getAttribute('data-tab') === tab;
    nav[i].classList.toggle('is-active', on);
    if (on) nav[i].setAttribute('aria-current', 'page'); else nav[i].removeAttribute('aria-current');
  }

  var view = document.getElementById('view');
  if (!raw) { view.innerHTML = fetchState === 'error' ? viewError() : viewSkeleton(); return; }

  P = parseMonth(raw, viewMonth.getMonth(), viewMonth.getFullYear());
  updateBell();
  var scroll = window.scrollY;
  var html = '';
  if (fetchState === 'error' && !fromCache) {
    html += '<div class="panel notice">' + ICON.warn + '<div class="notice-body"><span class="t-card">Couldn’t refresh</span><span class="t-label">' + esc(fetchError) + '. Showing the last saved copy.</span></div><button class="btn secondary" id="retry">Retry</button></div>';
  }
  if (tab === 'home') html += viewHome();
  else if (tab === 'accounts') html += viewAccounts();
  else if (tab === 'activity') html += viewActivity();
  else if (tab === 'budget') html += viewBudget();
  else if (tab === 'goals') html += viewGoals();
  else html += viewInsights();
  view.innerHTML = html;
  window.scrollTo(0, scroll);
}

/* ── Account sheet (full transaction list) ─────────────── */

var lastFocus = null;

function openAccount(acc) {
  var txns = P.txnsByAcc[acc] || [];
  var h = '<h3 class="t-section">' + monthLabel(viewMonth) + ' \u00b7 ' + txns.length + ' transaction' + (txns.length === 1 ? '' : 's') + '</h3><div class="panel rows" role="list">';
  txns.forEach(function(t) { h += txnRow(t, false); });
  openSheet(acc, h + '</div>', false);
}

function closeSheet() {
  var sheet = document.getElementById('sheet'), scrim = document.getElementById('scrim');
  if (sheet.hidden) return;
  sheet.classList.remove('is-open'); scrim.classList.remove('is-open');
  document.body.style.overflow = '';
  notifOpen = false;
  setTimeout(function() { sheet.hidden = true; scrim.hidden = true; }, 260);
  if (lastFocus && lastFocus.focus) lastFocus.focus();
  sheetPrev = null;
}

/* ── Events ────────────────────────────────────────────── */

var TABS = ['home', 'accounts', 'activity', 'budget', 'goals', 'insights'];

var tabHist = [];

function setTab(t, back) {
  if (t === tab) return;
  var dir = TABS.indexOf(t) - TABS.indexOf(tab);
  if (!back) { tabHist.push(tab); if (tabHist.length > 20) tabHist.shift(); }
  tab = t; paint(); window.scrollTo(0, 0);
  var v = document.getElementById('view');
  v.classList.remove('enter-l', 'enter-r');
  void v.offsetWidth;
  if (dir !== 0) v.classList.add(dir > 0 ? 'enter-r' : 'enter-l');
}

function changeMonth(d) {
  viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + d, 1);
  paint();
}

function init() {
  var nav = document.querySelectorAll('.nav-item');
  for (var i = 0; i < nav.length; i++) {
    nav[i].addEventListener('click', function(e) { setTab(e.currentTarget.getAttribute('data-tab')); });
  }
  document.getElementById('prevM').addEventListener('click', function() { changeMonth(-1); });
  document.getElementById('nextM').addEventListener('click', function() { changeMonth(1); });
  document.getElementById('refresh').addEventListener('click', loadData);
  document.getElementById('sheetClose').addEventListener('click', closeSheet);
  document.getElementById('scrim').addEventListener('click', closeSheet);
  document.addEventListener('keydown', function(e) { if (e.key === 'Escape') { closeSearch(); closeSheet(); } });
  document.getElementById('searchBtn').addEventListener('click', openSearch);
  document.getElementById('gclose').addEventListener('click', closeSearch);
  document.getElementById('gq').addEventListener('input', renderResults);
  document.getElementById('bellBtn').addEventListener('click', openNotifs);

  var view = document.getElementById('view');
  view.addEventListener('click', function(e) {
    var node = e.target.closest ? e.target.closest('[data-acc],[data-go],[data-filter],[data-accf],[data-goalf],[data-per],#retry') : null;
    if (!node) return;
    if (node.id === 'retry') { loadData(); return; }
    if (node.hasAttribute('data-acc')) { openAccount(node.getAttribute('data-acc')); return; }
    if (node.hasAttribute('data-go')) { setTab(node.getAttribute('data-go')); return; }
    if (node.hasAttribute('data-accf')) { accFilter = node.getAttribute('data-accf'); accIdx = 0; paint(); return; }
    if (node.hasAttribute('data-goalf')) { goalFilter = node.getAttribute('data-goalf'); goalIdx = 0; paint(); return; }
    if (node.hasAttribute('data-per')) { insPeriod = node.getAttribute('data-per'); insSel = null; paint(); return; }
    if (node.hasAttribute('data-filter')) {
      actFilter = node.getAttribute('data-filter');
      var btns = document.querySelectorAll('[data-filter]');
      for (var j = 0; j < btns.length; j++) btns[j].setAttribute('aria-pressed', String(btns[j] === node));
      document.getElementById('actList').innerHTML = activityList();
    }
  });
  view.addEventListener('input', function(e) {
    if (e.target.id !== 'q') return;
    actQuery = e.target.value;
    document.getElementById('actList').innerHTML = activityList();
  });
  // Carousels: the card nearest the left edge is the selected one
  view.addEventListener('scroll', function(e) {
    var el = e.target;
    if (el.id !== 'cards' && el.id !== 'gcards') return;
    var first = el.firstElementChild;
    if (!first) return;
    var isGoal = el.id === 'gcards';
    var list = isGoal ? goalList() : accountList();
    var idx = Math.round(el.scrollLeft / (first.offsetWidth + 12));
    idx = Math.max(0, Math.min(list.length - 1, idx));
    if (idx === (isGoal ? goalIdx : accIdx)) return;
    if (isGoal) goalIdx = idx; else accIdx = idx;
    var dots = document.getElementById(isGoal ? 'gdots' : 'dots').children;
    for (var k = 0; k < dots.length; k++) dots[k].className = k === idx ? 'on' : '';
    document.getElementById(isGoal ? 'goalDetail' : 'accDetail').innerHTML = isGoal ? goalDetail(list[idx]) : accDetail(list[idx]);
  }, true);

  try { hideNums = localStorage.getItem('tab_hide') === '1'; } catch (e) {}

  // Taps: charts, donut, rows that open sheets, home tiles
  document.addEventListener('click', function(e) {
    var n = e.target.closest ? e.target.closest('[data-read],[data-gseg],[data-seg],[data-cat],[data-grp],[data-txn],[data-back],[data-goacc],[data-eye],[data-car],[data-dismiss],[data-undo],[data-sr],[data-restore],#sheet [data-go]') : null;
    if (!n) return;
    if (n.hasAttribute('data-read')) {
      var box = n.closest('.chart-box');
      if (box) {
        box.querySelector('.readout').textContent = mask(n.getAttribute('data-read'));
        var sel = box.querySelectorAll('.pt.sel');
        for (var q = 0; q < sel.length; q++) sel[q].classList.remove('sel');
        n.classList.add('sel');
      }
      return;
    }
    if (n.hasAttribute('data-gseg')) { goalSegTap(n.getAttribute('data-gseg')); return; }
    if (n.hasAttribute('data-seg')) { var v = n.getAttribute('data-seg'); insSel = insSel === v ? null : v; paint(); return; }
    if (n.hasAttribute('data-cat')) { openCat(n.getAttribute('data-cat')); return; }
    if (n.hasAttribute('data-grp')) { openGrp(n.getAttribute('data-grp')); return; }
    if (n.hasAttribute('data-txn')) { openTxn(+n.getAttribute('data-txn')); return; }
    if (n.hasAttribute('data-back') && sheetPrev) { var p = sheetPrev; openSheet(p.title, p.html, false); return; }
    if (n.hasAttribute('data-car')) {
      var cel = document.getElementById(n.getAttribute('data-for'));
      if (cel && cel.firstElementChild) {
        var step = cel.firstElementChild.offsetWidth + 12;
        var cur = Math.round(cel.scrollLeft / step) + (+n.getAttribute('data-car'));
        cel.scrollTo({ left: Math.max(0, cur) * step, behavior: 'smooth' });
      }
      return;
    }
    if (n.hasAttribute('data-eye')) {
      hideNums = !hideNums;
      try { localStorage.setItem('tab_hide', hideNums ? '1' : '0'); } catch (err) {}
      paint(); return;
    }
    if (n.hasAttribute('data-sr')) { searchGo(n.getAttribute('data-sr')); return; }
    if (n.hasAttribute('data-restore')) { saveDismissed({}); renderNotifs(); updateBell(); return; }
    if (n.hasAttribute('data-go') && n.closest('#sheet')) { closeSheet(); setTab(n.getAttribute('data-go')); return; }
    if (n.hasAttribute('data-dismiss')) {
      var dm = dismissedMap(), dk = n.getAttribute('data-dismiss');
      dm[dk] = 1; saveDismissed(dm);
      if (notifOpen) { renderNotifs(); updateBell(); } else { paint(); showToast('Alert dismissed', dk); }
      return;
    }
    if (n.hasAttribute('data-undo')) {
      var um = dismissedMap(); delete um[n.getAttribute('data-undo')]; saveDismissed(um);
      var tt = document.getElementById('toast'); if (tt) tt.classList.remove('show');
      paint(); return;
    }
    if (n.hasAttribute('data-goacc')) { accFilter = n.getAttribute('data-goacc'); accIdx = 0; setTab('accounts'); }
  });

  // Swipe left/right to move between tabs
  var sx = 0, sy = 0, st = 0;
  view.addEventListener('touchstart', function(e) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now(); }, { passive: true });
  view.addEventListener('touchend', function(e) {
    if (!document.getElementById('sheet').hidden) return;
    if (e.target.closest && e.target.closest('.cards,.chips,.chart-box,input')) return;
    var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.5 || Date.now() - st > 700) return;
    if (dx > 0) {
      // Swipe right: back to the tab you came from
      if (tabHist.length) setTab(tabHist.pop(), true);
      else if (TABS.indexOf(tab) > 0) setTab(TABS[TABS.indexOf(tab) - 1], true);
      return;
    }
    var i = TABS.indexOf(tab) + 1;
    if (i < TABS.length) setTab(TABS[i]);
  }, { passive: true });

  // Drag the bottom sheet down to close it
  var sheetEl = document.getElementById('sheet'), sbody = document.getElementById('sheetBody');
  var dy0 = 0, dy = 0, dragging = false;
  sheetEl.addEventListener('touchstart', function(e) {
    if (e.touches.length !== 1) return;
    var onBody = sbody.contains(e.target);
    if (onBody && sbody.scrollTop > 0) { dragging = false; return; }
    if (e.target.closest && e.target.closest('.chart-box')) { dragging = false; return; }
    dy0 = e.touches[0].clientY; dy = 0; dragging = true;
    sheetEl.style.transition = 'none';
  }, { passive: true });
  sheetEl.addEventListener('touchmove', function(e) {
    if (!dragging) return;
    dy = e.touches[0].clientY - dy0;
    if (dy < 0) { dy = 0; }
    if (dy > 0 && sbody.scrollTop > 0) return;
    sheetEl.style.transform = 'translateY(' + dy + 'px)';
  }, { passive: true });
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    sheetEl.style.transition = '';
    if (dy > 90) { sheetEl.style.transform = ''; closeSheet(); }
    else sheetEl.style.transform = '';
    dy = 0;
  }
  sheetEl.addEventListener('touchend', endDrag, { passive: true });
  sheetEl.addEventListener('touchcancel', endDrag, { passive: true });

  var hh = (location.hash || '').replace('#', '');
  if (/^(home|accounts|activity|budget|goals|insights)$/.test(hh)) tab = hh;
  loadCache();
  paint();
  loadData();
}

if (typeof document !== 'undefined' && document.getElementById) {
  init();
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() { navigator.serviceWorker.register('sw.js').catch(function() {}); });
  }
}
