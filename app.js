/**
 * Temporary static roster. Later: fetch from API backed by DynamoDB.
 */
const NAMES = [
  "Peter",
  "Jason",
  "Sherry",
  "Naila",
  "Alex",
  "Jordan",
  "Sam",
  "Riley",
  "Casey",
  "Morgan",
  "Quinn",
  "Avery",
  "Blake",
  "Drew",
  "Jamie",
  "Skyler",
  "Reese",
  "Parker",
  "Cameron",
  "Devon",
];

/** First Wednesday in the rotation (local date). Adjust to match your kickoff week. */
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

function buildSchedule() {
  const today = startOfLocalDay(new Date());
  const rows = NAMES.map((name, i) => ({
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

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

buildSchedule();
