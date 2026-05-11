/** First Wednesday maps to roster index 0 (Pang Yong Xian → 6 May when seeded in this order). */
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

async function fetchNames(apiBase) {
  const url = `${apiBase}/names`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data || !Array.isArray(data.names))
    throw new Error("Unexpected response shape");
  return data.names
    .filter((n) => typeof n === "string")
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildSchedule(names) {
  const today = startOfLocalDay(new Date());
  const rows = names.map((name, i) => ({
    name,
    date: addWeeks(SERIES_START, i),
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
    li.innerHTML = `<span class="row__date">${formatRowDate(r.date)}</span><span class="row__name">${escapeHtml(r.name)}</span>`;
    ul.appendChild(li);
  }
}

async function init() {
  const apiBase = normalizeApiBase(
    typeof window !== "undefined" ? window.WEEKLY_SHARING_API_BASE : ""
  );

  if (!apiBase) {
    setSubtitle(
      [
        "// data: DynamoDB via GET /names",
        "// set window.WEEKLY_SHARING_API_BASE in web/api-config.js (Amplify: env API_BASE_URL)",
      ],
      "subtitle--error"
    );
    return;
  }

  setSubtitle(["// loading roster…"], "subtitle--muted");

  try {
    const names = await fetchNames(apiBase);
    if (names.length === 0)
      throw new Error("Empty names list — seed DynamoDB pk=ROSTER");

    buildSchedule(names);
    setSubtitle(
      [
        "// next slot highlighted — roster from API",
        `// ${names.length} names · Wednesdays from series start`,
      ],
      null
    );
  } catch (e) {
    console.error(e);
    setSubtitle(
      [
        "// failed to load roster",
        `// ${e.message}`,
        "// check api-config.js URL, Lambda, CORS, and DynamoDB seed",
      ],
      "subtitle--error"
    );
  }
}

init();
