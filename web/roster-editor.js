(function () {
  const dialog = document.getElementById("roster-edit-modal");
  const openBtn = document.getElementById("roster-edit-open");
  const closeEls = dialog
    ? dialog.querySelectorAll("[data-roster-edit-close]")
    : [];
  const listEl = document.getElementById("roster-edit-list");
  const newInput = document.getElementById("roster-edit-new-name");
  const addBtn = document.getElementById("roster-edit-add");
  const saveBtn = document.getElementById("roster-edit-save");
  const statusEl = document.getElementById("roster-edit-status");

  let workingNames = [];

  function normalizeApiBase(raw) {
    if (typeof raw !== "string") return "";
    return raw.trim().replace(/\/+$/, "");
  }

  function isFileProtocolPage() {
    return (
      typeof location !== "undefined" && location.protocol === "file:"
    );
  }

  function explainFetchFailure(e) {
    const raw = String(e?.message || e);
    if (e instanceof TypeError || /failed to fetch/i.test(raw)) {
      return (
        "Failed to fetch — check: (1) URL bar is http://localhost… not file://; " +
        "(2) DevTools → Network: blocked / CORS on PUT = run sam deploy or use dev proxy (api-config WEEKLY_SHARING_DEV_API_PROXY + sam/scripts/dev_http_server.py); " +
        "(3) wrong API URL; offline; extension blocking execute-api."
      );
    }
    return raw;
  }

  function getAuthToken() {
    const auth = typeof window !== "undefined" ? window.__weeklySharingAuth : null;
    if (!auth) return "";
    // custom:* attributes are typically present on ID token claims.
    if (typeof auth.getIdToken === "function") {
      const idt = auth.getIdToken();
      if (typeof idt === "string" && idt.trim()) return idt.trim();
    }
    if (typeof auth.getAccessToken !== "function") return "";
    const t = auth.getAccessToken();
    return typeof t === "string" ? t.trim() : "";
  }

  function canEditRoster() {
    const auth = typeof window !== "undefined" ? window.__weeklySharingAuth : null;
    return !!(auth && auth.isAdmin);
  }

  function getAdminClaimForDebug() {
    const auth = typeof window !== "undefined" ? window.__weeklySharingAuth : null;
    if (!auth || typeof auth.getIdToken !== "function") return "";
    const jwt = auth.getIdToken();
    if (!jwt || typeof jwt !== "string") return "";
    const parts = jwt.split(".");
    if (parts.length < 2) return "";
    try {
      const p = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const pad = "=".repeat((4 - (p.length % 4 || 4)) % 4);
      const raw = atob(p + pad);
      const json = JSON.parse(raw);
      return String(json["custom:admin"] ?? json.custom_admin ?? "");
    } catch {
      return "";
    }
  }

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

  function setStatus(text, isError) {
    if (!statusEl) return;
    statusEl.textContent = text || "";
    statusEl.classList.toggle("reminder-form__status--error", !!isError);
  }

  function scrollAndHighlightAddedRow(highlightLowerKey) {
    if (!listEl || !highlightLowerKey) return;
    const row = [...listEl.querySelectorAll("li.roster-edit-row")].find(
      (li) => li.dataset.rosterLower === highlightLowerKey
    );
    if (!row) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" });

    const clearFlash = () => {
      row.classList.remove("roster-edit-row--flash");
    };

    requestAnimationFrame(() => {
      row.classList.add("roster-edit-row--flash");
      if (reduce) {
        window.setTimeout(clearFlash, 1400);
      } else {
        row.addEventListener("animationend", clearFlash, { once: true });
      }
    });
  }

  function renderList(highlightLowerKey) {
    if (!listEl) return;
    const sorted = sortNamesAlpha(workingNames);
    workingNames = sorted;
    listEl.innerHTML = "";
    sorted.forEach((name, index) => {
      const li = document.createElement("li");
      li.className = "roster-edit-row";
      li.dataset.rosterLower = name.toLowerCase();
      const enc = encodeURIComponent(name);
      li.innerHTML = `<span class="roster-edit-row__idx">${index + 1}</span><span class="roster-edit-row__name"></span><button type="button" class="roster-edit-row__del" data-name="${enc}" aria-label="Remove">×</button>`;
      li.querySelector(".roster-edit-row__name").textContent = name;
      const del = li.querySelector(".roster-edit-row__del");
      del.setAttribute("aria-label", `Remove ${name}`);
      del.addEventListener("click", () => {
        const raw = decodeURIComponent(del.getAttribute("data-name") || "");
        const low = raw.toLowerCase();
        workingNames = workingNames.filter((x) => x.toLowerCase() !== low);
        renderList();
        setStatus("", false);
      });
      listEl.appendChild(li);
    });

    if (highlightLowerKey) {
      requestAnimationFrame(() => scrollAndHighlightAddedRow(highlightLowerKey));
    }
  }

  async function loadRosterIntoEditor() {
    const apiBase = normalizeApiBase(window.WEEKLY_SHARING_API_BASE || "");
    if (!apiBase) {
      setStatus("Configure WEEKLY_SHARING_API_BASE first.", true);
      workingNames = [];
      renderList();
      return;
    }
    if (isFileProtocolPage()) {
      setStatus(
        "Cannot load roster from file:// — serve the web folder over http(s), e.g. python3 -m http.server 8080 --directory web then open http://localhost:8080/",
        true
      );
      workingNames = [];
      renderList();
      return;
    }

    setStatus("// loading…", false);
    try {
      const res = await fetch(`${apiBase}/names`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      workingNames = Array.isArray(data.names)
        ? data.names.filter((n) => typeof n === "string").map((s) => s.trim())
        : [];
      workingNames = sortNamesAlpha(workingNames);
      renderList();
      setStatus(
        "// names sorted A→Z in storage; on the main page, dates rotate from the series anchor on 6 May.",
        false
      );
    } catch (e) {
      console.error(e);
      setStatus(explainFetchFailure(e), true);
      workingNames = [];
      renderList();
    }
  }

  function openDialog() {
    if (!canEditRoster()) {
      setStatus("Admin role required to edit roster. Login with an admin account.", true);
      return;
    }
    if (!dialog || typeof dialog.showModal !== "function") {
      alert("This browser does not support <dialog>.");
      return;
    }
    if (dialog.open) return;
    openBtn?.setAttribute("aria-expanded", "true");
    dialog.showModal();
    dialog.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => dialog.classList.add("reminder-modal--visible"));
    loadRosterIntoEditor().then(() => newInput?.focus());
  }

  function closeDialog() {
    if (!dialog || !dialog.open) return;
    openBtn?.setAttribute("aria-expanded", "false");
    dialog.classList.remove("reminder-modal--visible");
    window.setTimeout(() => {
      if (dialog.open) dialog.close();
      dialog.setAttribute("aria-hidden", "true");
    }, 240);
  }

  function onAdd() {
    const t = (newInput?.value || "").trim();
    if (!t) return;
    const lower = t.toLowerCase();
    if (workingNames.some((n) => n.toLowerCase() === lower)) {
      setStatus("// already on list (case-insensitive)", true);
      return;
    }
    workingNames.push(t);
    newInput.value = "";
    renderList(lower);
    setStatus("", false);
  }

  async function onSave() {
    const apiBase = normalizeApiBase(window.WEEKLY_SHARING_API_BASE || "");
    const token = getAuthToken();
    if (!apiBase) {
      setStatus("API base not configured.", true);
      return;
    }
    if (!token) {
      setStatus(
        "Login required. Sign in with an admin account to save roster changes.",
        true
      );
      return;
    }
    if (isFileProtocolPage()) {
      setStatus(
        "Cannot save from file:// — use a local HTTP server (see loading error hint).",
        true
      );
      return;
    }
    const names = sortNamesAlpha(workingNames);
    if (names.length === 0) {
      setStatus("Add at least one name before saving.", true);
      return;
    }

    setStatus("// saving…", false);
    if (saveBtn) saveBtn.disabled = true;
    try {
      const res = await fetch(`${apiBase}/roster`, {
        method: "PUT",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ names }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) {
        const adminClaim = getAdminClaimForDebug();
        const suffix = adminClaim
          ? ` (token custom:admin=${adminClaim})`
          : " (token has no custom:admin claim)";
        throw new Error(
          `Admin role required${suffix}. If this should be admin, redeploy SAM so latest auth logic is live.`
        );
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setStatus(`// saved ${data.count ?? names.length} names`, false);
      if (typeof window.__weeklySharingReloadSchedule === "function")
        await window.__weeklySharingReloadSchedule();
      window.setTimeout(closeDialog, 600);
    } catch (e) {
      console.error(e);
      setStatus(explainFetchFailure(e), true);
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  openBtn?.addEventListener("click", openDialog);
  closeEls.forEach((el) => el.addEventListener("click", closeDialog));
  addBtn?.addEventListener("click", onAdd);
  newInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onAdd();
    }
  });
  saveBtn?.addEventListener("click", onSave);

  dialog?.addEventListener("close", () => {
    openBtn?.setAttribute("aria-expanded", "false");
    dialog.classList.remove("reminder-modal--visible");
    dialog.setAttribute("aria-hidden", "true");
  });

  window.addEventListener("weekly-sharing-auth-changed", () => {
    const ok = canEditRoster();
    if (openBtn) {
      openBtn.hidden = false;
      openBtn.disabled = !ok;
      openBtn.setAttribute("aria-disabled", ok ? "false" : "true");
      openBtn.title = ok
        ? "Edit roster (DynamoDB)"
        : "Admin only: custom:admin must be true";
    }
    if (!ok && dialog?.open) closeDialog();
  });

  if (openBtn) {
    const ok = canEditRoster();
    openBtn.hidden = false;
    openBtn.disabled = !ok;
    openBtn.setAttribute("aria-disabled", ok ? "false" : "true");
    openBtn.title = ok
      ? "Edit roster (DynamoDB)"
      : "Admin only: custom:admin must be true";
  }
})();
