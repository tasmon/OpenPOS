// App wiring: SPA behavior with auth-first gating, themes, i18n basics, PWA prompt
(async function(){ await OpenPOSDB.openDB();
// If running from the local file system, attempt to import AppData.json in the same folder so the app works out-of-the-box when opened from file://
if(location.protocol === 'file:'){
  try{
    const resp = await fetch('AppData.json');
    if(resp && resp.ok){
      const txt = await resp.text();
      try{ await OpenPOSDB.importDB(txt); console.log('AppData.json loaded into IndexedDB'); }catch(e){ console.warn('Failed to import AppData.json:', e); }
    }
  }catch(e){ console.warn('No AppData.json found or cannot fetch (this is OK):', e); }
}
const pages = document.querySelectorAll('.page'); function showById(id){ pages.forEach(p=>p.style.display = p.id===id ? 'block' : 'none'); }
const nav = document.getElementById('main-nav'); const loginBtn = document.getElementById('login-btn'); const currentUserSpan = document.getElementById('current-user'); const userAreaEl = document.getElementById('user-area');

// Utility to format currency according to setting
async function formatMoney(value){ const curr = await OpenPOSDB.getSetting('currency') || 'USD'; const lang = await OpenPOSDB.getSetting('language') || navigator.language || 'en-US'; try{ const nf = new Intl.NumberFormat(lang, {style:'currency', currency: curr}); return nf.format(Number(value)); }catch(e){ // fallback
    const map = {USD:'$',EUR:'â‚¬',BDT:'à§³'}; const sym = map[curr]||curr; return sym + parseFloat(value).toFixed(2); } }

// Initial UI state: show welcome. After Start -> check users count
document.getElementById('start-setup').addEventListener('click', async ()=>{ const users = await OpenPOSDB.getAll('users'); if(!users || users.length===0){ // go to create account
    showById('create-account'); document.getElementById('auth-gate').style.display='none'; } else { showById('auth-gate'); document.getElementById('auth-title').textContent='Login'; } });
document.getElementById('cancel-create').addEventListener('click', ()=>{ showById('welcome'); });

// make "Create account" button in login visible
const showCreateBtn = document.getElementById('show-create'); if(showCreateBtn){ showCreateBtn.addEventListener('click', ()=>{ showById('create-account'); }); }

// Login UI
const loginForm = document.getElementById('login-form'); loginForm.addEventListener('submit', async e=>{ e.preventDefault(); const f=new FormData(loginForm); try{ await OpenPOSAuth.login(f.get('username'),f.get('password')); await onLogin(); }catch(err){ alert('Login failed'); } });
// forgot password
document.getElementById('forgot-pw').addEventListener('click', async ()=>{
  const username = prompt('Enter username to reset'); if(!username) return; const user = await OpenPOSAuth.getUserByUsername(username); if(!user) return alert('User not found'); const answers = {};
  // ask QUESTIONS but user needs to provide answers; allow skipping but require at least two correct when verifying
  for(const qa of user.securityQA || []){ const a = prompt('Answer (leave blank to skip): '+qa.q); if(a) answers[qa.q]=a; }
  const ok = await OpenPOSAuth.verifySecurityAnswers(username,answers).catch(()=>false); if(!ok) return alert('Security answers did not match (need at least two correct)'); const np = prompt('Enter new password'); if(!np) return alert('Canceled'); await OpenPOSAuth.resetPassword(username,answers,np); alert('Password reset'); });

async function onLogin(){ const u = OpenPOSAuth.currentUser(); refreshAuth(); nav.classList.remove('hidden'); showById('page-pos'); await renderProducts(); await renderCustomers(); if(u && u.role === 'admin') await renderUsersList(); }
function refreshAuth(){ const u = OpenPOSAuth.currentUser(); const usersNavBtn = document.querySelector('#main-nav button[data-page="users"]'); if(u){ currentUserSpan.textContent = u.username; loginBtn.style.display='none'; if(userAreaEl) userAreaEl.style.display='flex'; // role-based nav visibility
    if(usersNavBtn) usersNavBtn.style.display = u.role === 'admin' ? 'inline-block' : 'none'; } else { currentUserSpan.textContent='â€”'; loginBtn.style.display='inline-block'; if(userAreaEl) userAreaEl.style.display='none'; nav.classList.add('hidden'); showById('welcome'); if(usersNavBtn) usersNavBtn.style.display='none'; } }
loginBtn.addEventListener('click', ()=>{ showById('auth-gate'); }); refreshAuth();

// Nav buttons
nav.querySelectorAll('button').forEach(b=>b.addEventListener('click', ()=>{ const page = 'page-'+b.dataset.page; showById(page); }));

// Products
const productForm = document.getElementById('product-form'); const productsList = document.getElementById('products-list');
async function renderProducts(){ const items = await OpenPOSDB.getAll('products'); productsList.innerHTML=''; for(const it of items){ const li=document.createElement('li'); li.textContent = `${it.name} ${it.category?'- '+it.category:''} â€” ${await formatMoney(it.price)}`; li.dataset.id=it.id; productsList.appendChild(li); } }
productForm.addEventListener('submit',async e=>{ e.preventDefault(); const f=new FormData(productForm); const name=f.get('name'); const code=f.get('code'); const category=f.get('category'); const price=parseFloat(f.get('price')||0); await OpenPOSDB.add('products',{name,code,category,price,createdAt:new Date().toISOString()}); productForm.reset(); renderProducts(); });

// Customers
const customerForm = document.getElementById('customer-form'); const customersList = document.getElementById('customers-list');
async function renderCustomers(){ const items = await OpenPOSDB.getAll('customers'); customersList.innerHTML=''; items.forEach(it=>{ const li=document.createElement('li'); li.textContent = `${it.name} ${it.phone?'- '+it.phone:''}`; li.dataset.id=it.id; customersList.appendChild(li); }); }
customerForm.addEventListener('submit',async e=>{ e.preventDefault(); const f=new FormData(customerForm); await OpenPOSDB.add('customers',{name:f.get('name'),phone:f.get('phone'),createdAt:new Date().toISOString()}); customerForm.reset(); renderCustomers(); });

// Users list (admin area)
const userForm = document.getElementById('user-form'); const usersList = document.getElementById('users-list'); async function renderUsersList(){ const items = await OpenPOSDB.getAll('users'); usersList.innerHTML=''; const cur = OpenPOSAuth.currentUser(); for(const it of items){ const li=document.createElement('li'); li.dataset.id = it.id; li.textContent = `${it.username} (${it.role})`; // admin controls
    if(cur && cur.role === 'admin'){ const editBtn = document.createElement('button'); editBtn.textContent='Edit'; editBtn.style.marginLeft='8px'; editBtn.addEventListener('click', async ()=>{ try{ const newRole = prompt('Set new role for '+it.username+' (admin/manager/cashier):', it.role); if(newRole && newRole !== it.role){ await OpenPOSAuth.updateUser(it.username,{role:newRole}); alert('Role updated'); }
          const doReset = confirm('Reset password for '+it.username+'?'); if(doReset){ const np = prompt('Enter new password for '+it.username); if(np){ await OpenPOSAuth.updateUser(it.username,{password:np}); alert('Password updated'); } }
          renderUsersList(); }catch(err){ alert('Update failed: '+(err.message||err)); } }); li.appendChild(editBtn);
      const delBtn = document.createElement('button'); delBtn.textContent='Delete'; delBtn.style.marginLeft='6px'; delBtn.addEventListener('click', async ()=>{ if(!confirm('Delete user '+it.username+'? This cannot be undone.')) return; try{ await OpenPOSAuth.deleteUser(it.username); alert('User deleted'); renderUsersList(); }catch(err){ alert('Delete failed: '+(err.message||err)); } }); li.appendChild(delBtn); }
    usersList.appendChild(li); } }
userForm.addEventListener('submit',async e=>{ e.preventDefault(); const f=new FormData(userForm); try{ await OpenPOSAuth.createUser(f.get('username'),f.get('password'),f.get('role'),[]); userForm.reset(); renderUsersList(); }catch(err){ alert('Create user failed: '+(err.message||err)); } });

// POS search & cart
const productSearch = document.getElementById('product-search'); const productResults = document.getElementById('product-results'); const cartList = document.getElementById('cart-list'); const cartTotal = document.getElementById('cart-total'); let cart = []; async function searchProducts(q){ const items = await OpenPOSDB.getAll('products'); return items.filter(i=> (i.name||'').toLowerCase().includes(q.toLowerCase()) || (i.code||'').toLowerCase().includes(q.toLowerCase())); }
productSearch.addEventListener('input', async ()=>{ const q=productSearch.value.trim(); productResults.innerHTML=''; if(!q) return; const results = await searchProducts(q); results.forEach(r=>{ const li = document.createElement('li'); li.textContent = `${r.name} â€” ${r.category||'--'} â€” ${r.price}`; li.addEventListener('click', ()=>{ addToCart(r); }); productResults.appendChild(li); }); });
function addToCart(item){ const copy = {id:item.id,name:item.name,price:item.price,qty:1}; cart.push(copy); renderCart(); }
async function renderCart(){ cartList.innerHTML=''; let total=0; for(const [idx,c] of cart.entries()){ total+=c.price*c.qty; const li=document.createElement('li'); li.textContent = `${c.name} x${c.qty} â€” ${await formatMoney(c.price)}`; const rm=document.createElement('button'); rm.textContent='-'; rm.addEventListener('click',()=>{ if(c.qty>1) c.qty--; else cart.splice(idx,1); renderCart(); }); li.appendChild(rm); cartList.appendChild(li); } cartTotal.textContent = (await formatMoney(total)).toString(); // update print button labels
  try{ if(typeof updatePrintButtons === 'function') updatePrintButtons(); }catch(e){}
}

// select/add customer during checkout
let selectedCustomer=null; document.getElementById('select-customer').addEventListener('click', async ()=>{
  const name = prompt('Customer name (leave blank to list)'); if(name){ const id = await OpenPOSDB.add('customers',{name,createdAt:new Date().toISOString()}); selectedCustomer = {id,name}; document.getElementById('selected-customer').textContent = name; renderCustomers(); }
  else{ const items = await OpenPOSDB.getAll('customers'); const pick = prompt('Choose customer number:\n'+items.map((c,i)=>`${i+1}. ${c.name}`).join('\n'));
    const idx=parseInt(pick)-1; if(items[idx]){ selectedCustomer=items[idx]; document.getElementById('selected-customer').textContent = selectedCustomer.name; }
  }
});

// complete sale
document.getElementById('complete-sale').addEventListener('click', async ()=>{
  if(cart.length===0) return alert('Cart is empty'); const sale={items:cart,customer:selectedCustomer, total:parseFloat(cart.reduce((s,c)=>s+c.price*c.qty,0).toFixed(2)), at:new Date().toISOString()}; await OpenPOSDB.add('sales',sale); cart=[]; renderCart(); alert('Sale recorded'); });

// Settings: theme + language + currency + import/export
const themeSelect = document.getElementById('theme-select'); const langSelect = document.getElementById('lang-select'); const currencySelect = document.getElementById('currency-select');
// Translations for core UI strings (partial)
const TRANSLATIONS = {
  en: {
    nav: ['POS','Products','Customers','Users','Reports','Settings','Help','About'],
    welcomeTitle: 'Welcome to OpenPOS',
    getStarted: 'Get Started',
    learnMore: 'Learn More',
    login: 'Login',
    logout: 'Logout',
    createAccount: 'Create account',
    printReceipt: 'Print Receipt',
    scanBarcode: 'Scan barcode',
    selectCustomer: 'Select/Add'
  },
  bn: {
    nav: ['à¦•à§à¦¯à¦¾à¦¶','à¦ªà¦£à§à¦¯','à¦—à§à¦°à¦¾à¦¹à¦•','à¦¬à§à¦¯à¦¬à¦¹à¦¾à¦°à¦•à¦¾à¦°à§€','à¦¬à¦¿à¦•à§à¦°à¦¯à¦¼','à¦¸à§‡à¦Ÿà¦¿à¦‚à¦¸','à¦¸à¦¾à¦¹à¦¾à¦¯à§à¦¯','à¦¬à¦¿à¦·à¦¯à¦¼à§‡'],
    welcomeTitle: 'OpenPOS-à¦ à¦†à¦ªà¦¨à¦¾à¦•à§‡ à¦¸à§à¦¬à¦¾à¦—à¦¤à¦®',
    getStarted: 'à¦¶à§à¦°à§ à¦•à¦°à§à¦¨',
    learnMore: 'à¦†à¦°à¦“ à¦œà¦¾à¦¨à§à¦¨',
    login: 'à¦²à¦—à¦‡à¦¨',
    logout: 'à¦²à¦—à¦†à¦‰à¦Ÿ',
    createAccount: 'à¦…à§à¦¯à¦¾à¦•à¦¾à¦‰à¦¨à§à¦Ÿ à¦¤à§ˆà¦°à¦¿ à¦•à¦°à§à¦¨',
    printReceipt: 'à¦°à¦¸à¦¿à¦¦ à¦ªà§à¦°à¦¿à¦¨à§à¦Ÿ',
    scanBarcode: 'à¦¬à¦¾à¦°à¦•à§‹à¦¡ à¦¸à§à¦•à§à¦¯à¦¾à¦¨ à¦•à¦°à§à¦¨',
    selectCustomer: 'à¦—à§à¦°à¦¾à¦¹à¦• à¦¨à¦¿à¦°à§à¦¬à¦¾à¦šà¦¨/à¦¯à§‹à¦— à¦•à¦°à§à¦¨'
  },
  es: {
    nav: ['POS','Productos','Clientes','Usuarios','Reportes','Ajustes','Ayuda','Acerca de'],
    welcomeTitle: 'Bienvenido a OpenPOS',
    getStarted: 'Comenzar',
    learnMore: 'Saber mÃ¡s',
    login: 'Iniciar sesiÃ³n',
    logout: 'Cerrar sesiÃ³n',
    createAccount: 'Crear cuenta',
    printReceipt: 'Imprimir recibo',
    scanBarcode: 'Escanear cÃ³digo de barras',
    selectCustomer: 'Seleccionar/Agregar'
  }
};

async function applyLanguage(lang){ const t = TRANSLATIONS[lang]||TRANSLATIONS.en; // nav buttons
  const navBtns = document.querySelectorAll('#main-nav button'); navBtns.forEach((b,i)=>{ if(t.nav[i]) b.textContent = t.nav[i]; });
  // welcome / buttons
  const welcomeTitle = document.querySelector('#welcome h2'); if(welcomeTitle) welcomeTitle.textContent = t.welcomeTitle;
  const startBtn = document.getElementById('start-setup'); if(startBtn) startBtn.textContent = t.getStarted;
  const learnBtn = document.getElementById('learn-more'); if(learnBtn) learnBtn.textContent = t.learnMore;
  const loginBtnEl = document.getElementById('login-btn'); if(loginBtnEl) loginBtnEl.textContent = t.login;
  const createShow = document.getElementById('show-create'); if(createShow) createShow.textContent = t.createAccount;
  // cart buttons
  const printBtn = document.querySelector('.cart-actions button'); // leave if present
  const scanBtn = document.querySelector('button[style][textContent]'); // noop
}

async function loadSettings(){ const theme = await OpenPOSDB.getSetting('theme')||'light'; const lang = await OpenPOSDB.getSetting('language')||'en'; const currency = await OpenPOSDB.getSetting('currency')||'USD'; document.documentElement.setAttribute('data-theme', theme); themeSelect.value=theme; langSelect.value=lang; currencySelect.value=currency; await applyLanguage(lang);
  // load business settings into inputs if present
  const bizNameEl = document.getElementById('biz-name'); const bizEmailEl = document.getElementById('biz-email'); const bizPhoneEl = document.getElementById('biz-phone'); const bizAddrEl = document.getElementById('biz-address');
  if(bizNameEl) bizNameEl.value = await OpenPOSDB.getSetting('biz.name') || '';
  if(bizEmailEl) bizEmailEl.value = await OpenPOSDB.getSetting('biz.email') || '';
  if(bizPhoneEl) bizPhoneEl.value = await OpenPOSDB.getSetting('biz.phone') || '';
  if(bizAddrEl) bizAddrEl.value = await OpenPOSDB.getSetting('biz.address') || '';
  // autosave settings
  const autosaveEnable = document.getElementById('autosave-enable'); const autosaveInterval = document.getElementById('autosave-interval');
  const enabled = await OpenPOSDB.getSetting('autosave.enabled'); const minutes = await OpenPOSDB.getSetting('autosave.minutes');
  if(autosaveEnable) autosaveEnable.checked = enabled === 'true' || enabled === true;
  if(autosaveInterval) autosaveInterval.value = minutes || 10;
  // if autosave enabled, attempt to start timer (requires a chosen AppData file handle)
  if(autosaveEnable && autosaveEnable.checked){ startAutoSave(parseInt(autosaveInterval.value || 10)); }
}

themeSelect.addEventListener('change', async ()=>{ const v=themeSelect.value; document.documentElement.setAttribute('data-theme', v); await OpenPOSDB.setSetting('theme',v); }); langSelect.addEventListener('change', async ()=>{ await OpenPOSDB.setSetting('language',langSelect.value); await applyLanguage(langSelect.value); }); currencySelect.addEventListener('change', async ()=>{ await OpenPOSDB.setSetting('currency',currencySelect.value); renderProducts(); renderCart(); });
await loadSettings();

// export/import buttons
document.getElementById('export-backup').addEventListener('click', async ()=>{ const pw = prompt('Enter password to encrypt backup (leave blank for plain)'); await OpenPOSDB.exportBackup({encrypt:!!pw,password:pw}); alert('Backup downloaded'); });
document.getElementById('import-backup').addEventListener('click', ()=>{ const inp = document.getElementById('import-file'); inp.onchange = async e=>{ const f = inp.files[0]; if(!f) return; const maybe = confirm('Is the file encrypted? OK=Yes Cancel=No'); if(maybe){ const pw = prompt('Password for backup'); try{ await OpenPOSDB.importBackupFile(f,{encrypted:true,password:pw}); alert('Imported'); await renderProducts(); await renderCustomers(); await renderUsersList(); }catch(err){ alert('Import failed'); } } else { await OpenPOSDB.importBackupFile(f,{encrypted:false}); alert('Imported'); await renderProducts(); await renderCustomers(); await renderUsersList(); } inp.value=''; }; inp.click(); });

// recovery file for password reset (export users only)
document.getElementById('download-recovery').addEventListener('click', async ()=>{
  const users = await OpenPOSDB.getAll('users'); const payload = JSON.stringify({users}); const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([payload],{type:'application/json'})); a.download='openpos-recovery.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),3000); alert('Recovery file downloaded â€” keep it safe.'); });

// PWA: register service worker and capture install prompt
let deferredPrompt = null; window.addEventListener('beforeinstallprompt', (e)=>{ e.preventDefault(); deferredPrompt = e; // show a subtle UI hint
  const btn = document.createElement('button'); btn.textContent='Install'; btn.style.marginLeft='10px'; btn.onclick = async ()=>{ deferredPrompt.prompt(); const choice = await deferredPrompt.userChoice; if(choice.outcome==='accepted') alert('App installed'); deferredPrompt = null; btn.remove(); }; document.querySelector('.auth-area').appendChild(btn); });
if('serviceWorker' in navigator){ navigator.serviceWorker.register('service-worker.js').catch(()=>{}); }

// AppData file handling and autosave
window.appDataHandle = null; let autoSaveTimer = null;

async function chooseAppDataFile(){ if(!window.showSaveFilePicker) return alert('File System Access API not available in this browser.');
  try{
    const handle = await window.showSaveFilePicker({suggestedName:'AppData.json',types:[{description:'OpenPOS AppData',accept:{'application/json':['.json']}}]});
    window.appDataHandle = handle; await OpenPOSDB.setSetting('appdata.filename', handle.name || 'AppData.json'); alert('AppData file chosen: '+(handle.name||'AppData.json'));
  }catch(e){ console.error(e); alert('Choose file cancelled'); }
}

async function saveAppDataFile(){ // write full DB JSON to chosen file or prompt
  const json = await OpenPOSDB.exportDB();
  if(window.appDataHandle && window.appDataHandle.createWritable){ try{ const writable = await window.appDataHandle.createWritable(); await writable.write(json); await writable.close(); return alert('AppData saved to chosen file'); }catch(e){ console.error(e); alert('Save failed: '+e.message); } }
  // fallback: ask user to pick file
  if(!window.showSaveFilePicker) return alert('File System Access API not available. Use Export Backup instead.');
  try{ const handle = await window.showSaveFilePicker({suggestedName:'AppData.json',types:[{description:'OpenPOS AppData',accept:{'application/json':['.json']}}]}); const writable = await handle.createWritable(); await writable.write(json); await writable.close(); window.appDataHandle = handle; await OpenPOSDB.setSetting('appdata.filename', handle.name||'AppData.json'); alert('AppData saved'); }catch(e){ console.error(e); alert('Save cancelled or failed'); }
}

async function loadAppDataFile(){ if(!window.showOpenFilePicker) return alert('File System Access API not available.');
  try{
    const [handle] = await window.showOpenFilePicker({types:[{description:'OpenPOS AppData',accept:{'application/json':['.json']}}],multiple:false});
    const file = await handle.getFile(); const txt = await file.text(); try{ await OpenPOSDB.importBackupFile(new File([txt],file.name),{encrypted:false}); }catch(e){ // try raw import
      await OpenPOSDB.importDB(txt);
    }
    window.appDataHandle = handle; await OpenPOSDB.setSetting('appdata.filename', handle.name||'AppData.json'); alert('AppData loaded');
    await renderProducts(); await renderCustomers(); await renderUsersList();
  }catch(e){ console.error(e); alert('Load cancelled or failed'); }
}

function startAutoSave(minutes){ stopAutoSave(); if(!minutes || minutes<1) minutes = 10; autoSaveTimer = setInterval(async ()=>{ if(!window.appDataHandle){ console.warn('Autosave skipped: no AppData file chosen'); return; } try{ await saveAppDataFile(); console.log('Autosave complete'); }catch(e){ console.error('Autosave failed',e); } }, minutes*60*1000); }
function stopAutoSave(){ if(autoSaveTimer) clearInterval(autoSaveTimer); autoSaveTimer = null; }

// Wire UI buttons (choose/save/load)
const chooseBtn = document.getElementById('choose-appdata'); if(chooseBtn) chooseBtn.addEventListener('click', ()=>chooseAppDataFile());
const saveAppBtn = document.getElementById('save-appdata'); if(saveAppBtn) saveAppBtn.addEventListener('click', ()=>saveAppDataFile());
const loadAppBtn = document.getElementById('load-appdata'); if(loadAppBtn) loadAppBtn.addEventListener('click', ()=>loadAppDataFile());

// autosave UI
const autosaveEnableEl = document.getElementById('autosave-enable'); const autosaveIntervalEl = document.getElementById('autosave-interval');
if(autosaveEnableEl){ autosaveEnableEl.addEventListener('change', async ()=>{ await OpenPOSDB.setSetting('autosave.enabled', autosaveEnableEl.checked ? 'true' : 'false'); if(autosaveEnableEl.checked){ startAutoSave(parseInt(autosaveIntervalEl.value||10)); } else stopAutoSave(); }); }
if(autosaveIntervalEl){ autosaveIntervalEl.addEventListener('change', async ()=>{ await OpenPOSDB.setSetting('autosave.minutes', autosaveIntervalEl.value); if(autosaveEnableEl && autosaveEnableEl.checked){ startAutoSave(parseInt(autosaveIntervalEl.value||10)); } }); }

// Learn More modal
const learnBtn = document.getElementById('learn-more'); if(learnBtn){ learnBtn.addEventListener('click', ()=>{
  const modal = document.getElementById('modal'); const content = document.getElementById('modal-content'); content.innerHTML = `<h3>About OpenPOS</h3>
    <p>OpenPOS is designed to be a compact, reliable offline-first POS system. It stores all data locally using IndexedDB and allows encrypted backups. The app is a zero-build static web app that runs by opening index.html or hosting on GitHub Pages. Key features include:</p>
    <ul><li>Products, categories, customers, and sales</li><li>Multi-user roles and security questions for password reset</li><li>Theme, language and currency settings</li><li>PWA installable via browser and offline caching via service worker</li><li>CSV import/export for products and users</li><li>Printable receipts and optional barcode scanning using the device camera</li></ul>
    <p>For developers: the source is plain HTML/CSS/JS using Web Crypto for hashing and AES-GCM for optional backup encryption.</p>`; modal.style.display='flex'; }); }

// Modal close
const modalClose = document.getElementById('modal-close'); if(modalClose) modalClose.addEventListener('click', ()=>{ document.getElementById('modal').style.display='none'; });

// User menu handling and logout icon
const userArea = document.getElementById('user-area'); const userMenu = document.getElementById('user-menu'); if(userArea){ userArea.addEventListener('click', ()=>{ const u = OpenPOSAuth.currentUser(); if(!u) return; userMenu.style.display = userMenu.style.display==='none'?'flex':'none'; });
userMenu.querySelectorAll('button').forEach(b=>b.addEventListener('click', async (e)=>{ const action = b.dataset.action; if(action==='settings'){ showById('page-settings'); userMenu.style.display='none'; } else if(action==='reset'){ // open reset flow
    const username = OpenPOSAuth.currentUser().username; const user = await OpenPOSAuth.getUserByUsername(username); const answers = {}; for(const qa of user.securityQA||[]){ const a = prompt('Answer: '+qa.q); if(a) answers[qa.q]=a; }
    const ok = await OpenPOSAuth.verifySecurityAnswers(username,answers).catch(()=>false); if(!ok) return alert('Answers did not match'); const np = prompt('Enter new password'); if(!np) return; await OpenPOSAuth.resetPassword(username,answers,np); alert('Password reset'); userMenu.style.display='none'; } else if(action==='logout'){ if(confirm('Logout?')){ OpenPOSAuth.logout(); refreshAuth(); userMenu.style.display='none'; } } }));
}

// CSV import/export handlers
const importProductsBtn = document.getElementById('import-products-csv'); const productsCsvInput = document.getElementById('products-csv-file'); if(importProductsBtn && productsCsvInput){ importProductsBtn.addEventListener('click', ()=>productsCsvInput.click()); productsCsvInput.addEventListener('change', async (e)=>{ const f = e.target.files[0]; if(!f) return; const txt = await f.text(); const lines = txt.split(/\r?\n/).map(l=>l.trim()).filter(Boolean); const header = lines.shift().split(',').map(h=>h.trim().toLowerCase()); for(const line of lines){ const cols = line.split(','); const obj = {}; header.forEach((h,i)=>obj[h]=cols[i]); await OpenPOSDB.add('products',{name:obj.name,code:obj.code,category:obj.category,price:parseFloat(obj.price||0),createdAt:new Date().toISOString()}); } alert('Products imported'); renderProducts(); }); }

/* Users CSV import removed from Users page per user request. If you want a bulk user import later, enable it here. */

// Customers CSV import/export
const importCustomersBtn = document.getElementById('import-customers-csv'); const customersCsvInput = document.getElementById('customers-csv-file'); const exportCustomersBtn = document.getElementById('export-customers-csv');
if(importCustomersBtn && customersCsvInput){ importCustomersBtn.addEventListener('click', ()=>customersCsvInput.click()); customersCsvInput.addEventListener('change', async (e)=>{ const f = e.target.files[0]; if(!f) return; const txt = await f.text(); const lines = txt.split(/\r?\n/).map(l=>l.trim()).filter(Boolean); const header = lines.shift().split(',').map(h=>h.trim().toLowerCase()); for(const line of lines){ const cols = line.split(','); const obj = {}; header.forEach((h,i)=>obj[h]=cols[i]||''); await OpenPOSDB.add('customers',{name:obj.name,phone:obj.phone,createdAt:new Date().toISOString()}); } alert('Customers imported'); renderCustomers(); }); }
if(exportCustomersBtn){ exportCustomersBtn.addEventListener('click', async ()=>{ const items = await OpenPOSDB.getAll('customers'); const rows = ['name,phone', ...items.map(i=>`${(i.name||'').replace(/,/g,'')},${(i.phone||'').replace(/,/g,'')}`)]; const blob = new Blob([rows.join('\n')],{type:'text/csv'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='customers-export.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),3000); }); }

// Export users
/* Users export removed from Users page per user request. */

// Barcode scan button and handlers (image or live)
const scanBtn = document.createElement('button'); scanBtn.textContent='Scan barcode'; scanBtn.style.marginLeft='8px'; const prodSearch = document.getElementById('product-search'); if(prodSearch) prodSearch.after(scanBtn);
const barcodeFile = document.createElement('input'); barcodeFile.type='file'; barcodeFile.accept='image/*'; barcodeFile.style.display='none'; document.body.appendChild(barcodeFile);
scanBtn.addEventListener('click', async ()=>{ const useLive = confirm('Use live camera scanner if available? OK=Camera, Cancel=Upload image'); if(useLive){ startLiveScanner(); } else { barcodeFile.click(); } });
barcodeFile.addEventListener('change', async (e)=>{ const f = e.target.files[0]; if(!f) return; const imgBitmap = await createImageBitmap(f); if('BarcodeDetector' in window){ try{ const detector = new BarcodeDetector(); const canvas = document.createElement('canvas'); canvas.width = imgBitmap.width; canvas.height = imgBitmap.height; const ctx = canvas.getContext('2d'); ctx.drawImage(imgBitmap,0,0); const results = await detector.detect(canvas); if(results && results.length>0){ const code = results[0].rawValue; const items = await OpenPOSDB.getAll('products'); const p = items.find(x=>x.code===code); if(p) addToCart(p); else alert('Barcode detected: '+code+' but no matching product found.'); } else alert('No barcode found in image'); }catch(err){ alert('Barcode detection failed'); } } else { alert('No BarcodeDetector; cannot detect'); } });

// Live camera scanner
let liveStream = null; let liveInterval = null;
async function startLiveScanner(){ const modal = document.getElementById('modal'); const content = document.getElementById('modal-content'); content.innerHTML = `<h3>Live Barcode Scanner</h3><video id="scan-video" autoplay playsinline style="width:100%;max-width:480px;border-radius:8px"></video><div style="margin-top:8px"><button id="stop-scan">Stop</button></div>`; modal.style.display='flex'; const video = document.getElementById('scan-video'); try{ liveStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}}); video.srcObject = liveStream; await video.play(); if('BarcodeDetector' in window){ const detector = new BarcodeDetector(); liveInterval = setInterval(async ()=>{ try{ const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight; const ctx = canvas.getContext('2d'); ctx.drawImage(video,0,0,canvas.width,canvas.height); const results = await detector.detect(canvas); if(results && results.length>0){ const code = results[0].rawValue; const items = await OpenPOSDB.getAll('products'); const p = items.find(x=>x.code===code); if(p){ addToCart(p); alert('Scanned: '+p.name); stopLiveScanner(); modal.style.display='none'; } else { alert('Scanned code: '+code+' (no product match)'); stopLiveScanner(); modal.style.display='none'; } } }catch(e){} },500); } else { alert('BarcodeDetector API not available in this browser'); }
    document.getElementById('stop-scan').addEventListener('click', ()=>{ stopLiveScanner(); modal.style.display='none'; });
  }catch(err){ alert('Camera access denied or unavailable'); modal.style.display='none'; }
}
function stopLiveScanner(){ if(liveInterval) clearInterval(liveInterval); if(liveStream){ liveStream.getTracks().forEach(t=>t.stop()); liveStream=null; } }

// Receipt printing with business info and logo
async function printReceipt(sale, opts={downloadPDF:false}){ const biz = {name:await OpenPOSDB.getSetting('biz.name')||'', email:await OpenPOSDB.getSetting('biz.email')||'', phone:await OpenPOSDB.getSetting('biz.phone')||'', address:await OpenPOSDB.getSetting('biz.address')||'', logo:await OpenPOSDB.getSetting('biz.logo')||''}; const items = sale.items || []; let html = `<html><head><meta charset="utf-8"><title>Receipt</title><style>body{font-family:Arial;padding:20px}header{display:flex;align-items:center;gap:12px}header img{max-width:80px;max-height:80px;border-radius:8px}h2{text-align:left;margin:0}table{width:100%;border-collapse:collapse;margin-top:12px}td,th{padding:6px;border-bottom:1px solid #ddd;text-align:left}tfoot td{font-weight:700}</style></head><body>`;
  html += `<header>${biz.logo?'<img src="'+biz.logo+'">':''}<div><h2>${biz.name||'OpenPOS'}</h2><div>${biz.address||''}</div><div>${biz.phone||''} ${biz.email?'- '+biz.email:''}</div></div></header>`;
  html += `<div style="margin-top:12px">Time: ${sale.at||new Date().toISOString()}</div><table><thead><tr><th>Item</th><th>Qty</th><th>Price</th></tr></thead><tbody>`; for(const it of items) html += `<tr><td>${it.name}</td><td>${it.qty}</td><td>${it.price}</td></tr>`; html += `</tbody><tfoot><tr><td></td><td>Total</td><td>${sale.total}</td></tr></tfoot></table></body></html>`;
  const w = window.open('','_blank'); w.document.write(html); w.document.close(); if(opts.downloadPDF){ // guide user to save as PDF
    setTimeout(()=>{ try{ w.focus(); w.print(); }catch(e){} },200); } else { setTimeout(()=>{ try{ w.focus(); w.print(); }catch(e){} },200); }
}

// hook Print receipt button
const printBtn = document.createElement('button'); const pdfBtn = document.createElement('button'); printBtn.style.marginLeft='8px'; pdfBtn.style.marginLeft='8px'; const cartActions = document.querySelector('.cart-actions'); if(cartActions) { cartActions.appendChild(printBtn); cartActions.appendChild(pdfBtn); }
let lastSale = null; document.getElementById('complete-sale').addEventListener('click', async ()=>{ // existing handler also saves sale; capture last sale
  // small delay to let add complete
  setTimeout(async ()=>{ const sales = await OpenPOSDB.getAll('sales'); lastSale = sales[sales.length-1]; if(lastSale) printReceipt(lastSale); updatePrintButtons(); },300); });

function updatePrintButtons(){ try{ if(cart.length===0){ printBtn.textContent = 'Print Last'; pdfBtn.textContent = 'Download Last'; } else { printBtn.textContent = 'Print Receipt'; pdfBtn.textContent = 'Download PDF'; } }catch(e){}
}

// default labels
updatePrintButtons();

printBtn.addEventListener('click', ()=>{ if(cart.length===0){ if(lastSale) printReceipt(lastSale); else alert('No sale to print yet.'); } else { // print current cart preview
    const tempSale = {items:cart.map(c=>({name:c.name,qty:c.qty,price:c.price})), total: parseFloat(cart.reduce((s,c)=>s+c.price*c.qty,0).toFixed(2)), at: new Date().toISOString()}; printReceipt(tempSale); }
});

pdfBtn.addEventListener('click', ()=>{ if(cart.length===0){ if(lastSale) printReceipt(lastSale,{downloadPDF:true}); else alert('No sale to print yet.'); } else { const tempSale = {items:cart.map(c=>({name:c.name,qty:c.qty,price:c.price})), total: parseFloat(cart.reduce((s,c)=>s+c.price*c.qty,0).toFixed(2)), at: new Date().toISOString()}; printReceipt(tempSale,{downloadPDF:true}); } });

// Logo upload handler and business settings save
const bizLogoFile = document.getElementById('biz-logo-file'); const bizName = document.getElementById('biz-name'); const bizEmail = document.getElementById('biz-email'); const bizPhone = document.getElementById('biz-phone'); const bizAddress = document.getElementById('biz-address');
if(bizLogoFile){ bizLogoFile.addEventListener('change', async (e)=>{ const f = e.target.files[0]; if(!f) return; const reader = new FileReader(); reader.onload = async ()=>{ const dataUrl = reader.result; await OpenPOSDB.setSetting('biz.logo',dataUrl); alert('Logo saved'); }; reader.readAsDataURL(f); }); }
if(bizName){ bizName.addEventListener('blur', async ()=>{ await OpenPOSDB.setSetting('biz.name',bizName.value); }); }
if(bizEmail){ bizEmail.addEventListener('blur', async ()=>{ await OpenPOSDB.setSetting('biz.email',bizEmail.value); }); }
if(bizPhone){ bizPhone.addEventListener('blur', async ()=>{ await OpenPOSDB.setSetting('biz.phone',bizPhone.value); }); }
if(bizAddress){ bizAddress.addEventListener('blur', async ()=>{ await OpenPOSDB.setSetting('biz.address',bizAddress.value); }); }

// Reports: generate and export sales reports
const reportFrom = document.getElementById('report-from'); const reportTo = document.getElementById('report-to'); const reportPreview = document.getElementById('report-preview');
async function generateReport(){ const from = reportFrom && reportFrom.value ? new Date(reportFrom.value) : null; const to = reportTo && reportTo.value ? new Date(reportTo.value) : null; const sales = await OpenPOSDB.getAll('sales'); const filtered = sales.filter(s=>{ const d = new Date(s.at); if(from && d < from) return false; if(to){ const d2 = new Date(s.at); d2.setHours(23,59,59,999); if(d > d2) return false; } return true; }); let html = '<div><h3>Sales report</h3><table style="width:100%;border-collapse:collapse"><thead><tr><th>Date</th><th>Items</th><th>Total</th></tr></thead><tbody>'; let total=0; for(const s of filtered){ total += s.total||0; const items = (s.items||[]).map(i=>`${i.name} x${i.qty}`).join(', '); html += `<tr><td>${new Date(s.at).toLocaleString()}</td><td>${items}</td><td>${s.total}</td></tr>`; } html += `</tbody><tfoot><tr><td></td><td style="text-align:right;font-weight:700">Grand total</td><td style="font-weight:700">${total.toFixed(2)}</td></tr></tfoot></table></div>`; if(reportPreview) reportPreview.innerHTML = html; return {rows:filtered,total}; }

document.getElementById('generate-report').addEventListener('click', async ()=>{ await generateReport(); });

document.getElementById('export-report-csv').addEventListener('click', async ()=>{ const {rows,total} = await generateReport(); const lines = ['date,items,total', ...rows.map(r=>`${new Date(r.at).toISOString()},"${(r.items||[]).map(i=>i.name+' x'+i.qty).join('; ')}",${r.total}`)]; const blob = new Blob([lines.join('\n')],{type:'text/csv'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='sales-report.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),3000); });

document.getElementById('export-report-pdf').addEventListener('click', async ()=>{ const {rows,total} = await generateReport(); let html = `<html><head><meta charset="utf-8"><title>Sales Report</title><style>body{font-family:Arial;padding:12px}table{width:100%;border-collapse:collapse}td,th{padding:6px;border:1px solid #ccc}</style></head><body><h2>Sales Report</h2><table><thead><tr><th>Date</th><th>Items</th><th>Total</th></tr></thead><tbody>`; for(const r of rows){ html += `<tr><td>${new Date(r.at).toLocaleString()}</td><td>${(r.items||[]).map(i=>i.name+' x'+i.qty).join(', ')}</td><td>${r.total}</td></tr>`; } html += `</tbody><tfoot><tr><td colspan="2" style="text-align:right;font-weight:700">Grand total</td><td style="font-weight:700">${total.toFixed(2)}</td></tr></tfoot></table></body></html>`; const w = window.open('','_blank'); w.document.write(html); w.document.close(); setTimeout(()=>{ try{ w.focus(); w.print(); }catch(e){} },200); });


})();
