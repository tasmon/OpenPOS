// Basic auth: store users in users store. Passwords hashed with SHA-256. Security questions supported.
async function hashPassword(p){ const enc = new TextEncoder(); const buf = await crypto.subtle.digest('SHA-256', enc.encode(p)); return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join(''); }

async function createUser(username,password,role='cashier',securityQA=[]){
  const hash = await hashPassword(password);
  // securityQA: [{q:'parents_meet',answerHash:'...'}, ...]
  const u = {username,passwordHash:hash,role,securityQA,createdAt:new Date().toISOString()};
  return OpenPOSDB.add('users',u);
}
async function listUsers(){ return OpenPOSDB.getAll('users'); }
async function getUserByUsername(username){ const users = await listUsers(); return users.find(u=>u.username===username); }

async function login(username,password){ const u = await getUserByUsername(username); if(!u) throw new Error('Invalid credentials'); const hash = await hashPassword(password); if(hash===u.passwordHash){ sessionStorage.setItem('openpos_user',JSON.stringify({id:u.id,username:u.username,role:u.role})); return u; } throw new Error('Invalid credentials'); }
function logout(){ sessionStorage.removeItem('openpos_user'); }
function currentUser(){ const s = sessionStorage.getItem('openpos_user'); return s?JSON.parse(s):null; }

// Password reset: verify answers (plain-text answers compared by hash).
// Requires at least 2 matching answers to succeed (if 3 questions exist).
async function verifySecurityAnswers(username, answers){ // answers: {q1:ans1,q2:ans2..}
  const u = await getUserByUsername(username); if(!u) throw new Error('User not found'); if(!u.securityQA || u.securityQA.length===0) throw new Error('No security questions set');
  let correct = 0;
  for(const qa of u.securityQA){ const val = answers[qa.q]; if(!val) continue; const h = await hashPassword(val.toString().trim().toLowerCase()); if(h === qa.answerHash) correct++; }
  // require at least 2 correct answers or all if fewer than 2 stored
  const required = Math.min(2, u.securityQA.length);
  return correct >= required;
}

async function resetPassword(username,answers,newPassword){ const ok = await verifySecurityAnswers(username,answers); if(!ok) throw new Error('Security answers did not match'); const u = await getUserByUsername(username); u.passwordHash = await hashPassword(newPassword); return OpenPOSDB.put('users',u); }

// Helper to store hashed answers when creating account
async function hashSecurityAnswers(qa){ const out = []; for(const item of qa){ const h = await hashPassword(item.answer.toString().trim().toLowerCase()); out.push({q:item.q,answerHash:h}); } return out; }

async function updateUser(username, changes={}){
  const u = await getUserByUsername(username);
  if(!u) throw new Error('User not found');
  if(changes.username) u.username = changes.username;
  if(changes.role) u.role = changes.role;
  if(changes.password) u.passwordHash = await hashPassword(changes.password);
  return OpenPOSDB.put('users', u);
}

async function deleteUser(username){ const cur = currentUser(); if(cur && cur.username === username) throw new Error('Cannot delete the currently logged-in user'); const u = await getUserByUsername(username); if(!u) throw new Error('User not found'); const users = await listUsers(); const adminCount = users.filter(x=>x.role==='admin').length; if(u.role==='admin' && adminCount<=1) throw new Error('Cannot delete last admin'); return OpenPOSDB.del('users', u.id); }

window.OpenPOSAuth = {createUser,listUsers,getUserByUsername,login,logout,currentUser,verifySecurityAnswers,resetPassword,hashSecurityAnswers,updateUser,deleteUser};
