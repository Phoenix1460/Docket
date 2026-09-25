(function(){
"use strict";

/* ================================================================
   1. MOCK CANVAS API — courses, assignments, gradebook/submissions
   In production these three objects are replaced by real calls to:
     GET /api/v1/courses
     GET /api/v1/courses/:id/assignments
     GET /api/v1/courses/:id/students/submissions
   and a Chrome-extension content script that reads the authenticated
   Canvas session cookie to bypass district network blocks.
   ================================================================ */

const canvasCourses = [
  { id: 1, name: "Grade 7 Mathematics — Period 3",      subjectHint: "math" },
  { id: 2, name: "English Language Arts 7",              subjectHint: "english" },
  { id: 3, name: "Life Science 7",                       subjectHint: "science" },
  { id: 4, name: "U.S. History: Foundations",             subjectHint: "history" },
];

const canvasAssignments = [
  { id: 101, courseId: 1, title: "IXL Lessons H.1, H.2, H.5 — Ratios & Proportions", dueDate: "2026-09-24", points: 20,
    description: "Complete the assigned IXL skills at 80+ SmartScore before Thursday's quiz." },
  { id: 102, courseId: 1, title: "IXL U.6 — Solving Two-Step Equations", dueDate: "2026-09-25", points: 15,
    description: "Practice set covering two-step linear equations with rational coefficients." },
  { id: 103, courseId: 2, title: "IXL Lessons W.3, W.4 — Commas and Clauses", dueDate: "2026-09-23", points: 10,
    description: "Grammar review ahead of Friday's paragraph revision workshop." },
  { id: 104, courseId: 2, title: "Reading Response: Chapter 6 of assigned novel", dueDate: "2026-09-26", points: 25,
    description: "Submit a one-page written response covering the chapter's central conflict." },
  { id: 105, courseId: 3, title: "IXL Lessons B.2 — Cell Structure and Function", dueDate: "2026-09-22", points: 15,
    description: "Diagram labeling and vocabulary practice for the cell unit." },
  { id: 106, courseId: 4, title: "Reading Guide: Articles of Confederation, pp. 40–52", dueDate: "2026-09-27", points: 10,
    description: "Answer the guided reading questions in the shared packet." },
];

// Gradebook / submission endpoint — IXL SmartScore drives the
// "verified completed" vs "launcher" UI split described below.
const canvasSubmissions = {
  101: { submitted: true,  ixlSmartScore: 92 },
  102: { submitted: true,  ixlSmartScore: 61 },   // below 80 → still a launcher
  103: { submitted: true,  ixlSmartScore: 84 },
  104: { submitted: false, ixlSmartScore: null }, // no IXL score, plain assignment
  105: { submitted: true,  ixlSmartScore: 74 },
  106: { submitted: false, ixlSmartScore: null },
};

/* ================================================================
   2. INTELLIGENT SUBJECT MATCHING
   Deduces subject from a Canvas course name so unlinked assignment
   text (like a bare "IXL Lessons H.1, H.2") can still be routed to
   the right panel even without an explicit subject field.
   ================================================================ */
const SUBJECT_KEYWORDS = {
  math:    { label: "Mathematics",     color: "#B98A3D", keywords: ["math", "algebra", "geometry", "pre-algebra"] },
  english: { label: "English / ELA",   color: "#4F7A5A", keywords: ["english", "ela", "language arts", "literature", "reading"] },
  science: { label: "Science",         color: "#3C6E8F", keywords: ["science", "biology", "life science", "physical science", "chemistry"] },
  history: { label: "History / Social Studies", color: "#B5502D", keywords: ["history", "social studies", "civics", "geography"] },
};

function deduceSubjectFromCourseName(courseName) {
  const lower = courseName.toLowerCase();
  for (const key in SUBJECT_KEYWORDS) {
    if (SUBJECT_KEYWORDS[key].keywords.some(k => lower.includes(k))) return key;
  }
  return "general";
}

/* ================================================================
   3. REGEX EXTRACTORS — pull skill codes like "H.1" or "U.6" out
   of free-text assignment titles/descriptions.
   ================================================================ */
const SKILL_CODE_REGEX = /\b[A-Z]{1,2}\.\d{1,2}\b/g;

function extractSkillCodes(text) {
  const matches = text.match(SKILL_CODE_REGEX);
  return matches ? [...new Set(matches)] : [];
}

/* ================================================================
   5. CLASSLINK PORTAL CONFIG
   Custom school subdomain, e.g. https://lincolnms.classlink.com
   In the packaged extension this feeds an OAuth redirect instead
   of the placeholder link built here.
   ================================================================ */
let classLinkConfig = {
  subdomain: localStorage.getItem("docket_classlink_subdomain") || "",
  // Supports arbitrary custom launchpad paths, e.g.
  // "login.classlink.com/custompageschoolnamehere" — some districts
  // don't use the clean {subdomain}.classlink.com pattern at all.
  customUrl: localStorage.getItem("docket_classlink_customurl") || "",
};
function classLinkLoginUrl() {
  if (classLinkConfig.customUrl) {
    return classLinkConfig.customUrl.startsWith("http")
      ? classLinkConfig.customUrl
      : `https://${classLinkConfig.customUrl}`;
  }
  return classLinkConfig.subdomain
    ? `https://${classLinkConfig.subdomain}.classlink.com/login`
    : null;
}

/* ================================================================
   6. CONTENT MODERATION LAYER
   Front-end pre-check only. Every upload / publish action is routed
   through moderateContent() before anything is "saved". This keyword
   list is a placeholder demo filter — the real gate is the live
   Cloud AI Moderation API call marked below.
   ================================================================ */
const OFFENSIVE_KEYWORDS = ["explicit", "nsfw", "gore", "graphic-violence", "hate-symbol", "slur"];
const MAX_UPLOAD_BYTES = 40 * 1024 * 1024; // 40MB demo ceiling
const ALLOWED_BG_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "video/mp4"];
const ALLOWED_FONT_TYPES = [".ttf", ".otf", ".woff", ".woff2"];

function moderateContent({ name = "", tags = [], file = null, kind = "text" }) {
  const scanText = `${name} ${tags.join(" ")}`.toLowerCase();
  const hit = OFFENSIVE_KEYWORDS.find(word => scanText.includes(word));
  if (hit) {
    return { approved: false, reason: `Flagged term detected in "${hit}" — please rename and try again.` };
  }

  if (file) {
    if (file.size > MAX_UPLOAD_BYTES) {
      return { approved: false, reason: "File is larger than the 40MB limit." };
    }
    if (kind === "background" && !ALLOWED_BG_TYPES.includes(file.type)) {
      return { approved: false, reason: "Unsupported file type for backgrounds." };
    }
    if (kind === "font" && !ALLOWED_FONT_TYPES.some(ext => file.name.toLowerCase().endsWith(ext))) {
      return { approved: false, reason: "Unsupported font file type." };
    }

    // ------------------------------------------------------------
    // LIVE INTEGRATION POINT (production):
    // Before this file/theme is ever written to shared storage or
    // the community marketplace, send it server-side to a real
    // moderation API and block on the result, e.g.:
    //
    //   const form = new FormData();
    //   form.append("file", file);
    //   const res = await fetch("/api/moderate-upload", { method: "POST", body: form });
    //   const { safe, categories } = await res.json();
    //   if (!safe) return { approved:false, reason:`Blocked: ${categories.join(", ")}` };
    //
    // Google Cloud Vision (SafeSearch Detection) or AWS Rekognition
    // (DetectModerationLabels) would run here against the actual
    // image/video bytes, not just the filename/tags. The keyword
    // check above is a client-side placeholder only and is not a
    // substitute for real image/video content scanning.
    // ------------------------------------------------------------
  }

  return { approved: true };
}

/* ================================================================
   7. COMMUNITY THEME MARKETPLACE — mock repository
   ================================================================ */
const communityThemes = [
  { name: "Aesthetic Anime Video Theme", tags: ["anime", "video", "soft"], accent: "#E88AA0", sidebar: "#241B2E", swatch: "linear-gradient(135deg,#F4C9D8,#8AA9E8)" },
  { name: "Cyberpunk Grid",              tags: ["neon", "dark", "grid"],   accent: "#4DE8D8", sidebar: "#0A0A12", swatch: "linear-gradient(135deg,#0A0A12,#4DE8D8)" },
  { name: "Pastel Minimalist",           tags: ["pastel", "light", "clean"], accent: "#8FA8D9", sidebar: "#3A3F55", swatch: "linear-gradient(135deg,#F4F1F9,#C9D9EE)" },
  { name: "Scholar's Ledger (default)",  tags: ["classic", "school"],     accent: "#B98A3D", sidebar: "#12172B", swatch: "linear-gradient(135deg,#F6F1E7,#B98A3D)" },
  { name: "Forest Study Hall",           tags: ["nature", "green", "calm"], accent: "#5C8C5A", sidebar: "#1B2A1F", swatch: "linear-gradient(135deg,#E3EEDD,#5C8C5A)" },
  { name: "Midnight Observatory",        tags: ["space", "dark", "stars"], accent: "#8E9CE0", sidebar: "#080B18", swatch: "linear-gradient(135deg,#080B18,#8E9CE0)" },
];

/* ================================================================
   8. LINKED HOMEWORK SITES + VERIFICATION ENGINE
   Lets a student link the actual sites their homework lives on —
   including ones gated entirely behind ClassLink SSO — then asks
   Docket to go check whether an assignment is *really* done there,
   not just whether Canvas thinks it was assigned.

   Production notes:
   - A site linked "Via ClassLink SSO" never collects a password here
     at all; the Chrome extension hands off to ClassLink's real SAML/
     OIDC flow and reuses the resulting session, the same way a human
     clicking the ClassLink tile would.
   - A site linked "Direct" should still prefer that site's official
     partner/gradebook API (IXL, DeltaMath, etc. all expose one) over
     scraping a logged-in page — scraping is a fallback, and must
     respect each site's Terms of Service and rate limits.
   - Nothing here should ever store a raw password outside of memory
     for the current tab; production swaps this for OAuth tokens.
   ================================================================ */

// Sites that ship pre-listed so linking is one click for the common
// case; "custom" lets a student add anything else their school uses.
const homeworkSitesCatalog = [
  { id: "ixl",         name: "IXL",             matchKeywords: ["ixl"] },
  { id: "deltamath",   name: "DeltaMath",       matchKeywords: ["delta math", "deltamath"] },
  { id: "studyisland", name: "Study Island",    matchKeywords: ["study island"] },
  { id: "edpuzzle",    name: "Edpuzzle",        matchKeywords: ["edpuzzle"] },
  { id: "achieve3000",  name: "Achieve3000",    matchKeywords: ["achieve3000", "achieve 3000"] },
  { id: "gclassroom",  name: "Google Classroom", matchKeywords: ["google classroom"] },
  { id: "aleks",       name: "McGraw Hill / ALEKS", matchKeywords: ["aleks", "mcgraw hill", "mcgraw-hill", "mheducation"] },
  { id: "readingplus", name: "Reading Plus",    matchKeywords: ["reading plus"] },
  { id: "iready",      name: "i-Ready",         matchKeywords: ["i-ready", "iready"] },
  { id: "bigideasmath",name: "Big Ideas Math",  matchKeywords: ["big ideas math", "bigideasmath", "bim"] },
  { id: "lumio",       name: "Lumio",           matchKeywords: ["lumio"] },
  { id: "sadlier",     name: "Sadlier",         matchKeywords: ["sadlier", "vocabulary workshop"] },
  { id: "goformative", name: "Go-Formative",    matchKeywords: ["go-formative", "goformative", "formative"] },
];

// In-memory only — intentionally not persisted, see credential note in the UI.
let linkedSites = [];
let liveSiteConnections = {};

function mergeSiteConnections(sites) {
  liveSiteConnections = sites || {};
  for (const payload of Object.values(liveSiteConnections)) {
    const existing = linkedSites.find((site) => site.catalogId === payload.providerId);
    const catalog = homeworkSitesCatalog.find((entry) => entry.id === payload.providerId);
    const next = { catalogId: payload.providerId, name: payload.providerName || catalog?.name || payload.hostname, authMethod: "existing-session", linked: true, lastVerified: payload.syncedAt ? new Date(payload.syncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null, url: payload.pageUrl, hostname: payload.hostname };
    if (existing) Object.assign(existing, next); else linkedSites.push(next);
  }
  renderSiteList();
}

function siteInitial(name) { return name.trim().charAt(0).toUpperCase() || "•"; }

function renderSiteList() {
  const listEl = document.getElementById("site-list");
  const allSites = [
    ...homeworkSitesCatalog.map(c => {
      const linked = linkedSites.find(s => s.catalogId === c.id);
      return linked || { catalogId: c.id, name: c.name, authMethod: null, linked: false };
    }),
    ...linkedSites.filter(s => !s.catalogId), // custom sites the student added
  ];

  listEl.innerHTML = allSites.map((s, i) => {
    const statusText = !s.linked
      ? "Not linked"
      : s.authMethod === "classlink"
        ? `Linked <span class="badge-classlink">via existing session</span>`
        : "Linked · open tab session";
    return `
      <div class="site-card">
        <div class="site-icon">${siteInitial(s.name)}</div>
        <div class="site-main">
          <div class="site-name">${s.name}</div>
          <div class="site-status ${s.linked ? "linked" : ""}">${statusText}${s.lastVerified ? " · checked " + s.lastVerified : ""}</div>
        </div>
        <div class="site-actions">
          ${s.linked
            ? `<button data-verify="${i}" class="primary">Verify now</button><button data-unlink="${i}">Unlink</button>`
            : `<span class="link-instruction">Open this website and log in to link!</span>`
          }
        </div>
      </div>`;
  }).join("");

  listEl.querySelectorAll("[data-unlink]").forEach(btn => {
    btn.addEventListener("click", () => {
      const site = allSites[Number(btn.getAttribute("data-unlink"))];
      linkedSites = linkedSites.filter(s => s !== site);
      renderSiteList();
    });
  });
  listEl.querySelectorAll("[data-verify]").forEach(btn => {
    btn.addEventListener("click", () => {
      const site = allSites[Number(btn.getAttribute("data-verify"))];
      runVerification(site);
    });
  });
}

// Mock verification pass: "visits" the homework site and reconciles
// its completion state against the Canvas assignments Docket already
// knows about, by keyword-matching titles/course names to the site.
// In production this step is the Chrome extension issuing an
// authenticated request (via the ClassLink session or the site's
// gradebook API) instead of simulated steps + existing mock scores.
async function runVerification(site) {
  const statusLine = document.getElementById("verify-status-line");
  const steps = site.authMethod === "classlink"
    ? [`Opening ${classLinkLoginUrl() || "ClassLink"}…`, `Launching ${site.name} through ClassLink SSO…`, `Reading ${site.name} gradebook…`, "Reconciling with Canvas assignments…"]
    : [`Signing in to ${site.name}…`, `Reading ${site.name} gradebook…`, "Reconciling with Canvas assignments…"];

  for (const step of steps) {
    statusLine.textContent = step;
    await new Promise(r => setTimeout(r, 450));
  }

  const catalogEntry = homeworkSitesCatalog.find(c => c.id === site.catalogId);
  const keywords = catalogEntry ? catalogEntry.matchKeywords : [site.name.toLowerCase()];
  const matches = canvasAssignments.filter(a => {
    const course = canvasCourses.find(c => c.id === a.courseId);
    return keywords.some(k => a.title.toLowerCase().includes(k) || (course && course.name.toLowerCase().includes(k)));
  });

  const results = matches.length ? matches : canvasAssignments.filter(a => a.title.toLowerCase().includes(site.name.toLowerCase()));
  const logListEl = document.getElementById("verify-log-list");
  const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (results.length === 0) {
    logListEl.innerHTML = `<div class="verify-log-entry"><span class="vdot pending"></span>No ${site.name} assignments found on Canvas to reconcile yet.</div>` + logListEl.innerHTML;
  } else {
    results.forEach(a => {
      const sub = currentSubmissions()[a.id] || {};
      const done = sub.ixlSmartScore != null ? sub.ixlSmartScore >= 80 : !!sub.submitted;
      const entry = document.createElement("div");
      entry.className = "verify-log-entry";
      entry.innerHTML = `<span class="vdot ${done ? "done" : "pending"}"></span>
        <span>${a.title} — ${done ? "confirmed complete on " + site.name : "assigned but not finished on " + site.name + " yet"}</span>`;
      logListEl.prepend(entry);
    });
  }

  site.lastVerified = timestamp;
  statusLine.textContent = `Last verification pass finished at ${timestamp}.`;
  renderSiteList();
  renderPanels(); // reflect any newly-verified state on the assignment cards
}

/* ================================================================
   EXTENSION BRIDGE
   When this page is opened as a packaged extension page (rather
   than dragged in as a plain file), chrome.storage is available and
   may hold real data content-script.js scraped from an open Canvas tab.
   Opened as a plain file, chrome.storage is undefined and the mock data
   drives the preview.
   ================================================================ */
let liveAssignments = null;
let liveSubmissions = null;
let liveCourses = null;
function loadScrapedDataIfExtension() {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return;
  chrome.runtime.sendMessage({ type: "DOCKET_GET_CONNECTIONS" }, response => {
    if (chrome.runtime.lastError || !response?.ok) return;
    applyLiveSync(response.sync);
    mergeSiteConnections(response.sites);
  });
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === "DOCKET_SYNC_UPDATED") applyLiveSync(message.payload);
  });
}
function applyLiveSync(scraped) {
  if (!scraped) return;
  liveAssignments = Array.isArray(scraped.assignments) && scraped.assignments.some(a => a.source === "canvas-api") ? scraped.assignments : null;
  liveSubmissions = scraped.submissions || null;
  liveCourses = scraped.courses || null;
  const stamp = scraped.syncedAt ? new Date(scraped.syncedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "just now";
  const syncLine = document.getElementById("sync-line");
  if (syncLine) syncLine.textContent = liveAssignments ? `Connected to Canvas · last synced ${stamp}` : "Canvas page connected · DOM fallback awaiting API access";
  renderSubjectNav();
  renderPanels();
}

/* ================================================================
   RENDERING
   ================================================================ */
const assignmentPanelsEl = document.getElementById("assignment-panels");
const subjectNavEl = document.getElementById("subject-nav");

function currentAssignments() { return liveAssignments || canvasAssignments; }
function currentSubmissions() { return liveSubmissions || canvasSubmissions; }
function currentCourses() { return liveCourses || canvasCourses; }
function buildGroupedData() {
  const groups = {};
  currentAssignments().forEach(a => {
    const course = a.course || currentCourses().find(c => Number(c.id) === Number(a.courseId)) || { name: "Canvas course", subjectHint: "general" };
    const subjectKey = course.subjectHint || a.subjectHint || deduceSubjectFromCourseName(course.name);
    if (!groups[subjectKey]) groups[subjectKey] = [];
    groups[subjectKey].push({ ...a, course, subjectKey });
  });
  return groups;
}

function fmtDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function isOverdue(iso) {
  return new Date(iso + "T23:59:59") < new Date();
}

function renderAssignmentCard(a) {
  const sub = currentSubmissions()[a.id] || {};
  const skillCodes = extractSkillCodes(a.title + " " + a.description);
  const subjectMeta = SUBJECT_KEYWORDS[a.subjectKey] || { color: "var(--accent)" };
  const overdue = isOverdue(a.dueDate) && !sub.submitted;

  let sideHtml;
  if (sub.ixlSmartScore != null && sub.ixlSmartScore >= 80) {
    sideHtml = `
      <div class="status-verified">✓ VERIFIED COMPLETED</div>
      <div class="smartscore">SmartScore ${sub.ixlSmartScore}</div>`;
  } else if (sub.ixlSmartScore != null) {
    sideHtml = `
      <button class="launch-btn" data-launch="${a.id}">Launch IXL</button>
      <div class="smartscore">SmartScore ${sub.ixlSmartScore} · needs 80+</div>`;
  } else if (sub.submitted) {
    sideHtml = `<div class="status-verified">✓ SUBMITTED</div>`;
  } else {
    sideHtml = `
      <button class="launch-btn" data-launch="${a.id}">Open assignment</button>
      ${overdue ? '<div class="status-overdue">OVERDUE</div>' : ""}`;
  }

  const chips = skillCodes.map(c => `<span class="skill-chip">${c}</span>`).join("");

  return `
    <div class="assign-card" style="--subj-color:${subjectMeta.color}">
      <div class="assign-main">
        <div class="assign-top">
          <span class="assign-title">${a.title}</span>
        </div>
        <div class="assign-course">${a.course.name}</div>
        <div class="assign-desc">${a.description}</div>
        ${chips ? `<div class="skill-codes">${chips}</div>` : ""}
        <div class="assign-meta">
          <span>Due ${fmtDate(a.dueDate)}</span>
          <span>${a.points} pts</span>
        </div>
      </div>
      <div class="assign-side">${sideHtml}</div>
    </div>`;
}

let activeSubjectFilter = "all";

function renderPanels() {
  const groups = buildGroupedData();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const twoWeeksFromToday = new Date(today);
  twoWeeksFromToday.setDate(twoWeeksFromToday.getDate() + 14);
  const categorized = { upcoming: [], missing: [], submitted: [] };

  Object.values(groups).flat().forEach(assignment => {
    const submission = currentSubmissions()[assignment.id] || {};
    if (submission.submitted) {
      categorized.submitted.push(assignment);
      return;
    }
    const due = new Date(`${assignment.dueDate}T23:59:59`);
    if (due < today) categorized.missing.push(assignment);
    else if (due <= twoWeeksFromToday) categorized.upcoming.push(assignment);
  });

  const sections = [
    { key: "upcoming", title: "Due in the next 2 weeks", subtitle: "Stay ahead of what is coming up." },
    { key: "missing", title: "Missing work", subtitle: "Assignments past their due date that still need attention." },
    { key: "submitted", title: "Submitted work", subtitle: "Work already turned in through Canvas." },
  ];

  assignmentPanelsEl.innerHTML = sections.map(section => {
    const items = categorized[section.key].filter(item => activeSubjectFilter === "all" || item.subjectKey === activeSubjectFilter);
    return `<section class="panel-block">
      <div class="panel-block-head">
        <h2>${section.title}</h2>
        <span class="count">${items.length} assignment${items.length === 1 ? "" : "s"}</span>
      </div>
      <p class="section-subtitle">${section.subtitle}</p>
      <div>${items.length ? items.map(renderAssignmentCard).join("") : '<div class="empty-state">Nothing here right now.</div>'}</div>
    </section>`;
  }).join("");

  document.querySelectorAll("[data-launch]").forEach(btn => {
    btn.addEventListener("click", () => {
      const assignment = currentAssignments().find(item => String(item.id) === String(btn.dataset.launch));
      const url = assignment?.url || classLinkLoginUrl();
      btn.textContent = "Opening…";
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage && url) {
        chrome.runtime.sendMessage({ type: "DOCKET_OPEN_TAB", url }, response => {
          btn.textContent = response?.ok ? "Opened in new tab" : "Could not open";
        });
      } else if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
        btn.textContent = "Opened in new tab";
      } else {
        btn.textContent = "Connect Canvas first";
      }
    });
  });
}

function renderSubjectNav() {
  const groups = buildGroupedData();
  let html = `<button class="subject-btn ${activeSubjectFilter === "all" ? "active" : ""}" data-subject="all">
      <span class="label">All subjects</span>
      <span class="subject-count">${canvasAssignments.length}</span>
    </button>`;

  Object.keys(groups).forEach(key => {
    const meta = SUBJECT_KEYWORDS[key] || { label: "General", color: "#8a8f9e" };
    html += `
      <button class="subject-btn ${activeSubjectFilter === key ? "active" : ""}" data-subject="${key}" style="--subj-color:${meta.color}">
        <span class="label"><span class="subject-dot"></span>${meta.label}</span>
        <span class="subject-count">${groups[key].length}</span>
      </button>`;
  });
  subjectNavEl.innerHTML = html;

  subjectNavEl.querySelectorAll("[data-subject]").forEach(btn => {
    btn.addEventListener("click", () => {
      activeSubjectFilter = btn.getAttribute("data-subject");
      renderSubjectNav();
      renderPanels();
    });
  });
}

/* ================================================================
   SEARCH
   ================================================================ */
document.getElementById("search").addEventListener("input", e => {
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll(".assign-card").forEach(card => {
    card.style.display = card.textContent.toLowerCase().includes(q) ? "" : "none";
  });
});

/* ================================================================
   FIRST-LAUNCH MODAL + QUIET BADGE
   ================================================================ */
const modalOverlay = document.getElementById("modal-overlay");
const linkBadge = document.getElementById("link-badge");

function initFirstLaunch() {
  const dismissed = localStorage.getItem("docket_accounts_prompt_dismissed");
  const linked = localStorage.getItem("docket_accounts_linked");
  if (linked) { modalOverlay.classList.add("hidden"); linkBadge.classList.add("hidden"); return; }
  if (dismissed) { modalOverlay.classList.add("hidden"); linkBadge.classList.remove("hidden"); return; }
  modalOverlay.classList.remove("hidden");
}

document.getElementById("modal-later-btn").addEventListener("click", () => {
  modalOverlay.classList.add("hidden");
  localStorage.setItem("docket_accounts_prompt_dismissed", "1");
  linkBadge.classList.remove("hidden");
});
document.getElementById("modal-link-btn").addEventListener("click", () => {
  modalOverlay.classList.add("hidden");
  localStorage.setItem("docket_accounts_linked", "1");
  linkBadge.classList.add("hidden");
  document.getElementById("open-linked-accounts-btn").click();
});
linkBadge.addEventListener("click", () => {
  modalOverlay.classList.remove("hidden");
});

/* ================================================================
   LOGIN / REGISTER (quiet, local-only mock)
   ================================================================ */
document.querySelectorAll(".auth-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    const isLogin = tab.dataset.tab === "login";
    document.getElementById("auth-login").style.display = isLogin ? "" : "none";
    document.getElementById("auth-register").style.display = isLogin ? "none" : "";
    document.getElementById("auth-submit-btn").textContent = isLogin ? "Continue" : "Create account";
  });
});
document.getElementById("auth-submit-btn").addEventListener("click", () => {
  // Mock only — production posts to a real auth endpoint (e.g. Canvas OAuth / district SSO).
  document.getElementById("auth-confirm").style.display = "block";
  localStorage.setItem("docket_accounts_linked", "1");
  linkBadge.classList.add("hidden");
});

/* ================================================================
   SETTINGS DRAWER / THEMING ENGINE
   ================================================================ */
const drawer = document.getElementById("settings-drawer");
document.getElementById("open-settings-btn").addEventListener("click", () => drawer.classList.add("open"));
document.getElementById("settings-icon-btn").addEventListener("click", () => drawer.classList.add("open"));
document.getElementById("close-settings-btn").addEventListener("click", () => drawer.classList.remove("open"));

function setDark(on) {
  document.documentElement.setAttribute("data-theme", on ? "dark" : "light");
  localStorage.setItem("docket_dark", on ? "1" : "0");
}
document.getElementById("dark-switch").addEventListener("click", () => {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  setDark(!isDark);
});
document.getElementById("theme-toggle-btn").addEventListener("click", () => {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  setDark(!isDark);
});

function setAccent(hex) {
  document.documentElement.style.setProperty("--accent", hex);
  document.getElementById("accent-picker").value = hex;
}
function setSidebar(hex) {
  document.documentElement.style.setProperty("--sidebar-bg", hex);
  document.getElementById("sidebar-picker").value = hex;
}
document.getElementById("accent-picker").addEventListener("input", e => setAccent(e.target.value));
document.getElementById("sidebar-picker").addEventListener("input", e => setSidebar(e.target.value));
document.getElementById("alpha-slider").addEventListener("input", e => {
  document.documentElement.style.setProperty("--card-alpha", (e.target.value / 100).toString());
});

// --- Background upload (image / gif / mp4) via Object URL, gated by moderation ---
const bgLayer = document.getElementById("bg-layer");
document.getElementById("bg-upload").addEventListener("change", e => {
  const file = e.target.files[0];
  const msgEl = document.getElementById("bg-moderation-msg");
  if (!file) return;

  const result = moderateContent({ name: file.name, file, kind: "background" });
  if (!result.approved) {
    msgEl.textContent = result.reason;
    msgEl.className = "moderation-msg error";
    e.target.value = "";
    return;
  }
  msgEl.textContent = "Background approved and applied.";
  msgEl.className = "moderation-msg ok";

  const url = URL.createObjectURL(file);
  bgLayer.innerHTML = "";
  if (file.type.startsWith("video/")) {
    const video = document.createElement("video");
    video.src = url; video.autoplay = true; video.loop = true; video.muted = true; video.playsInline = true;
    bgLayer.appendChild(video);
  } else {
    bgLayer.style.backgroundImage = `url(${url})`;
  }
});

// --- Font upload via FontFace API + Object URL, gated by moderation ---
document.getElementById("font-upload").addEventListener("change", async e => {
  const file = e.target.files[0];
  const msgEl = document.getElementById("font-moderation-msg");
  if (!file) return;

  const result = moderateContent({ name: file.name, file, kind: "font" });
  if (!result.approved) {
    msgEl.textContent = result.reason;
    msgEl.className = "moderation-msg error";
    e.target.value = "";
    return;
  }
  try {
    const url = URL.createObjectURL(file);
    const fontFace = new FontFace("DocketUserFont", `url(${url})`);
    await fontFace.load();
    document.fonts.add(fontFace);
    document.documentElement.style.setProperty("--font-user", "'DocketUserFont', " + getComputedStyle(document.documentElement).getPropertyValue('--font-body'));
    msgEl.textContent = "Font approved and applied.";
    msgEl.className = "moderation-msg ok";
  } catch (err) {
    msgEl.textContent = "Could not load that font file.";
    msgEl.className = "moderation-msg error";
  }
});

// --- ClassLink subdomain setup ---
document.getElementById("classlink-subdomain").value = classLinkConfig.subdomain;
document.getElementById("save-classlink-btn").addEventListener("click", () => {
  const val = document.getElementById("classlink-subdomain").value.trim();
  classLinkConfig.subdomain = val;
  localStorage.setItem("docket_classlink_subdomain", val);
  document.getElementById("classlink-domain-display").textContent = val ? `${val}.classlink.com` : "not connected";
});

document.getElementById("reset-theme-btn").addEventListener("click", () => applyTheme(communityThemes[3]));

/* ================================================================
   COMMUNITY THEMES MARKETPLACE
   ================================================================ */
const marketOverlay = document.getElementById("marketplace-overlay");
const themeGrid = document.getElementById("theme-grid");

document.getElementById("open-marketplace-btn").addEventListener("click", () => {
  marketOverlay.classList.remove("hidden");
  renderThemeGrid(communityThemes);
});
document.getElementById("close-marketplace-btn").addEventListener("click", () => marketOverlay.classList.add("hidden"));

function renderThemeGrid(list) {
  themeGrid.innerHTML = list.map((t, i) => `
    <div class="theme-tile">
      <div class="swatch" style="background:${t.swatch}"></div>
      <div class="tinfo">
        <div class="tname">${t.name}</div>
        <div class="ttags">${t.tags.join(" · ")}</div>
        <button data-apply="${i}">Apply</button>
      </div>
    </div>
  `).join("");

  themeGrid.querySelectorAll("[data-apply]").forEach(btn => {
    btn.addEventListener("click", () => applyTheme(list[Number(btn.dataset.apply)]));
  });
}

function applyTheme(t) {
  setAccent(t.accent);
  setSidebar(t.sidebar);
}

document.getElementById("theme-search").addEventListener("input", e => {
  const q = e.target.value.trim().toLowerCase();
  const filtered = communityThemes.filter(t =>
    t.name.toLowerCase().includes(q) || t.tags.some(tag => tag.includes(q))
  );
  renderThemeGrid(filtered);
});

document.getElementById("publish-btn").addEventListener("click", () => {
  const name = document.getElementById("publish-name").value.trim();
  const tags = document.getElementById("publish-tags").value.split(",").map(s => s.trim()).filter(Boolean);
  const msgEl = document.getElementById("publish-moderation-msg");

  if (!name) {
    msgEl.textContent = "Give your theme a name first.";
    msgEl.className = "moderation-msg error";
    return;
  }

  const result = moderateContent({ name, tags, kind: "text" });
  if (!result.approved) {
    msgEl.textContent = result.reason;
    msgEl.className = "moderation-msg error";
    return;
  }

  // Mock publish — production POSTs to /api/community-themes after
  // the file-level Cloud Vision / Rekognition check described in
  // moderateContent() has cleared any attached thumbnail or media.
  communityThemes.push({
    name, tags,
    accent: document.getElementById("accent-picker").value,
    sidebar: document.getElementById("sidebar-picker").value,
    swatch: `linear-gradient(135deg, ${document.getElementById("accent-picker").value}, ${document.getElementById("sidebar-picker").value})`,
  });
  msgEl.textContent = "Theme published to the community (mock).";
  msgEl.className = "moderation-msg ok";
  document.getElementById("publish-name").value = "";
  document.getElementById("publish-tags").value = "";
  renderThemeGrid(communityThemes);
});

/* ================================================================
   LINKED HOMEWORK SITES — panel wiring
   ================================================================ */
const linkedOverlay = document.getElementById("linked-accounts-overlay");
document.getElementById("open-linked-accounts-btn").addEventListener("click", () => {
  linkedOverlay.classList.remove("hidden");
  document.getElementById("la-classlink-subdomain").value = classLinkConfig.subdomain;
  document.getElementById("la-classlink-customurl").value = classLinkConfig.customUrl;
  renderSiteList();
});
document.getElementById("close-linked-accounts-btn").addEventListener("click", () => linkedOverlay.classList.add("hidden"));

function syncClassLinkFromPanel() {
  classLinkConfig.subdomain = document.getElementById("la-classlink-subdomain").value.trim();
  classLinkConfig.customUrl = document.getElementById("la-classlink-customurl").value.trim();
  localStorage.setItem("docket_classlink_subdomain", classLinkConfig.subdomain);
  localStorage.setItem("docket_classlink_customurl", classLinkConfig.customUrl);
  const display = classLinkLoginUrl() ? classLinkLoginUrl().replace(/^https?:\/\//, "") : "not connected";
  document.getElementById("classlink-domain-display").textContent = display;
  document.getElementById("classlink-subdomain").value = classLinkConfig.subdomain;
}
document.getElementById("la-classlink-subdomain").addEventListener("change", syncClassLinkFromPanel);
document.getElementById("la-classlink-customurl").addEventListener("change", syncClassLinkFromPanel);

document.querySelectorAll('input[name="authmethod"]').forEach(radio => {
  radio.addEventListener("change", () => {
    document.getElementById("direct-credential-fields").style.display =
      radio.value === "direct" && radio.checked ? "block" : "none";
  });
});

document.getElementById("add-site-btn").addEventListener("click", () => {
  const name = document.getElementById("new-site-name").value.trim();
  const url = document.getElementById("new-site-url").value.trim();
  const method = document.querySelector('input[name="authmethod"]:checked').value;

  if (!name) { document.getElementById("new-site-name").focus(); return; }

  const catalogEntry = homeworkSitesCatalog.find(c => c.name.toLowerCase() === name.toLowerCase());
  const entry = {
    catalogId: catalogEntry ? catalogEntry.id : null,
    name, loginUrl: url || null,
    authMethod: method, linked: true, lastVerified: null,
  };
  // Direct-login credentials, if provided, live only on this object in
  // memory for the current tab — never persisted, logged, or sent anywhere
  // in this preview build (see the note in the panel above the form).
  if (method === "direct") {
    entry.hasCredentials = !!(document.getElementById("new-site-user").value && document.getElementById("new-site-pass").value);
  }

  linkedSites = linkedSites.filter(s => s.name.toLowerCase() !== name.toLowerCase());
  linkedSites.push(entry);

  document.getElementById("new-site-name").value = "";
  document.getElementById("new-site-url").value = "";
  document.getElementById("new-site-user").value = "";
  document.getElementById("new-site-pass").value = "";
  renderSiteList();
});

/* ================================================================
   INIT
   ================================================================ */
const loadingFacts = [
  "Fun fact: Octopuses have three hearts.",
  "Fun fact: Honey never spoils when stored properly.",
  "Fun fact: A group of flamingos is called a flamboyance.",
  "Fun fact: Bananas are berries, but strawberries are not.",
  "Fun fact: The first computer mouse was made of wood.",
];

function showStartupLoading() {
  const loadingScreen = document.getElementById("loading-screen");
  const fact = document.getElementById("loading-fact");
  fact.textContent = loadingFacts[Math.floor(Math.random() * loadingFacts.length)];
  window.setTimeout(() => loadingScreen.classList.add("is-hidden"), 1000);
}

function init() {
  if (localStorage.getItem("docket_dark") === "1") setDark(true);
  const savedSubdomain = classLinkConfig.subdomain;
  if (savedSubdomain) document.getElementById("classlink-domain-display").textContent = `${savedSubdomain}.classlink.com`;

  renderSubjectNav();
  renderPanels();
  renderSiteList();
  loadScrapedDataIfExtension();
  initFirstLaunch();
  showStartupLoading();
}
init();

})();
