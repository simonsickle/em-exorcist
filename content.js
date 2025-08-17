// Config
const SEP = { period: ". ", comma: ", ", ensp: " – " };
let mode = "period";

// Load saved mode
try {
  chrome.storage?.sync?.get({ mode: "period" }, v => { mode = v.mode; });
  chrome.storage?.onChanged?.addListener((c, area) => {
    if (area === "sync" && c.mode) {
      mode = c.mode.newValue;
      rescanAll();
    }
  });
} catch { /* storage not available in some odd contexts */ }

// Places we never touch
const BAD_ANCESTOR = new Set(["CODE","PRE","TEXTAREA","INPUT","SCRIPT","STYLE"]);
const SELECTOR_SKIP = 'code, pre, textarea, input, [contenteditable="true"]';

// Cache to avoid reprocessing
const processed = new WeakMap();  // Text -> version
let version = 1;

// Cheap precheck before regex
function containsDashy(s) {
  // em, en, or space-hyphen-space
  return s.indexOf("\u2014") >= 0 || s.indexOf("\u2013") >= 0 || /\s-\s/.test(s);
}

function inBadContext(node) {
  let p = node && node.parentNode;
  while (p && p.nodeType === 1) {
    if (BAD_ANCESTOR.has(p.nodeName) || (p.matches && p.matches(SELECTOR_SKIP))) return true;
    p = p.parentNode;
  }
  return false;
}

// Transform logic for a single text node
function transformNode(node) {
  if (!node || node.nodeType !== Node.TEXT_NODE) return;
  if (processed.get(node) === version) return;

  const s = node.nodeValue || "";
  if (!s || s.length < 2 || !containsDashy(s)) {
    processed.set(node, version);
    return;
  }

  let t = s;

  // Kill em/en dashes with the chosen separator
  t = t.replace(/(\s|\u00a0)?[—–](\s|\u00a0)?/g, SEP[mode]);

  // Kill space-hyphen-space used like punctuation
  t = t.replace(/\s-\s/g, SEP[mode]);

  // Collapse triple periods from multiple replacements
  t = t.replace(/\.{2,}/g, ". ");

  // Capitalize after ". " within the same node
  if (mode === "period") {
    t = t.replace(/\. (\p{Ll})/gu, (_, ch) => ". " + ch.toUpperCase());
  }

  if (t !== s) {
    node.nodeValue = t;
  }
  processed.set(node, version);

  // Cross-node capitalization if this node ends with ". "
  if (mode === "period" && /\.\s*$/.test(t)) {
    let next = node;
    // Look ahead through siblings to find the first text chunk we can capitalize
    while ((next = next.nextSibling)) {
      if (inBadContext(next)) break;
      if (next.nodeType === Node.TEXT_NODE) {
        const s2 = next.nodeValue || "";
        if (/^\s*[a-z]/.test(s2)) {
          next.nodeValue = s2.replace(/^\s*[a-z]/, c => c.toUpperCase());
        }
        processed.set(next, version);
        break;
      }
      if (next.nodeType === Node.ELEMENT_NODE && !next.matches(SELECTOR_SKIP)) {
        const tw = document.createTreeWalker(next, NodeFilter.SHOW_TEXT);
        const first = tw.nextNode();
        if (first) {
          const s3 = first.nodeValue || "";
          if (/^\s*[a-z]/.test(s3)) {
            first.nodeValue = s3.replace(/^\s*[a-z]/, c => c.toUpperCase());
          }
          processed.set(first, version);
        }
        break;
      }
    }
  }
}

// Queue and batch processing to stay smooth
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
}

function scheduleDrain() {
  if (scheduled) return;
  scheduled = true;
  const idle = window.requestIdleCallback || (f => setTimeout(() => f({ timeRemaining: () => 50, didTimeout: true }), 0));
  idle(drain);
}

function drain(deadline) {
  scheduled = false;
  const start = performance.now();
  for (const n of queue) {
    queue.delete(n);
    transformNode(n);
    // keep main thread responsive
    if (deadline && typeof deadline.timeRemaining === "function") {
      if (deadline.timeRemaining() < 5) { scheduleDrain(); return; }
    } else if (performance.now() - start > 8) {
      scheduleDrain(); return;
    }
  }
}

// Find chat root. Fallback to body if selectors change
function getChatRoot() {
  return document.querySelector('[data-testid="conversation-turn"]')
      || document.querySelector('[data-testid="chat-messages"]')
      || document.querySelector('main')
      || document.body;
}

// Full rescan when settings change
function rescanAll() {
  version++;
  enqueueTextNodes(getChatRoot());
  scheduleDrain();
}

// Initial pass
rescanAll();

// Observe only the chat container
const root = getChatRoot();
const mo = new MutationObserver(records => {
  for (const r of records) {
    for (const n of r.addedNodes) {
      if (n.nodeType === Node.TEXT_NODE) {
        if (!inBadContext(n) && containsDashy(n.nodeValue || "")) queue.add(n);
      } else if (n.nodeType === Node.ELEMENT_NODE) {
        if (!n.matches(SELECTOR_SKIP)) enqueueTextNodes(n);
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
