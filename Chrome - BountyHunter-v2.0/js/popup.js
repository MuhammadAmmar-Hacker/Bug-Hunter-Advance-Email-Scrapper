'use strict';
// ===== BOUNTY HUNTER v2.0 — POPUP =====

const DORK_CATEGORIES = {
  '💰 Paid / Rewarded Programs': [
    'inurl:bug-bounty "reward" "$" -site:hackerone.com -site:bugcrowd.com',
    '"bug bounty" "up to $" inurl:security -hackerone -bugcrowd',
    '"we pay" "vulnerability" "USD" OR "EUR" -site:bugcrowd.com',
    '"security.txt" "reward" "$" -site:hackerone.com',
    '"vulnerability disclosure" "reward" "€" OR "$" -bugcrowd -hackerone',
    '"responsible disclosure" "cash" OR "paid" inurl:security -bugcrowd',
    '"hall of fame" AND "monetary reward" -site:hackerone.com -site:bugcrowd.com',
  ],
  '🆕 Fresh / New VDP Programs': [
    `"vulnerability disclosure program" "new" OR "launched" ${new Date().getFullYear()} -site:hackerone.com -site:bugcrowd.com`,
    `"bug bounty program" "introducing" OR "launching" ${new Date().getFullYear()} -bugcrowd -hackerone`,
    '"we are launching" "bug bounty" OR "vulnerability disclosure" -hackerone -bugcrowd',
    '"private bug bounty" OR "invite only" inurl:security -site:bugcrowd.com',
    `"security.txt" "mailto" after:${new Date().getFullYear()-1}-06-01 -site:hackerone.com`,
  ],
  '🏦 Financial & FinTech': [
    'site:*.bank "responsible disclosure" OR "bug bounty" -site:hackerone.com -site:bugcrowd.com',
    '"fintech" "security disclosure" "report" inurl:security -site:bugcrowd.com',
    '"digital bank" "bug bounty" OR "responsible disclosure" -site:hackerone.com',
    '"cryptocurrency" "vulnerability disclosure" -hackerone -bugcrowd',
    '"payment" "security disclosure" inurl:security -site:bugcrowd.com',
  ],
  '💻 SaaS & Tech': [
    'site:*.io inurl:security "responsible disclosure" -site:hackerone.com -site:bugcrowd.com',
    'inurl:/.well-known/security.txt "mailto" -github.com -wikipedia.org',
    '"cloud provider" "bug bounty" OR "disclosure" -site:hackerone.com',
    '"devops" "security vulnerability" "report" inurl:security -bugcrowd',
    '"AI" OR "LLM" "security disclosure" "vulnerability" -site:bugcrowd.com',
  ],
  '🏥 Healthcare & Education': [
    'site:*.health "responsible disclosure" "vulnerability" -site:hackerone.com',
    'site:*.edu "responsible disclosure" "security report" -site:hackerone.com',
    '"telemedicine" "security contact" OR "disclosure" -bugcrowd -hackerone',
    '"hospital" OR "clinic" "vulnerability disclosure" inurl:security -bugcrowd',
  ],
  '🌐 Core Security Disclosure': [
    'inurl:/responsible-disclosure/ "reward" -site:hackerone.com -site:bugcrowd.com',
    'inurl:security.txt "mailto" -github.com -wikipedia.org -hackerone.com -bugcrowd.com',
    'site:*.gov "responsible disclosure" "vulnerability" -site:hackerone.com',
    '"security policy" "disclose" "contact" inurl:security -hackerone -bugcrowd',
    '"coordinated disclosure" "reward" OR "recognition" -hackerone -bugcrowd',
  ],
};

const SMART_COUNTRY_MAP = {
  'site:*.us OR site:*.com':'USA','site:*.uk':'UK','site:*.nl':'Netherlands',
  'site:*.de':'Germany','site:*.in':'India','site:*.pk':'Pakistan',
  'site:*.ae':'UAE','site:*.au':'Australia','site:*.ca':'Canada',
  'site:*.fr':'France','site:*.eu':'Europe','site:*.sa':'Saudi Arabia',
};

const $=id=>document.getElementById(id);
let allEmails=[],filteredEmails=[],stats={total:0,domains:0,highValue:0,pages:0,paid:0};
let sortField='email',sortAsc=true,filterHV=false,filterPaid=false;
let currentApproachEmail=null,scanMode='domain',isMaximized=false;

// ---- INIT ----
document.addEventListener('DOMContentLoaded',async()=>{
  await loadTheme();
  await loadData();
  await detectGmailFromTabs();
  initTabs();
  initNetStatus();
  initAutoToggle();
  initModeSelect();
  initScanMode();
  initMaximize();
  bindSearchEvents();
  bindDorkEvents();
  bindBlacklistEvents();
  bindOutreachEvents();
  bindModalEvents();
  applyFilters();
  checkScrapingState();
  populateYears();

  chrome.runtime.onMessage.addListener(msg=>{
    if(msg.type==='EMAILS_UPDATED'){loadData().then(()=>{applyFilters();showNotif(msg.added);});}
    if(msg.type==='SCRAPING_PROGRESS') updateProgress(msg);
    if(msg.type==='SCRAPING_COMPLETE') onDone();
  });
});

async function loadData(){
  const r=await chrome.runtime.sendMessage({type:'GET_DATA'});
  if(!r) return;
  allEmails=r.emails||[];
  stats=r.stats||{total:0,domains:0,highValue:0,pages:0,paid:0};
  updateStats(r.queueLen||0);
}

async function detectGmailFromTabs(){
  try {
    const allTabs=await chrome.tabs.query({});
    const gTabs=allTabs.filter(t=>t.url&&['mail.google.com','accounts.google.com','google.com'].some(u=>t.url.includes(u)));
    for(const tab of gTabs){
      try{
        const res=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{
          const fns=[
            ()=>document.querySelector('[data-email]')?.getAttribute('data-email'),
            ()=>document.querySelector('[email]')?.getAttribute('email'),
            ()=>{for(const el of document.querySelectorAll('[aria-label]')){const m=(el.getAttribute('aria-label')||'').match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);if(m)return m[0];}},
            ()=>{const m=document.documentElement.innerHTML.match(/"([a-zA-Z0-9._%+\-]+@gmail\.com)"/);return m?.[1];}
          ];
          for(const f of fns){try{const r=f();if(r&&r.includes('@'))return r.toLowerCase().trim();}catch(e){}}
          return null;
        }});
        const gmail=res?.[0]?.result;
        if(gmail){
          const existing=await chrome.runtime.sendMessage({type:'GET_USER_EMAILS'});
          const arr=(existing?.emails||[]).map(e=>e.toLowerCase());
          if(!arr.includes(gmail)){await chrome.runtime.sendMessage({type:'SET_USER_EMAILS',emails:[...arr,gmail]});}
          break;
        }
      }catch(e){}
    }
  }catch(e){}
}

async function loadTheme(){
  const r=await chrome.storage.local.get('bh_theme');
  if(r.bh_theme) applyThemeVars(r.bh_theme);
}

function applyThemeVars(t){
  const root=document.documentElement;
  if(t.primary)  root.style.setProperty('--c-primary', t.primary);
  if(t.accent)   root.style.setProperty('--c-accent',  t.accent);
  if(t.bg)       root.style.setProperty('--c-bg',      t.bg);
  if(t.card)     root.style.setProperty('--c-card',    t.card);
  if(t.text)     root.style.setProperty('--c-text',    t.text);
}

// ---- TABS ----
function initTabs(){
  document.querySelectorAll('.tab-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p=>{p.classList.remove('active');p.classList.add('hidden');});
      btn.classList.add('active');
      const pane=$(`tab-${btn.dataset.tab}`);
      if(pane){pane.classList.remove('hidden');pane.classList.add('active');}
      if(btn.dataset.tab==='dorks')     loadDorkUI();
      if(btn.dataset.tab==='blacklist') loadBlacklistUI();
    });
  });
}

function initNetStatus(){
  const dot=$('netDot');
  const up=()=>{dot.className=`net-dot ${navigator.onLine?'online':''}`};
  up(); window.addEventListener('online',up); window.addEventListener('offline',up);
}

// ---- MAXIMIZE ----
function initMaximize(){
  $('btnMaximize').addEventListener('click',()=>{
    isMaximized=!isMaximized;
    document.body.classList.toggle('maximized',isMaximized);
    $('btnMaximize').textContent=isMaximized?'⤡':'⤢';
    $('btnMaximize').title=isMaximized?'Restore Panel':'Maximize Results';
  });
}

// ---- THEME MODAL ----
const PRESETS={
  green:{primary:'#00ff41',accent:'#00ffe7',bg:'#020c06',card:'#071a0c',text:'#b8ffcb'},
  red:  {primary:'#ff0040',accent:'#ff6b9d',bg:'#0c0204',card:'#1a0709',text:'#ffb8c8'},
  bw:   {primary:'#ffffff',accent:'#cccccc',bg:'#050505',card:'#111111',text:'#dddddd'},
  blue: {primary:'#00b4ff',accent:'#00ffe7',bg:'#020a12',card:'#071220',text:'#b8e8ff'},
  purple:{primary:'#b04aff',accent:'#e040fb',bg:'#08020f',card:'#140722',text:'#ddb8ff'},
};

function bindModalEvents(){
  $('btnTheme').addEventListener('click',()=>$('themeModal').classList.remove('hidden'));
  $('themeModalClose').addEventListener('click',()=>$('themeModal').classList.add('hidden'));
  $('themeModal').addEventListener('click',e=>{if(e.target===$('themeModal'))$('themeModal').classList.add('hidden');});
  document.querySelectorAll('.preset-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const p=PRESETS[btn.dataset.preset];
      if(!p) return;
      $('cpPrimary').value=p.primary; $('cpAccent').value=p.accent;
      $('cpBg').value=p.bg; $('cpCard').value=p.card; $('cpText').value=p.text;
    });
  });
  $('btnApplyTheme').addEventListener('click',async()=>{
    const t={primary:$('cpPrimary').value,accent:$('cpAccent').value,bg:$('cpBg').value,card:$('cpCard').value,text:$('cpText').value};
    await chrome.storage.local.set({bh_theme:t});
    applyThemeVars(t);
    $('themeModal').classList.add('hidden');
    toast('Theme applied ✓');
  });

  // Approach modal
  $('approachClose').addEventListener('click',()=>$('approachModal').classList.add('hidden'));
  $('approachModal').addEventListener('click',e=>{if(e.target===$('approachModal'))$('approachModal').classList.add('hidden');});
  $('btnApproachSend').addEventListener('click',sendApproach);
  $('btnApproachCopy').addEventListener('click',()=>{navigator.clipboard.writeText($('approachBody').value);toast('Copied ✓');});
  $('btnApproachLoad').addEventListener('click',loadTpl);
  $('btnApproachSave').addEventListener('click',saveTpl);
}

// ---- AUTO TOGGLE ----
function initAutoToggle(){
  chrome.storage.local.get('bh_auto').then(r=>{$('autoToggle').checked=r.bh_auto===true;});
  $('autoToggle').addEventListener('change',async()=>{
    await chrome.storage.local.set({bh_auto:$('autoToggle').checked});
    toast($('autoToggle').checked?'Auto crawl ON':'Auto crawl OFF');
  });
}

// ---- MODE SELECT ----
function initModeSelect(){
  chrome.storage.local.get(['bh_last_mode','bh_max_pages']).then(r=>{
    if(r.bh_last_mode) $('modeSelect').value=r.bh_last_mode;
    if(r.bh_max_pages) $('maxPages').value=r.bh_max_pages;
    togglePageCtrl($('modeSelect').value);
  });
  $('modeSelect').addEventListener('change',async()=>{
    const m=$('modeSelect').value;
    await chrome.storage.local.set({bh_last_mode:m});
    togglePageCtrl(m);
  });
  $('maxPages').addEventListener('change',()=>chrome.storage.local.set({bh_max_pages:$('maxPages').value}));
}
function togglePageCtrl(mode){$('pageCtrl').style.display=mode==='google-multi'?'flex':'none';}

function initScanMode(){
  chrome.storage.local.get('bh_scan_mode').then(r=>{
    scanMode=r.bh_scan_mode||'domain';
    document.querySelectorAll('.depth-btn').forEach(b=>b.classList.toggle('active',b.dataset.mode===scanMode));
  });
  document.querySelectorAll('.depth-btn').forEach(btn=>{
    btn.addEventListener('click',async()=>{
      scanMode=btn.dataset.mode;
      document.querySelectorAll('.depth-btn').forEach(b=>b.classList.toggle('active',b.dataset.mode===scanMode));
      await chrome.storage.local.set({bh_scan_mode:scanMode});
      await chrome.runtime.sendMessage({type:'SET_SCAN_MODE',mode:scanMode});
    });
  });
}

function updateStats(qLen){
  $('sTotal').textContent=stats.total||0;
  $('sDomains').textContent=stats.domains||0;
  $('sHV').textContent=stats.highValue||0;
  $('sPaid').textContent=stats.paid||0;
  $('sQueue').textContent=qLen||0;
  const has=allEmails.length>0;
  $('btnCSV').disabled=$('btnCopyAll').disabled=$('btnClear').disabled=!has;
}

// ---- PROGRESS ----
function showProgressWrap(){$('progressWrap').classList.remove('hidden');}
function hideProgressWrap(){$('progressWrap').classList.add('hidden');}
function updateProgress(d){
  showProgressWrap();
  $('progText').textContent=`Scraping... ${d.done||0}/${d.total||0}`;
  const pct=d.total>0?Math.round(d.done/d.total*100):0;
  $('progFill').style.width=pct+'%';
  $('pdDomain').textContent=d.currentDomain||'-';
  $('pdDone').textContent=`${d.done||0} done`;
  $('pdLeft').textContent=`${d.remaining||0} left`;
  $('pdFound').textContent=`${d.emailsFound||0} found`;
  if(d.etaSeconds>0){const m=Math.floor(d.etaSeconds/60),s=d.etaSeconds%60;$('progETA').textContent=`ETA:${m}m${s}s`;}
}
async function checkScrapingState(){
  const r=await chrome.runtime.sendMessage({type:'GET_SCRAPING_STATE'});
  if(r&&(r.active||r.queueLen>0)){showProgressWrap();$('btnStart').disabled=true;$('btnStart').textContent='🔄 SCRAPING...';}
}
function onDone(){
  hideProgressWrap();
  $('btnStart').disabled=false;$('btnStart').textContent='▶ START';
  loadData().then(()=>applyFilters());
  toast('Scraping complete ✓');
}

// ---- SEARCH EVENTS ----
function bindSearchEvents(){
  $('btnStart').addEventListener('click',execute);
  $('filterInput').addEventListener('input',applyFilters);
  $('fHV').addEventListener('click',()=>{filterHV=!filterHV;$('fHV').dataset.active=filterHV;applyFilters();});
  $('fPaid').addEventListener('click',()=>{filterPaid=!filterPaid;$('fPaid').dataset.active=filterPaid;applyFilters();});
  $('fSort').addEventListener('click',()=>{
    const fields=['email','domain','date'];
    const idx=fields.indexOf(sortField);
    sortField=fields[(idx+1)%fields.length];
    $('fSort').textContent={'email':'⇅ AZ','domain':'⇅ DOM','date':'⇅ DATE'}[sortField];
    applyFilters();
  });
  $('btnCSV').addEventListener('click',exportCSV);
  $('btnCopyAll').addEventListener('click',copyAll);
  $('btnClear').addEventListener('click',clearAll);
  $('btnResetVisited').addEventListener('click',async()=>{await chrome.runtime.sendMessage({type:'RESET_VISITED'});toast('Visited reset ✓');});
  $('btnPause').addEventListener('click',async()=>{await chrome.runtime.sendMessage({type:'PAUSE_SCRAPING'});$('btnPause').classList.add('hidden');$('btnResume').classList.remove('hidden');});
  $('btnResume').addEventListener('click',async()=>{await chrome.runtime.sendMessage({type:'RESUME_SCRAPING'});$('btnResume').classList.add('hidden');$('btnPause').classList.remove('hidden');});
  $('btnStop').addEventListener('click',async()=>{await chrome.runtime.sendMessage({type:'STOP_SCRAPING'});hideProgressWrap();$('btnStart').disabled=false;$('btnStart').textContent='▶ START';toast('Stopped');});
}

async function execute(){
  const mode=$('modeSelect').value;
  $('btnStart').disabled=true;$('btnStart').textContent='⏳...';
  try{
    if(mode==='current') await doCurrentPage();
    else if(mode==='google-multi') await doGoogleMulti();
    else if(mode==='alltabs') await doAllTabs();
  }catch(e){toast('Error: '+e.message,true);$('btnStart').disabled=false;$('btnStart').textContent='▶ START';}
}

async function doCurrentPage(){
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab?.url?.startsWith('http')){toast('Open a webpage first!',true);$('btnStart').disabled=false;$('btnStart').textContent='▶ START';return;}
  try{
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['js/content-page.js']});
    await new Promise(r=>setTimeout(r,300));
    const res=await chrome.tabs.sendMessage(tab.id,{type:'EXTRACT_NOW'});
    toast(res?.count>0?`Found ${res.count} emails ✓`:'No emails found');
  }catch(e){
    try{
      const results=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{
        const RE=/[a-zA-Z0-9!#$%&'*+\/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+\/=?^_`{|}~-]+)*@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}/g;
        const found=new Set();let m;
        document.querySelectorAll('a[href]').forEach(a=>{const h=a.getAttribute('href')||'';if(h.includes('mailto:')){try{found.add(decodeURIComponent(h.replace(/^.*mailto:/i,'').split('?')[0]).toLowerCase());}catch(x){}}});
        const txt=(document.body?.innerText||'').replace(/\[at\]/gi,'@');
        while((m=RE.exec(txt))!==null) found.add(m[0].toLowerCase().trim());
        return{emails:[...found].filter(e=>e.length>5&&e.includes('@')&&e.includes('.')),url:location.href,title:document.title};
      }});
      if(results?.[0]?.result){
        const{emails,url,title}=results[0].result;
        if(emails.length){await chrome.runtime.sendMessage({type:'EXTRACT_EMAILS',emails,url,title,mode:'current',searchPage:0,html:''});toast(`Found ${emails.length} emails ✓`);}
        else toast('No emails found');
      }
    }catch(e2){toast('Cannot scan this page',true);}
  }
  $('btnStart').disabled=false;$('btnStart').textContent='▶ START';
  await loadData();applyFilters();
}

async function doAllTabs(){
  const tabs=await chrome.tabs.query({});let n=0;
  for(const t of tabs){if(!t.url?.startsWith('http')) continue;try{await chrome.tabs.sendMessage(t.id,{type:'EXTRACT_NOW'});n++;}catch(e){}}
  toast(`Scanned ${n} tabs ✓`);$('btnStart').disabled=false;$('btnStart').textContent='▶ START';
}

async function doGoogleMulti(){
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab?.url?.includes('google.')||!tab.url.includes('/search')){
    toast('Open a Google search page first!',true);$('btnStart').disabled=false;$('btnStart').textContent='▶ START';return;
  }
  const maxPages=parseInt($('maxPages').value)||5;
  toast(`Starting ${maxPages}-page AI scrape...`);
  $('btnStart').textContent='🔄 SCRAPING...';
  showProgressWrap();
  try{
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['js/content-serp.js']});
    await new Promise(r=>setTimeout(r,200));
    await chrome.tabs.sendMessage(tab.id,{type:'START_MULTIPAGE',maxPages,scanMode});
  }catch(e){toast('Error: '+e.message,true);$('btnStart').disabled=false;$('btnStart').textContent='▶ START';}
}

// ---- FILTERS ----
function applyFilters(){
  const q=$('filterInput').value.toLowerCase().trim();
  filteredEmails=allEmails.filter(e=>{
    const txt=!q||e.email.includes(q)||e.url.toLowerCase().includes(q);
    const hv=!filterHV||e.isHighValue;
    const paid=!filterPaid||e.isPaid;
    return txt&&hv&&paid;
  });
  filteredEmails.sort((a,b)=>{
    let va,vb;
    if(sortField==='email'){va=a.email;vb=b.email;}
    else if(sortField==='domain'){va=a.email.split('@')[1]||'';vb=b.email.split('@')[1]||'';}
    else{va=a.timestamp||'';vb=b.timestamp||'';}
    return sortAsc?va.localeCompare(vb):vb.localeCompare(va);
  });
  renderEmails();
}

function renderEmails(){
  const list=$('emailList');list.innerHTML='';
  if(!filteredEmails.length){
    list.innerHTML=`<div class="empty-state"><div class="ei-icon">◎</div><div>No emails yet. Select mode and press START.</div></div>`;return;
  }
  const frag=document.createDocumentFragment();
  filteredEmails.forEach(e=>frag.appendChild(makeCard(e)));
  list.appendChild(frag);
}

function makeCard(e){
  const card=document.createElement('div');
  card.className=`email-card${e.isHighValue?' hv':''}${e.isPaid&&!e.isHighValue?' paid':''}`;
  const domain=e.email.split('@')[1]||'';
  const hvB=e.isHighValue?`<div class="e-badge hv-b">⭐ BUG BOUNTY</div>`:'';
  const paidB=e.isPaid?`<div class="e-badge paid-b">💰 PAID</div>`:'';
  const pgTag=e.searchPage?`<span class="e-pg">PG${e.searchPage}</span>`:'';
  card.innerHTML=`${hvB}${paidB}
    <div class="e-row">
      <div class="e-addr">${esc(e.email)}</div>
      <div class="e-dom">${esc(domain)}</div>
    </div>
    <div class="e-url">${pgTag}${esc(e.url)}</div>
    <div class="e-acts">
      <button class="ea copy">⎘ COPY</button>
      <button class="ea visit">🔗 VISIT</button>
      <button class="ea approach">⚡ APPROACH</button>
      <button class="ea block">🚫 BLOCK</button>
      <button class="ea remove">✕</button>
    </div>`;
  card.querySelector('.copy').onclick=()=>{navigator.clipboard.writeText(e.email);toast('Copied ✓');};
  card.querySelector('.visit').onclick=()=>chrome.tabs.create({url:e.url});
  card.querySelector('.approach').onclick=()=>openApproach(e.email,e.url);
  card.querySelector('.block').onclick=async()=>{
    let domain='';try{domain=new URL(e.url).hostname.replace(/^www\./,'');}catch(x){}
    if(domain){await chrome.runtime.sendMessage({type:'ADD_TO_BLACKLIST',domain});await loadData();applyFilters();toast(`Blocked: ${domain}`);}
  };
  card.querySelector('.remove').onclick=async()=>{
    await chrome.runtime.sendMessage({type:'REMOVE_EMAIL',email:e.email});
    await loadData();applyFilters();toast('Removed');
  };
  return card;
}

function exportCSV(){
  const seen=new Set();
  const unique=allEmails.filter(e=>{if(seen.has(e.email))return false;seen.add(e.email);return true;});
  const rows=[['Email','Domain','URL','Page','HighValue','Paid','Policy','Timestamp']];
  unique.forEach(e=>rows.push([`"${e.email}"`,`"${e.email.split('@')[1]}"`,`"${e.url}"`,`"${e.searchPage||0}"`,`"${e.isHighValue?'YES':'NO'}"`,`"${e.isPaid?'YES':'NO'}"`,`"${e.isPolicy?'YES':'NO'}"`,`"${e.timestamp||''}"`]));
  const a=Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob(['\uFEFF'+rows.map(r=>r.join(',')).join('\n')],{type:'text/csv'})),download:`bounty-${Date.now()}.csv`});
  a.click();toast(`Exported ${unique.length} unique emails ✓`);
}
function copyAll(){navigator.clipboard.writeText(filteredEmails.map(e=>e.email).join('\n'));toast(`Copied ${filteredEmails.length} ✓`);}
async function clearAll(){if(!confirm('Clear ALL emails?'))return;await chrome.runtime.sendMessage({type:'CLEAR_DATA'});allEmails=[];stats={total:0,domains:0,highValue:0,pages:0,paid:0};updateStats(0);applyFilters();toast('Cleared');}

// ---- APPROACH ----
async function openApproach(email,url){
  currentApproachEmail=email;
  $('approachEmail').textContent=email;
  const r=await chrome.runtime.sendMessage({type:'GET_TEMPLATE'});
  const domain=url.match(/https?:\/\/([^/]+)/)?.[1]||url;
  if(!$('approachSubject').value) $('approachSubject').value=`Security Vulnerability Disclosure Inquiry — ${domain}`;
  $('approachBody').value=r.template||defaultTpl(email,domain);
  $('approachModal').classList.remove('hidden');
}
function defaultTpl(email,domain){
  return `Dear Security Team at ${domain},

My name is [Your Name], and I am an independent security researcher writing to inquire whether your organization currently operates a Bug Bounty or Vulnerability Disclosure Program (VDP).

I have a genuine interest in contributing to the security of ${domain} and its users by identifying and responsibly disclosing any potential vulnerabilities I may discover.

I would appreciate clarification on:

1. Do you have a formal Bug Bounty or VDP in place?
2. What is the scope of your program (in-scope assets, domains, APIs)?
3. What is your preferred method for receiving vulnerability reports?
4. Do you offer any form of recognition or monetary reward for valid findings?

I am committed to responsible disclosure and will not publicly disclose any vulnerabilities without your explicit consent.

Thank you for your time and consideration.

Best regards,
[Your Full Name]
[Your Email / LinkedIn]`;
}
function sendApproach(){
  if(!currentApproachEmail) return;
  const sub=$('approachSubject').value||'Bug Bounty Inquiry';
  const body=$('approachBody').value;
  chrome.tabs.create({url:`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(currentApproachEmail)}&su=${encodeURIComponent(sub)}&body=${encodeURIComponent(body)}`});
  $('approachModal').classList.add('hidden');toast('Opening Gmail ✓');
}
async function loadTpl(){const r=await chrome.runtime.sendMessage({type:'GET_TEMPLATE'});if(r.template){$('approachBody').value=r.template;toast('Loaded ✓');}else toast('No saved template',true);}
async function saveTpl(){const t=$('approachBody').value.trim();if(!t){toast('Empty!',true);return;}await chrome.runtime.sendMessage({type:'SAVE_TEMPLATE',template:t});toast('Saved ✓');}

// ---- DORKS ----
function populateYears(){
  const sel=$('dbYear');if(!sel)return;
  const cy=new Date().getFullYear();
  let opts='<option value="">Any</option>';
  for(let y=cy;y>=cy-6;y--) opts+=`<option value="${y}">${y}</option>`;
  sel.innerHTML=opts;
}

function buildSmartDork(){
  const parts=[];
  const site=$('dbSite').value.trim();
  const inurl=$('dbInurl').value.trim();
  const intext=$('dbIntext').value.trim();
  const filetype=$('dbFiletype').value;
  const exclude=$('dbExclude').value.trim();
  const year=$('dbYear').value;
  const currency=$('dbCurrency').value;
  const country=$('dbCountry').value;
  const orTerms=$('dbOr').value.trim();

  if(site) parts.push(`site:${site}`);
  if(inurl) parts.push(`inurl:${inurl}`);
  if(intext) parts.push(`intext:"${intext}"`);
  if(filetype) parts.push(`filetype:${filetype}`);
  if(country) parts.push(country);
  if(orTerms){
    const ors=orTerms.split('|').map(s=>s.trim()).filter(Boolean);
    if(ors.length>1) parts.push(`(${ors.join(' OR ')})`);
    else if(ors.length===1) parts.push(`"${ors[0]}"`);
  }
  if(currency) parts.push(`"${currency}"`);
  if(year) parts.push(`"${year}"`);
  if(exclude) parts.push(exclude.startsWith('-')?exclude:`-${exclude}`);

  return parts.length>0?parts.join(' '):'// Fill in at least one field above...';
}

function updateDorkPreview(){
  const preview=$('dbPreview');if(!preview)return;
  const d=buildSmartDork();
  preview.textContent=d;
}

function bindDorkEvents(){
  ['dbSite','dbInurl','dbIntext','dbFiletype','dbExclude','dbYear','dbCurrency','dbCountry','dbOr'].forEach(id=>{
    const el=$(id);if(el) el.addEventListener('input',updateDorkPreview);if(el&&el.tagName==='SELECT') el.addEventListener('change',updateDorkPreview);
  });
  $('btnDbSearch').onclick=()=>{const d=buildSmartDork();if(d.startsWith('//')){toast('Add at least one field!',true);return;}chrome.tabs.create({url:`https://www.google.com/search?q=${encodeURIComponent(d)}&tbs=qdr:m3`});toast('Launched ✓');};
  $('btnDbSave').onclick=async()=>{const d=buildSmartDork();if(d.startsWith('//')){toast('Nothing to save',true);return;}const cat=$('dbSaveCat')?.value;if(!cat){toast('No category',true);return;}await addDork(cat,d);toast('Saved ✓');};
  $('btnAddCat').onclick=async()=>{
    const v=$('newCatInput').value.trim();if(!v)return;
    const r=await chrome.storage.local.get('bh_custom_cats');
    const cats=[...(r.bh_custom_cats||[])];
    if(!cats.includes(v)){cats.push(v);await chrome.storage.local.set({bh_custom_cats:cats});}
    $('newCatInput').value='';loadDorkUI();toast(`Category "${v}" added ✓`);
  };
  $('btnAddDork').onclick=()=>{const v=$('dorkInput').value.trim();if(v){addDork($('dorkCatSelect').value,v);$('dorkInput').value='';}};
  $('dorkInput').addEventListener('keydown',e=>{if(e.key==='Enter'){const v=e.target.value.trim();if(v){addDork($('dorkCatSelect').value,v);e.target.value='';}}});
  $('btnClearCustom').onclick=async()=>{if(!confirm('Clear all custom dorks?'))return;await chrome.storage.local.set({bh_custom_dorks:{}});loadDorkUI();toast('Cleared');};
  $('btnLaunchAll').onclick=launchAllDorks;
  $('dorkCatFilter').addEventListener('change',renderDorkSections);
}

async function loadDorkUI(){
  const r=await chrome.storage.local.get('bh_custom_cats');
  const customCats=r.bh_custom_cats||[];
  const allCats=[...Object.keys(DORK_CATEGORIES),...customCats];

  [$('dorkCatSelect'),$('dorkCatFilter'),$('dbSaveCat')].forEach(sel=>{
    if(!sel) return;
    const isFilter=sel.id==='dorkCatFilter';
    sel.innerHTML=(isFilter?'<option value="all">All Categories</option>':'')+allCats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  });
  renderDorkSections();
}

async function renderDorkSections(){
  const filter=$('dorkCatFilter').value;
  const r=await chrome.storage.local.get(['bh_custom_dorks','bh_custom_cats']);
  const custom=r.bh_custom_dorks||{};
  const customCats=r.bh_custom_cats||[];
  const allCats=[...Object.keys(DORK_CATEGORIES),...customCats];
  const cats=filter==='all'?allCats:[filter];
  const container=$('dorkSections');container.innerHTML='';

  cats.forEach(cat=>{
    const builtIn=DORK_CATEGORIES[cat]||[];
    const cust=custom[cat]||[];
    const all=[...builtIn,...cust];
    const sec=document.createElement('div');sec.className='dork-cat-section';
    sec.innerHTML=`<div class="dcat-hdr"><span class="dcat-title">${esc(cat)}</span><span class="dcat-cnt">${all.length}</span></div>`;
    const chips=document.createElement('div');chips.className='dork-chips';
    all.forEach((d,i)=>{
      const chip=document.createElement('div');
      const isC=i>=builtIn.length;
      chip.className=`d-chip${isC?' custom':''}`;
      chip.title=d;
      chip.innerHTML=`<span>${esc(d.length>60?d.slice(0,60)+'…':d)}</span>${isC?`<span class="chip-x" data-cat="${esc(cat)}" data-dork="${esc(d)}">×</span>`:''}`;
      chip.querySelector('span:first-child').onclick=()=>chrome.tabs.create({url:`https://www.google.com/search?q=${encodeURIComponent(d)}&tbs=qdr:m3`});
      if(isC){chip.querySelector('.chip-x').onclick=async(e)=>{e.stopPropagation();await removeDork(cat,d);renderDorkSections();};}
      chips.appendChild(chip);
    });
    sec.appendChild(chips);container.appendChild(sec);
  });
}

async function addDork(cat,dork){
  const r=await chrome.storage.local.get('bh_custom_dorks');
  const custom=r.bh_custom_dorks||{};
  if(!custom[cat]) custom[cat]=[];
  if(!custom[cat].includes(dork)&&!DORK_CATEGORIES[cat]?.includes(dork)){custom[cat].push(dork);await chrome.storage.local.set({bh_custom_dorks:custom});renderDorkSections();toast('Added ✓');}
}
async function removeDork(cat,dork){
  const r=await chrome.storage.local.get('bh_custom_dorks');
  const custom=r.bh_custom_dorks||{};
  if(custom[cat]) custom[cat]=custom[cat].filter(d=>d!==dork);
  await chrome.storage.local.set({bh_custom_dorks:custom});
}
async function launchAllDorks(){
  const filter=$('dorkCatFilter').value;
  const r=await chrome.storage.local.get(['bh_custom_dorks','bh_custom_cats']);
  const custom=r.bh_custom_dorks||{};
  const customCats=r.bh_custom_cats||[];
  const allCats=[...Object.keys(DORK_CATEGORIES),...customCats];
  const cats=filter==='all'?allCats:[filter];
  let all=[];
  cats.forEach(c=>{all=[...all,...(DORK_CATEGORIES[c]||[]),...(custom[c]||[])];});
  if(!all.length){toast('No dorks!',true);return;}
  all.forEach((d,i)=>setTimeout(()=>chrome.tabs.create({url:`https://www.google.com/search?q=${encodeURIComponent(d)}&tbs=qdr:m3`,active:i===0}),i*400));
  toast(`Launched ${all.length} dorks ✓`);
}

// ---- BLACKLIST ----
const SOCIAL_CUSTOM_KEY='bh_social_custom';
const PLATFORM_CUSTOM_KEY='bh_platform_custom';

function bindBlacklistEvents(){
  $('blMyEmail').addEventListener('change',async()=>{await chrome.runtime.sendMessage({type:'SET_BLACKLIST_TOGGLE',key:'userEmail',value:$('blMyEmail').checked});toast($('blMyEmail').checked?'Personal email filter ON':'OFF');});
  $('blSocial').addEventListener('change',async()=>{await chrome.runtime.sendMessage({type:'SET_BLACKLIST_TOGGLE',key:'social',value:$('blSocial').checked});toast($('blSocial').checked?'Social media filter ON':'OFF');});
  $('blPlatforms').addEventListener('change',async()=>{await chrome.runtime.sendMessage({type:'SET_BLACKLIST_TOGGLE',key:'platforms',value:$('blPlatforms').checked});toast($('blPlatforms').checked?'Open platforms blocked':'Platforms unblocked');});

  $('btnAddPersonalEmail').onclick=async()=>{
    const v=$('personalEmailInput').value.trim().toLowerCase();
    if(!v||!v.includes('@')){toast('Invalid email',true);return;}
    const r=await chrome.runtime.sendMessage({type:'GET_USER_EMAILS'});
    const arr=(r?.emails||[]).filter(e=>e!==v);
    arr.push(v);
    await chrome.runtime.sendMessage({type:'SET_USER_EMAILS',emails:arr});
    $('personalEmailInput').value='';
    loadBlacklistUI();toast(`Added: ${v}`);
  };

  $('btnAddSocialCustom').onclick=async()=>{
    const v=$('socialCustomInput').value.trim().toLowerCase().replace(/^www\./,'');
    if(!v){return;}
    await addToCustomList(SOCIAL_CUSTOM_KEY,v);
    await chrome.runtime.sendMessage({type:'ADD_TO_BLACKLIST',domain:v});
    $('socialCustomInput').value='';
    loadBlacklistUI();toast(`Added to social: ${v}`);
  };

  $('btnAddPlatformCustom').onclick=async()=>{
    const v=$('platformCustomInput').value.trim().toLowerCase().replace(/^www\./,'');
    if(!v){return;}
    await addToCustomList(PLATFORM_CUSTOM_KEY,v);
    await chrome.runtime.sendMessage({type:'ADD_TO_BLACKLIST',domain:v});
    $('platformCustomInput').value='';
    loadBlacklistUI();toast(`Added to platforms: ${v}`);
  };

  $('btnAddCustomBL').onclick=addCustomBL;
  $('blCustomInput').addEventListener('keydown',e=>{if(e.key==='Enter')addCustomBL();});
  $('btnClearBL').onclick=async()=>{if(!confirm('Clear blacklist?'))return;await chrome.runtime.sendMessage({type:'CLEAR_BLACKLIST'});loadBlacklistUI();toast('Cleared');};
  $('btnExportBL').onclick=exportBL;
  $('blSearch').addEventListener('input',()=>loadBlacklistUI($('blSearch').value.toLowerCase()));
}

async function addToCustomList(key,val){
  const r=await chrome.storage.local.get(key);
  const arr=r[key]||[];
  if(!arr.includes(val)){arr.push(val);await chrome.storage.local.set({[key]:arr});}
}

async function loadBlacklistUI(query=''){
  const r=await chrome.runtime.sendMessage({type:'GET_BLACKLIST'});
  const userEmails=await chrome.runtime.sendMessage({type:'GET_USER_EMAILS'});
  const sc=await chrome.storage.local.get([SOCIAL_CUSTOM_KEY,PLATFORM_CUSTOM_KEY]);

  $('blMyEmail').checked=r.userEmail!==false;
  $('blSocial').checked=r.social===true;
  $('blPlatforms').checked=r.platforms!==false;

  // Render personal emails
  const peList=$('personalEmailsList');peList.innerHTML='';
  (userEmails?.emails||[]).forEach(em=>{
    const tag=document.createElement('div');tag.className='pe-tag';
    tag.innerHTML=`<span>${esc(em)}</span><button title="Remove">×</button>`;
    tag.querySelector('button').onclick=async()=>{
      const arr=(userEmails.emails||[]).filter(e=>e!==em);
      await chrome.runtime.sendMessage({type:'SET_USER_EMAILS',emails:arr});
      loadBlacklistUI(query);
    };
    peList.appendChild(tag);
  });

  // Social custom hint
  const sc_custom=(sc[SOCIAL_CUSTOM_KEY]||[]).join(', ');
  const pl_custom=(sc[PLATFORM_CUSTOM_KEY]||[]).join(', ');
  if(sc_custom) $('blSocial').closest('.bl-toggle').nextElementSibling.textContent='Facebook · Instagram · LinkedIn · Medium · X/Twitter · VK · TikTok · YouTube · Pinterest · Snapchat · Reddit · Tumblr'+(sc_custom?` · ${sc_custom}`:'');
  if(pl_custom) $('blPlatforms').closest('.bl-toggle').nextElementSibling.textContent='hackerone.com · bugcrowd.com · intigriti.com · yeswehack.com · synack.com · cobalt.io · openbugbounty.org'+(pl_custom?` · ${pl_custom}`:'');

  // Render blacklist
  const list=$('blList');list.innerHTML='';
  const items=[...(r.domains||[]).map(d=>({val:d,type:'DOMAIN'})),...(r.emails||[]).map(e=>({val:e,type:'EMAIL'}))];
  const filtered=query?items.filter(i=>i.val.includes(query)):items;
  if(!filtered.length){list.innerHTML='<div style="color:var(--c-dim);font-size:10px;padding:8px 0">// Blacklist empty</div>';return;}
  filtered.forEach(({val,type})=>{
    const item=document.createElement('div');item.className='bl-item';
    item.innerHTML=`<span>${esc(val)}</span><span class="bl-type">${type}</span><button class="bl-del">✕</button>`;
    item.querySelector('.bl-del').onclick=async()=>{
      const p=type==='DOMAIN'?{domain:val}:{email:val};
      await chrome.runtime.sendMessage({type:'REMOVE_FROM_BLACKLIST',...p});
      loadBlacklistUI(query);
    };
    list.appendChild(item);
  });
}

async function addCustomBL(){
  const val=$('blCustomInput').value.trim().toLowerCase();if(!val)return;
  const p=val.includes('@')?{email:val}:{domain:val.replace(/^www\./,'')};
  await chrome.runtime.sendMessage({type:'ADD_TO_BLACKLIST',...p});
  $('blCustomInput').value='';await loadBlacklistUI();toast(`Blacklisted: ${val}`);
}

async function exportBL(){
  const r=await chrome.runtime.sendMessage({type:'GET_BLACKLIST'});
  const lines=[...(r.domains||[]).map(d=>`domain:${d}`),...(r.emails||[]).map(e=>`email:${e}`)];
  const a=Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/plain'})),download:`blacklist-${Date.now()}.txt`});
  a.click();toast(`Exported ${lines.length} items ✓`);
}

// ---- OUTREACH / BULK SEND ----
let bulkSendTimer=null, bulkSendIndex=0, bulkTargets=[];

function bindOutreachEvents(){
  $('btnStartBulk').addEventListener('click',startBulkSend);
  $('btnLoadTpl').addEventListener('click',async()=>{const r=await chrome.runtime.sendMessage({type:'GET_TEMPLATE'});if(r.template){$('tplBody').value=r.template;toast('Loaded ✓');}else toast('No saved template',true);});
  $('btnSaveTpl').addEventListener('click',async()=>{const t=$('tplBody').value.trim();if(!t){toast('Empty!',true);return;}await chrome.runtime.sendMessage({type:'SAVE_TEMPLATE',template:t});toast('Saved ✓');});
}

async function startBulkSend(){
  const raw=$('bulkEmailTarget').value.trim();
  if(!raw){toast('No target emails!',true);return;}
  const subject=$('tplSubject').value.trim()||'Bug Bounty / VDP Inquiry';
  const body=$('tplBody').value.trim();
  if(!body){toast('Email body is empty!',true);return;}

  // Parse emails
  bulkTargets=raw.split(/[\n,;]+/).map(e=>e.trim().toLowerCase()).filter(e=>e.includes('@'));
  if(!bulkTargets.length){toast('No valid emails found!',true);return;}

  const delay=Math.max(5,parseInt($('sendDelay').value)||30)*1000;
  bulkSendIndex=0;
  $('btnStartBulk').disabled=true;
  $('btnStartBulk').textContent='⏳ SENDING...';

  const status=$('bulkStatus');status.classList.remove('hidden');

  function sendNext(){
    if(bulkSendIndex>=bulkTargets.length){
      status.textContent=`Done! Sent to ${bulkTargets.length} emails.`;
      $('btnStartBulk').disabled=false;$('btnStartBulk').textContent='⚡ START BULK SEND';
      bulkSendTimer=null;return;
    }
    const email=bulkTargets[bulkSendIndex];
    status.textContent=`Sending ${bulkSendIndex+1}/${bulkTargets.length}: ${email}`;
    chrome.tabs.create({
      url:`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
      active:false
    });
    bulkSendIndex++;
    if(bulkSendIndex<bulkTargets.length){
      const remaining=bulkTargets.length-bulkSendIndex;
      status.textContent+=`\nNext in ${Math.round(delay/1000)}s... (${remaining} remaining)`;
      bulkSendTimer=setTimeout(sendNext,delay);
    }else{
      status.textContent=`Done! Sent to ${bulkTargets.length} emails.`;
      $('btnStartBulk').disabled=false;$('btnStartBulk').textContent='⚡ START BULK SEND';
    }
  }
  sendNext();
}

// ---- NOTIF BUBBLE ----
function showNotif(n){
  $('nbCount').textContent=`+${n}`;
  $('notifBubble').classList.remove('hidden');
  clearTimeout($('notifBubble')._t);
  $('notifBubble')._t=setTimeout(()=>$('notifBubble').classList.add('hidden'),4000);
}

// ---- UTILS ----
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function toast(msg,isErr=false){
  let el=$('_bh_toast');
  if(!el){el=document.createElement('div');el.id='_bh_toast';Object.assign(el.style,{position:'fixed',bottom:'16px',left:'50%',transform:'translateX(-50%)',background:'var(--c-bg2)',border:'1px solid',fontFamily:'var(--disp)',fontSize:'10px',fontWeight:'700',letterSpacing:'1px',padding:'8px 18px',borderRadius:'4px',zIndex:'99999',whiteSpace:'nowrap',opacity:'0',transition:'opacity .2s',pointerEvents:'none'});document.body.appendChild(el);}
  el.textContent=msg;
  el.style.borderColor=isErr?'var(--c-red)':'var(--c-primary)';
  el.style.color=isErr?'var(--c-red)':'var(--c-primary)';
  el.style.opacity='1';
  clearTimeout(el._t);el._t=setTimeout(()=>el.style.opacity='0',2500);
}
