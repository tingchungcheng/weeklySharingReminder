(function () {
  const STORAGE_KEY = "weekly-sharing-auth-tokens";
  const GUEST_KEY = "weekly-sharing-guest-mode";
  const GUEST_KEY_LEGACY = "weekly-sharing-guest-mode"; // was in localStorage
  const SKEW_MS = 30_000;

  const logoutBtn = document.getElementById("auth-logout");
  const gateEl = document.getElementById("auth-gate");
  const hintEl = document.getElementById("auth-hint");
  const statusEl = document.getElementById("auth-status");
  const formEl = document.getElementById("auth-form");
  const emailEl = document.getElementById("auth-email");
  const passwordEl = document.getElementById("auth-password");
  const passwordHoldBtn = document.getElementById("auth-password-hold");
  const codeWrapEl = document.getElementById("auth-code-wrap");
  const codeEl = document.getElementById("auth-code");
  const submitBtn = document.getElementById("auth-submit");
  const modeSignInBtn = document.getElementById("auth-mode-signin");
  const modeSignUpBtn = document.getElementById("auth-mode-signup");
  const guestBtn = document.getElementById("auth-guest");
  const rosterEditBtn = document.getElementById("roster-edit-open");
  const swapEditBtn = document.getElementById("swap-edit-open");
  let mode = "signin";
  let signupAwaitingCode = false;
  let awaitingNewPassword = false;
  let authSession = null;
  let toastRoot = null;

  function applyAuthTokens(result) {
    if (!result?.IdToken || !result?.AccessToken) {
      throw new Error("Login succeeded but tokens are missing.");
    }
    writeStoredTokens({
      idToken: result.IdToken,
      accessToken: result.AccessToken,
      refreshToken: result.RefreshToken || "",
    });
    showToast("Login successful.", false);
    if (typeof window.__weeklySharingReloadSchedule === "function") {
      window.__weeklySharingReloadSchedule().catch(() => {});
    }
  }

  function challengeHelpText(challenge) {
    switch (challenge) {
      case "NEW_PASSWORD_REQUIRED":
        return "Your account must set a new password (common after admin invite). Enter a new password below and submit again.";
      case "SMS_MFA":
      case "SOFTWARE_TOKEN_MFA":
        return "MFA is required for this account but this app does not support MFA yet. Disable MFA on the user in Cognito or use a non-MFA account.";
      case "MFA_SETUP":
        return "Cognito wants MFA setup before login. Complete MFA in the AWS Cognito console or disable MFA for this user.";
      default:
        return `Cognito returned challenge "${challenge}". This app only supports email + password login.`;
    }
  }

  function handleAuthChallenge(data) {
    const challenge = data?.ChallengeName;
    if (!challenge) return false;
    if (challenge === "NEW_PASSWORD_REQUIRED" && data.Session) {
      authSession = data.Session;
      awaitingNewPassword = true;
      if (hintEl) {
        hintEl.textContent =
          "// Temporary password detected — enter a new password and submit again.";
      }
      if (submitBtn) submitBtn.textContent = "set_new_password";
      setStatus(challengeHelpText(challenge), false);
      if (passwordEl) {
        passwordEl.value = "";
        passwordEl.focus();
      }
      return true;
    }
    throw new Error(challengeHelpText(challenge));
  }

  function cfg(key) {
    return typeof window !== "undefined" ? String(window[key] || "").trim() : "";
  }

  function b64urlToJson(tokenPart) {
    try {
      const p = tokenPart.replace(/-/g, "+").replace(/_/g, "/");
      const pad = "=".repeat((4 - (p.length % 4 || 4)) % 4);
      const raw = atob(p + pad);
      const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
      const text = new TextDecoder().decode(bytes);
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function jwtClaims(jwt) {
    if (typeof jwt !== "string") return null;
    const parts = jwt.split(".");
    if (parts.length < 2) return null;
    return b64urlToJson(parts[1]);
  }

  function isTokenExpired(jwt) {
    const c = jwtClaims(jwt);
    if (!c || typeof c.exp !== "number") return true;
    return c.exp * 1000 <= Date.now() + SKEW_MS;
  }

  function readStoredTokens() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      if (!parsed.idToken || !parsed.accessToken) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function writeStoredTokens(tokens) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
  }

  function clearTokens() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function getGuestMode() {
    try {
      if (sessionStorage.getItem(GUEST_KEY) === "1") return true;
      // One-time migration from older localStorage guest flag.
      if (localStorage.getItem(GUEST_KEY_LEGACY) === "1") {
        sessionStorage.setItem(GUEST_KEY, "1");
        localStorage.removeItem(GUEST_KEY_LEGACY);
        return true;
      }
    } catch {
      /* private mode */
    }
    return false;
  }

  function setGuestMode(v) {
    try {
      if (v) sessionStorage.setItem(GUEST_KEY, "1");
      else sessionStorage.removeItem(GUEST_KEY);
      localStorage.removeItem(GUEST_KEY_LEGACY);
    } catch {
      /* ignore */
    }
  }

  function parseBoolLike(v) {
    const s = String(v ?? "").trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes";
  }

  function getAuthState() {
    const stored = readStoredTokens();
    if (!stored) return { isAuthenticated: false, isAdmin: false };
    if (isTokenExpired(stored.idToken) || isTokenExpired(stored.accessToken)) {
      clearTokens();
      return { isAuthenticated: false, isAdmin: false };
    }
    const idClaims = jwtClaims(stored.idToken) || {};
    const accessClaims = jwtClaims(stored.accessToken) || {};
    const isAdmin = parseBoolLike(
      idClaims["custom:admin"] ?? accessClaims["custom:admin"]
    );
    const displayName = String(
      idClaims.name || idClaims.email || accessClaims.username || "signed-in user"
    );
    return {
      isAuthenticated: true,
      isAdmin,
      displayName,
      idToken: stored.idToken,
      accessToken: stored.accessToken,
      groups: [],
    };
  }

  function getRegion() {
    const explicit = cfg("WEEKLY_SHARING_COGNITO_REGION");
    if (explicit) return explicit;
    const domain = cfg("WEEKLY_SHARING_COGNITO_DOMAIN");
    const m = domain.match(/\.auth\.([a-z0-9-]+)\.amazoncognito\.com$/i);
    return m ? m[1] : "";
  }

  async function cognitoRequest(target, body) {
    const region = getRegion();
    const clientId = cfg("WEEKLY_SHARING_COGNITO_CLIENT_ID");
    if (!region || !clientId) {
      throw new Error(
        "Missing Cognito config. Set WEEKLY_SHARING_COGNITO_REGION and WEEKLY_SHARING_COGNITO_CLIENT_ID."
      );
    }
    const res = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": `AWSCognitoIdentityProviderService.${target}`,
      },
      body: JSON.stringify({ ClientId: clientId, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.__type || data.message) {
      const msg = data.message || data.__type || `HTTP ${res.status}`;
      throw new Error(String(msg).replace(/^.*#/, ""));
    }
    return data;
  }

  function setLocked(locked) {
    document.body.classList.toggle("auth-locked", locked);
    if (gateEl) gateEl.hidden = !locked;
  }

  function setStatus(text, isError) {
    if (!statusEl) return;
    statusEl.textContent = text || "";
    statusEl.classList.toggle("reminder-form__status--error", !!isError);
  }

  function setPasswordVisible(visible) {
    if (!passwordEl) return;
    passwordEl.type = visible ? "text" : "password";
    if (passwordHoldBtn) passwordHoldBtn.setAttribute("aria-pressed", visible ? "true" : "false");
  }

  function ensureToastRoot() {
    if (toastRoot) return toastRoot;
    toastRoot = document.createElement("div");
    toastRoot.className = "toast-stack";
    toastRoot.setAttribute("aria-live", "polite");
    document.body.appendChild(toastRoot);
    return toastRoot;
  }

  function showToast(text, isError) {
    const root = ensureToastRoot();
    const t = document.createElement("div");
    t.className = `toast${isError ? " toast--error" : ""}`;
    t.textContent = text;
    root.appendChild(t);
    window.setTimeout(() => {
      t.classList.add("toast--out");
      window.setTimeout(() => t.remove(), 280);
    }, 2500);
  }

  function setSubmitLoading(isLoading) {
    if (!submitBtn) return;
    submitBtn.disabled = !!isLoading;
    submitBtn.classList.toggle("reminder-cal-btn--loading", !!isLoading);
    if (isLoading) {
      submitBtn.innerHTML =
        '<span class="loading-dots" aria-hidden="true"><span></span><span></span><span></span></span><span class="sr-only">Loading</span>';
      return;
    }
    // Repaint normal label from current mode.
    if (mode === "signin") {
      submitBtn.textContent = "login";
    } else {
      submitBtn.textContent = signupAwaitingCode
        ? "verify_email_and_create"
        : "send_verification_code";
    }
  }

  function setMode(next) {
    mode = next;
    modeSignInBtn?.classList.toggle("auth-btn--active", mode === "signin");
    modeSignUpBtn?.classList.toggle("auth-btn--active", mode === "signup");

    if (mode === "signin") {
      signupAwaitingCode = false;
      awaitingNewPassword = false;
      authSession = null;
      submitBtn.textContent = "login";
      hintEl.textContent = "// Sign in to view the weekly sharing schedule.";
      if (codeWrapEl) codeWrapEl.hidden = true;
      if (codeEl) {
        codeEl.required = false;
        codeEl.value = "";
      }
    } else {
      submitBtn.textContent = signupAwaitingCode
        ? "verify_email_and_create"
        : "send_verification_code";
      hintEl.textContent = signupAwaitingCode
        ? "// Enter the verification code sent to your email to complete signup."
        : "// Sign up: first submit sends code; then enter code here and submit again.";
      if (codeWrapEl) codeWrapEl.hidden = false;
      if (codeEl) {
        codeEl.required = signupAwaitingCode;
        if (!signupAwaitingCode) codeEl.value = "";
      }
    }
    setStatus("", false);
    if (mode === "signup") codeEl?.focus();
    else emailEl?.focus();
  }

  async function doSignIn() {
    const email = (emailEl?.value || "").trim();
    const password = passwordEl?.value || "";
    if (!email || !password) throw new Error("Enter email and password.");

    if (awaitingNewPassword) {
      if (!authSession) {
        awaitingNewPassword = false;
        throw new Error("Password reset session expired. Sign in again.");
      }
      const data = await cognitoRequest("RespondToAuthChallenge", {
        ChallengeName: "NEW_PASSWORD_REQUIRED",
        Session: authSession,
        ChallengeResponses: {
          USERNAME: email,
          NEW_PASSWORD: password,
        },
      });
      awaitingNewPassword = false;
      authSession = null;
      if (handleAuthChallenge(data)) return;
      applyAuthTokens(data.AuthenticationResult || {});
      setMode("signin");
      return;
    }

    const data = await cognitoRequest("InitiateAuth", {
      AuthFlow: "USER_PASSWORD_AUTH",
      AuthParameters: { USERNAME: email, PASSWORD: password },
    });
    if (handleAuthChallenge(data)) return;
    applyAuthTokens(data.AuthenticationResult || {});
  }

  async function doSignUp() {
    const email = (emailEl?.value || "").trim();
    const password = passwordEl?.value || "";
    if (!email || !password) throw new Error("Enter email and password.");
    await cognitoRequest("SignUp", {
      Username: email,
      Password: password,
      UserAttributes: [{ Name: "email", Value: email }],
    });
    signupAwaitingCode = true;
    setStatus("Verification code sent. Check your email.", false);
    showToast("Verification code sent to your email.", false);
    setMode("signup");
  }

  async function doConfirm() {
    const email = (emailEl?.value || "").trim();
    const code = (codeEl?.value || "").trim();
    if (!email || !code) throw new Error("Enter email and verification code.");
    await cognitoRequest("ConfirmSignUp", {
      Username: email,
      ConfirmationCode: code,
    });
    signupAwaitingCode = false;
    setStatus("Email verified. You can now login.", false);
    showToast("Email verified successfully. Please login.", false);
    setMode("signin");
  }

  function paintAuthUi(state) {
    if (logoutBtn) logoutBtn.hidden = !state.isAuthenticated;
    setLocked(!state.isAuthenticated && !getGuestMode());

    if (rosterEditBtn) {
      rosterEditBtn.hidden = false;
      rosterEditBtn.disabled = !state.isAdmin;
      rosterEditBtn.setAttribute("aria-disabled", state.isAdmin ? "false" : "true");
      rosterEditBtn.title = state.isAdmin
        ? "Edit roster (DynamoDB)"
        : "Admin only: set custom:admin=true to enable";
    }
    if (swapEditBtn) {
      swapEditBtn.hidden = false;
      swapEditBtn.disabled = !state.isAdmin;
      swapEditBtn.setAttribute("aria-disabled", state.isAdmin ? "false" : "true");
      swapEditBtn.title = state.isAdmin
        ? "Swap two sharing slots once"
        : "Admin only: custom:admin must be true";
    }
  }

  function broadcast(state) {
    window.__weeklySharingAuth = {
      isAuthenticated: !!state.isAuthenticated,
      isAdmin: !!state.isAdmin,
      groups: state.groups || [],
      getIdToken() {
        const s = getAuthState();
        return s.idToken || "";
      },
      getAccessToken() {
        const s = getAuthState();
        return s.accessToken || "";
      },
    };
    window.dispatchEvent(
      new CustomEvent("weekly-sharing-auth-changed", {
        detail: {
          isAuthenticated: !!state.isAuthenticated,
          isAdmin: !!state.isAdmin,
        },
      })
    );
  }

  function refresh() {
    const state = getAuthState();
    paintAuthUi(state);
    broadcast(state);
    return state;
  }

  function configureActions() {
    modeSignInBtn?.addEventListener("click", () => setMode("signin"));
    modeSignUpBtn?.addEventListener("click", () => {
      signupAwaitingCode = false;
      setMode("signup");
    });

    formEl?.addEventListener("submit", async (e) => {
      e.preventDefault();
      setSubmitLoading(true);
      try {
        if (mode === "signin") {
          await doSignIn();
          if (!awaitingNewPassword) {
            setGuestMode(false);
            setStatus("", false);
            refresh();
          }
        } else {
          const hasCode = (codeEl?.value || "").trim().length > 0;
          if (signupAwaitingCode || hasCode) await doConfirm();
          else await doSignUp();
        }
      } catch (err) {
        const msg = String(err?.message || err);
        setStatus(msg, true);
        showToast(msg, true);
      } finally {
        setSubmitLoading(false);
      }
    });

    const pressStart = (e) => {
      e.preventDefault();
      setPasswordVisible(true);
    };
    const pressEnd = () => setPasswordVisible(false);

    passwordHoldBtn?.addEventListener("mousedown", pressStart);
    passwordHoldBtn?.addEventListener("touchstart", pressStart, { passive: false });
    passwordHoldBtn?.addEventListener("mouseup", pressEnd);
    passwordHoldBtn?.addEventListener("mouseleave", pressEnd);
    passwordHoldBtn?.addEventListener("touchend", pressEnd);
    passwordHoldBtn?.addEventListener("touchcancel", pressEnd);
    passwordHoldBtn?.addEventListener("keydown", (e) => {
      if (e.key === " " || e.key === "Enter") pressStart(e);
    });
    passwordHoldBtn?.addEventListener("keyup", (e) => {
      if (e.key === " " || e.key === "Enter") pressEnd();
    });
    passwordHoldBtn?.addEventListener("blur", pressEnd);

    logoutBtn?.addEventListener("click", () => {
      clearTokens();
      setGuestMode(false);
      setMode("signin");
      refresh();
      if (typeof window.__weeklySharingReloadSchedule === "function") {
        window.__weeklySharingReloadSchedule().catch(() => {});
      }
    });

    guestBtn?.addEventListener("click", () => {
      setGuestMode(true);
      setStatus("", false);
      showToast("Continuing as guest (read-only).", false);
      refresh();
      if (typeof window.__weeklySharingReloadSchedule === "function") {
        window.__weeklySharingReloadSchedule().catch(() => {});
      }
    });
  }

  configureActions();
  setMode("signin");
  refresh();
})();
