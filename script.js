/* ==========================================================
   Meridian — frontend
   Talks to the backend over /api/*. No localStorage for
   auth/history anymore — the server is the source of truth.
   ========================================================== */

let currentUser = null;
let activeHistoryDetailId = null;

/* ---------- UX helpers: friendly errors, loading buttons, toast ---------- */
function friendlyError(e, fallback) {
  console.error(e); // full detail stays in the console for developers
  const m = String((e && e.message) || "");
  if (e instanceof TypeError || /failed to fetch|networkerror/i.test(m)) return "We couldn't reach Meridian. Check your connection and try again.";
  if (/\(401\)|sign in/i.test(m)) return "Your session has expired. Please sign in again.";
  if (/\(5\d\d\)|server error/i.test(m)) return "Something went wrong on our side. Please try again.";
  return /^Request failed/.test(m) || !m ? fallback : m;
}

async function withLoading(btn, label, fn) {
  if (!btn || btn.disabled) return;
  const original = btn.textContent;
  btn.disabled = true; btn.classList.add("is-loading"); btn.setAttribute("aria-busy", "true"); btn.textContent = label;
  try { return await fn(); }
  finally { btn.disabled = false; btn.classList.remove("is-loading"); btn.removeAttribute("aria-busy"); btn.textContent = original; }
}

let toastTimer;
const APP_VERSION = "6.0.0";
const APP_CACHE_NAME = `meridian-static-v${APP_VERSION}`;
let deferredInstallPrompt = null;
let serviceWorkerRegistration = null;
let shouldReloadAfterControllerChange = false;

function toast(msg, kind = "") {
  const t = document.getElementById("toast");
  t.textContent = msg; t.className = "toast" + (kind ? " " + kind : ""); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
}

function setNoticeVisible(id, visible) {
  const el = document.getElementById(id);
  if (!el) return;
  el.hidden = !visible;
}

document.addEventListener("click", e => {
  const dismissTarget = e.target.closest("[data-dismiss]");
  if (!dismissTarget) return;
  const targetId = dismissTarget.dataset.dismiss;
  if (targetId) setNoticeVisible(targetId, false);
});

function isStandaloneMode() {
  return window.matchMedia("(display-mode: standalone)").matches || Boolean(navigator.standalone);
}

function setNetworkNoticeState() {
  const offline = !navigator.onLine;
  setNoticeVisible("offlineNotice", offline);
  if (offline) {
    document.getElementById("offlineNotice")?.setAttribute("aria-live", "assertive");
  } else {
    document.getElementById("offlineNotice")?.removeAttribute("aria-live");
  }
}

function showInstallPrompt() {
  if (isStandaloneMode() || !deferredInstallPrompt) return;
  setNoticeVisible("installNotice", true);
}

function hideUpdateNotice() {
  setNoticeVisible("updateNotice", false);
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  try {
    serviceWorkerRegistration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });

    serviceWorkerRegistration.addEventListener("updatefound", () => {
      const installing = serviceWorkerRegistration.installing;
      if (!installing) return;

      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller && !shouldReloadAfterControllerChange) {
          setNoticeVisible("updateNotice", true);
        }
      });
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!shouldReloadAfterControllerChange) return;
      shouldReloadAfterControllerChange = false;
      window.location.reload();
    });

    if (navigator.serviceWorker.controller) {
      await serviceWorkerRegistration.update();
    }
  } catch (error) {
    console.warn("Service worker registration failed:", error);
  }
}

window.addEventListener("offline", () => setNetworkNoticeState());
window.addEventListener("online", () => setNetworkNoticeState());
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  showInstallPrompt();
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  setNoticeVisible("installNotice", false);
});

document.getElementById("updateAppBtn")?.addEventListener("click", async () => {
  if (!serviceWorkerRegistration || !serviceWorkerRegistration.waiting) {
    setNoticeVisible("updateNotice", false);
    return;
  }

  shouldReloadAfterControllerChange = true;
  setNoticeVisible("updateNotice", false);
  serviceWorkerRegistration.waiting.postMessage({ type: "SKIP_WAITING" });
});

document.getElementById("laterUpdateBtn")?.addEventListener("click", hideUpdateNotice);

document.getElementById("installAppBtn")?.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  if (choice.outcome === "accepted") {
    console.info("Meridian install accepted by user.");
  }
  deferredInstallPrompt = null;
  setNoticeVisible("installNotice", false);
});

/* ---------- tiny fetch helpers ---------- */
async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    credentials: "same-origin"
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/* ---------- view routing ---------- */
function setActiveNav(name, hash) {
  document.querySelectorAll(".site-header nav a").forEach(a => {
    const navKey = a.dataset.nav;
    const on =
      (name === "home" && !!hash && a.getAttribute("href") === hash) ||
      ((name === "history" || name === "history-detail") && navKey === "history") ||
      (name === "account" && navKey === "account") ||
      (name === "auth" && navKey === "auth");
    if (on) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

function showView(name, hash = "") {
  document.querySelectorAll(".view").forEach(v => {
    v.hidden = v.dataset.view !== name;
  });
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  setActiveNav(name, hash);
  if (name === "history") loadHistory();
  if (name === "account") loadAccount();
  if (name === "history-detail") {
    if (!activeHistoryDetailId) {
      showView("history");
      return;
    }
    loadHistoryDetail(activeHistoryDetailId);
  }
}

document.addEventListener("click", e => {
  const detailLink = e.target.closest("[data-history-id]");
  if (detailLink) {
    e.preventDefault();
    openHistoryDetail(detailLink.dataset.historyId);
    return;
  }

  const link = e.target.closest("[data-nav]");
  if (!link) return;
  const target = link.dataset.nav;
  const menuToggle = document.getElementById("navToggle");
  if (menuToggle) menuToggle.checked = false;
  const href = link.getAttribute("href") || "";

  if (target === "home" && href.startsWith("#") && href.length > 1) {
    e.preventDefault();
    showView("home", href);
    requestAnimationFrame(() => {
      document.getElementById(href.slice(1))?.scrollIntoView({ behavior: "smooth" });
    });
    return;
  }
  e.preventDefault();
  showView(target);
});

/* ---------- auth header ---------- */
function initials(name) {
  if (!name) return "?";
  return name.trim()[0].toUpperCase();
}

function renderAuthSlot() {
  const slot = document.getElementById("authSlot");
  if (!slot) return;

  if (!currentUser) {
    slot.innerHTML = `<a href="#" data-nav="auth" class="btn btn-ghost btn-small">Sign in</a>`;
    return;
  }

  slot.innerHTML = `
    <div class="auth-chip">
      ${currentUser.picture
        ? `<img src="${escapeHTML(currentUser.picture)}" alt="" class="auth-avatar">`
        : `<span class="auth-avatar-fallback">${escapeHTML(initials(currentUser.name))}</span>`}
      <span>${escapeHTML(currentUser.name || currentUser.username)}</span>
      <button class="btn-link" id="logoutBtn" type="button">Log out</button>
    </div>
  `;
  const logoutBtn = document.getElementById("logoutBtn");
  logoutBtn?.addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    currentUser = null;
    renderAuthSlot();
    showView("home");
  });
}

async function loadSession() {
  try {
    const data = await api("/api/auth/me");
    currentUser = data.user || null;
  } catch (e) {
    currentUser = null;
  }
  renderAuthSlot();
}

function getUrgencyLabel(urgency) {
  const labels = {
    selfcare: "Self-care",
    soon: "See doctor soon",
    same_day: "See doctor today",
    emergency: "Urgent care"
  };
  return labels[urgency] || (typeof urgency === "string" ? urgency : "Saved check");
}

function formatHistoryDate(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return { dateStr: "Unknown date", timeStr: "Unknown time" };
  }
  const dateStr = date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const timeStr = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return { dateStr, timeStr };
}

function openHistoryDetail(id) {
  const numericId = Number(id);
  if (!numericId) return;
  activeHistoryDetailId = numericId;
  showView("history-detail");
}

async function loadAccount() {
  const panel = document.getElementById("accountPanel");
  if (!panel) return;

  if (!currentUser) {
    panel.innerHTML = `
      <div class="auth-gate">
        <p>Sign in to view your account.</p>
        <button class="btn btn-primary" type="button" data-nav="auth">Sign in</button>
      </div>
    `;
    return;
  }

  panel.innerHTML = '<p class="status-line" role="status">Loading your account…</p>';

  try {
    const data = await api("/api/history");
    const entries = Array.isArray(data.entries) ? data.entries : [];
    const recent = entries.slice(0, 3);
    const newest = entries[0] ? new Date(entries[0].date) : null;
    const memberSince = new Date(currentUser.createdAt || currentUser.created_at || currentUser.created || Date.now());

    panel.innerHTML = `
      <section class="account-shell" aria-live="polite">
        <div class="account-profile-card">
          <div class="profile-header">
            <div class="profile-avatar-wrap">
              ${currentUser.picture
                ? `<img src="${escapeHTML(currentUser.picture)}" alt="" class="profile-avatar">`
                : `<span class="profile-avatar-fallback">${escapeHTML(initials(currentUser.name || currentUser.username))}</span>`}
            </div>
            <div>
              <h1>${escapeHTML(currentUser.name || currentUser.username || "Your account")}</h1>
              <p class="profile-username">@${escapeHTML(currentUser.username || "username")}</p>
            </div>
          </div>
        </div>

        <div class="account-stats">
          <article class="stat-card">
            <span class="stat-label">Saved checks</span>
            <strong class="stat-value">${entries.length}</strong>
          </article>
          <article class="stat-card">
            <span class="stat-label">Most recent check</span>
            <strong class="stat-value">${newest && !Number.isNaN(newest.getTime()) ? newest.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "No checks yet"}</strong>
          </article>
          <article class="stat-card">
            <span class="stat-label">Member since</span>
            <strong class="stat-value">${Number.isNaN(memberSince.getTime()) ? "Recently" : memberSince.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</strong>
          </article>
        </div>

        <section class="account-list-card">
          <div class="section-header-row">
            <h2>Recent checks</h2>
            <button class="btn btn-ghost btn-small" type="button" data-nav="history">View full history</button>
          </div>
          ${recent.length
            ? `<div class="account-recent-list">${recent.map(entry => {
                const when = formatHistoryDate(entry.date);
                const urgency = getUrgencyLabel(entry.urgency);
                const top = entry.topMatch && entry.topMatch.name ? escapeHTML(entry.topMatch.name) : (entry.redFlags && entry.redFlags.length ? "Red flag reported" : "No close match");
                return `
                  <article class="account-history-item">
                    <div>
                      <p class="account-item-date">${when.dateStr}</p>
                      <h3>${top}</h3>
                    </div>
                    <div class="account-item-meta">
                      <span class="urgency-badge urgency-${escapeHTML(entry.urgency)}">${escapeHTML(urgency)}</span>
                      <button class="btn btn-ghost btn-small" type="button" data-history-id="${entry.id}">View details</button>
                    </div>
                  </article>
                `;
              }).join("")}</div>`
            : `<div class="empty-card"><h2>No saved checks yet.</h2><p>Your most recent Meridian checks will appear here after you save one while signed in.</p></div>`}
        </section>
      </section>
    `;
  } catch (e) {
    panel.innerHTML = `
      <div class="empty-card">
        <p role="alert">${escapeHTML(friendlyError(e, "We couldn't load your account. Please try again."))}</p>
        <button class="btn btn-ghost" id="accountRetry" type="button">Try again</button>
      </div>
    `;
    document.getElementById("accountRetry")?.addEventListener("click", loadAccount);
  }
}

async function loadHistoryDetail(id) {
  const container = document.getElementById("historyDetailContainer");
  if (!container) return;

  if (!currentUser) {
    showView("history");
    return;
  }

  container.innerHTML = '<p class="status-line" role="status">Loading saved check…</p>';

  try {
    const data = await api(`/api/history/${id}`);
    const entry = data.entry;
    if (!entry) {
      container.innerHTML = `
        <div class="empty-card">
          <h2>Saved check not found.</h2>
          <p>This record may have been deleted or is no longer available.</p>
          <button class="btn btn-ghost" type="button" data-nav="history">Back to history</button>
        </div>
      `;
      return;
    }

    const date = formatHistoryDate(entry.date);
    const urgencyLabel = getUrgencyLabel(entry.urgency);
    const symptoms = Array.isArray(entry.symptoms) && entry.symptoms.length ? entry.symptoms : ["No symptoms recorded"];
    const redFlags = Array.isArray(entry.redFlags) && entry.redFlags.length ? entry.redFlags : ["No red flags recorded"];
    const duration = {
      today: "Started today",
      days: "A few days",
      week: "About a week",
      weeks: "More than two weeks"
    }[entry.duration] || "Not recorded";
    const severity = entry.severity ? `${entry.severity}/10` : "Not recorded";

    container.innerHTML = `
      <article class="history-detail-card" aria-live="polite">
        <p class="detail-kicker">Saved symptom check</p>
        <h1>Saved symptom check</h1>
        <p class="detail-summary">This past check records the information that was saved at the time. It is not a new analysis.</p>

        <div class="detail-meta-row">
          <div class="detail-meta-item">
            <span class="detail-label">Saved</span>
            <strong>${escapeHTML(date.dateStr)} at ${escapeHTML(date.timeStr)}</strong>
          </div>
          <div class="detail-meta-item">
            <span class="detail-label">Urgency</span>
            <strong><span class="urgency-badge urgency-${escapeHTML(entry.urgency)}">${escapeHTML(urgencyLabel)}</span></strong>
          </div>
        </div>

        <div class="detail-section">
          <h2>Recorded details</h2>
          <dl class="detail-list-grid">
            <div>
              <dt>Symptoms</dt>
              <dd>${escapeHTML(symptoms.join(", "))}</dd>
            </div>
            <div>
              <dt>Red flags</dt>
              <dd>${escapeHTML(redFlags.join(", "))}</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>${escapeHTML(duration)}</dd>
            </div>
            <div>
              <dt>Severity</dt>
              <dd>${escapeHTML(severity)}</dd>
            </div>
          </dl>
        </div>

        ${entry.topMatch && entry.topMatch.name ? `
          <div class="detail-section">
            <h2>Possible match recorded</h2>
            <p>This past check had symptoms that overlapped with <strong>${escapeHTML(entry.topMatch.name)}</strong>.</p>
            <p class="detail-note">Past checks show the information saved at the time. They are not re-analyzed when Meridian's analysis system changes.</p>
          </div>
        ` : `
          <div class="detail-section">
            <h2>Possible match recorded</h2>
            <p>No condition match was stored for this past check.</p>
          </div>
        `}

        <div class="detail-actions">
          <button class="btn btn-ghost" type="button" id="historyDetailBack">Back to history</button>
          <button class="btn btn-danger" type="button" id="historyDetailDelete">Delete this check</button>
        </div>
      </article>
    `;

    document.getElementById("historyDetailBack")?.addEventListener("click", () => showView("history"));
    document.getElementById("historyDetailDelete")?.addEventListener("click", () => deleteHistoryRecord(entry.id));
  } catch (e) {
    container.innerHTML = `
      <div class="empty-card">
        <p role="alert">${escapeHTML(friendlyError(e, "We couldn't load this saved check. Please try again."))}</p>
        <div class="detail-actions compact">
          <button class="btn btn-ghost" type="button" data-nav="history">Back to history</button>
          <button class="btn btn-primary" type="button" id="historyDetailRetry">Try again</button>
        </div>
      </div>
    `;
    document.getElementById("historyDetailRetry")?.addEventListener("click", () => loadHistoryDetail(id));
  }
}

async function deleteHistoryRecord(id) {
  const btn = document.getElementById("historyDetailDelete");
  await withLoading(btn, "Deleting…", async () => {
    try {
      await api(`/api/history/${id}`, { method: "DELETE" });
      toast("Saved check deleted.");
      activeHistoryDetailId = null;
      showView("history");
      loadAccount();
    } catch (e) {
      toast(friendlyError(e, "We couldn't delete this check. Please try again."), "error");
    }
  });
}

/* ---------- auth tabs ---------- */
document.querySelectorAll(".auth-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    const target = tab.dataset.tab;
    document.querySelectorAll(".auth-panel").forEach(p => (p.hidden = p.dataset.panel !== target));
  });
});

/* ---------- username signup / login ---------- */
function bindAuthForm(formId, errId, url, loadingLabel, fallback, getBody, validate) {
  const form = document.getElementById(formId);
  const errEl = document.getElementById(errId);
  if (!form || !errEl) return;

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = e.currentTarget.querySelector("button[type=submit]");
    errEl.hidden = true;
    const problem = validate();
    if (problem) { errEl.textContent = problem; errEl.hidden = false; return; }
    await withLoading(btn, loadingLabel, async () => {
      try {
        const data = await api(url, { method: "POST", body: JSON.stringify(getBody()) });
        currentUser = data.user;
        renderAuthSlot();
        showView("home");
        toast(`Welcome, ${currentUser.name || currentUser.username}.`);
      } catch (err) {
        errEl.textContent = friendlyError(err, fallback);
        errEl.hidden = false;
      }
    });
  });
}
const val = id => document.getElementById(id).value;
bindAuthForm("signupForm", "signupError", "/api/auth/signup", "Creating account…",
  "We couldn't create your account. Please try again.",
  () => ({ name: val("suName").trim(), username: val("suUsername").trim(), password: val("suPassword") }),
  () => !val("suName").trim() ? "Enter your name."
    : !/^[A-Za-z0-9_]{3,24}$/.test(val("suUsername").trim()) ? "Username must be 3–24 characters: letters, numbers, or underscore."
    : val("suPassword").length < 6 ? "Password must be at least 6 characters." : "");
bindAuthForm("loginForm", "loginError", "/api/auth/login", "Signing you in…",
  "We couldn't sign you in. Please try again.",
  () => ({ username: val("liUsername").trim(), password: val("liPassword") }),
  () => (!val("liUsername").trim() || !val("liPassword")) ? "Enter your username and password." : "");

setNetworkNoticeState();
registerServiceWorker();

/* ==========================================================
   Symptom analysis integration (Phase 4B)
   Unified deterministic engine: MeridianAnalysis.analyze()
   ========================================================== */
const rfText = id => (window.MeridianAnalysis && MeridianAnalysis.RED_FLAG_TEXT[id]) || id;

const panels = document.querySelectorAll(".panel-step");
const railItems = document.querySelectorAll(".rail-steps li");

function showPanel(n) {
  const rn = n === "chat" ? 1 : n;
  panels.forEach(p => p.hidden = p.dataset.panel !== String(n));
  railItems.forEach(li => {
    const step = Number(li.dataset.step);
    li.classList.toggle("rail-active", step === rn);
    li.classList.toggle("rail-done", step < rn);
    if (step === rn) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
  });
  document.getElementById("check").scrollIntoView({ behavior: "smooth", block: "start" });
  const heading = document.querySelector(`.panel-step[data-panel="${n}"] h2`);
  if (heading) heading.focus({ preventScroll: true });
}

function selectedSymptomKeys() {
  return Array.from(document.querySelectorAll("#symptomGroups input[type=checkbox]:checked")).map(el => el.dataset.key);
}
function selectedSymptomLabels() {
  return Array.from(document.querySelectorAll("#symptomGroups input[type=checkbox]:checked")).map(el => el.closest("label").textContent.trim());
}
function selectedRedFlags() {
  return Array.from(document.querySelectorAll("#redflagList input[type=checkbox]:checked")).map(el => el.dataset.rf);
}

function updateSelectionCount() {
  const n = selectedSymptomKeys().length;
  document.getElementById("selectionCount").textContent = n === 1 ? "1 symptom selected" : `${n} symptoms selected`;
}
document.getElementById("symptomGroups").addEventListener("change", updateSelectionCount);

document.getElementById("toStep2").addEventListener("click", () => {
  if (selectedSymptomKeys().length === 0 && selectedRedFlags().length === 0) {
    const msg = document.getElementById("symptomError");
    msg.textContent = "Select at least one symptom to continue — or a red-flag item if that applies.";
    msg.hidden = false;
    msg.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  showPanel(2);
});
document.getElementById("backTo1").addEventListener("click", () => showPanel(1));
document.getElementById("backTo2").addEventListener("click", () => showPanel(checkMode === "chat" ? "chat" : 2));
document.getElementById("severity").addEventListener("input", e => {
  document.getElementById("severityOut").textContent = e.target.value;
});
document.getElementById("check").addEventListener("change", e => {
  if (e.target.matches("#symptomGroups input, #redflagList input")) document.getElementById("symptomError").hidden = true;
});
document.getElementById("age").addEventListener("input", e => {
  document.getElementById("ageError").hidden = true; e.target.removeAttribute("aria-invalid");
});
document.getElementById("toStep3").addEventListener("click", async e => {
  const age = document.getElementById("age"), err = document.getElementById("ageError");
  const v = age.value.trim(), n = Number(v);
  if (!v || !Number.isInteger(n) || n < 1 || n > 120) {
    err.textContent = v ? "Enter a whole number between 1 and 120." : "Enter your age to continue.";
    err.hidden = false; age.setAttribute("aria-invalid", "true"); age.focus();
    return;
  }
  await withLoading(e.currentTarget, "Checking your symptoms…", async () => {
    checkMode = "manual";
    const saving = renderResults();
    showPanel(3);
    await saving;
  });
});
document.getElementById("restart").addEventListener("click", () => {
  document.querySelectorAll("#symptomGroups input, #redflagList input").forEach(el => el.checked = false);
  document.getElementById("duration").value = "days";
  document.getElementById("severity").value = 5;
  document.getElementById("severityOut").textContent = "5";
  document.getElementById("age").value = "";
  document.getElementById("ageError").hidden = true;
  document.getElementById("symptomError").hidden = true;
  updateSelectionCount();
  chatReset();
  showPanel(checkMode === "chat" ? "chat" : 1);
});

async function saveHistory(entry) {
  if (!currentUser) return; // not signed in — nothing to attach it to
  try { await api("/api/history", { method: "POST", body: JSON.stringify(entry) }); toast("Saved to your history."); }
  catch (e) { console.warn("Could not save history:", e.message); toast("We couldn't save this check to your history.", "error"); }
}

function manualInput() {
  const ageVal = document.getElementById("age").value.trim();
  const ageNum = parseInt(ageVal, 10);
  return {
    redFlags: selectedRedFlags(),
    keys: selectedSymptomKeys(),
    labels: selectedSymptomLabels(),
    duration: document.getElementById("duration").value,
    severity: Number(document.getElementById("severity").value),
    age: !isNaN(ageNum) && ageNum >= 1 && ageNum <= 120 ? ageNum : null,
    temp: null,
    denied: [],
    other: [],
    notes: []
  };
}

/* Shared results generator for BOTH Chat and Manual modes.
   Uses MeridianAnalysis.analyze(assessment) as the single source of truth. */
function renderResults(assessment = manualInput()) {
  const result = window.MeridianAnalysis ? MeridianAnalysis.analyze(assessment) : null;
  const area = document.getElementById("resultsArea");
  area.innerHTML = "";

  if (!result) {
    area.innerHTML = `<p class="inline-msg" role="alert">Analysis engine could not be loaded. Please refresh the page and try again.</p>`;
    return;
  }

  // RED FLAGS / EMERGENCY RESULTS HAVE PRIORITY
  if (result.urgency === "emergency") {
    const flagTexts = (result.redFlags && result.redFlags.length)
      ? result.redFlags.map(f => f.text || rfText(f.id || f)).join("; ")
      : "urgent red-flag symptoms";

    let emergencyHtml = `
      <div class="result-banner emergency" role="alert">
        <div>
          <h3>${escapeHTML(result.urgencyLabel || "Needs urgent, in-person care")}</h3>
          <p><strong>${escapeHTML(result.nextStep)}</strong></p>
          ${result.urgencyReasons && result.urgencyReasons.length ? `
            <ul class="urgency-reasons">
              ${result.urgencyReasons.map(r => `<li>${escapeHTML(r.text)}</li>`).join("")}
            </ul>
          ` : `<p>You flagged: ${escapeHTML(flagTexts)}.</p>`}
        </div>
      </div>

      <div class="emergency-notice">
        <p>${escapeHTML(result.summary)}</p>
      </div>
    `;

    if (result.emergencySigns && result.emergencySigns.length) {
      emergencyHtml += `
        <div class="emergency-signs-box" role="region" aria-label="Emergency warning signs">
          <h4>Key warning signs that need immediate emergency care</h4>
          <ul>
            ${result.emergencySigns.map(sign => `<li>${escapeHTML(sign)}</li>`).join("")}
          </ul>
        </div>
      `;
    }

    if (result.seekHelpIf && result.seekHelpIf.length) {
      emergencyHtml += `
        <div class="results-section">
          <h3>Immediate safety guidance</h3>
          <ul class="guidance-list">
            ${result.seekHelpIf.map(item => `<li>${escapeHTML(item)}</li>`).join("")}
          </ul>
        </div>
      `;
    }

    emergencyHtml += `
      <p class="results-footnote">${escapeHTML(result.disclaimer)}</p>
      ${!currentUser ? `<p class="results-footnote"><a href="#" data-nav="auth">Sign in</a> to save this to your history.</p>` : ""}
    `;

    area.innerHTML = emergencyHtml;

    return saveHistory({
      urgency: "emergency",
      redFlags: (result.redFlags || []).map(f => f.text || rfText(f.id || f)),
      symptoms: result.facts ? result.facts.labels : [],
      duration: (result.facts && result.facts.duration) ? result.facts.duration.code : null,
      severity: (result.facts && result.facts.severity) ? result.facts.severity.value : null,
      topMatch: null
    });
  }

  // STANDARD / NON-EMERGENCY RESULTS
  let html = `
    <div class="result-banner ${escapeHTML(result.urgency)}">
      <div>
        <h3>${escapeHTML(result.urgencyLabel)}</h3>
        <p>${escapeHTML(result.nextStep)}</p>
        ${result.urgencyReasons && result.urgencyReasons.length ? `
          <ul class="urgency-reasons">
            ${result.urgencyReasons.map(r => `<li>${escapeHTML(r.text)}</li>`).join("")}
          </ul>
        ` : ""}
      </div>
    </div>
  `;

  // Summary of reported facts
  const facts = result.facts || {};
  html += `
    <div class="results-facts" aria-label="Summary of reported symptoms and details">
      <h3 class="facts-title">Based on what you told us</h3>
      <div class="facts-grid">
        <div class="fact-item">
          <span class="fact-label">Reported symptoms</span>
          <span class="fact-val">${escapeHTML((facts.labels && facts.labels.length) ? facts.labels.join(", ") : "None reported")}</span>
        </div>
        ${facts.duration ? `
          <div class="fact-item">
            <span class="fact-label">Duration</span>
            <span class="fact-val">${escapeHTML(facts.duration.label)}</span>
          </div>
        ` : ""}
        ${facts.severity ? `
          <div class="fact-item">
            <span class="fact-label">Severity</span>
            <span class="fact-val">${facts.severity.value}/10 (${escapeHTML(facts.severity.band)})</span>
          </div>
        ` : ""}
        ${facts.temp ? `
          <div class="fact-item">
            <span class="fact-label">Temperature</span>
            <span class="fact-val">${escapeHTML(facts.temp.text)}</span>
          </div>
        ` : ""}
        ${facts.age ? `
          <div class="fact-item">
            <span class="fact-label">Age</span>
            <span class="fact-val">${facts.age.value} years</span>
          </div>
        ` : ""}
        ${facts.deniedLabels && facts.deniedLabels.length ? `
          <div class="fact-item">
            <span class="fact-label">Reported absent</span>
            <span class="fact-val">${escapeHTML(facts.deniedLabels.join(", "))}</span>
          </div>
        ` : ""}
      </div>
    </div>
  `;

  // Pattern matches or no-match state
  html += `<div class="results-section">
    <h3 class="results-heading">What this may fit with</h3>
    <p class="results-sub">${escapeHTML(result.summary)}</p>
  `;

  if (result.matches && result.matches.length > 0) {
    html += result.matches.map(m => `
      <div class="result-card">
        <div class="result-card-header">
          <h4>${escapeHTML(m.name)}</h4>
          <span class="strength-badge strength-${escapeHTML(m.strength)}">${escapeHTML(m.strength)} fit</span>
        </div>
        <p><strong>Why it may fit:</strong> ${escapeHTML(m.explanation)}</p>
        <p><strong>What's uncertain:</strong> ${escapeHTML(m.uncertainty)}</p>
        <p><strong>Self-care and guidance:</strong> ${escapeHTML(m.advice)} ${escapeHTML(m.whenToSeekCare)}</p>
      </div>
    `).join("");
  } else {
    html += `
      <div class="result-card no-match-card">
        <h4>No close pattern match found</h4>
        <p>Your combination of symptoms didn't closely overlap with a common pattern in Meridian's list. That doesn't mean nothing is going on — many conditions share similar symptoms or have causes that need in-person clinical assessment and tests to identify.</p>
      </div>
    `;
  }
  html += `</div>`;

  // Other or unexplained symptoms
  const unexplained = facts.unexplainedLabels || [];
  const otherItems = facts.other || [];
  if (unexplained.length || otherItems.length) {
    const combinedNotes = [
      ...unexplained.map(u => `${u} (not fully covered by these patterns)`),
      ...otherItems.map(o => `${o} (outside checker patterns)`)
    ];
    html += `
      <div class="unexplained-box">
        <p><strong>Other symptoms noted:</strong> ${escapeHTML(combinedNotes.join(", "))}. Meridian doesn't evaluate these directly, so be sure to mention them if you speak with a clinician.</p>
      </div>
    `;
  }

  // Guidance sections: What you can do now, What to watch for, When to seek care
  if (result.selfCare && result.selfCare.length) {
    html += `
      <div class="results-section">
        <h3>What you can do now</h3>
        <ul class="guidance-list">
          ${result.selfCare.map(item => `<li>${escapeHTML(item)}</li>`).join("")}
        </ul>
      </div>
    `;
  }

  if (result.monitor && result.monitor.length) {
    html += `
      <div class="results-section">
        <h3>What to watch for</h3>
        <ul class="guidance-list">
          ${result.monitor.map(item => `<li>${escapeHTML(item)}</li>`).join("")}
        </ul>
      </div>
    `;
  }

  if (result.seekHelpIf && result.seekHelpIf.length) {
    html += `
      <div class="results-section">
        <h3>When to seek care</h3>
        <ul class="guidance-list">
          ${result.seekHelpIf.map(item => `<li>${escapeHTML(item)}</li>`).join("")}
        </ul>
      </div>
    `;
  }

  // Emergency signs box for safety awareness
  if (result.emergencySigns && result.emergencySigns.length) {
    html += `
      <div class="emergency-signs-box" role="region" aria-label="Emergency warning signs">
        <h4>Emergency signs to keep in mind</h4>
        <p>Seek emergency care immediately if you develop any of these warning signs:</p>
        <ul>
          ${result.emergencySigns.map(sign => `<li>${escapeHTML(sign)}</li>`).join("")}
        </ul>
      </div>
    `;
  }

  // Footnote and disclaimer
  html += `
    <p class="results-footnote">${escapeHTML(result.disclaimer)} This symptom check is for educational purposes only and cannot replace professional medical advice, examination, or diagnosis.</p>
    ${!currentUser ? `<p class="results-footnote"><a href="#" data-nav="auth">Sign in</a> to save this to your history.</p>` : ""}
  `;

  area.innerHTML = html;

  return saveHistory({
    urgency: result.urgency,
    redFlags: [],
    symptoms: facts.labels || [],
    duration: facts.duration ? facts.duration.code : null,
    severity: facts.severity ? facts.severity.value : null,
    topMatch: result.matches && result.matches[0] ? { name: result.matches[0].name, pct: null } : null
  });
}

/* ---------- history view ---------- */
async function loadHistory() {
  const gate = document.getElementById("historyGate");
  const list = document.getElementById("historyList");
  const actions = document.querySelector(".history-actions");

  if (!currentUser) {
    gate.hidden = false; list.hidden = true; actions.hidden = true;
    return;
  }
  gate.hidden = true; list.hidden = false; actions.hidden = true;
  list.setAttribute("aria-busy", "true");
  list.innerHTML = '<p class="status-line" role="status">Loading your history…</p>';

  try {
    const data = await api("/api/history");
    const entries = Array.isArray(data.entries) ? data.entries : [];
    if (entries.length === 0) {
      list.innerHTML = `
        <div class="empty-card">
          <h2>No saved checks yet.</h2>
          <p>Your saved Meridian checks will appear here after you complete one while signed in.</p>
          <a href="#check" data-nav="home" class="btn btn-primary">Start a check</a>
        </div>
      `;
    } else {
      list.innerHTML = entries.map(renderHistoryRow).join("");
      actions.hidden = false;
    }
  } catch (e) {
    list.innerHTML = `
      <div class="empty-card">
        <p role="alert">${escapeHTML(friendlyError(e, "We couldn't load your history. Please try again."))}</p>
        <button class="btn btn-ghost" id="historyRetry" type="button">Try again</button>
      </div>
    `;
    document.getElementById("historyRetry")?.addEventListener("click", loadHistory);
  }
  list.removeAttribute("aria-busy");
}

const clearDialog = document.getElementById("clearDialog");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const clearCancelBtn = document.getElementById("clearCancel");
const clearConfirmBtn = document.getElementById("clearConfirm");

if (clearHistoryBtn && clearDialog) clearHistoryBtn.addEventListener("click", () => clearDialog.showModal());
if (clearCancelBtn && clearDialog) clearCancelBtn.addEventListener("click", () => clearDialog.close());
if (clearConfirmBtn && clearDialog) clearConfirmBtn.addEventListener("click", e => withLoading(e.currentTarget, "Clearing…", async () => {
  try {
    await api("/api/history", { method: "DELETE" });
    clearDialog.close();
    toast("History cleared.");
    activeHistoryDetailId = null;
    loadHistory();
    loadAccount();
  } catch (err) {
    clearDialog.close();
    toast(friendlyError(err, "We couldn't clear your history. Please try again."), "error");
  }
}));

function renderHistoryRow(entry) {
  const when = formatHistoryDate(entry.date);
  const urgencyLabel = getUrgencyLabel(entry.urgency);
  const top = entry.topMatch && entry.topMatch.name ? `Possible match: ${entry.topMatch.name}` : (entry.redFlags && entry.redFlags.length ? "Red flag reported" : "No close match");
  const detail = entry.redFlags && entry.redFlags.length ? entry.redFlags.join("; ") : (entry.symptoms || []).join(", ") || "No symptoms recorded";
  const severityText = entry.severity ? `Severity ${entry.severity}/10` : "Severity not recorded";
  const durationText = {
    today: "Started today",
    days: "A few days",
    week: "About a week",
    weeks: "More than two weeks"
  }[entry.duration] || "Duration not recorded";

  return `
    <article class="history-row">
      <div class="history-date">${escapeHTML(when.dateStr)}<span>${escapeHTML(when.timeStr)}</span></div>
      <div class="history-body">
        <div class="history-body-top">
          <span class="urgency-badge urgency-${escapeHTML(entry.urgency)}">${escapeHTML(urgencyLabel)}</span>
          <button class="btn btn-ghost btn-small history-detail-link" type="button" data-history-id="${entry.id}">View details</button>
        </div>
        <h4>${escapeHTML(top)}</h4>
        <p>${escapeHTML(detail)}</p>
        <p class="history-meta">${escapeHTML(severityText)} · ${escapeHTML(durationText)}</p>
      </div>
    </article>
  `;
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : str;
  return div.innerHTML;
}

/* ==========================================================
   Phase 3 — conversational checker (UI)
   The conversation engine lives in chat.js; results go through
   the same renderResults() / saveHistory() as the checklist.
   ========================================================== */
let checkMode = "chat";
const chat = { s: null, busy: false };
const chatLog = document.getElementById("chatLog");
const chatInput = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSendBtn");
const chatStatus = document.getElementById("chatStatus");

function addMsg(who, parts, extra) {
  const d = document.createElement("div");
  d.className = "msg msg-" + who;
  d.innerHTML = `<span class="msg-who">${who === "user" ? "You" : "Meridian"}</span>` +
    parts.filter(Boolean).map(t => `<p>${escapeHTML(t)}</p>`).join("");
  if (extra) d.appendChild(extra);
  chatLog.appendChild(d);
  chatLog.scrollTop = chatLog.scrollHeight;
  return d;
}

function quickBox(q) {
  const box = document.createElement("div");
  box.className = "quick";
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", "Quick answers");
  const picked = new Set();
  let go = null;
  (q.options || []).forEach(o => {
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "quick-btn"; btn.textContent = o.label;
    if (q.multi) {
      btn.setAttribute("aria-pressed", "false");
      btn.addEventListener("click", () => {
        picked.has(o.value) ? picked.delete(o.value) : picked.add(o.value);
        btn.setAttribute("aria-pressed", String(picked.has(o.value)));
        go.textContent = picked.size ? "Continue" : q.none;
      });
    } else {
      btn.addEventListener("click", () => o.value === "__manual" ? startManual() : sendChat({ text: o.label, value: o.value }));
    }
    box.appendChild(btn);
  });
  if (q.multi) {
    go = document.createElement("button");
    go.type = "button"; go.className = "btn btn-primary btn-small quick-go"; go.textContent = q.none;
    go.addEventListener("click", () => {
      const labels = q.options.filter(o => picked.has(o.value)).map(o => o.label);
      sendChat({ text: labels.join(", ") || q.none, value: [...picked] });
    });
    box.appendChild(go);
  }
  return box;
}

function botTurn(say, q) {
  if (q && q.done) {
    const box = document.createElement("div");
    box.className = "quick";
    const go = document.createElement("button");
    go.type = "button"; go.className = "btn btn-primary"; go.textContent = "See what this may mean";
    go.addEventListener("click", () => showChatResults(go));
    box.appendChild(go);
    addMsg("bot", [...say, q.text], box);
    return;
  }
  addMsg("bot", [...say, q && q.text], q && q.options ? quickBox(q) : null);
  chatInput.inputMode = q && q.input === "number" ? "numeric" : "text";
  chatInput.placeholder = q && q.input === "number" ? "Your age" : "Tell Meridian what you're experiencing...";
}

function chatEmergency(ids) {
  const texts = ids.map(rfText);
  const box = document.createElement("div");
  box.innerHTML = `<div class="result-banner emergency" role="alert"><div><h3>This needs urgent, in-person attention</h3>
    <p>From what you've described: ${escapeHTML(texts.join("; "))}. Please call your local emergency number now
    (for example, 112 in India, 911 in the US, 999 in the UK) or get to an emergency department. Don't wait to see if it passes.</p></div></div>`;
  const again = document.createElement("button");
  again.type = "button"; again.className = "btn btn-ghost btn-small"; again.textContent = "Start a new check";
  again.addEventListener("click", chatReset);
  box.appendChild(again);
  addMsg("bot", ["I'm stopping the questions here on purpose.", "This isn't a diagnosis, and I may have misunderstood — but with symptoms like these, getting checked in person is the safe next step."], box);
  chatInput.disabled = true; chatSendBtn.disabled = true;
  saveHistory({ urgency: "emergency", redFlags: texts, symptoms: [], duration: null, severity: null, topMatch: null });
}

async function sendChat(inp) {
  inp.text = (inp.text || "").trim();
  if (!inp.text || chat.busy || chat.s.stopped) return;
  chat.busy = true;
  chatLog.querySelectorAll(".quick").forEach(n => n.remove());
  addMsg("user", [inp.text]);
  chatInput.value = ""; chatInput.style.height = "";
  chatStatus.textContent = "Meridian is reading your message…"; chatStatus.hidden = false;
  chatSendBtn.disabled = true; chatSendBtn.classList.add("is-loading");
  await new Promise(r => setTimeout(r, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 450));
  let out;
  try { out = MeridianChat.step(chat.s, inp); }
  catch (e) { console.error(e); out = { say: ["Sorry, something went wrong on my side. You can try again, or choose symptoms instead."], q: null }; }
  chatStatus.hidden = true;
  chatSendBtn.classList.remove("is-loading");
  if (out.rf) chatEmergency(out.rf);
  else { chatSendBtn.disabled = false; botTurn(out.say, out.q); }
  chat.busy = false;
}

async function showChatResults(btn) {
  await withLoading(btn, "Checking…", async () => {
    checkMode = "chat";
    const saving = renderResults(MeridianChat.assessment(chat.s));
    showPanel(3);
    await saving;
  });
}

function chatReset() {
  chat.s = MeridianChat.newState(); chat.busy = false;
  chatLog.innerHTML = ""; chatStatus.hidden = true;
  chatInput.disabled = false; chatSendBtn.disabled = false; chatInput.value = "";
  addMsg("bot", ["Hi, I'm Meridian. Tell me what you're experiencing in your own words — for example, “I've had a headache and fever since yesterday.”",
    "I'll ask a few follow-up questions, one at a time. You can type, or use the quick answers when they appear."]);
}

function startManual() { checkMode = "manual"; showPanel(1); }

document.getElementById("chatForm").addEventListener("submit", e => { e.preventDefault(); sendChat({ text: chatInput.value }); });
chatInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); document.getElementById("chatForm").requestSubmit(); }
});
chatInput.addEventListener("input", () => { chatInput.style.height = "auto"; chatInput.style.height = Math.min(chatInput.scrollHeight, 140) + "px"; });
document.getElementById("toManual").addEventListener("click", startManual);
document.getElementById("toChat").addEventListener("click", () => { checkMode = "chat"; showPanel("chat"); });

/* ---------- boot ---------- */
chatReset();
loadSession();
