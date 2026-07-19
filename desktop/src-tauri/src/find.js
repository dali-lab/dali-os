// In-page find bar (Edit → Find, Cmd+F). The main window loads the remote app
// with zero IPC access, so the whole feature lives in page JS: Rust evals this
// file on each menu action (window.rs find_action) and calls the API it
// defines. The define is guarded, so re-eval after a page reload just works.
//
// The app renders each workspace tab in a same-origin <iframe>
// (TabWorkspace.tsx) with background tabs display:none, so search covers the
// top document plus every *rendered* iframe document. Highlight registries,
// ::highlight styles, and key listeners are all per-document — everything
// here tracks the set of documents it touched.
//
// Matching is per-text-node and case-insensitive (no cross-element matches).
// All-match highlighting uses the CSS Custom Highlight API where the system
// webview has it; elsewhere the current match is shown via the document
// selection instead.
(function () {
  'use strict';
  if (window.__daliFindBar) return;

  const MAX_MATCHES = 500;
  const canHighlight =
    typeof Highlight === 'function' && typeof CSS !== 'undefined' && !!CSS.highlights;

  let matches = []; // Range[] across documents — stale after rerenders/tab switches
  let index = -1;
  let query = '';
  let debounce = 0;
  let pending = false; // a debounced search is scheduled but hasn't run yet
  const litDocs = new Set(); // documents currently holding our highlights
  let litEls = []; // container elements of the painted ranges (for repaint nudges)
  let selDoc = null; // document holding the fallback selection, if any

  // Closed shadow root so page CSS can't restyle the bar; the host hangs off
  // <html>, not <body>, so the text walker below never sees the bar itself.
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      :host { all: initial; position: fixed; top: 12px; right: 16px; z-index: 2147483647; }
      .bar { display: flex; align-items: center; gap: 4px; padding: 6px 8px; background: #fff; border: 1px solid #d2d2d7; border-radius: 8px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18); font: 13px -apple-system, system-ui, sans-serif; color: #1d1d1f; }
      input { width: 170px; margin-right: 4px; border: none; outline: none; background: transparent; font: inherit; color: inherit; }
      .count { color: #86868b; font-variant-numeric: tabular-nums; white-space: nowrap; }
      button { border: none; background: none; padding: 2px 6px; border-radius: 4px; font: inherit; font-size: 14px; color: inherit; }
      button:hover { background: rgba(0, 0, 0, 0.08); }
      @media (prefers-color-scheme: dark) {
        .bar { background: #323236; border-color: #48484d; color: #f5f5f7; }
        .count { color: #98989d; }
        button:hover { background: rgba(255, 255, 255, 0.12); }
      }
    </style>
    <div class="bar">
      <input type="text" placeholder="Find in page" aria-label="Find in page" />
      <span class="count"></span>
      <button class="prev" aria-label="Previous match">&#x2039;</button>
      <button class="next" aria-label="Next match">&#x203A;</button>
      <button class="close" aria-label="Close">&#x2715;</button>
    </div>`;

  const input = root.querySelector('input');
  const count = root.querySelector('.count');

  function barVisible() {
    return host.isConnected && host.style.display !== 'none';
  }

  // The top document and every laid-out same-origin iframe document, in DOM
  // order. display:none iframes (background workspace tabs) have no rects and
  // are skipped, which scopes the search to what the user can actually see.
  function docsOf() {
    const docs = [];
    (function add(doc) {
      if (!doc || !doc.body) return;
      docs.push(doc);
      for (const f of doc.querySelectorAll('iframe')) {
        if (!f.getClientRects().length) continue;
        try {
          add(f.contentDocument);
        } catch (_) {
          // cross-origin frame — not searchable
        }
      }
    })(document);
    return docs;
  }

  // Per-document setup. The flag lives on the Document object, so a reloaded
  // frame (new document) gets hooked again on the next search.
  function hookDoc(doc) {
    if (doc.__daliFindHooked) return;
    doc.__daliFindHooked = true;
    if (canHighlight) {
      // ::highlight() rules only apply in the tree scope they're declared in.
      // Highlight pseudos only support a few properties — shorthands like
      // `background` are dropped, so spell out background-color.
      const sheet = doc.createElement('style');
      sheet.textContent =
        '::highlight(dali-find) { background-color: #ffdf60; color: #1d1d1f; }' +
        '::highlight(dali-find-current) { background-color: #ff9330; color: #1d1d1f; }';
      (doc.head || doc.documentElement).appendChild(sheet);
    }
    // Esc closes the bar no matter which document has focus — key events
    // inside an iframe never bubble to the parent document.
    doc.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape' && barVisible()) {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      },
      true,
    );
  }

  // Keys typed into the bar must not reach the app's global shortcut handlers
  // (events retarget to the host but still bubble into the document).
  for (const type of ['keydown', 'keyup', 'keypress']) {
    host.addEventListener(type, (e) => e.stopPropagation());
  }

  function collect() {
    matches = [];
    for (const doc of docsOf()) {
      hookDoc(doc);
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const tag = node.parentElement && node.parentElement.tagName;
          return tag && tag !== 'SCRIPT' && tag !== 'STYLE' && tag !== 'NOSCRIPT' && tag !== 'TEXTAREA'
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      });
      let node;
      while ((node = walker.nextNode()) && matches.length < MAX_MATCHES) {
        const text = node.nodeValue.toLowerCase();
        let at = text.indexOf(query);
        while (at !== -1 && matches.length < MAX_MATCHES) {
          const range = doc.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + query.length);
          if (range.getClientRects().length) matches.push(range); // skips display:none text
          at = text.indexOf(query, at + query.length);
        }
      }
      if (matches.length >= MAX_MATCHES) break;
    }
  }

  // The system WebKit defers highlight repaints in parts of this app (e.g.
  // the fixed sidebar): registry changes take effect but pixels only update
  // when the containing ELEMENT's own style changes — highlights appear late
  // and linger after clearing. Toggling a visually-inert text-shadow directly
  // on each match's container forces the repaint. Two constraints found
  // empirically: it must be the element itself (an inherited toggle on the
  // root does nothing), and it only works once the engine has committed the
  // registry change, which lags by more than a frame. So the toggle runs in
  // several delayed rounds; each round reads the then-current registry, so
  // this both paints and unpaints correctly.
  function nudgeEls(els) {
    const byWin = new Map();
    for (const el of els) {
      if (!el) continue;
      const win = el.ownerDocument.defaultView;
      if (!win) continue;
      if (!byWin.has(win)) byWin.set(win, []);
      byWin.get(win).push(el);
    }
    for (const [win, list] of byWin) {
      const toggle = () => {
        for (const el of list) if (el.isConnected) el.style.textShadow = '0 0 transparent';
        win.requestAnimationFrame(() => {
          for (const el of list) el.style.textShadow = '';
        });
      };
      // The engine commits registry changes to the paintable state with up to
      // ~1-2s of lag here; only a post-commit invalidation paints. Rounds
      // straddle that window — early ones cover fast paths, late ones the lag.
      win.requestAnimationFrame(toggle);
      for (const ms of [150, 500, 1100, 2200]) win.setTimeout(toggle, ms);
    }
  }

  function clearMarks() {
    for (const doc of litDocs) {
      const win = doc.defaultView;
      if (win && win.CSS && win.CSS.highlights) {
        win.CSS.highlights.delete('dali-find');
        win.CSS.highlights.delete('dali-find-current');
      }
    }
    litDocs.clear();
    nudgeEls(litEls);
    litEls = [];
    if (selDoc) {
      try {
        selDoc.getSelection().removeAllRanges();
      } catch (_) {}
      selDoc = null;
    }
  }

  function render() {
    count.textContent = !query
      ? ''
      : matches.length
        ? `${index + 1}/${matches.length}${matches.length === MAX_MATCHES ? '+' : ''}`
        : '0/0';
    clearMarks();
    if (!canHighlight || !matches.length) return;
    const byDoc = new Map();
    for (const r of matches) {
      const doc = r.startContainer.ownerDocument;
      if (!byDoc.has(doc)) byDoc.set(doc, []);
      byDoc.get(doc).push(r);
    }
    for (const [doc, ranges] of byDoc) {
      const win = doc.defaultView;
      if (!win || !win.CSS || !win.CSS.highlights || typeof win.Highlight !== 'function') continue;
      win.CSS.highlights.set('dali-find', new win.Highlight(...ranges));
      litDocs.add(doc);
    }
    litEls = matches.map((r) => r.startContainer.parentElement).filter(Boolean);
    nudgeEls(litEls); // first paint lags just like clearing (see nudgeEls)
    const cur = matches[index];
    if (cur) {
      const win = cur.startContainer.ownerDocument.defaultView;
      if (win && win.CSS && win.CSS.highlights && typeof win.Highlight === 'function') {
        const h = new win.Highlight(cur);
        h.priority = 1; // paint over the all-matches highlight
        win.CSS.highlights.set('dali-find-current', h);
      }
    }
  }

  function goTo(i) {
    index = i;
    render();
    const range = matches[index];
    if (!range) return;
    if (!canHighlight) {
      // No highlight API (older webview): show the current match via its
      // document's selection. Skipped otherwise — moving the selection can
      // move carets in the app's collaborative editors.
      const doc = range.startContainer.ownerDocument;
      try {
        const sel = doc.getSelection();
        sel.removeAllRanges();
        sel.addRange(range.cloneRange());
        selDoc = doc;
      } catch (_) {}
    }
    const el = range.startContainer.parentElement;
    if (el) el.scrollIntoView({ block: 'center', inline: 'nearest' });
  }

  function search() {
    if (!barVisible()) return; // a pending debounce must never re-light a closed bar
    query = input.value.toLowerCase();
    matches = [];
    index = -1;
    if (!query) return render();
    collect();
    if (matches.length) goTo(0);
    else render();
  }

  function advance(dir) {
    if (!query) return open();
    show();
    // Rerenders and tab switches pull the DOM out from under saved ranges —
    // if the current one no longer draws, redo the search from scratch.
    if (matches[index] && !matches[index].getClientRects().length) matches = [];
    if (!matches.length) {
      collect();
      index = -1;
    }
    if (!matches.length) return render();
    goTo((index + dir + matches.length) % matches.length);
  }

  function show() {
    if (!host.isConnected) document.documentElement.appendChild(host);
    host.style.display = '';
  }

  function open() {
    show();
    for (const doc of docsOf()) hookDoc(doc); // Esc must work even before the first search
    input.focus();
    input.select();
  }

  function close() {
    clearTimeout(debounce); // Esc can land inside the debounce window — cancel, or the
    pending = false; // pending search re-lights highlights with the bar closed
    host.style.display = 'none'; // hiding the focused input returns focus to the page
    clearMarks();
    matches = [];
    index = -1;
  }

  input.addEventListener('input', () => {
    clearTimeout(debounce);
    pending = true;
    debounce = setTimeout(() => {
      pending = false;
      search();
    }, 50);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (pending) {
      // Enter right after typing: run the not-yet-fired search (landing on
      // match 1) instead of stepping through the stale previous results.
      clearTimeout(debounce);
      pending = false;
      search();
      return;
    }
    advance(e.shiftKey ? -1 : 1);
  });
  for (const [cls, fn] of [['prev', () => advance(-1)], ['next', () => advance(1)], ['close', close]]) {
    const btn = root.querySelector('.' + cls);
    btn.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the input
    btn.addEventListener('click', fn);
  }

  window.__daliFindBar = { open, next: () => advance(1), prev: () => advance(-1) };
})();
