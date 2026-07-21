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
  // font = a curated FONT_SETS id; customFont = any Google Font the user typed in ({name, g, head, body}).
  // Mutually exclusive — picking one clears the other.
  var theme = { primary: null, secondary: null, font: null, customFont: null };
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
    var fontPick = null;
    if (theme.font) { fontPick = FONT_SETS.filter(function (x) { return x.id === theme.font; })[0] || null; }
    else if (theme.customFont) { fontPick = theme.customFont; }
    if (fontPick) {
      loadFont(fontPick.g);
      root.setProperty("--font-heading-stack", fontPick.head);
      root.setProperty("--font-sans-stack", fontPick.body);
      // Belt AND suspenders: templates consume the two tokens above, but sites that don't (TBJ's
      // own front of house, next/font-wired pages) would preview nothing. A preview-only style tag
      // forces the pick everywhere; on template sites it resolves to the same values, so no drift.
      var fs = document.getElementById("__tbj-font-preview");
      if (!fs) { fs = document.createElement("style"); fs.id = "__tbj-font-preview"; document.head.appendChild(fs); }
      fs.textContent = "body,p,li,a,button,input,textarea{font-family:" + fontPick.body + " !important}" +
        "h1,h2,h3,h4,h5,h6{font-family:" + fontPick.head + " !important}";
    }
    clearHexCache();
  }
  function resetTheme() {
    theme = { primary: null, secondary: null, font: null, customFont: null };
    var root = document.documentElement.style;
    ["--brand-h", "--brand-c", "--accent-h", "--font-heading-stack", "--font-sans-stack"].forEach(function (v) { root.removeProperty(v); });
    var fl = document.getElementById("__tbj-font"); if (fl) fl.remove();
    var fp = document.getElementById("__tbj-font-preview"); if (fp) fp.remove();
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

  // Section mode: GUIDED section editing. Clicking a section offers visual layout options (with a
  // live in-place try-on of their own copy), a "swap for a different kind of section" row, a
  // one-tap Remove, and only then the free-text escape hatch. Thumbnails are inline SVG wireframes —
  // "split"/"fullBleed" mean nothing to a plumber; a picture does.
  var mode = "element";

  // ---- wireframe thumbnails (tiny inline SVGs, no external assets) ------
  // Geometry + fill are INLINE STYLES, not presentation attributes, on purpose: sites built on
  // CSS-layer resets (Tailwind v4 preflight) can outrank presentation attributes in the cascade,
  // which silently zeroes every shape. Inline style always wins. (SVG2 geometry-as-CSS.)
  function svgW(inner) { return '<svg viewBox="0 0 72 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="display:block;width:100%;height:auto;background:#f8fafd;border-radius:6px;">' + inner + "</svg>"; }
  function tb(x, y, w, h, f, rx) { return '<rect style="x:' + x + "px;y:" + y + "px;width:" + w + "px;height:" + h + "px;rx:" + (rx == null ? 2 : rx) + "px;fill:" + (f || "#9aa8c0") + ';"/>'; }
  function ts(x, y, w, h, s, rx) { return '<rect style="x:' + x + "px;y:" + y + "px;width:" + w + "px;height:" + h + "px;rx:" + (rx == null ? 3 : rx) + "px;fill:none;stroke:" + s + ';stroke-width:1;"/>'; }
  function tl(x, y, w, f) { return tb(x, y, w, 3, f || "#8e9cb8", 1.5); }
  function tc(x, y, r, f) { return '<circle style="cx:' + x + "px;cy:" + y + "px;r:" + r + "px;fill:" + (f || "#8e9cb8") + ';"/>'; }
  var TACC = "#2f6bff", TDK = "#3a3d46";
  var THUMBS = {
    "hero.split": svgW(tl(6, 12, 24, TDK) + tl(6, 18, 20) + tl(6, 24, 16) + tb(6, 31, 14, 6, TACC, 3) + tb(38, 8, 28, 32, "#8e9cb8", 3)),
    "hero.fullBleed": svgW(tb(2, 4, 68, 40, "#aeb8cc", 3) + tl(20, 17, 32, "#ffffff") + tl(26, 23, 20, "#e8ecf4") + tb(28, 30, 16, 6, TACC, 3)),
    "hero.centered": svgW(tl(22, 12, 28, TDK) + tl(26, 18, 20) + tl(29, 24, 14) + tb(28, 31, 16, 6, TACC, 3)),
    "hero.minimal": svgW(tl(6, 18, 36, TDK) + tl(6, 25, 26)),
    "nav.standard": svgW(tb(2, 4, 68, 12, "#ccd6e6", 3) + tc(9, 10, 3, TACC) + tl(40, 8, 8) + tl(50, 8, 8) + tl(60, 8, 8)),
    "nav.centered": svgW(tb(2, 4, 68, 12, "#ccd6e6", 3) + tc(9, 10, 3, TACC) + tl(26, 8, 8) + tl(36, 8, 8) + tl(46, 8, 8)),
    "nav.floating": svgW(tb(8, 7, 56, 11, "#ffffff", 5.5) + ts(8, 7, 56, 11, "#8e9cb8", 5.5) + tc(15, 12.5, 2.5, TACC) + tl(42, 11, 6) + tl(50, 11, 6)),
    "stats.band": svgW(tb(2, 14, 68, 20, TDK, 3) + tl(10, 22, 12, "#ffffff") + tl(30, 22, 12, "#ffffff") + tl(50, 22, 12, "#ffffff")),
    "stats.inline": svgW(tl(10, 22, 12, TDK) + tl(30, 22, 12, TDK) + tl(50, 22, 12, TDK)),
    "services.cards": svgW(tb(4, 10, 20, 28, "#ffffff", 3) + ts(4, 10, 20, 28, "#9aa8c0") + tl(7, 26, 14) + tb(26, 10, 20, 28, "#ffffff", 3) + ts(26, 10, 20, 28, "#9aa8c0") + tl(29, 26, 14) + tb(48, 10, 20, 28, "#ffffff", 3) + ts(48, 10, 20, 28, "#9aa8c0") + tl(51, 26, 14)),
    "services.list": svgW(tb(6, 8, 60, 9, "#ccd6e6", 3) + tb(6, 20, 60, 9, "#ccd6e6", 3) + tb(6, 32, 60, 9, "#ccd6e6", 3)),
    "services.alternating": svgW(tb(6, 7, 26, 15, "#8e9cb8", 3) + tl(38, 11, 22) + tl(38, 16, 16) + tl(6, 30, 22) + tl(6, 35, 16) + tb(40, 26, 26, 15, "#8e9cb8", 3)),
    "swap.testimonials": svgW(tb(6, 10, 28, 26, "#ffffff", 3) + ts(6, 10, 28, 26, "#9aa8c0") + tc(12, 17, 3) + tl(9, 25, 20) + tl(9, 30, 14) + tb(38, 10, 28, 26, "#ffffff", 3) + ts(38, 10, 28, 26, "#9aa8c0") + tc(44, 17, 3) + tl(41, 25, 20) + tl(41, 30, 14)),
    "swap.gallery": svgW(tb(5, 6, 19, 16, "#8e9cb8", 2) + tb(26, 6, 19, 16, "#8e9cb8", 2) + tb(47, 6, 19, 16, "#8e9cb8", 2) + tb(5, 25, 19, 16, "#8e9cb8", 2) + tb(26, 25, 19, 16, "#8e9cb8", 2) + tb(47, 25, 19, 16, "#8e9cb8", 2)),
    "swap.faq": svgW(tb(6, 6, 60, 8, "#ccd6e6", 2) + tl(10, 8.5, 30, TDK) + tb(6, 16, 60, 8, "#ccd6e6", 2) + tl(10, 18.5, 24, TDK) + tb(6, 26, 60, 8, "#ccd6e6", 2) + tl(10, 28.5, 34, TDK) + tb(6, 36, 60, 8, "#ccd6e6", 2) + tl(10, 38.5, 20, TDK)),
    "swap.cta": svgW(tb(2, 12, 68, 24, TACC, 4) + tl(20, 19, 32, "#ffffff") + tb(27, 26, 18, 6, "#ffffff", 3)),
    "swap.beforeAfter": svgW(tb(4, 8, 30, 32, "#8e9cb8", 3) + tb(38, 8, 30, 32, "#8f9bb3", 3) + tb(35, 6, 2, 36, TACC, 1)),
    "swap.guarantee": svgW(tc(16, 18, 7, TACC) + tc(36, 18, 7, "#8e9cb8") + tc(56, 18, 7, "#8e9cb8") + tl(9, 32, 14) + tl(29, 32, 14) + tl(49, 32, 14)),
    "swap.pricing": svgW(tb(5, 8, 19, 32, "#ffffff", 3) + ts(5, 8, 19, 32, "#9aa8c0") + tb(26, 5, 19, 38, "#ffffff", 3) + ts(26, 5, 19, 38, TACC) + tb(47, 8, 19, 32, "#ffffff", 3) + ts(47, 8, 19, 32, "#9aa8c0")),
  };

  // Layout options per section kind — [variant, friendly label, thumb key]. Variants match the
  // @webdev/ui `variant` props the forge applies (see edit-poll's prompt).
  var VARIANTS = {
    home: [["split", "Text + photo", "hero.split"], ["fullBleed", "Full-photo", "hero.fullBleed"], ["centered", "Centered", "hero.centered"], ["minimal", "Minimal", "hero.minimal"]],
    nav: [["standard", "Classic", "nav.standard"], ["centered", "Centered", "nav.centered"], ["floating", "Floating", "nav.floating"]],
    stats: [["band", "Color band", "stats.band"], ["inline", "Plain row", "stats.inline"]],
    services: [["cards", "Cards", "services.cards"], ["list", "List", "services.list"], ["alternating", "Alternating", "services.alternating"]],
  };
  // What a section can be SWAPPED to — "want something different here?". The copy carries over;
  // the forge rebuilds it for real on save. [kind, label, thumb key]
  var SWAPS = [
    ["testimonials", "Testimonials", "swap.testimonials"],
    ["gallery", "Photo gallery", "swap.gallery"],
    ["before-after", "Before & after", "swap.beforeAfter"],
    ["faq", "FAQ", "swap.faq"],
    ["stats", "Stats / numbers", "stats.band"],
    ["guarantee", "Guarantee badges", "swap.guarantee"],
    ["cta", "Call-to-action", "swap.cta"],
    ["pricing", "Pricing", "swap.pricing"],
  ];
  var SECTIONS = {
    home: { label: "Hero" }, stats: { label: "Stats band" }, services: { label: "Services" },
    about: { label: "About" }, gallery: { label: "Gallery" }, pricing: { label: "Pricing" },
    testimonials: { label: "Testimonials" }, faq: { label: "FAQ" }, cta: { label: "Call-to-action" },
    contact: { label: "Contact" },
  };
  function prettyId(id) { return id.charAt(0).toUpperCase() + id.slice(1).replace(/[-_]+/g, " "); }
  function sectionTarget(el) {
    while (el && el !== document.body && el.nodeType === 1) {
      var t = el.nodeName;
      // `chrome` = structural page furniture (nav/footer): layout options only — no swap, no remove.
      if (t === "HEADER") return { el: el, id: "nav", label: "Navigation bar", chrome: true };
      if (t === "FOOTER") return { el: el, id: "footer", label: "Footer", chrome: true };
      if (t === "SECTION" && el.id) { var s = SECTIONS[el.id] || { label: prettyId(el.id) }; return { el: el, id: el.id, label: s.label }; }
      el = el.parentElement;
    }
    return null;
  }

  // ---- live try-on: approximate a layout with CSS, in place, with THEIR copy ----
  // Honest approximation: the forge builds the real thing on save; this re-arranges what's already
  // on screen so the choice is visible. Every try-on starts from the section's ORIGINAL snapshot
  // (the panel restores before applying), so switching options never compounds. All best-effort —
  // a failed heuristic just means the thumbnail carries the message alone.
  function eachEl(list, fn) { Array.prototype.forEach.call(list, fn); }
  function contentWrap(sec) { var el = sec.firstElementChild; while (el && el.children.length === 1) el = el.firstElementChild; return el || sec; }
  function findGrid(sec) {
    var els = sec.querySelectorAll("div,ul,ol");
    for (var i = 0; i < els.length; i++) {
      var cs = getComputedStyle(els[i]);
      if ((cs.display === "grid" || cs.display === "flex") && els[i].children.length >= 2 && els[i].children.length <= 12) return els[i];
    }
    return null;
  }
  var TRYON = {
    "home.centered": function (sec) { sec.style.textAlign = "center"; eachEl(sec.querySelectorAll("img"), function (im) { im.style.margin = "18px auto 0"; im.style.display = "block"; }); var w = contentWrap(sec); if (w !== sec) w.style.display = "block"; },
    "home.minimal": function (sec) { eachEl(sec.querySelectorAll("img,video,svg"), function (m) { m.style.display = "none"; }); sec.style.textAlign = "center"; },
    "home.split": function (sec) { var w = contentWrap(sec); if (!w || w.children.length < 2) return; w.style.display = "flex"; w.style.alignItems = "center"; w.style.gap = "40px"; eachEl(w.children, function (c) { c.style.flex = "1 1 0"; c.style.maxWidth = "none"; }); sec.style.textAlign = "left"; },
    "home.fullBleed": function (sec) {
      var img = sec.querySelector("img"); if (!img) return;
      sec.style.position = "relative"; sec.style.overflow = "hidden";
      img.style.cssText += ";position:absolute;top:0;left:0;right:0;bottom:0;width:100%;height:100%;object-fit:cover;opacity:.22;z-index:0;margin:0;";
      eachEl(sec.children, function (c) { if (c !== img) { c.style.position = "relative"; c.style.zIndex = "1"; } });
    },
    "nav.standard": function () { /* the template default — restoring the snapshot IS the preview */ },
    "nav.centered": function (sec) { var w = contentWrap(sec); w.style.display = "flex"; w.style.justifyContent = "center"; w.style.gap = "28px"; },
    "nav.floating": function (sec) { sec.style.cssText += ";margin:10px 14px 0;border-radius:999px;box-shadow:0 10px 30px rgba(0,0,0,.12);border:1px solid #e6e9ef;overflow:hidden;"; },
    "stats.band": function (sec, css) { sec.style.background = "#101114"; css(" *{color:#fff !important}"); },
    "stats.inline": function (sec) { sec.style.background = "transparent"; },
    "services.cards": function (sec) { var g = findGrid(sec); if (!g) return; eachEl(g.children, function (c) { c.style.border = "1px solid #e6e9ef"; c.style.borderRadius = "14px"; c.style.padding = "18px"; }); },
    "services.list": function (sec) { var g = findGrid(sec); if (!g) return; g.style.display = "grid"; g.style.gridTemplateColumns = "1fr"; g.style.gap = "14px"; eachEl(g.children, function (c) { c.style.display = "flex"; c.style.alignItems = "center"; c.style.gap = "16px"; c.style.textAlign = "left"; }); },
    "services.alternating": function (sec) { var g = findGrid(sec); if (!g) return; g.style.display = "grid"; g.style.gridTemplateColumns = "1fr"; g.style.gap = "18px"; eachEl(g.children, function (c, i) { c.style.display = "flex"; c.style.gap = "18px"; c.style.alignItems = "center"; c.style.flexDirection = i % 2 ? "row-reverse" : "row"; c.style.textAlign = "left"; }); },
  };
  // In-place SWAP preview: the section becomes a FULL-SCALE skeleton of the target kind — real
  // layout shapes (cards, avatars, bars, grids) built from plain divs, so "what goes here" is
  // unmistakable. Dashed frame + label keep it honest: a plan, not the finished thing.
  var SK = { block: "#dfe5f0", bar: "#c6cfe0", dark: "#aab6cc", acc: "#2f6bff", card: "#ffffff", line: "#e6e9ef" };
  function skDiv(css, inner) { return '<div style="' + css + '">' + (inner || "") + "</div>"; }
  function skBar(w, h, c, extra) { return skDiv("width:" + w + ";height:" + (h || 12) + "px;border-radius:6px;background:" + (c || SK.bar) + ";" + (extra || "")); }
  function skCircle(d, c) { return skDiv("width:" + d + "px;height:" + d + "px;border-radius:50%;background:" + (c || SK.dark) + ";flex:0 0 auto;"); }
  function skCard(inner, extra) { return skDiv("flex:1 1 220px;background:" + SK.card + ";border:1px solid " + SK.line + ";border-radius:14px;padding:20px;box-shadow:0 2px 10px rgba(10,10,11,.04);" + (extra || ""), inner); }
  var SKELETONS = {
    testimonials: function () {
      var card = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">' + skCircle(38) + '<div style="flex:1;">' + skBar("60%", 10, SK.dark) + '<div style="height:6px;"></div>' + skBar("40%", 8) + "</div></div>" + skBar("100%", 9) + '<div style="height:7px;"></div>' + skBar("92%", 9) + '<div style="height:7px;"></div>' + skBar("70%", 9);
      return skDiv("display:flex;gap:18px;flex-wrap:wrap;", skCard(card) + skCard(card) + skCard(card));
    },
    gallery: function () {
      var cell = skDiv("aspect-ratio:4/3;border-radius:12px;background:" + SK.bar + ";");
      return skDiv("display:grid;grid-template-columns:repeat(3,1fr);gap:14px;", cell + skDiv("aspect-ratio:4/3;border-radius:12px;background:" + SK.dark + ";") + cell + skDiv("aspect-ratio:4/3;border-radius:12px;background:" + SK.dark + ";") + cell + skDiv("aspect-ratio:4/3;border-radius:12px;background:" + SK.bar + ";"));
    },
    "before-after": function () {
      return skDiv("display:flex;gap:4px;align-items:stretch;",
        skDiv("flex:1;aspect-ratio:4/3;border-radius:14px 4px 4px 14px;background:" + SK.bar + ";display:flex;align-items:flex-end;padding:12px;", skBar("70px", 20, "rgba(255,255,255,.85)")) +
        skDiv("width:4px;border-radius:2px;background:" + SK.acc + ";") +
        skDiv("flex:1;aspect-ratio:4/3;border-radius:4px 14px 14px 4px;background:" + SK.dark + ";display:flex;align-items:flex-end;padding:12px;", skBar("60px", 20, "rgba(255,255,255,.85)")));
    },
    faq: function () {
      var row = skDiv("display:flex;align-items:center;gap:14px;background:" + SK.card + ";border:1px solid " + SK.line + ";border-radius:12px;padding:16px 18px;margin-bottom:10px;", skBar("55%", 11, SK.dark) + '<div style="flex:1;"></div>' + skDiv("width:22px;height:22px;border-radius:50%;background:" + SK.block + ";display:flex;align-items:center;justify-content:center;color:#5b616e;font-weight:700;font-size:14px;flex:0 0 auto;", "+"));
      return row + row + row + row;
    },
    stats: function () {
      var cell = skDiv("text-align:center;flex:1;", skBar("58%", 26, "rgba(255,255,255,.9)", "margin:0 auto;") + '<div style="height:8px;"></div>' + skBar("70%", 8, "rgba(255,255,255,.45)", "margin:0 auto;"));
      return skDiv("background:#12131a;border-radius:16px;padding:34px 22px;display:flex;gap:18px;", cell + cell + cell);
    },
    guarantee: function () {
      var b = skDiv("text-align:center;flex:1;min-width:120px;", skDiv("width:52px;height:52px;border-radius:50%;background:" + SK.block + ";border:2px solid " + SK.acc + ";margin:0 auto;") + '<div style="height:10px;"></div>' + skBar("70%", 9, SK.dark, "margin:0 auto;") + '<div style="height:6px;"></div>' + skBar("50%", 7, SK.bar, "margin:0 auto;"));
      return skDiv("display:flex;gap:18px;flex-wrap:wrap;", b + b + b);
    },
    cta: function () {
      return skDiv("background:" + SK.acc + ";border-radius:16px;padding:40px 24px;text-align:center;", skBar("46%", 20, "rgba(255,255,255,.92)", "margin:0 auto;") + '<div style="height:10px;"></div>' + skBar("30%", 10, "rgba(255,255,255,.55)", "margin:0 auto;") + '<div style="height:16px;"></div>' + skDiv("display:inline-block;width:150px;height:38px;border-radius:999px;background:#ffffff;"));
    },
    pricing: function () {
      function col(hot) {
        return skDiv("flex:1 1 180px;background:" + SK.card + ";border:2px solid " + (hot ? SK.acc : SK.line) + ";border-radius:14px;padding:20px;" + (hot ? "transform:scale(1.03);" : ""),
          skBar("50%", 10, SK.dark) + '<div style="height:10px;"></div>' + skBar("40%", 22, hot ? SK.acc : SK.dark) + '<div style="height:14px;"></div>' + skBar("100%", 7) + '<div style="height:6px;"></div>' + skBar("90%", 7) + '<div style="height:6px;"></div>' + skBar("80%", 7) + '<div style="height:14px;"></div>' + skDiv("height:34px;border-radius:999px;background:" + (hot ? SK.acc : SK.block) + ";"));
      }
      return skDiv("display:flex;gap:16px;flex-wrap:wrap;align-items:center;", col(false) + col(true) + col(false));
    },
  };
  function swapSkeleton(sec, swap, headline) {
    function eschtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
    var body = SKELETONS[swap[0]] ? SKELETONS[swap[0]]() : '<div style="max-width:320px;margin:0 auto;">' + (THUMBS[swap[2]] || "") + "</div>";
    sec.innerHTML =
      '<div style="max-width:1000px;margin:0 auto;padding:36px 20px;">' +
      '<div style="border:2px dashed rgba(47,107,255,.5);border-radius:18px;background:rgba(47,107,255,.03);padding:22px;">' +
      '<div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:16px;">' +
      '<span style="background:' + SK.acc + ';color:#fff;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;border-radius:999px;padding:4px 12px;">Preview — ' + swap[1] + "</span></div>" +
      (headline ? '<div style="font-weight:800;font-size:24px;text-align:center;color:#0a0a0b;margin-bottom:18px;">' + eschtml(headline) + "</div>" : "") +
      body +
      '<div style="font-size:12px;color:#5b616e;margin-top:16px;text-align:center;">This becomes a real <b>' + swap[1] + "</b> section — keeping your copy — when you send your changes.</div>" +
      "</div></div>";
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
      // A block that carries its OWN text — a badge/pill/eyebrow built as a <div> (text as a direct
      // text node, e.g. the industries strip above a hero h1). Direct text nodes only: a wrapper
      // whose text all lives in child elements has none of its own, so we keep walking and select
      // the child instead of the container.
      if (tag === "DIV" || tag === "FIGCAPTION" || tag === "DD" || tag === "DT") {
        var direct = "";
        for (var di = 0; di < el.childNodes.length; di++) { var dn = el.childNodes[di]; if (dn.nodeType === 3) direct += dn.textContent; }
        if (direct.trim()) return el;
      }
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
      if (p.getAttribute("data-tbj-moved")) return; // user placed it — leave it where they put it
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

  // Drag-to-move (desktop): grab the panel by its header row and put it wherever it's not in the
  // way. Mobile keeps the fixed bottom sheet. Once moved, the resize reflow leaves it alone.
  function makeDraggable(pop, mobile) {
    if (mobile) return;
    var head = pop.firstElementChild;
    if (!head) return;
    head.style.cursor = "grab";
    head.title = "Drag to move";
    head.addEventListener("pointerdown", function (e) {
      // Buttons/inputs in the header (like ✕) keep working normally.
      if (e.target.closest && e.target.closest("button,input,textarea,select,a")) return;
      e.preventDefault();
      var rect = pop.getBoundingClientRect();
      // Convert whatever positioning the panel used (right-dock, transform) into plain left/top.
      pop.style.left = rect.left + "px"; pop.style.top = rect.top + "px";
      pop.style.right = "auto"; pop.style.bottom = "auto"; pop.style.transform = "none";
      pop.setAttribute("data-tbj-moved", "1");
      var sx = e.clientX, sy = e.clientY, bl = rect.left, bt = rect.top, w = rect.width;
      head.style.cursor = "grabbing";
      try { head.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
      function onMove(ev) {
        var nl = Math.min(Math.max(bl + ev.clientX - sx, 8), window.innerWidth - w - 8);
        var nt = Math.min(Math.max(bt + ev.clientY - sy, 8), window.innerHeight - 48);
        pop.style.left = nl + "px"; pop.style.top = nt + "px";
      }
      function onUp(ev) {
        head.style.cursor = "grab";
        try { head.releasePointerCapture(ev.pointerId); } catch (err) { /* ignore */ }
        head.removeEventListener("pointermove", onMove);
        head.removeEventListener("pointerup", onUp);
        head.removeEventListener("pointercancel", onUp);
      }
      head.addEventListener("pointermove", onMove);
      head.addEventListener("pointerup", onUp);
      head.addEventListener("pointercancel", onUp);
    });
  }

  function openPanel(el) {
    closePanel();
    selectedEl = el;
    var mobile = isMobile();
    var snap = snapshot(el);
    var type = elType(el);
    var selector = cssPath(el), origText = textOf(el), change = {};
    // origText is a TRUNCATED label (…); the Text tool must edit the element's FULL text, or a long
    // paragraph gets silently cut to 120 chars on Approve. Collapse formatting whitespace for editing.
    var origTextFull = (el.textContent || "").replace(/\s+/g, " ").trim();
    var cs = getComputedStyle(el);

    // spotlight: dim everything except the highlighted element
    moveHl(el);
    hl.style.boxShadow = "0 0 0 9999px rgba(10,10,11,.55)";

    var pop = document.createElement("div");
    pop.id = "__tbj-pop";
    pop.style.cssText = panelCss(mobile);
    var origFontPx = Math.round(parseFloat(cs.fontSize) || 16); // true original size, for Reset

    // Token overrides are GLOBAL (on :root); the element snapshot can't undo them, so track the
    // originals and revert on discard. Shared by every tool.
    var appliedTokens = {};
    function setTokenLive(v, val) {
      if (!(v in appliedTokens)) appliedTokens[v] = document.documentElement.style.getPropertyValue(v);
      document.documentElement.style.setProperty(v, val); clearHexCache();
    }
    function revertToken(v) {
      if (v in appliedTokens) { var o = appliedTokens[v]; if (o) document.documentElement.style.setProperty(v, o); else document.documentElement.style.removeProperty(v); delete appliedTokens[v]; clearHexCache(); }
    }
    function revertAllTokens() { for (var v in appliedTokens) revertToken(v); }

    // Intent-first: pick a tool tile, then only that tool's controls show. Tiles are per element type.
    var TOOLS = { text: ["✏️", "Text"], size: ["🅰", "Size"], color: ["🎨", "Color"], image: ["🖼", "Image"], request: ["💬", "Request"] };
    var tools = (type === "image" || type === "graphic") ? ["image", "request"]
      : (type === "button") ? ["text", "color", "size", "request"]
      : ["text", "size", "color", "request"];
    // Tag names only where they read like English (h1, p, a…). A badge/pill <div> says "text",
    // not "EDIT DIV" — nobody edits a "div".
    var typeLabel = type === "graphic" ? "graphic" : type === "image" ? "image" : type === "button" ? "button"
      : TEXT_TAGS.test(el.nodeName) ? el.nodeName.toLowerCase() : "text";

    pop.innerHTML = handleHtml(mobile) +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">' +
        '<span id="__tbj-title" style="font-size:11px;font-weight:700;color:#2f6bff;text-transform:uppercase;letter-spacing:.04em;">Edit ' + typeLabel + '</span>' +
        '<button id="__tbj-x" aria-label="close" style="border:0;background:#f5f7fb;border-radius:8px;width:26px;height:26px;cursor:pointer;font-size:15px;flex:0 0 auto;">✕</button>' +
      '</div>' +
      '<div id="__tbj-body" style="margin-top:10px;"></div>' +
      '<div style="display:flex;gap:8px;margin-top:12px;">' +
        '<button id="__tbj-approve" style="flex:1;background:#2f6bff;color:#fff;border:0;border-radius:999px;padding:10px;font-weight:600;font-size:13px;cursor:pointer;">Approve changes</button>' +
        '<button id="__tbj-cancel" style="background:#f5f7fb;border:0;border-radius:999px;padding:10px 14px;font-size:13px;cursor:pointer;">Cancel</button>' +
      '</div>' +
      '<div style="font-size:11px;color:#9aa0ad;margin-top:6px;text-align:center;">Closing or Cancel discards these changes.</div>';

    document.documentElement.appendChild(pop);
    placePanel(pop, el, mobile);
    makeDraggable(pop, mobile);
    var body = pop.querySelector("#__tbj-body");
    var title = pop.querySelector("#__tbj-title");

    function esc(s) { return String(s).replace(/</g, "&lt;"); }
    function lbl(t) { return '<label style="display:block;font-size:12px;font-weight:600;">' + t + '</label>'; }
    // Reframed scope control: "Everywhere it's used" (the modular token) vs "Just this" (per-element).
    function scopeCtl(cls, tok) {
      if (!tok) return "";
      function b(s, l) { var on = s === "all"; return '<button type="button" class="' + cls + '" data-scope="' + s + '" style="flex:1;border:1px solid ' + (on ? "#2f6bff" : "#e6e9ef") + ";background:" + (on ? "#eaf0ff" : "#fff") + ";color:" + (on ? "#2f6bff" : "#5b616e") + ';border-radius:8px;padding:7px;font-size:11px;font-weight:600;cursor:pointer;">' + l + "</button>"; }
      return '<div style="font-size:11px;color:#9aa0ad;margin:8px 0 4px;">Apply to</div><div style="display:flex;gap:6px;">' + b("all", "Everywhere it’s used") + b("one", "Just this") + "</div>";
    }
    // A color control that targets a TOKEN (all uses) or just this element, with the scope control.
    function wireColor(inputId, hexSpanId, scopeCls, tok, cssProp, changeKey) {
      var input = body.querySelector("#" + inputId);
      if (!input) return;
      var span = body.querySelector("#" + hexSpanId);
      var scope = tok ? "all" : "one";
      function apply(val) {
        if (tok && scope === "all") {
          el.style.removeProperty(cssProp); setTokenLive(tok.v, val);
          change.semantic = change.semantic || {}; change.semantic[tok.v] = val; delete change[changeKey];
        } else {
          if (tok) revertToken(tok.v); el.style.setProperty(cssProp, val, "important"); change[changeKey] = val;
          if (change.semantic) { delete change.semantic[tok && tok.v]; if (!Object.keys(change.semantic).length) delete change.semantic; }
        }
        if (span) span.textContent = val;
      }
      input.addEventListener("input", function (e2) { apply(e2.target.value); });
      Array.prototype.forEach.call(body.querySelectorAll("." + scopeCls), function (b) {
        b.onclick = function () {
          scope = b.getAttribute("data-scope");
          Array.prototype.forEach.call(body.querySelectorAll("." + scopeCls), function (x) { var on = x === b; x.style.borderColor = on ? "#2f6bff" : "#e6e9ef"; x.style.background = on ? "#eaf0ff" : "#fff"; x.style.color = on ? "#2f6bff" : "#5b616e"; });
          apply(input.value);
        };
      });
    }

    var toolBuilders = {
      text: function () {
        body.innerHTML = lbl("Text") + '<textarea id="__tbj-text" style="width:100%;box-sizing:border-box;border:1px solid #e6e9ef;border-radius:8px;padding:8px;font-size:13px;font-family:inherit;min-height:64px;margin-top:4px;">' + esc(change.newText != null ? change.newText : origTextFull) + '</textarea>';
        var ta = body.querySelector("#__tbj-text");
        ta.addEventListener("input", function () { el.textContent = ta.value; change.newText = ta.value; });
        try { ta.focus(); } catch (e) { /* */ }
      },
      size: function () {
        var cur = Math.round(parseFloat(getComputedStyle(el).fontSize) || origFontPx);
        body.innerHTML = lbl("Text size") +
          '<div style="display:flex;align-items:center;gap:10px;margin-top:6px;">' +
            '<button id="__tbj-smaller" style="width:44px;height:38px;border:1px solid #e6e9ef;background:#fff;border-radius:10px;font-size:13px;cursor:pointer;">A−</button>' +
            '<span id="__tbj-sizeval" style="flex:1;text-align:center;font-size:13px;font-weight:600;">' + cur + 'px</span>' +
            '<button id="__tbj-bigger" style="width:44px;height:38px;border:1px solid #e6e9ef;background:#fff;border-radius:10px;font-size:19px;cursor:pointer;">A+</button>' +
          '</div>' +
          '<button id="__tbj-sizereset" style="margin-top:8px;width:100%;border:0;background:#f5f7fb;border-radius:999px;padding:7px;font-size:12px;cursor:pointer;">Reset to ' + origFontPx + 'px</button>';
        var out = body.querySelector("#__tbj-sizeval");
        function setSize(n) { cur = Math.max(8, Math.min(200, Math.round(n))); el.style.setProperty("font-size", cur + "px", "important"); change.fontSize = cur + "px"; out.textContent = cur + "px"; }
        body.querySelector("#__tbj-smaller").onclick = function () { setSize(cur / 1.1); };
        body.querySelector("#__tbj-bigger").onclick = function () { setSize(cur * 1.1); };
        body.querySelector("#__tbj-sizereset").onclick = function () { el.style.removeProperty("font-size"); delete change.fontSize; cur = origFontPx; out.textContent = origFontPx + "px"; };
      },
      color: function () {
        var cs2 = getComputedStyle(el), textHex = toHex(cs2.color), colorTok = detectColorToken(el, textHex, "text-");
        var html = lbl('Text color <span id="__tbj-ch" style="font-weight:400;color:#9aa0ad;">' + textHex + '</span>') +
          '<input id="__tbj-color" type="color" value="' + textHex + '" style="width:100%;height:34px;border:1px solid #e6e9ef;border-radius:6px;margin-top:4px;padding:0;">' + scopeCtl("__tbj-cs", colorTok);
        var bgTok = null;
        if (type === "button") {
          var bgT = cs2.backgroundColor === "transparent" || /rgba?\([^)]*,\s*0\s*\)\s*$/.test(cs2.backgroundColor);
          var bgHex = bgT ? "#ffffff" : toHex(cs2.backgroundColor);
          if (!bgT) bgTok = detectColorToken(el, bgHex, "bg-");
          if (bgTok && colorTok && bgTok.v === colorTok.v) bgTok = null;
          html += '<div style="height:1px;background:#eef0f4;margin:12px 0;"></div>' +
            lbl('Button color <span id="__tbj-bh" style="font-weight:400;color:#9aa0ad;">' + (bgT ? "none" : bgHex) + '</span>') +
            '<input id="__tbj-bg" type="color" value="' + bgHex + '" style="width:100%;height:34px;border:1px solid #e6e9ef;border-radius:6px;margin-top:4px;padding:0;">' + scopeCtl("__tbj-bs", bgTok);
        }
        body.innerHTML = html;
        wireColor("__tbj-color", "__tbj-ch", "__tbj-cs", colorTok, "color", "color");
        wireColor("__tbj-bg", "__tbj-bh", "__tbj-bs", bgTok, "background-color", "background");
      },
      image: function () {
        var isGfx = type === "graphic";
        body.innerHTML = lbl(isGfx ? "Replace this graphic with an image" : "Replace image") +
          '<input id="__tbj-img" type="file" accept="image/*" style="width:100%;font-size:12px;margin-top:4px;">' +
          '<div id="__tbj-in" style="font-size:11px;color:#9aa0ad;margin-top:2px;">Upload to preview it in place.</div>' +
          lbl("✨ Or generate with AI") +
          '<textarea id="__tbj-ai" placeholder="' + (isGfx ? "Describe an image to use here…" : "Describe the image/logo…") + '" style="width:100%;box-sizing:border-box;border:1px solid #e6e9ef;border-radius:8px;padding:8px;font-size:13px;font-family:inherit;min-height:44px;margin-top:4px;"></textarea>' +
          (isGfx ? "" : '<label style="display:flex;gap:6px;font-size:11px;color:#5b616e;margin-top:4px;"><input type="checkbox" id="__tbj-ar" checked> use current image as reference</label>') +
          '<button id="__tbj-gen" style="margin-top:6px;width:100%;background:#0a0a0b;color:#fff;border:0;border-radius:999px;padding:8px;font-weight:600;font-size:13px;cursor:pointer;">Generate</button>' +
          '<div id="__tbj-gs" style="font-size:11px;color:#9aa0ad;margin-top:4px;"></div>';
        var fi = body.querySelector("#__tbj-img");
        fi.addEventListener("change", function () {
          var f = fi.files[0]; if (!f) return;
          body.querySelector("#__tbj-in").textContent = "Loading preview…";
          fileToDataUrl(f, function (d) { if (d) { applyImage(el, type, d); change.image = { name: f.name, dataUrl: d }; if (type === "graphic") change.replaceGraphic = true; body.querySelector("#__tbj-in").textContent = "✓ Previewing " + f.name; } else body.querySelector("#__tbj-in").textContent = "Couldn't read that image."; });
        });
        var gen = body.querySelector("#__tbj-gen");
        gen.addEventListener("click", function () {
          var pr = body.querySelector("#__tbj-ai").value.trim(); if (pr.length < 3) { body.querySelector("#__tbj-ai").focus(); return; }
          var arEl = body.querySelector("#__tbj-ar"), gs = body.querySelector("#__tbj-gs");
          gen.disabled = true; gs.textContent = "Generating… a few seconds.";
          fetch(GEN_URL, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ prompt: pr, refUrl: type === "image" && arEl && arEl.checked ? el.src : undefined }) })
            .then(function (r) { return r.json(); })
            .then(function (res) { gen.disabled = false; if (res && res.ok && res.dataUrl) { applyImage(el, type, res.dataUrl); change.image = { name: "ai-generated.png", dataUrl: res.dataUrl, prompt: pr }; if (type === "graphic") change.replaceGraphic = true; gs.textContent = "✓ Generated — Approve to keep it."; } else gs.textContent = (res && res.error) || "Couldn't generate."; })
            .catch(function () { gen.disabled = false; gs.textContent = "Generation failed."; });
        });
      },
      request: function () {
        body.innerHTML = lbl('Request a change <span style="font-weight:400;color:#9aa0ad;">(our team applies it)</span>') +
          '<textarea id="__tbj-note" placeholder="Describe what you want… e.g. move this up, reword it, add a button." style="width:100%;box-sizing:border-box;border:1px solid #e6e9ef;border-radius:8px;padding:8px;font-size:13px;font-family:inherit;min-height:72px;margin-top:4px;">' + esc(change.note || "") + '</textarea>';
        var n = body.querySelector("#__tbj-note");
        n.addEventListener("input", function () { var v = n.value.trim(); if (v) change.note = v; else delete change.note; });
        try { n.focus(); } catch (e) { /* */ }
      }
    };

    function showTiles() {
      title.textContent = "Edit " + typeLabel;
      var tiles = tools.map(function (t) {
        var m = TOOLS[t];
        return '<button type="button" class="__tbj-tile" data-tool="' + t + '" style="flex:1 1 calc(50% - 5px);min-width:84px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;border:1px solid #e6e9ef;background:#fff;border-radius:14px;cursor:pointer;padding:14px 6px;">' +
          '<span style="font-size:22px;line-height:1;">' + m[0] + '</span><span style="font-size:12px;font-weight:600;color:#0a0a0b;">' + m[1] + '</span></button>';
      }).join("");
      body.innerHTML = '<div style="font-size:11px;color:#9aa0ad;margin-bottom:8px;">What do you want to change?</div><div style="display:flex;flex-wrap:wrap;gap:10px;">' + tiles + '</div>';
      Array.prototype.forEach.call(body.querySelectorAll(".__tbj-tile"), function (b) { b.onclick = function () { showTool(b.getAttribute("data-tool")); }; });
    }
    function showTool(name) {
      title.innerHTML = '<button type="button" id="__tbj-back" style="border:0;background:none;color:#2f6bff;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;cursor:pointer;padding:0;">‹ ' + TOOLS[name][1] + '</button>';
      toolBuilders[name]();
      var back = pop.querySelector("#__tbj-back"); if (back) back.onclick = showTiles;
    }
    if (tools.length === 1) showTool(tools[0]); else showTiles();

    // Discard (X / Cancel) reverts every previewed change — nothing is saved unless Approved.
    function cancel() { revertAllTokens(); restore(el, snap); closePanel(); }
    pop.querySelector("#__tbj-x").onclick = cancel;
    pop.querySelector("#__tbj-cancel").onclick = cancel;
    pop.querySelector("#__tbj-approve").onclick = function () {
      if (Object.keys(change).length === 0) { showTiles(); return; } // nothing changed → back to tiles
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
  // A panel can register a discard callback (revert un-approved live previews) that runs on ANY
  // close path — ✕, Cancel, or a toolbar mode switch. Approve clears it first so kept changes stay.
  var panelDiscard = null;
  function closePanel() {
    var p = document.getElementById("__tbj-pop"); if (p) p.remove();
    if (panelDiscard) { var f = panelDiscard; panelDiscard = null; try { f(); } catch (e) { /* best-effort */ } }
    hl.style.boxShadow = "none"; hl.style.display = "none"; selectedEl = null;
    bar.style.display = ""; removeSheetSpacer();   // un-hide the toolbar + drop the scroll spacer
  }

  // ---- section panel (guided: layouts w/ live try-on · swap · remove · describe) --
  function openSectionPanel(info) {
    closePanel();
    var sec = info.el;
    selectedEl = sec;
    var mobile = isMobile();
    moveHl(sec);
    hl.style.boxShadow = "0 0 0 9999px rgba(10,10,11,.55)";

    // Everything previews from the section's ORIGINAL state, captured once here. Switching options
    // restores first, so try-ons never compound; Cancel/✕/mode-switch restores via panelDiscard.
    var base = snapshot(sec);
    var headline = ((sec.querySelector("h1,h2,h3") || {}).innerText || "").trim().slice(0, 80);
    var injected = [];             // <style> tags a try-on scoped to this section
    var chosen = { variant: null, swap: null };
    function resetPreview() {
      for (var i = 0; i < injected.length; i++) { try { injected[i].remove(); } catch (e) { /* gone */ } }
      injected = [];
      restore(sec, base);
      moveHl(sec);
    }
    panelDiscard = resetPreview;
    function scopedCss(rules) {
      sec.setAttribute("data-tbj-sec-tryon", "");
      var st = document.createElement("style");
      st.textContent = "[data-tbj-sec-tryon]" + rules;
      document.head.appendChild(st);
      injected.push(st);
    }

    var variants = VARIANTS[info.id] || [];
    var pop = document.createElement("div");
    pop.id = "__tbj-pop";
    pop.style.cssText = panelCss(mobile);
    if (!mobile) pop.style.width = "340px";

    var h = handleHtml(mobile) +
      '<div style="display:flex;justify-content:space-between;align-items:center;">' +
      '<span style="font-size:11px;font-weight:700;color:#2f6bff;text-transform:uppercase;letter-spacing:.04em;">' + info.label + " section</span>" +
      '<button id="__tbj-x" aria-label="close" style="border:0;background:#f5f7fb;border-radius:8px;width:26px;height:26px;cursor:pointer;font-size:15px;">✕</button></div>';

    if (variants.length) {
      h += '<label style="display:block;font-size:12px;font-weight:600;margin-top:10px;">Layout <span style="font-weight:400;color:#9aa0ad;">— tap to try it on</span></label>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px;">';
      variants.forEach(function (v, i) {
        h += '<button type="button" class="__tbj-vc" data-i="' + i + '" style="border:1px solid #e6e9ef;background:#fff;border-radius:10px;padding:6px 6px 4px;cursor:pointer;text-align:center;">' +
          THUMBS[v[2]] + '<div style="font-size:11px;font-weight:600;margin-top:4px;color:#0a0a0b;">' + v[1] + "</div></button>";
      });
      h += "</div>";
    }

    if (!info.chrome) {
      h += '<label style="display:block;font-size:12px;font-weight:600;margin-top:12px;">Want something different here?</label>' +
        '<div id="__tbj-swaps" style="display:flex;gap:8px;overflow-x:auto;padding:6px 2px 2px;-webkit-overflow-scrolling:touch;">';
      SWAPS.forEach(function (s, i) {
        if (s[0] === info.id) return; // don't offer swapping a section to itself
        h += '<button type="button" class="__tbj-sw" data-i="' + i + '" style="flex:0 0 88px;border:1px solid #e6e9ef;background:#fff;border-radius:10px;padding:6px 6px 4px;cursor:pointer;text-align:center;">' +
          THUMBS[s[2]] + '<div style="font-size:10px;font-weight:600;margin-top:4px;color:#0a0a0b;white-space:nowrap;">' + s[1] + "</div></button>";
      });
      h += "</div>";
    }

    h += '<label style="display:block;font-size:12px;font-weight:600;margin-top:12px;">Anything else? <span style="font-weight:400;color:#9aa0ad;">(optional)</span></label>' +
      '<textarea id="__tbj-snote" placeholder="e.g. make this a video hero, add our awards, reorder the items…" style="width:100%;box-sizing:border-box;border:1px solid #e6e9ef;border-radius:8px;padding:8px;font-size:13px;font-family:inherit;min-height:44px;"></textarea>';

    if (!info.chrome) {
      h += '<button id="__tbj-srm" style="width:100%;margin-top:10px;background:#fff;border:1px solid #f3c1c1;color:#c0392b;border-radius:999px;padding:8px;font-weight:600;font-size:13px;cursor:pointer;">🗑 Remove this section</button>';
    }

    h += '<div style="display:flex;gap:8px;margin-top:10px;"><button id="__tbj-sadd" style="flex:1;background:#2f6bff;color:#fff;border:0;border-radius:999px;padding:10px;font-weight:600;font-size:13px;cursor:pointer;">Approve changes</button>' +
      '<button id="__tbj-scancel" style="background:#f5f7fb;border:0;border-radius:999px;padding:10px 12px;font-size:13px;cursor:pointer;">Cancel</button></div>' +
      '<div style="font-size:11px;color:#9aa0ad;margin-top:6px;text-align:center;">Previews are approximate — our team builds the real thing when you send.</div>';

    pop.innerHTML = h;
    document.documentElement.appendChild(pop);
    placePanel(pop, sec, mobile);
    if (!mobile) {
      // Sections are full-width, so a popover positioned "by the element" lands ON the thing being
      // previewed. Dock to the right edge instead — devtools-style — so the try-on stays visible.
      pop.style.left = "auto";
      pop.style.right = "16px";
      pop.style.top = "50%";
      pop.style.transform = "translateY(-50%)";
      pop.style.maxHeight = "88vh";
    }
    makeDraggable(pop, mobile);

    function markCards(cls, activeBtn) {
      Array.prototype.forEach.call(pop.querySelectorAll("." + cls), function (b) {
        b.style.borderColor = "#e6e9ef"; b.style.background = "#fff"; b.style.boxShadow = "none";
      });
      if (activeBtn) { activeBtn.style.borderColor = "#2f6bff"; activeBtn.style.background = "#eaf0ff"; activeBtn.style.boxShadow = "0 0 0 1px #2f6bff"; }
    }

    Array.prototype.forEach.call(pop.querySelectorAll(".__tbj-vc"), function (btn) {
      btn.onclick = function () {
        var v = variants[Number(btn.getAttribute("data-i"))];
        resetPreview();
        chosen.variant = v[0]; chosen.swap = null;
        markCards("__tbj-sw", null); markCards("__tbj-vc", btn);
        var fn = TRYON[info.id + "." + v[0]];
        if (fn) { try { fn(sec, scopedCss); } catch (e) { /* approximation failed — thumbnail carries it */ } }
        moveHl(sec);
      };
    });
    Array.prototype.forEach.call(pop.querySelectorAll(".__tbj-sw"), function (btn) {
      btn.onclick = function () {
        var s = SWAPS[Number(btn.getAttribute("data-i"))];
        resetPreview();
        chosen.swap = s; chosen.variant = null;
        markCards("__tbj-vc", null); markCards("__tbj-sw", btn);
        try { swapSkeleton(sec, s, headline); } catch (e) { /* thumbnail carries it */ }
        moveHl(sec);
      };
    });

    pop.querySelector("#__tbj-x").onclick = closePanel;       // panelDiscard restores the preview
    pop.querySelector("#__tbj-scancel").onclick = closePanel;

    var rm = pop.querySelector("#__tbj-srm");
    if (rm) rm.onclick = function () {
      // One tap: the section visibly disappears, the removal queues, Undo brings it back.
      resetPreview();
      sec.style.display = "none";
      var sel = "section#" + info.id;
      edits.push({ selector: sel, tag: "section", text: info.label, section: info.id, changes: { remove: true } });
      history.push({ el: sec, snapshot: base });
      panelDiscard = null;
      closePanel(); renderBar();
    };

    pop.querySelector("#__tbj-sadd").onclick = function () {
      var note = pop.querySelector("#__tbj-snote").value.trim();
      if (!chosen.variant && !chosen.swap && !note) { pop.querySelector("#__tbj-snote").focus(); return; }
      var sel = info.id === "nav" ? "header" : info.id === "footer" ? "footer" : "section#" + info.id;
      edits.push({
        selector: sel, tag: "section", text: info.label, section: info.id,
        changes: {
          variant: chosen.variant || undefined,
          swapTo: chosen.swap ? chosen.swap[0] : undefined,
          swapLabel: chosen.swap ? chosen.swap[1] : undefined,
          note: note || undefined,
        },
      });
      // Keep the live preview on the page (like element edits); Undo restores the original + drops
      // any injected preview css.
      history.push({ el: sec, snapshot: base, styleTags: injected.slice() });
      injected = [];
      panelDiscard = null;
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
    // Snapshot the theme as it stands on open (the last saved/approved state) so X / Cancel revert the
    // live preview back to it — closing must never leave an un-approved theme applied to the page.
    var openTheme = { primary: theme.primary, secondary: theme.secondary, font: theme.font };
    function discardBrand() {
      resetTheme(); // strips the inline preview props → back to the saved theme
      if (openTheme.primary || openTheme.secondary || openTheme.font) { theme.primary = openTheme.primary; theme.secondary = openTheme.secondary; theme.font = openTheme.font; applyTheme(); }
      closePanel();
    }
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
      '<div style="display:flex;gap:6px;margin-top:8px;">' +
      '<input id="__tbj-gfont" type="text" placeholder="Or any Google Font — e.g. Montserrat" style="flex:1;min-width:0;border:1px solid #e6e9ef;border-radius:8px;padding:7px 10px;font-size:12px;font-family:inherit;box-sizing:border-box;">' +
      '<button id="__tbj-gfont-go" type="button" style="border:1px solid #e6e9ef;background:#fff;border-radius:999px;padding:7px 12px;font-size:12px;font-weight:600;cursor:pointer;flex:0 0 auto;">Try it</button></div>' +
      '<div id="__tbj-gfont-msg" style="font-size:11px;color:#9aa0ad;margin-top:4px;min-height:14px;">Browse thousands at fonts.google.com — type a name here to preview it.</div>' +
      '<div style="display:flex;gap:8px;margin-top:14px;">' +
      '<button id="__tbj-brand-add" style="flex:1;background:#2f6bff;color:#fff;border:0;border-radius:999px;padding:10px;font-weight:600;font-size:13px;cursor:pointer;">Approve changes</button>' +
      '<button id="__tbj-brand-cancel" style="background:#f5f7fb;border:0;border-radius:999px;padding:10px 14px;font-size:13px;cursor:pointer;">Cancel</button></div>' +
      '<div style="font-size:11px;color:#9aa0ad;margin-top:6px;text-align:center;">Preview updates live · Cancel discards it · <button id="__tbj-brand-reset" style="border:0;background:none;color:#2f6bff;font-size:11px;cursor:pointer;text-decoration:underline;padding:0;">Reset</button>' +
      (CFG_THEME ? ' · <button id="__tbj-brand-revert" style="border:0;background:none;color:#2f6bff;font-size:11px;cursor:pointer;text-decoration:underline;padding:0;">Revert to original</button>' : "") +
      "</div>";
    document.documentElement.appendChild(pop);
    if (mobile) { bar.style.display = "none"; } else positionPanelCenter(pop);
    makeDraggable(pop, mobile);

    pop.querySelector("#__tbj-prim").addEventListener("input", function (e) { theme.primary = e.target.value; applyTheme(); });
    pop.querySelector("#__tbj-sec").addEventListener("input", function (e) { theme.secondary = e.target.value; applyTheme(); });
    Array.prototype.forEach.call(pop.querySelectorAll(".__tbj-f"), function (btn) {
      btn.onclick = function () {
        theme.font = btn.getAttribute("data-f"); theme.customFont = null; applyTheme();
        var gm = pop.querySelector("#__tbj-gfont-msg"); if (gm) { gm.textContent = ""; gm.style.color = "#9aa0ad"; }
        Array.prototype.forEach.call(pop.querySelectorAll(".__tbj-f"), function (b) {
          var on = b === btn; b.style.borderColor = on ? "#2f6bff" : "#e6e9ef"; b.style.background = on ? "#2f6bff" : "#fff"; b.style.color = on ? "#fff" : "#0a0a0b";
        });
      };
    });

    // "Or any Google Font" — the escape hatch past the curated pairings. We validate the name by
    // fetching the css2 stylesheet (Google 400s on unknown families), then preview it exactly like
    // a curated pick. The forge wires whatever we send via next/font, so any real family works.
    var gIn = pop.querySelector("#__tbj-gfont"), gGo = pop.querySelector("#__tbj-gfont-go"), gMsg = pop.querySelector("#__tbj-gfont-msg");
    function tryGoogleFont() {
      var name = (gIn.value || "").replace(/[^A-Za-z0-9 ]/g, "").trim().replace(/\s+/g, " ");
      if (!name) { gIn.focus(); return; }
      // Google lists families Title-Cased ("montserrat" → "Montserrat").
      name = name.split(" ").map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(" ");
      var g = name.replace(/ /g, "+") + ":wght@400;600;800";
      gMsg.textContent = "Checking Google Fonts…"; gMsg.style.color = "#9aa0ad";
      fetch("https://fonts.googleapis.com/css2?family=" + g + "&display=swap")
        .then(function (r) { if (!r.ok) throw new Error("not found"); })
        .then(function () {
          var stack = "'" + name + "', ui-sans-serif, system-ui, sans-serif";
          theme.customFont = { name: name, g: g, head: stack, body: stack };
          theme.font = null;
          Array.prototype.forEach.call(pop.querySelectorAll(".__tbj-f"), function (b) { b.style.borderColor = "#e6e9ef"; b.style.background = "#fff"; b.style.color = "#0a0a0b"; });
          applyTheme();
          gMsg.textContent = "✓ Previewing " + name + " — applied everywhere. Approve to keep it.";
          gMsg.style.color = "#1a7f37";
        })
        .catch(function () {
          gMsg.textContent = "Couldn’t find “" + name + "” on Google Fonts — check the spelling at fonts.google.com.";
          gMsg.style.color = "#c0392b";
        });
    }
    gGo.onclick = tryGoogleFont;
    gIn.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); tryGoogleFont(); } });
    pop.querySelector("#__tbj-x").onclick = discardBrand;
    pop.querySelector("#__tbj-brand-cancel").onclick = discardBrand;
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
      if (!theme.primary && !theme.secondary && !theme.font && !theme.customFont) { closePanel(); return; }
      var f = FONT_SETS.filter(function (x) { return x.id === theme.font; })[0];
      var cf = !f ? theme.customFont : null; // curated pick wins if both somehow set
      var pO = theme.primary ? hexToOklch(theme.primary) : null;
      var sO = theme.secondary ? hexToOklch(theme.secondary) : null;
      dropTokenEdit();   // one token edit = the current full theme (replace, don't stack)
      edits.push({ kind: "token", tag: "theme", text: "Brand & colors", changes: {
        primaryHex: theme.primary || undefined,
        brandH: pO ? pO.h : undefined,
        brandC: pO ? Number(Math.min(0.22, pO.C).toFixed(3)) : undefined,
        secondaryHex: theme.secondary || undefined,
        accentH: sO ? sO.h : undefined,
        font: f ? f.name : cf ? cf.name : undefined,
        fontId: f ? f.id : undefined,              // stable id (curated only; custom fonts have none)
        fontGoogle: f ? f.g : cf ? cf.g : undefined,           // the family spec the forge imports via next/font
        fontHeadingStack: f ? f.head : cf ? cf.head : undefined,  // fallback CSS stack
        fontSansStack: f ? f.body : cf ? cf.body : undefined,
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
      // Section try-ons may inject scoped <style> tags (outside the element snapshot) — drop them too.
      if (last.styleTags) for (var i = 0; i < last.styleTags.length; i++) { try { last.styleTags[i].remove(); } catch (e) { /* gone */ } }
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
