const THEME_KEY = "disasterResponseTheme";
const ROLE_KEY = "disasterResponseRole";
const ROLE_PAGES = { citizen: "citizen.html", rescuer: "rescuer.html", office: "office.html" };
const CURRENT_PAGE_ROLE = document.body.dataset.role || null;

// localStorage can throw (private browsing, locked-down/sandboxed preview
// frames, storage disabled) — never let that crash the rest of the app.
// storageAvailable() is checked once; when storage is blocked we fall back to
// an in-memory value for the current page and carry the role via a "?role="
// query param across the single login/signup redirect so that first hop still
// works even without persistent storage.
function storageAvailable() {
  try {
    const t = "__dr_test__";
    localStorage.setItem(t, "1");
    localStorage.removeItem(t);
    return true;
  } catch (err) {
    return false;
  }
}
const STORAGE_OK = storageAvailable();
let memoryRole = null;

function getSavedRole() {
  if (STORAGE_OK) {
    try { return localStorage.getItem(ROLE_KEY); } catch (err) { /* ignore */ }
  }
  return memoryRole;
}
function setSavedRole(role) {
  memoryRole = role;
  if (STORAGE_OK) {
    try { localStorage.setItem(ROLE_KEY, role); } catch (err) { /* ignore */ }
  }
}
function clearSavedRole() {
  memoryRole = null;
  if (STORAGE_OK) {
    try { localStorage.removeItem(ROLE_KEY); } catch (err) { /* ignore */ }
  }
}

// ---------------------------------------------------------------------
// REAL BACKEND WIRING
// Same-origin API (Flask serves this frontend AND the API), so plain
// relative paths + credentials:"include" is all that's needed — no CORS.
// ---------------------------------------------------------------------
const CITIZEN_NAME_KEY = "disasterResponseCitizenName";
const CITIZEN_PHONE_KEY = "disasterResponseCitizenPhone";

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  let body = null;
  try { body = await res.json(); } catch (err) { /* empty body */ }
  if (!res.ok) {
    const msg = (body && body.error) ? body.error : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return body;
}

function getCitizenInfo() {
  if (!STORAGE_OK) return { name: null, phone: null };
  try {
    return { name: localStorage.getItem(CITIZEN_NAME_KEY), phone: localStorage.getItem(CITIZEN_PHONE_KEY) };
  } catch (err) { return { name: null, phone: null }; }
}
function setCitizenInfo(name, phone) {
  if (!STORAGE_OK) return;
  try {
    if (name) localStorage.setItem(CITIZEN_NAME_KEY, name);
    if (phone) localStorage.setItem(CITIZEN_PHONE_KEY, phone);
  } catch (err) { /* ignore */ }
}

function findPanelByHeading(text) {
  return [...document.querySelectorAll(".panel")].find(
    p => p.querySelector(".panel-heading h1")?.textContent.trim() === text
  ) || null;
}

function timeAgo(isoString) {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function severityClass(sev) { return sev === "high" ? "high" : sev === "medium" ? "medium" : "safe"; }

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("Geolocation not supported")); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      err => reject(err),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });
}

// Route guard: each workspace page declares its own role via body[data-role].
// Workspace pages redirect to index.html if you're not logged in as that
// role. index.html itself NEVER auto-redirects away — that would create a
// ping-pong loop with this guard if the two pages ever briefly disagree on
// the saved role (e.g. storage not yet synced). Instead index.html swaps its
// Login/Sign Up buttons for a "Continue to workspace"/"Logout" prompt when a
// session exists (see the home-session block below). Logout is the only
// action that clears the session and takes you back to a guest home page.
// A "?role=" query param (set only by the login/signup redirect) is trusted as
// a one-time proof of a fresh login even if storage isn't available yet.
(function enforceRouteGuard() {
  const pageRole = CURRENT_PAGE_ROLE;
  const queryRole = new URLSearchParams(window.location.search).get("role");
  let savedRole = getSavedRole();

  if (queryRole && ROLE_PAGES[queryRole]) {
    savedRole = queryRole;
    setSavedRole(queryRole);
  }

  if (pageRole && savedRole !== pageRole) {
    window.location.replace("index.html");
  }
})();

// Every same-page/in-app link on a workspace page (brand logo, "Home" link)
// gets "?role=" appended so navigation still carries the session forward even
// when localStorage isn't reliably persisting across page loads in whatever
// browser/preview this runs in. Links to emergency.html are left alone since
// that page has no role guard.
if (CURRENT_PAGE_ROLE) {
  document.querySelectorAll('.brand[href], .home-link[href]').forEach(link => {
    const href = link.getAttribute("href");
    if (!href || href.includes("emergency.html")) return;
    link.addEventListener("click", e => {
      e.preventDefault();
      const sep = href.includes("?") ? "&" : "?";
      window.location.href = `${href}${sep}role=${CURRENT_PAGE_ROLE}`;
    });
  });
}

function applyTheme(isDark) {
  document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  document.querySelectorAll(".theme-input").forEach(input => input.checked = isDark);
  document.querySelectorAll(".theme-state").forEach(el => el.textContent = isDark ? "ON" : "OFF");
}

function getSavedTheme() {
  return localStorage.getItem(THEME_KEY) === "dark";
}

function setTheme(isDark) {
  localStorage.setItem(THEME_KEY, isDark ? "dark" : "light");
  applyTheme(isDark);
}

applyTheme(getSavedTheme());

document.addEventListener("change", e => {
  if (e.target.classList.contains("theme-input")) setTheme(e.target.checked);
});

document.querySelectorAll("[data-scroll]").forEach(btn => {
  btn.addEventListener("click", () => document.querySelector(btn.dataset.scroll)?.scrollIntoView({behavior:"smooth"}));
});

const sidebar = document.getElementById("sidebar");
document.getElementById("sidebarOpen")?.addEventListener("click", () => sidebar.classList.add("open"));
document.getElementById("sidebarClose")?.addEventListener("click", () => sidebar.classList.remove("open"));
document.getElementById("menuBtn")?.addEventListener("click", () => document.getElementById("mainNav").classList.toggle("mobile-open"));

const availability = document.getElementById("availability");
availability?.addEventListener("click", async () => {
  const goingBusy = !availability.classList.contains("busy");
  const newStatus = goingBusy ? "busy" : "available";
  const prevText = availability.textContent;
  availability.disabled = true;
  try {
    await api("/api/me/status", { method: "PATCH", body: JSON.stringify({ status: newStatus }) });
    availability.classList.toggle("busy", goingBusy);
    availability.classList.toggle("available", !goingBusy);
    availability.textContent = newStatus.toUpperCase();
  } catch (err) {
    availability.textContent = prevText;
    alert(`Couldn't update status: ${err.message}`);
  } finally {
    availability.disabled = false;
  }
});

// Delegated (task cards are re-rendered live from /api/reports — see
// loadRescuerWorkspace below — so listeners must survive re-renders).
document.addEventListener("click", async e => {
  const btn = e.target.closest(".task-actions button[data-status]");
  if (!btn) return;
  const card = btn.closest(".task-card");
  const reportId = card?.dataset.reportId;
  if (!reportId) return;
  const statusEl = card.querySelector(".task-status");
  const prevText = statusEl.textContent;
  btn.disabled = true;
  try {
    const updated = await api(`/api/reports/${reportId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: btn.dataset.status }),
    });
    statusEl.textContent = `Status: ${updated.status.replace("_", " ")}`;
    if (updated.status === "rescued" || updated.status === "resolved") {
      card.querySelectorAll(".task-actions button").forEach(b => b.disabled = true);
    }
    const marker = caseMarkers[reportId];
    if (marker) marker.setPopupContent(reportPopupHtml(updated));
  } catch (err) {
    statusEl.textContent = prevText;
    alert(`Couldn't update: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
});

let holdTimer, holding = false;
const sosButton = document.getElementById("sosButton");
const sosMessage = document.getElementById("sosMessage");
const resetSos = document.getElementById("resetSos");

// Real SOS submission: grabs GPS then POSTs to the public /api/report
// endpoint. Treated as a high-severity "other" hazard since this button has
// no hazard-type picker of its own. Optional fields feed into the note.
async function sendSos() {
  const whatInput = document.querySelector('.optional-fields input[type="text"]');
  const peopleInput = document.querySelector('.optional-fields input[type="number"]');
  const citizen = getCitizenInfo();

  sosMessage.innerHTML = "GETTING YOUR LOCATION…";
  let loc;
  try {
    loc = await getLocation();
  } catch (err) {
    sosButton.classList.remove("holding");
    sosMessage.innerHTML = "<b>COULDN'T GET YOUR LOCATION</b><br>Enable location access, then try again.";
    return;
  }

  const noteParts = [];
  if (whatInput?.value.trim()) noteParts.push(whatInput.value.trim());
  if (peopleInput?.value.trim()) noteParts.push(`${peopleInput.value.trim()} people with reporter`);

  sosMessage.innerHTML = "SENDING SOS…";
  try {
    await api("/api/report", {
      method: "POST",
      body: JSON.stringify({
        citizen_name: citizen.name || undefined,
        citizen_phone: citizen.phone || undefined,
        hazard_type: "other",
        severity: "high",
        lat: loc.lat,
        lon: loc.lon,
        note: noteParts.join(" — ") || undefined,
      }),
    });
    sosButton.classList.remove("holding");
    sosButton.classList.add("sent");
    sosButton.querySelector("b").textContent = "SENT";
    sosButton.querySelector("span").textContent = "✓";
    sosMessage.innerHTML = "<b>SOS SENT SUCCESSFULLY</b><br>Emergency assistance has been requested.";
    resetSos.classList.remove("hidden");
  } catch (err) {
    sosButton.classList.remove("holding");
    sosMessage.innerHTML = `<b>SOS FAILED TO SEND</b><br>${err.message}. Press and hold to retry.`;
  }
}

function startHold(e) {
  e.preventDefault();
  if (sosButton.classList.contains("sent")) return;
  holding = true;
  sosButton.classList.remove("quick-pulse");
  sosButton.classList.add("holding");
  sosMessage.innerHTML = "HOLDING... RELEASE TO CANCEL";
  holdTimer = setTimeout(() => {
    if (!holding) return;
    sendSos();
  }, 1800);
}
function cancelHold() {
  if (sosButton.classList.contains("sent")) return;
  holding = false;
  clearTimeout(holdTimer);
  sosButton.classList.remove("holding");
  sosMessage.innerHTML = "FOR EXTREME EMERGENCIES ONLY<br><b>PRESS AND HOLD TO CONFIRM SEND</b>";
}
sosButton?.addEventListener("pointerdown", startHold);
sosButton?.addEventListener("pointerup", cancelHold);
sosButton?.addEventListener("pointerleave", cancelHold);
sosButton?.addEventListener("pointercancel", cancelHold);
resetSos?.addEventListener("click", () => {
  sosButton.classList.remove("sent");
  sosButton.querySelector("b").textContent = "SOS";
  sosButton.querySelector("span").textContent = "✋";
  sosMessage.innerHTML = "FOR EXTREME EMERGENCIES ONLY<br><b>PRESS AND HOLD TO CONFIRM SEND</b>";
  resetSos.classList.add("hidden");
});

// Deep-link from the header's fast "SEND SOS" button (emergency.html?quick=1):
// draws attention straight to the SOS circle for fast sending.
if (sosButton && new URLSearchParams(window.location.search).get("quick") === "1") {
  sosButton.classList.add("quick-pulse");
  window.addEventListener("DOMContentLoaded", () => {
    sosButton.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

function openModal(id) { document.getElementById(id)?.classList.add("open"); }
function closeModal(modal) { modal.classList.remove("open"); }
document.querySelectorAll("[data-modal]").forEach(btn => btn.addEventListener("click", () => openModal(btn.dataset.modal)));
document.querySelectorAll(".modal-close").forEach(btn => btn.addEventListener("click", () => closeModal(btn.closest(".modal"))));
document.querySelectorAll(".modal").forEach(modal => modal.addEventListener("click", e => { if (e.target === modal) closeModal(modal); }));
document.querySelectorAll("[data-switch]").forEach(btn => btn.addEventListener("click", () => {
  closeModal(btn.closest(".modal")); openModal(btn.dataset.switch);
}));
document.addEventListener("keydown", e => {
  if (e.key === "Escape") document.querySelectorAll(".modal.open").forEach(closeModal);
});

// Forgot Password: mobile -> OTP -> new password -> success, as a stepped flow
const forgotModal = document.getElementById("forgotModal");
if (forgotModal) {
  const steps = forgotModal.querySelectorAll(".forgot-step");
  const dots = forgotModal.querySelectorAll(".step-dot");

  function goToStep(n) {
    steps.forEach(step => {
      const isTarget = step.dataset.step === String(n);
      step.classList.toggle("hidden", !isTarget);
      step.classList.toggle("step-anim", isTarget);
      if (isTarget) {
        step.style.animation = "none";
        void step.offsetWidth;
        step.style.animation = "";
      }
    });
    dots.forEach(dot => {
      const dn = Number(dot.dataset.stepDot);
      dot.classList.toggle("active", dn === n);
      dot.classList.toggle("done", dn < n);
    });
  }

  function resetForgotFlow() {
    goToStep(1);
    forgotModal.querySelector(".forgot-mobile").value = "";
    forgotModal.querySelector(".forgot-otp").value = "";
    forgotModal.querySelector(".forgot-new-password").value = "";
    forgotModal.querySelector(".forgot-confirm-password").value = "";
  }

  forgotModal.querySelector(".forgot-send-otp")?.addEventListener("click", () => {
    goToStep(2);
  });

  forgotModal.querySelector(".forgot-resend-otp")?.addEventListener("click", (e) => {
    e.preventDefault();
    const btn = e.currentTarget;
    const original = btn.textContent;
    btn.textContent = "Code Resent ✓";
    btn.disabled = true;
    setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 2000);
  });

  forgotModal.querySelector(".forgot-verify-otp")?.addEventListener("click", () => {
    const otpInput = forgotModal.querySelector(".forgot-otp");
    if (!otpInput.value.trim()) {
      otpInput.focus();
      otpInput.classList.add("input-error");
      setTimeout(() => otpInput.classList.remove("input-error"), 500);
      return;
    }
    goToStep(3);
  });

  forgotModal.querySelector(".forgot-reset-submit")?.addEventListener("click", () => {
    const newPw = forgotModal.querySelector(".forgot-new-password");
    const confirmPw = forgotModal.querySelector(".forgot-confirm-password");
    if (!newPw.value || newPw.value !== confirmPw.value) {
      confirmPw.classList.add("input-error");
      setTimeout(() => confirmPw.classList.remove("input-error"), 500);
      confirmPw.focus();
      return;
    }
    goToStep(4);
  });

  // Reset the flow back to step 1 whenever the modal is reopened from elsewhere
  document.querySelectorAll('[data-modal="forgotModal"], [data-switch="forgotModal"]').forEach(btn => {
    btn.addEventListener("click", resetForgotFlow);
  });
}


// Generic checklist progress: any .panel with a .checklist updates its .live-badge counter
document.querySelectorAll(".checklist").forEach(list => {
  const badge = list.closest(".panel")?.querySelector(".live-badge");
  const boxes = list.querySelectorAll('input[type="checkbox"]');
  function updateCount() {
    const done = [...boxes].filter(b => b.checked).length;
    if (badge) badge.textContent = `${done}/${boxes.length} Ready`;
  }
  list.addEventListener("change", updateCount);
  updateCount();
});

// Home page ("data-page=home"): if a session already exists, show a
// "Continue to workspace" / "Logout" prompt instead of the Login/Sign Up
// buttons. This is the only place a home-page role check happens, and it
// never navigates on its own — no possibility of a redirect loop with the
// workspace-page guard above.
if (document.body.dataset.page === "home") {
  const role = getSavedRole();
  const guestAuth = document.querySelector(".guest-auth");
  const sessionAuth = document.querySelector(".session-auth");
  if (role && ROLE_PAGES[role] && guestAuth && sessionAuth) {
    guestAuth.classList.add("hidden");
    sessionAuth.classList.remove("hidden");
    const continueBtn = sessionAuth.querySelector(".continue-workspace-btn");
    const label = sessionAuth.querySelector(".session-role-label");
    if (label) label.textContent = role.charAt(0).toUpperCase() + role.slice(1);
    continueBtn?.addEventListener("click", () => {
      window.location.href = `${ROLE_PAGES[role]}?role=${role}`;
    });
    // Logout button here is handled by the generic ".logout-btn" listener
    // further down, which clears the session and reloads index.html.
  }
}

function showModalError(modalCard, msg) {
  let el = modalCard.querySelector(".auth-error");
  if (!el) {
    el = document.createElement("p");
    el.className = "auth-error";
    el.style.color = "#c0392b";
    el.style.fontSize = "13px";
    el.style.marginTop = "-4px";
    modalCard.querySelector(".primary-btn")?.insertAdjacentElement("beforebegin", el);
  }
  el.textContent = msg;
}
function clearModalError(modalCard) { modalCard.querySelector(".auth-error")?.remove(); }

// Citizens have no backend account (app.py: reports carry name/phone as
// plain fields, never a login). Rescuer/office hit POST /api/auth/login for
// real — only accounts seeded by seed.py exist server-side, so a wrong
// phone/password is genuinely rejected here (this used to just redirect on
// any input, with zero backend check — that's fixed now).
document.querySelector(".login-submit")?.addEventListener("click", async e => {
  e.preventDefault();
  const modalCard = document.querySelector("#loginModal .modal-card");
  const role = document.querySelector("#loginModal .role-select")?.value || "citizen";
  const phone = document.querySelector("#loginModal input[type='tel']")?.value.trim();
  const password = document.querySelector("#loginModal input[type='password']")?.value;
  const btn = e.currentTarget;
  clearModalError(modalCard);

  if (role === "citizen") {
    setSavedRole("citizen");
    window.location.href = "citizen.html?role=citizen";
    return;
  }
  if (!phone || !password) {
    showModalError(modalCard, "Enter your phone number and password.");
    return;
  }

  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = "LOGGING IN…";
  try {
    await api("/api/auth/login", { method: "POST", body: JSON.stringify({ role, phone, password }) });
    setSavedRole(role);
    window.location.href = `${ROLE_PAGES[role]}?role=${role}`;
  } catch (err) {
    showModalError(modalCard, err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
});

// Sign up is for citizen accounts only. Now saves a REAL Citizen row via
// POST /api/auth/citizen-signup (name/phone/password persisted in
// disaster.db) — this used to be entirely local/fake. Citizens still never
// need to log in to send an SOS (create_report stays public); this just
// makes the account real and checkable. Rescuer/office accounts can ONLY be
// the ones seeded by seed.py — there is intentionally no self-registration
// for them.
document.querySelector(".signup-submit")?.addEventListener("click", async e => {
  e.preventDefault();
  const modalCard = document.querySelector("#signupModal .modal-card");
  const phone = document.querySelector("#signupModal input[type='tel']")?.value.trim();
  const name = document.querySelector("#signupModal input[type='text']")?.value.trim();
  const password = document.querySelector("#signupModal input[type='password']")?.value;
  const btn = e.currentTarget;
  clearModalError(modalCard);
  if (!phone || !name || !password) {
    showModalError(modalCard, "Enter your name, mobile number and password.");
    return;
  }

  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = "SIGNING UP…";
  try {
    await api("/api/auth/citizen-signup", { method: "POST", body: JSON.stringify({ name, phone, password }) });
    setCitizenInfo(name, phone);
    setSavedRole("citizen");
    window.location.href = "citizen.html?role=citizen";
  } catch (err) {
    showModalError(modalCard, err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
});

// Logout: clears the real backend session (rescuer/office) as well as the
// local role flag.
document.querySelectorAll(".logout-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    try { await api("/api/auth/logout", { method: "POST" }); } catch (err) { /* best effort */ }
    clearSavedRole();
    window.location.href = "index.html";
  });
});

// Session guard for rescuer/office pages: the route guard above only checks
// the LOCAL "role" flag, which proves nothing by itself (someone could set
// it by hand in devtools). This checks the real backend session and bounces
// back to login if it isn't valid — e.g. after the server restarts, or the
// session cookie expired.
async function requireRealSession() {
  if (CURRENT_PAGE_ROLE !== "rescuer" && CURRENT_PAGE_ROLE !== "office") return true;
  try {
    await api("/api/me");
    return true;
  } catch (err) {
    clearSavedRole();
    window.location.replace("index.html");
    return false;
  }
}

// Nepal location map: renders a real Leaflet/OpenStreetMap map centered on
// Nepal, then tries to pinpoint the visitor's own location via the browser
// Geolocation API. Falls back to a Kathmandu-centered marker if geolocation
// is unsupported, denied, or times out — so the card always shows something
// useful even without permission.
const NEPAL_CENTER = [28.3949, 84.1240];
const KATHMANDU = { lat: 27.7172, lng: 85.3240 };
const NEPAL_BOUNDS = { minLat: 26.3, maxLat: 30.5, minLng: 80.0, maxLng: 88.3 };

function initLocationMap() {
  const mapEl = document.getElementById("locationMap");
  if (!mapEl || typeof L === "undefined") return;

  const card = mapEl.closest(".location-card");
  const titleEl = card?.querySelector("h3");
  const regionEl = card?.querySelector("p:not(.coordinates):not(.location-note)");
  const coordEl = card?.querySelector(".coordinates");
  const noteEl = document.getElementById("locationNote");

  function setNote(text) { if (noteEl) noteEl.textContent = text; }

  const map = L.map(mapEl, { attributionControl: true }).setView(NEPAL_CENTER, 7);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  const marker = L.marker([KATHMANDU.lat, KATHMANDU.lng]).addTo(map).bindPopup("Kathmandu");

  function placeUser(lat, lng) {
    marker.setLatLng([lat, lng]).bindPopup("Your location").openPopup();
    map.setView([lat, lng], 13);
    if (coordEl) coordEl.textContent = `${lat.toFixed(4)}° N, ${lng.toFixed(4)}° E`;
    if (titleEl) titleEl.textContent = "Your Location";
    if (regionEl) regionEl.textContent = "Nepal";
  }

  if (!navigator.geolocation) {
    setNote("Location access isn't supported in this browser — showing Kathmandu.");
    return;
  }

  setNote("Detecting your location…");
  navigator.geolocation.getCurrentPosition(
    pos => {
      const { latitude, longitude } = pos.coords;
      const inNepal = latitude >= NEPAL_BOUNDS.minLat && latitude <= NEPAL_BOUNDS.maxLat &&
                       longitude >= NEPAL_BOUNDS.minLng && longitude <= NEPAL_BOUNDS.maxLng;
      placeUser(latitude, longitude);
      setNote(inNepal
        ? "Showing your current location."
        : "Showing your current location (outside Nepal — hazard data shown is Nepal-specific).");
    },
    () => setNote("Location access denied or unavailable — showing Kathmandu as default."),
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
  );
}

if (document.getElementById("locationMap")) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initLocationMap);
  } else {
    initLocationMap();
  }
}

// ---------------------------------------------------------------------
// Team / command map: renders a real Leaflet map showing LIVE data from the
// backend — actual reports (🧍) and rescuer teams (🚑) — instead of the
// hardcoded ALERT_ZONES/CASES demo arrays this used to draw. Backs both
// office.html ("Live Zone Map") and rescuer.html ("Citizens Near High
// Alert"). Markers are keyed by real report id in caseMarkers so the task
// buttons and the reassign dropdown above can update a marker's popup after
// a status change or reassignment without needing to redraw the whole map.
const SEVERITY_COLOR = { high: "#e53935", medium: "#f0a21a", low: "#1e9b62" };

function makePinIcon(emoji, color) {
  return L.divIcon({
    className: "",
    html: `<div class="map-marker-pin" style="background:${color}"><span>${emoji}</span></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 34],
    popupAnchor: [0, -32]
  });
}

function reportPopupHtml(r) {
  const assignedLine = r.assigned_staff ? `<div class="map-popup-meta">Assigned: ${r.assigned_staff.name}</div>` : "";
  return `<div class="map-popup"><b>${r.citizen_name || "Anonymous"}</b>${r.hazard_type} report
    <div class="map-popup-meta">Severity: ${r.severity.toUpperCase()} · Status: ${r.status.replace("_", " ")}</div>${assignedLine}</div>`;
}

function teamPopupHtml(t) {
  return `<div class="map-popup"><b>${t.name}</b>${t.is_government ? "Government team" : "Volunteer team"}
    <div class="map-popup-meta">Status: ${t.status}</div></div>`;
}

let teamMapInstance = null;
const caseMarkers = {};   // report.id -> Leaflet marker
const teamMarkers = {};   // staff.id  -> Leaflet marker

function initTeamMap() {
  const mapEl = document.getElementById("teamMap");
  if (!mapEl || typeof L === "undefined" || teamMapInstance) return teamMapInstance;
  const map = L.map(mapEl, { attributionControl: true }).setView([27.715, 85.34], 12);
  teamMapInstance = map;
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  return map;
}

function plotReports(map, reports) {
  reports.forEach(r => {
    const marker = L.marker([r.lat, r.lon], { icon: makePinIcon("🧍", SEVERITY_COLOR[r.severity] || "#2e73d9") })
      .addTo(map)
      .bindPopup(reportPopupHtml(r));
    caseMarkers[r.id] = marker;
  });
}

function plotTeams(map, teams) {
  teams.forEach(t => {
    if (t.lat == null || t.lon == null) return;
    const marker = L.marker([t.lat, t.lon], { icon: makePinIcon("🚑", t.status === "available" ? "#1e9b62" : "#888") })
      .addTo(map)
      .bindPopup(teamPopupHtml(t));
    teamMarkers[t.id] = marker;
  });
}

// ---------------------------------------------------------------------
// LIVE DATA per workspace — renders real reports/teams into the existing
// card/table markup and onto the map, in place of the old hardcoded content.
// ---------------------------------------------------------------------

function taskCardHtml(r, myLat, myLon) {
  const dist = (myLat != null && myLon != null)
    ? `${haversineKm(myLat, myLon, r.lat, r.lon).toFixed(1)} km away`
    : `${r.lat.toFixed(3)}, ${r.lon.toFixed(3)}`;
  const title = r.note ? r.note : `${r.hazard_type.charAt(0).toUpperCase()}${r.hazard_type.slice(1)} report`;
  const done = r.status === "rescued" || r.status === "resolved";
  return `
    <article class="task-card" data-report-id="${r.id}">
      <span class="severity ${severityClass(r.severity)}">${r.severity.toUpperCase()}</span>
      <h2>${title}</h2>
      <p>${r.citizen_name || "Anonymous"}${r.citizen_phone ? " · " + r.citizen_phone : ""} · ${dist}</p>
      <small>Reported ${timeAgo(r.created_at)}</small>
      <div class="task-actions">
        <button data-status="accepted" ${done ? "disabled" : ""}>ACCEPT</button>
        <button data-status="en_route" ${done ? "disabled" : ""}>EN ROUTE</button>
        <button data-status="rescued" ${done ? "disabled" : ""}>RESOLVE</button>
      </div>
      <span class="task-status">Status: ${r.status.replace("_", " ")}</span>
    </article>`;
}

function alertCardHtml(r) {
  return `
    <article class="task-card">
      <span class="severity ${severityClass(r.severity)}">${r.severity.toUpperCase()}</span>
      <h2>${r.hazard_type.charAt(0).toUpperCase()}${r.hazard_type.slice(1)} alert</h2>
      <p>${r.note || "Active hazard reported nearby."}</p>
      <small>Issued ${timeAgo(r.created_at)}</small>
    </article>`;
}

async function loadRescuerWorkspace() {
  const grid = document.querySelector("#tasks .rescuer-grid");
  const nearbyPanel = findPanelByHeading("High Alert Zones Near You");
  const nearbyGrid = nearbyPanel?.querySelector(".rescuer-grid");
  try {
    const me = await api("/api/me");
    const reports = await api("/api/reports");

    if (grid) {
      grid.innerHTML = reports.length
        ? reports.map(r => taskCardHtml(r, me.lat, me.lon)).join("")
        : `<p class="workspace-note">No reports assigned to you right now.</p>`;
    }
    if (availability) {
      const busy = me.status === "busy";
      availability.classList.toggle("busy", busy);
      availability.classList.toggle("available", !busy);
      availability.textContent = busy ? "BUSY" : "AVAILABLE";
    }

    const map = initTeamMap();
    if (map) {
      plotReports(map, reports);
      if (me.lat != null) L.marker([me.lat, me.lon], { icon: makePinIcon("🚑", "#1e9b62") }).addTo(map).bindPopup("You");
      if (reports.length) map.fitBounds(reports.map(r => [r.lat, r.lon]).concat(me.lat != null ? [[me.lat, me.lon]] : []), { padding: [30, 30] });
    }

    if (nearbyGrid && me.lat != null) {
      try {
        const alerts = await api(`/api/alerts/nearby?lat=${me.lat}&lon=${me.lon}&radius=10`);
        nearbyGrid.innerHTML = alerts.length ? alerts.map(alertCardHtml).join("") : `<p class="workspace-note">No high-severity alerts near you right now.</p>`;
      } catch (err) { /* leave section as-is on failure */ }
    }
  } catch (err) {
    if (grid) grid.innerHTML = `<p class="workspace-note">Couldn't load your tasks: ${err.message}</p>`;
  }
}

async function loadOfficeWorkspace() {
  const tbody = document.querySelector("#cases table tbody");
  const countBadge = document.querySelector("#cases .table-title span");
  try {
    const [reports, teams] = await Promise.all([api("/api/reports"), api("/api/teams")]);

    if (tbody) {
      tbody.innerHTML = reports.length ? reports.map(r => `
        <tr data-report-id="${r.id}">
          <td>${r.citizen_name || "Anonymous"}</td>
          <td>${r.lat.toFixed(3)}, ${r.lon.toFixed(3)}</td>
          <td><span class="severity ${severityClass(r.severity)}">${r.severity.toUpperCase()}</span></td>
          <td>
            <select class="team-select">
              <option value="unassigned" ${!r.assigned_staff ? "selected" : ""}>Unassigned</option>
              ${teams.map(t => `<option value="${t.id}" ${r.assigned_staff?.id === t.id ? "selected" : ""}>${t.name}</option>`).join("")}
            </select>
          </td>
          <td>${r.status.replace("_", " ")}</td>
        </tr>`).join("") : `<tr><td colspan="5">No reports yet.</td></tr>`;
      if (countBadge) countBadge.textContent = `${reports.filter(r => !["resolved", "rescued"].includes(r.status)).length} open`;
    }

    const activeCases = document.querySelector(".metrics .metric-card:nth-child(1) strong");
    const rescuersDeployed = document.querySelector(".metrics .metric-card:nth-child(2) strong");
    const rescuersOnSite = document.querySelector(".metrics .metric-card:nth-child(2) em");
    if (activeCases) activeCases.textContent = reports.filter(r => !["resolved", "rescued"].includes(r.status)).length;
    if (rescuersDeployed) rescuersDeployed.textContent = teams.length;
    if (rescuersOnSite) rescuersOnSite.textContent = `${teams.filter(t => t.status === "busy").length} on-site`;

    const map = initTeamMap();
    if (map) {
      plotReports(map, reports);
      plotTeams(map, teams);
      const pts = reports.map(r => [r.lat, r.lon]).concat(teams.filter(t => t.lat != null).map(t => [t.lat, t.lon]));
      if (pts.length) map.fitBounds(pts, { padding: [30, 30] });
    }
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="5">Couldn't load cases: ${err.message}</td></tr>`;
  }
}

async function loadCitizenAlerts() {
  const grid = document.querySelector("#alerts .rescuer-grid");
  if (!grid) return;
  try {
    const loc = await getLocation();
    const alerts = await api(`/api/alerts/nearby?lat=${loc.lat}&lon=${loc.lon}&radius=5`);
    grid.innerHTML = alerts.length ? alerts.map(alertCardHtml).join("") : `<p class="workspace-note">No high-severity alerts near you right now.</p>`;
  } catch (err) {
    grid.innerHTML = `<p class="workspace-note">Enable location access to see alerts near you.</p>`;
  }
}

// Real reassignment: office picks a team from the dropdown -> PATCH
// /api/reports/:id/reassign, then update that report's row + map marker.
document.addEventListener("change", async e => {
  const select = e.target.closest(".team-select");
  if (!select) return;
  const row = select.closest("tr");
  const reportId = row?.dataset.reportId;
  const staffId = select.value;
  if (!reportId || !staffId || staffId === "unassigned") return;
  select.disabled = true;
  try {
    const updated = await api(`/api/reports/${reportId}/reassign`, {
      method: "PATCH",
      body: JSON.stringify({ staff_id: Number(staffId) }),
    });
    const statusCell = row.querySelector("td:last-child");
    if (statusCell) statusCell.textContent = updated.status.replace("_", " ");
    const marker = caseMarkers[reportId];
    if (marker) marker.setPopupContent(reportPopupHtml(updated));
  } catch (err) {
    alert(`Couldn't reassign: ${err.message}`);
  } finally {
    select.disabled = false;
  }
});

// Entry point per page — waits for a confirmed real session on rescuer/office
// pages before pulling any data (see requireRealSession above).
(function initLiveData() {
  const role = CURRENT_PAGE_ROLE;
  if (!role) return;

  async function run() {
    if (role === "rescuer") {
      if (!(await requireRealSession())) return;
      loadRescuerWorkspace();
    } else if (role === "office") {
      if (!(await requireRealSession())) return;
      loadOfficeWorkspace();
    } else if (role === "citizen") {
      loadCitizenAlerts();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();

const menuStyle = document.createElement("style");
menuStyle.textContent = "@media(max-width:1100px){#mainNav.mobile-open{display:flex;position:absolute;top:68px;left:0;right:0;background:var(--surface);padding:12px;flex-direction:column;align-items:stretch;border-bottom:1px solid var(--surface-border);box-shadow:var(--shadow)}}";
document.head.appendChild(menuStyle);
