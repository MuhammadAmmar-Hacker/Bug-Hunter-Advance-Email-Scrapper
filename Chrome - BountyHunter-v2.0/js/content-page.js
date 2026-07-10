// ===== BOUNTY HUNTER v2.0 — CONTENT PAGE =====
(function(){
'use strict';

const EMAIL_RE = /[a-zA-Z0-9!#$%&'*+\/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+\/=?^_`{|}~-]+)*@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}/g;
const CURRENCY_RE = /[\$€£¥₹₿]|\b(USD|EUR|GBP|reward|bounty|paid|payout)\b/i;
const PLATFORM_RE = /bugcrowd\.com|hackerone\.com|intigriti\.com|yeswehack\.com|synack\.com/i;

const JUNK_TLD  = new Set(['png','jpg','jpeg','gif','svg','webp','css','js','map','woff','woff2','ttf','eot','ico','zip','gz','mp4']);
const JUNK_LOC  = new Set(['noreply','no-reply','donotreply','do-not-reply','mailer-daemon','postmaster','webmaster','bounce','bounces','unsubscribe','abuse','spam']);
const JUNK_DOM  = new Set(['example.com','example.org','test.com','sentry.io','wixpress.com','schema.org','w3.org','cloudflare.com']);

function deob(t) {
  return t.replace(/&#64;/gi,'@').replace(/&#x40;/gi,'@').replace(/%40/g,'@')
    .replace(/\[\s*at\s*\]/gi,'@').replace(/\(\s*at\s*\)/gi,'@')
    .replace(/\[\s*dot\s*\]/gi,'.').replace(/\(\s*dot\s*\)/gi,'.');
}

function valid(e) {
  if (!e || !e.includes('@')) return false;
  const [loc, dom] = e.split('@');
  if (!loc || !dom || !dom.includes('.')) return false;
  const tld = dom.split('.').pop().toLowerCase();
  if (JUNK_TLD.has(tld) || JUNK_LOC.has(loc.toLowerCase()) || JUNK_DOM.has(dom.toLowerCase())) return false;
  if (e.length > 254 || loc.length > 64 || /\.{2,}/.test(e)) return false;
  return true;
}

function extract() {
  const found = new Set();
  let m;

  // 1. mailto links
  document.querySelectorAll('a[href]').forEach(a => {
    const h = a.getAttribute('href') || '';
    if (!h.toLowerCase().includes('mailto:')) return;
    try {
      const raw = decodeURIComponent(h.replace(/^.*mailto:/i,'').split('?')[0]).toLowerCase().trim();
      if (valid(raw)) found.add(raw);
    } catch(e) {}
  });

  // 2. Visible text
  const txt = deob((document.body||document.documentElement).innerText||'');
  EMAIL_RE.lastIndex=0;
  while((m=EMAIL_RE.exec(txt))!==null){const e=m[0].toLowerCase().trim();if(valid(e))found.add(e);}

  // 3. Full HTML
  const html = deob(document.documentElement.innerHTML||'');
  EMAIL_RE.lastIndex=0;
  while((m=EMAIL_RE.exec(html))!==null){const e=m[0].toLowerCase().trim();if(valid(e))found.add(e);}

  // 4. Meta tags
  document.querySelectorAll('meta[content]').forEach(el=>{
    const c=deob(el.getAttribute('content')||'');
    EMAIL_RE.lastIndex=0;
    while((m=EMAIL_RE.exec(c))!==null){const e=m[0].toLowerCase().trim();if(valid(e))found.add(e);}
  });

  // 5. JSON-LD
  document.querySelectorAll('script[type="application/ld+json"]').forEach(el=>{
    EMAIL_RE.lastIndex=0;
    while((m=EMAIL_RE.exec(el.textContent||''))!==null){const e=m[0].toLowerCase().trim();if(valid(e))found.add(e);}
  });

  return [...found];
}

function showBadge(n, isPaid) {
  let b = document.getElementById('_bh_badge');
  if (!b) {
    b = document.createElement('div'); b.id='_bh_badge';
    Object.assign(b.style,{
      position:'fixed',bottom:'20px',right:'20px',zIndex:'2147483647',
      background:'#020c06',border:'2px solid',fontFamily:'monospace',
      fontSize:'11px',fontWeight:'bold',padding:'9px 14px',borderRadius:'5px',
      pointerEvents:'none',transition:'opacity .4s,transform .4s',
      opacity:'0',transform:'translateY(10px)'
    });
    (document.body||document.documentElement).appendChild(b);
  }
  const color = isPaid ? '#ffd700' : '#00ff41';
  b.style.color=color; b.style.borderColor=color;
  b.style.boxShadow=`0 0 20px ${isPaid?'rgba(255,215,0,.4)':'rgba(0,255,65,.4)'}`;
  b.textContent=`⬡ +${n} EMAIL${n>1?'S':''} CAPTURED${isPaid?' 💰':''}`;
  b.style.opacity='1'; b.style.transform='translateY(0)';
  clearTimeout(b._t);
  b._t=setTimeout(()=>{b.style.opacity='0';b.style.transform='translateY(10px)';},4000);
}

async function send(emails) {
  if (!emails.length) return 0;
  // Auto-blacklist known platforms
  if (PLATFORM_RE.test(document.documentElement.innerHTML.slice(0,20000))) {
    chrome.runtime.sendMessage({type:'ADD_TO_BLACKLIST',domain:location.hostname.replace(/^www\./,'')}).catch(()=>{});
    return 0;
  }
  const isPaid = CURRENCY_RE.test((document.body?.innerText||'').slice(0,15000));
  try {
    const r = await chrome.runtime.sendMessage({
      type:'EXTRACT_EMAILS', emails,
      url:location.href, title:document.title,
      html:document.documentElement.innerHTML.slice(0,40000),
      mode:'auto', searchPage:0, isPaid,
    });
    const added = r?.added||0;
    if (added>0) showBadge(added,isPaid);
    return added;
  } catch(e){return 0;}
}

// Detect Gmail from page
function detectGmail() {
  const checks = [
    ()=>document.querySelector('[data-email]')?.getAttribute('data-email'),
    ()=>document.querySelector('[email]')?.getAttribute('email'),
    ()=>{
      for(const el of document.querySelectorAll('[aria-label]')){
        const m=(el.getAttribute('aria-label')||'').match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
        if(m) return m[0];
      }
    },
    ()=>{const m=document.documentElement.innerHTML.match(/"([a-zA-Z0-9._%+\-]+@gmail\.com)"/);return m?.[1];}
  ];
  for(const fn of checks){try{const r=fn();if(r&&r.includes('@'))return r.toLowerCase().trim();}catch(e){}}
  return null;
}

// Message listener for manual extraction
chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
  if(msg.type==='EXTRACT_NOW'){
    const emails=extract();
    send(emails).then(n=>sendResponse({success:true,count:n}));
    return true;
  }
  if(msg.type==='DETECT_GMAIL'){
    sendResponse({gmail:detectGmail()});
    return true;
  }
});

// Auto mode
let lastCount=0;
async function init(){
  if(!location.protocol.startsWith('http')) return;
  const gmail=detectGmail();
  if(gmail){
    // Get existing emails and add if not already there
    const r=await chrome.runtime.sendMessage({type:'GET_USER_EMAILS'}).catch(()=>({emails:[]}));
    const existing=(r?.emails||[]).map(e=>e.toLowerCase());
    if(!existing.includes(gmail.toLowerCase())){
      await chrome.runtime.sendMessage({type:'SET_USER_EMAILS',emails:[...existing,gmail]}).catch(()=>{});
    }
  }
  const s=await chrome.storage.local.get('bh_auto').catch(()=>({}));
  if(!s.bh_auto) return;
  await new Promise(r=>setTimeout(r,1500));
  const emails=extract();
  lastCount=emails.length;
  if(emails.length) await send(emails);
  const obs=new MutationObserver(()=>{
    clearTimeout(obs._t);
    obs._t=setTimeout(async()=>{
      const em=extract();
      if(em.length>lastCount){lastCount=em.length;await send(em);}
    },2500);
  });
  obs.observe(document.documentElement,{childList:true,subtree:true});
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
else init();
})();
