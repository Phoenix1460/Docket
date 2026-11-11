// Docket service worker. Sessions stay in the user's browser; only normalized
// assignment metadata and connection status are stored in extension storage.
const CANVAS_KEY = "docket_canvas_sync";
const SITE_KEY = "docket_site_connections";
const SETTINGS_KEY = "docket_connection_settings";

const validUrl = (value) => {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : null; } catch { return null; }
};

chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") }));
chrome.runtime.onInstalled.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") }));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "DOCKET_SITE_SYNC" && message.payload?.providerId) {
    const payload = { ...message.payload, tabId: sender.tab?.id || null };
    chrome.storage.local.get([SITE_KEY], (data) => {
      const sites = { ...(data[SITE_KEY] || {}), [payload.providerId]: payload };
      const writes = { [SITE_KEY]: sites };
      if (payload.providerId === "canvas") writes[CANVAS_KEY] = payload;
      chrome.storage.local.set(writes, () => {
        chrome.runtime.sendMessage({ type: "DOCKET_SYNC_UPDATED", payload }, () => void chrome.runtime.lastError);
        sendResponse({ ok: !chrome.runtime.lastError });
      });
    });
    return true;
  }
  if (message?.type === "DOCKET_GET_CONNECTIONS") {
    chrome.storage.local.get([CANVAS_KEY, SITE_KEY, SETTINGS_KEY], (data) => sendResponse({ ok: true, sync: data[CANVAS_KEY] || null, sites: data[SITE_KEY] || {}, settings: data[SETTINGS_KEY] || {} }));
    return true;
  }
  if (message?.type === "DOCKET_OPEN_TAB") {
    const url = validUrl(message.url);
    if (!url) { sendResponse({ ok: false, error: "Only http and https links are allowed." }); return true; }
    chrome.tabs.create({ url }, () => sendResponse({ ok: !chrome.runtime.lastError }));
    return true;
  }
});
