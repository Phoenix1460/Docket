// Docket authenticated-site connector. Runs only in the tab the student opened and
// reuses that site's existing session; it never asks for or stores passwords.
(() => {
  "use strict";

  const MESSAGE = "DOCKET_SITE_SYNC";
  const CANVAS_API = "/api/v1";
  const CATALOG = [
    ["canvas", "Canvas", ["instructure.com"]],
    ["ixl", "IXL", ["ixl.com"]],
    ["readingplus", "Reading Plus", ["readingplus.com", "readingplus.org"]],
    ["deltamath", "DeltaMath", ["deltamath.com"]],
    ["studyisland", "Study Island", ["studyisland.com"]],
    ["edpuzzle", "Edpuzzle", ["edpuzzle.com"]],
    ["achieve3000", "Achieve3000", ["achieve3000.com"]],
    ["gclassroom", "Google Classroom", ["classroom.google.com"]],
    ["aleks", "ALEKS", ["aleks.com", "mheducation.com"]],
    ["iready", "i-Ready", ["i-ready.com"]],
    ["bigideasmath", "Big Ideas Math", ["bigideasmath.com"]],
    ["lumio", "Lumio", ["lumio.com"]],
    ["sadlier", "Sadlier", ["sadlier.com"]],
    ["goformative", "GoFormative", ["goformative.com"]],
  ];

  const site = CATALOG.find(([, , hosts]) => hosts.some((host) => location.hostname === host || location.hostname.endsWith(`.${host}`)));
  if (!site) return;

  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const send = (payload) => chrome.runtime.sendMessage({ type: MESSAGE, payload }, () => void chrome.runtime.lastError);

  function pageAssignments() {
    const selectors = ["a[href*='assignment']", "a[href*='activity']", "a[href*='lesson']", "[class*='assignment']", "[class*='activity']", "[class*='lesson']", "[class*='problem']", "[class*='exercise']", "[class*='task']", "[data-testid*='assignment']", "[data-testid*='activity']"];
    const seen = new Set();
    return [...document.querySelectorAll(selectors.join(","))].map((node) => {
      const title = clean(node.textContent || node.getAttribute("aria-label"));
      const url = node.href || location.href;
      if (!title || title.length < 3 || title.length > 180 || seen.has(`${title}|${url}`)) return null;
      seen.add(`${title}|${url}`);
      return { title, url, source: "authenticated-page" };
    }).filter(Boolean).slice(0, 100).map((assignment) => {
      const node = [...document.querySelectorAll(selectors.join(","))].find((candidate) => clean(candidate.textContent || candidate.getAttribute("aria-label")) === assignment.title);
      const card = node?.closest("article, li, tr, [class*='card'], [class*='assignment'], [class*='activity'], [data-testid*='assignment'], [data-testid*='activity']") || node?.parentElement || node;
      const context = clean(card?.innerText || node?.innerText || "");
      const attributes = clean(`${card?.getAttribute("aria-label") || ""} ${card?.getAttribute("data-status") || ""} ${card?.getAttribute("data-state") || ""} ${card?.className || ""}`);
      const text = `${context} ${attributes}`.toLowerCase();
      const completionMarker = /\b(completed|finished|mastered|submitted|passed|done|100\s*%|checkmark|check mark)\b/.test(text);
      const incompleteMarker = /\b(incomplete|not completed|in progress|unfinished|attempt|start|continue|assigned|not started)\b/.test(text);
      return { ...assignment, description: `${context} ${attributes}`.trim(), completed: completionMarker && !incompleteMarker };
    });
  }

  async function fetchAll(path) {
    const result = [];
    let next = `${CANVAS_API}${path}`;
    while (next) {
      const response = await fetch(next, { credentials: "include", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Canvas API ${response.status}`);
      result.push(...await response.json());
      const link = response.headers.get("Link") || "";
      next = link.match(/<([^>]+)>;\s*rel="next"/)?.[1] || null;
    }
    return result;
  }

  async function canvasPayload() {
    const courses = (await fetchAll("/courses?enrollment_state=active&state[]=available&per_page=100")).filter((course) => course.id && course.name);
    const assignments = [];
    const submissions = {};
    for (const course of courses) {
      const [courseAssignments, courseSubmissions] = await Promise.all([
        fetchAll(`/courses/${course.id}/assignments?include[]=submission&per_page=100`),
        fetchAll(`/courses/${course.id}/students/submissions?student_ids[]=self&include[]=assignment&per_page=100`).catch(() => []),
      ]);
      courseAssignments.forEach((assignment) => assignments.push({
        id: Number(assignment.id), courseId: Number(course.id), title: assignment.name || "Untitled assignment",
        description: clean((assignment.description || "").replace(/<[^>]*>/g, " ")),
        dueDate: assignment.due_at?.slice(0, 10) || new Date().toISOString().slice(0, 10),
        points: Number(assignment.points_possible || 0), url: assignment.html_url || location.href,
        source: "canvas-api", course: { id: Number(course.id), name: course.name, subjectHint: "general" },
      }));
      courseSubmissions.forEach((submission) => { submissions[Number(submission.assignment_id)] = { submitted: Boolean(submission.submitted_at), submittedAt: submission.submitted_at || null, score: submission.score, workflowState: submission.workflow_state || null }; });
    }
    return { courses, assignments, submissions };
  }

  async function sync() {
    const [id, name, hosts] = site;
    const payload = { providerId: id, providerName: name, hostname: location.hostname, origin: location.origin, pageUrl: location.href, title: document.title, syncedAt: new Date().toISOString(), authenticated: true, assignments: pageAssignments(), pageText: clean(document.body?.innerText).slice(0, 12000) };
    if (id === "canvas") {
      try { Object.assign(payload, await canvasPayload()); } catch (error) { payload.error = error.message; }
    }
    send(payload);
  }

  const run = () => setTimeout(sync, 700);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true }); else run();
  let lastUrl = location.href;
  new MutationObserver(() => { if (location.href !== lastUrl) { lastUrl = location.href; sync(); } }).observe(document, { subtree: true, childList: true });
})();
