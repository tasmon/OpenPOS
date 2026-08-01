// Simple IndexedDB wrapper with export/import (optional AES-GCM encryption)
const DB_NAME = 'openpos_v1';
const DB_VERSION = 1;
let db;

function openDB(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if(!d.objectStoreNames.contains('products')) d.createObjectStore('products',{keyPath:'id',autoIncrement:true});
      if(!d.objectStoreNames.contains('customers')) d.createObjectStore('customers',{keyPath:'id',autoIncrement:true});
      if(!d.objectStoreNames.contains('users')) d.createObjectStore('users',{keyPath:'id',autoIncrement:true});
      if(!d.objectStoreNames.contains('sales')) d.createObjectStore('sales',{keyPath:'id',autoIncrement:true});
      if(!d.objectStoreNames.contains('settings')) d.createObjectStore('settings',{keyPath:'key'});
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror = e => reject(e.target.error);
  });
}

async function tx(storeName, mode='readonly'){ if(!db) await openDB(); return db.transaction(storeName, mode).objectStore(storeName); }

async function add(storeName, value){ const s = await tx(storeName,'readwrite'); return new Promise((res,rej)=>{ const r=s.add(value); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
async function put(storeName, value){ const s = await tx(storeName,'readwrite'); return new Promise((res,rej)=>{ const r=s.put(value); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
async function getAll(storeName){ const s = await tx(storeName); return new Promise((res,rej)=>{ const r = s.getAll(); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
async function getById(storeName, id){ const s = await tx(storeName); return new Promise((res,rej)=>{ const r = s.get(id); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
async function clearStore(storeName){ const s = await tx(storeName,'readwrite'); return new Promise((res,rej)=>{ const r=s.clear(); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }); }

// Settings helpers (settings store uses keyPath 'key')
async function getSetting(key){ const s = await tx('settings'); return new Promise((res,rej)=>{ const r = s.get(key); r.onsuccess=()=>res(r.result? r.result.value : null); r.onerror=()=>rej(r.error); }); }
async function setSetting(key,value){ const s = await tx('settings','readwrite'); return new Promise((res,rej)=>{ const r = s.put({key,value}); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }

// Export full DB as JSON
async function exportDB(){ const stores=['products','customers','users','sales','settings']; const out = {};
  for(const s of stores) out[s]=await getAll(s).catch(()=>[]);
  return JSON.stringify({meta:{exportedAt:new Date().toISOString()},data:out});
}

// Import JSON (plain)
async function importDB(json){ const obj = typeof json==='string'?JSON.parse(json):json; const data = obj.data||{}; for(const store of Object.keys(data)){
    await clearStore(store);
    for(const item of data[store]) await add(store,item).catch(()=>put(store,item));
  }
}

// Crypto helpers: derive key from password -> AES-GCM
async function deriveKey(password, salt){ const enc = new TextEncoder(); const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), {name:'PBKDF2'}, false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt:enc.encode(salt),iterations:100000,hash:'SHA-256'}, keyMaterial, {name:'AES-GCM',length:256}, false, ['encrypt','decrypt']);
}

async function encryptPayload(plainText, password){ const salt = crypto.getRandomValues(new Uint8Array(12)); const iv = crypto.getRandomValues(new Uint8Array(12)); const key = await deriveKey(password, Array.from(salt).join(','));
  const enc = new TextEncoder(); const ct = await crypto.subtle.encrypt({name:'AES-GCM',iv}, key, enc.encode(plainText));
  // return base64 parts
  return btoa(String.fromCharCode(...new Uint8Array(salt))) + '.' + btoa(String.fromCharCode(...new Uint8Array(iv))) + '.' + btoa(String.fromCharCode(...new Uint8Array(ct)));
}
async function decryptPayload(payloadB64, password){ const [saltB, ivB, ctB] = payloadB64.split('.'); const salt = new Uint8Array(atob(saltB).split('').map(c=>c.charCodeAt(0))); const iv = new Uint8Array(atob(ivB).split('').map(c=>c.charCodeAt(0))); const ct = new Uint8Array(atob(ctB).split('').map(c=>c.charCodeAt(0)));
  const key = await deriveKey(password, Array.from(salt).join(',')); const pt = await crypto.subtle.decrypt({name:'AES-GCM',iv}, key, ct); return new TextDecoder().decode(pt);
}

// Save to file (download)
function download(filename, content){ const a = document.createElement('a'); const blob = new Blob([content],{type:'application/json'}); a.href=URL.createObjectURL(blob); a.download = filename; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),5000); }

async function exportBackup({encrypt=false,password} = {}){
  const json = await exportDB();
  if(encrypt && password){ const enc = await encryptPayload(json,password); download('openpos-backup-encrypted.json',enc); }
  else download('openpos-backup.json',json);
}

async function importBackupFile(file, {encrypted=false,password} = {}){
  const txt = await file.text(); const payload = encrypted? await decryptPayload(txt,password) : txt; await importDB(payload);
}

// Expose API
async function del(storeName, id){ const s = await tx(storeName,'readwrite'); return new Promise((res,rej)=>{ const r = s.delete(id); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }); }

// Expose API
window.OpenPOSDB = {openDB,add,put,getAll,getById,del,clearStore,getSetting,setSetting,exportDB,importDB,exportBackup,importBackupFile};
