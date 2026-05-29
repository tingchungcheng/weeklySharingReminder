/** First Wednesday (week 0) maps to `WEEKLY_SHARING_SERIES_ANCHOR_NAME` after alphabetical sort + rotation. */
const SERIES_START = new Date(2026, 4, 6); // 6 May 2026 (Wednesday)

function startOfLocalDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addWeeks(date, weeks) {
  const x = new Date(date);
  x.setDate(x.getDate() + weeks * 7);
  return x;
}

function formatRowDate(d) {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function normalizeApiBase(raw) {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/\/+$/, "");
}

/** Same rules as Lambda: unique (case-insensitive), English alphabetical — defines Wednesday order. */
function sortNamesAlpha(names) {
  const seen = new Set();
  const out = [];
  for (const n of names) {
    if (typeof n !== "string") continue;
    const t = n.trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out.sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
}

function getSeriesAnchorName() {
  if (typeof window === "undefined") return "Pang Yong Xian";
  const w = window.WEEKLY_SHARING_SERIES_ANCHOR_NAME;
  const s = typeof w === "string" ? w.trim() : "";
  return s || "Pang Yong Xian";
}

/** Alphabetical list rotated so `anchor` is index 0 (gets SERIES_START). */
function orderNamesForWednesdays(sorted, anchor) {
  const low = anchor.trim().toLowerCase();
  if (!low) return { ordered: sorted, anchorMissing: false };
  const idx = sorted.findIndex((n) => n.toLowerCase() === low);
  if (idx < 0) return { ordered: sorted, anchorMissing: true };
  const ordered = [...sorted.slice(idx), ...sorted.slice(0, idx)];
  return { ordered, anchorMissing: false };
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setSubtitle(lines, modifierClass) {
  const el = document.querySelector(".subtitle");
  if (!el) return;
  el.textContent = lines.join("\n");
  el.classList.remove("subtitle--error", "subtitle--muted");
  if (modifierClass) el.classList.add(modifierClass);
}

async function fetchRoster(apiBase) {
  const url = `${apiBase}/names?_=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data || !Array.isArray(data.names))
    throw new Error("Unexpected response shape");
  const names = data.names
    .filter((n) => typeof n === "string")
    .map((s) => s.trim())
    .filter(Boolean);
  const holidays = normalizeHolidayIsos(
    Array.isArray(data.holidays) ? data.holidays : []
  );
  return { names, holidays };
}

function toIsoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normalizeHolidayIsos(raw) {
  const seen = new Set();
  const out = [];
  for (const h of raw || []) {
    if (typeof h !== "string") continue;
    const t = h.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.sort();
}

/** Consecutive Wednesdays from series start, skipping holiday ISO dates. */
function sharingWednesdays(count, holidayIsos) {
  const holidaySet = new Set(normalizeHolidayIsos(holidayIsos));
  const slots = [];
  let week = 0;
  const maxWeeks = count + holidaySet.size + 520;
  while (slots.length < count && week < maxWeeks) {
    const d = addWeeks(SERIES_START, week);
    const iso = toIsoDate(startOfLocalDay(d));
    if (!holidaySet.has(iso)) slots.push(d);
    week += 1;
  }
  return slots;
}

function buildSchedule(names, holidayIsos) {
  const sorted = sortNamesAlpha(names);
  const anchor = getSeriesAnchorName();
  const { ordered, anchorMissing } = orderNamesForWednesdays(sorted, anchor);
  const dates = sharingWednesdays(ordered.length, holidayIsos);
  const today = startOfLocalDay(new Date());
  const rows = ordered.map((name, i) => ({
    no: i + 1,
    name,
    date: dates[i] || addWeeks(SERIES_START, i),
  }));

  const futureOrToday = rows
    .map((r) => startOfLocalDay(r.date))
    .filter((d) => d >= today);
  const nextHighlight =
    futureOrToday.length > 0
      ? futureOrToday.reduce((a, b) => (a <= b ? a : b))
      : null;

  const ul = document.getElementById("schedule");
  ul.innerHTML = "";

  for (const r of rows) {
    const d0 = startOfLocalDay(r.date);
    const li = document.createElement("li");
    li.className = "row";
    if (nextHighlight && d0.getTime() === nextHighlight.getTime()) {
      li.classList.add("row--next");
      li.setAttribute("aria-current", "date");
    }
    li.innerHTML = `<span class="row__no">${r.no}</span><span class="row__date">${formatRowDate(r.date)}</span><span class="row__name">${escapeHtml(r.name)}</span>`;
    ul.appendChild(li);
  }

  if (typeof window.__weeklySharingSetScheduleForReminder === "function")
    window.__weeklySharingSetScheduleForReminder(rows);

  return { anchorMissing };
}

function formatFetchedAt() {
  const d = new Date();
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

async function fetchAndBuildSchedule(apiBase) {
  const { names, holidays } = await fetchRoster(apiBase);
  if (names.length === 0)
    throw new Error("Empty names list — seed DynamoDB pk=ROSTER");
  const { anchorMissing } = buildSchedule(names, holidays);
  const n = sortNamesAlpha(names).length;
  const lines = [
    `// loaded ${formatFetchedAt()} — refresh or refocus tab to pull latest`,
    "// next slot highlighted — Wednesdays follow roster A→Z, rotated so week 0 = series anchor",
    `// anchor: ${getSeriesAnchorName()} on ${formatRowDate(SERIES_START)} — ${n} names`,
  ];
  if (holidays.length > 0)
    lines.push(
      `// ${holidays.length} holiday(s) skip sharing — roster dates pushed forward`
    );
  if (anchorMissing)
    lines.unshift(
      `// roster has no "${getSeriesAnchorName()}" — using A→Z order for dates (fix name or WEEKLY_SHARING_SERIES_ANCHOR_NAME)`,
    );
  setSubtitle(lines, anchorMissing ? "subtitle--error" : null);
}

async function init() {
  const apiBase = normalizeApiBase(
    typeof window !== "undefined" ? window.WEEKLY_SHARING_API_BASE : "",
  );

  window.__weeklySharingReloadSchedule = async () => {
    const b = normalizeApiBase(
      typeof window !== "undefined" ? window.WEEKLY_SHARING_API_BASE : "",
    );
    if (!b) return;
    setSubtitle(["// reloading roster…"], "subtitle--muted");
    try {
      await fetchAndBuildSchedule(b);
    } catch (e) {
      console.error(e);
      setSubtitle(
        ["// reload failed", `// ${e.message || e}`],
        "subtitle--error",
      );
    }
  };

  if (!apiBase) {
    setSubtitle(
      [
        "// data: DynamoDB via GET /names",
        "// set window.WEEKLY_SHARING_API_BASE in web/api-config.js (Amplify: env API_BASE_URL)",
      ],
      "subtitle--error",
    );
    return;
  }

  if (typeof location !== "undefined" && location.protocol === "file:") {
    setSubtitle(
      [
        "// opened as file:// — use a local HTTP server instead of double‑clicking index.html",
        "// from repo root:",
        "//   python3 -m http.server 8080 --directory web",
        "// then open http://localhost:8080/  (api-config.js must list your API base URL)",
      ],
      "subtitle--error",
    );
    return;
  }

  setSubtitle(["// loading roster…"], "subtitle--muted");

  try {
    await fetchAndBuildSchedule(apiBase);
  } catch (e) {
    console.error(e);
    const msg = e && e.message ? String(e.message) : "Unknown error";
    const lines = ["// failed to load roster", `// ${msg}`];
    if (/failed to fetch/i.test(msg) || e instanceof TypeError) {
      lines.push(
        "// often: file:// (use http server), CORS on PUT until sam deploy, or extension — see api-config WEEKLY_SHARING_DEV_API_PROXY + sam/scripts/dev_http_server.py",
      );
    }
    lines.push("// check api-config.js URL, Lambda, CORS, and DynamoDB seed");
    setSubtitle(lines, "subtitle--error");
  }

  const refreshBtn = document.getElementById("roster-refresh");
  refreshBtn?.addEventListener("click", () => {
    if (typeof window.__weeklySharingReloadSchedule === "function") {
      refreshBtn.disabled = true;
      window
        .__weeklySharingReloadSchedule()
        .finally(() => {
          refreshBtn.disabled = false;
        });
    }
  });

  let lastVisibilityFetch = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    const now = Date.now();
    if (now - lastVisibilityFetch < 3000) return;
    lastVisibilityFetch = now;
    if (typeof window.__weeklySharingReloadSchedule === "function") {
      window.__weeklySharingReloadSchedule().catch(() => {});
    }
  });
}

init();
