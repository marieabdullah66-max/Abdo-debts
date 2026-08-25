const root = document.getElementById('root');
const toastEl = document.getElementById('toast');

const state = {
  accessToken: localStorage.getItem('debts_access') || '',
  refreshToken: localStorage.getItem('debts_refresh') || '',
  profile: null,
  branches: [], suppliers: [], invoices: [], payments: [], users: [],
  view: new URLSearchParams(location.search).get('view') || 'dashboard',
};

const PERMISSION_LABELS = {
  view_dashboard:'عرض الرئيسية', view_suppliers:'عرض الموردين', manage_suppliers:'إدارة الموردين',
  view_invoices:'عرض الفواتير', create_invoices:'إضافة فاتورة', edit_invoices:'تعديل الفاتورة', delete_invoices:'حذف الفاتورة',
  view_payments:'عرض السدادات', create_payments:'إضافة سداد', edit_payments:'تعديل السداد', delete_payments:'حذف السداد',
  manage_branches:'إدارة الفروع', manage_users:'إدارة المستخدمين', view_reports:'عرض التقارير'
};
const ROLE_LABELS = {admin:'مدير', finance:'مالي', viewer:'مشاهدة فقط'};
const ROLE_DEFAULTS = {
  admin: Object.fromEntries(Object.keys(PERMISSION_LABELS).map(k=>[k,true])),
  finance: {view_dashboard:true,view_suppliers:true,manage_suppliers:true,view_invoices:true,create_invoices:true,edit_invoices:true,view_payments:true,create_payments:true,edit_payments:true,view_reports:true},
  viewer: {view_dashboard:true,view_suppliers:true,view_invoices:true,view_payments:true,view_reports:true}
};
const STATUS_LABELS = {unpaid:'غير مسددة', partial:'جزئي', paid:'مسددة'};

function esc(v=''){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function money(v){return `${Number(v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} د.ل`;}
function isoToday(){return new Date().toISOString().slice(0,10);}
function can(p){return !!state.profile?.effective_permissions?.[p];}
function toast(msg, error=false){toastEl.textContent=msg;toastEl.className=`toast show${error?' error':''}`;clearTimeout(toastEl._t);toastEl._t=setTimeout(()=>toastEl.className='toast',2800);}
function confirmAction(msg){return window.confirm(msg);}
function setTokens(data){
  state.accessToken=data.access_token||''; state.refreshToken=data.refresh_token||state.refreshToken||'';
  localStorage.setItem('debts_access',state.accessToken); if(state.refreshToken)localStorage.setItem('debts_refresh',state.refreshToken);
}
function logout(){localStorage.removeItem('debts_access');localStorage.removeItem('debts_refresh');state.accessToken='';state.refreshToken='';state.profile=null;renderLogin();}

async function api(path, options={}, retry=true){
  const headers={...(options.headers||{})};
  if(state.accessToken)headers.Authorization=`Bearer ${state.accessToken}`;
  if(options.body && !(options.body instanceof FormData))headers['Content-Type']='application/json';
  const res=await fetch(path,{...options,headers});
  if(res.status===401 && retry && state.refreshToken){
    const rr=await fetch('/api/auth/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:state.refreshToken})});
    if(rr.ok){setTokens(await rr.json());return api(path,options,false);}
    logout(); throw new Error('انتهت الجلسة');
  }
  if(!res.ok){let msg=`خطأ ${res.status}`;try{const j=await res.json();msg=j.detail||j.message||msg;}catch{msg=await res.text()||msg;}throw new Error(typeof msg==='string'?msg:JSON.stringify(msg));}
  const ct=res.headers.get('content-type')||'';return ct.includes('json')?res.json():res;
}

async function bootstrap(){
  if(!state.accessToken)return renderLogin();
  try{
    state.profile=await api('/api/me');
    await loadBase(); renderApp();
  }catch(e){logout();}
}
async function loadBase(){
  const jobs=[api('/api/admin/branches').then(x=>state.branches=x||[])];
  if(can('view_suppliers')) jobs.push(api('/api/suppliers').then(x=>state.suppliers=x||[]));
  await Promise.all(jobs);
}

async function renderLogin(){
  let accounts=[]; try{accounts=await api('/api/auth/accounts',{},false);}catch{}
  root.innerHTML=`<div class="login-shell"><div class="login-card">
    <div class="brand"><div class="brand-mark">💰</div><div><h1>Abdo Debts</h1><p>مديونيات الموردين والفواتير والسدادات</p></div></div>
    <form id="loginForm">
      <div class="field"><label>اسم المستخدم</label>${accounts.length?`<select class="select" name="username" required><option value="">اختر الحساب</option>${accounts.map(a=>`<option value="${esc(a.username)}">${esc(a.full_name||a.username)} — ${esc(ROLE_LABELS[a.role]||a.role)}</option>`).join('')}</select>`:`<input class="input" name="username" autocomplete="username" required>`}</div>
      <div class="field"><label>كلمة المرور</label><input class="input" type="password" name="password" autocomplete="current-password" required></div>
      <button class="btn btn-primary btn-block" type="submit">دخول</button>
    </form></div></div>`;
  document.getElementById('loginForm').onsubmit=async e=>{
    e.preventDefault();const fd=new FormData(e.currentTarget);const btn=e.currentTarget.querySelector('button');btn.disabled=true;btn.textContent='جاري الدخول...';
    try{const data=await api('/api/auth/login',{method:'POST',body:JSON.stringify({username:fd.get('username'),password:fd.get('password')})},false);setTokens(data);state.profile=data.profile;await loadBase();renderApp();}
    catch(err){toast(err.message,true);btn.disabled=false;btn.textContent='دخول';}
  };
}

function navButton(view,icon,label,perm){if(perm&&!can(perm))return '';return `<button class="nav-btn ${state.view===view?'active':''}" data-view="${view}"><span>${icon}</span>${label}</button>`;}
function renderApp(){
  if(!state.profile)return renderLogin();
  const allowedViews={dashboard:'view_dashboard',suppliers:'view_suppliers',invoices:'view_invoices',payments:'view_payments',settings:null};
  if(allowedViews[state.view] && !can(allowedViews[state.view])) state.view=can('view_dashboard')?'dashboard':can('view_invoices')?'invoices':'settings';
  const settingsVisible=can('manage_branches')||can('manage_users');
  root.innerHTML=`<div class="app">
    <header class="topbar"><div class="topbar-inner"><div class="top-title"><div>💰</div><div><strong>Abdo Debts</strong><small>نظام المديونيات</small></div></div><div class="user-box"><span class="user-name">${esc(state.profile.full_name)}</span><button class="btn btn-ghost btn-sm" id="logoutBtn">خروج</button></div></div></header>
    <main class="main" id="main"></main>
    <nav class="nav"><div class="nav-inner">${navButton('dashboard','▦','الرئيسية','view_dashboard')}${navButton('suppliers','🏢','الموردين','view_suppliers')}${navButton('invoices','🧾','الفواتير','view_invoices')}${navButton('payments','💳','السدادات','view_payments')}${settingsVisible?navButton('settings','⚙️','الإعدادات',null):''}</div></nav>
  </div>`;
  document.getElementById('logoutBtn').onclick=logout;
  root.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>go(b.dataset.view));
  renderView();
}
function go(view){state.view=view;const u=new URL(location.href);u.searchParams.set('view',view);history.replaceState({},'',u);renderApp();}
async function renderView(){const main=document.getElementById('main');main.innerHTML='<div class="loading">جاري التحميل...</div>';try{
  if(state.view==='dashboard')await dashboardView(main);
  else if(state.view==='suppliers')await suppliersView(main);
  else if(state.view==='invoices')await invoicesView(main);
  else if(state.view==='payments')await paymentsView(main);
  else if(state.view==='settings')await settingsView(main);
}catch(e){main.innerHTML=`<div class="panel"><div class="empty">${esc(e.message)}</div></div>`;toast(e.message,true);}}

function branchOptions(includeAll=false, onlyActive=true){const rows=state.branches.filter(b=>!onlyActive||b.active);return `${includeAll?'<option value="">كل الفروع</option>':''}${rows.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('')}`;}
function supplierOptions(includeBlank=true){return `${includeBlank?'<option value="">اختر المورد</option>':''}${state.suppliers.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}`;}
function statusBadge(s){return `<span class="badge ${s==='paid'?'badge-green':s==='partial'?'badge-amber':'badge-red'}">${STATUS_LABELS[s]||s}</span>`;}
function paymentMethod(p){return p.method==='bank'?`🏦 ${esc(p.bank_name||'مصرف')}`:'💵 نقدي';}

async function dashboardView(main){
  const data=await api('/api/dashboard');
  main.innerHTML=`<div class="page-head"><div><h2>الرئيسية</h2><div class="muted">نظرة سريعة على المديونيات الحالية</div></div></div>
  <div class="cards">
    <div class="stat"><div class="label">إجمالي الفواتير</div><div class="value">${money(data.totals.invoiced)}</div></div>
    <div class="stat"><div class="label">إجمالي المسدد</div><div class="value">${money(data.totals.paid)}</div></div>
    <div class="stat"><div class="label">إجمالي المتبقي</div><div class="value">${money(data.totals.balance)}</div></div>
    <div class="stat"><div class="label">المتأخر</div><div class="value">${money(data.totals.overdue)}</div><div class="sub">حسب تاريخ الاستحقاق</div></div>
  </div>
  <div class="grid-2"><section class="panel"><h3>حالة الفواتير</h3><div class="mini-list">
    <div class="mini-row"><span>🔴 غير مسددة</span><strong>${data.counts.unpaid||0}</strong></div><div class="mini-row"><span>🟡 مسددة جزئيًا</span><strong>${data.counts.partial||0}</strong></div><div class="mini-row"><span>🟢 مسددة بالكامل</span><strong>${data.counts.paid||0}</strong></div>
    <div class="mini-row"><span>💵 نقدي هذا الشهر</span><strong class="money">${money(data.month_payments.cash)}</strong></div><div class="mini-row"><span>🏦 مصرف هذا الشهر</span><strong class="money">${money(data.month_payments.bank)}</strong></div></div></section>
    <section class="panel"><h3>أعلى الموردين مديونية</h3><div class="mini-list">${data.top_suppliers.length?data.top_suppliers.map(x=>`<div class="mini-row"><span>${esc(x.name)}</span><strong class="money">${money(x.balance)}</strong></div>`).join(''):'<div class="empty">لا توجد بيانات</div>'}</div></section></div>
  <section class="panel" style="margin-top:14px"><h3>المديونية حسب الفروع</h3><div class="mini-list">${data.branches.length?data.branches.map(x=>`<div class="mini-row"><span>${esc(x.name)}</span><strong class="money">${money(x.balance)}</strong></div>`).join(''):'<div class="empty">لا توجد بيانات</div>'}</div></section>`;
}

async function suppliersView(main){
  state.suppliers=await api('/api/suppliers');
  main.innerHTML=`<div class="page-head"><div><h2>الموردين</h2><div class="muted">${state.suppliers.length} مورد</div></div><div class="page-head-actions">${can('manage_suppliers')?'<button class="btn btn-primary" id="addSupplier">+ مورد</button>':''}</div></div>
  <div class="toolbar"><input id="supplierSearch" class="input" placeholder="بحث باسم المورد..."></div><div id="supplierRows"></div>`;
  if(can('manage_suppliers'))document.getElementById('addSupplier').onclick=()=>supplierModal();
  document.getElementById('supplierSearch').oninput=renderSupplierRows;renderSupplierRows();
}
function renderSupplierRows(){const box=document.getElementById('supplierRows');if(!box)return;const q=(document.getElementById('supplierSearch')?.value||'').trim().toLowerCase();const rows=state.suppliers.filter(s=>!q||s.name.toLowerCase().includes(q));
  const actions=s=>`<button class="btn btn-soft btn-sm" data-summary="${s.id}">كشف</button>${can('manage_suppliers')?`<button class="btn btn-ghost btn-sm" data-edit="${s.id}">تعديل</button><button class="btn btn-danger btn-sm" data-delete="${s.id}">حذف</button>`:''}`;
  box.innerHTML=`<div class="table-wrap desktop-table"><table><thead><tr><th>المورد</th><th>الهاتف</th><th>ملاحظات</th><th></th></tr></thead><tbody>${rows.map(s=>`<tr><td><strong>${esc(s.name)}</strong></td><td>${esc(s.phone||'-')}</td><td>${esc(s.notes||'-')}</td><td><div class="actions">${actions(s)}</div></td></tr>`).join('')}</tbody></table></div><div class="mobile-list">${rows.map(s=>`<div class="item-card"><div class="item-title"><span>${esc(s.name)}</span></div><div class="item-meta"><div><span>الهاتف</span>${esc(s.phone||'-')}</div><div><span>ملاحظات</span>${esc(s.notes||'-')}</div></div><div class="item-actions">${actions(s)}</div></div>`).join('')||'<div class="empty">لا توجد نتائج</div>'}</div>`;
  box.querySelectorAll('[data-summary]').forEach(b=>b.onclick=()=>supplierSummaryModal(b.dataset.summary));
  box.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>supplierModal(state.suppliers.find(s=>s.id===b.dataset.edit)));
  box.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{if(!confirmAction('حذف المورد؟'))return;try{await api(`/api/suppliers/${b.dataset.delete}`,{method:'DELETE'});toast('تم حذف المورد');await suppliersView(document.getElementById('main'));}catch(e){toast(e.message,true);}});
}
function supplierModal(s=null,onSaved=null){showModal(`${s?'تعديل':'إضافة'} مورد`,`<form id="supplierForm"><div class="field"><label>اسم المورد *</label><input class="input" name="name" required value="${esc(s?.name||'')}"></div><div class="field"><label>الهاتف</label><input class="input" name="phone" value="${esc(s?.phone||'')}"></div><div class="field"><label>ملاحظات</label><textarea class="textarea" name="notes">${esc(s?.notes||'')}</textarea></div></form>`,async()=>{const f=document.getElementById('supplierForm');if(!f.reportValidity())return false;const fd=new FormData(f);const payload={name:fd.get('name'),phone:fd.get('phone')||null,notes:fd.get('notes')||null};const saved=await api(s?`/api/suppliers/${s.id}`:'/api/suppliers',{method:s?'PUT':'POST',body:JSON.stringify(payload)});state.suppliers=await api('/api/suppliers');toast('تم حفظ المورد');if(onSaved)onSaved(saved);return true;});}
async function supplierSummaryModal(id){try{const d=await api(`/api/suppliers/${id}/summary`);showModal(`كشف ${d.supplier.name}`,`<div class="supplier-summary"><div><small>الفواتير</small><strong>${money(d.totals.invoiced)}</strong></div><div><small>المسدد</small><strong>${money(d.totals.paid)}</strong></div><div><small>المتبقي</small><strong>${money(d.totals.balance)}</strong></div></div><h4>حسب الفروع</h4><div class="mini-list">${d.by_branch.map(x=>`<div class="mini-row"><span>${esc(x.branch_name)}</span><span class="money">${money(x.balance)}</span></div>`).join('')||'<div class="empty">لا توجد فواتير</div>'}</div><h4>الفواتير</h4><div class="allocation-list">${d.invoices.map(i=>`<div class="allocation-row" style="grid-template-columns:1fr 130px"><div class="desc"><strong>فاتورة ${esc(i.invoice_number)}</strong>${esc((i.branches||{}).name)} — ${esc(i.invoice_date)}</div><div>${statusBadge(i.status)}<div class="money">${money(i.balance)}</div></div></div>`).join('')}</div>`,null,{saveText:null,large:true});}catch(e){toast(e.message,true);}}

async function invoicesView(main){
  const [invoices]=await Promise.all([api('/api/invoices'),state.suppliers.length?Promise.resolve():api('/api/suppliers').then(x=>state.suppliers=x)]);state.invoices=invoices||[];
  main.innerHTML=`<div class="page-head"><div><h2>الفواتير</h2><div class="muted">الفاتورة = رقم + قيمة + فرع + مورد</div></div><div class="page-head-actions">${can('create_invoices')?'<button class="btn btn-primary" id="addInvoice">+ فاتورة</button>':''}</div></div>
  <div class="toolbar"><input class="input" id="invoiceSearch" placeholder="بحث برقم الفاتورة أو المورد..."><select class="select" id="invoiceBranch">${branchOptions(true)}</select><select class="select" id="invoiceStatus"><option value="">كل الحالات</option><option value="unpaid">غير مسددة</option><option value="partial">جزئي</option><option value="paid">مسددة</option></select></div><div id="invoiceRows"></div>`;
  if(can('create_invoices'))document.getElementById('addInvoice').onclick=()=>invoiceModal();
  ['invoiceSearch','invoiceBranch','invoiceStatus'].forEach(id=>document.getElementById(id).oninput=renderInvoiceRows);renderInvoiceRows();
}
function renderInvoiceRows(){const box=document.getElementById('invoiceRows');if(!box)return;const q=(document.getElementById('invoiceSearch')?.value||'').trim().toLowerCase();const branch=document.getElementById('invoiceBranch')?.value||'';const status=document.getElementById('invoiceStatus')?.value||'';const rows=state.invoices.filter(i=>(!branch||i.branch_id===branch)&&(!status||i.status===status)&&(!q||i.invoice_number.toLowerCase().includes(q)||((i.suppliers||{}).name||'').toLowerCase().includes(q)));
 const actions=i=>`${i.pdf_path?`<button class="btn btn-soft btn-sm" data-pdf="${i.id}">PDF</button>`:''}${can('edit_invoices')?`<button class="btn btn-ghost btn-sm" data-edit="${i.id}">تعديل</button>`:''}${can('delete_invoices')?`<button class="btn btn-danger btn-sm" data-delete="${i.id}">حذف</button>`:''}`;
 box.innerHTML=`<div class="table-wrap desktop-table"><table><thead><tr><th>رقم الفاتورة</th><th>المورد</th><th>الفرع</th><th>القيمة</th><th>المسدد</th><th>المتبقي</th><th>الحالة</th><th>التاريخ</th><th>الاستحقاق</th><th></th></tr></thead><tbody>${rows.map(i=>`<tr><td><strong>${esc(i.invoice_number)}</strong></td><td>${esc((i.suppliers||{}).name)}</td><td>${esc((i.branches||{}).name)}</td><td class="money">${money(i.amount)}</td><td class="money">${money(i.paid_amount)}</td><td class="money">${money(i.balance)}</td><td>${statusBadge(i.status)}</td><td>${esc(i.invoice_date)}</td><td>${esc(i.due_date||'-')}</td><td><div class="actions">${actions(i)}</div></td></tr>`).join('')}</tbody></table></div><div class="mobile-list">${rows.map(i=>`<div class="item-card"><div class="item-title"><span>فاتورة ${esc(i.invoice_number)}</span>${statusBadge(i.status)}</div><div class="muted" style="margin-top:5px">${esc((i.suppliers||{}).name)} — ${esc((i.branches||{}).name)}</div><div class="item-meta"><div><span>القيمة</span><b>${money(i.amount)}</b></div><div><span>المتبقي</span><b>${money(i.balance)}</b></div><div><span>التاريخ</span>${esc(i.invoice_date)}</div><div><span>الاستحقاق</span>${esc(i.due_date||'-')}</div></div><div class="item-actions">${actions(i)}</div></div>`).join('')||'<div class="empty">لا توجد فواتير</div>'}</div>`;
 box.querySelectorAll('[data-pdf]').forEach(b=>b.onclick=()=>openPdf(b.dataset.pdf));box.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>invoiceModal(state.invoices.find(i=>i.id===b.dataset.edit)));box.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{if(!confirmAction('حذف الفاتورة؟'))return;try{await api(`/api/invoices/${b.dataset.delete}`,{method:'DELETE'});toast('تم حذف الفاتورة');await invoicesView(document.getElementById('main'));}catch(e){toast(e.message,true);}});
}
async function openPdf(id){try{const res=await api(`/api/invoices/${id}/pdf`);const blob=await res.blob();window.open(URL.createObjectURL(blob),'_blank');}catch(e){toast(e.message,true);}}
function invoiceModal(i=null){const activeBranches=state.branches.filter(b=>b.active||b.id===i?.branch_id);showModal(`${i?'تعديل':'إضافة'} فاتورة`,`<form id="invoiceForm" class="form-grid">
 <div class="field full"><label>المورد *</label><div style="display:flex;gap:7px"><select class="select" name="supplier_id" id="invSupplier" required style="flex:1">${supplierOptions()}</select>${can('manage_suppliers')?'<button type="button" class="btn btn-soft" id="quickSupplier">+ مورد</button>':''}</div></div>
 <div class="field"><label>الفرع *</label><select class="select" name="branch_id" required><option value="">اختر الفرع</option>${activeBranches.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></div>
 <div class="field"><label>رقم الفاتورة *</label><input class="input" name="invoice_number" required value="${esc(i?.invoice_number||'')}"></div>
 <div class="field"><label>قيمة الفاتورة *</label><input class="input" name="amount" type="number" min="0.01" step="0.01" required value="${i?.amount??''}"></div>
 <div class="field"><label>تاريخ الفاتورة *</label><input class="input" name="invoice_date" type="date" required value="${i?.invoice_date||isoToday()}"></div>
 <div class="field"><label>تاريخ الاستحقاق <span class="muted">اختياري</span></label><input class="input" name="due_date" type="date" value="${i?.due_date||''}"></div>
 <div class="field full"><label>PDF الفاتورة <span class="muted">اختياري — حتى 10MB</span></label><input class="input" name="pdf" type="file" accept="application/pdf"></div>
 <div class="field full"><label>ملاحظات</label><textarea class="textarea" name="notes">${esc(i?.notes||'')}</textarea></div></form>`,async()=>{const f=document.getElementById('invoiceForm');if(!f.reportValidity())return false;const fd=new FormData(f);const payload={supplier_id:fd.get('supplier_id'),branch_id:fd.get('branch_id'),invoice_number:fd.get('invoice_number'),amount:Number(fd.get('amount')),invoice_date:fd.get('invoice_date'),due_date:fd.get('due_date')||null,notes:fd.get('notes')||null};const saved=await api(i?`/api/invoices/${i.id}`:'/api/invoices',{method:i?'PUT':'POST',body:JSON.stringify(payload)});const id=i?.id||saved.id;const file=fd.get('pdf');if(file&&file.size){const up=new FormData();up.append('file',file);await api(`/api/invoices/${id}/pdf`,{method:'POST',body:up});}if(saved.duplicate_warning)toast('تم الحفظ — تنبيه: رقم الفاتورة موجود سابقًا');else toast('تم حفظ الفاتورة');if(state.view==='invoices')await invoicesView(document.getElementById('main'));return true;});
 const f=document.getElementById('invoiceForm');f.elements.supplier_id.value=i?.supplier_id||'';f.elements.branch_id.value=i?.branch_id||'';if(can('manage_suppliers'))document.getElementById('quickSupplier').onclick=()=>supplierModal(null,s=>{const sel=document.getElementById('invSupplier');sel.innerHTML=supplierOptions();sel.value=s.id;});}

async function paymentsView(main){
  const [payments]=await Promise.all([api('/api/payments'),state.suppliers.length?Promise.resolve():api('/api/suppliers').then(x=>state.suppliers=x)]);state.payments=payments||[];
  main.innerHTML=`<div class="page-head"><div><h2>السدادات</h2><div class="muted">كل سداد خاص بمورد واحد وفرع واحد ويمكن توزيعه على عدة فواتير</div></div><div class="page-head-actions">${can('create_payments')?'<button class="btn btn-primary" id="addPayment">+ سداد</button>':''}</div></div>
  <div class="toolbar"><select class="select" id="paymentBranch">${branchOptions(true)}</select><select class="select" id="paymentSupplier"><option value="">كل الموردين</option>${supplierOptions(false)}</select></div><div id="paymentRows"></div>`;
  if(can('create_payments'))document.getElementById('addPayment').onclick=()=>paymentModal();['paymentBranch','paymentSupplier'].forEach(id=>document.getElementById(id).oninput=renderPaymentRows);renderPaymentRows();
}
function allocationText(p){return (p.payment_allocations||[]).map(a=>`#${esc((a.invoices||{}).invoice_number||'')} (${money(a.amount)})`).join('، ');}
function renderPaymentRows(){const box=document.getElementById('paymentRows');if(!box)return;const branch=document.getElementById('paymentBranch')?.value||'';const supplier=document.getElementById('paymentSupplier')?.value||'';const rows=state.payments.filter(p=>(!branch||p.branch_id===branch)&&(!supplier||p.supplier_id===supplier));const actions=p=>`${can('edit_payments')?`<button class="btn btn-ghost btn-sm" data-edit="${p.id}">تعديل</button>`:''}${can('delete_payments')?`<button class="btn btn-danger btn-sm" data-delete="${p.id}">حذف</button>`:''}`;
 box.innerHTML=`<div class="table-wrap desktop-table"><table><thead><tr><th>التاريخ</th><th>المورد</th><th>الفرع</th><th>القيمة</th><th>الطريقة</th><th>التوزيع</th><th></th></tr></thead><tbody>${rows.map(p=>`<tr><td>${esc(p.payment_date)}</td><td><strong>${esc((p.suppliers||{}).name)}</strong></td><td>${esc((p.branches||{}).name)}</td><td class="money">${money(p.amount)}</td><td>${paymentMethod(p)}</td><td>${allocationText(p)}</td><td><div class="actions">${actions(p)}</div></td></tr>`).join('')}</tbody></table></div><div class="mobile-list">${rows.map(p=>`<div class="item-card"><div class="item-title"><span>${esc((p.suppliers||{}).name)}</span><span class="money">${money(p.amount)}</span></div><div class="muted" style="margin-top:5px">${esc((p.branches||{}).name)} — ${paymentMethod(p)}</div><div class="item-meta"><div><span>التاريخ</span>${esc(p.payment_date)}</div><div><span>الفواتير</span>${allocationText(p)||'-'}</div></div><div class="item-actions">${actions(p)}</div></div>`).join('')||'<div class="empty">لا توجد سدادات</div>'}</div>`;
 box.querySelectorAll('[data-edit]').forEach(b=>b.onclick=async()=>{try{const p=await api(`/api/payments/${b.dataset.edit}`);paymentModal(p);}catch(e){toast(e.message,true);}});box.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{if(!confirmAction('حذف السداد؟ سيتم إعادة المبالغ إلى أرصدة الفواتير.'))return;try{await api(`/api/payments/${b.dataset.delete}`,{method:'DELETE'});toast('تم حذف السداد');await paymentsView(document.getElementById('main'));}catch(e){toast(e.message,true);}});
}
function paymentModal(p=null){showModal(`${p?'تعديل':'إضافة'} سداد`,`<form id="paymentForm" class="form-grid">
 <div class="field"><label>المورد *</label><select class="select" name="supplier_id" id="paySupplier" required>${supplierOptions()}</select></div><div class="field"><label>الفرع *</label><select class="select" name="branch_id" id="payBranch" required><option value="">اختر الفرع</option>${branchOptions(false)}</select></div>
 <div class="field"><label>تاريخ السداد *</label><input class="input" type="date" name="payment_date" required value="${p?.payment_date||isoToday()}"></div><div class="field"><label>طريقة السداد *</label><select class="select" name="method" id="payMethod"><option value="cash">نقدي</option><option value="bank">مصرف</option></select></div>
 <div class="field full hidden" id="bankField"><label>اسم المصرف *</label><input class="input" name="bank_name" value="${esc(p?.bank_name||'')}"></div><div class="field full"><label>ملاحظات</label><textarea class="textarea" name="notes">${esc(p?.notes||'')}</textarea></div>
 <div class="full"><div style="display:flex;justify-content:space-between;align-items:center"><strong>توزيع السداد على الفواتير</strong><span class="hint">اختر الفواتير واكتب المبلغ لكل فاتورة</span></div><div id="allocationList" class="allocation-list"><div class="empty">اختر المورد والفرع</div></div><div class="sum-box"><span>إجمالي السداد</span><span id="paymentSum">0.00 د.ل</span></div></div></form>`,async()=>{const f=document.getElementById('paymentForm');if(!f.reportValidity())return false;const selected=[...document.querySelectorAll('.alloc-check:checked')];const allocations=selected.map(c=>({invoice_id:c.dataset.id,amount:Number(document.querySelector(`[data-amount="${c.dataset.id}"]`).value||0)})).filter(x=>x.amount>0);const amount=allocations.reduce((s,x)=>s+x.amount,0);if(!allocations.length){toast('اختر فاتورة واحدة على الأقل وحدد مبلغ السداد',true);return false;}const fd=new FormData(f);const payload={supplier_id:fd.get('supplier_id'),branch_id:fd.get('branch_id'),amount:Number(amount.toFixed(2)),payment_date:fd.get('payment_date'),method:fd.get('method'),bank_name:fd.get('method')==='bank'?fd.get('bank_name'):null,notes:fd.get('notes')||null,allocations};await api(p?`/api/payments/${p.id}`:'/api/payments',{method:p?'PUT':'POST',body:JSON.stringify(payload)});toast('تم حفظ السداد');if(state.view==='payments')await paymentsView(document.getElementById('main'));return true;},{large:true});
 const f=document.getElementById('paymentForm'),supplier=f.elements.supplier_id,branch=f.elements.branch_id,method=f.elements.method;supplier.value=p?.supplier_id||'';branch.value=p?.branch_id||'';method.value=p?.method||'cash';
 const toggleBank=()=>{const bank=document.getElementById('bankField');bank.classList.toggle('hidden',method.value!=='bank');f.elements.bank_name.required=method.value==='bank';};method.onchange=toggleBank;toggleBank();
 let old={};(p?.payment_allocations||[]).forEach(a=>old[a.invoice_id]=Number(a.amount));
 const load=async()=>{const sid=supplier.value,bid=branch.value,box=document.getElementById('allocationList');if(!sid||!bid){box.innerHTML='<div class="empty">اختر المورد والفرع</div>';return;}box.innerHTML='<div class="loading">جاري تحميل الفواتير...</div>';try{const rows=await api(`/api/invoices?supplier_id=${encodeURIComponent(sid)}&branch_id=${encodeURIComponent(bid)}`);const available=rows.filter(i=>Number(i.balance)>0||old[i.id]);box.innerHTML=available.length?available.map(i=>{const current=old[i.id]||0;const max=Number(i.balance)+current;return `<label class="allocation-row"><input class="alloc-check" type="checkbox" data-id="${i.id}" ${current?'checked':''}><div class="desc"><strong>فاتورة ${esc(i.invoice_number)}</strong>المتبقي المتاح: ${money(max)} — ${esc(i.invoice_date)}</div><input class="input alloc-amount" data-amount="${i.id}" type="number" min="0" max="${max}" step="0.01" value="${current||''}" ${current?'':'disabled'}></label>`;}).join(''):'<div class="empty">لا توجد فواتير عليها رصيد لهذا المورد والفرع</div>';wireAllocations();}catch(e){box.innerHTML=`<div class="empty">${esc(e.message)}</div>`;}};
 const wireAllocations=()=>{document.querySelectorAll('.alloc-check').forEach(c=>c.onchange=()=>{const inp=document.querySelector(`[data-amount="${c.dataset.id}"]`);inp.disabled=!c.checked;if(!c.checked)inp.value='';updateSum();});document.querySelectorAll('.alloc-amount').forEach(i=>i.oninput=updateSum);updateSum();};
 const updateSum=()=>{const s=[...document.querySelectorAll('.alloc-check:checked')].reduce((sum,c)=>sum+Number(document.querySelector(`[data-amount="${c.dataset.id}"]`).value||0),0);document.getElementById('paymentSum').textContent=money(s);};supplier.onchange=load;branch.onchange=load;if(p)load();}

async function settingsView(main){
  main.innerHTML=`<div class="page-head"><div><h2>الإعدادات</h2><div class="muted">الفروع والمستخدمين والصلاحيات</div></div></div><div class="settings-tabs">${can('manage_branches')?'<button class="btn btn-soft active" data-tab="branches">الفروع</button>':''}${can('manage_users')?'<button class="btn btn-soft" data-tab="users">المستخدمين</button>':''}</div><div id="settingsBody"></div>`;
  const tabs=[...main.querySelectorAll('[data-tab]')];tabs.forEach(b=>b.onclick=()=>{tabs.forEach(x=>x.classList.remove('active'));b.classList.add('active');renderSettingsTab(b.dataset.tab);});renderSettingsTab(tabs[0]?.dataset.tab||'branches');
}
async function renderSettingsTab(tab){const box=document.getElementById('settingsBody');if(tab==='branches'){
  state.branches=await api('/api/admin/branches');box.innerHTML=`<div class="panel"><div class="page-head"><h3>الفروع</h3><button class="btn btn-primary btn-sm" id="newBranch">+ فرع</button></div><div class="mini-list">${state.branches.map(b=>`<div class="mini-row"><span><strong>${esc(b.name)}</strong> ${b.active?'<span class="badge badge-green">نشط</span>':'<span class="badge badge-red">موقوف</span>'}</span><span class="actions"><button class="btn btn-ghost btn-sm" data-edit="${b.id}">تعديل</button><button class="btn btn-danger btn-sm" data-delete="${b.id}">حذف</button></span></div>`).join('')||'<div class="empty">لا توجد فروع</div>'}</div></div>`;document.getElementById('newBranch').onclick=()=>branchModal();box.querySelectorAll('[data-edit]').forEach(x=>x.onclick=()=>branchModal(state.branches.find(b=>b.id===x.dataset.edit)));box.querySelectorAll('[data-delete]').forEach(x=>x.onclick=async()=>{if(!confirmAction('حذف الفرع؟ إذا كان مرتبطًا ببيانات سيمنع النظام الحذف.'))return;try{await api(`/api/admin/branches/${x.dataset.delete}`,{method:'DELETE'});toast('تم حذف الفرع');renderSettingsTab('branches');}catch(e){toast(e.message,true);}});
 }else{state.users=await api('/api/admin/users');box.innerHTML=`<div class="panel"><div class="page-head"><h3>المستخدمين</h3><button class="btn btn-primary btn-sm" id="newUser">+ مستخدم</button></div><div class="mini-list">${state.users.map(u=>`<div class="mini-row"><span><strong>${esc(u.full_name)}</strong><div class="muted">${esc(u.username)} — ${esc(ROLE_LABELS[u.role]||u.role)} — ${u.all_branches?'كل الفروع':`${u.branch_ids?.length||0} فرع`}</div></span><span class="actions"><button class="btn btn-ghost btn-sm" data-edit="${u.id}">تعديل</button><button class="btn btn-danger btn-sm" data-delete="${u.id}">حذف</button></span></div>`).join('')}</div></div>`;document.getElementById('newUser').onclick=()=>userModal();box.querySelectorAll('[data-edit]').forEach(x=>x.onclick=()=>userModal(state.users.find(u=>u.id===x.dataset.edit)));box.querySelectorAll('[data-delete]').forEach(x=>x.onclick=async()=>{if(!confirmAction('حذف المستخدم؟'))return;try{await api(`/api/admin/users/${x.dataset.delete}`,{method:'DELETE'});toast('تم حذف المستخدم');renderSettingsTab('users');}catch(e){toast(e.message,true);}});}}
function branchModal(b=null){showModal(`${b?'تعديل':'إضافة'} فرع`,`<form id="branchForm"><div class="field"><label>اسم الفرع *</label><input class="input" name="name" required value="${esc(b?.name||'')}"></div>${b?`<div class="field"><label><input type="checkbox" name="active" ${b.active?'checked':''}> الفرع نشط</label><div class="hint">إيقاف الفرع يحافظ على بياناته القديمة لكنه يمنع استخدامه في الإدخالات الجديدة.</div></div>`:''}</form>`,async()=>{const f=document.getElementById('branchForm');if(!f.reportValidity())return false;const fd=new FormData(f);await api(b?`/api/admin/branches/${b.id}`:'/api/admin/branches',{method:b?'PUT':'POST',body:JSON.stringify(b?{name:fd.get('name'),active:!!f.elements.active.checked}:{name:fd.get('name')})});toast('تم حفظ الفرع');state.branches=await api('/api/admin/branches');if(state.view==='settings')renderSettingsTab('branches');return true;});}
function userModal(u=null){
  const initialPerms=u?.effective_permissions||ROLE_DEFAULTS[u?.role||'finance']||{};
  showModal(`${u?'تعديل':'إضافة'} مستخدم`,`<form id="userForm" class="form-grid">
 <div class="field"><label>الاسم *</label><input class="input" name="full_name" required value="${esc(u?.full_name||'')}"></div><div class="field"><label>اسم المستخدم *</label><input class="input" name="username" required pattern="[A-Za-z0-9._-]{3,30}" value="${esc(u?.username||'')}"></div>
 <div class="field"><label>كلمة المرور ${u?'<span class="muted">اتركها فارغة بدون تغيير</span>':'*'}</label><input class="input" type="password" name="password" ${u?'':'required'} minlength="6"></div><div class="field"><label>الدور</label><select class="select" name="role"><option value="finance">مالي</option><option value="viewer">مشاهدة فقط</option><option value="admin">مدير</option></select></div>
 ${u?'<div class="field full"><label><input type="checkbox" name="active" checked> الحساب نشط</label></div>':''}
 <div class="field full"><label><input type="checkbox" name="all_branches" id="allBranches"> كل الفروع</label></div><div class="field full" id="branchPick"><label>الفروع المسموح بها</label><div class="branch-checks">${state.branches.filter(b=>b.active||u?.branch_ids?.includes(b.id)).map(b=>`<label><input type="checkbox" name="branch_ids" value="${b.id}" ${u?.branch_ids?.includes(b.id)?'checked':''}> ${esc(b.name)}</label>`).join('')}</div></div>
 <div class="field full"><label>الصلاحيات</label><div class="hint">يمكن تفعيل أو إلغاء كل صلاحية بشكل مستقل عن الدور.</div><div class="permissions">${Object.entries(PERMISSION_LABELS).map(([k,label])=>`<label class="check-card"><input type="checkbox" name="perm_${k}" ${initialPerms[k]?'checked':''}> ${esc(label)}</label>`).join('')}</div></div></form>`,async()=>{const f=document.getElementById('userForm');if(!f.reportValidity())return false;const fd=new FormData(f);const permissions={};Object.keys(PERMISSION_LABELS).forEach(k=>{permissions[k]=!!f.elements[`perm_${k}`]?.checked;});const payload={full_name:fd.get('full_name'),username:fd.get('username'),role:fd.get('role'),all_branches:f.elements.all_branches.checked,branch_ids:[...f.querySelectorAll('input[name="branch_ids"]:checked')].map(x=>x.value),permissions};if(u){payload.active=f.elements.active.checked;payload.password=fd.get('password')||null;}else payload.password=fd.get('password');await api(u?`/api/admin/users/${u.id}`:'/api/admin/users',{method:u?'PUT':'POST',body:JSON.stringify(payload)});toast('تم حفظ المستخدم');if(state.view==='settings')renderSettingsTab('users');return true;},{large:true});
  const f=document.getElementById('userForm');f.elements.role.value=u?.role||'finance';if(u)f.elements.active.checked=u.active!==false;f.elements.all_branches.checked=u?.all_branches||false;
  const sync=()=>document.getElementById('branchPick').classList.toggle('hidden',f.elements.all_branches.checked||f.elements.role.value==='admin');
  f.elements.all_branches.onchange=sync;
  f.elements.role.onchange=()=>{const role=f.elements.role.value;if(role==='admin')f.elements.all_branches.checked=true;if(!u){const defaults=ROLE_DEFAULTS[role]||{};Object.keys(PERMISSION_LABELS).forEach(k=>{f.elements[`perm_${k}`].checked=!!defaults[k];});}sync();};
  sync();
}

function showModal(title,body,onSave=null,opts={}){const wrap=document.createElement('div');wrap.className='modal-backdrop';wrap.innerHTML=`<div class="modal ${opts.large?'modal-lg':''}"><div class="modal-head"><h3>${esc(title)}</h3><button class="btn btn-ghost btn-sm" data-close>✕</button></div><div class="modal-body">${body}</div><div class="modal-foot">${onSave&&opts.saveText!==null?`<button class="btn btn-primary" data-save>${esc(opts.saveText||'حفظ')}</button>`:''}<button class="btn btn-ghost" data-close>إغلاق</button></div></div>`;document.body.appendChild(wrap);const close=()=>wrap.remove();wrap.querySelectorAll('[data-close]').forEach(b=>b.onclick=close);wrap.onclick=e=>{if(e.target===wrap)close();};const save=wrap.querySelector('[data-save]');if(save)save.onclick=async()=>{save.disabled=true;try{const ok=await onSave();if(ok!==false)close();}catch(e){toast(e.message,true);}finally{if(document.body.contains(save))save.disabled=false;}};return wrap;}

window.addEventListener('popstate',()=>{state.view=new URLSearchParams(location.search).get('view')||'dashboard';if(state.profile)renderApp();});
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
bootstrap();
