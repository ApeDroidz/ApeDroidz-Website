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
  let hasPng = true
  let displayPref: string | null = null

  try {
    if (isHonorary) {
      const { data: row } = await supabaseAdmin!
        .from('honorary_droidz')
        .select('has_gif, has_png, display_pref')
        .eq('token_id', tokenId)
        .maybeSingle()
      if (row) {
        hasGif = !!row.has_gif
        hasPng = row.has_png !== false
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
  // Undrawn honorary tokens share the placeholder art (#100).
  const honoraryArtId = hasPng ? tokenId : 100
  const pixelUrl = isHonorary ? honoraryStaticUrl(honoraryArtId) : droidStaticUrl(tokenId, level, isSuper)
  const animatedUrl = isHonorary
    ? (hasGif ? honoraryAnimatedUrl(tokenId) : honoraryStaticUrl(honoraryArtId))
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
    ? { label: 'Contact SPLITFORM to order' }
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
    border-radius: 999px;
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
    padding: 7px 14px;
    border-radius: 999px;
    cursor: pointer;
    transition: all .2s;
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .sw-btn:hover { color: #fff; background: rgba(255,255,255,0.08); }
  .sw-btn.active { background: #fff; color: #000; }
  /* Solid muted colour rather than opacity: the padlock's shackle and body
     strokes overlap, and any transparency turns that overlap into a seam. */
  .sw-btn.locked { opacity: 1; color: #5f5f5f; cursor: not-allowed; }
  .sw-btn.locked:hover { color: #5f5f5f; background: transparent; }
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
    color: #fff;
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 13px 20px;
    border-radius: 12px;
    box-shadow: 0 10px 34px rgba(0,0,0,0.5);
    text-align: center;
  }
  /* Solid, fully opaque: with any alpha the shackle/body stroke overlap
     shows through as a seam. */
  #lock-plaque svg { width: 15px; height: 15px; flex: 0 0 auto; opacity: 1; color: #b8b8b8; }

  /* Loader — droid logo fills white left-to-right showing REAL load progress */
  #loader {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0,0,0,0.93);
    z-index: 60;
    transition: opacity .35s ease;
  }
  #loader.done { opacity: 0; pointer-events: none; }
  /* Loader. The mark glitches continuously on its own clock — it must read as
     glitching even when a cached asset resolves in 200ms — while the white fill
     inside it tracks real download progress left-to-right.
     Built from horizontal bands: each band clips the same mark and tears
     sideways on its own rhythm, so dim and filled parts displace together. */
  #loader-logo { position: relative; width: 130px; height: 97px; }
  .band { position: absolute; inset: 0; }
  .band svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  .band .dim { fill: rgba(255,255,255,0.15); }
  .fillclip {
    position: absolute; inset: 0;
    clip-path: inset(0 100% 0 0); -webkit-clip-path: inset(0 100% 0 0);
    transition: clip-path .12s linear, -webkit-clip-path .12s linear;
  }
  .fillclip svg { fill: #fff; }

  /* Bands tile the mark top-to-bottom with no overlap or gaps. */
  .b1 { clip-path: inset(0 0 88% 0);   -webkit-clip-path: inset(0 0 88% 0); }
  .b2 { clip-path: inset(12% 0 70% 0); -webkit-clip-path: inset(12% 0 70% 0); }
  .b3 { clip-path: inset(30% 0 56% 0); -webkit-clip-path: inset(30% 0 56% 0); }
  .b4 { clip-path: inset(44% 0 36% 0); -webkit-clip-path: inset(44% 0 36% 0); }
  .b5 { clip-path: inset(64% 0 28% 0); -webkit-clip-path: inset(64% 0 28% 0); }
  .b6 { clip-path: inset(72% 0 10% 0); -webkit-clip-path: inset(72% 0 10% 0); }
  .b7 { clip-path: inset(90% 0 0 0);   -webkit-clip-path: inset(90% 0 0 0); }

  /* Short cycles so a tear lands within the first frames, not seconds later. */
  .b2 { animation: tearA .62s steps(1, end) infinite; }
  .b4 { animation: tearB .47s steps(1, end) infinite; }
  .b6 { animation: tearC .83s steps(1, end) infinite; }
  .b3 { animation: tearD 1.1s steps(1, end) infinite; }
  @keyframes tearA {
    0%,58%   { transform: translateX(0); }
    62%      { transform: translateX(-6px); }
    70%      { transform: translateX(4px); }
    76%,100% { transform: translateX(0); }
  }
  @keyframes tearB {
    0%,44%   { transform: translateX(0); opacity: 1; }
    50%      { transform: translateX(8px); opacity: .65; }
    58%      { transform: translateX(-3px); opacity: 1; }
    64%,100% { transform: translateX(0); }
  }
  @keyframes tearC {
    0%,70%   { transform: translateX(0); }
    75%      { transform: translateX(-10px); }
    82%      { transform: translateX(2px); }
    86%,100% { transform: translateX(0); }
  }
  @keyframes tearD {
    0%,80%   { transform: translateX(0); opacity: 1; }
    84%      { transform: translateX(5px); opacity: .5; }
    90%,100% { transform: translateX(0); opacity: 1; }
  }

  /* Barely-there RGB split, as in the reference — colour only on the edges. */
  #loader-logo .ghost {
    position: absolute; inset: 0;
    mix-blend-mode: screen;
    opacity: .45;
    /* starts empty and is revealed with the fill, so the unloaded mark stays
       neutral grey instead of picking up a red/cyan tint */
    clip-path: inset(0 100% 0 0); -webkit-clip-path: inset(0 100% 0 0);
    transition: clip-path .12s linear, -webkit-clip-path .12s linear;
  }
  #loader-logo .ghost svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  #loader-logo .ghost.r svg { fill: #ff2d2d; }
  #loader-logo .ghost.c svg { fill: #24e1ff; }
  #loader-logo .ghost.r { animation: ghostR .53s steps(1, end) infinite; }
  #loader-logo .ghost.c { animation: ghostC .67s steps(1, end) infinite; }
  @keyframes ghostR {
    0%,62%   { transform: translateX(-1px); }
    66%      { transform: translateX(-3px); }
    72%,100% { transform: translateX(-1px); }
  }
  @keyframes ghostC {
    0%,54%   { transform: translateX(1px); }
    60%      { transform: translateX(3px); }
    66%,100% { transform: translateX(1px); }
  }

  /* Film grain over the whole mark. */
  #loader-logo::after {
    content: "";
    position: absolute; inset: -10%;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/></filter><rect width='120' height='120' filter='url(%23n)' opacity='0.55'/></svg>");
    opacity: .3;
    /* multiply keeps the grain invisible on the black backdrop and lets it bite
       only into the lit parts of the mark — no visible rectangle */
    mix-blend-mode: multiply;
    pointer-events: none;
    animation: grain .28s steps(1, end) infinite;
  }
  @keyframes grain {
    0%   { transform: translate(0,0); }
    25%  { transform: translate(-3px,2px); }
    50%  { transform: translate(2px,-3px); }
    75%  { transform: translate(-2px,-1px); }
    100% { transform: translate(0,0); }
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
      <svg width="0" height="0" style="position:absolute" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs><path id="mk" d="${LOGO_PATH}"/></defs>
      </svg>
      <div class="ghost r"><svg viewBox="0 0 131 97" xmlns="http://www.w3.org/2000/svg"><use href="#mk"/></svg></div>
      <div class="ghost c"><svg viewBox="0 0 131 97" xmlns="http://www.w3.org/2000/svg"><use href="#mk"/></svg></div>
      <div class="band b1">
        <svg viewBox="0 0 131 97" xmlns="http://www.w3.org/2000/svg"><use href="#mk" class="dim"/></svg>
        <div class="fillclip"><svg viewBox="0 0 131 97" xmlns="http://www.w3.org/2000/svg"><use href="#mk"/></svg></div>
      </div>
      <div class="band b2">
        <svg viewBox="0 0 131 97" xmlns="http://www.w3.org/2000/svg"><use href="#mk" class="dim"/></svg>
        <div class="fillclip"><svg viewBox="0 0 131 97" xmlns="http://www.w3.org/2000/svg"><use href="#mk"/></svg></div>
      </div>
      <div class="band b3">
        <svg viewBox="0 0 131 97" xmlns="http://www.w3.org/2000/svg"><use href="#mk" class="dim"/></svg>
        <div class="fillclip"><svg viewBox="0 0 131 97" xmlns="http://www.w3.org/2000/svg"><use href="#mk"/></svg></div>
      </div>
      <div class="band b4">
        <svg viewBox="0 0 131 97" xmlns="http://www.w3.org/2000/svg"><use href="#mk" class="dim"/></svg>
        <div class="fillclip"><svg viewBox="0 0 131 97" xmlns="http://www.w3.org/2000/svg"><use href="#mk"/></svg></div>
      </div>
      <div class="band b5">
        <svg viewBox="0 0 131 97" xmlns="http://www.w3.org/2000/svg"><use href="#mk" class="dim"/></svg>
        <div class="fillclip"><svg viewBox="0 0 131 97" xmlns="http://www.w3.org/2000/svg"><use href="#mk"/></svg></div>
      </div>
      <div class="band b6">
        <svg viewBox="0 0 131 97" xmlns="http://www.w3.org/2000/svg"><use href="#mk" class="dim"/></svg>
        <div class="fillclip"><svg viewBox="0 0 131 97" xmlns="http://www.w3.org/2000/svg"><use href="#mk"/></svg></div>
      </div>
      <div class="band b7">
        <svg viewBox="0 0 131 97" xmlns="http://www.w3.org/2000/svg"><use href="#mk" class="dim"/></svg>
        <div class="fillclip"><svg viewBox="0 0 131 97" xmlns="http://www.w3.org/2000/svg"><use href="#mk"/></svg></div>
      </div>
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
    var fills = document.querySelectorAll('.fillclip, .ghost');
    for (var i = 0; i < fills.length; i++) {
      fills[i].style.clipPath = inset;
      fills[i].style.webkitClipPath = inset;
    }
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
      // Тип обязателен: без него blob: отдаётся без MIME, и «сохранить
      // картинку» ломается, а «открыть в новой вкладке» показывает бинарь
      // текстом. Берём то, что прислал сам R2, с запасным вариантом по
      // расширению — на случай пустого заголовка.
      var ctype = (resp.headers.get('Content-Type') || '').split(';')[0].trim();
      if (!ctype || ctype === 'application/octet-stream') {
        ctype = src.indexOf('.gif') !== -1 ? 'image/gif'
              : src.indexOf('.webp') !== -1 ? 'image/webp'
              : 'image/png';
      }
      var url = URL.createObjectURL(new Blob(chunks, { type: ctype }));
      art.onload = function () {
        if (reqId !== loadSeq) { URL.revokeObjectURL(url); return; }
        clearWatchdog();
        showLoader(false);
        requestAnimationFrame(function () { art.classList.add('visible'); });
        // Блоб нужен только ради прогресс-бара. Оставлять его в src нельзя:
        // через пару секунд он отзывается, и тогда «сохранить картинку» и
        // «открыть в новой вкладке» отваливаются. Возвращаем прямой адрес —
        // файл уже в HTTP-кэше, поэтому подмена мгновенная и без мигания,
        // зато правый клик работает штатно и с нормальным именем файла.
        setTimeout(function () {
          if (reqId !== loadSeq) { URL.revokeObjectURL(url); return; }
          var direct = new Image();
          direct.onload = function () {
            if (reqId !== loadSeq) { URL.revokeObjectURL(url); return; }
            // Detach before swapping: assigning art.src re-fires THIS handler, which
            // would schedule another swap 400ms later, and so on forever. Every swap
            // restarts the GIF from frame 0, so an animated droid never got past its
            // second frame — it read as frantic flicker rather than a 760ms loop.
            art.onload = null;
            art.onerror = null;
            art.src = src;
            URL.revokeObjectURL(url);
          };
          direct.onerror = function () { URL.revokeObjectURL(url); };
          direct.src = src;
        }, 400);
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
