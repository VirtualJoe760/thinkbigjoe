/* ThinkBigJoe live site editor (v3) — injected into a client's site via the edit
 * proxy. Goals: forgiving (auto-revert previews, undo), focused (only highlight
 * meaningful elements), contextual (controls fit the element), and clear
 * (spotlight the target, keep the dialog in view). Sends edits as markdown. */
(function () {
  if (window.__tbjEditorLoaded) return;
  window.__tbjEditorLoaded = true;

  var CFG = window.__TBJ_EDIT || {};
  var SITE_ID = CFG.siteId;
  var SAVE_URL = CFG.saveUrl || "/api/edit-requests";
  var GEN_URL = CFG.genUrl || "/api/generate-image";
  var edits = [];       // committed edits, sent on Send
  var history = [];     // { el, snapshot } for Undo

  var TEXT_TAGS = /^(H1|H2|H3|H4|H5|H6|P|SPAN|A|BUTTON|LI|BLOCKQUOTE|LABEL|STRONG|EM|SMALL|DD|DT|FIGCAPTION)$/;

  // Section mode: swap whole sections / component layouts (forge @webdev/ui variants).
  var mode = "element";
  var SECTIONS = {
    home: { label: "Hero", variants: ["split", "fullBleed", "centered", "minimal"] },
    stats: { label: "Stats band", variants: ["band", "inline"] },
    services: { label: "Services", variants: ["cards", "list", "alternating"] },
    about: { label: "About", variants: [] },
    gallery: { label: "Gallery", variants: [] },
    pricing: { label: "Pricing", variants: [] },
    testimonials: { label: "Testimonials", variants: [] },
    faq: { label: "FAQ", variants: [] },
    cta: { label: "Call-to-action", variants: [] },
    contact: { label: "Contact", variants: [] },
  };
  function sectionTarget(el) {
    while (el && el !== document.body && el.nodeType === 1) {
      var t = el.nodeName;
      if (t === "HEADER") return { el: el, id: "nav", label: "Navigation bar", variants: ["standard", "centered", "floating"] };
      if (t === "FOOTER") return { el: el, id: "footer", label: "Footer", variants: [] };
      if (t === "SECTION" && el.id) { var s = SECTIONS[el.id] || { label: el.id, variants: [] }; return { el: el, id: el.id, label: s.label, variants: s.variants }; }
      el = el.parentElement;
    }
    return null;
  }

  // ---- helpers ----------------------------------------------------------
  function isOurs(el) {
    return el && el.closest && el.closest("#__tbj-editor, #__tbj-hl, #__tbj-pop, #__tbj-dim");
  }
  function cssPath(el) {
    if (!(el instanceof Element)) return "";
    var path = [];
    while (el && el.nodeType === 1 && path.length < 6) {
      var sel = el.nodeName.toLowerCase();
      if (el.id) { sel += "#" + el.id; path.unshift(sel); break; }
      var p = el.parentElement;
      if (p) {
        var sibs = Array.prototype.filter.call(p.children, function (c) { return c.nodeName === el.nodeName; });
        if (sibs.length > 1) sel += ":nth-of-type(" + (sibs.indexOf(el) + 1) + ")";
      }
      path.unshift(sel); el = p;
    }
    return path.join(" > ");
  }
  function textOf(el) {
    var t = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
    return t.length > 120 ? t.slice(0, 117) + "…" : t;
  }
  function rgbToHex(c) {
    var m = (c || "").match(/\d+/g);
    if (!m) return "#000000";
    return "#" + m.slice(0, 3).map(function (n) { return ("0" + parseInt(n, 10).toString(16)).slice(-2); }).join("");
  }
  function fileToDataUrl(file, cb) {
    var img = new Image(), url = URL.createObjectURL(file);
    img.onload = function () {
      var max = 1400, w = img.width, h = img.height;
      if (w > max || h > max) { var s = Math.min(max / w, max / h); w = Math.round(w * s); h = Math.round(h * s); }
      var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      try { cb(cv.toDataURL("image/jpeg", 0.85)); } catch (e) { cb(null); }
    };
    img.onerror = function () { URL.revokeObjectURL(url); cb(null); };
    img.src = url;
  }
  // Walk up from the hovered node to the nearest MEANINGFUL editable element,
  // so we never highlight invisible wrapper divs.
  function editableTarget(el) {
    while (el && el !== document.body && el.nodeType === 1) {
      var tag = el.nodeName;
      if (tag === "IMG") return el;
      if (tag === "A" || tag === "BUTTON") return el;
      if (TEXT_TAGS.test(tag) && (el.innerText || "").trim()) return el;
      el = el.parentElement;
    }
    return null;
  }
  function elType(el) {
    var tag = el.nodeName;
    if (tag === "IMG") return "image";
    if (tag === "A" || tag === "BUTTON") return "button";
    return "text";
  }

  // ---- highlight overlay (also the spotlight when a panel is open) -------
  var hl = document.createElement("div");
  hl.id = "__tbj-hl";
  hl.style.cssText =
    "position:fixed;z-index:2147483000;pointer-events:none;border:2px solid #2f6bff;" +
    "border-radius:6px;display:none;transition:box-shadow .15s;";
  document.documentElement.appendChild(hl);
  var hoveredEl = null;
  function moveHl(el) {
    var r = el.getBoundingClientRect();
    hl.style.display = "block";
    hl.style.left = r.left - 2 + "px"; hl.style.top = r.top - 2 + "px";
    hl.style.width = r.width + 4 + "px"; hl.style.height = r.height + 4 + "px";
  }
  document.addEventListener("pointerover", function (e) {
    if (document.getElementById("__tbj-pop")) return;      // frozen while editing
    if (isOurs(e.target)) { hoveredEl = null; hl.style.display = "none"; return; }
    var t = mode === "section" ? ((sectionTarget(e.target) || {}).el) : editableTarget(e.target);
    if (!t) { hoveredEl = null; hl.style.display = "none"; return; }
    hoveredEl = t; hl.style.boxShadow = "none"; moveHl(t);
  }, true);
  window.addEventListener("scroll", function () {
    var t = document.getElementById("__tbj-pop") ? selectedEl : hoveredEl;
    if (t) moveHl(t);
  }, true);

  // ---- click to select --------------------------------------------------
  var selectedEl = null;
  document.addEventListener("click", function (e) {
    if (isOurs(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    if (mode === "section") { var si = sectionTarget(e.target); if (si) openSectionPanel(si); }
    else { var t = editableTarget(e.target); if (t) openPanel(t); }
  }, true);

  // ---- snapshot / restore (forgiveness) ---------------------------------
  function snapshot(el) {
    return { html: el.innerHTML, style: el.getAttribute("style"), src: el.getAttribute("src") };
  }
  function restore(el, snap) {
    el.innerHTML = snap.html;
    if (snap.style === null) el.removeAttribute("style"); else el.setAttribute("style", snap.style);
    if (el.nodeName === "IMG") { if (snap.src === null) el.removeAttribute("src"); else el.setAttribute("src", snap.src); }
  }

  // ---- edit panel -------------------------------------------------------
  function openPanel(el) {
    closePanel();
    selectedEl = el;
    var snap = snapshot(el);
    var type = elType(el);
    var selector = cssPath(el), origText = textOf(el), change = {};
    var cs = getComputedStyle(el);

    // spotlight: dim everything except the highlighted element
    moveHl(el);
    hl.style.boxShadow = "0 0 0 9999px rgba(10,10,11,.55)";

    var pop = document.createElement("div");
    pop.id = "__tbj-pop";
    pop.style.cssText =
      "position:fixed;z-index:2147483001;width:300px;max-height:82vh;overflow:auto;background:#fff;" +
      "border:1px solid #e6e9ef;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.35);padding:14px;" +
      "font-family:system-ui,sans-serif;color:#0a0a0b;left:-9999px;top:0;";

    var h =
      '<div style="display:flex;justify-content:space-between;align-items:center;">' +
      '<span style="font-size:11px;font-weight:700;color:#2f6bff;text-transform:uppercase;letter-spacing:.04em;">Edit ' +
      (type === "image" ? "image" : type === "button" ? "button" : el.nodeName.toLowerCase()) + "</span>" +
      '<button id="__tbj-x" aria-label="close" style="border:0;background:#f5f7fb;border-radius:8px;width:26px;height:26px;cursor:pointer;font-size:15px;">✕</button></div>';

    if (type === "text" || type === "button") {
      h += '<label style="display:block;font-size:12px;font-weight:600;margin-top:10px;">Text</label>' +
        '<textarea id="__tbj-text" style="width:100%;box-sizing:border-box;border:1px solid #e6e9ef;border-radius:8px;padding:8px;font-size:13px;font-family:inherit;min-height:48px;">' +
        origText.replace(/</g, "&lt;") + "</textarea>";
      var textHex = rgbToHex(cs.color);
      h += '<label style="display:block;font-size:12px;font-weight:600;margin-top:10px;">Text color <span id="__tbj-ch" style="font-weight:400;color:#9aa0ad;">' + textHex + "</span>" +
        '<input id="__tbj-color" type="color" value="' + textHex + '" style="width:100%;height:30px;border:1px solid #e6e9ef;border-radius:6px;margin-top:4px;padding:0;"></label>';
      if (type === "button") {
        var bgT = cs.backgroundColor === "transparent" || /rgba?\([^)]*,\s*0\s*\)\s*$/.test(cs.backgroundColor);
        var bgHex = bgT ? "#ffffff" : rgbToHex(cs.backgroundColor);
        h += '<label style="display:block;font-size:12px;font-weight:600;margin-top:10px;">Button color <span id="__tbj-bh" style="font-weight:400;color:#9aa0ad;">' + (bgT ? "none" : bgHex) + "</span>" +
          '<input id="__tbj-bg" type="color" value="' + bgHex + '" style="width:100%;height:30px;border:1px solid #e6e9ef;border-radius:6px;margin-top:4px;padding:0;"></label>';
      }
    }
    if (type === "image") {
      h += '<label style="display:block;font-size:12px;font-weight:600;margin-top:10px;">Replace image</label>' +
        '<input id="__tbj-img" type="file" accept="image/*" style="width:100%;font-size:12px;margin-top:4px;">' +
        '<div id="__tbj-in" style="font-size:11px;color:#9aa0ad;margin-top:2px;">Upload to preview it in place.</div>' +
        '<label style="display:block;font-size:12px;font-weight:600;margin-top:10px;">✨ Or generate with AI</label>' +
        '<textarea id="__tbj-ai" placeholder="Describe the image/logo…" style="width:100%;box-sizing:border-box;border:1px solid #e6e9ef;border-radius:8px;padding:8px;font-size:13px;font-family:inherit;min-height:40px;"></textarea>' +
        '<label style="display:flex;gap:6px;font-size:11px;color:#5b616e;margin-top:4px;"><input type="checkbox" id="__tbj-ar" checked> use current image as reference</label>' +
        '<button id="__tbj-gen" style="margin-top:6px;width:100%;background:#0a0a0b;color:#fff;border:0;border-radius:999px;padding:8px;font-weight:600;font-size:13px;cursor:pointer;">Generate</button>' +
        '<div id="__tbj-gs" style="font-size:11px;color:#9aa0ad;margin-top:4px;"></div>';
    }
    h += '<label style="display:block;font-size:12px;font-weight:600;margin-top:10px;">Note <span style="font-weight:400;color:#9aa0ad;">(optional)</span></label>' +
      '<textarea id="__tbj-note" placeholder="Anything else? e.g. make it bigger…" style="width:100%;box-sizing:border-box;border:1px solid #e6e9ef;border-radius:8px;padding:8px;font-size:13px;font-family:inherit;min-height:40px;"></textarea>' +
      '<div style="display:flex;gap:8px;margin-top:10px;">' +
      '<button id="__tbj-add" style="flex:1;background:#2f6bff;color:#fff;border:0;border-radius:999px;padding:9px;font-weight:600;font-size:13px;cursor:pointer;">Add edit</button>' +
      '<button id="__tbj-cancel" style="background:#f5f7fb;border:0;border-radius:999px;padding:9px 12px;font-size:13px;cursor:pointer;">Cancel</button></div>' +
      '<div style="font-size:11px;color:#9aa0ad;margin-top:6px;text-align:center;">Cancel undoes this preview.</div>';

    pop.innerHTML = h;
    document.documentElement.appendChild(pop);
    positionPanel(pop, el.getBoundingClientRect());

    // wiring — live preview
    var ta = pop.querySelector("#__tbj-text");
    if (ta) ta.addEventListener("input", function () { el.textContent = ta.value; change.newText = ta.value; });
    var ci = pop.querySelector("#__tbj-color");
    if (ci) { var chEl = pop.querySelector("#__tbj-ch"); ci.addEventListener("input", function (e2) { el.style.setProperty("color", e2.target.value, "important"); change.color = e2.target.value; if (chEl) chEl.textContent = e2.target.value; }); }
    var bi = pop.querySelector("#__tbj-bg");
    if (bi) { var bhEl = pop.querySelector("#__tbj-bh"); bi.addEventListener("input", function (e2) { el.style.setProperty("background-color", e2.target.value, "important"); change.background = e2.target.value; if (bhEl) bhEl.textContent = e2.target.value; }); }
    var fi = pop.querySelector("#__tbj-img");
    if (fi) fi.addEventListener("change", function () {
      var f = fi.files[0]; if (!f) return;
      pop.querySelector("#__tbj-in").textContent = "Loading preview…";
      fileToDataUrl(f, function (d) { if (d) { el.src = d; change.image = { name: f.name, dataUrl: d }; pop.querySelector("#__tbj-in").textContent = "✓ Previewing " + f.name; } else pop.querySelector("#__tbj-in").textContent = "Couldn't read that image."; });
    });
    var gen = pop.querySelector("#__tbj-gen");
    if (gen) gen.addEventListener("click", function () {
      var pr = pop.querySelector("#__tbj-ai").value.trim(); if (pr.length < 3) { pop.querySelector("#__tbj-ai").focus(); return; }
      var useRef = pop.querySelector("#__tbj-ar").checked, gs = pop.querySelector("#__tbj-gs");
      gen.disabled = true; gs.textContent = "Generating… a few seconds.";
      fetch(GEN_URL, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ prompt: pr, refUrl: useRef ? el.src : undefined }) })
        .then(function (r) { return r.json(); })
        .then(function (res) { gen.disabled = false; if (res && res.ok && res.dataUrl) { el.src = res.dataUrl; change.image = { name: "ai-generated.png", dataUrl: res.dataUrl, prompt: pr }; gs.textContent = "✓ Generated — Add edit to keep it."; } else gs.textContent = (res && res.error) || "Couldn't generate."; })
        .catch(function () { gen.disabled = false; gs.textContent = "Generation failed."; });
    });

    function cancel() { restore(el, snap); closePanel(); }
    pop.querySelector("#__tbj-x").onclick = cancel;
    pop.querySelector("#__tbj-cancel").onclick = cancel;
    pop.querySelector("#__tbj-add").onclick = function () {
      var note = pop.querySelector("#__tbj-note").value.trim();
      if (note) change.note = note;
      if (Object.keys(change).length === 0) { pop.querySelector("#__tbj-note").focus(); return; }
      edits.push({ selector: selector, tag: el.nodeName.toLowerCase(), text: origText, changes: change });
      history.push({ el: el, snapshot: snap });
      closePanel(); renderBar();
    };
  }
  function positionPanel(pop, rect) {
    var pw = 300, ph = pop.offsetHeight || 360, gap = 14, vw = innerWidth, vh = innerHeight, left, top;
    if (rect.right + gap + pw <= vw) left = rect.right + gap;         // right of element
    else if (rect.left - gap - pw >= 0) left = rect.left - gap - pw;  // left of element
    else left = Math.max(gap, (vw - pw) / 2);                         // center, clamped
    top = Math.max(gap, Math.min(rect.top, vh - ph - gap));
    pop.style.left = left + "px"; pop.style.top = top + "px";
  }
  function closePanel() {
    var p = document.getElementById("__tbj-pop"); if (p) p.remove();
    hl.style.boxShadow = "none"; hl.style.display = "none"; selectedEl = null;
  }

  // ---- section panel (layout / component swaps — applied by the forge) --
  function openSectionPanel(info) {
    closePanel();
    selectedEl = info.el;
    moveHl(info.el);
    hl.style.boxShadow = "0 0 0 9999px rgba(10,10,11,.55)";
    var chosen = { variant: null };

    var pop = document.createElement("div");
    pop.id = "__tbj-pop";
    pop.style.cssText =
      "position:fixed;z-index:2147483001;width:300px;max-height:82vh;overflow:auto;background:#fff;" +
      "border:1px solid #e6e9ef;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.35);padding:14px;" +
      "font-family:system-ui,sans-serif;color:#0a0a0b;left:-9999px;top:0;";

    var h =
      '<div style="display:flex;justify-content:space-between;align-items:center;">' +
      '<span style="font-size:11px;font-weight:700;color:#2f6bff;text-transform:uppercase;letter-spacing:.04em;">' + info.label + " section</span>" +
      '<button id="__tbj-x" aria-label="close" style="border:0;background:#f5f7fb;border-radius:8px;width:26px;height:26px;cursor:pointer;font-size:15px;">✕</button></div>';
    if (info.variants && info.variants.length) {
      h += '<label style="display:block;font-size:12px;font-weight:600;margin-top:10px;">Choose a layout</label><div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">';
      info.variants.forEach(function (v) { h += '<button type="button" class="__tbj-v" data-v="' + v + '" style="border:1px solid #e6e9ef;background:#fff;border-radius:999px;padding:6px 12px;font-size:12px;cursor:pointer;">' + v + "</button>"; });
      h += "</div>";
    }
    h += '<label style="display:block;font-size:12px;font-weight:600;margin-top:12px;">Describe a change ' +
      (info.variants && info.variants.length ? '<span style="font-weight:400;color:#9aa0ad;">(optional)</span>' : "") + "</label>" +
      '<textarea id="__tbj-snote" placeholder="e.g. make this a video hero, parallax background, add a testimonial…" style="width:100%;box-sizing:border-box;border:1px solid #e6e9ef;border-radius:8px;padding:8px;font-size:13px;font-family:inherit;min-height:56px;"></textarea>' +
      '<div style="display:flex;gap:8px;margin-top:10px;"><button id="__tbj-sadd" style="flex:1;background:#2f6bff;color:#fff;border:0;border-radius:999px;padding:9px;font-weight:600;font-size:13px;cursor:pointer;">Request change</button>' +
      '<button id="__tbj-scancel" style="background:#f5f7fb;border:0;border-radius:999px;padding:9px 12px;font-size:13px;cursor:pointer;">Cancel</button></div>' +
      '<div style="font-size:11px;color:#9aa0ad;margin-top:6px;text-align:center;">Layout changes are applied by our team.</div>';
    pop.innerHTML = h;
    document.documentElement.appendChild(pop);
    positionPanel(pop, info.el.getBoundingClientRect());

    Array.prototype.forEach.call(pop.querySelectorAll(".__tbj-v"), function (btn) {
      btn.onclick = function () {
        chosen.variant = btn.getAttribute("data-v");
        Array.prototype.forEach.call(pop.querySelectorAll(".__tbj-v"), function (b) { b.style.background = "#fff"; b.style.color = "#0a0a0b"; b.style.borderColor = "#e6e9ef"; });
        btn.style.background = "#2f6bff"; btn.style.color = "#fff"; btn.style.borderColor = "#2f6bff";
      };
    });
    pop.querySelector("#__tbj-x").onclick = closePanel;
    pop.querySelector("#__tbj-scancel").onclick = closePanel;
    pop.querySelector("#__tbj-sadd").onclick = function () {
      var note = pop.querySelector("#__tbj-snote").value.trim();
      if (!chosen.variant && !note) { pop.querySelector("#__tbj-snote").focus(); return; }
      var sel = info.id === "nav" ? "header" : info.id === "footer" ? "footer" : "section#" + info.id;
      edits.push({ selector: sel, tag: "section", text: info.label, section: info.id, changes: { variant: chosen.variant || undefined, note: note || undefined } });
      history.push({ el: info.el, snapshot: snapshot(info.el) }); // no live change; keeps Undo consistent
      closePanel(); renderBar();
    };
  }

  // ---- toolbar ----------------------------------------------------------
  var bar = document.createElement("div");
  bar.id = "__tbj-editor";
  bar.style.cssText =
    "position:fixed;z-index:2147483002;left:50%;bottom:20px;transform:translateX(-50%);" +
    "background:#0a0a0b;color:#fff;border-radius:999px;padding:10px 16px;display:flex;align-items:center;gap:10px;" +
    "font-family:system-ui,sans-serif;font-size:14px;box-shadow:0 12px 40px rgba(0,0,0,.3);max-width:92vw;";
  document.documentElement.appendChild(bar);

  function undo() {
    var last = history.pop(); if (!last) return;
    restore(last.el, last.snapshot);
    edits.pop();
    renderBar();
  }
  function modeBtn(id, label, on) {
    return '<button id="' + id + '" style="border:0;border-radius:999px;padding:5px 11px;font-size:12px;font-weight:600;cursor:pointer;' +
      (on ? "background:#2f6bff;color:#fff;" : "background:transparent;color:#cfd2d8;") + '">' + label + "</button>";
  }
  function renderBar() {
    bar.innerHTML =
      '<span style="display:inline-flex;background:#2a2b31;border-radius:999px;padding:2px;">' +
      modeBtn("__tbj-m-el", "Elements", mode === "element") + modeBtn("__tbj-m-sec", "Sections", mode === "section") + "</span>" +
      (edits.length ? '<button id="__tbj-undo" style="background:#33343a;color:#fff;border:0;border-radius:999px;padding:7px 12px;font-size:13px;cursor:pointer;">↶ Undo</button>' : "") +
      '<span style="background:#2f6bff;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:700;">' + edits.length + "</span>" +
      (edits.length ? '<button id="__tbj-send" style="background:#2f6bff;color:#fff;border:0;border-radius:999px;padding:8px 16px;font-weight:600;font-size:13px;cursor:pointer;">Send ' + edits.length + " edit" + (edits.length > 1 ? "s" : "") + " →</button>" : "");
    bar.querySelector("#__tbj-m-el").onclick = function () { mode = "element"; closePanel(); hl.style.display = "none"; renderBar(); };
    bar.querySelector("#__tbj-m-sec").onclick = function () { mode = "section"; closePanel(); hl.style.display = "none"; renderBar(); };
    var u = bar.querySelector("#__tbj-undo"); if (u) u.onclick = undo;
    var s = bar.querySelector("#__tbj-send"); if (s) s.onclick = submit;
  }
  function submit() {
    var s = bar.querySelector("#__tbj-send"); if (s) { s.disabled = true; s.textContent = "Sending…"; }
    fetch(SAVE_URL, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ siteId: SITE_ID, edits: edits }) })
      .then(function (r) { return r.json(); })
      .then(function (res) { if (res && res.ok) { edits = []; history = []; bar.innerHTML = '<span style="font-weight:600;">✅ Sent! Our team will apply your changes and let you know.</span>'; } else if (s) { s.disabled = false; s.textContent = "Retry"; } })
      .catch(function () { if (s) { s.disabled = false; s.textContent = "Retry"; } });
  }
  renderBar();
})();
