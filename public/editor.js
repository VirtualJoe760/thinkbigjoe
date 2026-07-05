/* ThinkBigJoe live site editor — injected into a client's site (via the edit
 * proxy) so they can click elements and request changes. Records each edit's
 * CSS selector + current text + their note, then POSTs the batch to the portal.
 * Everything is namespaced + high z-index to avoid clashing with the site. */
(function () {
  if (window.__tbjEditorLoaded) return;
  window.__tbjEditorLoaded = true;

  var CFG = window.__TBJ_EDIT || {};
  var SITE_ID = CFG.siteId;
  var SAVE_URL = CFG.saveUrl || "/api/edit-requests";
  var edits = [];

  // ---- helpers ----------------------------------------------------------
  function isOurs(el) {
    return el && el.closest && el.closest("#__tbj-editor, #__tbj-hl, #__tbj-pop");
  }
  function cssPath(el) {
    if (!(el instanceof Element)) return "";
    var path = [];
    while (el && el.nodeType === 1 && path.length < 6) {
      var sel = el.nodeName.toLowerCase();
      if (el.id) { sel += "#" + el.id; path.unshift(sel); break; }
      var parent = el.parentElement;
      if (parent) {
        var sibs = Array.prototype.filter.call(parent.children, function (c) {
          return c.nodeName === el.nodeName;
        });
        if (sibs.length > 1) sel += ":nth-of-type(" + (sibs.indexOf(el) + 1) + ")";
      }
      path.unshift(sel);
      el = parent;
    }
    return path.join(" > ");
  }
  function textOf(el) {
    var t = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
    return t.length > 120 ? t.slice(0, 117) + "…" : t;
  }

  // ---- highlight overlay ------------------------------------------------
  var hl = document.createElement("div");
  hl.id = "__tbj-hl";
  hl.style.cssText =
    "position:fixed;z-index:2147483000;pointer-events:none;border:2px solid #2f6bff;" +
    "background:rgba(47,107,255,.12);border-radius:4px;display:none;transition:all .05s;";
  document.documentElement.appendChild(hl);

  function moveHl(el) {
    var r = el.getBoundingClientRect();
    hl.style.display = "block";
    hl.style.left = r.left + "px";
    hl.style.top = r.top + "px";
    hl.style.width = r.width + "px";
    hl.style.height = r.height + "px";
  }

  document.addEventListener(
    "pointerover",
    function (e) {
      if (isOurs(e.target)) { hl.style.display = "none"; return; }
      moveHl(e.target);
    },
    true,
  );

  // ---- click to select --------------------------------------------------
  document.addEventListener(
    "click",
    function (e) {
      if (isOurs(e.target)) return; // let our own UI work
      e.preventDefault();
      e.stopPropagation();
      openPopover(e.target, e.clientX, e.clientY);
    },
    true,
  );

  // ---- note popover -----------------------------------------------------
  function openPopover(el, x, y) {
    closePopover();
    var selector = cssPath(el);
    var text = textOf(el);
    var pop = document.createElement("div");
    pop.id = "__tbj-pop";
    pop.style.cssText =
      "position:fixed;z-index:2147483001;left:" +
      Math.min(x, window.innerWidth - 320) +
      "px;top:" +
      Math.min(y, window.innerHeight - 200) +
      "px;width:300px;background:#fff;border:1px solid #e6e9ef;border-radius:12px;" +
      "box-shadow:0 12px 40px rgba(0,0,0,.18);padding:14px;font-family:system-ui,sans-serif;";
    pop.innerHTML =
      '<div style="font-size:11px;font-weight:700;color:#2f6bff;text-transform:uppercase;letter-spacing:.04em;">Edit this ' +
      el.nodeName.toLowerCase() +
      "</div>" +
      (text
        ? '<div style="font-size:12px;color:#5b616e;margin-top:4px;max-height:40px;overflow:hidden;">“' +
          text.replace(/</g, "&lt;") +
          "”</div>"
        : "") +
      '<textarea id="__tbj-note" placeholder="What should change? e.g. make this bigger, swap the photo…" ' +
      'style="width:100%;margin-top:8px;box-sizing:border-box;border:1px solid #e6e9ef;border-radius:8px;' +
      'padding:8px;font-size:13px;font-family:inherit;min-height:60px;resize:vertical;"></textarea>' +
      '<div style="display:flex;gap:8px;margin-top:8px;">' +
      '<button id="__tbj-add" style="flex:1;background:#2f6bff;color:#fff;border:0;border-radius:999px;padding:8px;font-weight:600;font-size:13px;cursor:pointer;">Add edit</button>' +
      '<button id="__tbj-cancel" style="background:#f5f7fb;border:0;border-radius:999px;padding:8px 12px;font-size:13px;cursor:pointer;">Cancel</button>' +
      "</div>";
    document.documentElement.appendChild(pop);
    var ta = pop.querySelector("#__tbj-note");
    ta.focus();
    pop.querySelector("#__tbj-cancel").onclick = closePopover;
    pop.querySelector("#__tbj-add").onclick = function () {
      var note = ta.value.trim();
      if (!note) { ta.focus(); return; }
      edits.push({ selector: selector, tag: el.nodeName.toLowerCase(), text: text, note: note });
      closePopover();
      renderBar();
    };
  }
  function closePopover() {
    var p = document.getElementById("__tbj-pop");
    if (p) p.remove();
  }

  // ---- toolbar ----------------------------------------------------------
  var bar = document.createElement("div");
  bar.id = "__tbj-editor";
  bar.style.cssText =
    "position:fixed;z-index:2147483002;left:50%;bottom:20px;transform:translateX(-50%);" +
    "background:#0a0a0b;color:#fff;border-radius:999px;padding:10px 16px;display:flex;align-items:center;gap:12px;" +
    "font-family:system-ui,sans-serif;font-size:14px;box-shadow:0 12px 40px rgba(0,0,0,.3);";
  document.documentElement.appendChild(bar);

  function renderBar() {
    bar.innerHTML =
      '<span style="font-weight:600;">✏️ Click any part of your site to request a change</span>' +
      '<span id="__tbj-count" style="background:#2f6bff;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:700;">' +
      edits.length +
      "</span>" +
      (edits.length
        ? '<button id="__tbj-send" style="background:#2f6bff;color:#fff;border:0;border-radius:999px;padding:8px 16px;font-weight:600;font-size:13px;cursor:pointer;">Send ' +
          edits.length +
          " edit" + (edits.length > 1 ? "s" : "") + " →</button>"
        : "");
    var send = bar.querySelector("#__tbj-send");
    if (send) send.onclick = submit;
  }

  function submit() {
    var send = bar.querySelector("#__tbj-send");
    if (send) { send.disabled = true; send.textContent = "Sending…"; }
    fetch(SAVE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ siteId: SITE_ID, edits: edits }),
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.ok) {
          edits = [];
          bar.innerHTML =
            '<span style="font-weight:600;">✅ Sent! Our team will apply your changes and let you know.</span>';
        } else {
          if (send) { send.disabled = false; send.textContent = "Retry"; }
        }
      })
      .catch(function () {
        if (send) { send.disabled = false; send.textContent = "Retry"; }
      });
  }

  renderBar();
})();
