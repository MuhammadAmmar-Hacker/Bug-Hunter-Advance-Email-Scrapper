// ===== BOUNTY HUNTER v2.0 — CONTENT SERP =====
// Runs on Google search pages
// Adds "Block" button next to each result + extracts URLs for background scraping
(function(){
'use strict';

const SKIP = ['google.com','google.co','googleapis.com','gstatic.com','googletagmanager.com',
  'doubleclick.net','accounts.google','support.google','policies.google','maps.google',
  'translate.google','play.google','news.google','youtube.com','youtu.be','wikipedia.org'];

function skipHost(href) {
  try { const h=new URL(href).hostname.toLowerCase(); return SKIP.some(s=>h===s||h.endsWith('.'+s)); }
  catch(e) { return true; }
}

function getSearchPage() {
  const p = new URLSearchParams(location.search);
  const start = parseInt(p.get('start')||'0', 10);
  return Math.floor(start/10) + 1;
}

function cleanUrl(href) {
  if (!href) return null;
  if (href.includes('/url?')) {
    try { href = new URL(href, location.href).searchParams.get('q') || href; } catch(e) {}
  }
  if (!href.startsWith('http') || skipHost(href)) return null;
  try { const u=new URL(href); return u.origin+u.pathname.replace(/\/$/,''); } catch(e) { return null; }
}

// Send URLs to background for scraping
function sendUrls(urls) {
  if (!urls.length) return;
  chrome.runtime.sendMessage({ type:'START_SCRAPING', urls, searchPage: getSearchPage() });
  showSerpToast(`BountyHunter: Queued ${urls.length} URLs for scraping (page ${getSearchPage()})`);
}

function showSerpToast(text) {
  let el = document.getElementById('_bh_serp_toast');
  if (!el) {
    el = document.createElement('div');
    el.id = '_bh_serp_toast';
    Object.assign(el.style, {
      position:'fixed', top:'60px', right:'20px', zIndex:'2147483647',
      background:'#020c06', color:'#00ff41', border:'1.5px solid #00ff41',
      fontFamily:'monospace', fontSize:'11px', fontWeight:'bold',
      padding:'8px 14px', borderRadius:'5px',
      boxShadow:'0 0 20px rgba(0,255,65,.4)',
      pointerEvents:'none', transition:'opacity .4s', maxWidth:'320px'
    });
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity='0'; }, 5000);
}

// Add inline "BLOCK" button next to each search result
function injectBlockButtons() {
  const resultSelectors = [
    'div.yuRUbf', 'div.tF2Cxc', 'div.g', 'div[data-hveid]'
  ];
  const processed = new Set();

  for (const sel of resultSelectors) {
    document.querySelectorAll(sel).forEach(el => {
      const link = el.querySelector('a[href]');
      if (!link) return;
      const href = link.getAttribute('href');
      const clean = cleanUrl(href);
      if (!clean || processed.has(clean)) return;
      processed.add(clean);

      // Don't add if already has button
      if (el.querySelector('._bh_block_btn')) return;

      try {
        const host = new URL(clean).hostname.replace(/^www\./, '');
        const btn = document.createElement('span');
        btn.className = '_bh_block_btn';
        btn.textContent = '🚫 BLOCK';
        Object.assign(btn.style, {
          display:'inline-block', fontSize:'9px', fontFamily:'monospace',
          color:'#ff3535', background:'rgba(255,53,53,.1)',
          border:'1px solid rgba(255,53,53,.4)', borderRadius:'3px',
          padding:'1px 7px', marginLeft:'8px', cursor:'pointer',
          verticalAlign:'middle', transition:'all .15s'
        });
        btn.title = `Block domain: ${host}`;
        btn.addEventListener('mouseenter', () => { btn.style.background='rgba(255,53,53,.25)'; });
        btn.addEventListener('mouseleave', () => { btn.style.background='rgba(255,53,53,.1)'; });
        btn.addEventListener('click', async (e) => {
          e.preventDefault(); e.stopPropagation();
          await chrome.runtime.sendMessage({ type:'ADD_TO_BLACKLIST', domain: host });
          btn.textContent = '✓ BLOCKED';
          btn.style.color = '#ff6666';
          showSerpToast(`Blocked: ${host}`);
        });

        // Insert after the title link
        const titleEl = el.querySelector('h3') || link;
        titleEl.parentNode && titleEl.parentNode.insertBefore(btn, titleEl.nextSibling);
      } catch(e) {}
    });
  }
}

// Collect result URLs and send to background
function collectAndSend() {
  const urls = [], seen = new Set();
  document.querySelectorAll('a[href]').forEach(a => {
    const h = a.getAttribute('href');
    if (!h) return;
    let abs;
    try { abs = new URL(h, location.href).href; } catch(e) { return; }
    const clean = cleanUrl(abs);
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      urls.push({ url: clean, searchPage: getSearchPage() });
    }
  });
  document.querySelectorAll('cite').forEach(c => {
    let t = c.textContent.trim().split(/[\s›»>]/)[0];
    if (t) { if(!t.startsWith('http')) t='https://'+t; const clean=cleanUrl(t); if(clean&&!seen.has(clean)){seen.add(clean);urls.push({url:clean,searchPage:getSearchPage()});} }
  });
  if (urls.length > 0) sendUrls(urls);
}

// Observe page for dynamic content
let debounce = null, lastCount = 0;
const obs = new MutationObserver(() => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    injectBlockButtons();
    const links = document.querySelectorAll('div.g a[href], div.yuRUbf a[href]').length;
    if (links > lastCount) { lastCount = links; collectAndSend(); }
  }, 800);
});

function init() {
  const isSearch = /[?&](q|query)=/.test(location.search) || /\/(search)\b/i.test(location.pathname);
  if (!isSearch) return;
  setTimeout(() => { collectAndSend(); injectBlockButtons(); }, 1200);
  obs.observe(document.documentElement, { childList:true, subtree:true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
})();

// Multi-page orchestrator — called from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_MULTIPAGE') {
    runMultiPage(msg.maxPages || 5, msg.scanMode || 'domain');
    sendResponse({ success: true });
    return true;
  }
});

async function runMultiPage(maxPages, scanMode) {
  let page = 1;
  window._bh_stopped = false;

  async function waitContent(ms) {
    const dl = Date.now() + ms;
    while (Date.now() < dl) {
      if (document.querySelectorAll('div.g,div.tF2Cxc,div#rso a[href]').length > 2) return true;
      await new Promise(r => setTimeout(r, 400));
    }
    return false;
  }

  async function doPage() {
    if (window._bh_stopped || page > maxPages) return;

    // CAPTCHA check
    const txt = document.body?.innerText || '';
    if (document.title.toLowerCase().includes('unusual traffic') || document.querySelector('#captcha-form,#recaptcha')) {
      showSerpToast('⚠ CAPTCHA detected — please solve it!');
      let w = 0;
      while ((document.querySelector('#captcha-form,#recaptcha')) && w < 90000) {
        await new Promise(r => setTimeout(r, 1000)); w += 1000;
      }
      await new Promise(r => setTimeout(r, 1500));
    }

    await waitContent(8000);
    const urls = [], seen = new Set();
    document.querySelectorAll('a[href]').forEach(a => {
      let h = a.getAttribute('href'); if (!h) return;
      if (h.includes('/url?')) { try { h = new URL(h, location.href).searchParams.get('q') || h; } catch(e) {} }
      if (!h.startsWith('http') || skipHost(h)) return;
      try { const u = new URL(h); const c = u.origin + u.pathname.replace(/\/$/, ''); if (!seen.has(c)) { seen.add(c); urls.push({ url: c, searchPage: page }); } } catch(e) {}
    });

    showSerpToast(`BountyHunter: Page ${page}/${maxPages} — ${urls.length} URLs queued`);
    if (urls.length > 0) chrome.runtime.sendMessage({ type: 'START_SCRAPING', urls, searchPage: page, scanMode });
    chrome.runtime.sendMessage({ type: 'SCRAPING_PROGRESS', searchPage: page, totalPages: maxPages, done: page, total: maxPages, remaining: maxPages - page });

    if (page < maxPages) {
      const next = document.querySelector('a#pnnext, a[aria-label="Next page"], a[aria-label="Next"]');
      if (next) {
        page++;
        const prev = location.href;
        await new Promise(r => setTimeout(r, 900));
        next.click();
        let w = 0;
        await new Promise(r => { const iv = setInterval(() => { w += 300; if ((location.href !== prev && document.querySelectorAll('div.g').length > 1) || w > 12000) { clearInterval(iv); r(); } }, 300); });
        await new Promise(r => setTimeout(r, 700));
        doPage();
      } else {
        showSerpToast('BountyHunter: No more pages found');
        chrome.runtime.sendMessage({ type: 'SCRAPING_COMPLETE' });
      }
    } else {
      showSerpToast(`BountyHunter: Done — ${maxPages} pages scraped!`);
      chrome.runtime.sendMessage({ type: 'SCRAPING_COMPLETE' });
    }
  }
  doPage();
}
