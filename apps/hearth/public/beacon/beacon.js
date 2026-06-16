/* ============================================================================
   BEACON · beacon.js  —  framework-agnostic behaviors (no deps, no network)
   ----------------------------------------------------------------------------
   Exposes window.Beacon:
     setTheme / setAccent / initTheme
     toast({title,message,variant,duration})
     trapFocus(el) · openModal(el) · closeModal(el)
     commandPalette({commands}) · openPalette() · closePalette()
     sparkline(el, data, opts) · sortableTable(table) · setStat(el, value)
     new AsciiRadar(canvas, opts)
   Auto-inits [data-bcn-radar], [data-bcn-sparkline], [data-bcn-sortable],
   [data-bcn-cmdk] on DOMContentLoaded.
   beacon version 1.0.0
   ========================================================================== */
(function () {
  "use strict";
  var Beacon = (window.Beacon = window.Beacon || {});
  Beacon.version = "1.0.0";

  var reduced = function () {
    return window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  };
  var cssVar = function (name, el) {
    return getComputedStyle(el || document.documentElement).getPropertyValue(name).trim();
  };
  var el = function (tag, cls, attrs) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };
  var svgIcon = function (id) {
    return '<svg class="bcn-icon" aria-hidden="true"><use href="icons.svg#i-' + id + '"></use></svg>';
  };

  /* -------------------------------------------------- Theme & Accent ------ */
  Beacon.THEMES = ["dark", "light", "wall"];
  Beacon.ACCENTS = { amber: "#e8a820", cyan: "#38bdf8", green: "#38d39f", violet: "#8b5cf6" };

  Beacon.setTheme = function (t) {
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("bcn-theme", t); } catch (e) {}
    window.dispatchEvent(new CustomEvent("bcn:theme", { detail: t }));
  };
  Beacon.setAccent = function (hex) {
    document.documentElement.style.setProperty("--accent", hex);
    try { localStorage.setItem("bcn-accent", hex); } catch (e) {}
    window.dispatchEvent(new CustomEvent("bcn:accent", { detail: hex }));
  };
  Beacon.initTheme = function (defaults) {
    defaults = defaults || {};
    var t, a;
    try { t = localStorage.getItem("bcn-theme"); a = localStorage.getItem("bcn-accent"); } catch (e) {}
    Beacon.setTheme(t || defaults.theme || "dark");
    Beacon.setAccent(a || defaults.accent || Beacon.ACCENTS.amber);
  };

  /* -------------------------------------------------- Toasts -------------- */
  var toaster = null;
  function ensureToaster() {
    if (!toaster) {
      toaster = el("div", "bcn-toaster");
      toaster.setAttribute("role", "region");
      toaster.setAttribute("aria-label", "Notifications");
      toaster.setAttribute("aria-live", "polite");
      document.body.appendChild(toaster);
    }
    return toaster;
  }
  var TOAST_SHAPE = { success: "diamond", error: "square", warn: "diamond", info: "" };
  Beacon.toast = function (opts) {
    opts = opts || {};
    var variant = opts.variant || "info";
    var dur = opts.duration == null ? 4000 : opts.duration;
    var stateMap = { success: "done", error: "failed", warn: "medium-sev", info: "info-sev" };
    var t = el("div", "bcn-toast");
    // map variant -> status tokens via inline attribute
    if (variant === "success") t.setAttribute("data-state", "done");
    else if (variant === "error") t.setAttribute("data-state", "failed");
    else if (variant === "warn") t.setAttribute("data-severity", "medium");
    else t.setAttribute("data-severity", "info");
    t.setAttribute("role", "status");
    var lampShape = TOAST_SHAPE[variant] ? ' data-shape="' + TOAST_SHAPE[variant] + '"' : "";
    t.innerHTML =
      '<span class="bcn-lamp"' + lampShape + '></span>' +
      '<div class="bcn-toast-body">' +
        (opts.title ? '<div class="bcn-toast-title">' + esc(opts.title) + "</div>" : "") +
        (opts.message ? '<div class="bcn-toast-msg">' + esc(opts.message) + "</div>" : "") +
      "</div>" +
      '<button class="bcn-toast-x" aria-label="Dismiss">' + svgIcon("x") + "</button>";
    if (dur > 0) {
      var bar = el("span", "bcn-toast-progress");
      bar.style.setProperty("--toast-dur", dur + "ms");
      t.appendChild(bar);
    }
    ensureToaster().appendChild(t);
    var remove = function () {
      t.classList.add("is-leaving");
      setTimeout(function () { t.remove(); }, 200);
    };
    t.querySelector(".bcn-toast-x").addEventListener("click", remove);
    if (dur > 0) setTimeout(remove, dur);
    return remove;
  };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  /* -------------------------------------------------- Focus trap / Modal -- */
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  Beacon.trapFocus = function (container) {
    var prev = document.activeElement;
    function onKey(e) {
      if (e.key !== "Tab") return;
      var f = Array.prototype.filter.call(container.querySelectorAll(FOCUSABLE), function (n) { return n.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    container.addEventListener("keydown", onKey);
    var firstEl = container.querySelector(FOCUSABLE);
    if (firstEl) firstEl.focus();
    return function release() {
      container.removeEventListener("keydown", onKey);
      if (prev && prev.focus) prev.focus();
    };
  };
  Beacon.openModal = function (scrimEl, opts) {
    opts = opts || {};
    scrimEl.hidden = false;
    document.body.style.overflow = "hidden";
    var release = Beacon.trapFocus(scrimEl);
    function onKey(e) { if (e.key === "Escape") close(); }
    function onClick(e) { if (e.target === scrimEl && opts.dismissable !== false) close(); }
    function close() {
      document.removeEventListener("keydown", onKey);
      scrimEl.removeEventListener("mousedown", onClick);
      release();
      scrimEl.hidden = true;
      document.body.style.overflow = "";
      if (opts.onClose) opts.onClose();
    }
    document.addEventListener("keydown", onKey);
    scrimEl.addEventListener("mousedown", onClick);
    scrimEl._bcnClose = close;
    return close;
  };
  Beacon.closeModal = function (scrimEl) { if (scrimEl._bcnClose) scrimEl._bcnClose(); };

  /* -------------------------------------------------- Command Palette ----- */
  var palette = null;
  Beacon.commandPalette = function (config) {
    config = config || {};
    var commands = config.commands || [];
    if (palette) palette.remove();
    var scrim = el("div", "bcn-cmdk-scrim");
    scrim.hidden = true;
    scrim.innerHTML =
      '<div class="bcn-cmdk" role="dialog" aria-label="Command palette">' +
        '<div class="bcn-cmdk-search">' + svgIcon("search") +
          '<input type="text" placeholder="Type a command or search\u2026" aria-label="Command search" autocomplete="off" spellcheck="false">' +
          '<span class="bcn-kbd">ESC</span>' +
        "</div>" +
        '<div class="bcn-cmdk-list" role="listbox"></div>' +
      "</div>";
    document.body.appendChild(scrim);
    palette = scrim;
    var input = scrim.querySelector("input");
    var list = scrim.querySelector(".bcn-cmdk-list");
    var active = 0, filtered = [];

    function render(q) {
      q = (q || "").toLowerCase();
      filtered = commands.filter(function (c) { return !q || (c.label + " " + (c.group || "") + " " + (c.keywords || "")).toLowerCase().indexOf(q) >= 0; });
      list.innerHTML = "";
      var lastGroup = null;
      filtered.forEach(function (c, i) {
        if (c.group && c.group !== lastGroup) {
          var g = el("div", "bcn-cmdk-group bcn-label");
          g.textContent = c.group; list.appendChild(g); lastGroup = c.group;
        }
        var item = el("div", "bcn-cmdk-item" + (i === active ? " is-active" : ""), { role: "option", "data-i": i });
        item.innerHTML = (c.icon ? svgIcon(c.icon) : svgIcon("arrow-right")) +
          "<span>" + esc(c.label) + "</span>" + (c.kbd ? '<span class="bcn-kbd">' + esc(c.kbd) + "</span>" : "");
        item.addEventListener("mouseenter", function () { active = i; paint(); });
        item.addEventListener("click", function () { run(i); });
        list.appendChild(item);
      });
      if (!filtered.length) { var e2 = el("div", "bcn-cmdk-item"); e2.innerHTML = '<span class="bcn-muted">No matches</span>'; list.appendChild(e2); }
    }
    function paint() {
      Array.prototype.forEach.call(list.querySelectorAll(".bcn-cmdk-item"), function (n) {
        n.classList.toggle("is-active", n.getAttribute("data-i") == active);
      });
      var a = list.querySelector(".is-active");
      if (a) { var lr = list.getBoundingClientRect(), ar = a.getBoundingClientRect();
        if (ar.bottom > lr.bottom) list.scrollTop += ar.bottom - lr.bottom;
        if (ar.top < lr.top) list.scrollTop -= lr.top - ar.top; }
    }
    function run(i) { var c = filtered[i]; if (c && c.run) { close(); c.run(); } }
    function close() { Beacon.closeModal(scrim); }

    input.addEventListener("input", function () { active = 0; render(input.value); });
    scrim.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, filtered.length - 1); paint(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); paint(); }
      else if (e.key === "Enter") { e.preventDefault(); run(active); }
    });
    Beacon.openPalette = function () { render(""); active = 0; Beacon.openModal(scrim, { onClose: function () { input.value = ""; } }); setTimeout(function () { input.focus(); }, 30); };
    Beacon.closePalette = close;
    document.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); if (scrim.hidden) Beacon.openPalette(); else close(); }
    });
    render("");
    return Beacon;
  };

  /* -------------------------------------------------- Sparkline ----------- */
  Beacon.sparkline = function (host, data, opts) {
    opts = opts || {};
    if (!data || !data.length) return;
    var w = opts.width || host.clientWidth || 120, h = opts.height || host.clientHeight || 28, pad = 2;
    var min = Math.min.apply(null, data), max = Math.max.apply(null, data), span = max - min || 1;
    var pts = data.map(function (v, i) {
      var x = pad + (i / (data.length - 1)) * (w - pad * 2);
      var y = pad + (1 - (v - min) / span) * (h - pad * 2);
      return [x, y];
    });
    var d = pts.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" ");
    var area = "M" + pts[0][0].toFixed(1) + " " + (h - pad) + " " + d.slice(1) + " L" + pts[pts.length - 1][0].toFixed(1) + " " + (h - pad) + " Z";
    var last = pts[pts.length - 1];
    host.innerHTML =
      '<svg viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none">' +
        (opts.area !== false ? '<path class="bcn-spark-area" d="' + area + '"></path>' : "") +
        '<path class="bcn-spark-line" d="' + d + '"></path>' +
        '<circle class="bcn-spark-dot" cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="1.8"></circle>' +
      "</svg>";
  };

  /* -------------------------------------------------- Sortable table ------ */
  Beacon.sortableTable = function (table) {
    var ths = table.querySelectorAll("thead th[aria-sort]");
    Array.prototype.forEach.call(ths, function (th, col) {
      if (!th.querySelector(".bcn-sort")) th.insertAdjacentHTML("beforeend", '<span class="bcn-sort"></span>');
      th.addEventListener("click", function () {
        var dir = th.getAttribute("aria-sort") === "ascending" ? "descending" : "ascending";
        Array.prototype.forEach.call(ths, function (o) { o.setAttribute("aria-sort", "none"); });
        th.setAttribute("aria-sort", dir);
        var tbody = table.tBodies[0];
        var rows = Array.prototype.slice.call(tbody.rows);
        var idx = Array.prototype.indexOf.call(th.parentNode.children, th);
        var numeric = th.hasAttribute("data-numeric");
        rows.sort(function (a, b) {
          var x = a.cells[idx].textContent.trim(), y = b.cells[idx].textContent.trim();
          if (numeric) { x = parseFloat(x.replace(/[^0-9.\-]/g, "")) || 0; y = parseFloat(y.replace(/[^0-9.\-]/g, "")) || 0; return dir === "ascending" ? x - y : y - x; }
          return dir === "ascending" ? x.localeCompare(y) : y.localeCompare(x);
        });
        rows.forEach(function (r) { tbody.appendChild(r); });
      });
    });
  };

  /* -------------------------------------------------- Stat bump ----------- */
  Beacon.setStat = function (node, value) {
    node.textContent = value;
    node.classList.remove("is-bump"); void node.offsetWidth; node.classList.add("is-bump");
  };

  /* ============================================================ ASCII RADAR */
  Beacon.AsciiRadar = function (canvas, opts) {
    opts = opts || {};
    var ctx = canvas.getContext("2d");
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var wordmark = opts.wordmark || "BEACON";
    var fontPx = opts.fontPx || 13;
    var cw = fontPx * 0.62, ch = fontPx * 1.04;          // monospace cell metrics
    var cols = 0, rows = 0, cx = 0, cy = 0, maxR = 0, aspect = cw / ch;
    var W = 0, H = 0;
    var blips = [], alerts = [], logLines = ["LINK ESTABLISHED", "SCANNING SECTOR 0\u20137", "RANGE RINGS NOMINAL", "CONTACTS: ACQUIRING"];
    var angle = -Math.PI / 2, t0 = 0, raf = 0, lastDraw = 0, running = false;
    var GLYPH_RING = "\u00b7", GLYPH_DOT = "\u00b7", GLYPH_BEAM = "\u2022";
    var staticCanvas = document.createElement("canvas"), sctx = staticCanvas.getContext("2d");
    var BLIP_COLORS = ["#34d399", "#57b6f2", "#f5c542", "#f5854a"]; // bright on the dark stage in every theme

    function colors() {
      // The radar follows the theme via the terminal tokens (light in light mode,
      // graphite in dark/wall). Foreground/blips/shadow all adapt to the stage.
      var isLight = document.documentElement.getAttribute("data-theme") === "light";
      return {
        grid: cssVar("--terminal-dim") || "rgba(255,255,255,0.1)",
        ring: cssVar("--terminal-dim") || "rgba(255,255,255,0.4)",
        beam: cssVar("--accent"),
        beamSoft: cssVar("--accent-dim"),
        fg: cssVar("--terminal-fg") || "#dbe4ee",
        dim: cssVar("--terminal-dim") || "#5f6b7a",
        shadow: isLight ? "rgba(255,255,255,0.65)" : "rgba(0,0,0,0.5)",
        lamps: [cssVar("--success"), cssVar("--info"), cssVar("--warn"), cssVar("--high")]
      };
    }

    function resize() {
      var r = canvas.getBoundingClientRect();
      W = r.width; H = r.height;
      if (!W || !H) return;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = "500 " + fontPx + "px 'IBM Plex Mono', ui-monospace, 'Menlo', monospace";
      ctx.textBaseline = "middle"; ctx.textAlign = "center";
      cols = Math.floor(W / cw); rows = Math.floor(H / ch);
      cx = cols / 2; cy = rows / 2;
      // wider signal range: reach toward the long edge so the field fills the frame
      maxR = Math.max(cols * aspect, rows) / 2 * 1.06;
      seedBlips();
      seedAlerts();
      buildStatic();
    }
    function frand(x, y) { var n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); }
    function seedBlips() {
      blips = [];
      // tone = index into colors().lamps (resolved live so blips adapt to theme)
      var G = ["\u25c6", "\u25b2", "\u25cf", "\u2726"];
      var spec = [[0.42,-0.6,0],[0.66,1.4,1],[0.26,2.6,2],[0.54,-2.2,3],[0.78,0.3,1],[0.36,3.0,0],[0.6,-1.5,2],[0.5,2.35,3],[0.72,-0.2,0],[0.3,1.0,1]];
      spec.forEach(function (s, i) { blips.push({ r: s[0] * maxR, a: s[1], lit: 0, tone: s[2], glyph: G[i % G.length] }); });
    }
    function seedAlerts() {
      // blinking target-lock contacts — alert indication
      alerts = [
        { r: 0.5 * maxR, a: -1.15, kind: "error", glyph: "\u25c6" },
        { r: 0.74 * maxR, a: 2.1, kind: "warn", glyph: "\u25b2" },
        { r: 0.34 * maxR, a: 0.7, kind: "error", glyph: "\u25c6" }
      ];
    }
    function cellToPx(col, row) { return [(col + 0.5) * cw, (row + 0.5) * ch]; }

    // Static field (grid + rings + crosshair) rendered ONCE per resize to an
    // offscreen canvas, then blitted each frame — dense look, near-zero per-frame cost.
    function buildStatic() {
      var c = colors();
      staticCanvas.width = W * dpr; staticCanvas.height = H * dpr;
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sctx.clearRect(0, 0, W, H);
      var baseFont = "500 " + fontPx + "px 'IBM Plex Mono', ui-monospace, 'Menlo', monospace";
      var smallFont = "400 " + (fontPx - 3) + "px 'IBM Plex Mono', monospace";
      sctx.font = baseFont; sctx.textBaseline = "middle"; sctx.textAlign = "center";

      // abundant dot-matrix grid with a deterministic glyph scatter for texture
      var SCATTER = ["+", ":", "\u2218", "\u00b0", "\u02d9", "\u00b7", "\u2022", "x", "\u00b7", "\u00b7"];
      var row, col, p, h;
      for (row = 0; row < rows; row++) for (col = 0; col < cols; col++) {
        h = frand(col, row); p = cellToPx(col, row);
        if (h > 0.9) { sctx.globalAlpha = 0.4; sctx.fillStyle = c.ring; sctx.fillText(SCATTER[Math.floor(frand(col + 7, row * 3) * SCATTER.length)], p[0], p[1]); }
        else { sctx.globalAlpha = 0.22; sctx.fillStyle = c.dim; sctx.fillText("\u00b7", p[0], p[1]); }
      }

      // faint radial spokes every 45deg
      sctx.fillStyle = c.ring; sctx.globalAlpha = 0.16;
      for (var sp = 0; sp < 8; sp++) {
        var sa = sp * Math.PI / 4;
        for (var Rs = 2; Rs < maxR; Rs += 1.5) {
          var sc = Math.round(cx + Math.cos(sa) * Rs / aspect), sr = Math.round(cy + Math.sin(sa) * Rs);
          if (sc < 0 || sc >= cols || sr < 0 || sr >= rows) continue;
          var spp = cellToPx(sc, sr); sctx.fillText("\u00b7", spp[0], spp[1]);
        }
      }

      // concentric range rings + range labels on the +x axis
      var ringR = [0.16, 0.34, 0.52, 0.72, 0.94];
      for (var rr = 0; rr < ringR.length; rr++) {
        var R = ringR[rr] * maxR;
        sctx.fillStyle = c.ring; sctx.globalAlpha = rr === ringR.length - 1 ? 0.7 : 0.5;
        var steps = Math.max(48, Math.floor(R * 10));
        for (var s = 0; s < steps; s++) {
          var a2 = (s / steps) * Math.PI * 2;
          var rc = Math.round(cx + Math.cos(a2) * R / aspect), rw = Math.round(cy + Math.sin(a2) * R);
          if (rc < 0 || rc >= cols || rw < 0 || rw >= rows) continue;
          var rp = cellToPx(rc, rw); sctx.fillText("\u00b7", rp[0], rp[1]);
        }
        var lc = Math.round(cx + R / aspect), lr = Math.round(cy) - 1;
        if (lc >= 0 && lc < cols && lr >= 0) {
          var lp = cellToPx(lc, lr);
          sctx.save(); sctx.globalAlpha = 0.5; sctx.fillStyle = c.dim; sctx.font = smallFont;
          sctx.fillText(((rr + 1) * 16) + "", lp[0], lp[1]); sctx.restore();
        }
      }

      // crosshair axes
      sctx.fillStyle = c.ring; sctx.globalAlpha = 0.34;
      for (var k = -Math.round(maxR); k <= Math.round(maxR); k++) {
        var pH = cellToPx(Math.round(cx + k / aspect), Math.round(cy)); sctx.fillText("\u00b7", pH[0], pH[1]);
        var pV = cellToPx(Math.round(cx), Math.round(cy + k)); sctx.fillText("\u00b7", pV[0], pV[1]);
      }

      // bearing markers (000/045/.../315) just inside the outer ring
      sctx.save(); sctx.font = smallFont; sctx.globalAlpha = 0.45; sctx.fillStyle = c.dim;
      var BR = ringR[ringR.length - 1] * maxR * 0.86;
      for (var bd = 0; bd < 8; bd++) {
        var deg = bd * 45, ar = (deg - 90) * Math.PI / 180;
        var bc = Math.round(cx + Math.cos(ar) * BR / aspect), bw = Math.round(cy + Math.sin(ar) * BR);
        if (bc < 0 || bc >= cols || bw < 0 || bw >= rows) continue;
        var bp = cellToPx(bc, bw);
        sctx.fillText(("00" + deg).slice(-3), bp[0], bp[1]);
      }
      sctx.restore();
      sctx.globalAlpha = 1;
    }

    function drawBeam(a) {
      var c = colors();
      // brighter, wider sweep with a longer gradient trail
      var trail = 1.15, segs = 20;
      for (var i = 0; i < segs; i++) {
        var ta = a - (i / segs) * trail;
        var alpha = Math.pow(1 - i / segs, 1.4) * 0.95;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = i < 3 ? c.beam : c.beamSoft;
        for (var R = 1; R <= maxR; R += 1) {
          var col = Math.round(cx + (Math.cos(ta) * R) / aspect);
          var row = Math.round(cy + Math.sin(ta) * R);
          if (col < 0 || col >= cols || row < 0 || row >= rows) continue;
          var p = cellToPx(col, row);
          ctx.fillText(i < 2 ? GLYPH_BEAM : GLYPH_DOT, p[0], p[1]);
        }
      }
      ctx.globalAlpha = 1;
    }

    function drawBlips(a) {
      var c = colors();
      blips.forEach(function (b) {
        // lit when beam recently swept its bearing
        var diff = Math.atan2(Math.sin(a - b.a), Math.cos(a - b.a));
        if (diff >= 0 && diff < 0.18) b.lit = 1;
        b.lit *= 0.94;
        if (b.lit < 0.04) return;
        var col = Math.round(cx + (Math.cos(b.a) * b.r) / aspect);
        var row = Math.round(cy + Math.sin(b.a) * b.r);
        if (col < 0 || col >= cols || row < 0 || row >= rows) return;
        var p = cellToPx(col, row);
        ctx.globalAlpha = Math.min(1, b.lit);
        ctx.fillStyle = c.lamps[b.tone] || c.beam;
        ctx.shadowColor = c.lamps[b.tone] || c.beam; ctx.shadowBlur = 9;
        ctx.fillText(b.glyph || "\u25c6", p[0], p[1]);
        ctx.shadowBlur = 0;
      });
      ctx.globalAlpha = 1;
    }

    function drawAlerts(elapsed) {
      // target-lock brackets that BLINK around critical/warn contacts
      var on = Math.floor(elapsed / 430) % 2 === 0;
      alerts.forEach(function (al) {
        var color = al.kind === "error" ? (cssVar("--error") || "#f1564a") : (cssVar("--warn") || "#f5c542");
        var col = Math.round(cx + Math.cos(al.a) * al.r / aspect), row = Math.round(cy + Math.sin(al.a) * al.r);
        if (col < 0 || col >= cols || row < 0 || row >= rows) return;
        var p = cellToPx(col, row);
        ctx.fillStyle = color;
        ctx.globalAlpha = on ? 0.95 : 0.28;
        ctx.fillText("\u231c", p[0] - cw * 1.2, p[1] - ch * 0.55);
        ctx.fillText("\u231d", p[0] + cw * 1.2, p[1] - ch * 0.55);
        ctx.fillText("\u231e", p[0] - cw * 1.2, p[1] + ch * 0.55);
        ctx.fillText("\u231f", p[0] + cw * 1.2, p[1] + ch * 0.55);
        ctx.globalAlpha = 1; ctx.shadowColor = color; ctx.shadowBlur = on ? 14 : 6;
        ctx.fillText(al.glyph, p[0], p[1]); ctx.shadowBlur = 0;
      });
      ctx.globalAlpha = 1;
    }

    function drawLog(elapsed) {
      var c = colors();
      ctx.save(); ctx.textAlign = "left"; ctx.font = "400 " + (fontPx - 2) + 'px monospace';
      ctx.fillStyle = c.dim; ctx.globalAlpha = 0.7;
      logLines.forEach(function (ln, i) {
        var startAt = 500 + i * 280;
        if (elapsed < startAt) return;
        var chars = Math.min(ln.length, Math.floor((elapsed - startAt) / 22));
        ctx.fillText("\u203a " + ln.slice(0, chars), 14, 22 + i * (fontPx + 4));
      });
      ctx.restore(); ctx.globalAlpha = 1; ctx.textAlign = "center";
    }

    function drawWordmark(elapsed) {
      if (!wordmark) return;   /* wordmark text removed when empty */
      var reveal = Math.max(0, Math.min(1, (elapsed - 1200) / 700));
      if (reveal <= 0) return;
      var c = colors();
      var n = Math.ceil(wordmark.length * reveal);
      var text = wordmark.slice(0, n);
      ctx.save();
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      var size = Math.max(22, Math.min(W, H) * 0.12);
      ctx.font = "700 " + size + "px 'Chakra Petch', 'Bahnschrift', 'DIN Alternate', sans-serif";
      // engraved shadow
      ctx.globalAlpha = reveal;
      ctx.fillStyle = c.shadow; ctx.fillText(spaced(text), W / 2 + 1, H / 2 + 2);
      ctx.fillStyle = c.fg; ctx.fillText(spaced(text), W / 2, H / 2);
      // accent underline tick
      ctx.globalAlpha = reveal;
      ctx.fillStyle = c.beam;
      var uw = size * 0.5;
      ctx.fillRect(W / 2 - uw / 2, H / 2 + size * 0.5, uw * reveal, 2);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    function spaced(s) { return s.split("").join("\u2009"); }

    function frame(ts) {
      if (!running) return;
      if (!t0) t0 = ts;
      var elapsed = ts - t0;
      // throttle ~26fps for low idle CPU
      if (ts - lastDraw < 38) { raf = requestAnimationFrame(frame); return; }
      var dt = lastDraw ? (ts - lastDraw) / 1000 : 0.04; lastDraw = ts;
      var bootSweep = elapsed < 1600;
      angle += dt * (bootSweep ? 4.0 : 0.85);
      var ringAlpha = Math.min(1, elapsed / 400);

      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = ringAlpha; ctx.drawImage(staticCanvas, 0, 0, W, H); ctx.globalAlpha = 1;
      if (elapsed > 380) drawBeam(angle);
      drawBlips(angle);
      drawAlerts(elapsed);
      if (elapsed < 2400) drawLog(elapsed);
      raf = requestAnimationFrame(frame);
    }

    function staticFrame() {
      // reduced-motion: one locked sweep frame (no animation, alerts shown lit)
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(staticCanvas, 0, 0, W, H);
      angle = -Math.PI / 4; drawBeam(angle);
      blips.forEach(function (b) { b.lit = 0.8; }); drawBlips(angle + 0.1);
      drawAlerts(0);
    }

    var onVis = function () { if (document.hidden) stop(); else if (!reduced()) start(); };

    function start() { if (running || reduced()) return; running = true; lastDraw = 0; raf = requestAnimationFrame(frame); }
    function stop() { running = false; if (raf) cancelAnimationFrame(raf); }

    this.boot = function () {
      resize();
      if (reduced()) { staticFrame(); return this; }
      t0 = 0; angle = -Math.PI / 2; start();
      return this;
    };
    this.destroy = function () { stop(); window.removeEventListener("resize", resize); document.removeEventListener("visibilitychange", onVis); };
    window.addEventListener("resize", function () { resize(); if (reduced()) staticFrame(); });
    document.addEventListener("visibilitychange", onVis);
    function refresh() { if (W && H) { buildStatic(); if (reduced()) staticFrame(); } }
    window.addEventListener("bcn:accent", refresh);
    window.addEventListener("bcn:theme", refresh);
  };

  /* -------------------------------------------------- Tabs --------------- */
  Beacon.initTabs = function (root) {
    var tabs = root.querySelectorAll(".bcn-tab");
    tabs.forEach(function (t) {
      t.addEventListener("click", function () {
        var id = t.getAttribute("data-tab");
        tabs.forEach(function (o) { var on = o === t; o.classList.toggle("is-active", on); o.setAttribute("aria-selected", on ? "true" : "false"); });
        root.querySelectorAll(".bcn-tabpanel").forEach(function (p) { p.hidden = p.getAttribute("data-tab") !== id; });
      });
    });
  };

  /* -------------------------------------------------- Menu / Dropdown ----- */
  Beacon.initMenu = function (wrap) {
    var trigger = wrap.querySelector("[data-menu-trigger]");
    var menu = wrap.querySelector(".bcn-menu");
    if (!trigger || !menu) return;
    function outside(e) { if (!wrap.contains(e.target)) close(); }
    function onKey(e) { if (e.key === "Escape") { close(); trigger.focus(); } }
    function open() { menu.hidden = false; trigger.setAttribute("aria-expanded", "true"); document.addEventListener("mousedown", outside); document.addEventListener("keydown", onKey); }
    function close() { menu.hidden = true; trigger.setAttribute("aria-expanded", "false"); document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", onKey); }
    trigger.addEventListener("click", function (e) { e.stopPropagation(); if (menu.hidden) open(); else close(); });
    menu.querySelectorAll(".bcn-menu-item").forEach(function (it) { it.addEventListener("click", close); });
  };

  /* -------------------------------------------------- NumberStepper ------- */
  Beacon.initStepper = function (wrap) {
    var input = wrap.querySelector("input");
    var dn = wrap.querySelector("[data-step-dn]"), up = wrap.querySelector("[data-step-up]");
    var step = parseFloat(wrap.getAttribute("data-step")) || 1;
    var min = wrap.hasAttribute("data-min") ? parseFloat(wrap.getAttribute("data-min")) : -Infinity;
    var max = wrap.hasAttribute("data-max") ? parseFloat(wrap.getAttribute("data-max")) : Infinity;
    function bump(d) { var v = (parseFloat(input.value) || 0) + d * step; v = Math.max(min, Math.min(max, v)); input.value = v; input.dispatchEvent(new Event("change", { bubbles: true })); }
    if (dn) dn.addEventListener("click", function () { bump(-1); });
    if (up) up.addEventListener("click", function () { bump(1); });
  };

  /* -------------------------------------------------- Topology ------------ */
  function statusAttr(s) {
    if (["critical", "high", "medium", "low", "info"].indexOf(s) >= 0) return 'data-severity="' + s + '"';
    if (["queued", "running", "done", "failed", "cancelled"].indexOf(s) >= 0) return 'data-state="' + s + '"';
    if (["connecting", "connected", "reconnecting", "offline"].indexOf(s) >= 0) return 'data-live="' + s + '"';
    return "";
  }
  Beacon.topology = function (el, cfg) {
    cfg = cfg || {};
    var W = cfg.width || 320, H = cfg.height || 200;
    var nodes = cfg.nodes || [], edges = cfg.edges || [];
    var byId = {}; nodes.forEach(function (n) { byId[n.id] = n; });
    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Service topology">';
    edges.forEach(function (e) {
      var a = byId[e.from], b = byId[e.to]; if (!a || !b) return;
      var cls = "bcn-topo-edge" + (e.down ? " is-down" : "") + (e.live ? " is-live" : "");
      svg += '<line class="' + cls + '" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '"></line>';
    });
    nodes.forEach(function (n) {
      var r = n.core ? 9 : 7;
      svg += "<g " + (n.status ? statusAttr(n.status) : "") + ">";
      svg += '<circle class="bcn-topo-halo' + (n.pulse ? " is-pulse" : "") + '" cx="' + n.x + '" cy="' + n.y + '" r="' + (r + 7) + '"></circle>';
      svg += '<circle class="bcn-topo-node" cx="' + n.x + '" cy="' + n.y + '" r="' + r + '"></circle>';
      svg += '<circle class="bcn-topo-core" cx="' + n.x + '" cy="' + n.y + '" r="' + (r - 4) + '"></circle>';
      if (n.label) svg += '<text class="bcn-topo-label" x="' + n.x + '" y="' + (n.y + r + 12) + '" text-anchor="middle">' + esc(n.label) + "</text>";
      svg += "</g>";
    });
    svg += "</svg>";
    el.innerHTML = svg;
  };

  /* -------------------------------------------------- Auto-init ----------- */
  function autoInit() {
    document.querySelectorAll("[data-bcn-radar]").forEach(function (cv) {
      var wm = cv.hasAttribute("data-wordmark") ? cv.getAttribute("data-wordmark") : "BEACON";
      var r = new Beacon.AsciiRadar(cv, { wordmark: wm });
      cv._radar = r; r.boot();
    });
    document.querySelectorAll("[data-bcn-sparkline]").forEach(function (n) {
      var data = (n.getAttribute("data-bcn-sparkline") || "").split(",").map(Number).filter(function (x) { return !isNaN(x); });
      if (data.length) Beacon.sparkline(n, data, { area: n.getAttribute("data-area") !== "false" });
    });
    document.querySelectorAll("table[data-bcn-sortable]").forEach(function (t) { Beacon.sortableTable(t); });
    document.querySelectorAll("[data-bcn-tabs]").forEach(function (t) { Beacon.initTabs(t); });
    document.querySelectorAll("[data-bcn-menu]").forEach(function (m) { Beacon.initMenu(m); });
    document.querySelectorAll("[data-bcn-stepper]").forEach(function (s) { Beacon.initStepper(s); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", autoInit);
  else autoInit();
})();
