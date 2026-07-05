/* ThinkBigJoe live site editor — injected into a client's site (via the edit
 * proxy). Clients hover to highlight, click any element, and PREVIEW changes
 * live (edit text, recolor, swap an image/logo) before sending. Each edit
 * records the element's selector + current text + the concrete change(s) + an
 * optional note; the batch POSTs to the portal as markdown for the forge. */
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
  function rgbToHex(c) {
    var m = (c || "").match(/\d+/g);
    if (!m) return "#000000";
    return "#" + m.slice(0, 3).map(function (n) {
      return ("0" + parseInt(n, 10).toString(16)).slice(-2);
    }).join("");
  }
  // Downscale an uploaded image so the data URL stays reasonable.
  function fileToDataUrl(file, cb) {
    var img = new Image();
    var url = URL.createObjectURL(file);
    img.onload = function () {
      var max = 1400;
      var w = img.width, h = img.height;
      if (w > max || h > max) { var s = Math.min(max / w, max / h); w = Math.round(w * s); h = Math.round(h * s); }
      var cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      try { cb(cv.toDataURL("image/jpeg", 0.85)); } catch (e) { cb(null); }
    };
    img.onerror = function () { URL.revokeObjectURL(url); cb(null); };
    img.src = url;
  }

  // ---- highlight overlay ------------------------------------------------
  var hl = document.createElement("div");
  hl.id = "__tbj-hl";
  hl.style.cssText =
    "position:fixed;z-index:2147483000;pointer-events:none;border:2px solid #2f6bff;" +
    "background:rgba(47,107,255,.12);border-radius:4px;display:none;";
  document.documentElement.appendChild(hl);
  document.addEventListener("pointerover", function (e) {
    if (isOurs(e.target) || document.getElementById("__tbj-pop")) { hl.style.display = "none"; return; }
    var r = e.target.getBoundingClientRect();
    hl.style.display = "block";
    hl.style.left = r.left + "px"; hl.style.top = r.top + "px";
    hl.style.width = r.width + "px"; hl.style.height = r.height + "px";
  }, true);

  // ---- click to select --------------------------------------------------
  document.addEventListener("click", function (e) {
    if (isOurs(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    openPanel(e.target, e.clientX, e.clientY);
  }, true);

  // ---- edit panel -------------------------------------------------------
  function openPanel(el, x, y) {
    closePanel();
    hl.style.display = "none";
    var selector = cssPath(el);
    var origText = textOf(el);
    var isImg = el.nodeName.toLowerCase() === "img";
    var editableText = el.children.length === 0 && !isImg && origText;
    var change = {}; // accumulates concrete changes for this element

    var cs = getComputedStyle(el);
    var pop = document.createElement("div");
    pop.id = "__tbj-pop";
    pop.style.cssText =
      "position:fixed;z-index:2147483001;left:" + Math.min(x, window.innerWidth - 340) +
      "px;top:" + Math.min(Math.max(y, 12), window.innerHeight - 340) +
      "px;width:320px;max-height:88vh;overflow:auto;background:#fff;border:1px solid #e6e9ef;border-radius:14px;" +
      "box-shadow:0 12px 40px rgba(0,0,0,.2);padding:14px;font-family:system-ui,sans-serif;color:#0a0a0b;";

    var html =
      '<div style="font-size:11px;font-weight:700;color:#2f6bff;text-transform:uppercase;letter-spacing:.04em;">Preview & edit this ' +
      el.nodeName.toLowerCase() + "</div>";

    if (editableText) {
      html += '<label style="display:block;font-size:12px;font-weight:600;margin-top:10px;">Text</label>' +
        '<textarea id="__tbj-text" style="width:100%;box-sizing:border-box;border:1px solid #e6e9ef;border-radius:8px;padding:8px;font-size:13px;font-family:inherit;min-height:48px;">' +
        origText.replace(/</g, "&lt;") + "</textarea>";
    }

    var textHex = rgbToHex(cs.color);
    var bgTransparent = cs.backgroundColor === "transparent" || /rgba?\([^)]*,\s*0\s*\)\s*$/.test(cs.backgroundColor);
    var bgHex = bgTransparent ? "#ffffff" : rgbToHex(cs.backgroundColor);
    var ci = "width:100%;height:30px;border:1px solid #e6e9ef;border-radius:6px;margin-top:4px;padding:0;";
    html += '<div style="display:flex;gap:12px;margin-top:10px;">' +
      '<label style="flex:1;font-size:12px;font-weight:600;">Text <span id="__tbj-colorhex" style="font-weight:400;color:#9aa0ad;">' + textHex + '</span>' +
      '<input id="__tbj-color" type="color" value="' + textHex + '" style="' + ci + '"></label>' +
      '<label style="flex:1;font-size:12px;font-weight:600;">Background <span id="__tbj-bghex" style="font-weight:400;color:#9aa0ad;">' + (bgTransparent ? "none" : bgHex) + '</span>' +
      '<input id="__tbj-bg" type="color" value="' + bgHex + '" style="' + ci + '"></label>' +
      "</div>";

    if (isImg) {
      html += '<label style="display:block;font-size:12px;font-weight:600;margin-top:10px;">Replace image / logo</label>' +
        '<input id="__tbj-img" type="file" accept="image/*" style="width:100%;font-size:12px;margin-top:4px;">' +
        '<div id="__tbj-imgnote" style="font-size:11px;color:#9aa0ad;margin-top:2px;">Upload a new image to preview it in place.</div>' +
        '<label style="display:block;font-size:12px;font-weight:600;margin-top:10px;">✨ Or generate with AI</label>' +
        '<textarea id="__tbj-ai" placeholder="Describe the logo/image you want…" style="width:100%;box-sizing:border-box;border:1px solid #e6e9ef;border-radius:8px;padding:8px;font-size:13px;font-family:inherit;min-height:44px;"></textarea>' +
        '<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:#5b616e;margin-top:4px;"><input type="checkbox" id="__tbj-airef" checked> use current image as a reference</label>' +
        '<button id="__tbj-gen" style="margin-top:6px;width:100%;background:#0a0a0b;color:#fff;border:0;border-radius:999px;padding:8px;font-weight:600;font-size:13px;cursor:pointer;">Generate</button>' +
        '<div id="__tbj-genstatus" style="font-size:11px;color:#9aa0ad;margin-top:4px;"></div>';
    }

    html += '<label style="display:block;font-size:12px;font-weight:600;margin-top:10px;">Note ' +
      '<span style="font-weight:400;color:#9aa0ad;">(optional)</span></label>' +
      '<textarea id="__tbj-note" placeholder="Anything else? e.g. make this bigger, move it up…" ' +
      'style="width:100%;box-sizing:border-box;border:1px solid #e6e9ef;border-radius:8px;padding:8px;font-size:13px;font-family:inherit;min-height:44px;"></textarea>' +
      '<div style="display:flex;gap:8px;margin-top:10px;">' +
      '<button id="__tbj-add" style="flex:1;background:#2f6bff;color:#fff;border:0;border-radius:999px;padding:9px;font-weight:600;font-size:13px;cursor:pointer;">Add edit</button>' +
      '<button id="__tbj-cancel" style="background:#f5f7fb;border:0;border-radius:999px;padding:9px 12px;font-size:13px;cursor:pointer;">Close</button>' +
      "</div>";

    pop.innerHTML = html;
    document.documentElement.appendChild(pop);

    // ---- live preview wiring ----
    var ta = pop.querySelector("#__tbj-text");
    if (ta) ta.addEventListener("input", function () { el.textContent = ta.value; change.newText = ta.value; });

    var colorHexEl = pop.querySelector("#__tbj-colorhex");
    pop.querySelector("#__tbj-color").addEventListener("input", function (e2) {
      el.style.setProperty("color", e2.target.value, "important");
      change.color = e2.target.value;
      if (colorHexEl) colorHexEl.textContent = e2.target.value;
    });
    var bgHexEl = pop.querySelector("#__tbj-bghex");
    pop.querySelector("#__tbj-bg").addEventListener("input", function (e2) {
      el.style.setProperty("background-color", e2.target.value, "important");
      change.background = e2.target.value;
      if (bgHexEl) bgHexEl.textContent = e2.target.value;
    });

    var fileInput = pop.querySelector("#__tbj-img");
    if (fileInput) {
      fileInput.addEventListener("change", function () {
        var f = fileInput.files[0];
        if (!f) return;
        pop.querySelector("#__tbj-imgnote").textContent = "Loading preview…";
        fileToDataUrl(f, function (data) {
          if (data) { el.src = data; change.image = { name: f.name, dataUrl: data }; pop.querySelector("#__tbj-imgnote").textContent = "✓ Previewing " + f.name; }
          else pop.querySelector("#__tbj-imgnote").textContent = "Couldn't read that image.";
        });
      });
    }

    var genBtn = pop.querySelector("#__tbj-gen");
    if (genBtn) {
      genBtn.addEventListener("click", function () {
        var promptEl = pop.querySelector("#__tbj-ai");
        var p = promptEl.value.trim();
        if (p.length < 3) { promptEl.focus(); return; }
        var useRef = pop.querySelector("#__tbj-airef").checked;
        var status = pop.querySelector("#__tbj-genstatus");
        genBtn.disabled = true;
        status.textContent = "Generating… this can take a few seconds.";
        fetch(CFG.genUrl || "/api/generate-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ prompt: p, refUrl: useRef ? el.src : undefined }),
        })
          .then(function (r) { return r.json(); })
          .then(function (res) {
            genBtn.disabled = false;
            if (res && res.ok && res.dataUrl) {
              el.src = res.dataUrl;
              change.image = { name: "ai-generated.png", dataUrl: res.dataUrl, prompt: p };
              status.textContent = "✓ Generated — preview above. Tweak the prompt to regenerate, or Add edit to keep it.";
            } else {
              status.textContent = (res && res.error) || "Couldn't generate.";
            }
          })
          .catch(function () { genBtn.disabled = false; status.textContent = "Generation failed — try again."; });
      });
    }

    pop.querySelector("#__tbj-cancel").onclick = closePanel;
    pop.querySelector("#__tbj-add").onclick = function () {
      var note = pop.querySelector("#__tbj-note").value.trim();
      if (note) change.note = note;
      if (Object.keys(change).length === 0) { pop.querySelector("#__tbj-note").focus(); return; }
      edits.push({ selector: selector, tag: el.nodeName.toLowerCase(), text: origText, changes: change });
      closePanel();
      renderBar();
    };
  }
  function closePanel() {
    var p = document.getElementById("__tbj-pop");
    if (p) p.remove();
  }

  // ---- toolbar ----------------------------------------------------------
  var bar = document.createElement("div");
  bar.id = "__tbj-editor";
  bar.style.cssText =
    "position:fixed;z-index:2147483002;left:50%;bottom:20px;transform:translateX(-50%);" +
    "background:#0a0a0b;color:#fff;border-radius:999px;padding:10px 16px;display:flex;align-items:center;gap:12px;" +
    "font-family:system-ui,sans-serif;font-size:14px;box-shadow:0 12px 40px rgba(0,0,0,.3);max-width:92vw;";
  document.documentElement.appendChild(bar);

  function renderBar() {
    bar.innerHTML =
      '<span style="font-weight:600;">✏️ Click anything to preview a change</span>' +
      '<span style="background:#2f6bff;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:700;">' + edits.length + "</span>" +
      (edits.length
        ? '<button id="__tbj-send" style="background:#2f6bff;color:#fff;border:0;border-radius:999px;padding:8px 16px;font-weight:600;font-size:13px;cursor:pointer;">Send ' + edits.length + " edit" + (edits.length > 1 ? "s" : "") + " →</button>"
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
          bar.innerHTML = '<span style="font-weight:600;">✅ Sent! Our team will apply your changes and let you know.</span>';
        } else if (send) { send.disabled = false; send.textContent = "Retry"; }
      })
      .catch(function () { if (send) { send.disabled = false; send.textContent = "Retry"; } });
  }

  renderBar();
})();
