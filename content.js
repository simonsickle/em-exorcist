// ---- cross-browser API
const api = (function() {
  if (typeof browser !== "undefined" && browser.runtime) return browser;
  if (typeof chrome !== "undefined" && chrome.runtime) return chrome;
  return { storage: null, runtime: null };
})();

// ---- config
const SEP = { period: ". ", comma: ", ", ensp: " – " };
let mode = "period";

// prefer Unicode-capable capitalize if supported
let capitalizeRe = /\. ([a-z])/g; // ASCII fallback
try {
  // Test if Unicode property escapes are supported
  new RegExp("\\p{Ll}", "u");
  capitalizeRe = /\. (\p{Ll})/gu; // Upgrade
} catch (_) { /* stick to ASCII */ }

// ---- storage
api.storage?.sync?.get({ mode: "period" }, v => { if (v && v.mode) mode = v.mode; });
api.storage?.onChanged?.addListener((c, area) => {
  if (area === "sync" && c.mode) { mode = c.mode.newValue; rescanAll(); }
});

// ---- contexts to skip
const BAD_ANCESTOR = new Set(["CODE","PRE","TEXTAREA","INPUT","SCRIPT","STYLE"]);
const SELECTOR_SKIP = 'code, pre, textarea, input, [contenteditable="true"]';

// ---- helpers
function inBadContext(node) {
  let p = node && node.parentNode;
  while (p && p.nodeType === 1) {
    if (BAD_ANCESTOR.has(p.nodeName)) return true;
    if (p.matches && p.matches(SELECTOR_SKIP)) return true;
    if (p.msMatchesSelector && p.msMatchesSelector(SELECTOR_SKIP)) return true;
    p = p.parentNode;
  }
  return false;
}

function containsDashy(s) {
  return s && (s.indexOf("\u2014") >= 0 || s.indexOf("\u2013") >= 0 || /\s-\s/.test(s));
}

// ---- processed cache
const processed = new WeakMap(); // Text -> version
let version = 1;

// ---- transformation
function transformNode(node) {
  if (!node || node.nodeType !== Node.TEXT_NODE) return;
  if (processed.get(node) === version) return;

  const s = node.nodeValue || "";
  if (!s || s.length < 2 || !containsDashy(s)) {
    processed.set(node, version);
    return;
  }

  let t = s;
  // normalize em/en dashes with optional spaces and nbsp
  t = t.replace(/(\s|\u00a0)?[—–](\s|\u00a0)?/g, SEP[mode]);
  // kill space-hyphen-space used as punctuation
  t = t.replace(/\s-\s/g, SEP[mode]);
  // collapse multi-dots
  t = t.replace(/\.{2,}/g, ". ");
  // capitalize after ". "
  if (mode === "period") t = t.replace(capitalizeRe, (_, ch) => ". " + ch.toUpperCase());

  if (t !== s) node.nodeValue = t;
  processed.set(node, version);

  // cross-node capitalization
  if (mode === "period" && /\.\s*$/.test(t)) {
    let next = node;
    for (let hop = 0; hop < 4; hop++) { // don’t wander the universe
      next = next && next.nextSibling;
      if (!next) break;
      if (inBadContext(next)) break;

      if (next.nodeType === Node.TEXT_NODE) {
        const s2 = next.nodeValue || "";
        if (/^\s*[a-z]/.test(s2)) next.nodeValue = s2.replace(/^\s*[a-z]/, c => c.toUpperCase());
        processed.set(next, version);
        break;
      }
      if (next.nodeType === Node.ELEMENT_NODE && !next.matches(SELECTOR_SKIP)) {
        const tw = document.createTreeWalker(next, NodeFilter.SHOW_TEXT);
        const first = tw.nextNode();
        if (first) {
          const s3 = first.nodeValue || "";
          if (/^\s*[a-z]/.test(s3)) first.nodeValue = s3.replace(/^\s*[a-z]/, c => c.toUpperCase());
          processed.set(first, version);
        }
        break;
      }
    }
  }
}

// ---- queue + batching
const queue = new Set();
let scheduled = false;

function enqueueTextNodes(root) {
  if (!root) return;
  if (root.nodeType === Node.TEXT_NODE) {
    if (!inBadContext(root) && containsDashy(root.nodeValue || "")) queue.add(root);
    return;
  }
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = tw.nextNode())) {
    if (!inBadContext(n) && containsDashy(n.nodeValue || "")) queue.add(n);
  }
  // also walk open shadow roots shallowly
  if (root.querySelectorAll) {
    root.querySelectorAll("*").forEach(el => {
      if (el.shadowRoot) {
        const tw2 = document.createTreeWalker(el.shadowRoot, NodeFilter.SHOW_TEXT);
        let t;
        while ((t = tw2.nextNode())) {
          if (!inBadContext(t) && containsDashy(t.nodeValue || "")) queue.add(t);
        }
      }
    });
  }
}

function scheduleDrain() {
  if (scheduled) return;
  scheduled = true;
  if (window.requestIdleCallback) {
    window.requestIdleCallback(drain);
  } else {
    setTimeout(() => drain({ timeRemaining: () => 50, didTimeout: true }), 16);
  }
}

function drain(deadline) {
  scheduled = false;
  const start = performance.now();
  for (const n of queue) {
    queue.delete(n);
    transformNode(n);
    if (deadline && typeof deadline.timeRemaining === "function") {
      if (deadline.timeRemaining() < 5) { scheduleDrain(); return; }
    } else if (performance.now() - start > 8) {
      scheduleDrain(); return;
    }
  }
}

// ---- root selection
function getChatRoot() {
  return document.querySelector('[data-testid="conversation-turn"]')
      || document.querySelector('[data-testid="chat-messages"]')
      || document.querySelector('main')
      || document.body;
}

// ---- rescans
function rescanAll() {
  version++;
  enqueueTextNodes(getChatRoot());
  scheduleDrain();
}

// initial sweep
rescanAll();

// mutation observer on the chat root
const root = getChatRoot();
const mo = new MutationObserver(records => {
  for (const r of records) {
    for (const n of r.addedNodes) {
      if (n.nodeType === Node.TEXT_NODE) {
        if (!inBadContext(n) && containsDashy(n.nodeValue || "")) queue.add(n);
      } else if (n.nodeType === Node.ELEMENT_NODE) {
        const matchesSkip = (n.matches && n.matches(SELECTOR_SKIP)) || (n.msMatchesSelector && n.msMatchesSelector(SELECTOR_SKIP));
        if (!matchesSkip) enqueueTextNodes(n);
        // pick up text changes inside newly-added shadow roots too
        if (n.shadowRoot) enqueueTextNodes(n.shadowRoot);
      }
    }
    if (r.type === "characterData" && r.target?.nodeType === Node.TEXT_NODE) {
      const t = r.target;
      if (!inBadContext(t) && containsDashy(t.nodeValue || "")) queue.add(t);
    }
  }
  scheduleDrain();
});
mo.observe(root, { childList: true, subtree: true, characterData: true });

// periodic safety net (handles throttled idle callbacks or missed mutations)
setInterval(() => {
  enqueueTextNodes(getChatRoot());
  scheduleDrain();
}, 1500);
