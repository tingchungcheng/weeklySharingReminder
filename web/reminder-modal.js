(function () {
  const overlay = document.getElementById("reminder-modal");
  const openBtn = document.getElementById("reminder-open");
  const closeEls = overlay
    ? overlay.querySelectorAll("[data-reminder-close]")
    : [];
  const form = document.getElementById("reminder-form");
  const nameInput = document.getElementById("reminder-name");
  const statusEl = document.getElementById("reminder-status");
  const btnGoogle = document.getElementById("reminder-cal-google");
  const btnOutlook = document.getElementById("reminder-cal-outlook");
  const btnIcs = document.getElementById("reminder-cal-ics");

  let scheduleRows = [];

  function setStatus(text, isError) {
    if (!statusEl) return;
    statusEl.textContent = text || "";
    statusEl.classList.toggle("reminder-form__status--error", !!isError);
  }

  function findScheduleRowByName(name) {
    const q = name.trim().toLowerCase();
    if (!q) return null;
    return scheduleRows.find((r) => r.name.trim().toLowerCase() === q) || null;
  }

  /** Tuesday 09:00 local, 30 min — day before sharing Wednesday */
  function reminderWindowForSharingDay(wedDate) {
    const start = new Date(wedDate);
    start.setDate(start.getDate() - 1);
    start.setHours(9, 0, 0, 0);
    const end = new Date(start);
    end.setMinutes(end.getMinutes() + 30);
    return { start, end };
  }

  function formatGoogleRange(start, end) {
    const f = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const h = String(d.getHours()).padStart(2, "0");
      const min = String(d.getMinutes()).padStart(2, "0");
      const s = String(d.getSeconds()).padStart(2, "0");
      return `${y}${m}${day}T${h}${min}${s}`;
    };
    return `${f(start)}/${f(end)}`;
  }

  function formatOutlookLocalIso(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const h = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    const s = String(d.getSeconds()).padStart(2, "0");
    return `${y}-${m}-${day}T${h}:${min}:${s}`;
  }

  function buildEventCopy(displayName, rosterName, sharingDate) {
    const sharingDateDisplay = sharingDate.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    const title = `Dept sharing prep — ${rosterName}`;
    const details = `Hi ${displayName}, your department sharing is tomorrow (${sharingDateDisplay}). Be prepare!`;
    return { title, details, sharingDateDisplay };
  }

  function resolveRowOrSetStatus() {
    const name = (nameInput?.value || "").trim();
    if (!name) {
      setStatus("Enter your name as it appears on the roster.", true);
      return null;
    }
    const row = findScheduleRowByName(name);
    if (!row) {
      setStatus(
        "No match on the roster — use the same spelling as the list above.",
        true
      );
      return null;
    }
    setStatus("", false);
    return row;
  }

  function openCalendar(kind) {
    const row = resolveRowOrSetStatus();
    if (!row) return;

    const { start, end } = reminderWindowForSharingDay(row.date);
    const { title, details, sharingDateDisplay } = buildEventCopy(
      nameInput.value.trim(),
      row.name,
      row.date
    );

    if (kind === "google") {
      const url = new URL("https://calendar.google.com/calendar/render");
      url.searchParams.set("action", "TEMPLATE");
      url.searchParams.set("text", title);
      url.searchParams.set("dates", formatGoogleRange(start, end));
      url.searchParams.set("details", details);
      window.open(url.toString(), "_blank", "noopener,noreferrer");
      return;
    }

    if (kind === "outlook") {
      const u = new URL("https://outlook.office.com/calendar/0/deeplink/compose");
      u.searchParams.set("path", "/calendar/action/compose");
      u.searchParams.set("rru", "addevent");
      u.searchParams.set("subject", title);
      u.searchParams.set("startdt", formatOutlookLocalIso(start));
      u.searchParams.set("enddt", formatOutlookLocalIso(end));
      u.searchParams.set("body", details);
      window.open(u.toString(), "_blank", "noopener,noreferrer");
      return;
    }

    if (kind === "ics") {
      const icsEsc = (t) =>
        String(t)
          .replace(/\\/g, "\\\\")
          .replace(/\n/g, "\\n")
          .replace(/;/g, "\\;")
          .replace(/,/g, "\\,");
      const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@weekly-sharing-reminder`;
      const dSt = new Date();
      const stamp =
        dSt.getUTCFullYear() +
        String(dSt.getUTCMonth() + 1).padStart(2, "0") +
        String(dSt.getUTCDate()).padStart(2, "0") +
        "T" +
        String(dSt.getUTCHours()).padStart(2, "0") +
        String(dSt.getUTCMinutes()).padStart(2, "0") +
        String(dSt.getUTCSeconds()).padStart(2, "0") +
        "Z";
      const range = formatGoogleRange(start, end).split("/");
      const dtStart = range[0];
      const dtEnd = range[1];
      const ics = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//weekly-sharing-reminder//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${dtStart}`,
        `DTEND:${dtEnd}`,
        `SUMMARY:${icsEsc(title)}`,
        `DESCRIPTION:${icsEsc(details)}`,
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n");

      const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "sharing-reminder.ics";
      a.click();
      URL.revokeObjectURL(a.href);
    }
  }

  function updateActionsEnabled() {
    const ok = scheduleRows.length > 0;
    [btnGoogle, btnOutlook, btnIcs].forEach((b) => {
      if (b) b.disabled = !ok;
    });
  }

  function openModal() {
    if (!overlay) return;
    if (typeof overlay.showModal !== "function") {
      alert("This browser does not support <dialog>. Use a current Chrome, Edge, Firefox, or Safari.");
      return;
    }
    if (overlay.open) return;
    openBtn?.setAttribute("aria-expanded", "true");
    overlay.showModal();
    overlay.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => overlay.classList.add("reminder-modal--visible"));
    nameInput?.focus();
  }

  function closeModal() {
    if (!overlay || !overlay.open) return;
    openBtn?.setAttribute("aria-expanded", "false");
    overlay.classList.remove("reminder-modal--visible");
    window.setTimeout(() => {
      if (overlay.open) overlay.close();
      overlay.setAttribute("aria-hidden", "true");
    }, 240);
  }

  function onFormSubmit(e) {
    e.preventDefault();
  }

  openBtn?.addEventListener("click", openModal);
  closeEls.forEach((el) => el.addEventListener("click", closeModal));
  form?.addEventListener("submit", onFormSubmit);
  btnGoogle?.addEventListener("click", () => openCalendar("google"));
  btnOutlook?.addEventListener("click", () => openCalendar("outlook"));
  btnIcs?.addEventListener("click", () => openCalendar("ics"));

  overlay?.addEventListener("close", () => {
    openBtn?.setAttribute("aria-expanded", "false");
    overlay.classList.remove("reminder-modal--visible");
    overlay.setAttribute("aria-hidden", "true");
  });

  window.__weeklySharingSetScheduleForReminder = function (rows) {
    scheduleRows = Array.isArray(rows) ? rows.slice() : [];
    updateActionsEnabled();
  };
})();
