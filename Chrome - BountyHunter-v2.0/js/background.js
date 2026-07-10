'use strict';
// ===== BOUNTY HUNTER v2.0 — BACKGROUND =====

const EMAIL_RE = /[a-zA-Z0-9!#$%&'*+\/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+\/=?^_`{|}~-]+)*@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}/g;

const DEEP_PATHS = ['/security','/security.txt','/.well-known/security.txt',
  '/responsible-disclosure','/bug-bounty','/contact','/contact-us',
  '/about','/team','/support','/legal','/privacy','/impressum'];

const HV_WORDS = ['bug','bugbounty','bug-bounty','vulnerability','responsible disclosure',
  'security','pentest','hackerone','bugcrowd','security.txt','security contact'];

const CURRENCY_RE = /[\$€£¥₹₿]|\b(USD|EUR|GBP|reward|bounty|paid|payout|compensation)\b/i;
const PLATFORM_RE = /bugcrowd\.com|hackerone\.com|intigriti\.com|yeswehack\.com|synack\.com|cobalt\.io/i;

const JUNK_TLD  = new Set(['png','jpg','jpeg','gif','svg','webp','css','js','map','woff','woff2','ttf','eot','ico','zip','gz','mp4','ts']);
const JUNK_LOC  = new Set(['noreply','no-reply','donotreply','do-not-reply','mailer-daemon','postmaster','webmaster','bounce','bounces','unsubscribe','abuse','spam']);
const JUNK_DOM  = new Set(['example.com','example.org','test.com','sentry.io','wixpress.com','schema.org','w3.org','cloudflare.com']);
const SOCIAL    = new Set(['facebook.com','fb.com','instagram.com','linkedin.com','twitter.com','x.com',
  'tiktok.com','youtube.com','pinterest.com','snapchat.com','reddit.com','tumblr.com',
  'medium.com','vk.com','vkontakte.ru','whatsapp.com','telegram.org']);
const OPEN_PLATFORMS = new Set(['bugcrowd.com','hackerone.com','intigriti.com','yeswehack.com',
  'synack.com','cobalt.io','openbugbounty.org','vulnerability.gov','disclose.io']);

let queue=[], visitedUrls=new Set(), processing=false, paused=false, stopped=false;
let userEmailSet=new Set();
let blacklist={ domains:new Set(), emails:new Set(), social:false, userEmail:true, platforms:true };
let totalQueued=0, startTime=0, scanMode='domain';

const sGet=k=>new Promise(r=>chrome.storage.local.get(k,r));
const sSet=o=>new Promise(r=>chrome.storage.local.set(o,r));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// ---- Init ----
async function init() {
  const d = await sGet(['bh_emails','bh_stats','bh_queue','bh_gmail','bh_blacklist','bh_scan_mode']);
  if (d.bh_gmail) buildUserEmailSet(Array.isArray(d.bh_gmail) ? d.bh_gmail : [d.bh_gmail]);
  if (d.bh_scan_mode) scanMode = d.bh_scan_mode;
  if (d.bh_blacklist) {
    const bl = d.bh_blacklist;
    blacklist.domains   = new Set(bl.domains   || []);
    blacklist.emails    = new Set(bl.emails     || []);
    blacklist.social    = bl.social    === true;
    blacklist.userEmail = bl.userEmail !== false;
    blacklist.platforms = bl.platforms !== false;
    if (blacklist.platforms) OPEN_PLATFORMS.forEach(p => blacklist.domains.add(p));
  }
  if (d.bh_queue && d.bh_queue.length) {
    queue = d.bh_queue;
    queue.forEach(i => visitedUrls.add(i.url));
    totalQueued = queue.length;
    processQueue();
  }
  // Keep-alive alarm
  chrome.alarms.create('bh-alive', { periodInMinutes: 0.4 });
}
init();

chrome.alarms.onAlarm.addListener(a => {
  if (a.name === 'bh-alive' && !processing && queue.length > 0) processQueue();
});

// ---- Gmail / personal email set ----
function buildUserEmailSet(emails) {
  userEmailSet.clear();
  for (const raw of emails) {
    if (!raw) continue;
    const e = raw.toLowerCase().trim();
    userEmailSet.add(e);
    if (e.endsWith('@gmail.com') || e.endsWith('@googlemail.com')) {
      const [loc] = e.split('@');
      const nodots = loc.replace(/\./g,'');
      const base   = loc.split('+')[0];
      userEmailSet.add(`${nodots}@gmail.com`);
      userEmailSet.add(`${base}@gmail.com`);
      userEmailSet.add(`${base.replace(/\./g,'')}@gmail.com`);
      userEmailSet.add(`${loc}@googlemail.com`);
      userEmailSet.add(`${nodots}@googlemail.com`);
    }
  }
}

function isUserEmail(email) {
  if (!blacklist.userEmail || !userEmailSet.size) return false;
  const e = email.toLowerCase().trim();
  if (userEmailSet.has(e)) return true;
  const [eloc, edom] = e.split('@');
  if (!eloc || !edom) return false;
  for (const u of userEmailSet) {
    const [uloc, udom] = u.split('@');
    if (!uloc || !udom) continue;
    if ((edom==='gmail.com'||edom==='googlemail.com') && (udom==='gmail.com'||udom==='googlemail.com')) {
      if (eloc.replace(/\./g,'').split('+')[0] === uloc.replace(/\./g,'').split('+')[0]) return true;
    }
  }
  return false;
}

function isBlacklisted(email, url) {
  const e = email.toLowerCase().trim();
  if (isUserEmail(e)) return true;
  if (blacklist.emails.has(e)) return true;
  let host = '';
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch(x) {}
  if (blacklist.domains.has(host)) return true;
  if (blacklist.social && SOCIAL.has(host)) return true;
  const edom = e.split('@')[1] || '';
  if (blacklist.domains.has(edom)) return true;
  if (blacklist.social && SOCIAL.has(edom)) return true;
  return false;
}

function deob(t) {
  return t.replace(/&#64;/gi,'@').replace(/&#x40;/gi,'@').replace(/%40/g,'@')
    .replace(/\[\s*at\s*\]/gi,'@').replace(/\(\s*at\s*\)/gi,'@').replace(/\{\s*at\s*\}/gi,'@')
    .replace(/\[\s*dot\s*\]/gi,'.').replace(/\(\s*dot\s*\)/gi,'.').replace(/\{\s*dot\s*\}/gi,'.');
}

function validEmail(e) {
  if (!e || e.length < 6 || e.length > 254 || !e.includes('@')) return false;
  const [loc, dom] = e.split('@');
  if (!loc || !dom || !dom.includes('.')) return false;
  const tld = dom.split('.').pop().toLowerCase();
  if (JUNK_TLD.has(tld) || JUNK_LOC.has(loc.toLowerCase()) || JUNK_DOM.has(dom.toLowerCase())) return false;
  if (loc.length > 64 || /\.{2,}/.test(e)) return false;
  return true;
}

function extractEmails(html) {
  const found = new Set();
  const mtRe = /href=["']mailto:([^"'?\s]+)/gi;
  let m;
  while ((m = mtRe.exec(html)) !== null) {
    try { found.add(decodeURIComponent(m[1]).toLowerCase().trim()); } catch(x) {}
  }
  const stripped = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<!--[\s\S]*?-->/g,' ')
    .replace(/<[^>]+>/g,' ');
  for (const src of [stripped, html]) {
    const d = deob(src);
    EMAIL_RE.lastIndex = 0;
    while ((m = EMAIL_RE.exec(d)) !== null) {
      found.add(m[0].toLowerCase().trim());
    }
  }
  return [...found].filter(validEmail);
}

function extractTitle(html) {
  const m = (html||'').match(/<title[^>]*>([^<]{1,200})<\/title>/i);
  return m ? m[1].trim() : '';
}

function isHighValue(email, html, url) {
  return HV_WORDS.some(w => (email+' '+url+' '+(html||'').slice(0,5000)).toLowerCase().includes(w));
}
function isPolicyPage(url) {
  return ['/security','/disclosure','/bug-bounty','/vulnerability','security.txt','well-known'].some(k=>url.toLowerCase().includes(k));
}

async function fetchHTML(url, timeout=12000) {
  for (let a = 0; a < 2; a++) {
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), timeout);
      const res  = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        redirect: 'follow'
      });
      clearTimeout(tid);
      if (!res.ok) return null;
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('html') && !ct.includes('text')) return null;
      return await res.text();
    } catch(e) { if (a === 0) await sleep(400); }
  }
  return null;
}

// ---- Global dedup store ----
async function storeEmails(emails, url, title, searchPage, html, isPaid) {
  if (!emails.length) return 0;
  const d = await sGet(['bh_emails','bh_stats']);
  const stored = d.bh_emails || [];
  const stats  = d.bh_stats  || { total:0, domains:0, highValue:0, pages:0, paid:0 };
  const seenEmails = new Set(stored.map(e => e.email));
  const hv   = isHighValue('', html||'', url);
  const isPol= isPolicyPage(url);
  const now  = new Date().toISOString();
  let added  = 0;
  for (const email of emails) {
    const e = email.toLowerCase().trim();
    if (!validEmail(e) || isBlacklisted(e, url)) { console.log('[BH] skip:', e); continue; }
    if (seenEmails.has(e)) continue;
    seenEmails.add(e);
    const hvE = hv || isHighValue(e,'',url);
    stored.push({ email:e, url, title:title||'', isPolicy:isPol, isHighValue:hvE,
      isPaid:isPaid||false, searchPage:searchPage||0, timestamp:now });
    if (hvE) stats.highValue = (stats.highValue||0)+1;
    if (isPaid) stats.paid = (stats.paid||0)+1;
    added++;
  }
  if (added) {
    stats.total   = stored.length;
    stats.domains = new Set(stored.map(e=>{ try{return new URL(e.url).hostname;}catch(x){return e.url;} })).size;
    stats.pages   = (stats.pages||0)+1;
    await sSet({ bh_emails: stored, bh_stats: stats });
    try { chrome.runtime.sendMessage({ type:'EMAILS_UPDATED', added, stats }); } catch(x) {}
    showNotif(added, url, isPol||hv||isPaid);
  }
  return added;
}

function showNotif(n, url, isHV) {
  try {
    chrome.notifications.create(`bh_${Date.now()}`, {
      type:'basic', iconUrl:'../icons/icon-48.png',
      title:`BountyHunter +${n} Email${n>1?'s':''} Found${isHV?' ★':''}`,
      message:`From: ${new URL(url).hostname}`, priority:2
    });
  } catch(x) {}
}

async function scrapeItem(item) {
  const { url, searchPage } = item;
  let origin;
  try { origin = new URL(url).origin; } catch(e) { return; }
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./,'');
    if (blacklist.domains.has(host) || (blacklist.social && SOCIAL.has(host))) return;
  } catch(x) {}

  notifyProgress(url);
  const html = await fetchHTML(url);
  let mainEmails = [];
  if (html) {
    if (PLATFORM_RE.test(html.slice(0,15000))) {
      try {
        const host = new URL(url).hostname.replace(/^www\./,'');
        blacklist.domains.add(host);
        await saveBlacklist();
      } catch(x) {}
      return;
    }
    const isPaid = CURRENCY_RE.test(html.slice(0,15000));
    mainEmails = extractEmails(html);
    await storeEmails(mainEmails, url, extractTitle(html), searchPage, html, isPaid);
  }

  // Domain mode: fallback to quick sibling pages if no emails found
  if (scanMode === 'domain' && mainEmails.length === 0) {
    for (const path of ['/contact','/contact-us','/about','/security']) {
      if (stopped) return;
      const sib = origin + path;
      if (visitedUrls.has(sib)) continue;
      visitedUrls.add(sib);
      const sibHtml = await fetchHTML(sib, 7000);
      if (!sibHtml) { await sleep(150); continue; }
      const sibEmails = extractEmails(sibHtml);
      if (sibEmails.length > 0) {
        const isPaid = CURRENCY_RE.test(sibHtml.slice(0,10000));
        await storeEmails(sibEmails, sib, extractTitle(sibHtml)||path, searchPage, sibHtml, isPaid);
        break;
      }
      await sleep(150);
    }
  }

  // Deep mode: full parallel sweep
  if (scanMode === 'deep') {
    const paths = DEEP_PATHS.filter(p => {
      const s = origin + p;
      if (visitedUrls.has(s)) return false;
      visitedUrls.add(s); return true;
    });
    for (let i = 0; i < paths.length; i += 3) {
      if (stopped) return;
      await Promise.all(paths.slice(i,i+3).map(async path => {
        const sub = origin + path;
        const subHtml = await fetchHTML(sub, 8000);
        if (subHtml) {
          const isPaid = CURRENCY_RE.test(subHtml.slice(0,10000));
          const em = extractEmails(subHtml);
          if (em.length) await storeEmails(em, sub, extractTitle(subHtml)||path, searchPage, subHtml, isPaid);
        }
      }));
      await sleep(150);
    }
  }
}

async function notifyProgress(currentUrl) {
  const d = await sGet('bh_stats');
  const st = d.bh_stats || {};
  const done = totalQueued - queue.length;
  const elapsed = startTime ? (Date.now()-startTime)/1000 : 1;
  const eta = elapsed > 0 ? Math.round(queue.length / Math.max(done/elapsed, 0.1)) : 0;
  try {
    chrome.runtime.sendMessage({
      type:'SCRAPING_PROGRESS',
      currentDomain: new URL(currentUrl).hostname,
      done, total:totalQueued, remaining:queue.length,
      emailsFound:st.total||0, highValue:st.highValue||0, etaSeconds:eta
    });
  } catch(x) {}
}

async function processQueue() {
  if (processing) return;
  processing = true; stopped = false; startTime = Date.now();
  const BATCH = scanMode === 'deep' ? 2 : 5;
  while (queue.length > 0 && !stopped) {
    if (paused) { await sleep(300); continue; }
    const batch = queue.splice(0, BATCH);
    await sSet({ bh_queue: queue });
    await Promise.all(batch.map(item => scrapeItem(item).catch(e => console.warn('[BH]',e.message))));
    await sleep(scanMode === 'domain' ? 200 : 400);
  }
  processing = false;
  await sSet({ bh_queue: [] });
  try { chrome.runtime.sendMessage({ type:'SCRAPING_COMPLETE' }); } catch(x) {}
}

async function saveBlacklist() {
  await sSet({ bh_blacklist: {
    domains: [...blacklist.domains], emails: [...blacklist.emails],
    social: blacklist.social, userEmail: blacklist.userEmail, platforms: blacklist.platforms
  }});
}

async function purgeBlacklisted() {
  const d = await sGet('bh_emails');
  const stored = d.bh_emails || [];
  const clean = stored.filter(e => !isBlacklisted(e.email, e.url));
  if (clean.length !== stored.length) {
    const st = {
      total: clean.length,
      domains: new Set(clean.map(e=>{try{return new URL(e.url).hostname;}catch(x){return '';}})).size,
      highValue: clean.filter(e=>e.isHighValue).length,
      pages: 0, paid: clean.filter(e=>e.isPaid).length
    };
    await sSet({ bh_emails: clean, bh_stats: st });
    try { chrome.runtime.sendMessage({ type:'EMAILS_UPDATED', added:0, stats:st }); } catch(x) {}
  }
}

// ---- Message router ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case 'EXTRACT_EMAILS': {
          const clean = (msg.emails||[]).filter(e => !isBlacklisted(e, msg.url||''));
          const added = await storeEmails(clean, msg.url||'', msg.title||'', msg.searchPage||0, msg.html||'', msg.isPaid||false);
          sendResponse({ success:true, added }); break;
        }
        case 'START_SCRAPING': {
          if (msg.scanMode) { scanMode = msg.scanMode; await sSet({bh_scan_mode:scanMode}); }
          const items = (msg.urls||[]).map(i => typeof i==='string' ? {url:i,searchPage:msg.searchPage||0} : i);
          const fresh = items.filter(i => { if(visitedUrls.has(i.url))return false; visitedUrls.add(i.url); return true; });
          queue.push(...fresh);
          totalQueued = Math.max(totalQueued, queue.length);
          await sSet({ bh_queue: queue });
          processQueue();
          sendResponse({ success:true, queued:fresh.length }); break;
        }
        case 'PAUSE_SCRAPING':  { paused=true;  sendResponse({success:true}); break; }
        case 'RESUME_SCRAPING': { paused=false; sendResponse({success:true}); break; }
        case 'STOP_SCRAPING': {
          stopped=true; paused=false; queue=[];
          await sSet({bh_queue:[]}); processing=false;
          sendResponse({success:true}); break;
        }
        case 'SET_SCAN_MODE': {
          scanMode = msg.mode; await sSet({bh_scan_mode:scanMode});
          sendResponse({success:true}); break;
        }
        case 'RESET_VISITED': {
          visitedUrls = new Set();
          sendResponse({success:true}); break;
        }
        case 'GET_DATA': {
          const d = await sGet(['bh_emails','bh_stats']);
          sendResponse({ emails:d.bh_emails||[], stats:d.bh_stats||{total:0,domains:0,highValue:0,pages:0,paid:0}, queueLen:queue.length, processing }); break;
        }
        case 'GET_SCRAPING_STATE':
          sendResponse({ active:processing||queue.length>0, paused, queueLen:queue.length }); break;
        case 'REMOVE_EMAIL': {
          const d = await sGet('bh_emails');
          const arr = (d.bh_emails||[]).filter(e => e.email !== msg.email);
          const st = { total:arr.length, domains:new Set(arr.map(e=>{try{return new URL(e.url).hostname;}catch(x){return '';}})).size, highValue:arr.filter(e=>e.isHighValue).length, pages:0, paid:arr.filter(e=>e.isPaid).length };
          await sSet({bh_emails:arr,bh_stats:st}); sendResponse({success:true}); break;
        }
        case 'CLEAR_DATA': {
          queue=[]; visitedUrls=new Set(); processing=false; paused=false; stopped=false; totalQueued=0;
          await sSet({bh_emails:[],bh_stats:{total:0,domains:0,highValue:0,pages:0,paid:0},bh_queue:[]});
          sendResponse({success:true}); break;
        }
        case 'SET_USER_EMAILS': {
          buildUserEmailSet(msg.emails||[]);
          await sSet({bh_gmail: msg.emails||[]});
          await purgeBlacklisted();
          sendResponse({success:true}); break;
        }
        case 'GET_USER_EMAILS': {
          const d = await sGet('bh_gmail');
          const emails = d.bh_gmail || [];
          sendResponse({ emails: Array.isArray(emails) ? emails : [emails].filter(Boolean) }); break;
        }
        case 'SAVE_TEMPLATE': await sSet({bh_template:msg.template}); sendResponse({success:true}); break;
        case 'GET_TEMPLATE': { const d=await sGet('bh_template'); sendResponse({template:d.bh_template||null}); break; }
        case 'GET_BLACKLIST':
          sendResponse({domains:[...blacklist.domains],emails:[...blacklist.emails],social:blacklist.social,userEmail:blacklist.userEmail,platforms:blacklist.platforms}); break;
        case 'ADD_TO_BLACKLIST':
          if (msg.domain) blacklist.domains.add(msg.domain.toLowerCase().replace(/^www\./,''));
          if (msg.email)  blacklist.emails.add(msg.email.toLowerCase().trim());
          await saveBlacklist(); await purgeBlacklisted(); sendResponse({success:true}); break;
        case 'REMOVE_FROM_BLACKLIST':
          if (msg.domain) blacklist.domains.delete(msg.domain);
          if (msg.email)  blacklist.emails.delete(msg.email);
          await saveBlacklist(); sendResponse({success:true}); break;
        case 'SET_BLACKLIST_TOGGLE':
          if (msg.key==='social')     blacklist.social    = msg.value;
          if (msg.key==='userEmail')  blacklist.userEmail = msg.value;
          if (msg.key==='platforms') {
            blacklist.platforms = msg.value;
            if (msg.value) OPEN_PLATFORMS.forEach(p => blacklist.domains.add(p));
            else OPEN_PLATFORMS.forEach(p => blacklist.domains.delete(p));
          }
          await saveBlacklist(); await purgeBlacklisted(); sendResponse({success:true}); break;
        case 'CLEAR_BLACKLIST':
          blacklist.domains.clear(); blacklist.emails.clear();
          if (blacklist.platforms) OPEN_PLATFORMS.forEach(p => blacklist.domains.add(p));
          await saveBlacklist(); sendResponse({success:true}); break;
      }
    } catch(err) { console.error('[BH]',err); sendResponse({success:false,error:err.message}); }
  })();
  return true;
});
