/* ThinkBigJoe live site editor (v4) — injected into a client's site via the edit
 * proxy. Goals: forgiving (auto-revert previews, undo), focused (only highlight
 * meaningful elements), contextual (controls fit the element), and clear
 * (spotlight the target, keep the dialog in view). Sends edits as markdown.
 * v4: mobile-first — panels become a bottom sheet on phones, tap-to-select
 * (no hover), 44px targets, safe-area insets; our chrome is CSS-isolated from
 * the host page. (The host is always a forge template — our own CSS — so a
 * scoped all:revert is enough; escalate to a shadow root only if that changes.) */
(function () {
  if (window.__tbjEditorLoaded) return;
  window.__tbjEditorLoaded = true;

  // ---- viewport awareness ------------------------------------------------
  // A phone (or any coarse-pointer / narrow screen): bottom-sheet UI + tap-select.
  var mq = window.matchMedia("(max-width: 640px), (hover: none)");
  function isMobile() { return mq.matches; }
  // Only do hover-highlight where there's a real pointer; touch uses tap-to-select.
  var CAN_HOVER = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  // ---- CSS isolation -----------------------------------------------------
  // Keep the host page's generic tag rules / resets from leaking into our chrome.
  // Scoped, non-!important (so it never fights our own inline styles); the host is
  // our own template CSS, so this is belt-and-suspenders, not a hostile-site shield.
  var reset = document.createElement("style");
  reset.id = "__tbj-reset";
  reset.textContent =
    "#__tbj-editor,#__tbj-pop,#__tbj-hl,#__tbj-editor *,#__tbj-pop *{all:revert;box-sizing:border-box}" +
    "#__tbj-editor,#__tbj-pop{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:13px;line-height:1.4;-webkit-text-size-adjust:100%}" +
    "@media (max-width:640px){#__tbj-pop button,#__tbj-pop textarea,#__tbj-pop input:not([type=checkbox]):not([type=radio]),#__tbj-pop select{min-height:44px}#__tbj-pop input[type=color]{height:44px}#__tbj-editor button{min-height:40px}}";
  document.documentElement.appendChild(reset);

  var CFG = window.__TBJ_EDIT || {};
  var SITE_ID = CFG.siteId;
  var SAVE_URL = CFG.saveUrl || "/api/edit-requests";
  var GEN_URL = CFG.genUrl || "/api/generate-image";
  var edits = [];       // committed edits, sent on Send
  var history = [];     // { el, snapshot } for Undo

  // ---- brand tokens (modular theming) -----------------------------------
  // Editing the theme means moving the template's OWN design tokens, so the whole
  // OKLCH ramp recolors harmoniously — not painting one element. Preview is instant
  // (set the vars on :root); the token edit is sent for the forge to persist.
  var FONT_SETS = [
    { id: "inter", name: "Modern", head: "'Inter', ui-sans-serif, system-ui, sans-serif", body: "'Inter', ui-sans-serif, system-ui, sans-serif", g: "Inter:wght@400;600;800" },
    { id: "poppins", name: "Friendly", head: "'Poppins', ui-sans-serif, sans-serif", body: "'Poppins', ui-sans-serif, sans-serif", g: "Poppins:wght@400;600;800" },
    { id: "archivo", name: "Bold", head: "'Archivo', ui-sans-serif, sans-serif", body: "'Archivo', ui-sans-serif, sans-serif", g: "Archivo:wght@400;600;800" },
    { id: "playfair", name: "Editorial", head: "'Playfair Display', Georgia, serif", body: "'Lora', Georgia, serif", g: "Playfair+Display:wght@600;800|Lora:wght@400;600" },
    { id: "space", name: "Tech", head: "'Space Grotesk', ui-sans-serif, sans-serif", body: "'Inter', ui-sans-serif, sans-serif", g: "Space+Grotesk:wght@500;700|Inter:wght@400;600" },
    { id: "fraunces", name: "Warm", head: "'Fraunces', Georgia, serif", body: "'Nunito Sans', ui-sans-serif, sans-serif", g: "Fraunces:opsz,wght@9..144,600;9..144,800|Nunito+Sans:wght@400;600" },
    { id: "merri", name: "Classic", head: "'Merriweather', Georgia, serif", body: "'Source Sans 3', ui-sans-serif, sans-serif", g: "Merriweather:wght@700;900|Source+Sans+3:wght@400;600" },
    { id: "franklin", name: "Corporate", head: "'Libre Franklin', ui-sans-serif, sans-serif", body: "'Libre Franklin', ui-sans-serif, sans-serif", g: "Libre+Franklin:wght@400;600;800" },
    { id: "dm", name: "Crafted", head: "'DM Serif Display', Georgia, serif", body: "'DM Sans', ui-sans-serif, sans-serif", g: "DM+Serif+Display:ital@0;1|DM+Sans:wght@400;600" },
    { id: "manrope", name: "Minimal", head: "'Manrope', ui-sans-serif, sans-serif", body: "'Manrope', ui-sans-serif, sans-serif", g: "Manrope:wght@400;600;800" },
  ];
  // The live theme being previewed (null = untouched). Sent as one token edit.
  var theme = { primary: null, secondary: null, font: null };
  // The site's saved theme (Phase 4) — the proxy already applied it to the page; used to pre-fill
  // the Brand panel on reopen + to know whether a "Revert to original" is offered.
  var CFG_THEME = (CFG && CFG.theme) || null;

  // sRGB hex → OKLCH {L,C,h}. The token ramps are hue-driven, so we set --brand-h
  // from the picked color's hue (lossy on the exact swatch — we build a matching ramp).
  function hexToOklch(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); if (!m) return null;
    var n = parseInt(m[1], 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
    function lin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    r = lin(r); g = lin(g); b = lin(b);
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    var mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    var s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    var L = 0.2104542553 * l + 0.7936177850 * mm - 0.0040720468 * s;
    var A = 1.9779984951 * l - 2.4285922050 * mm + 0.4505937099 * s;
    var B = 0.0259040371 * l + 0.7827717662 * mm - 0.8086757660 * s;
    var C = Math.sqrt(A * A + B * B), H = Math.atan2(B, A) * 180 / Math.PI;
    if (H < 0) H += 360;
    return { L: L, C: C, h: Math.round(H * 10) / 10 };
  }
  // Load the chosen font pairing into the previewed page (Google Fonts, preview only).
  function loadFont(g) {
    var link = document.getElementById("__tbj-font");
    if (!link) { link = document.createElement("link"); link.id = "__tbj-font"; link.rel = "stylesheet"; document.head.appendChild(link); }
    link.href = "https://fonts.googleapis.com/css2?family=" + g + "&display=swap";
  }
  // Apply the current theme to the live page by moving the template's own tokens.
  function applyTheme() {
    var root = document.documentElement.style;
    if (theme.primary) { var p = hexToOklch(theme.primary); if (p) { root.setProperty("--brand-h", String(p.h)); root.setProperty("--brand-c", Math.min(0.22, p.C).toFixed(3)); } }
    if (theme.secondary) { var s = hexToOklch(theme.secondary); if (s) root.setProperty("--accent-h", String(s.h)); }
    if (theme.font) { var f = FONT_SETS.filter(function (x) { return x.id === theme.font; })[0]; if (f) { loadFont(f.g); root.setProperty("--font-heading-stack", f.head); root.setProperty("--font-sans-stack", f.body); } }
    clearHexCache();
  }
  function resetTheme() {
    theme = { primary: null, secondary: null, font: null };
    var root = document.documentElement.style;
    ["--brand-h", "--brand-c", "--accent-h", "--font-heading-stack", "--font-sans-stack"].forEach(function (v) { root.removeProperty(v); });
    var fl = document.getElementById("__tbj-font"); if (fl) fl.remove();
    clearHexCache();
  }
  // The whole theme is ONE committed edit — drop any existing token edit (+ its Undo marker)
  // so Apply replaces rather than stacks, and Undo/Reset can't desync the preview from edits[].
  function dropTokenEdit() {
    for (var i = edits.length - 1; i >= 0; i--) {
      if (edits[i].kind === "token") { edits.splice(i, 1); history.splice(i, 1); }
    }
  }

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
  // Rasterize ANY CSS color string (rgb / oklch() / color() / named) to an sRGB hex — canvas
  // fillStyle keeps oklch as-is, so we render one pixel and read it back.
  function toHex(colorStr) {
    try {
      var cv = document.createElement("canvas"); cv.width = 1; cv.height = 1;
      var ctx = cv.getContext("2d");
      ctx.fillStyle = "#000000"; ctx.fillStyle = colorStr; ctx.fillRect(0, 0, 1, 1);
      var px = ctx.getImageData(0, 0, 1, 1).data;
      return "#" + [px[0], px[1], px[2]].map(function (v) { return ("0" + v.toString(16)).slice(-2); }).join("");
    } catch (e) { return rgbToHex(colorStr); }
  }
  // Semantic design tokens an element's color can resolve to — editing the TOKEN recolors EVERY
  // use of it (the modular default), vs. a per-element override (the escape hatch). Order = the
  // label we show; brand/accent first so a link/button reads as "primary/accent", not "text".
  var SEMANTIC = [
    // Semantic roles first (best labels) — most element colors resolve to one of these.
    { v: "--color-brand", label: "primary (links & buttons)" },
    { v: "--color-accent", label: "accent" },
    { v: "--color-foreground", label: "body text" },
    { v: "--color-muted-foreground", label: "muted text" },
    { v: "--color-card-foreground", label: "card text" },
    { v: "--color-background", label: "the background" },
    { v: "--color-card", label: "cards" },
    { v: "--color-border", label: "borders" },
  ];
  // …then the raw ramps, so ANY themed shade an element uses (e.g. a nav link on --color-neutral-300)
  // is still retargetable — "everywhere this exact color is used".
  "50 100 200 300 400 500 600 700 800 900 950".split(" ").forEach(function (s) {
    SEMANTIC.push({ v: "--color-neutral-" + s, label: "this color" });
    SEMANTIC.push({ v: "--color-brand-" + s, label: "this primary shade" });
  });
  "300 400 500".split(" ").forEach(function (s) { SEMANTIC.push({ v: "--color-accent-" + s, label: "this accent shade" }); });
  function tokenLabel(v) {
    for (var i = 0; i < SEMANTIC.length; i++) if (SEMANTIC[i].v === v) return SEMANTIC[i].label;
    return "this color";
  }
  // The token an element ACTUALLY uses for `prefix` (text-/bg-) — read from its OWN Tailwind classes,
  // so we edit what it references (not a different token that merely shares the same value). Matching
  // by value alone is ambiguous: a black nav link and a black h1 can use DIFFERENT black tokens.
  function classColorVars(el, prefix) {
    var cls = (el.getAttribute && el.getAttribute("class")) || (typeof el.className === "string" ? el.className : "") || "";
    var out = [];
    cls.split(/\s+/).forEach(function (c) {
      var m = c.match(new RegExp("^" + prefix + "([a-z]+(?:-[0-9]{1,3})?|foreground|muted-foreground|card-foreground)$"));
      if (m) out.push("--color-" + m[1]);
    });
    return out;
  }
  // prefix = "text-" (color) or "bg-" (background). Class-based first, value-match fallback.
  function detectColorToken(el, hex, prefix) {
    var h = (hex || "").toLowerCase();
    var cands = classColorVars(el, prefix);
    for (var i = 0; i < cands.length; i++) {
      if (currentColorHex(cands[i]).toLowerCase() === h) return { v: cands[i], label: tokenLabel(cands[i]) };
    }
    for (var j = 0; j < SEMANTIC.length; j++) {
      if (currentColorHex(SEMANTIC[j].v).toLowerCase() === h) return SEMANTIC[j];
    }
    return null;
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
    // Clicks land inside an <svg> icon — start from the svg itself.
    var svg = el.closest ? el.closest("svg") : null;
    if (svg) el = svg;
    while (el && el !== document.body && el.nodeType === 1) {
      var tag = el.nodeName.toUpperCase();
      if (tag === "IMG") return el;
      if (tag === "A" || tag === "BUTTON") return el;
      if (TEXT_TAGS.test(tag) && (el.innerText || "").trim()) return el;
      if (tag === "SVG") {
        // Prefer the icon's styled container (bg colour / rounded) so we can drop
        // an image over the whole graphic block, not just the tiny svg.
        var c = el.parentElement;
        if (c && c !== document.body) {
          var cs = getComputedStyle(c);
          var hasBg = cs.backgroundColor && !/rgba?\([^)]*,\s*0\s*\)\s*$/.test(cs.backgroundColor) && cs.backgroundColor !== "transparent";
          if ((hasBg || /rounded/.test(c.className || "")) && !(c.innerText || "").trim()) return c;
        }
        return el;
      }
      // A block whose only content is an icon → a decorative graphic.
      if ((tag === "DIV" || tag === "SPAN" || tag === "FIGURE" || tag === "PICTURE") && el.querySelector && el.querySelector("svg") && !(el.innerText || "").trim()) return el;
      el = el.parentElement;
    }
    return null;
  }
  function elType(el) {
    var tag = el.nodeName.toUpperCase();
    if (tag === "IMG") return "image";
    if (tag === "A" || tag === "BUTTON") return "button";
    if (tag === "SVG" || (el.querySelector && el.querySelector("svg"))) return "graphic";
    return "text";
  }
  function applyImage(el, type, dataUrl) {
    if (type === "graphic") {
      el.style.setProperty("background-image", "url(" + dataUrl + ")", "important");
      el.style.setProperty("background-size", "cover", "important");
      el.style.setProperty("background-position", "center", "important");
      el.style.setProperty("background-repeat", "no-repeat", "important");
      var s = el.querySelector && el.querySelector("svg");
      if (s) s.style.opacity = "0"; else el.style.opacity = "1";
    } else {
      el.src = dataUrl;
    }
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
    if (!CAN_HOVER) return;                                 // touch: tap-to-select instead
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
  // Re-flow an open panel across the mobile/desktop breakpoint (rotate/resize mid-edit).
  var reflowT;
  window.addEventListener("resize", function () {
    if (!document.getElementById("__tbj-pop") || !selectedEl) return;
    clearTimeout(reflowT);
    reflowT = setTimeout(function () {
      var p = document.getElementById("__tbj-pop");
      if (!p || !selectedEl) return;
      var mobile = isMobile();
      p.style.cssText = panelCss(mobile);
      placePanel(p, selectedEl, mobile);
    }, 120);
  });

  // ---- click to select --------------------------------------------------
  var selectedEl = null;
  document.addEventListener("click", function (e) {
    if (isOurs(e.target)) return;
    if (mode === "brand") return;   // brand mode: leave page clicks alone (panel is toolbar-driven)
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
  var SHEET_VH = 62; // mobile bottom sheet height — leaves the top ~38vh to see the element
  // Panel chrome: a right/left popover on desktop, a bottom sheet on phones.
  function panelCss(mobile) {
    var base = "z-index:2147483001;overflow:auto;background:#fff;border:1px solid #e6e9ef;" +
      "font-family:system-ui,-apple-system,sans-serif;color:#0a0a0b;box-sizing:border-box;";
    if (mobile) return "position:fixed;left:0;right:0;bottom:0;top:auto;width:auto;max-width:none;max-height:" +
      SHEET_VH + "vh;border-bottom:0;border-radius:18px 18px 0 0;box-shadow:0 -12px 40px rgba(0,0,0,.28);" +
      "padding:10px 16px calc(16px + env(safe-area-inset-bottom));" + base;
    return "position:fixed;left:-9999px;top:0;width:300px;max-height:82vh;border-radius:14px;" +
      "box-shadow:0 20px 60px rgba(0,0,0,.35);padding:14px;" + base;
  }
  // A grab-handle so the bottom sheet reads as a sheet.
  function handleHtml(mobile) {
    return mobile ? '<div style="width:36px;height:4px;border-radius:999px;background:#e0e3ea;margin:0 auto 10px;"></div>' : "";
  }
  // While a mobile sheet is open, add page bottom-padding equal to the sheet so bottom-of-page
  // elements can scroll up into the visible strip (browsers clamp scroll at the doc's max).
  var savedBodyPad = null;
  function addSheetSpacer() {
    if (savedBodyPad === null) savedBodyPad = document.body.style.paddingBottom || "";
    document.body.style.paddingBottom = "calc(" + SHEET_VH + "vh + 24px)";
  }
  function removeSheetSpacer() {
    if (savedBodyPad !== null) { document.body.style.paddingBottom = savedBodyPad; savedBodyPad = null; }
  }
  // Scroll the target into the visible strip above the sheet so it isn't hidden.
  function ensureVisible(el) {
    var visH = window.innerHeight * (1 - SHEET_VH / 100);
    var r = el.getBoundingClientRect();
    var target = Math.max(10, (visH - Math.min(r.height, visH)) / 2);
    try { window.scrollBy(0, r.top - target); } catch (e) { /* ignore */ }
  }
  // Place a freshly-appended panel: bottom sheet (hide the toolbar so it can't cover the sheet's
  // action buttons; add a scroll spacer) vs the desktop popover positioned by the element.
  function placePanel(pop, el, mobile) {
    if (mobile) {
      bar.style.display = "none";
      addSheetSpacer();
      ensureVisible(el);
      moveHl(el); hl.style.boxShadow = "0 0 0 9999px rgba(10,10,11,.55)";
    } else {
      bar.style.display = "";
      removeSheetSpacer();
      positionPanel(pop, el.getBoundingClientRect());
    }
  }

  function openPanel(el) {
    closePanel();
    selectedEl = el;
    var mobile = isMobile();
    var snap = snapshot(el);
    var type = elType(el);
    var selector = cssPath(el), origText = textOf(el), change = {};
    var cs = getComputedStyle(el);

    // spotlight: dim everything except the highlighted element
    moveHl(el);
    hl.style.boxShadow = "0 0 0 9999px rgba(10,10,11,.55)";

    var pop = document.createElement("div");
    pop.id = "__tbj-pop";
    pop.style.cssText = panelCss(mobile);

    var h = handleHtml(mobile) +
      '<div style="display:flex;justify-content:space-between;align-items:center;">' +
      '<span style="font-size:11px;font-weight:700;color:#2f6bff;text-transform:uppercase;letter-spacing:.04em;">Edit ' +
      (type === "image" ? "image" : type === "graphic" ? "graphic" : type === "button" ? "button" : el.nodeName.toLowerCase()) + "</span>" +
      '<button id="__tbj-x" aria-label="close" style="border:0;background:#f5f7fb;border-radius:8px;width:26px;height:26px;cursor:pointer;font-size:15px;">✕</button></div>';

    // Scope toggle: "All <token>" (change everywhere that color is used — the modular default) vs
    // "Just this" (per-element override — the escape hatch). Rendered only when a token is detected.
    function scopeToggle(cls, tok) {
      if (!tok) return "";
      function b(s, lbl) {
        var on = s === "all";
        return '<button type="button" class="' + cls + '" data-scope="' + s + '" style="flex:1;border:1px solid ' +
          (on ? "#2f6bff" : "#e6e9ef") + ";background:" + (on ? "#eaf0ff" : "#fff") + ";color:" + (on ? "#2f6bff" : "#5b616e") +
          ';border-radius:8px;padding:6px;font-size:11px;font-weight:600;cursor:pointer;">' + lbl + "</button>";
      }
      return '<div style="display:flex;gap:6px;margin-top:6px;">' + b("all", "All " + tok.label) + b("one", "Just this") + "</div>";
    }
    var colorTok = null, bgTok = null;
    if (type === "text" || type === "button") {
      h += '<label style="display:block;font-size:12px;font-weight:600;margin-top:10px;">Text</label>' +
        '<textarea id="__tbj-text" style="width:100%;box-sizing:border-box;border:1px solid #e6e9ef;border-radius:8px;padding:8px;font-size:13px;font-family:inherit;min-height:48px;">' +
        origText.replace(/</g, "&lt;") + "</textarea>";
      var textHex = toHex(cs.color);
      colorTok = detectColorToken(el, textHex, "text-");
      h += '<label style="display:block;font-size:12px;font-weight:600;margin-top:10px;">Text color <span id="__tbj-ch" style="font-weight:400;color:#9aa0ad;">' + textHex + "</span>" +
        '<input id="__tbj-color" type="color" value="' + textHex + '" style="width:100%;height:30px;border:1px solid #e6e9ef;border-radius:6px;margin-top:4px;padding:0;"></label>' +
        scopeToggle("__tbj-cs", colorTok);
      if (type === "button") {
        var bgT = cs.backgroundColor === "transparent" || /rgba?\([^)]*,\s*0\s*\)\s*$/.test(cs.backgroundColor);
        var bgHex = bgT ? "#ffffff" : toHex(cs.backgroundColor);
        if (!bgT) bgTok = detectColorToken(el, bgHex, "bg-");
        // If text + background resolve to the SAME token, don't offer the token toggle twice —
        // the two controls would fight over one :root var. Background falls back to per-element.
        if (bgTok && colorTok && bgTok.v === colorTok.v) bgTok = null;
        h += '<label style="display:block;font-size:12px;font-weight:600;margin-top:10px;">Button color <span id="__tbj-bh" style="font-weight:400;color:#9aa0ad;">' + (bgT ? "none" : bgHex) + "</span>" +
          '<input id="__tbj-bg" type="color" value="' + bgHex + '" style="width:100%;height:30px;border:1px solid #e6e9ef;border-radius:6px;margin-top:4px;padding:0;"></label>' +
          scopeToggle("__tbj-bs", bgTok);
      }
    }
    if (type === "image" || type === "graphic") {
      var isGfx = type === "graphic";
      h += '<label style="display:block;font-size:12px;font-weight:600;margin-top:10px;">' + (isGfx ? "Replace this graphic with an image" : "Replace image") + "</label>" +
        '<input id="__tbj-img" type="file" accept="image/*" style="width:100%;font-size:12px;margin-top:4px;">' +
        '<div id="__tbj-in" style="font-size:11px;color:#9aa0ad;margin-top:2px;">Upload to preview it in place.</div>' +
        '<label style="display:block;font-size:12px;font-weight:600;margin-top:10px;">✨ Or generate with AI</label>' +
        '<textarea id="__tbj-ai" placeholder="' + (isGfx ? "Describe an image to use here…" : "Describe the image/logo…") + '" style="width:100%;box-sizing:border-box;border:1px solid #e6e9ef;border-radius:8px;padding:8px;font-size:13px;font-family:inherit;min-height:40px;"></textarea>' +
        (isGfx ? "" : '<label style="display:flex;gap:6px;font-size:11px;color:#5b616e;margin-top:4px;"><input type="checkbox" id="__tbj-ar" checked> use current image as reference</label>') +
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
    placePanel(pop, el, mobile);

    // wiring — live preview
    // Token overrides are GLOBAL (on :root), so the element snapshot can't undo them — track the
    // originals here and revert on Cancel.
    var appliedTokens = {};
    function setTokenLive(v, val) {
      if (!(v in appliedTokens)) appliedTokens[v] = document.documentElement.style.getPropertyValue(v);
      document.documentElement.style.setProperty(v, val); clearHexCache();
    }
    function revertToken(v) {
      if (v in appliedTokens) { var o = appliedTokens[v]; if (o) document.documentElement.style.setProperty(v, o); else document.documentElement.style.removeProperty(v); delete appliedTokens[v]; clearHexCache(); }
    }
    function revertAllTokens() { for (var v in appliedTokens) revertToken(v); }

    var ta = pop.querySelector("#__tbj-text");
    if (ta) ta.addEventListener("input", function () { el.textContent = ta.value; change.newText = ta.value; });

    // A color control that can target a TOKEN (all uses) or just this element, with a scope toggle.
    function wireColor(inputId, hexSpanId, scopeCls, tok, cssProp, changeKey) {
      var input = pop.querySelector("#" + inputId);
      if (!input) return;
      var span = pop.querySelector("#" + hexSpanId);
      var scope = tok ? "all" : "one";
      function apply(val) {
        if (tok && scope === "all") {
          el.style.removeProperty(cssProp);           // drop any per-element override
          setTokenLive(tok.v, val);                   // recolor everywhere this token is used
          change.semantic = change.semantic || {}; change.semantic[tok.v] = val;
          delete change[changeKey];
        } else {
          if (tok) revertToken(tok.v);                // drop the global override
          el.style.setProperty(cssProp, val, "important");
          change[changeKey] = val;
          if (change.semantic) { delete change.semantic[tok && tok.v]; if (!Object.keys(change.semantic).length) delete change.semantic; }
        }
        if (span) span.textContent = val;
      }
      input.addEventListener("input", function (e2) { apply(e2.target.value); });
      Array.prototype.forEach.call(pop.querySelectorAll("." + scopeCls), function (b) {
        b.onclick = function () {
          scope = b.getAttribute("data-scope");
          Array.prototype.forEach.call(pop.querySelectorAll("." + scopeCls), function (x) {
            var on = x === b; x.style.borderColor = on ? "#2f6bff" : "#e6e9ef"; x.style.background = on ? "#eaf0ff" : "#fff"; x.style.color = on ? "#2f6bff" : "#5b616e";
          });
          apply(input.value);
        };
      });
    }
    wireColor("__tbj-color", "__tbj-ch", "__tbj-cs", colorTok, "color", "color");
    wireColor("__tbj-bg", "__tbj-bh", "__tbj-bs", bgTok, "background-color", "background");
    var fi = pop.querySelector("#__tbj-img");
    if (fi) fi.addEventListener("change", function () {
      var f = fi.files[0]; if (!f) return;
      pop.querySelector("#__tbj-in").textContent = "Loading preview…";
      fileToDataUrl(f, function (d) { if (d) { applyImage(el, type, d); change.image = { name: f.name, dataUrl: d }; if (type === "graphic") change.replaceGraphic = true; pop.querySelector("#__tbj-in").textContent = "✓ Previewing " + f.name; } else pop.querySelector("#__tbj-in").textContent = "Couldn't read that image."; });
    });
    var gen = pop.querySelector("#__tbj-gen");
    if (gen) gen.addEventListener("click", function () {
      var pr = pop.querySelector("#__tbj-ai").value.trim(); if (pr.length < 3) { pop.querySelector("#__tbj-ai").focus(); return; }
      var arEl = pop.querySelector("#__tbj-ar"), gs = pop.querySelector("#__tbj-gs");
      gen.disabled = true; gs.textContent = "Generating… a few seconds.";
      fetch(GEN_URL, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ prompt: pr, refUrl: type === "image" && arEl && arEl.checked ? el.src : undefined }) })
        .then(function (r) { return r.json(); })
        .then(function (res) { gen.disabled = false; if (res && res.ok && res.dataUrl) { applyImage(el, type, res.dataUrl); change.image = { name: "ai-generated.png", dataUrl: res.dataUrl, prompt: pr }; if (type === "graphic") change.replaceGraphic = true; gs.textContent = "✓ Generated — Add edit to keep it."; } else gs.textContent = (res && res.error) || "Couldn't generate."; })
        .catch(function () { gen.disabled = false; gs.textContent = "Generation failed."; });
    });

    function cancel() { revertAllTokens(); restore(el, snap); closePanel(); }
    pop.querySelector("#__tbj-x").onclick = cancel;
    pop.querySelector("#__tbj-cancel").onclick = cancel;
    pop.querySelector("#__tbj-add").onclick = function () {
      var note = pop.querySelector("#__tbj-note").value.trim();
      if (note) change.note = note;
      if (Object.keys(change).length === 0) { pop.querySelector("#__tbj-note").focus(); return; }
      // Keep the token preview applied, but remember the originals so Undo can revert them too.
      var tks = null;
      if (change.semantic) { tks = {}; for (var v in appliedTokens) tks[v] = appliedTokens[v]; }
      edits.push({ selector: selector, tag: el.nodeName.toLowerCase(), text: origText, changes: change });
      history.push({ el: el, snapshot: snap, tokens: tks });
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
    bar.style.display = ""; removeSheetSpacer();   // un-hide the toolbar + drop the scroll spacer
  }

  // ---- section panel (layout / component swaps — applied by the forge) --
  function openSectionPanel(info) {
    closePanel();
    selectedEl = info.el;
    var mobile = isMobile();
    moveHl(info.el);
    hl.style.boxShadow = "0 0 0 9999px rgba(10,10,11,.55)";
    var chosen = { variant: null };

    var pop = document.createElement("div");
    pop.id = "__tbj-pop";
    pop.style.cssText = panelCss(mobile);

    var h = handleHtml(mobile) +
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
    placePanel(pop, info.el, mobile);

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

  // ---- brand panel (modular theme — colors + fonts, applied site-wide) --
  // Read the site's CURRENT token value as a hex, so the picker starts from reality.
  // Cached: resolving a token → hex is a probe + canvas read; detection runs it for ~30 tokens per
  // click. Cache per var, cleared whenever a :root token value actually changes (clearHexCache).
  var _hexCache = {};
  function currentColorHex(varName) {
    if (varName in _hexCache) return _hexCache[varName];
    var probe = document.createElement("div");
    probe.style.cssText = "position:absolute;left:-9999px;top:0;width:1px;height:1px;background:var(" + varName + ")";
    document.body.appendChild(probe);
    var raw = getComputedStyle(probe).backgroundColor;   // may be oklch()/color() on modern browsers
    probe.remove();
    return (_hexCache[varName] = toHex(raw));
  }
  function clearHexCache() { _hexCache = {}; }
  function positionPanelCenter(pop) {
    var pw = 300, ph = pop.offsetHeight || 360;
    pop.style.left = Math.max(14, (innerWidth - pw) / 2) + "px";
    pop.style.top = Math.max(14, (innerHeight - ph) / 2) + "px";
  }
  function openBrandPanel() {
    closePanel();
    var mobile = isMobile();
    var pop = document.createElement("div");
    pop.id = "__tbj-pop";
    pop.style.cssText = panelCss(mobile);
    var lblCss = "display:block;font-size:12px;font-weight:600;margin-top:12px;";
    var swatchCss = "width:100%;height:38px;border:1px solid #e6e9ef;border-radius:8px;margin-top:4px;padding:0;cursor:pointer;";
    // Pre-fill from the pending edit, else the SAVED theme, else the site's current computed color.
    var savedFontId = (CFG_THEME && CFG_THEME.fontId) || (CFG_THEME && CFG_THEME.font ? (FONT_SETS.filter(function (x) { return x.name === CFG_THEME.font; })[0] || {}).id : null);
    var primHex = theme.primary || (CFG_THEME && CFG_THEME.primaryHex) || currentColorHex("--color-brand");
    var secHex = theme.secondary || (CFG_THEME && CFG_THEME.secondaryHex) || currentColorHex("--color-accent");
    var activeFont = theme.font || savedFontId;
    var fontsHtml = FONT_SETS.map(function (f) {
      var on = activeFont === f.id;
      return '<button type="button" class="__tbj-f" data-f="' + f.id + '" style="border:1px solid ' + (on ? "#2f6bff" : "#e6e9ef") +
        ";background:" + (on ? "#2f6bff" : "#fff") + ";color:" + (on ? "#fff" : "#0a0a0b") +
        ';border-radius:999px;padding:7px 12px;font-size:13px;cursor:pointer;font-family:' + f.head + '">' + f.name + "</button>";
    }).join("");
    pop.innerHTML = handleHtml(mobile) +
      '<div style="display:flex;justify-content:space-between;align-items:center;">' +
      '<span style="font-size:11px;font-weight:700;color:#2f6bff;text-transform:uppercase;letter-spacing:.04em;">🎨 Brand &amp; colors</span>' +
      '<button id="__tbj-x" aria-label="close" style="border:0;background:#f5f7fb;border-radius:8px;width:26px;height:26px;cursor:pointer;font-size:15px;">✕</button></div>' +
      '<p style="font-size:11px;color:#9aa0ad;margin:6px 0 0;line-height:1.4;">Changes apply <b>everywhere</b> this color or font is used — not just one spot.</p>' +
      '<label style="' + lblCss + '">Primary color <span style="font-weight:400;color:#9aa0ad;">buttons, links, highlights</span></label>' +
      '<input id="__tbj-prim" type="color" value="' + primHex + '" style="' + swatchCss + '">' +
      '<label style="' + lblCss + '">Secondary color <span style="font-weight:400;color:#9aa0ad;">accents</span></label>' +
      '<input id="__tbj-sec" type="color" value="' + secHex + '" style="' + swatchCss + '">' +
      '<label style="' + lblCss + '">Font</label>' +
      '<div id="__tbj-fonts" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">' + fontsHtml + "</div>" +
      '<div style="display:flex;gap:8px;margin-top:14px;">' +
      '<button id="__tbj-brand-add" style="flex:1;background:#2f6bff;color:#fff;border:0;border-radius:999px;padding:10px;font-weight:600;font-size:13px;cursor:pointer;">Apply to whole site</button>' +
      '<button id="__tbj-brand-reset" style="background:#f5f7fb;border:0;border-radius:999px;padding:10px 12px;font-size:13px;cursor:pointer;">Reset</button></div>' +
      '<div style="font-size:11px;color:#9aa0ad;margin-top:6px;text-align:center;">Preview updates live. Reset clears your pending changes.' +
      (CFG_THEME ? ' · <button id="__tbj-brand-revert" style="border:0;background:none;color:#2f6bff;font-size:11px;cursor:pointer;text-decoration:underline;padding:0;">Revert to original</button>' : "") +
      "</div>";
    document.documentElement.appendChild(pop);
    if (mobile) { bar.style.display = "none"; } else positionPanelCenter(pop);

    pop.querySelector("#__tbj-prim").addEventListener("input", function (e) { theme.primary = e.target.value; applyTheme(); });
    pop.querySelector("#__tbj-sec").addEventListener("input", function (e) { theme.secondary = e.target.value; applyTheme(); });
    Array.prototype.forEach.call(pop.querySelectorAll(".__tbj-f"), function (btn) {
      btn.onclick = function () {
        theme.font = btn.getAttribute("data-f"); applyTheme();
        Array.prototype.forEach.call(pop.querySelectorAll(".__tbj-f"), function (b) {
          var on = b === btn; b.style.borderColor = on ? "#2f6bff" : "#e6e9ef"; b.style.background = on ? "#2f6bff" : "#fff"; b.style.color = on ? "#fff" : "#0a0a0b";
        });
      };
    });
    pop.querySelector("#__tbj-x").onclick = function () { closePanel(); };
    pop.querySelector("#__tbj-brand-reset").onclick = function () { resetTheme(); dropTokenEdit(); renderBar(); closePanel(); openBrandPanel(); };
    var revertBtn = pop.querySelector("#__tbj-brand-revert");
    if (revertBtn) revertBtn.onclick = function () {
      // clearFont tells the forge the prior theme wired a font (next/font in layout.tsx), so the
      // revert must route through the LLM to un-wire it — not just strip the color block.
      var hadFont = !!(CFG_THEME && (CFG_THEME.font || CFG_THEME.fontId));
      // Clear the SAVED theme: drop the proxy-injected theme + preview, queue a clearing edit.
      resetTheme();
      var ts = document.getElementById("__tbj-theme"); if (ts) ts.remove();
      var tf = document.getElementById("__tbj-theme-font"); if (tf) tf.remove();
      CFG_THEME = null;
      dropTokenEdit();
      edits.push({ kind: "token", tag: "theme", text: "Revert brand to original", changes: { clear: true, clearFont: hadFont } });
      history.push({ theme: true });
      closePanel(); renderBar();
    };
    pop.querySelector("#__tbj-brand-add").onclick = function () {
      if (!theme.primary && !theme.secondary && !theme.font) { closePanel(); return; }
      var f = FONT_SETS.filter(function (x) { return x.id === theme.font; })[0];
      var pO = theme.primary ? hexToOklch(theme.primary) : null;
      var sO = theme.secondary ? hexToOklch(theme.secondary) : null;
      dropTokenEdit();   // one token edit = the current full theme (replace, don't stack)
      edits.push({ kind: "token", tag: "theme", text: "Brand & colors", changes: {
        primaryHex: theme.primary || undefined,
        brandH: pO ? pO.h : undefined,
        brandC: pO ? Number(Math.min(0.22, pO.C).toFixed(3)) : undefined,
        secondaryHex: theme.secondary || undefined,
        accentH: sO ? sO.h : undefined,
        font: f ? f.name : undefined,
        fontId: f ? f.id : undefined,              // stable id (rename-proof pre-fill)
        fontGoogle: f ? f.g : undefined,           // the family spec the forge imports via next/font
        fontHeadingStack: f ? f.head : undefined,  // fallback CSS stack
        fontSansStack: f ? f.body : undefined,
      } });
      history.push({ theme: true });   // keep Undo consistent (undo resets the theme preview)
      closePanel(); renderBar();
    };
  }

  // ---- toolbar ----------------------------------------------------------
  var bar = document.createElement("div");
  bar.id = "__tbj-editor";
  bar.style.cssText =
    "position:fixed;z-index:2147483002;left:50%;bottom:calc(16px + env(safe-area-inset-bottom));transform:translateX(-50%);" +
    "background:#0a0a0b;color:#fff;border-radius:999px;padding:10px 16px;display:flex;align-items:center;justify-content:center;" +
    "flex-wrap:wrap;gap:8px;font-family:system-ui,sans-serif;font-size:14px;box-shadow:0 12px 40px rgba(0,0,0,.3);max-width:92vw;";
  document.documentElement.appendChild(bar);

  function undo() {
    var last = history.pop(); if (!last) return;
    if (last.theme) resetTheme();
    else {
      restore(last.el, last.snapshot);
      if (last.tokens) for (var v in last.tokens) { var o = last.tokens[v]; if (o) document.documentElement.style.setProperty(v, o); else document.documentElement.style.removeProperty(v); }
    }
    edits.pop();
    renderBar();
  }
  function modeBtn(id, label, on) {
    return '<button id="' + id + '" style="border:0;border-radius:999px;padding:5px 11px;font-size:12px;font-weight:600;cursor:pointer;' +
      (on ? "background:#2f6bff;color:#fff;" : "background:transparent;color:#cfd2d8;") + '">' + label + "</button>";
  }
  function renderBar() {
    var canUndo = edits.length > 0;
    bar.innerHTML =
      '<span style="display:inline-flex;background:#2a2b31;border-radius:999px;padding:2px;">' +
      modeBtn("__tbj-m-el", "Elements", mode === "element") + modeBtn("__tbj-m-sec", "Sections", mode === "section") + modeBtn("__tbj-m-brand", "🎨 Brand", mode === "brand") + "</span>" +
      // Undo lives right next to the mode toggle, always visible (dimmed when empty).
      '<button id="__tbj-undo"' + (canUndo ? "" : " disabled") +
      ' style="background:#33343a;color:#fff;border:0;border-radius:999px;padding:7px 12px;font-size:13px;' +
      "cursor:" + (canUndo ? "pointer" : "default") + ";opacity:" + (canUndo ? "1" : ".4") + ';">↶ Undo</button>' +
      '<span style="background:#2f6bff;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:700;">' + edits.length + "</span>" +
      (canUndo ? '<button id="__tbj-send" style="background:#2f6bff;color:#fff;border:0;border-radius:999px;padding:8px 16px;font-weight:600;font-size:13px;cursor:pointer;">Send ' + edits.length + " edit" + (edits.length > 1 ? "s" : "") + " →</button>" : "");
    bar.querySelector("#__tbj-m-el").onclick = function () { mode = "element"; closePanel(); hl.style.display = "none"; renderBar(); };
    bar.querySelector("#__tbj-m-sec").onclick = function () { mode = "section"; closePanel(); hl.style.display = "none"; renderBar(); };
    bar.querySelector("#__tbj-m-brand").onclick = function () { mode = "brand"; closePanel(); hl.style.display = "none"; renderBar(); openBrandPanel(); };
    var u = bar.querySelector("#__tbj-undo"); if (u && canUndo) u.onclick = undo;
    var s = bar.querySelector("#__tbj-send"); if (s) s.onclick = submit;
  }
  function submit() {
    var s = bar.querySelector("#__tbj-send"); if (s) { s.disabled = true; s.textContent = "Sending…"; }
    fetch(SAVE_URL, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ siteId: SITE_ID, edits: edits }) })
      .then(function (r) { return r.json(); })
      .then(function (res) { if (res && res.ok) { edits = []; history = []; resetTheme(); bar.innerHTML = '<span style="font-weight:600;">✅ Sent! Our team will apply your changes and let you know.</span>'; } else if (s) { s.disabled = false; s.textContent = "Retry"; } })
      .catch(function () { if (s) { s.disabled = false; s.textContent = "Retry"; } });
  }
  renderBar();

  // Sticky/fixed headers: the site's JS normally turns a transparent nav solid on scroll. With JS
  // stripped, ONLY fix truly-transparent headers — and only when their text is DARK (so it needs a
  // light backdrop to be readable off the hero). A header with its OWN background (e.g. a dark
  // bg-neutral-950 bar) is left untouched — force-whitening those made their light text invisible.
  function fixHeaders() {
    var heads = document.querySelectorAll("header");
    for (var i = 0; i < heads.length; i++) {
      var h = heads[i], cs = getComputedStyle(h);
      if (cs.position !== "sticky" && cs.position !== "fixed") continue;
      if (!(h.innerText || "").trim()) continue;                       // no text of its own → skip
      var bg = cs.backgroundColor;
      if (bg && bg !== "transparent" && !/rgba?\([^)]*,\s*0\s*\)\s*$/.test(bg)) continue;  // has its own bg → leave it
      // Sample a REAL text node's color (a header often paints no text itself; its links do).
      var txt = h.querySelector("a, button, span, li, p") || h;
      var hex = toHex(getComputedStyle(txt).color);
      var lum = 0.299 * parseInt(hex.slice(1, 3), 16) + 0.587 * parseInt(hex.slice(3, 5), 16) + 0.114 * parseInt(hex.slice(5, 7), 16);
      if (lum < 150) { h.style.backgroundColor = "var(--color-background)"; h.style.borderBottom = "1px solid var(--color-border)"; }  // dark text → give it a light backdrop
    }
  }
  fixHeaders();
})();
