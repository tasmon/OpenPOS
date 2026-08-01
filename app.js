// App wiring: SPA behavior with auth-first gating, themes, i18n basics, PWA prompt
(async function(){
  // global error handler to capture runtime issues and show helpful message
  window.addEventListener('error', (ev)=>{
    console.error('Runtime error captured', ev.error || ev.message, ev);
    try{ const modal = document.getElementById('modal'); const content = document.getElementById('modal-content'); if(modal && content){ content.innerHTML = `<h3>OpenPOS runtime error</h3><pre style="white-space:pre-wrap;max-height:200px;overflow:auto">${(ev.error&&ev.error.stack)?ev.error.stack:ev.message||ev.error||ev}</pre><p>Please copy the console error and share it.</p>`; modal.style.display='flex'; } }catch(e){}
  });
  // also listen for unhandledrejection
  window.addEventListener('unhandledrejection', (ev)=>{ console.error('Unhandled promise rejection', ev.reason); try{ const modal = document.getElementById('modal'); const content = document.getElementById('modal-content'); if(modal && content){ content.innerHTML = `<h3>Unhandled promise rejection</h3><pre style="white-space:pre-wrap;max-height:200px;overflow:auto">${ev.reason && ev.reason.stack? ev.reason.stack : JSON.stringify(ev.reason)}</pre>`; modal.style.display='flex'; } }catch(e){} });

  await OpenPOSDB.openDB();
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
    const map = {USD:'$',EUR:'€',BDT:'৳'}; const sym = map[curr]||curr; return sym + parseFloat(value).toFixed(2); } }

// Initial UI state: show welcome. After Start -> check users count
document.getElementById('start-setup').addEventListener('click', async ()=>{
  const users = await OpenPOSDB.getAll('users');
  const settingFlag = await OpenPOSDB.getSetting('hasUsers');
  const hasUsers = (users && users.length>0) || settingFlag === 'true';
  if(!hasUsers){ // go to create account
    showById('create-account'); document.getElementById('auth-gate').style.display='none';
  } else {
    showById('auth-gate'); document.getElementById('auth-title').textContent='Login';
  }
});
document.getElementById('cancel-create').addEventListener('click', ()=>{ showById('welcome'); });

// Create-account form handler (first-run onboarding)
const createFormEl = document.getElementById('create-form');
if(createFormEl){ createFormEl.addEventListener('submit', async (e)=>{ e.preventDefault(); const f = new FormData(createFormEl); const username = f.get('username'); const password = f.get('password'); const role = f.get('role') || 'admin'; const qa = [ {q:f.get('q1'), answer:f.get('a1')}, {q:f.get('q2'), answer:f.get('a2')}, {q:f.get('q3'), answer:f.get('a3')} ]; const answered = qa.filter(x=>x.answer && x.answer.trim().length>0).length; if(answered < 2) return alert('Please answer at least two security questions'); const hashed = await OpenPOSAuth.hashSecurityAnswers(qa); try{ await OpenPOSAuth.createUser(username,password,role,hashed); await OpenPOSDB.setSetting('hasUsers','true'); await renderUsersList(); alert('Account created — please login'); document.getElementById('auth-title').textContent='Login'; showById('auth-gate'); }catch(err){ console.error(err); alert('Create user failed: '+(err.message||err)); } }); }

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
    if(usersNavBtn) usersNavBtn.style.display = u.role === 'admin' ? 'inline-block' : 'none'; } else { currentUserSpan.textContent='—'; loginBtn.style.display='inline-block'; if(userAreaEl) userAreaEl.style.display='none'; nav.classList.add('hidden'); showById('welcome'); if(usersNavBtn) usersNavBtn.style.display='none'; } }
loginBtn.addEventListener('click', ()=>{ showById('auth-gate'); }); refreshAuth();

// Nav buttons
nav.querySelectorAll('button').forEach(b=>b.addEventListener('click', ()=>{ const page = 'page-'+b.dataset.page; showById(page); }));

// Products
const productForm = document.getElementById('product-form'); const productsList = document.getElementById('products-list');
async function renderProducts(){ const items = await OpenPOSDB.getAll('products'); productsList.innerHTML=''; for(const it of items){ const li=document.createElement('li'); li.dataset.id=it.id; li.innerHTML = `<span class="item-label">${it.name} ${it.category?'- '+it.category:''} — ${await formatMoney(it.price)}</span>`; const editBtn = document.createElement('button'); editBtn.textContent='Edit'; editBtn.style.marginLeft='8px'; editBtn.addEventListener('click', ()=>{ document.getElementById('product-id').value = it.id; productForm.elements['name'].value = it.name; productForm.elements['code'].value = it.code || ''; productForm.elements['category'].value = it.category || ''; productForm.elements['price'].value = it.price || 0; showById('page-products'); }); const delBtn = document.createElement('button'); delBtn.textContent='Delete'; delBtn.style.marginLeft='6px'; delBtn.addEventListener('click', async ()=>{ if(!confirm('Delete product '+it.name+'?')) return; try{ await OpenPOSDB.del('products', it.id); renderProducts(); }catch(err){ alert('Delete failed: '+(err.message||err)); } }); li.appendChild(editBtn); li.appendChild(delBtn); productsList.appendChild(li); } }
productForm.addEventListener('submit',async e=>{ e.preventDefault(); const f=new FormData(productForm); const id = f.get('id'); const name=f.get('name'); const code=f.get('code'); const category=f.get('category'); const price=parseFloat(f.get('price')||0);
    try{
      if(id){ // update existing
        await OpenPOSDB.put('products',{id: Number(id), name, code, category, price, updatedAt: new Date().toISOString()});
      } else {
        await OpenPOSDB.add('products',{name,code,category,price,createdAt:new Date().toISOString()});
      }
      productForm.reset(); document.getElementById('product-id').value='';
      renderProducts();
    }catch(err){ console.error('Product save failed',err); alert('Product save failed: '+(err.message||err)); }
  });

// Customers
const customerForm = document.getElementById('customer-form'); const customersList = document.getElementById('customers-list');
async function renderCustomers(){ const items = await OpenPOSDB.getAll('customers'); customersList.innerHTML=''; for(const it of items){ const li=document.createElement('li'); li.dataset.id = it.id; li.innerHTML = `<span class="item-label">${it.name} ${it.phone?'- '+it.phone:''}</span>`; const editBtn=document.createElement('button'); editBtn.textContent='Edit'; editBtn.style.marginLeft='8px'; editBtn.addEventListener('click', ()=>{ document.getElementById('customer-id').value = it.id; customerForm.elements['name'].value = it.name; customerForm.elements['phone'].value = it.phone || ''; showById('page-customers'); }); const delBtn=document.createElement('button'); delBtn.textContent='Delete'; delBtn.style.marginLeft='6px'; delBtn.addEventListener('click', async ()=>{ if(!confirm('Delete customer '+it.name+'?')) return; try{ await OpenPOSDB.del('customers', it.id); renderCustomers(); }catch(err){ alert('Delete failed: '+(err.message||err)); } }); li.appendChild(editBtn); li.appendChild(delBtn); customersList.appendChild(li); } }
customerForm.addEventListener('submit',async e=>{ e.preventDefault(); const f=new FormData(customerForm); const id = f.get('id'); const name = f.get('name'); const phone = f.get('phone'); try{ if(id){ await OpenPOSDB.put('customers',{id: Number(id), name, phone, updatedAt: new Date().toISOString()}); } else { await OpenPOSDB.add('customers',{name,phone,createdAt:new Date().toISOString()}); } customerForm.reset(); document.getElementById('customer-id').value=''; renderCustomers(); }catch(err){ console.error('Customer save failed',err); alert('Customer save failed: '+(err.message||err)); } });

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
productSearch.addEventListener('input', async ()=>{ const q=productSearch.value.trim(); productResults.innerHTML=''; if(!q) return; const results = await searchProducts(q); results.forEach(r=>{ const li = document.createElement('li'); li.textContent = `${r.name} — ${r.category||'--'} — ${r.price}`; li.addEventListener('click', ()=>{ addToCart(r); }); productResults.appendChild(li); }); });
function addToCart(item){ const copy = {id:item.id,name:item.name,price:item.price,qty:1}; cart.push(copy); renderCart(); }
async function renderCart(){ cartList.innerHTML=''; let subtotal=0; for(const [idx,c] of cart.entries()){ subtotal += c.price * c.qty; const li=document.createElement('li'); li.innerHTML = `${c.name} <strong>x${c.qty}</strong> — ${await formatMoney(c.price)}`; const btnMinus = document.createElement('button'); btnMinus.textContent='-'; btnMinus.style.marginLeft='8px'; btnMinus.addEventListener('click',()=>{ if(c.qty>1) c.qty--; else cart.splice(idx,1); renderCart(); }); const btnPlus = document.createElement('button'); btnPlus.textContent='+'; btnPlus.style.marginLeft='6px'; btnPlus.addEventListener('click',()=>{ c.qty++; renderCart(); }); li.appendChild(btnMinus); li.appendChild(btnPlus); cartList.appendChild(li); }
  // compute discount and tax
  const discountEl = document.getElementById('cart-discount'); const discountPercent = discountEl ? parseFloat(discountEl.value||0) : 0;
  const discountAmount = subtotal * (discountPercent/100);
  const taxRateSetting = await OpenPOSDB.getSetting('tax.rate'); const taxRate = parseFloat(taxRateSetting||0);
  const taxable = Math.max(0, subtotal - discountAmount);
  const taxAmount = taxable * (taxRate/100);
  const total = taxable + taxAmount;
  const subtotalEl = document.getElementById('cart-subtotal'); const discountAmtEl = document.getElementById('cart-discount-amount'); const taxEl = document.getElementById('cart-tax');
  if(subtotalEl) subtotalEl.textContent = (await formatMoney(subtotal)).toString();
  if(discountAmtEl) discountAmtEl.textContent = (await formatMoney(discountAmount)).toString();
  if(taxEl) taxEl.textContent = (await formatMoney(taxAmount)).toString();
  const cartTotalEl = document.getElementById('cart-total'); if(cartTotalEl) cartTotalEl.textContent = (await formatMoney(total)).toString();
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
    if(cart.length===0) return alert('Cart is empty');
    const subtotal = cart.reduce((s,c)=>s + (c.price * c.qty), 0);
    const discountPercent = parseFloat(document.getElementById('cart-discount')?.value || 0);
    const discountAmount = subtotal * (discountPercent/100);
    const taxRate = parseFloat((await OpenPOSDB.getSetting('tax.rate')) || 0);
    const taxable = Math.max(0, subtotal - discountAmount);
    const taxAmount = taxable * (taxRate/100);
    const total = parseFloat((taxable + taxAmount).toFixed(2));
    const sale = { items: cart.map(c=>({id:c.id,name:c.name,price:c.price,qty:c.qty})), customer: selectedCustomer, subtotal: parseFloat(subtotal.toFixed(2)), discountPercent, discountAmount: parseFloat(discountAmount.toFixed(2)), taxRate, taxAmount: parseFloat(taxAmount.toFixed(2)), total, at: new Date().toISOString() };
    await OpenPOSDB.add('sales', sale);
    lastSale = sale;
    cart = [];
    renderCart();
    alert('Sale recorded');
  });

// Settings: theme + language + currency + import/export
const themeSelect = document.getElementById('theme-select'); const langSelect = document.getElementById('lang-select'); const currencySelect = document.getElementById('currency-select');
// Translations for core UI strings (completed)
const TRANSLATIONS = {
  en: {
    nav: ['POS','Products','Customers','Users','Reports','Settings','Help','About'],
    welcomeTitle: 'Welcome to OpenPOS',
    getStarted: 'Get Started',
    learnMore: 'Learn More',
    login: 'Login',
    reset: 'Reset',
    logout: 'Logout',
    createAccount: 'Create account',
    printReceipt: 'Print Receipt',
    scanBarcode: 'Scan barcode',
    selectCustomer: 'Select/Add',
    searchPlaceholder: 'Search product by name or code',
    customerLabel: 'Customer',
    totalLabel: 'Total',
    completeSale: 'Complete Sale',
    productsTitle: 'Products',
    productAdd: 'Add / Update',
    exportProducts: 'Export Products CSV',
    customersTitle: 'Customers',
    customerAdd: 'Add Customer',
    exportCustomers: 'Export Customers CSV',
    usersTitle: 'Users & Roles',
    createUser: 'Create User',
    reportsTitle: 'Sales & Reports',
    generateReport: 'Generate Report',
    exportCsv: 'Export CSV (Excel)',
    exportPdf: 'Export PDF',
    themeLabel: 'Theme',
    languageLabel: 'Language',
    currencyLabel: 'Currency',
    autoSaveLabel: 'Auto Save',
    autosaveNote: 'Enable persistent save — Interval (minutes): ',
    saveAppData: 'Save AppData to file (AppData.json)',
    loadAppData: 'Load AppData from AppData file',
    chooseAppData: 'Choose AppData file (for autosave)',
    bizNamePlaceholder: 'Business name',
    bizEmailPlaceholder: 'email@example.com',
    bizPhonePlaceholder: 'Phone',
    bizAddressPlaceholder: 'Address',
    exportBackup: 'Export Backup',
    importBackup: 'Import Backup',
    downloadRecovery: 'Download Recovery File (password reset)',
    helpTitle: 'Help — User Manual',
    aboutTitle: 'About'
  },
  bn: {
    nav: ['পিওএস','পণ্য','গ্রাহক','ব্যবহারকারী','রিপোর্ট','সেটিংস','সহায়তা','সম্বন্ধে'],
    welcomeTitle: 'OpenPOS-এ স্বাগতম',
    getStarted: 'শুরু করুন',
    learnMore: 'আরও জানুন',
    login: 'লগইন',
    reset: 'রিসেট',
    logout: 'লগআউট',
    createAccount: 'একাউন্ট তৈরি করুন',
    printReceipt: 'রসিদ প্রিন্ট',
    scanBarcode: 'বারকোড স্ক্যান করুন',
    selectCustomer: 'গ্রাহক নির্বাচন/যোগ করুন',
    searchPlaceholder: 'পণ্যের নাম বা কোড দিয়ে খুঁজুন',
    customerLabel: 'গ্রাহক',
    totalLabel: 'মোট',
    completeSale: 'বিক্রয় সম্পন্ন করুন',
    productsTitle: 'পণ্য',
    productAdd: 'যোগ / আপডেট',
    exportProducts: 'পণ্য এক্সপোর্ট করুন (CSV)',
    customersTitle: 'গ্রাহক',
    customerAdd: 'গ্রাহক যোগ করুন',
    exportCustomers: 'গ্রাহক এক্সপোর্ট করুন (CSV)',
    usersTitle: 'ব্যবহারকারী ও ভূমিকা',
    createUser: 'ব্যবহারকারী তৈরি করুন',
    reportsTitle: 'বিক্রয় ও রিপোর্ট',
    generateReport: 'রিপোর্ট তৈরি করুন',
    exportCsv: 'CSV এক্সপোর্ট (Excel)',
    exportPdf: 'PDF এক্সপোর্ট',
    themeLabel: 'থিম',
    languageLabel: 'ভাষা',
    currencyLabel: 'মুদ্রা',
    autoSaveLabel: 'অটো সেভ',
    autosaveNote: 'পিতোসিস্টেন্ট সেভ চালু করুন — ইন্টারভাল (মিনিট): ',
    saveAppData: 'AppData ফাইল হিসেবে সংরক্ষণ (AppData.json)',
    loadAppData: 'AppData ফাইল থেকে লোড করুন',
    chooseAppData: 'AppData ফাইল নির্বাচন (Autosave জন্য)',
    bizNamePlaceholder: 'ব্যবসার নাম',
    bizEmailPlaceholder: 'email@example.com',
    bizPhonePlaceholder: 'ফোন',
    bizAddressPlaceholder: 'ঠিকানা',
    exportBackup: 'ব্যাকআপ এক্সপোর্ট',
    importBackup: 'ব্যাকআপ ইম্পোর্ট',
    downloadRecovery: 'রিকভারি ফাইল ডাউনলোড (পাসওয়ার্ড রিসেট)',
    helpTitle: 'সহায়তা — ব্যবহারকারীর ম্যানুয়াল',
    aboutTitle: 'সম্বন্ধে'
  },
  fr: {
    nav: ['POS','Produits','Clients','Utilisateurs','Rapports','Paramètres','Aide','À propos'],
    welcomeTitle: 'Bienvenue sur OpenPOS',
    getStarted: 'Commencer',
    learnMore: 'En savoir plus',
    login: 'Connexion',
    reset: 'Réinitialiser',
    logout: 'Déconnexion',
    createAccount: 'Créer un compte',
    printReceipt: 'Imprimer le reçu',
    scanBarcode: 'Scanner le code-barres',
    selectCustomer: 'Sélectionner/Ajouter',
    searchPlaceholder: 'Rechercher un produit par nom ou code',
    customerLabel: 'Client',
    totalLabel: 'Total',
    completeSale: 'Finaliser la vente',
    productsTitle: 'Produits',
    productAdd: 'Ajouter / Mettre à jour',
    exportProducts: 'Exporter produits (CSV)',
    customersTitle: 'Clients',
    customerAdd: 'Ajouter client',
    exportCustomers: 'Exporter clients (CSV)',
    usersTitle: 'Utilisateurs et rôles',
    createUser: 'Créer un utilisateur',
    reportsTitle: 'Ventes et rapports',
    generateReport: 'Générer le rapport',
    exportCsv: 'Exporter CSV (Excel)',
    exportPdf: 'Exporter PDF',
    themeLabel: 'Thème',
    languageLabel: 'Langue',
    currencyLabel: 'Devise',
    autoSaveLabel: 'Auto Enregistrer',
    autosaveNote: 'Activer la sauvegarde persistante — Intervalle (minutes): ',
    saveAppData: 'Enregistrer AppData dans un fichier (AppData.json)',
    loadAppData: 'Charger AppData depuis un fichier',
    chooseAppData: 'Choisir le fichier AppData (pour autosave)',
    bizNamePlaceholder: 'Nom de l’entreprise',
    bizEmailPlaceholder: 'email@example.com',
    bizPhonePlaceholder: 'Téléphone',
    bizAddressPlaceholder: 'Adresse',
    exportBackup: 'Exporter la sauvegarde',
    importBackup: 'Importer la sauvegarde',
    downloadRecovery: 'Télécharger le fichier de récupération (réinitialisation du mot de passe)',
    helpTitle: 'Aide — Manuel utilisateur',
    aboutTitle: 'À propos'
  },
  de: {
    nav: ['POS','Produkte','Kunden','Benutzer','Berichte','Einstellungen','Hilfe','Über'],
    welcomeTitle: 'Willkommen bei OpenPOS',
    getStarted: 'Loslegen',
    learnMore: 'Mehr erfahren',
    login: 'Anmelden',
    reset: 'Zurücksetzen',
    logout: 'Abmelden',
    createAccount: 'Konto erstellen',
    printReceipt: 'Beleg drucken',
    scanBarcode: 'Barcode scannen',
    selectCustomer: 'Kunde auswählen/hinzufügen',
    searchPlaceholder: 'Produkt nach Name oder Code suchen',
    customerLabel: 'Kunde',
    totalLabel: 'Gesamt',
    completeSale: 'Verkauf abschließen',
    productsTitle: 'Produkte',
    productAdd: 'Hinzufügen / Aktualisieren',
    exportProducts: 'Produkte exportieren (CSV)',
    customersTitle: 'Kunden',
    customerAdd: 'Kunden hinzufügen',
    exportCustomers: 'Kunden exportieren (CSV)',
    usersTitle: 'Benutzer & Rollen',
    createUser: 'Benutzer erstellen',
    reportsTitle: 'Verkäufe & Berichte',
    generateReport: 'Bericht erstellen',
    exportCsv: 'CSV exportieren (Excel)',
    exportPdf: 'PDF exportieren',
    themeLabel: 'Design',
    languageLabel: 'Sprache',
    currencyLabel: 'Währung',
    autoSaveLabel: 'Automatisch speichern',
    autosaveNote: 'Persistentes Speichern aktivieren — Intervall (Minuten): ',
    saveAppData: 'AppData in Datei speichern (AppData.json)',
    loadAppData: 'AppData aus Datei laden',
    chooseAppData: 'AppData-Datei wählen (für Autosave)',
    bizNamePlaceholder: 'Firmenname',
    bizEmailPlaceholder: 'email@example.com',
    bizPhonePlaceholder: 'Telefon',
    bizAddressPlaceholder: 'Adresse',
    exportBackup: 'Backup exportieren',
    importBackup: 'Backup importieren',
    downloadRecovery: 'Wiederherstellungsdatei herunterladen (Passwort zurücksetzen)',
    helpTitle: 'Hilfe — Benutzerhandbuch',
    aboutTitle: 'Über'
  },
  'zh-CN': {
    nav: ['收银','商品','客户','用户','报表','设置','帮助','关于'],
    welcomeTitle: '欢迎使用 OpenPOS',
    getStarted: '开始使用',
    learnMore: '了解更多',
    login: '登录',
    reset: '重置',
    logout: '登出',
    createAccount: '创建账户',
    printReceipt: '打印小票',
    scanBarcode: '扫描条码',
    selectCustomer: '选择/添加客户',
    searchPlaceholder: '按名称或编码搜索商品',
    customerLabel: '客户',
    totalLabel: '总计',
    completeSale: '完成销售',
    productsTitle: '商品',
    productAdd: '添加 / 更新',
    exportProducts: '导出商品 (CSV)',
    customersTitle: '客户',
    customerAdd: '添加客户',
    exportCustomers: '导出客户 (CSV)',
    usersTitle: '用户与角色',
    createUser: '创建用户',
    reportsTitle: '销售与报表',
    generateReport: '生成报表',
    exportCsv: '导出 CSV (Excel)',
    exportPdf: '导出 PDF',
    themeLabel: '主题',
    languageLabel: '语言',
    currencyLabel: '货币',
    autoSaveLabel: '自动保存',
    autosaveNote: '启用持久保存 — 间隔（分钟）：',
    saveAppData: '将 AppData 保存为文件 (AppData.json)',
    loadAppData: '从 AppData 文件加载',
    chooseAppData: '选择 AppData 文件（用于自动保存）',
    bizNamePlaceholder: '商家名称',
    bizEmailPlaceholder: 'email@example.com',
    bizPhonePlaceholder: '电话',
    bizAddressPlaceholder: '地址',
    exportBackup: '导出备份',
    importBackup: '导入备份',
    downloadRecovery: '下载恢复文件（重置密码）',
    helpTitle: '帮助 — 用户手册',
    aboutTitle: '关于'
  },
  'zh-TW': {
    nav: ['收銀','商品','客戶','使用者','報表','設定','說明','關於'],
    welcomeTitle: '歡迎使用 OpenPOS',
    getStarted: '開始使用',
    learnMore: '了解更多',
    login: '登入',
    reset: '重設',
    logout: '登出',
    createAccount: '建立帳戶',
    printReceipt: '列印收據',
    scanBarcode: '掃描條碼',
    selectCustomer: '選擇/新增客戶',
    searchPlaceholder: '以名稱或代碼搜尋商品',
    customerLabel: '客戶',
    totalLabel: '總計',
    completeSale: '完成銷售',
    productsTitle: '商品',
    productAdd: '新增 / 更新',
    exportProducts: '匯出商品 (CSV)',
    customersTitle: '客戶',
    customerAdd: '新增客戶',
    exportCustomers: '匯出客戶 (CSV)',
    usersTitle: '使用者與角色',
    createUser: '建立使用者',
    reportsTitle: '銷售與報表',
    generateReport: '產生報表',
    exportCsv: '匯出 CSV (Excel)',
    exportPdf: '匯出 PDF',
    themeLabel: '主題',
    languageLabel: '語言',
    currencyLabel: '貨幣',
    autoSaveLabel: '自動儲存',
    autosaveNote: '啟用持久儲存 — 間隔（分鐘）：',
    saveAppData: '將 AppData 儲存為檔案 (AppData.json)',
    loadAppData: '從 AppData 檔案載入',
    chooseAppData: '選擇 AppData 檔案（用於自動儲存）',
    bizNamePlaceholder: '商家名稱',
    bizEmailPlaceholder: 'email@example.com',
    bizPhonePlaceholder: '電話',
    bizAddressPlaceholder: '地址',
    exportBackup: '匯出備份',
    importBackup: '匯入備份',
    downloadRecovery: '下載復原檔案（重設密碼）',
    helpTitle: '說明 — 使用者手冊',
    aboutTitle: '關於'
  },
  zh: {
    nav: ['收银','商品','客户','用户','报表','设置','帮助','关于'],
    welcomeTitle: '欢迎使用 OpenPOS',
    getStarted: '开始使用',
    learnMore: '了解更多',
    login: '登录',
    reset: '重置',
    logout: '登出',
    createAccount: '创建账户',
    printReceipt: '打印小票',
    scanBarcode: '扫描条码',
    selectCustomer: '选择/添加客户',
    searchPlaceholder: '按名称或编码搜索商品',
    customerLabel: '客户',
    totalLabel: '总计',
    completeSale: '完成销售',
    productsTitle: '商品',
    productAdd: '添加 / 更新',
    exportProducts: '导出商品 (CSV)',
    customersTitle: '客户',
    customerAdd: '添加客户',
    exportCustomers: '导出客户 (CSV)',
    usersTitle: '用户与角色',
    createUser: '创建用户',
    reportsTitle: '销售与报表',
    generateReport: '生成报表',
    exportCsv: '导出 CSV (Excel)',
    exportPdf: '导出 PDF',
    themeLabel: '主题',
    languageLabel: '语言',
    currencyLabel: '货币',
    autoSaveLabel: '自动保存',
    autosaveNote: '启用持久保存 — 间隔（分钟）：',
    saveAppData: '将 AppData 保存为文件 (AppData.json)',
    loadAppData: '从 AppData 文件加载',
    chooseAppData: '选择 AppData 文件（用于自动保存）',
    bizNamePlaceholder: '商家名称',
    bizEmailPlaceholder: 'email@example.com',
    bizPhonePlaceholder: '电话',
    bizAddressPlaceholder: '地址',
    exportBackup: '导出备份',
    importBackup: '导入备份',
    downloadRecovery: '下载恢复文件（重置密码）',
    helpTitle: '帮助 — 用户手册',
    aboutTitle: '关于'
  },
  ar: {
    nav: ['نقطة بيع','المنتجات','العملاء','المستخدمون','التقارير','الإعدادات','مساعدة','حول'],
    welcomeTitle: 'مرحبًا بك في OpenPOS',
    getStarted: 'ابدأ',
    learnMore: 'معرفة المزيد',
    login: 'تسجيل الدخول',
    reset: 'إعادة تعيين',
    logout: 'تسجيل الخروج',
    createAccount: 'إنشاء حساب',
    printReceipt: 'طباعة الإيصال',
    scanBarcode: 'مسح الباركود',
    selectCustomer: 'اختر/أضف',
    searchPlaceholder: 'ابحث عن المنتج بالاسم أو الرمز',
    customerLabel: 'العميل',
    totalLabel: 'الإجمالي',
    completeSale: 'إتمام البيع',
    productsTitle: 'المنتجات',
    productAdd: 'إضافة / تحديث',
    exportProducts: 'تصدير المنتجات (CSV)',
    customersTitle: 'العملاء',
    customerAdd: 'إضافة عميل',
    exportCustomers: 'تصدير العملاء (CSV)',
    usersTitle: 'المستخدمون والأدوار',
    createUser: 'إنشاء مستخدم',
    reportsTitle: 'المبيعات والتقارير',
    generateReport: 'إنشاء تقرير',
    exportCsv: 'تصدير CSV (Excel)',
    exportPdf: 'تصدير PDF',
    themeLabel: 'السمة',
    languageLabel: 'اللغة',
    currencyLabel: 'العملة',
    autoSaveLabel: 'الحفظ التلقائي',
    autosaveNote: 'تفعيل الحفظ المستمر — الفاصل (دقائق): ',
    saveAppData: 'حفظ AppData إلى ملف (AppData.json)',
    loadAppData: 'تحميل AppData من ملف',
    chooseAppData: 'اختر ملف AppData (للحفظ التلقائي)',
    bizNamePlaceholder: 'اسم النشاط التجاري',
    bizEmailPlaceholder: 'email@example.com',
    bizPhonePlaceholder: 'الهاتف',
    bizAddressPlaceholder: 'العنوان',
    exportBackup: 'تصدير النسخة الاحتياطية',
    importBackup: 'استيراد النسخة الاحتياطية',
    downloadRecovery: 'تنزيل ملف الاسترداد (إعادة تعيين كلمة المرور)',
    helpTitle: 'مساعدة — دليل المستخدم',
    aboutTitle: 'حول'
  },
  hi: {
    nav: ['POS','उत्पाद','ग्राहक','उपयोगकर्ता','रिपोर्ट','सेटिंग्स','सहायता','बारे में'],
    welcomeTitle: 'OpenPOS में आपका स्वागत है',
    getStarted: 'शुरू करें',
    learnMore: 'और जानें',
    login: 'लॉगिन',
    reset: 'रीसेट',
    logout: 'लॉगआउट',
    createAccount: 'खाता बनाएं',
    printReceipt: 'रसीद प्रिंट करें',
    scanBarcode: 'बारकोड स्कैन करें',
    selectCustomer: 'ग्राहक चुनें/जोड़ें',
    searchPlaceholder: 'नाम या कोड से उत्पाद खोजें',
    customerLabel: 'ग्राहक',
    totalLabel: 'कुल',
    completeSale: 'बिक्री पूरी करें',
    productsTitle: 'उत्पाद',
    productAdd: 'जोड़ें / अपडेट करें',
    exportProducts: 'उत्पाद निर्यात करें (CSV)',
    customersTitle: 'ग्राहक',
    customerAdd: 'ग्राहक जोड़ें',
    exportCustomers: 'ग्राहक निर्यात करें (CSV)',
    usersTitle: 'उपयोगकर्ता और भूमिकाएँ',
    createUser: 'उपयोगकर्ता बनाएं',
    reportsTitle: 'बिक्री और रिपोर्ट',
    generateReport: 'रिपोर्ट बनाएं',
    exportCsv: 'CSV निर्यात करें (Excel)',
    exportPdf: 'PDF निर्यात करें',
    themeLabel: 'थीम',
    languageLabel: 'भाषा',
    currencyLabel: 'मुद्रा',
    autoSaveLabel: 'स्वचालित सहेजें',
    autosaveNote: 'स्थायी सहेज सक्षम करें — अंतराल (मिनट): ',
    saveAppData: 'AppData को फ़ाइल में सहेजें (AppData.json)',
    loadAppData: 'AppData फ़ाइल से लोड करें',
    chooseAppData: 'AppData फ़ाइल चुनें (ऑटोसेव के लिए)',
    bizNamePlaceholder: 'व्यवसाय का नाम',
    bizEmailPlaceholder: 'email@example.com',
    bizPhonePlaceholder: 'फ़ोन',
    bizAddressPlaceholder: 'पता',
    exportBackup: 'बैकअप निर्यात करें',
    importBackup: 'बैकअप आयात करें',
    downloadRecovery: 'रिकवरी फ़ाइल डाउनलोड करें (पासवर्ड रीसेट)',
    helpTitle: 'सहायता — उपयोगकर्ता मैनुअल',
    aboutTitle: 'बारे में'
  },
  ur: {
    nav: ['POS','مصنوعات','گاہک','صارفین','رپورٹس','ترتیبات','مدد','کے بارے میں'],
    welcomeTitle: 'OpenPOS میں خوش آمدید',
    getStarted: 'شروع کریں',
    learnMore: 'مزید جانیں',
    login: 'لاگ ان',
    reset: 'ری سیٹ',
    logout: 'لاگ آؤٹ',
    createAccount: 'اکاؤنٹ بنائیں',
    printReceipt: 'رسید پرنٹ کریں',
    scanBarcode: 'بارکوڈ اسکین کریں',
    selectCustomer: 'گاہک منتخب/شامل کریں',
    searchPlaceholder: 'نام یا کوڈ سے پروڈکٹ تلاش کریں',
    customerLabel: 'گاہک',
    totalLabel: 'کل',
    completeSale: 'فروخت مکمل کریں',
    productsTitle: 'مصنوعات',
    productAdd: 'شامل کریں / اپ ڈیٹ کریں',
    exportProducts: 'مصنوعات برآمد کریں (CSV)',
    customersTitle: 'گاہک',
    customerAdd: 'گاہک شامل کریں',
    exportCustomers: 'گاہک برآمد کریں (CSV)',
    usersTitle: 'صارفین اور کردار',
    createUser: 'صارف بنائیں',
    reportsTitle: 'فروخت اور رپورٹس',
    generateReport: 'رپورٹ بنائیں',
    exportCsv: 'CSV برآمد کریں (Excel)',
    exportPdf: 'PDF برآمد کریں',
    themeLabel: 'تھیم',
    languageLabel: 'زبان',
    currencyLabel: 'کرنسی',
    autoSaveLabel: 'خودکار محفوظ',
    autosaveNote: 'مستقل محفوظ فعال کریں — وقفہ (منٹ): ',
    saveAppData: 'AppData کو فائل میں محفوظ کریں (AppData.json)',
    loadAppData: 'AppData فائل سے لوڈ کریں',
    chooseAppData: 'AppData فائل منتخب کریں (Autosave کے لیے)',
    bizNamePlaceholder: 'کاروبار کا نام',
    bizEmailPlaceholder: 'email@example.com',
    bizPhonePlaceholder: 'فون',
    bizAddressPlaceholder: 'پتہ',
    exportBackup: 'بیک اپ برآمد کریں',
    importBackup: 'بیک اپ درآمد کریں',
    downloadRecovery: 'ریکوری فائل ڈاؤن لوڈ کریں (پاس ورڈ ری سیٹ)',
    helpTitle: 'مدد — صارف دستی',
    aboutTitle: 'کے بارے میں'
  },
  pt: {
    nav: ['PDV','Produtos','Clientes','Usuários','Relatórios','Configurações','Ajuda','Sobre'],
    welcomeTitle: 'Bem-vindo ao OpenPOS',
    getStarted: 'Começar',
    learnMore: 'Saiba mais',
    login: 'Entrar',
    reset: 'Redefinir',
    logout: 'Sair',
    createAccount: 'Criar conta',
    printReceipt: 'Imprimir recibo',
    scanBarcode: 'Ler código de barras',
    selectCustomer: 'Selecionar/Adicionar',
    searchPlaceholder: 'Pesquisar produto por nome ou código',
    customerLabel: 'Cliente',
    totalLabel: 'Total',
    completeSale: 'Finalizar venda',
    productsTitle: 'Produtos',
    productAdd: 'Adicionar / Atualizar',
    exportProducts: 'Exportar produtos (CSV)',
    customersTitle: 'Clientes',
    customerAdd: 'Adicionar cliente',
    exportCustomers: 'Exportar clientes (CSV)',
    usersTitle: 'Usuários e Funções',
    createUser: 'Criar usuário',
    reportsTitle: 'Vendas e Relatórios',
    generateReport: 'Gerar relatório',
    exportCsv: 'Exportar CSV (Excel)',
    exportPdf: 'Exportar PDF',
    themeLabel: 'Tema',
    languageLabel: 'Idioma',
    currencyLabel: 'Moeda',
    autoSaveLabel: 'Salvar automaticamente',
    autosaveNote: 'Ativar salvamento persistente — Intervalo (minutos): ',
    saveAppData: 'Salvar AppData em arquivo (AppData.json)',
    loadAppData: 'Carregar AppData de arquivo',
    chooseAppData: 'Escolher arquivo AppData (para autosave)',
    bizNamePlaceholder: 'Nome do negócio',
    bizEmailPlaceholder: 'email@example.com',
    bizPhonePlaceholder: 'Telefone',
    bizAddressPlaceholder: 'Endereço',
    exportBackup: 'Exportar backup',
    importBackup: 'Importar backup',
    downloadRecovery: 'Baixar arquivo de recuperação (redefinir senha)',
    helpTitle: 'Ajuda — Manual do usuário',
    aboutTitle: 'Sobre'
  },
  ru: {
    nav: ['POS','Товары','Клиенты','Пользователи','Отчёты','Настройки','Помощь','О программе'],
    welcomeTitle: 'Добро пожаловать в OpenPOS',
    getStarted: 'Начать',
    learnMore: 'Узнать больше',
    login: 'Войти',
    reset: 'Сброс',
    logout: 'Выйти',
    createAccount: 'Создать аккаунт',
    printReceipt: 'Печать чека',
    scanBarcode: 'Сканировать штрихкод',
    selectCustomer: 'Выбрать/Добавить',
    searchPlaceholder: 'Поиск товара по имени или коду',
    customerLabel: 'Клиент',
    totalLabel: 'Итого',
    completeSale: 'Завершить продажу',
    productsTitle: 'Товары',
    productAdd: 'Добавить / Обновить',
    exportProducts: 'Экспорт товаров (CSV)',
    customersTitle: 'Клиенты',
    customerAdd: 'Добавить клиента',
    exportCustomers: 'Экспорт клиентов (CSV)',
    usersTitle: 'Пользователи и роли',
    createUser: 'Создать пользователя',
    reportsTitle: 'Продажи и отчёты',
    generateReport: 'Сформировать отчёт',
    exportCsv: 'Экспорт CSV (Excel)',
    exportPdf: 'Экспорт PDF',
    themeLabel: 'Тема',
    languageLabel: 'Язык',
    currencyLabel: 'Валюта',
    autoSaveLabel: 'Автосохранение',
    autosaveNote: 'Включить постоянное сохранение — Интервал (минут): ',
    saveAppData: 'Сохранить AppData в файл (AppData.json)',
    loadAppData: 'Загрузить AppData из файла',
    chooseAppData: 'Выбрать файл AppData (для автосохранения)',
    bizNamePlaceholder: 'Название бизнеса',
    bizEmailPlaceholder: 'email@example.com',
    bizPhonePlaceholder: 'Телефон',
    bizAddressPlaceholder: 'Адрес',
    exportBackup: 'Экспорт резервной копии',
    importBackup: 'Импорт резервной копии',
    downloadRecovery: 'Скачать файл восстановления (сброс пароля)',
    helpTitle: 'Помощь — Руководство пользователя',
    aboutTitle: 'О программе'
  },
  id: {
    nav: ['POS','Produk','Pelanggan','Pengguna','Laporan','Pengaturan','Bantuan','Tentang'],
    welcomeTitle: 'Selamat datang di OpenPOS',
    getStarted: 'Mulai',
    learnMore: 'Pelajari lebih lanjut',
    login: 'Masuk',
    reset: 'Reset',
    logout: 'Keluar',
    createAccount: 'Buat akun',
    printReceipt: 'Cetak struk',
    scanBarcode: 'Pindai barcode',
    selectCustomer: 'Pilih/Tambah',
    searchPlaceholder: 'Cari produk berdasarkan nama atau kode',
    customerLabel: 'Pelanggan',
    totalLabel: 'Total',
    completeSale: 'Selesaikan penjualan',
    productsTitle: 'Produk',
    productAdd: 'Tambah / Perbarui',
    exportProducts: 'Ekspor produk (CSV)',
    customersTitle: 'Pelanggan',
    customerAdd: 'Tambah pelanggan',
    exportCustomers: 'Ekspor pelanggan (CSV)',
    usersTitle: 'Pengguna & Peran',
    createUser: 'Buat pengguna',
    reportsTitle: 'Penjualan & Laporan',
    generateReport: 'Buat laporan',
    exportCsv: 'Ekspor CSV (Excel)',
    exportPdf: 'Ekspor PDF',
    themeLabel: 'Tema',
    languageLabel: 'Bahasa',
    currencyLabel: 'Mata uang',
    autoSaveLabel: 'Simpan Otomatis',
    autosaveNote: 'Aktifkan penyimpanan persisten — Interval (menit): ',
    saveAppData: 'Simpan AppData ke file (AppData.json)',
    loadAppData: 'Muat AppData dari file',
    chooseAppData: 'Pilih file AppData (untuk autosave)',
    bizNamePlaceholder: 'Nama usaha',
    bizEmailPlaceholder: 'email@example.com',
    bizPhonePlaceholder: 'Telepon',
    bizAddressPlaceholder: 'Alamat',
    exportBackup: 'Ekspor cadangan',
    importBackup: 'Impor cadangan',
    downloadRecovery: 'Unduh file pemulihan (reset kata sandi)',
    helpTitle: 'Bantuan — Manual pengguna',
    aboutTitle: 'Tentang'
  },
  ms: {
    nav: ['POS','Produk','Pelanggan','Pengguna','Laporan','Tetapan','Bantuan','Mengenai'],
    welcomeTitle: 'Selamat datang ke OpenPOS',
    getStarted: 'Mula',
    learnMore: 'Ketahui lebih lanjut',
    login: 'Log masuk',
    reset: 'Tetapkan semula',
    logout: 'Log keluar',
    createAccount: 'Buat akaun',
    printReceipt: 'Cetak resit',
    scanBarcode: 'Imbas kod bar',
    selectCustomer: 'Pilih/Tambah',
    searchPlaceholder: 'Cari produk mengikut nama atau kod',
    customerLabel: 'Pelanggan',
    totalLabel: 'Jumlah',
    completeSale: 'Selesaikan jualan',
    productsTitle: 'Produk',
    productAdd: 'Tambah / Kemas kini',
    exportProducts: 'Eksport produk (CSV)',
    customersTitle: 'Pelanggan',
    customerAdd: 'Tambah pelanggan',
    exportCustomers: 'Eksport pelanggan (CSV)',
    usersTitle: 'Pengguna & Peranan',
    createUser: 'Buat pengguna',
    reportsTitle: 'Jualan & Laporan',
    generateReport: 'Jana laporan',
    exportCsv: 'Eksport CSV (Excel)',
    exportPdf: 'Eksport PDF',
    themeLabel: 'Tema',
    languageLabel: 'Bahasa',
    currencyLabel: 'Mata wang',
    autoSaveLabel: 'Simpan Automatik',
    autosaveNote: 'Dayakan simpanan berterusan — Selang (minit): ',
    saveAppData: 'Simpan AppData ke fail (AppData.json)',
    loadAppData: 'Muat AppData dari fail',
    chooseAppData: 'Pilih fail AppData (untuk autosave)',
    bizNamePlaceholder: 'Nama perniagaan',
    bizEmailPlaceholder: 'email@example.com',
    bizPhonePlaceholder: 'Telefon',
    bizAddressPlaceholder: 'Alamat',
    exportBackup: 'Eksport sandaran',
    importBackup: 'Import sandaran',
    downloadRecovery: 'Muat turun fail pemulihan (tetapkan semula kata laluan)',
    helpTitle: 'Bantuan — Manual pengguna',
    aboutTitle: 'Mengenai'
  },
  ja: {
    nav: ['POS','商品','顧客','ユーザー','レポート','設定','ヘルプ','概要'],
    welcomeTitle: 'OpenPOSへようこそ',
    getStarted: '始める',
    learnMore: '詳しく知る',
    login: 'ログイン',
    reset: 'リセット',
    logout: 'ログアウト',
    createAccount: 'アカウント作成',
    printReceipt: 'レシートを印刷',
    scanBarcode: 'バーコードをスキャン',
    selectCustomer: '選択/追加',
    searchPlaceholder: '名前またはコードで商品を検索',
    customerLabel: '顧客',
    totalLabel: '合計',
    completeSale: '販売を完了',
    productsTitle: '商品',
    productAdd: '追加 / 更新',
    exportProducts: '商品をエクスポート (CSV)',
    customersTitle: '顧客',
    customerAdd: '顧客を追加',
    exportCustomers: '顧客をエクスポート (CSV)',
    usersTitle: 'ユーザーと役割',
    createUser: 'ユーザーを作成',
    reportsTitle: '売上とレポート',
    generateReport: 'レポートを生成',
    exportCsv: 'CSVをエクスポート (Excel)',
    exportPdf: 'PDFをエクスポート',
    themeLabel: 'テーマ',
    languageLabel: '言語',
    currencyLabel: '通貨',
    autoSaveLabel: '自動保存',
    autosaveNote: '永続保存を有効にする — 間隔（分）：',
    saveAppData: 'AppDataをファイルに保存 (AppData.json)',
    loadAppData: 'AppDataファイルから読み込む',
    chooseAppData: 'AppDataファイルを選択（自動保存用）',
    bizNamePlaceholder: '事業名',
    bizEmailPlaceholder: 'email@example.com',
    bizPhonePlaceholder: '電話',
    bizAddressPlaceholder: '住所',
    exportBackup: 'バックアップをエクスポート',
    importBackup: 'バックアップをインポート',
    downloadRecovery: 'リカバリファイルをダウンロード（パスワードリセット）',
    helpTitle: 'ヘルプ — ユーザーマニュアル',
    aboutTitle: '概要'
  },
  ko: {
    nav: ['POS','상품','고객','사용자','보고서','설정','도움말','정보'],
    welcomeTitle: 'OpenPOS에 오신 것을 환영합니다',
    getStarted: '시작하기',
    learnMore: '자세히 알아보기',
    login: '로그인',
    reset: '재설정',
    logout: '로그아웃',
    createAccount: '계정 생성',
    printReceipt: '영수증 인쇄',
    scanBarcode: '바코드 스캔',
    selectCustomer: '선택/추가',
    searchPlaceholder: '이름 또는 코드로 상품 검색',
    customerLabel: '고객',
    totalLabel: '합계',
    completeSale: '판매 완료',
    productsTitle: '상품',
    productAdd: '추가 / 업데이트',
    exportProducts: '상품 내보내기 (CSV)',
    customersTitle: '고객',
    customerAdd: '고객 추가',
    exportCustomers: '고객 내보내기 (CSV)',
    usersTitle: '사용자 및 역할',
    createUser: '사용자 생성',
    reportsTitle: '판매 및 보고서',
    generateReport: '보고서 생성',
    exportCsv: 'CSV 내보내기 (Excel)',
    exportPdf: 'PDF 내보내기',
    themeLabel: '테마',
    languageLabel: '언어',
    currencyLabel: '통화',
    autoSaveLabel: '자동 저장',
    autosaveNote: '지속 저장 활성화 — 간격(분): ',
    saveAppData: 'AppData를 파일로 저장 (AppData.json)',
    loadAppData: 'AppData 파일에서 불러오기',
    chooseAppData: 'AppData 파일 선택 (자동 저장용)',
    bizNamePlaceholder: '사업자명',
    bizEmailPlaceholder: 'email@example.com',
    bizPhonePlaceholder: '전화',
    bizAddressPlaceholder: '주소',
    exportBackup: '백업 내보내기',
    importBackup: '백업 가져오기',
    downloadRecovery: '복구 파일 다운로드 (비밀번호 재설정)',
    helpTitle: '도움말 — 사용자 설명서',
    aboutTitle: '정보'
  },
  tr: {
    nav: ['POS','Ürünler','Müşteriler','Kullanıcılar','Raporlar','Ayarlar','Yardım','Hakkında'],
    welcomeTitle: 'OpenPOS\'a hoş geldiniz',
    getStarted: 'Başlayın',
    learnMore: 'Daha fazla bilgi',
    login: 'Giriş',
    reset: 'Sıfırla',
    logout: 'Çıkış',
    createAccount: 'Hesap oluştur',
    printReceipt: 'Fişi yazdır',
    scanBarcode: 'Barkodu tara',
    selectCustomer: 'Seç/Ekle',
    searchPlaceholder: 'Ürünü ad veya kod ile ara',
    customerLabel: 'Müşteri',
    totalLabel: 'Toplam',
    completeSale: 'Satışı tamamla',
    productsTitle: 'Ürünler',
    productAdd: 'Ekle / Güncelle',
    exportProducts: 'Ürünleri dışa aktar (CSV)',
    customersTitle: 'Müşteriler',
    customerAdd: 'Müşteri ekle',
    exportCustomers: 'Müşterileri dışa aktar (CSV)',
    usersTitle: 'Kullanıcılar ve Roller',
    createUser: 'Kullanıcı oluştur',
    reportsTitle: 'Satışlar ve Raporlar',
    generateReport: 'Rapor oluştur',
    exportCsv: 'CSV dışa aktar (Excel)',
    exportPdf: 'PDF dışa aktar',
    themeLabel: 'Tema',
    languageLabel: 'Dil',
    currencyLabel: 'Para birimi',
    autoSaveLabel: 'Otomatik Kaydet',
    autosaveNote: 'Kalıcı kaydı etkinleştir — Aralık (dakika): ',
    saveAppData: 'AppData dosyaya kaydet (AppData.json)',
    loadAppData: 'AppData dosyasından yükle',
    chooseAppData: 'AppData dosyası seç (otomatik kaydet için)',
    bizNamePlaceholder: 'İşletme adı',
    bizEmailPlaceholder: 'email@example.com',
    bizPhonePlaceholder: 'Telefon',
    bizAddressPlaceholder: 'Adres',
    exportBackup: 'Yedek dışa aktar',
    importBackup: 'Yedek içe aktar',
    downloadRecovery: 'Kurtarma dosyasını indir (şifre sıfırlama)',
    helpTitle: 'Yardım — Kullanıcı Kılavuzu',
    aboutTitle: 'Hakkında'
  },
  vi: {
    nav: ['POS','Sản phẩm','Khách hàng','Người dùng','Báo cáo','Cài đặt','Trợ giúp','Giới thiệu'],
    welcomeTitle: 'Chào mừng đến với OpenPOS',
    getStarted: 'Bắt đầu',
    learnMore: 'Tìm hiểu thêm',
    login: 'Đăng nhập',
    reset: 'Đặt lại',
    logout: 'Đăng xuất',
    createAccount: 'Tạo tài khoản',
    printReceipt: 'In hóa đơn',
    scanBarcode: 'Quét mã vạch',
    selectCustomer: 'Chọn/Thêm',
    searchPlaceholder: 'Tìm sản phẩm theo tên hoặc mã',
    customerLabel: 'Khách hàng',
    totalLabel: 'Tổng',
    completeSale: 'Hoàn tất bán hàng',
    productsTitle: 'Sản phẩm',
    productAdd: 'Thêm / Cập nhật',
    exportProducts: 'Xuất sản phẩm (CSV)',
    customersTitle: 'Khách hàng',
    customerAdd: 'Thêm khách hàng',
    exportCustomers: 'Xuất khách hàng (CSV)',
    usersTitle: 'Người dùng & Vai trò',
    createUser: 'Tạo người dùng',
    reportsTitle: 'Bán hàng & Báo cáo',
    generateReport: 'Tạo báo cáo',
    exportCsv: 'Xuất CSV (Excel)',
    exportPdf: 'Xuất PDF',
    themeLabel: 'Giao diện',
    languageLabel: 'Ngôn ngữ',
    currencyLabel: 'Tiền tệ',
    autoSaveLabel: 'Tự động lưu',
    autosaveNote: 'Bật lưu liên tục — Khoảng (phút): ',
    saveAppData: 'Lưu AppData vào tệp (AppData.json)',
    loadAppData: 'Tải AppData từ tệp',
    chooseAppData: 'Chọn tệp AppData (cho autosave)',
    bizNamePlaceholder: 'Tên doanh nghiệp',
    bizEmailPlaceholder: 'email@example.com',
    bizPhonePlaceholder: 'Điện thoại',
    bizAddressPlaceholder: 'Địa chỉ',
    exportBackup: 'Xuất sao lưu',
    importBackup: 'Nhập sao lưu',
    downloadRecovery: 'Tải tệp khôi phục (đặt lại mật khẩu)',
    helpTitle: 'Trợ giúp — Hướng dẫn sử dụng',
    aboutTitle: 'Giới thiệu'
  },
  it: {
    nav: ['POS','Prodotti','Clienti','Utenti','Report','Impostazioni','Aiuto','Informazioni'],
    welcomeTitle: 'Benvenuto in OpenPOS',
    getStarted: 'Inizia',
    learnMore: 'Per saperne di più',
    login: 'Accedi',
    reset: 'Reimposta',
    logout: 'Disconnetti',
    createAccount: 'Crea account',
    printReceipt: 'Stampa ricevuta',
    scanBarcode: 'Scansiona codice a barre',
    selectCustomer: 'Seleziona/Aggiungi',
    searchPlaceholder: 'Cerca prodotto per nome o codice',
    customerLabel: 'Cliente',
    totalLabel: 'Totale',
    completeSale: 'Completa vendita',
    productsTitle: 'Prodotti',
    productAdd: 'Aggiungi / Aggiorna',
    exportProducts: 'Esporta prodotti (CSV)',
    customersTitle: 'Clienti',
    customerAdd: 'Aggiungi cliente',
    exportCustomers: 'Esporta clienti (CSV)',
    usersTitle: 'Utenti e Ruoli',
    createUser: 'Crea utente',
    reportsTitle: 'Vendite e Report',
    generateReport: 'Genera report',
    exportCsv: 'Esporta CSV (Excel)',
    exportPdf: 'Esporta PDF',
    themeLabel: 'Tema',
    languageLabel: 'Lingua',
    currencyLabel: 'Valuta',
    autoSaveLabel: 'Salvataggio automatico',
    autosaveNote: 'Abilita salvataggio persistente — Intervallo (minuti): ',
    saveAppData: 'Salva AppData su file (AppData.json)',
    loadAppData: 'Carica AppData da file',
    chooseAppData: 'Scegli file AppData (per autosave)',
    bizNamePlaceholder: 'Nome attività',
    bizEmailPlaceholder: 'email@example.com',
    bizPhonePlaceholder: 'Telefono',
    bizAddressPlaceholder: 'Indirizzo',
    exportBackup: 'Esporta backup',
    importBackup: 'Importa backup',
    downloadRecovery: 'Scarica file di recupero (reimposta password)',
    helpTitle: 'Aiuto — Manuale utente',
    aboutTitle: 'Informazioni'
  },
  pl: {
    nav: ['POS','Produkty','Klienci','Użytkownicy','Raporty','Ustawienia','Pomoc','O programie'],
    welcomeTitle: 'Witamy w OpenPOS',
    getStarted: 'Rozpocznij',
    learnMore: 'Dowiedz się więcej',
    login: 'Zaloguj',
    reset: 'Resetuj',
    logout: 'Wyloguj',
    createAccount: 'Utwórz konto',
    printReceipt: 'Drukuj paragon',
    scanBarcode: 'Skanuj kod kreskowy',
    selectCustomer: 'Wybierz/Dodaj',
    searchPlaceholder: 'Wyszukaj produkt po nazwie lub kodzie',
    customerLabel: 'Klient',
    totalLabel: 'Suma',
    completeSale: 'Zakończ sprzedaż',
    productsTitle: 'Produkty',
    productAdd: 'Dodaj / Aktualizuj',
    exportProducts: 'Eksportuj produkty (CSV)',
    customersTitle: 'Klienci',
    customerAdd: 'Dodaj klienta',
    exportCustomers: 'Eksportuj klientów (CSV)',
    usersTitle: 'Użytkownicy i role',
    createUser: 'Utwórz użytkownika',
    reportsTitle: 'Sprzedaż i raporty',
    generateReport: 'Generuj raport',
    exportCsv: 'Eksportuj CSV (Excel)',
    exportPdf: 'Eksportuj PDF',
    themeLabel: 'Motyw',
    languageLabel: 'Język',
    currencyLabel: 'Waluta',
    autoSaveLabel: 'Autozapisywanie',
    autosaveNote: 'Włącz trwałe zapisywanie — Interwał (minuty): ',
    saveAppData: 'Zapisz AppData do pliku (AppData.json)',
    loadAppData: 'Wczytaj AppData z pliku',
    chooseAppData: 'Wybierz plik AppData (dla autosave)',
    bizNamePlaceholder: 'Nazwa firmy',
    bizEmailPlaceholder: 'email@example.com',
    bizPhonePlaceholder: 'Telefon',
    bizAddressPlaceholder: 'Adres',
    exportBackup: 'Eksportuj kopię zapasową',
    importBackup: 'Importuj kopię zapasową',
    downloadRecovery: 'Pobierz plik odzyskiwania (reset hasła)',
    helpTitle: 'Pomoc — Podręcznik użytkownika',
    aboutTitle: 'O programie'
  },
  nl: {
    nav: ['POS','Producten','Klanten','Gebruikers','Rapporten','Instellingen','Help','Over'],
    welcomeTitle: 'Welkom bij OpenPOS',
    getStarted: 'Aan de slag',
    learnMore: 'Meer informatie',
    login: 'Inloggen',
    reset: 'Resetten',
    logout: 'Uitloggen',
    createAccount: 'Account aanmaken',
    printReceipt: 'Bon afdrukken',
    scanBarcode: 'Barcode scannen',
    selectCustomer: 'Selecteer/Toevoegen',
    searchPlaceholder: 'Zoek product op naam of code',
    customerLabel: 'Klant',
    totalLabel: 'Totaal',
    completeSale: 'Verkoop voltooien',
    productsTitle: 'Producten',
    productAdd: 'Toevoegen / Bijwerken',
    exportProducts: 'Producten exporteren (CSV)',
    customersTitle: 'Klanten',
    customerAdd: 'Klant toevoegen',
    exportCustomers: 'Klanten exporteren (CSV)',
    usersTitle: 'Gebruikers & Rollen',
    createUser: 'Gebruiker aanmaken',
    reportsTitle: 'Verkopen & Rapporten',
    generateReport: 'Genereer rapport',
    exportCsv: 'Exporteer CSV (Excel)',
    exportPdf: 'Exporteer PDF',
    themeLabel: 'Thema',
    languageLabel: 'Taal',
    currencyLabel: 'Valuta',
    autoSaveLabel: 'Automatisch opslaan',
    autosaveNote: 'Persistente opslag inschakelen — Interval (minuten): ',
    saveAppData: 'Sla AppData op als bestand (AppData.json)',
    loadAppData: 'Laad AppData vanuit bestand',
    chooseAppData: 'Kies AppData-bestand (voor autosave)',
    bizNamePlaceholder: 'Bedrijfsnaam',
    bizEmailPlaceholder: 'email@example.com',
    bizPhonePlaceholder: 'Telefoon',
    bizAddressPlaceholder: 'Adres',
    exportBackup: 'Back-up exporteren',
    importBackup: 'Back-up importeren',
    downloadRecovery: 'Herstelbestand downloaden (wachtwoord reset)',
    helpTitle: 'Help — Gebruikershandleiding',
    aboutTitle: 'Over'
  },
  es: {
    nav: ['POS','Productos','Clientes','Usuarios','Reportes','Ajustes','Ayuda','Acerca de'],
    welcomeTitle: 'Bienvenido a OpenPOS',
    getStarted: 'Comenzar',
    learnMore: 'Saber más',
    login: 'Iniciar sesión',
    reset: 'Restablecer',
    logout: 'Cerrar sesión',
    createAccount: 'Crear cuenta',
    printReceipt: 'Imprimir recibo',
    scanBarcode: 'Escanear código de barras',
    selectCustomer: 'Seleccionar/Agregar',
    searchPlaceholder: 'Buscar producto por nombre o código',
    customerLabel: 'Cliente',
    totalLabel: 'Total',
    completeSale: 'Completar venta',
    productsTitle: 'Productos',
    productAdd: 'Agregar / Actualizar',
    exportProducts: 'Exportar productos (CSV)',
    customersTitle: 'Clientes',
    customerAdd: 'Agregar cliente',
    exportCustomers: 'Exportar clientes (CSV)',
    usersTitle: 'Usuarios y Roles',
    createUser: 'Crear usuario',
    reportsTitle: 'Ventas y Reportes',
    generateReport: 'Generar reporte',
    exportCsv: 'Exportar CSV (Excel)',
    exportPdf: 'Exportar PDF',
    themeLabel: 'Tema',
    languageLabel: 'Idioma',
    currencyLabel: 'Moneda',
    autoSaveLabel: 'Auto Guardado',
    autosaveNote: 'Habilitar guardado persistente — Intervalo (minutos): ',
    saveAppData: 'Guardar AppData a archivo (AppData.json)',
    loadAppData: 'Cargar AppData desde archivo',
    chooseAppData: 'Elegir archivo AppData (para autosave)',
    bizNamePlaceholder: 'Nombre del negocio',
    bizEmailPlaceholder: 'email@example.com',
    bizPhonePlaceholder: 'Teléfono',
    bizAddressPlaceholder: 'Dirección',
    exportBackup: 'Exportar respaldo',
    importBackup: 'Importar respaldo',
    downloadRecovery: 'Descargar archivo de recuperación (restablecer contraseña)',
    helpTitle: 'Ayuda — Manual de usuario',
    aboutTitle: 'Acerca de'
  }
};


async function applyLanguage(lang){
  // resolve language: try exact, lower-case, primary subtag, then fallback to English
  let t = TRANSLATIONS[lang];
  if(!t && typeof lang === 'string'){
    const lower = lang.toLowerCase();
    t = TRANSLATIONS[lower] || TRANSLATIONS[lang];
    if(!t){ const primary = lower.split('-')[0]; t = TRANSLATIONS[primary]; }
  }
  // Merge with English defaults so missing keys fall back to English
  t = Object.assign({}, TRANSLATIONS.en, t || {});
  // helper to set text safely
  function setText(selector, text){ try{ const el = document.querySelector(selector); if(el && typeof text === 'string') el.textContent = text; }catch(e){ console.error('setText error',selector,e); } }
  function setInputPlaceholder(id, text){ try{ const el = document.getElementById(id); if(el && typeof text === 'string') el.placeholder = text; }catch(e){ console.error('setPlaceholder error',id,e); } }
  function setLabelForSelect(selectId, text){ try{ const sel = document.getElementById(selectId); if(!sel) return; const lab = sel.parentElement; if(lab && lab.tagName === 'LABEL'){ // find first text node child and replace
        for(const node of lab.childNodes){ if(node.nodeType === Node.TEXT_NODE){ node.nodeValue = text + ': '; return; } }
        // if no text node, prepend
        lab.insertBefore(document.createTextNode(text+': '), sel);
    } }catch(e){ console.error('setLabelForSelect error',selectId,e); } }

  try{
    // nav
    const navBtns = document.querySelectorAll('#main-nav button'); navBtns.forEach((b,i)=>{ if(t.nav && t.nav[i]) b.textContent = t.nav[i]; });
    // welcome / header
    setText('#welcome h2', t.welcomeTitle || 'Welcome to OpenPOS');
    setText('#start-setup', t.getStarted || 'Get Started');
    setText('#learn-more', t.learnMore || 'Learn More');
    setText('#login-btn', t.login || 'Login');
    setText('#show-create', t.createAccount || 'Create account');
    setText('#auth-title', t.login || 'Login');
    const loginSubmit = document.querySelector('#login-form button[type=submit]'); if(loginSubmit) loginSubmit.textContent = t.login || 'Login';
    setText('#forgot-pw', t.reset || 'Reset');
    setText('#create-account h2', t.createAccount || 'Create account');
    const createSubmit = document.querySelector('#create-form button[type=submit]'); if(createSubmit) createSubmit.textContent = t.createAccount || 'Create account';

    // POS and cart
    setInputPlaceholder('product-search', t.searchPlaceholder || 'Search product by name or code');
    // Customer label (preserve #selected-customer span)
    const custLabel = Array.from(document.querySelectorAll('.cart-actions label')).find(l=>l.querySelector('#selected-customer'));
    if(custLabel){ const span = custLabel.querySelector('#selected-customer'); const cur = span?span.textContent:'None'; custLabel.innerHTML = `${t.customerLabel || 'Customer'}: <span id="selected-customer">${cur}</span>`; }
    setText('#select-customer', t.selectCustomer || 'Select/Add');
    // total
    const totalSpan = document.getElementById('cart-total'); if(totalSpan && totalSpan.parentElement){ const parent = totalSpan.parentElement; const label = (t.totalLabel || 'Total') + ': '; if(parent.firstChild && parent.firstChild.nodeType === 3){ parent.firstChild.nodeValue = label; } else { parent.insertBefore(document.createTextNode(label), totalSpan); } }
    setText('#complete-sale', t.completeSale || 'Complete Sale');

    // Products page
    setText('#page-products h2', t.productsTitle || 'Products');
    const prodFormBtn = document.querySelector('#product-form button[type=submit]'); if(prodFormBtn) prodFormBtn.textContent = t.productAdd || 'Add / Update';
    setText('#export-products-csv', t.exportProducts || 'Export Products CSV');

    // Customers page
    setText('#page-customers h2', t.customersTitle || 'Customers');
    const custFormBtn = document.querySelector('#customer-form button[type=submit]'); if(custFormBtn) custFormBtn.textContent = t.customerAdd || 'Add Customer';
    setText('#export-customers-csv', t.exportCustomers || 'Export Customers CSV');

    // Users
    setText('#page-users h2', t.usersTitle || 'Users & Roles');
    const userFormBtn = document.querySelector('#user-form button[type=submit]'); if(userFormBtn) userFormBtn.textContent = t.createUser || 'Create User';

    // Reports
    setText('#page-reports h2', t.reportsTitle || 'Sales & Reports');
    setText('#generate-report', t.generateReport || 'Generate Report');
    setText('#export-report-csv', t.exportCsv || 'Export CSV (Excel)');
    setText('#export-report-pdf', t.exportPdf || 'Export PDF');

    // Settings labels and buttons
    setLabelForSelect('theme-select', t.themeLabel || 'Theme');
    setLabelForSelect('lang-select', t.languageLabel || 'Language');
    setLabelForSelect('currency-select', t.currencyLabel || 'Currency');
    // autosave label and note
    const autosaveLabel = document.querySelector('.autosave-label'); if(autosaveLabel) autosaveLabel.firstChild.nodeValue = (t.autoSaveLabel || 'Auto Save') + ' ';
    const autosaveNote = document.querySelector('.autosave-note'); if(autosaveNote) autosaveNote.firstChild.nodeValue = t.autosaveNote || 'Enable persistent save — Interval (minutes): ';
    setText('#save-appdata', t.saveAppData || 'Save AppData to file (AppData.json)');
    setText('#load-appdata', t.loadAppData || 'Load AppData from AppData file');
    setText('#choose-appdata', t.chooseAppData || 'Choose AppData file (for autosave)');

    // Business placeholders
    const bizNameEl = document.getElementById('biz-name'); if(bizNameEl) bizNameEl.placeholder = t.bizNamePlaceholder || 'Business name';
    const bizEmailEl = document.getElementById('biz-email'); if(bizEmailEl) bizEmailEl.placeholder = t.bizEmailPlaceholder || 'email@example.com';
    const bizPhoneEl = document.getElementById('biz-phone'); if(bizPhoneEl) bizPhoneEl.placeholder = t.bizPhonePlaceholder || 'Phone';
    const bizAddrEl = document.getElementById('biz-address'); if(bizAddrEl) bizAddrEl.placeholder = t.bizAddressPlaceholder || 'Address';
    setText('#export-backup', t.exportBackup || 'Export Backup');
    setText('#import-backup', t.importBackup || 'Import Backup');
    setText('#download-recovery', t.downloadRecovery || 'Download Recovery File (password reset)');

    // Help & About headings
    setText('#page-help h2', t.helpTitle || 'Help — User Manual');
    setText('#page-about h2', t.aboutTitle || 'About');

  }catch(e){ console.error('applyLanguage failed', e); }
 }

async function loadSettings(){ const theme = await OpenPOSDB.getSetting('theme')||'light'; const lang = await OpenPOSDB.getSetting('language')||'en'; const currency = await OpenPOSDB.getSetting('currency')||'USD'; document.documentElement.setAttribute('data-theme', theme); themeSelect.value=theme; langSelect.value=lang; currencySelect.value=currency; await applyLanguage(lang);
  // tax rate setting
  const taxRateEl = document.getElementById('tax-rate'); const taxSetting = await OpenPOSDB.getSetting('tax.rate'); if(taxRateEl) taxRateEl.value = taxSetting || 0; if(taxRateEl){ taxRateEl.addEventListener('change', async ()=>{ await OpenPOSDB.setSetting('tax.rate', taxRateEl.value); renderCart(); }); }
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
// re-render cart when discount input changes
const cartDiscountElInit = document.getElementById('cart-discount'); if(cartDiscountElInit){ cartDiscountElInit.addEventListener('input', ()=>{ renderCart(); }); }
  // Override print/pdf handlers so current-cart receipts include subtotal, discount and tax
  try{
    if(typeof printBtn !== 'undefined'){ printBtn.onclick = null; printBtn.addEventListener('click', async ()=>{
      try{
        if(cart.length===0){ if(lastSale) printReceipt(lastSale); else alert('No sale to print yet.'); }
        else{
          const subtotal = cart.reduce((s,c)=>s + (c.price * c.qty), 0);
          const discountPercent = parseFloat(document.getElementById('cart-discount')?.value || 0);
          const discountAmount = subtotal * (discountPercent/100);
          const taxRate = parseFloat((await OpenPOSDB.getSetting('tax.rate')) || 0);
          const taxable = Math.max(0, subtotal - discountAmount);
          const taxAmount = taxable * (taxRate/100);
          const total = parseFloat((taxable + taxAmount).toFixed(2));
          const tempSale = { items: cart.map(c=>({name:c.name,qty:c.qty,price:c.price})), subtotal: parseFloat(subtotal.toFixed(2)), discountPercent, discountAmount: parseFloat(discountAmount.toFixed(2)), taxRate, taxAmount: parseFloat(taxAmount.toFixed(2)), total, at: new Date().toISOString() };
          printReceipt(tempSale);
        }
      }catch(e){ console.error('print button failed', e); alert('Print failed'); }
    }); }
    if(typeof pdfBtn !== 'undefined'){ pdfBtn.onclick = null; pdfBtn.addEventListener('click', async ()=>{
      try{
        if(cart.length===0){ if(lastSale) printReceipt(lastSale,{downloadPDF:true}); else alert('No sale to print yet.'); }
        else{
          const subtotal = cart.reduce((s,c)=>s + (c.price * c.qty), 0);
          const discountPercent = parseFloat(document.getElementById('cart-discount')?.value || 0);
          const discountAmount = subtotal * (discountPercent/100);
          const taxRate = parseFloat((await OpenPOSDB.getSetting('tax.rate')) || 0);
          const taxable = Math.max(0, subtotal - discountAmount);
          const taxAmount = taxable * (taxRate/100);
          const total = parseFloat((taxable + taxAmount).toFixed(2));
          const tempSale = { items: cart.map(c=>({name:c.name,qty:c.qty,price:c.price})), subtotal: parseFloat(subtotal.toFixed(2)), discountPercent, discountAmount: parseFloat(discountAmount.toFixed(2)), taxRate, taxAmount: parseFloat(taxAmount.toFixed(2)), total, at: new Date().toISOString() };
          printReceipt(tempSale,{downloadPDF:true});
        }
      }catch(e){ console.error('pdf button failed', e); alert('Download failed'); }
    }); }
  }catch(e){ console.error('attach print handlers failed', e); }

// export/import buttons
document.getElementById('export-backup').addEventListener('click', async ()=>{ const pw = prompt('Enter password to encrypt backup (leave blank for plain)'); await OpenPOSDB.exportBackup({encrypt:!!pw,password:pw}); alert('Backup downloaded'); });
document.getElementById('import-backup').addEventListener('click', ()=>{ const inp = document.getElementById('import-file'); inp.onchange = async e=>{ const f = inp.files[0]; if(!f) return; const maybe = confirm('Is the file encrypted? OK=Yes Cancel=No'); if(maybe){ const pw = prompt('Password for backup'); try{ await OpenPOSDB.importBackupFile(f,{encrypted:true,password:pw}); alert('Imported'); await renderProducts(); await renderCustomers(); await renderUsersList(); }catch(err){ alert('Import failed'); } } else { await OpenPOSDB.importBackupFile(f,{encrypted:false}); alert('Imported'); await renderProducts(); await renderCustomers(); await renderUsersList(); } inp.value=''; }; inp.click(); });

// recovery file for password reset (export users only)
document.getElementById('download-recovery').addEventListener('click', async ()=>{
  const users = await OpenPOSDB.getAll('users'); const payload = JSON.stringify({users}); const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([payload],{type:'application/json'})); a.download='openpos-recovery.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),3000); alert('Recovery file downloaded — keep it safe.'); });

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
const userArea = document.getElementById('user-area'); const userMenu = document.getElementById('user-menu');
if(userArea && userMenu){
  // robust toggle: position menu using viewport coords so it's always visible
  function showUserMenu(show){ if(show){ const u = OpenPOSAuth.currentUser(); if(!u) return; const rect = userArea.getBoundingClientRect(); userMenu.style.position = 'fixed'; userMenu.style.top = (rect.bottom + 6) + 'px'; // align right edge
    const menuWidth = Math.max(180, userMenu.offsetWidth || 180);
    const left = Math.max(8, rect.right - menuWidth);
      userMenu.style.left = left + 'px'; userMenu.style.right = 'auto'; userMenu.style.display = 'flex'; userMenu.style.zIndex = 9999; userArea.setAttribute('aria-expanded','true'); } else { userMenu.style.display = 'none'; userArea.setAttribute('aria-expanded','false'); }}

  userArea.addEventListener('click', (ev)=>{ ev.stopPropagation(); console.log('userArea click'); const curVisible = window.getComputedStyle(userMenu).display !== 'none'; showUserMenu(!curVisible); });

  // close when clicking elsewhere
  document.addEventListener('click', (ev)=>{ try{ if(window.getComputedStyle(userMenu).display === 'none') return; if(!userMenu.contains(ev.target) && !userArea.contains(ev.target)) showUserMenu(false); }catch(e){} });

  // keyboard support: open/close with Enter/Space when user-area focused; Escape to close
  document.addEventListener('keydown', (ev)=>{ if(ev.key === 'Escape'){ showUserMenu(false); } });
  userArea.addEventListener('keydown', (ev)=>{ if(ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); const curVisible = window.getComputedStyle(userMenu).display !== 'none'; showUserMenu(!curVisible); } });

  // also make avatar and username clickable explicitly
  const avatar = document.getElementById('user-avatar'); const nameEl = document.getElementById('current-user'); if(avatar) avatar.addEventListener('click', e=>{ e.stopPropagation(); console.log('avatar click'); const curVisible = window.getComputedStyle(userMenu).display !== 'none'; showUserMenu(!curVisible); }); if(nameEl) nameEl.addEventListener('click', e=>{ e.stopPropagation(); console.log('name click'); const curVisible = window.getComputedStyle(userMenu).display !== 'none'; showUserMenu(!curVisible); });

  // handle menu actions
  userMenu.querySelectorAll('button').forEach(b=>b.addEventListener('click', async (e)=>{ e.stopPropagation(); const action = b.dataset.action; if(action==='settings'){ showById('page-settings'); showUserMenu(false); } else if(action==='reset'){ const username = OpenPOSAuth.currentUser().username; const user = await OpenPOSAuth.getUserByUsername(username); const answers = {}; for(const qa of user.securityQA||[]){ const a = prompt('Answer: '+qa.q); if(a) answers[qa.q]=a; }
      const ok = await OpenPOSAuth.verifySecurityAnswers(username,answers).catch(()=>false); if(!ok) return alert('Answers did not match'); const np = prompt('Enter new password'); if(!np) return; await OpenPOSAuth.resetPassword(username,answers,np); alert('Password reset'); showUserMenu(false); } else if(action==='logout'){ if(confirm('Logout?')){ OpenPOSAuth.logout(); refreshAuth(); showUserMenu(false); } } }));
}

// CSV import/export handlers
const importProductsBtn = document.getElementById('import-products-csv'); const productsCsvInput = document.getElementById('products-csv-file'); if(importProductsBtn && productsCsvInput){ importProductsBtn.addEventListener('click', ()=>productsCsvInput.click()); productsCsvInput.addEventListener('change', async (e)=>{ const f = e.target.files[0]; if(!f) return; const txt = await f.text(); const lines = txt.split(/\r?\n/).map(l=>l.trim()).filter(Boolean); const header = lines.shift().split(',').map(h=>h.trim().toLowerCase()); for(const line of lines){ const cols = line.split(','); const obj = {}; header.forEach((h,i)=>obj[h]=cols[i]); await OpenPOSDB.add('products',{name:obj.name,code:obj.code,category:obj.category,price:parseFloat(obj.price||0),createdAt:new Date().toISOString()}); } alert('Products imported'); renderProducts(); }); }
// Export products CSV
const exportProductsBtn = document.getElementById('export-products-csv'); if(exportProductsBtn){ exportProductsBtn.addEventListener('click', async ()=>{ const items = await OpenPOSDB.getAll('products'); const rows = ['name,code,category,price', ...items.map(i=>`${(i.name||'').replace(/,/g,'')},${(i.code||'').replace(/,/g,'')},${(i.category||'').replace(/,/g,'')},${(i.price||0)}`)]; const blob = new Blob([rows.join('\n')],{type:'text/csv'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='products-export.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),3000); }); }

/* Users CSV import removed from Users page per user request. If you want a bulk user import later, enable it here. */

// Customers CSV import/export
const importCustomersBtn = document.getElementById('import-customers-csv'); const customersCsvInput = document.getElementById('customers-csv-file'); const exportCustomersBtn = document.getElementById('export-customers-csv');
if(importCustomersBtn && customersCsvInput){ importCustomersBtn.addEventListener('click', ()=>customersCsvInput.click()); customersCsvInput.addEventListener('change', async (e)=>{ const f = e.target.files[0]; if(!f) return; const txt = await f.text(); const lines = txt.split(/\r?\n/).map(l=>l.trim()).filter(Boolean); const header = lines.shift().split(',').map(h=>h.trim().toLowerCase()); for(const line of lines){ const cols = line.split(','); const obj = {}; header.forEach((h,i)=>obj[h]=cols[i]||''); await OpenPOSDB.add('customers',{name:obj.name,phone:obj.phone,createdAt:new Date().toISOString()}); } alert('Customers imported'); renderCustomers(); }); }
if(exportCustomersBtn){ exportCustomersBtn.addEventListener('click', async ()=>{ const items = await OpenPOSDB.getAll('customers'); const rows = ['name,phone', ...items.map(i=>`${(i.name||'').replace(/,/g,'')},${(i.phone||'').replace(/,/g,'')}`)]; const blob = new Blob([rows.join('\n')],{type:'text/csv'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='customers-export.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),3000); }); }

// Export users
/* Users export removed from Users page per user request. */

// Barcode scan button and handlers (image or live)
const scanBtn = document.createElement('button'); scanBtn.id = 'scan-barcode-btn'; scanBtn.className = 'small-btn'; scanBtn.textContent = 'Scan barcode'; scanBtn.style.marginLeft='8px'; // use the existing productSearch variable
const prodSearchEl = document.getElementById('product-search') || productSearch;
if(prodSearchEl) prodSearchEl.after(scanBtn);
const barcodeFile = document.createElement('input'); barcodeFile.type='file'; barcodeFile.accept='image/*'; barcodeFile.style.display='none'; document.body.appendChild(barcodeFile);
scanBtn.addEventListener('click', async ()=>{ try{ const useLive = confirm('Use live camera scanner if available? OK=Camera, Cancel=Upload image'); if(useLive){ startLiveScanner(); } else { barcodeFile.click(); } }catch(e){ console.error('Scan button action failed', e); alert('Scanner not available'); }});
barcodeFile.addEventListener('change', async (e)=>{ const f = e.target.files[0]; if(!f) return; try{ const imgBitmap = await createImageBitmap(f); if('BarcodeDetector' in window){ const detector = new BarcodeDetector(); const canvas = document.createElement('canvas'); canvas.width = imgBitmap.width; canvas.height = imgBitmap.height; const ctx = canvas.getContext('2d'); ctx.drawImage(imgBitmap,0,0); const results = await detector.detect(canvas); if(results && results.length>0){ const code = results[0].rawValue; const items = await OpenPOSDB.getAll('products'); const p = items.find(x=>x.code===code); if(p) addToCart(p); else alert('Barcode detected: '+code+' but no matching product found.'); } else alert('No barcode found in image'); } else { alert('No BarcodeDetector; cannot detect'); } }catch(err){ console.error('Barcode file detect error', err); alert('Barcode detection failed'); } });

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
  html += `<div style="margin-top:12px">Time: ${sale.at||new Date().toISOString()}</div><table><thead><tr><th>Item</th><th>Qty</th><th>Price</th></tr></thead><tbody>`; for(const it of items) html += `<tr><td>${it.name}</td><td>${it.qty}</td><td>${it.price}</td></tr>`; html += `</tbody><tfoot><tr><td></td><td>Subtotal</td><td>${(sale.subtotal !== undefined) ? sale.subtotal : (items.reduce((s,i)=>s + (i.price*i.qty),0)).toFixed(2)}</td></tr><tr><td></td><td>Discount</td><td>${(sale.discountAmount !== undefined) ? sale.discountAmount : (0).toFixed(2)}</td></tr><tr><td></td><td>Tax</td><td>${(sale.taxAmount !== undefined) ? sale.taxAmount : (0).toFixed(2)}</td></tr><tr><td></td><td>Total</td><td>${sale.total}</td></tr></tfoot></table></body></html>`;
  const w = window.open('','_blank'); w.document.write(html); w.document.close(); if(opts.downloadPDF){ // guide user to save as PDF
    setTimeout(()=>{ try{ w.focus(); w.print(); }catch(e){} },200); } else { setTimeout(()=>{ try{ w.focus(); w.print(); }catch(e){} },200); }
}

// hook Print receipt button
const printBtn = document.createElement('button'); printBtn.id='print-receipt-btn'; const pdfBtn = document.createElement('button'); pdfBtn.id='download-pdf-btn'; printBtn.style.marginLeft='8px'; pdfBtn.style.marginLeft='8px'; printBtn.textContent = 'Print Receipt'; pdfBtn.textContent = 'Download PDF';
const cartActions = document.querySelector('.cart-actions'); if(cartActions) { cartActions.appendChild(printBtn); cartActions.appendChild(pdfBtn); }
let lastSale = null; const completeSaleBtn = document.getElementById('complete-sale'); if(completeSaleBtn){ completeSaleBtn.addEventListener('click', async ()=>{ // existing handler also saves sale; capture last sale
  // small delay to let add complete
  setTimeout(async ()=>{ const sales = await OpenPOSDB.getAll('sales'); lastSale = sales[sales.length-1]; if(lastSale) printReceipt(lastSale); updatePrintButtons(); },300); }); }

function updatePrintButtons(){ try{ if(cart.length===0){ printBtn.textContent = 'Print Last'; pdfBtn.textContent = 'Download Last'; } else { printBtn.textContent = 'Print Receipt'; pdfBtn.textContent = 'Download PDF'; } }catch(e){ console.error('updatePrintButtons error', e); }
}

// default labels
updatePrintButtons();

printBtn.addEventListener('click', ()=>{ try{ if(cart.length===0){ if(lastSale) printReceipt(lastSale); else alert('No sale to print yet.'); } else { // print current cart preview
    const tempSale = {items:cart.map(c=>({name:c.name,qty:c.qty,price:c.price})), total: parseFloat(cart.reduce((s,c)=>s+c.price*c.qty,0).toFixed(2)), at: new Date().toISOString()}; printReceipt(tempSale); } }catch(e){ console.error('print button failed', e); alert('Print failed'); } });

pdfBtn.addEventListener('click', ()=>{ try{ if(cart.length===0){ if(lastSale) printReceipt(lastSale,{downloadPDF:true}); else alert('No sale to print yet.'); } else { const tempSale = {items:cart.map(c=>({name:c.name,qty:c.qty,price:c.price})), total: parseFloat(cart.reduce((s,c)=>s+c.price*c.qty,0).toFixed(2)), at: new Date().toISOString()}; printReceipt(tempSale,{downloadPDF:true}); } }catch(e){ console.error('pdf button failed', e); alert('Download failed'); } });

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
