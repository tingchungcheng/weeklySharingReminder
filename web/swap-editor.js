(function () {
  const dialog = document.getElementById("swap-edit-modal");
  const openBtn = document.getElementById("swap-edit-open");
  const closeEls = dialog
    ? dialog.querySelectorAll("[data-swap-edit-close]")
    : [];
  const slotAEl = document.getElementById("swap-edit-slot-a");
  const slotBEl = document.getElementById("swap-edit-slot-b");
  const addBtn = document.getElementById("swap-edit-add");
  const listEl = document.getElementById("swap-edit-list");
  const saveBtn = document.getElementById("swap-edit-save");
  const statusEl = document.getElementById("swap-edit-status");

  let workingNames = [];
  let workingHolidays = [];
  let workingSwaps = [];
  let baseRows = [];

  function core() {
    return typeof window !== "undefined"
      ? window.__weeklySharingScheduleCore
      : null;
  }

  function normalizeApiBase(raw) {
    if (typeof raw !== "string") return "";
    return raw.trim().replace(/\/+$/, "");
  }

  function getAuthToken() {
    const auth = window.__weeklySharingAuth;
    if (!auth) return "";
    if (typeof auth.getIdToken === "function") {
      const idt = auth.getIdToken();
      if (typeof idt === "string" && idt.trim()) return idt.trim();
    }
    return "";
  }

  function canEdit() {
    const auth = window.__weeklySharingAuth;
    return !!(auth && auth.isAdmin);
  }

  function setStatus(text, isError) {
    if (!statusEl) return;
    statusEl.textContent = text || "";
    statusEl.classList.toggle("reminder-form__status--error", !!isError);
  }

  function formatSlotLabel(row) {
    const c = core();
    const dateStr = c ? c.formatRowDate(row.date) : String(row.date);
    return `No ${row.no} — ${row.name} — ${dateStr}`;
  }

  function swapKey(swap) {
    return `${swap.dateA}|${swap.dateB}`;
  }

  function rebuildBaseRows() {
    const c = core();
    if (!c || workingNames.length === 0) {
      baseRows = [];
      return;
    }
    const { rows } = c.buildBaseScheduleRows(workingNames, workingHolidays);
    baseRows = rows;
  }

  function fillSlotSelects() {
    const opts = baseRows.map((r) => {
      const enc = encodeURIComponent(JSON.stringify({ no: r.no }));
      return `<option value="${enc}">${formatSlotLabel(r)}</option>`;
    });
    const empty = '<option value="">— pick slot —</option>';
    if (slotAEl) slotAEl.innerHTML = empty + opts.join("");
    if (slotBEl) slotBEl.innerHTML = empty + opts.join("");
  }

  function findRowByNo(no) {
    return baseRows.find((r) => r.no === no);
  }

  function renderSwapList() {
    if (!listEl) return;
    const c = core();
    listEl.innerHTML = "";
    if (workingSwaps.length === 0) {
      const li = document.createElement("li");
      li.className = "roster-edit-holiday-row roster-edit-holiday-row--empty";
      li.textContent = "// no swaps";
      listEl.appendChild(li);
      return;
    }
    for (const swap of workingSwaps) {
      const rowA = baseRows.find((r) => c && c.toIsoDate(c.startOfLocalDay(r.date)) === swap.dateA);
      const rowB = baseRows.find((r) => c && c.toIsoDate(c.startOfLocalDay(r.date)) === swap.dateB);
      const labelA = rowA ? `No ${rowA.no}` : swap.dateA;
      const labelB = rowB ? `No ${rowB.no}` : swap.dateB;
      const li = document.createElement("li");
      li.className = "roster-edit-holiday-row";
      li.innerHTML = `<span class="roster-edit-holiday-row__date"></span><button type="button" class="roster-edit-holiday-row__del" data-key="${swapKey(swap)}" aria-label="Remove swap">×</button>`;
      li.querySelector(".roster-edit-holiday-row__date").textContent =
        `${labelA} ↔ ${labelB} (one-time)`;
      li.querySelector(".roster-edit-holiday-row__del").addEventListener("click", () => {
        const key = swapKey(swap);
        workingSwaps = workingSwaps.filter((s) => swapKey(s) !== key);
        renderSwapList();
        setStatus("", false);
      });
      listEl.appendChild(li);
    }
  }

  function parseSlotValue(raw) {
    if (!raw) return null;
    try {
      const o = JSON.parse(decodeURIComponent(raw));
      if (o && typeof o.no === "number") return o.no;
    } catch {
      /* ignore */
    }
    return null;
  }

  function onAddSwap() {
    const c = core();
    if (!c) {
      setStatus("// schedule not ready — reload page", true);
      return;
    }
    const noA = parseSlotValue(slotAEl?.value || "");
    const noB = parseSlotValue(slotBEl?.value || "");
    if (!noA || !noB) {
      setStatus("// pick two slots", true);
      return;
    }
    if (noA === noB) {
      setStatus("// pick two different slots", true);
      return;
    }
    const rowA = findRowByNo(noA);
    const rowB = findRowByNo(noB);
    if (!rowA || !rowB) {
      setStatus("// slot not found", true);
      return;
    }
    const dateA = c.toIsoDate(c.startOfLocalDay(rowA.date));
    const dateB = c.toIsoDate(c.startOfLocalDay(rowB.date));
    const swap = c.normalizeSwaps([{ dateA, dateB }])[0];
    if (!swap) {
      setStatus("// invalid swap", true);
      return;
    }
    const key = swapKey(swap);
    if (workingSwaps.some((s) => swapKey(s) === key)) {
      setStatus("// that swap already exists", true);
      return;
    }
    const usedDates = new Set();
    for (const s of workingSwaps) {
      usedDates.add(s.dateA);
      usedDates.add(s.dateB);
    }
    if (usedDates.has(swap.dateA) || usedDates.has(swap.dateB)) {
      setStatus("// a slot date is already in another swap", true);
      return;
    }
    workingSwaps.push(swap);
    workingSwaps = c.normalizeSwaps(workingSwaps);
    if (slotAEl) slotAEl.value = "";
    if (slotBEl) slotBEl.value = "";
    renderSwapList();
    setStatus("", false);
  }

  async function loadIntoEditor() {
    const apiBase = normalizeApiBase(window.WEEKLY_SHARING_API_BASE || "");
    if (!apiBase) {
      setStatus("Configure WEEKLY_SHARING_API_BASE first.", true);
      return;
    }
    setStatus("// loading…", false);
    try {
      const res = await fetch(`${apiBase}/names?_=${Date.now()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      workingNames = Array.isArray(data.names)
        ? data.names.filter((n) => typeof n === "string").map((s) => s.trim())
        : [];
      const c = core();
      workingHolidays = c
        ? c.normalizeHolidayIsos(
            Array.isArray(data.holidays) ? data.holidays : []
          )
        : [];
      workingSwaps = c
        ? c.normalizeSwaps(Array.isArray(data.swaps) ? data.swaps : [])
        : [];
      rebuildBaseRows();
      fillSlotSelects();
      renderSwapList();
      setStatus(
        "// swap two slots once — next roster cycle returns to normal order",
        false
      );
    } catch (e) {
      console.error(e);
      setStatus(String(e?.message || e), true);
    }
  }

  function openDialog() {
    if (!canEdit()) {
      setStatus("Admin role required.", true);
      return;
    }
    if (!dialog?.showModal) return;
    if (dialog.open) return;
    openBtn?.setAttribute("aria-expanded", "true");
    dialog.showModal();
    dialog.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => dialog.classList.add("reminder-modal--visible"));
    loadIntoEditor();
  }

  function closeDialog() {
    if (!dialog?.open) return;
    openBtn?.setAttribute("aria-expanded", "false");
    dialog.classList.remove("reminder-modal--visible");
    window.setTimeout(() => {
      if (dialog.open) dialog.close();
      dialog.setAttribute("aria-hidden", "true");
    }, 240);
  }

  async function onSave() {
    const apiBase = normalizeApiBase(window.WEEKLY_SHARING_API_BASE || "");
    const token = getAuthToken();
    if (!apiBase || !token) {
      setStatus("Login as admin to save.", true);
      return;
    }
    const c = core();
    const swaps = c ? c.normalizeSwaps(workingSwaps) : workingSwaps;
    setStatus("// saving…", false);
    if (saveBtn) saveBtn.disabled = true;
    try {
      const rosterRes = await fetch(`${apiBase}/names?_=${Date.now()}`, {
        cache: "no-store",
      });
      if (!rosterRes.ok) throw new Error(`HTTP ${rosterRes.status}`);
      const roster = await rosterRes.json();
      const names = Array.isArray(roster.names) ? roster.names : workingNames;
      const holidays = c
        ? c.normalizeHolidayIsos(
            Array.isArray(roster.holidays) ? roster.holidays : []
          )
        : [];
      const res = await fetch(`${apiBase}/roster`, {
        method: "PUT",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ names, holidays, swaps }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setStatus(`// saved ${data.swapCount ?? swaps.length} swap(s)`, false);
      if (typeof window.__weeklySharingReloadSchedule === "function")
        await window.__weeklySharingReloadSchedule();
      window.setTimeout(closeDialog, 600);
    } catch (e) {
      console.error(e);
      setStatus(String(e?.message || e), true);
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  openBtn?.addEventListener("click", openDialog);
  closeEls.forEach((el) => el.addEventListener("click", closeDialog));
  addBtn?.addEventListener("click", onAddSwap);
  saveBtn?.addEventListener("click", onSave);
  dialog?.addEventListener("close", () => {
    openBtn?.setAttribute("aria-expanded", "false");
    dialog.classList.remove("reminder-modal--visible");
    dialog.setAttribute("aria-hidden", "true");
  });

  window.addEventListener("weekly-sharing-auth-changed", () => {
    const ok = canEdit();
    if (openBtn) {
      openBtn.hidden = false;
      openBtn.disabled = !ok;
      openBtn.setAttribute("aria-disabled", ok ? "false" : "true");
      openBtn.title = ok
        ? "Swap two sharing slots once"
        : "Admin only: custom:admin must be true";
    }
    if (!ok && dialog?.open) closeDialog();
  });

  if (openBtn) {
    const ok = canEdit();
    openBtn.hidden = false;
    openBtn.disabled = !ok;
    openBtn.setAttribute("aria-disabled", ok ? "false" : "true");
  }
})();
