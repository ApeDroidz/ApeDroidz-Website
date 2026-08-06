import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { droidStaticUrl, droidAnimatedUrl, honoraryStaticUrl, honoraryAnimatedUrl } from '@/lib/media'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const VIEWS = ['pixel', 'animated', 'pfp3d', 'fullbody', 'model3d'] as const
type ViewKey = typeof VIEWS[number]

// 3D assets are not uploaded yet — keep the switches visible but locked.
const LOCKED_VIEWS: ViewKey[] = ['pfp3d', 'fullbody', 'model3d']

// Honorary is a separate ERC-1155 collection: no levels, no 3D renders, and the
// animated version exists only for the tokens that have a gif.
const HONORARY_X_HANDLE = '@SPLITF0RM'

const headers = {
  'Content-Type': 'text/html; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  // Marketplaces cache animation_url pages aggressively; keep it fresh so a
  // saved default shows up right after a metadata refresh.
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params
  const tokenId = parseInt(params.id.trim())
  if (isNaN(tokenId) || tokenId < 0) {
    return NextResponse.json({ error: 'Invalid token id' }, { status: 400 })
  }

  const isHonorary = request.nextUrl.searchParams.get('collection') === 'honorary'
  const origin = new URL(request.url).origin
  const isEmbed = request.nextUrl.searchParams.get('embed') === '1'
  const requestedView = request.nextUrl.searchParams.get('view')

  let level = 1
  let isSuper = false
  let hasGif = false
  let displayPref: string | null = null

  try {
    if (isHonorary) {
      const { data: row } = await supabaseAdmin!
        .from('honorary_droidz')
        .select('has_gif, display_pref')
        .eq('token_id', tokenId)
        .maybeSingle()
      if (row) {
        hasGif = !!row.has_gif
        displayPref = ['pixel', 'animated'].includes(row.display_pref) ? row.display_pref : null
      }
    } else {
      // Tolerate a missing display_pref column — select * and read defensively.
      const { data: droid } = await supabaseAdmin!
        .from('droidz')
        .select('*')
        .eq('token_id', tokenId)
        .maybeSingle()
      if (droid) {
        level = droid.level || 1
        isSuper = !!droid.is_super
        displayPref = VIEWS.includes(droid.display_pref) ? droid.display_pref : null
      }
    }
  } catch (e) {
    console.error('[viewer] lookup failed:', e)
  }

  // Which switches to show, and which of them are dead ends for this token.
  const viewDefs = isHonorary
    ? [
      { key: 'pixel', label: 'Pixel', locked: false },
      { key: 'animated', label: 'Animated', locked: false },
    ]
    : [
      { key: 'pixel', label: 'Pixel', locked: false },
      { key: 'animated', label: 'Animated', locked: false },
      { key: 'pfp3d', label: 'PFP', locked: true },
      { key: 'fullbody', label: 'Full Body', locked: true },
      { key: 'model3d', label: '3D', locked: true },
    ]

  // Honorary tokens without a gif still get an Animated switch — it shows the
  // static art as a locked teaser behind the "write SPLITFORM" CTA.
  const pixelUrl = isHonorary ? honoraryStaticUrl(tokenId) : droidStaticUrl(tokenId, level, isSuper)
  const animatedUrl = isHonorary
    ? (hasGif ? honoraryAnimatedUrl(tokenId) : honoraryStaticUrl(tokenId))
    : droidAnimatedUrl(tokenId, isSuper)

  // Animated is a locked teaser when the token cannot actually have it.
  const animatedLocked = isHonorary ? !hasGif : level < 2

  const fallbackView: ViewKey = (isHonorary ? hasGif : level >= 2) ? 'animated' : 'pixel'
  const openViews = viewDefs.filter(v => !v.locked).map(v => v.key)
  const savedView: ViewKey = (displayPref && openViews.includes(displayPref)) ? displayPref as ViewKey : fallbackView
  const initialView: ViewKey = (requestedView && openViews.includes(requestedView))
    ? requestedView as ViewKey
    : savedView

  const badgeLeft = isHonorary
    ? 'HONORARY'
    : (level >= 2 ? (isSuper ? 'LVL 2 SUPER' : 'LVL 2') : 'LVL 1')

  // Wording only — the plaque is not clickable. Marketplace iframes are
  // sandboxed, so any button here would be dead on arrival; the site renders a
  // real button under the previewer instead.
  const cta = isHonorary
    ? { label: `Contact ${HONORARY_X_HANDLE} on X to unlock` }
    : { label: 'Upgrade to unlock' }

  const config = {
    tokenId,
    collection: isHonorary ? 'honorary' : 'droidz',
    badgeLeft,
    accent: isHonorary ? '#a78bfa' : (isSuper ? '#fb923c' : '#60a5fa'),
    views: viewDefs,
    initialView,
    animatedLocked,
    assets: { pixel: pixelUrl, animated: animatedUrl },
    embed: isEmbed,
    cta,
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<title>${isHonorary ? `Honorary DRD#${tokenId}` : `ApeDroid #${tokenId}`} — Interactive Viewer</title>
<meta name="description" content="Interactive viewer for ApeDroidz. Switch between Pixel, Animated and 3D views of your droid.">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { width: 100%; height: 100%; }
  body {
    overflow: hidden;
    background: #000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #fff;
    user-select: none;
  }
  #stage {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* subtle grid backdrop, matches site identity */
  #stage::before {
    content: "";
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px);
    background-size: 44px 44px;
    pointer-events: none;
  }

  /* View switch — top-center, minimal */
  #switch {
    position: absolute;
    top: 14px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 4px;
    padding: 4px;
    background: rgba(0,0,0,0.55);
    border: 1px solid rgba(255,255,255,0.14);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border-radius: 12px;
    z-index: 40;
  }
  .sw-btn {
    appearance: none;
    border: none;
    background: transparent;
    color: rgba(255,255,255,0.55);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 7px 12px;
    border-radius: 8px;
    cursor: pointer;
    transition: all .2s;
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .sw-btn:hover { color: #fff; background: rgba(255,255,255,0.08); }
  .sw-btn.active { background: #fff; color: #000; }
  .sw-btn.locked { opacity: 0.4; cursor: not-allowed; }
  .sw-btn.locked:hover { color: rgba(255,255,255,0.55); background: transparent; }
  .sw-btn svg { width: 10px; height: 10px; flex: 0 0 auto; }

  /* Badges */
  .badge {
    position: absolute;
    z-index: 40;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.08em;
    padding: 7px 12px;
    background: rgba(0,0,0,0.55);
    border: 1px solid rgba(255,255,255,0.14);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border-radius: 10px;
  }
  #token-badge { bottom: 14px; right: 14px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  #level-badge {
    bottom: 14px;
    left: 14px;
    text-transform: uppercase;
    color: ${config.accent};
    border-color: ${config.accent}59;
  }

  /* Art */
  #art-wrap {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  #art {
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    object-fit: contain;
    image-rendering: pixelated;
    opacity: 0;
    transition: opacity .3s ease;
    -webkit-user-drag: none;
  }
  #art.visible { opacity: 1; }
  /* Locked teaser: black & white and blurred. The animation still reads as
     motion, the artwork detail does not. */
  #art-wrap.locked #art { filter: grayscale(1) blur(12px) brightness(0.72); }

  /* Lock overlay — sits over the blurred animated teaser (level < 2) */
  #lock-overlay {
    position: absolute;
    inset: 0;
    display: none;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 45;
    pointer-events: none; /* only the CTA is clickable */
  }
  /* Static plaque. Marketplaces sandbox this page, so any link or window.open
     is silently swallowed — a button here would just look broken. The site
     renders its own actionable button below the previewer instead. */
  #lock-plaque {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    background: rgba(0,0,0,0.62);
    border: 1px solid rgba(255,255,255,0.16);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    color: rgba(255,255,255,0.95);
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 13px 20px;
    border-radius: 12px;
    box-shadow: 0 10px 34px rgba(0,0,0,0.5);
    text-align: center;
  }
  #lock-plaque svg { width: 15px; height: 15px; flex: 0 0 auto; opacity: .9; }

  /* Loader — droid logo fills white left-to-right showing REAL load progress */
  #loader {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0,0,0,0.75);
    z-index: 60;
    transition: opacity .35s ease;
  }
  #loader.done { opacity: 0; pointer-events: none; }
  /* Loader: the mark fills white left-to-right with real download progress,
     while glitch slices tear across it. Monochrome on purpose — horizontal
     cuts, displacement and flicker, no chromatic fringing. */
  #loader-logo { position: relative; width: 130px; height: 97px; }
  #loader-logo svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  #logo-dim path { fill: rgba(255,255,255,0.16); }

  /* JS drives this from 100% (empty) to 0% (full) as bytes arrive */
  #logo-fill-wrap {
    position: absolute; inset: 0;
    clip-path: inset(0 100% 0 0); -webkit-clip-path: inset(0 100% 0 0);
    transition: clip-path .15s linear, -webkit-clip-path .15s linear;
  }
  #logo-fill-wrap svg path { fill: #fff; }

  /* Slices: each band lives in its own layer and jumps sideways on its own
     rhythm, so the tears never line up into a regular pattern. */
  .glitch-slice { position: absolute; inset: 0; }
  .glitch-slice.s1 {
    clip-path: inset(14% 0 68% 0); -webkit-clip-path: inset(14% 0 68% 0);
    animation: sliceA 2.1s steps(1, end) infinite;
  }
  .glitch-slice.s2 {
    clip-path: inset(46% 0 34% 0); -webkit-clip-path: inset(46% 0 34% 0);
    animation: sliceB 1.7s steps(1, end) infinite;
  }
  .glitch-slice.s3 {
    clip-path: inset(74% 0 8% 0); -webkit-clip-path: inset(74% 0 8% 0);
    animation: sliceC 2.6s steps(1, end) infinite;
  }
  @keyframes sliceA {
    0%,72%   { transform: translateX(0);     opacity: 1; }
    74%      { transform: translateX(-7px);  opacity: .55; }
    77%      { transform: translateX(5px);   opacity: 1; }
    79%,100% { transform: translateX(0);     opacity: 1; }
  }
  @keyframes sliceB {
    0%,40%   { transform: translateX(0);     opacity: 1; }
    43%      { transform: translateX(9px);   opacity: .4; }
    46%      { transform: translateX(-4px);  opacity: 1; }
    49%,100% { transform: translateX(0);     opacity: 1; }
  }
  @keyframes sliceC {
    0%,86%   { transform: translateX(0);     opacity: 1; }
    88%      { transform: translateX(-11px); opacity: .6; }
    91%      { transform: translateX(3px);   opacity: .85; }
    93%,100% { transform: translateX(0);     opacity: 1; }
  }

  /* Chunky vertical banding — reads as pixelation without touching the art */
  #loader-logo::after {
    content: "";
    position: absolute; inset: -4% -8%;
    background: repeating-linear-gradient(
      to bottom,
      rgba(0,0,0,0) 0 3px,
      rgba(0,0,0,0.55) 3px 4px
    );
    mix-blend-mode: multiply;
    pointer-events: none;
    animation: scan 3.4s steps(1, end) infinite;
  }
  @keyframes scan {
    0%,58%   { opacity: .35; transform: translateY(0); }
    60%      { opacity: .8;  transform: translateY(-2px); }
    63%,100% { opacity: .35; transform: translateY(0); }
  }

  #error-box {
    position: absolute;
    inset: 0;
    display: none;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 12px;
    z-index: 70;
    background: rgba(0,0,0,0.85);
    text-align: center;
  }
  #error-box p { font-size: 13px; color: rgba(255,255,255,0.7); }
  #error-box button {
    appearance: none;
    border: 1px solid rgba(255,255,255,0.25);
    background: #fff;
    color: #000;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 11px;
    padding: 9px 18px;
    border-radius: 10px;
    cursor: pointer;
  }

  @media (max-width: 480px) {
    #switch { top: 10px; bottom: auto; left: 50%; padding: 3px; }
    .sw-btn { font-size: 9px; padding: 6px 8px; }
    .badge { font-size: 10px; padding: 5px 9px; }
    #token-badge { bottom: 10px; right: 10px; }
    #level-badge { bottom: 10px; left: 10px; }
  }
</style>
</head>
<body>
<div id="stage">
  <div id="switch"></div>
  <div id="level-badge" class="badge">${badgeLeft}</div>
  <div id="token-badge" class="badge">#${tokenId}</div>

  <div id="art-wrap">
    <img id="art" alt="${isHonorary ? `Honorary DRD#${tokenId}` : `ApeDroid #${tokenId}`}" draggable="false" />
  </div>

  <div id="lock-overlay">
    <div id="lock-plaque">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      <span id="cta-label">Upgrade to unlock</span>
    </div>
  </div>

  <div id="loader">
    <div id="loader-logo">
      <svg id="logo-dim" viewBox="0 0 131 97" xmlns="http://www.w3.org/2000/svg"><path d="${LOGO_PATH}"/></svg>
      <div id="logo-fill-wrap">
        <svg viewBox="0 0 131 97" xmlns="http://www.w3.org/2000/svg"><path d="${LOGO_PATH}"/></svg>
        <div class="glitch-slice s1"><svg viewBox="0 0 131 97" xmlns="http://www.w3.org/2000/svg"><path d="${LOGO_PATH}"/></svg></div>
        <div class="glitch-slice s2"><svg viewBox="0 0 131 97" xmlns="http://www.w3.org/2000/svg"><path d="${LOGO_PATH}"/></svg></div>
        <div class="glitch-slice s3"><svg viewBox="0 0 131 97" xmlns="http://www.w3.org/2000/svg"><path d="${LOGO_PATH}"/></svg></div>
      </div>
    </div>
  </div>

  <div id="error-box">
    <p>Failed to load asset.</p>
    <button onclick="retry()">Retry</button>
  </div>
</div>

<script>
  var CFG = ${JSON.stringify(config)};

  var LOCK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
  var currentView = CFG.initialView;

  function isOpenView(key) {
    for (var i = 0; i < CFG.views.length; i++) {
      if (CFG.views[i].key === key) return !CFG.views[i].locked;
    }
    return false;
  }

  function buildSwitch() {
    var wrap = document.getElementById('switch');
    CFG.views.forEach(function (v) {
      var btn = document.createElement('button');
      btn.className = 'sw-btn' + (v.locked ? ' locked' : '') + (v.key === currentView ? ' active' : '');
      btn.dataset.view = v.key;
      btn.innerHTML = (v.locked ? LOCK_SVG : '') + '<span>' + v.label + '</span>';
      btn.title = v.locked ? 'Coming soon' : v.label;
      btn.addEventListener('click', function () { if (!v.locked) switchView(v.key); });
      wrap.appendChild(btn);
    });
  }

  function setActiveButton(view) {
    var btns = document.querySelectorAll('.sw-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].dataset.view === view);
    }
  }

  var loadSeq = 0;

  function showLoader(show) {
    document.getElementById('loader').classList.toggle('done', !show);
  }

  // Drive the logo fill from real bytes: 0 => transparent (nothing), 1 => full.
  function setProgress(p) {
    var pct = Math.max(0, Math.min(1, p || 0));
    var inset = 'inset(0 ' + ((1 - pct) * 100) + '% 0 0)';
    var fill = document.getElementById('logo-fill-wrap');
    fill.style.clipPath = inset;
    fill.style.webkitClipPath = inset;
  }

  // "Upgrade to unlock" CTA. Embedded on our own dashboard we let the parent
  // route (no reload); from a marketplace iframe we open the site in a new tab,
  // landing on the upgrade module with this droid already selected.

  // Blur + lock overlay when the selected view is not available for this token.
  function applyLock(view) {
    var levelLocked = (view === 'animated' && CFG.animatedLocked);
    document.getElementById('art-wrap').classList.toggle('locked', levelLocked);
    document.getElementById('lock-overlay').style.display = levelLocked ? 'flex' : 'none';
  }

  function showError(show) {
    document.getElementById('error-box').style.display = show ? 'flex' : 'none';
    if (show) showLoader(false);
  }

  function retry() {
    showError(false);
    switchView(currentView, true);
  }

  function notifyParent(view) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'apedroidz:viewChanged', tokenId: CFG.tokenId, view: view }, '*');
      }
    } catch (e) { /* cross-origin parent — ignore */ }
  }

  function switchView(view, force) {
    if (!force && view === currentView && document.getElementById('art').src) {
      // still notify so an embedding page can sync its Save button on load
      notifyParent(view);
      return;
    }
    currentView = view;
    setActiveButton(view);
    applyLock(view);
    showError(false);
    loadArt(view);
    notifyParent(view);
  }

  // Stream the asset so the logo fill reflects real download progress. Falls
  // back to a plain <img> load (with webp->png retry) if streaming/CORS fails.
  async function loadArt(view) {
    var art = document.getElementById('art');
    var src = CFG.assets[view];
    if (!src) { showError(true); return; }
    var reqId = ++loadSeq;
    art.classList.remove('visible');
    showLoader(true);
    setProgress(0);

    // Watchdog: a stalled stream must never leave the loader spinning forever —
    // this page runs inside marketplace iframes where nobody can debug it.
    var watchdog = setTimeout(function () {
      if (reqId === loadSeq && !art.classList.contains('visible')) {
        fallbackLoad(view, src, reqId);
      }
    }, 12000);
    var clearWatchdog = function () { clearTimeout(watchdog); };

    try {
      var resp = await fetch(src, { cache: 'default' });
      if (!resp.ok || !resp.body) throw new Error('no-stream');
      var total = parseInt(resp.headers.get('Content-Length') || '0', 10);
      var reader = resp.body.getReader();
      var chunks = [], received = 0;
      while (true) {
        var r = await reader.read();
        if (reqId !== loadSeq) { try { reader.cancel(); } catch (e) {} return; }
        if (r.done) break;
        chunks.push(r.value);
        received += r.value.length;
        if (total > 0) setProgress(received / total);
      }
      setProgress(1);
      if (reqId !== loadSeq) return;
      var url = URL.createObjectURL(new Blob(chunks));
      art.onload = function () {
        if (reqId !== loadSeq) { URL.revokeObjectURL(url); return; }
        clearWatchdog();
        showLoader(false);
        requestAnimationFrame(function () { art.classList.add('visible'); });
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      };
      art.onerror = function () { clearWatchdog(); fallbackLoad(view, src, reqId); };
      art.src = url;
    } catch (e) {
      clearWatchdog();
      fallbackLoad(view, src, reqId);
    }
  }

  function fallbackLoad(view, src, reqId) {
    if (reqId !== loadSeq) return;
    var art = document.getElementById('art');
    setProgress(1);
    var probe = new Image();
    probe.onload = function () {
      if (reqId !== loadSeq) return;
      art.src = src;
      showLoader(false);
      requestAnimationFrame(function () { art.classList.add('visible'); });
    };
    probe.onerror = function () {
      if (reqId !== loadSeq) return;
      if (src.indexOf('.webp') !== -1) {
        var png = src.replace('.webp', '.png');
        CFG.assets[view] = png;
        fallbackLoad(view, png, reqId);
        return;
      }
      showError(true);
    };
    probe.src = src;
  }

  // The on-site dashboard can drive the viewer through postMessage.
  window.addEventListener('message', function (e) {
    var d = e && e.data;
    if (d && d.type === 'apedroidz:setView' && CFG.assets[d.view] && isOpenView(d.view)) {
      switchView(d.view);
    }
  });

  document.getElementById('cta-label').textContent = CFG.cta.label;
  buildSwitch();
  switchView(currentView, true);
</script>
</body>
</html>`

  return new NextResponse(html, { headers })
}

// ApeDroidz mark from /public/icon_logo.svg, inlined so the viewer is fully
// self-contained (marketplace iframes must not depend on our site being up).
const LOGO_PATH = "M93.5479 77.3838C101.937 77.5097 108.217 85.1173 106.751 93.377C106.389 95.4116 104.615 96.8945 102.543 96.8945H19.6895C17.2165 96.8941 15.2588 94.8042 15.4258 92.3428L16.4668 76.9961C16.4966 76.5561 16.8871 76.2347 17.3281 76.2412L93.5479 77.3838ZM53.3477 35.8027L99.6416 40.8174C100.15 40.8725 100.649 40.9522 101.139 41.0547L117.016 42.7812C118.229 42.9131 119.084 44.0382 118.89 45.2461L114.961 69.6162L114.942 69.7129C114.735 70.7095 113.85 71.4265 112.825 71.4111L17.5156 69.9805C16.2174 69.9609 15.2379 68.7913 15.4434 67.5059L17.2637 56.1172C17.2815 56.0055 17.291 55.8924 17.291 55.7793V31.707C17.2912 30.4145 18.4227 29.4319 19.6826 29.5898L19.6836 29.583C19.6849 29.5637 19.7026 29.5493 19.7217 29.5527L53.3477 35.8027ZM124.746 49.1631C124.982 47.6919 126.616 46.9102 127.91 47.6494L129.922 48.7988C130.694 49.2402 131.112 50.1151 130.969 50.9932L128.453 66.46C128.313 67.3228 127.66 68.0125 126.806 68.2002L124.562 68.6934C123.094 69.0159 121.762 67.7574 122 66.2725L124.746 49.1631ZM6.47656 32.7285C7.72 32.5865 8.80859 33.5717 8.80859 34.8418V55.1445C8.80859 55.548 8.1551 59.4733 7.51855 63.0635C7.27446 64.4402 5.80585 65.1971 4.5625 64.5938L1.19238 62.958C0.358988 62.5534 -0.115112 61.6427 0.0244141 60.7158L0.919922 54.7676C0.935432 54.6645 0.94288 54.5603 0.943359 54.4561L1.03906 35.2432C1.04392 34.1634 1.84514 33.2586 2.90234 33.1377L6.47656 32.7285ZM25.6553 37.2148C24.7352 37.2451 23.9395 37.8722 23.6836 38.7461V55.7793C23.6836 56.2322 23.6477 56.6846 23.5762 57.1318L22.8359 61.7559C22.9898 62.7513 23.8425 63.5445 24.9121 63.5605L107.386 64.7959C108.411 64.811 109.298 64.0958 109.506 63.1016L109.521 63.0049L111.496 50.7949C111.657 49.7983 111.1 48.8589 110.217 48.4883L52.4775 42.2129L25.6553 37.2148ZM97.7363 53.2451C98.9139 53.2604 99.8559 54.2277 99.8408 55.4053C99.8256 56.583 98.8583 57.525 97.6807 57.5098L79.8701 57.2803C78.6925 57.265 77.7496 56.2977 77.7646 55.1201C77.7799 53.9425 78.7472 52.9995 79.9248 53.0146L97.7363 53.2451ZM33.2344 48.0947L57.4385 51.418C58.6052 51.5783 59.421 52.6546 59.2607 53.8213C59.1005 54.9879 58.025 55.8036 56.8584 55.6436L32.6543 52.3203C31.4877 52.16 30.672 51.0845 30.832 49.918C30.9923 48.7513 32.0677 47.9347 33.2344 48.0947ZM111.306 48.6074C111.457 48.8837 111.601 49.1645 111.735 49.4502L111.862 48.668L111.306 48.6074ZM21.4229 3.97656C21.5934 1.46461 23.8991 -0.354884 26.3887 0.0585938L116.289 14.9893C118.633 15.3791 120.21 17.6038 119.795 19.9385C118.162 29.1234 109.692 35.474 100.416 34.4688L54.2773 29.4688L20.8896 23.2646L20.7656 23.2451C20.4077 23.1839 20.1386 22.872 20.1631 22.5098L21.4229 3.97656Z"
