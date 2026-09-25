# Docket — Chrome Extension

This is a complete Chrome extension: the toolbar opens the dashboard, and the
Canvas connector uses the authenticated page session to read courses,
assignments, due dates, and submissions through Canvas's official API. Data is
stored in `chrome.storage.local` so the dashboard can update across extension
tabs without collecting Canvas passwords or API tokens.

## What's in this folder

| File | What it does |
|---|---|
| `manifest.json` | Tells Chrome what the extension is and what it's allowed to do |
| `dashboard.html` | The full dashboard — same one from before, now extension-aware |
| `background.js` | Opens the dashboard tab when you click the icon |
| `content-script.js` | Runs on your Canvas pages; **starter template**, see below |
| `icons/` | Toolbar icon images |

## Load it in Chrome (unpacked / developer mode)

You don't need the Chrome Web Store for this — "unpacked" extensions load
straight from a folder on your computer, which is exactly how you test one
before publishing it.

1. Unzip this into a folder you won't move or delete later (e.g. `Documents/docket-extension`) — Chrome reads the extension live from wherever this folder sits.
2. Open Chrome and go to `chrome://extensions` in the address bar.
3. Turn on **Developer mode** — it's a toggle in the top-right corner of that page.
4. Click **Load unpacked**, a button that appears once Developer mode is on.
5. Select the `docket-extension` folder (the one containing `manifest.json`) and click **Select**.
6. Docket now appears as a card on the extensions page, and its icon shows up in your toolbar — click the puzzle-piece icon and pin it if you don't see it right away.
7. The dashboard should open automatically in a new tab the moment you load it. If not, click the toolbar icon.

## Test that it works

- **Dashboard opens**: click the toolbar icon any time — it should open (or refresh) the dashboard in a new tab. Assignments appear after Canvas sync.
- **It's really an extension now**: open the dashboard tab's DevTools console (right-click → Inspect → Console tab) and type `chrome.runtime.id` — if it prints an ID instead of an error, the page is running with extension privileges.
- **Content script is active**: visit any `instructure.com` Canvas page (your school's Canvas), open DevTools → Console, and refresh — after about a second you should NOT see errors from `content-script.js`. This confirms it ran; it's still a template, so it won't have found real assignments unless the CSS selectors happen to match your school's Canvas theme.
- **Reload after edits**: any time you change a file in this folder, go back to `chrome://extensions` and click the small reload icon on Docket's card — Chrome doesn't auto-refresh unpacked extensions.

## Making the content script actually read YOUR Canvas

`content-script.js` is a working template, not a finished scraper — every
school's Canvas theme has different HTML. To finish it:

1. Open your real Canvas assignments page in Chrome.
2. Right-click an assignment title → **Inspect**.
3. Look at the class names Chrome highlights (e.g. `ig-title`, `assignment-title`) and compare them to the selectors in `content-script.js`'s `scrapeAssignmentsIndexPage()` function — update them to match.
4. Better yet: Canvas has a real JSON API at `https://<yourschool>.instructure.com/api/v1/courses/:id/assignments` that returns clean data using your logged-in session — prefer that over scraping HTML wherever you can. The comments at the top of `content-script.js` explain how.
5. If your school's Canvas is NOT on an `instructure.com` address (some districts use a fully custom domain), update the `matches` and `host_permissions` entries in `manifest.json` to your real domain, then reload the extension.

## A few things worth knowing, since this is your first extension

- **Nothing here is published or public.** Loading "unpacked" only installs it in your own browser — nobody else can see or use it unless you hand them this folder and they load it themselves.
- **Permissions are scoped on purpose.** `manifest.json` only asks for access to `instructure.com` and `classlink.com` pages, plus local storage — it can't read or act on any other site you visit.
- **Credentials still aren't stored.** The "Linked homework sites" direct-login fields still only live in the dashboard tab's memory for that session, same as before — nothing new is written to disk by this extension packaging step.
- **This won't survive a browser restart perfectly yet.** Unpacked extensions do persist across restarts, but if you ever move or delete this folder, Chrome will disable the extension until you point it at the folder again via **Load unpacked**.
