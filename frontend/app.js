const root = document.getElementById('root');
const toastEl = document.getElementById('toast');

const state = {
  accessToken: localStorage.getItem('debts_access') || '',
  refreshToken: localStorage.getItem('debts_refresh') || '',
  profile: null,
  branches: [], suppliers: [], supplierRows: [], invoices: [], payments: [], users: [], categories: [],
  supplierBranchId: '',
  supplierCategoryId: '',
  view: new URLSearchParams(location.search).get('view') || 'dashboard',
  supplierId: new URLSearchParams(location.search).get('supplier_id') || '',
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
  if(can('view_suppliers')){
    jobs.push(api('/api/suppliers').then(x=>state.suppliers=x||[]));
    jobs.push(api('/api/admin/supplier-categories').then(x=>state.categories=x||[]));
  }
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

function navButton(view,icon,label,perm){if(perm&&!can(perm))return '';const active=state.view===view||(view==='suppliers'&&state.view==='supplier');return `<button class="nav-btn ${active?'active':''}" data-view="${view}"><span>${icon}</span>${label}</button>`;}
function syncStickyOffsets(){
  const topbar=document.querySelector('.topbar');
  const h=topbar?Math.ceil(topbar.getBoundingClientRect().height):0;
  document.documentElement.style.setProperty('--app-topbar-height',`${h}px`);
}
function renderApp(){
  if(!state.profile)return renderLogin();
  const allowedViews={dashboard:'view_dashboard',suppliers:'view_suppliers',supplier:'view_suppliers',invoices:'view_invoices',payments:'view_payments',settings:null};
  if(allowedViews[state.view] && !can(allowedViews[state.view])) state.view=can('view_dashboard')?'dashboard':can('view_invoices')?'invoices':'settings';
  const settingsVisible=can('manage_branches')||can('manage_suppliers')||can('manage_users');
  root.innerHTML=`<div class="app">
    <header class="topbar"><div class="topbar-inner"><div class="top-title"><div>💰</div><div><strong>Abdo Debts</strong><small>نظام المديونيات</small></div></div><div class="user-box"><span class="user-name">${esc(state.profile.full_name)}</span><button class="btn btn-ghost btn-sm" id="logoutBtn">خروج</button></div></div></header>
    <main class="main" id="main"></main>
    <nav class="nav"><div class="nav-inner">${navButton('dashboard','▦','الرئيسية','view_dashboard')}${navButton('suppliers','🏢','الموردين','view_suppliers')}${navButton('invoices','🧾','الفواتير','view_invoices')}${navButton('payments','💳','السدادات','view_payments')}${settingsVisible?navButton('settings','⚙️','الإعدادات',null):''}</div></nav>
  </div>`;
  document.getElementById('logoutBtn').onclick=logout;
  root.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>go(b.dataset.view));
  syncStickyOffsets();
  requestAnimationFrame(syncStickyOffsets);
  renderView();
}
function go(view){state.view=view;if(view!=='supplier')state.supplierId='';const u=new URL(location.href);u.searchParams.set('view',view);if(view!=='supplier')u.searchParams.delete('supplier_id');history.replaceState({},'',u);renderApp();}
function openSupplierPage(id){state.view='supplier';state.supplierId=id;const u=new URL(location.href);u.searchParams.set('view','supplier');u.searchParams.set('supplier_id',id);history.pushState({},'',u);renderApp();}
async function renderView(){const main=document.getElementById('main');main.innerHTML='<div class="loading">جاري التحميل...</div>';try{
  if(state.view==='dashboard')await dashboardView(main);
  else if(state.view==='suppliers')await suppliersView(main);
  else if(state.view==='supplier')await supplierDetailView(main);
  else if(state.view==='invoices')await invoicesView(main);
  else if(state.view==='payments')await paymentsView(main);
  else if(state.view==='settings')await settingsView(main);
}catch(e){main.innerHTML=`<div class="panel"><div class="empty">${esc(e.message)}</div></div>`;toast(e.message,true);}}

function branchOptions(includeAll=false, onlyActive=true){const rows=state.branches.filter(b=>!onlyActive||b.active);return `${includeAll?'<option value="">كل الفروع</option>':''}${rows.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('')}`;}
function supplierOptions(includeBlank=true){return `${includeBlank?'<option value="">اختر المورد</option>':''}${state.suppliers.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}`;}
function statusBadge(s){return `<span class="badge ${s==='paid'?'badge-green':s==='partial'?'badge-amber':'badge-red'}">${STATUS_LABELS[s]||s}</span>`;}
function paymentMethod(p){return p.method==='bank'?`🏦 ${esc(p.bank_name||'مصرف')}`:'💵 نقدي';}
function categoryTags(categories=[]){return categories.length?`<div class="category-tags">${categories.map(c=>`<span class="category-tag">${esc(c.name)}</span>`).join('')}</div>`:'<span class="muted">بدون تصنيف</span>';}

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
  const branchId=state.supplierBranchId||'',categoryId=state.supplierCategoryId||'';
  state.supplierRows=await api(branchId?`/api/suppliers?include_balance=true&branch_id=${encodeURIComponent(branchId)}`:'/api/suppliers?include_balance=true');
  main.innerHTML=`<div class="page-head"><div><h2>الموردين</h2><div class="muted"><span id="supplierCount">${state.supplierRows.length}</span> مورد</div></div><div class="page-head-actions">${can('manage_suppliers')?'<button class="btn btn-primary" id="addSupplier">+ مورد</button>':''}</div></div>
  <div class="toolbar supplier-toolbar"><input id="supplierSearch" class="input" placeholder="بحث باسم المورد..."><select id="supplierBranchFilter" class="select">${branchOptions(true,false)}</select><select id="supplierCategoryFilter" class="select"><option value="">كل التصنيفات</option>${state.categories.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
  <div class="supplier-debt-total"><div><span>إجمالي الدين المتبقي</span><small id="supplierDebtScope">${branchId?'للفرع المحدد':'لكل الفروع'}</small></div><strong class="money" id="supplierDebtTotal">${money(state.supplierRows.reduce((sum,s)=>sum+Number(s.balance||0),0))}</strong></div>
  <div id="supplierRows"></div>`;
  const branchSelect=document.getElementById('supplierBranchFilter'),categorySelect=document.getElementById('supplierCategoryFilter');branchSelect.value=branchId;categorySelect.value=categoryId;state.supplierCategoryId=categorySelect.value;
  if(can('manage_suppliers'))document.getElementById('addSupplier').onclick=()=>supplierModal(null,async()=>refreshSupplierRows());
  document.getElementById('supplierSearch').oninput=renderSupplierRows;
  categorySelect.onchange=()=>{state.supplierCategoryId=categorySelect.value;renderSupplierRows();};
  branchSelect.onchange=async()=>{state.supplierBranchId=branchSelect.value;await refreshSupplierRows();};
  renderSupplierRows();
}
async function refreshSupplierRows(){
  const branchId=state.supplierBranchId||'';
  const box=document.getElementById('supplierRows');if(box)box.innerHTML='<div class="loading">جاري تحميل الموردين...</div>';
  try{
    state.supplierRows=await api(branchId?`/api/suppliers?include_balance=true&branch_id=${encodeURIComponent(branchId)}`:'/api/suppliers?include_balance=true');
    state.suppliers=await api('/api/suppliers');
    renderSupplierRows();
  }catch(e){if(box)box.innerHTML=`<div class="empty">${esc(e.message)}</div>`;toast(e.message,true);}
}
function renderSupplierRows(){const box=document.getElementById('supplierRows');if(!box)return;const q=(document.getElementById('supplierSearch')?.value||'').trim().toLowerCase();const categoryId=document.getElementById('supplierCategoryFilter')?.value||state.supplierCategoryId||'';const rows=state.supplierRows.filter(s=>(!categoryId||(s.categories||[]).some(c=>c.id===categoryId))&&(!q||s.name.toLowerCase().includes(q)));
  const count=document.getElementById('supplierCount');if(count)count.textContent=rows.length;
  const total=document.getElementById('supplierDebtTotal');if(total)total.textContent=money(rows.reduce((sum,s)=>sum+Number(s.balance||0),0));
  const branchId=state.supplierBranchId||'',category=state.categories.find(c=>c.id===categoryId);const scope=document.getElementById('supplierDebtScope');if(scope)scope.textContent=[branchId?'الفرع المحدد':'كل الفروع',category?category.name:'كل التصنيفات'].join(' · ');
  const actions=s=>`<button class="btn btn-primary btn-sm" data-open="${s.id}">فتح</button><button class="btn btn-soft btn-sm" data-summary="${s.id}">كشف</button>${can('manage_suppliers')?`<button class="btn btn-ghost btn-sm" data-edit="${s.id}">تعديل</button><button class="btn btn-danger btn-sm" data-delete="${s.id}">حذف</button>`:''}`;
  box.innerHTML=`<div class="table-wrap desktop-table"><table><thead><tr><th>المورد</th><th>التصنيفات</th><th>المتبقي</th><th>الهاتف</th><th>ملاحظات</th><th></th></tr></thead><tbody>${rows.map(s=>`<tr><td><strong>${esc(s.name)}</strong></td><td>${categoryTags(s.categories)}</td><td class="money supplier-balance-cell">${money(s.balance)}</td><td>${esc(s.phone||'-')}</td><td>${esc(s.notes||'-')}</td><td><div class="actions">${actions(s)}</div></td></tr>`).join('')}</tbody></table></div><div class="mobile-list">${rows.map(s=>`<div class="item-card"><div class="item-title supplier-item-title"><div><span>${esc(s.name)}</span>${categoryTags(s.categories)}</div><div class="supplier-mobile-balance"><small>المتبقي</small><strong class="money">${money(s.balance)}</strong></div></div><div class="item-meta"><div><span>الهاتف</span>${esc(s.phone||'-')}</div><div><span>ملاحظات</span>${esc(s.notes||'-')}</div></div><div class="item-actions">${actions(s)}</div></div>`).join('')||'<div class="empty">لا توجد نتائج</div>'}</div>`;
  box.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>openSupplierPage(b.dataset.open));
  box.querySelectorAll('[data-summary]').forEach(b=>b.onclick=()=>supplierSummaryModal(b.dataset.summary));
  box.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>supplierModal(state.suppliers.find(s=>s.id===b.dataset.edit)||state.supplierRows.find(s=>s.id===b.dataset.edit),async()=>refreshSupplierRows()));
  box.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{if(!confirmAction('حذف المورد؟'))return;try{await api(`/api/suppliers/${b.dataset.delete}`,{method:'DELETE'});state.suppliers=await api('/api/suppliers');toast('تم حذف المورد');await refreshSupplierRows();}catch(e){toast(e.message,true);}});
}
function supplierModal(s=null,onSaved=null){const selected=new Set((s?.categories||[]).map(c=>c.id));showModal(`${s?'تعديل':'إضافة'} مورد`,`<form id="supplierForm"><div class="field"><label>اسم المورد *</label><input class="input" name="name" required value="${esc(s?.name||'')}"></div><div class="field"><label>الهاتف</label><input class="input" name="phone" value="${esc(s?.phone||'')}"></div><div class="field"><label>التصنيفات</label><div class="category-picks">${state.categories.length?state.categories.map(c=>`<label><input type="checkbox" name="category_ids" value="${c.id}" ${selected.has(c.id)?'checked':''}> ${esc(c.name)}</label>`).join(''):'<div class="hint">لا توجد تصنيفات بعد. أضفها من الإعدادات.</div>'}</div><div class="hint">يمكن اختيار أكثر من تصنيف للمورد.</div></div><div class="field"><label>ملاحظات</label><textarea class="textarea" name="notes">${esc(s?.notes||'')}</textarea></div></form>`,async()=>{const f=document.getElementById('supplierForm');if(!f.reportValidity())return false;const fd=new FormData(f);const payload={name:fd.get('name'),phone:fd.get('phone')||null,notes:fd.get('notes')||null,category_ids:[...f.querySelectorAll('input[name="category_ids"]:checked')].map(x=>x.value)};const saved=await api(s?`/api/suppliers/${s.id}`:'/api/suppliers',{method:s?'PUT':'POST',body:JSON.stringify(payload)});state.suppliers=await api('/api/suppliers');toast('تم حفظ المورد');if(onSaved)await onSaved(saved);return true;});}
async function supplierSummaryModal(id){try{const d=await api(`/api/suppliers/${id}/summary`);showModal(`كشف ${d.supplier.name}`,`<div class="supplier-summary"><div><small>الفواتير</small><strong>${money(d.totals.invoiced)}</strong></div><div><small>المسدد</small><strong>${money(d.totals.paid)}</strong></div><div><small>المتبقي</small><strong>${money(d.totals.balance)}</strong></div></div><h4>حسب الفروع</h4><div class="mini-list">${d.by_branch.map(x=>`<div class="mini-row"><span>${esc(x.branch_name)}</span><span class="money">${money(x.balance)}</span></div>`).join('')||'<div class="empty">لا توجد فواتير</div>'}</div><h4>الفواتير</h4><div class="allocation-list">${d.invoices.map(i=>`<div class="allocation-row" style="grid-template-columns:1fr 130px"><div class="desc"><strong>فاتورة ${esc(i.invoice_number)}</strong>${esc((i.branches||{}).name)} — ${esc(i.invoice_date)}</div><div>${statusBadge(i.status)}<div class="money">${money(i.balance)}</div></div></div>`).join('')}</div>`,null,{saveText:null,large:true});}catch(e){toast(e.message,true);}}


async function supplierDetailView(main){
  const id=state.supplierId||new URLSearchParams(location.search).get('supplier_id')||'';
  if(!id){go('suppliers');return;}
  state.supplierId=id;
  const jobs=[api(`/api/suppliers/${encodeURIComponent(id)}/summary`)];
  if(can('view_payments'))jobs.push(api(`/api/payments?supplier_id=${encodeURIComponent(id)}`));
  const results=await Promise.all(jobs),d=results[0],payments=can('view_payments')?(results[1]||[]):[];
  const supplier=d.supplier||{};
  const invoiceActions=i=>`${i.pdf_path?`<button class="btn btn-soft btn-sm" data-supplier-pdf="${i.id}">PDF</button>`:''}${can('edit_invoices')?`<button class="btn btn-ghost btn-sm" data-supplier-invoice-edit="${i.id}">تعديل</button>`:''}${can('delete_invoices')?`<button class="btn btn-danger btn-sm" data-supplier-invoice-delete="${i.id}">حذف</button>`:''}`;
  const paymentActions=p=>`${can('edit_payments')?`<button class="btn btn-ghost btn-sm" data-supplier-payment-edit="${p.id}">تعديل</button>`:''}${can('delete_payments')?`<button class="btn btn-danger btn-sm" data-supplier-payment-delete="${p.id}">حذف</button>`:''}`;
  main.innerHTML=`<div class="supplier-detail-head"><button class="btn btn-ghost" id="backSuppliers">← الموردين</button><div class="supplier-detail-actions">${can('create_invoices')?'<button class="btn btn-primary" id="supplierAddInvoice">+ إضافة فاتورة</button>':''}${can('create_payments')?'<button class="btn btn-soft" id="supplierAddPayment">💳 تسجيل سداد</button>':''}</div></div>
  <section class="supplier-hero"><div><div class="muted">ملف المورد</div><h2>${esc(supplier.name)}</h2>${categoryTags(supplier.categories)}<div class="supplier-contact">${supplier.phone?`📞 ${esc(supplier.phone)}`:''}${supplier.notes?`<span>${esc(supplier.notes)}</span>`:''}</div></div></section>
  <div class="cards supplier-cards"><div class="stat"><div class="label">إجمالي الفواتير</div><div class="value">${money(d.totals.invoiced)}</div></div><div class="stat"><div class="label">إجمالي المسدد</div><div class="value">${money(d.totals.paid)}</div></div><div class="stat"><div class="label">المتبقي</div><div class="value">${money(d.totals.balance)}</div></div></div>
  <div class="supplier-detail-grid"><section class="panel"><h3>حسب الفروع</h3><div class="mini-list">${d.by_branch.length?d.by_branch.map(x=>`<div class="mini-row branch-balance"><span><strong>${esc(x.branch_name)}</strong><small>فواتير ${money(x.invoiced)} · مسدد ${money(x.paid)}</small></span><strong class="money">${money(x.balance)}</strong></div>`).join(''):'<div class="empty">لا توجد فواتير لهذا المورد</div>'}</div></section></div>
  <section class="panel supplier-section"><div class="section-title"><h3>الفواتير</h3><span class="muted">${d.invoices.length} فاتورة</span></div><div class="table-wrap desktop-table"><table><thead><tr><th>رقم الفاتورة</th><th>الفرع</th><th>القيمة</th><th>المسدد</th><th>المتبقي</th><th>الحالة</th><th>التاريخ</th><th></th></tr></thead><tbody>${d.invoices.map(i=>`<tr><td><strong>${esc(i.invoice_number)}</strong></td><td>${esc((i.branches||{}).name||i.branch_name||'')}</td><td class="money">${money(i.amount)}</td><td class="money">${money(i.paid_amount)}</td><td class="money">${money(i.balance)}</td><td>${statusBadge(i.status)}</td><td>${esc(i.invoice_date)}</td><td><div class="actions">${invoiceActions(i)}</div></td></tr>`).join('')}</tbody></table></div><div class="mobile-list">${d.invoices.map(i=>`<div class="item-card"><div class="item-title"><span>فاتورة ${esc(i.invoice_number)}</span>${statusBadge(i.status)}</div><div class="muted" style="margin-top:5px">${esc((i.branches||{}).name||i.branch_name||'')} — ${esc(i.invoice_date)}</div><div class="item-meta"><div><span>القيمة</span><b>${money(i.amount)}</b></div><div><span>المسدد</span><b>${money(i.paid_amount)}</b></div><div><span>المتبقي</span><b>${money(i.balance)}</b></div><div><span>الاستحقاق</span>${esc(i.due_date||'-')}</div></div><div class="item-actions">${invoiceActions(i)}</div></div>`).join('')||'<div class="empty">لا توجد فواتير</div>'}</div></section>
  ${can('view_payments')?`<section class="panel supplier-section"><div class="section-title"><h3>السدادات</h3><span class="muted">${payments.length} سداد</span></div><div class="table-wrap desktop-table"><table><thead><tr><th>التاريخ</th><th>الفرع</th><th>القيمة</th><th>الطريقة</th><th>التوزيع</th><th></th></tr></thead><tbody>${payments.map(p=>`<tr><td>${esc(p.payment_date)}</td><td>${esc((p.branches||{}).name)}</td><td class="money">${money(p.amount)}</td><td>${paymentMethod(p)}</td><td>${allocationText(p)||'-'}</td><td><div class="actions">${paymentActions(p)}</div></td></tr>`).join('')}</tbody></table></div><div class="mobile-list">${payments.map(p=>`<div class="item-card"><div class="item-title"><span>${esc((p.branches||{}).name)}</span><span class="money">${money(p.amount)}</span></div><div class="muted" style="margin-top:5px">${paymentMethod(p)} — ${esc(p.payment_date)}</div><div class="item-meta"><div><span>الفواتير</span>${allocationText(p)||'-'}</div></div><div class="item-actions">${paymentActions(p)}</div></div>`).join('')||'<div class="empty">لا توجد سدادات</div>'}</div></section>`:''}`;
  document.getElementById('backSuppliers').onclick=()=>{state.view='suppliers';state.supplierId='';const u=new URL(location.href);u.searchParams.set('view','suppliers');u.searchParams.delete('supplier_id');history.pushState({},'',u);renderApp();};
  if(can('create_invoices'))document.getElementById('supplierAddInvoice').onclick=()=>invoiceModal(null,{supplierId:id,onSaved:()=>supplierDetailView(document.getElementById('main'))});
  if(can('create_payments'))document.getElementById('supplierAddPayment').onclick=()=>paymentModal(null,{supplierId:id,onSaved:()=>supplierDetailView(document.getElementById('main'))});
  main.querySelectorAll('[data-supplier-pdf]').forEach(b=>b.onclick=()=>openPdf(b.dataset.supplierPdf));
  main.querySelectorAll('[data-supplier-invoice-edit]').forEach(b=>b.onclick=async()=>{try{const rows=await api(`/api/invoices?supplier_id=${encodeURIComponent(id)}`);const inv=rows.find(x=>x.id===b.dataset.supplierInvoiceEdit);if(inv)invoiceModal(inv,{supplierId:id,onSaved:()=>supplierDetailView(document.getElementById('main'))});}catch(e){toast(e.message,true);}});
  main.querySelectorAll('[data-supplier-invoice-delete]').forEach(b=>b.onclick=async()=>{if(!confirmAction('حذف الفاتورة؟'))return;try{await api(`/api/invoices/${b.dataset.supplierInvoiceDelete}`,{method:'DELETE'});toast('تم حذف الفاتورة');await supplierDetailView(document.getElementById('main'));}catch(e){toast(e.message,true);}});
  main.querySelectorAll('[data-supplier-payment-edit]').forEach(b=>b.onclick=async()=>{try{const p=await api(`/api/payments/${b.dataset.supplierPaymentEdit}`);paymentModal(p,{supplierId:id,onSaved:()=>supplierDetailView(document.getElementById('main'))});}catch(e){toast(e.message,true);}});
  main.querySelectorAll('[data-supplier-payment-delete]').forEach(b=>b.onclick=async()=>{if(!confirmAction('حذف السداد؟ سيتم إعادة المبالغ إلى أرصدة الفواتير.'))return;try{await api(`/api/payments/${b.dataset.supplierPaymentDelete}`,{method:'DELETE'});toast('تم حذف السداد');await supplierDetailView(document.getElementById('main'));}catch(e){toast(e.message,true);}});
}

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
function supplierComboboxMarkup(selectedId='',disabled=false){const selected=state.suppliers.find(s=>s.id===selectedId);return `<div class="supplier-combobox${disabled?' is-disabled':''}" id="invoiceSupplierCombo"><input type="hidden" name="supplier_id" id="invSupplier" value="${esc(selectedId)}"><div class="supplier-combobox-control"><input class="input supplier-combobox-input" id="invSupplierSearch" type="text" autocomplete="off" placeholder="ابحث عن المورد..." value="${esc(selected?.name||'')}" ${disabled?'disabled':''} required role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="invSupplierList"><button type="button" class="supplier-combobox-toggle" id="invSupplierToggle" aria-label="عرض كل الموردين" ${disabled?'disabled':''}>⌄</button></div><div class="supplier-combobox-menu hidden" id="invSupplierList" role="listbox"></div></div>`;}
function wireSupplierCombobox(selectedId='',disabled=false){const hidden=document.getElementById('invSupplier'),input=document.getElementById('invSupplierSearch'),toggle=document.getElementById('invSupplierToggle'),menu=document.getElementById('invSupplierList'),combo=document.getElementById('invoiceSupplierCombo');if(!hidden||!input||!menu)return null;let activeIndex=-1;const selectedName=()=>state.suppliers.find(s=>s.id===hidden.value)?.name||'';const validate=()=>{if(disabled){input.setCustomValidity('');return;}input.setCustomValidity(hidden.value?'':'اختر المورد من القائمة');};const filtered=(query='')=>{const q=query.trim().toLowerCase();return state.suppliers.filter(s=>!q||s.name.toLowerCase().includes(q));};const close=()=>{menu.classList.add('hidden');input.setAttribute('aria-expanded','false');activeIndex=-1;};const render=(rows)=>{menu.innerHTML=rows.length?rows.map((s,idx)=>`<button type="button" class="supplier-combobox-option${s.id===hidden.value?' selected':''}" data-supplier-option="${s.id}" data-index="${idx}" role="option" aria-selected="${s.id===hidden.value?'true':'false'}"><span>${esc(s.name)}</span>${(s.categories||[]).length?`<small>${esc((s.categories||[]).map(c=>c.name).join(' · '))}</small>`:''}</button>`).join(''):'<div class="supplier-combobox-empty">لا يوجد مورد مطابق</div>';menu.classList.remove('hidden');input.setAttribute('aria-expanded','true');menu.querySelectorAll('[data-supplier-option]').forEach(btn=>btn.onclick=()=>setSupplier(btn.dataset.supplierOption));};const openAll=()=>{render(filtered(''));};const setSupplier=(id)=>{const s=state.suppliers.find(x=>x.id===id);if(!s)return;hidden.value=s.id;input.value=s.name;validate();close();input.focus();};input.oninput=()=>{const current=selectedName();if(input.value!==current)hidden.value='';validate();render(filtered(input.value));};input.onfocus=()=>{if(!disabled&&!hidden.value)render(filtered(input.value));};if(toggle)toggle.onclick=()=>{if(menu.classList.contains('hidden'))openAll();else close();};input.onkeydown=e=>{if(disabled)return;if(e.key==='Escape'){close();return;}const options=[...menu.querySelectorAll('[data-supplier-option]')];if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(menu.classList.contains('hidden')){render(filtered(input.value));return;}if(!options.length)return;activeIndex=e.key==='ArrowDown'?Math.min(activeIndex+1,options.length-1):Math.max(activeIndex-1,0);options.forEach((x,i)=>x.classList.toggle('active',i===activeIndex));options[activeIndex]?.scrollIntoView({block:'nearest'});}else if(e.key==='Enter'&&!menu.classList.contains('hidden')&&activeIndex>=0){e.preventDefault();setSupplier(options[activeIndex].dataset.supplierOption);}};const outside=e=>{if(!combo.contains(e.target)){close();document.removeEventListener('pointerdown',outside,true);}};combo.addEventListener('pointerdown',()=>setTimeout(()=>document.addEventListener('pointerdown',outside,true),0),{once:true});validate();return {setSupplier,openAll};}
function invoiceModal(i=null,opts={}){const lockedSupplier=opts.supplierId||'';const activeBranches=state.branches.filter(b=>b.active||b.id===i?.branch_id);const initialSupplier=i?.supplier_id||lockedSupplier||'';showModal(`${i?'تعديل':'إضافة'} فاتورة`,`<form id="invoiceForm" class="form-grid">
 <div class="field full"><label>المورد *</label><div class="invoice-supplier-row">${supplierComboboxMarkup(initialSupplier,!!lockedSupplier)}${can('manage_suppliers')&&!lockedSupplier?'<button type="button" class="btn btn-soft" id="quickSupplier">+ مورد</button>':''}</div></div>
 <div class="field"><label>الفرع *</label><select class="select" name="branch_id" required><option value="">اختر الفرع</option>${activeBranches.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></div>
 <div class="field"><label>رقم الفاتورة *</label><input class="input" name="invoice_number" required value="${esc(i?.invoice_number||'')}"></div>
 <div class="field"><label>قيمة الفاتورة *</label><input class="input" name="amount" type="number" min="0.01" step="0.01" required value="${i?.amount??''}"></div>
 <div class="field"><label>تاريخ الفاتورة *</label><input class="input" name="invoice_date" type="date" required value="${i?.invoice_date||isoToday()}"></div>
 <div class="field"><label>تاريخ الاستحقاق <span class="muted">اختياري</span></label><input class="input" name="due_date" type="date" value="${i?.due_date||''}"></div>
 <div class="field full"><label>PDF الفاتورة <span class="muted">اختياري — حتى 10MB</span></label><input class="input" name="pdf" type="file" accept="application/pdf"></div>
 <div class="field full"><label>ملاحظات</label><textarea class="textarea" name="notes">${esc(i?.notes||'')}</textarea></div></form>`,async()=>{const f=document.getElementById('invoiceForm');if(!f.reportValidity())return false;const fd=new FormData(f);const payload={supplier_id:lockedSupplier||fd.get('supplier_id'),branch_id:fd.get('branch_id'),invoice_number:fd.get('invoice_number'),amount:Number(fd.get('amount')),invoice_date:fd.get('invoice_date'),due_date:fd.get('due_date')||null,notes:fd.get('notes')||null};const saved=await api(i?`/api/invoices/${i.id}`:'/api/invoices',{method:i?'PUT':'POST',body:JSON.stringify(payload)});const id=i?.id||saved.id;const file=fd.get('pdf');if(file&&file.size){const up=new FormData();up.append('file',file);await api(`/api/invoices/${id}/pdf`,{method:'POST',body:up});}if(saved.duplicate_warning)toast('تم الحفظ — تنبيه: رقم الفاتورة موجود سابقًا');else toast('تم حفظ الفاتورة');if(opts.onSaved)await opts.onSaved(saved);else if(state.view==='invoices')await invoicesView(document.getElementById('main'));return true;});
 const f=document.getElementById('invoiceForm');const supplierCombo=wireSupplierCombobox(initialSupplier,!!lockedSupplier);f.elements.branch_id.value=i?.branch_id||'';const quick=document.getElementById('quickSupplier');if(quick)quick.onclick=()=>supplierModal(null,s=>{supplierCombo?.setSupplier(s.id);});}

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
function paymentModal(p=null,opts={}){const lockedSupplier=opts.supplierId||'';showModal(`${p?'تعديل':'إضافة'} سداد`,`<form id="paymentForm" class="form-grid">
 <div class="field"><label>المورد *</label><select class="select" name="supplier_id" id="paySupplier" required>${supplierOptions()}</select></div><div class="field"><label>الفرع *</label><select class="select" name="branch_id" id="payBranch" required><option value="">اختر الفرع</option>${branchOptions(false)}</select></div>
 <div class="field"><label>تاريخ السداد *</label><input class="input" type="date" name="payment_date" required value="${p?.payment_date||isoToday()}"></div><div class="field"><label>طريقة السداد *</label><select class="select" name="method" id="payMethod"><option value="cash">نقدي</option><option value="bank">مصرف</option></select></div>
 <div class="field full hidden" id="bankField"><label>اسم المصرف *</label><input class="input" name="bank_name" value="${esc(p?.bank_name||'')}"></div><div class="field full"><label>ملاحظات</label><textarea class="textarea" name="notes">${esc(p?.notes||'')}</textarea></div>
 <div class="full"><div style="display:flex;justify-content:space-between;align-items:center"><strong>توزيع السداد على الفواتير</strong><span class="hint">اختر الفواتير واكتب المبلغ لكل فاتورة</span></div><div id="allocationList" class="allocation-list"><div class="empty">اختر المورد والفرع</div></div><div class="sum-box"><span>إجمالي السداد</span><span id="paymentSum">0.00 د.ل</span></div></div></form>`,async()=>{const f=document.getElementById('paymentForm');if(!f.reportValidity())return false;const selected=[...document.querySelectorAll('.alloc-check:checked')];const allocations=selected.map(c=>({invoice_id:c.dataset.id,amount:Number(document.querySelector(`[data-amount="${c.dataset.id}"]`).value||0)})).filter(x=>x.amount>0);const amount=allocations.reduce((s,x)=>s+x.amount,0);if(!allocations.length){toast('اختر فاتورة واحدة على الأقل وحدد مبلغ السداد',true);return false;}const fd=new FormData(f);const payload={supplier_id:lockedSupplier||fd.get('supplier_id'),branch_id:fd.get('branch_id'),amount:Number(amount.toFixed(2)),payment_date:fd.get('payment_date'),method:fd.get('method'),bank_name:fd.get('method')==='bank'?fd.get('bank_name'):null,notes:fd.get('notes')||null,allocations};await api(p?`/api/payments/${p.id}`:'/api/payments',{method:p?'PUT':'POST',body:JSON.stringify(payload)});toast('تم حفظ السداد');if(opts.onSaved)await opts.onSaved();else if(state.view==='payments')await paymentsView(document.getElementById('main'));return true;},{large:true});
 const f=document.getElementById('paymentForm'),supplier=f.elements.supplier_id,branch=f.elements.branch_id,method=f.elements.method;supplier.value=p?.supplier_id||lockedSupplier||'';if(lockedSupplier)supplier.disabled=true;branch.value=p?.branch_id||'';method.value=p?.method||'cash';
 const toggleBank=()=>{const bank=document.getElementById('bankField');bank.classList.toggle('hidden',method.value!=='bank');f.elements.bank_name.required=method.value==='bank';};method.onchange=toggleBank;toggleBank();
 let old={};(p?.payment_allocations||[]).forEach(a=>old[a.invoice_id]=Number(a.amount));
 const load=async()=>{const sid=supplier.value,bid=branch.value,box=document.getElementById('allocationList');if(!sid||!bid){box.innerHTML='<div class="empty">اختر المورد والفرع</div>';return;}box.innerHTML='<div class="loading">جاري تحميل الفواتير...</div>';try{const rows=await api(`/api/invoices?supplier_id=${encodeURIComponent(sid)}&branch_id=${encodeURIComponent(bid)}`);const available=rows.filter(i=>Number(i.balance)>0||old[i.id]);box.innerHTML=available.length?available.map(i=>{const current=old[i.id]||0;const max=Number(i.balance)+current;return `<label class="allocation-row"><input class="alloc-check" type="checkbox" data-id="${i.id}" ${current?'checked':''}><div class="desc"><strong>فاتورة ${esc(i.invoice_number)}</strong>المتبقي المتاح: ${money(max)} — ${esc(i.invoice_date)}</div><input class="input alloc-amount" data-amount="${i.id}" type="number" min="0" max="${max}" step="0.01" value="${current||''}" ${current?'':'disabled'}></label>`;}).join(''):'<div class="empty">لا توجد فواتير عليها رصيد لهذا المورد والفرع</div>';wireAllocations();}catch(e){box.innerHTML=`<div class="empty">${esc(e.message)}</div>`;}};
 const wireAllocations=()=>{document.querySelectorAll('.alloc-check').forEach(c=>c.onchange=()=>{const inp=document.querySelector(`[data-amount="${c.dataset.id}"]`);inp.disabled=!c.checked;if(!c.checked)inp.value='';updateSum();});document.querySelectorAll('.alloc-amount').forEach(i=>i.oninput=updateSum);updateSum();};
 const updateSum=()=>{const s=[...document.querySelectorAll('.alloc-check:checked')].reduce((sum,c)=>sum+Number(document.querySelector(`[data-amount="${c.dataset.id}"]`).value||0),0);document.getElementById('paymentSum').textContent=money(s);};supplier.onchange=load;branch.onchange=load;if(p)load();}

async function settingsView(main){
  const tabsHtml=`${can('manage_branches')?'<button class="btn btn-soft" data-tab="branches">الفروع</button>':''}${can('manage_suppliers')?'<button class="btn btn-soft" data-tab="categories">تصنيفات الموردين</button>':''}${can('manage_users')?'<button class="btn btn-soft" data-tab="users">المستخدمين</button>':''}`;
  main.innerHTML=`<div class="page-head"><div><h2>الإعدادات</h2><div class="muted">الفروع وتصنيفات الموردين والمستخدمين والصلاحيات</div></div></div><div class="settings-tabs">${tabsHtml}</div><div id="settingsBody"></div>`;
  const tabs=[...main.querySelectorAll('[data-tab]')];if(tabs[0])tabs[0].classList.add('active');tabs.forEach(b=>b.onclick=()=>{tabs.forEach(x=>x.classList.remove('active'));b.classList.add('active');renderSettingsTab(b.dataset.tab);});renderSettingsTab(tabs[0]?.dataset.tab||'categories');
}
async function renderSettingsTab(tab){const box=document.getElementById('settingsBody');if(tab==='branches'){
  state.branches=await api('/api/admin/branches');box.innerHTML=`<div class="panel"><div class="page-head"><h3>الفروع</h3><button class="btn btn-primary btn-sm" id="newBranch">+ فرع</button></div><div class="mini-list">${state.branches.map(b=>`<div class="mini-row"><span><strong>${esc(b.name)}</strong> ${b.active?'<span class="badge badge-green">نشط</span>':'<span class="badge badge-red">موقوف</span>'}</span><span class="actions"><button class="btn btn-ghost btn-sm" data-edit="${b.id}">تعديل</button><button class="btn btn-danger btn-sm" data-delete="${b.id}">حذف</button></span></div>`).join('')||'<div class="empty">لا توجد فروع</div>'}</div></div>`;document.getElementById('newBranch').onclick=()=>branchModal();box.querySelectorAll('[data-edit]').forEach(x=>x.onclick=()=>branchModal(state.branches.find(b=>b.id===x.dataset.edit)));box.querySelectorAll('[data-delete]').forEach(x=>x.onclick=async()=>{if(!confirmAction('حذف الفرع؟ إذا كان مرتبطًا ببيانات سيمنع النظام الحذف.'))return;try{await api(`/api/admin/branches/${x.dataset.delete}`,{method:'DELETE'});toast('تم حذف الفرع');renderSettingsTab('branches');}catch(e){toast(e.message,true);}});
 }else if(tab==='categories'){
  state.categories=await api('/api/admin/supplier-categories');box.innerHTML=`<div class="panel"><div class="page-head"><div><h3>تصنيفات الموردين</h3><div class="muted">المورد الواحد يمكن أن ينتمي لأكثر من تصنيف</div></div><button class="btn btn-primary btn-sm" id="newCategory">+ تصنيف</button></div><div class="mini-list">${state.categories.map(c=>`<div class="mini-row"><span><strong>${esc(c.name)}</strong></span><span class="actions"><button class="btn btn-ghost btn-sm" data-category-edit="${c.id}">تعديل</button><button class="btn btn-danger btn-sm" data-category-delete="${c.id}">حذف</button></span></div>`).join('')||'<div class="empty">لا توجد تصنيفات</div>'}</div></div>`;document.getElementById('newCategory').onclick=()=>categoryModal();box.querySelectorAll('[data-category-edit]').forEach(x=>x.onclick=()=>categoryModal(state.categories.find(c=>c.id===x.dataset.categoryEdit)));box.querySelectorAll('[data-category-delete]').forEach(x=>x.onclick=async()=>{if(!confirmAction('حذف التصنيف؟ إذا كان مرتبطًا بموردين سيمنع النظام الحذف.'))return;try{await api(`/api/admin/supplier-categories/${x.dataset.categoryDelete}`,{method:'DELETE'});toast('تم حذف التصنيف');await renderSettingsTab('categories');}catch(e){toast(e.message,true);}});
 }else if(tab==='users'){
  state.users=await api('/api/admin/users');box.innerHTML=`<div class="panel"><div class="page-head"><h3>المستخدمين</h3><button class="btn btn-primary btn-sm" id="newUser">+ مستخدم</button></div><div class="mini-list">${state.users.map(u=>`<div class="mini-row"><span><strong>${esc(u.full_name)}</strong><div class="muted">${esc(u.username)} — ${esc(ROLE_LABELS[u.role]||u.role)} — ${u.all_branches?'كل الفروع':`${u.branch_ids?.length||0} فرع`}</div></span><span class="actions"><button class="btn btn-ghost btn-sm" data-edit="${u.id}">تعديل</button><button class="btn btn-danger btn-sm" data-delete="${u.id}">حذف</button></span></div>`).join('')}</div></div>`;document.getElementById('newUser').onclick=()=>userModal();box.querySelectorAll('[data-edit]').forEach(x=>x.onclick=()=>userModal(state.users.find(u=>u.id===x.dataset.edit)));box.querySelectorAll('[data-delete]').forEach(x=>x.onclick=async()=>{if(!confirmAction('حذف المستخدم؟'))return;try{await api(`/api/admin/users/${x.dataset.delete}`,{method:'DELETE'});toast('تم حذف المستخدم');renderSettingsTab('users');}catch(e){toast(e.message,true);}});
 }}
function branchModal(b=null){showModal(`${b?'تعديل':'إضافة'} فرع`,`<form id="branchForm"><div class="field"><label>اسم الفرع *</label><input class="input" name="name" required value="${esc(b?.name||'')}"></div>${b?`<div class="field"><label><input type="checkbox" name="active" ${b.active?'checked':''}> الفرع نشط</label><div class="hint">إيقاف الفرع يحافظ على بياناته القديمة لكنه يمنع استخدامه في الإدخالات الجديدة.</div></div>`:''}</form>`,async()=>{const f=document.getElementById('branchForm');if(!f.reportValidity())return false;const fd=new FormData(f);await api(b?`/api/admin/branches/${b.id}`:'/api/admin/branches',{method:b?'PUT':'POST',body:JSON.stringify(b?{name:fd.get('name'),active:!!f.elements.active.checked}:{name:fd.get('name')})});toast('تم حفظ الفرع');state.branches=await api('/api/admin/branches');if(state.view==='settings')renderSettingsTab('branches');return true;});}
function categoryModal(c=null){showModal(`${c?'تعديل':'إضافة'} تصنيف`,`<form id="categoryForm"><div class="field"><label>اسم التصنيف *</label><input class="input" name="name" required minlength="2" maxlength="100" value="${esc(c?.name||'')}" placeholder="مثال: دواء أو كوزمتك"></div></form>`,async()=>{const f=document.getElementById('categoryForm');if(!f.reportValidity())return false;const fd=new FormData(f);await api(c?`/api/admin/supplier-categories/${c.id}`:'/api/admin/supplier-categories',{method:c?'PUT':'POST',body:JSON.stringify({name:fd.get('name')})});state.categories=await api('/api/admin/supplier-categories');state.suppliers=await api('/api/suppliers');toast('تم حفظ التصنيف');if(state.view==='settings')await renderSettingsTab('categories');return true;});}
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

window.addEventListener('resize',syncStickyOffsets);
window.addEventListener('orientationchange',()=>setTimeout(syncStickyOffsets,100));
window.addEventListener('popstate',()=>{const q=new URLSearchParams(location.search);state.view=q.get('view')||'dashboard';state.supplierId=q.get('supplier_id')||'';if(state.profile)renderApp();});
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
      await registration.update();
    } catch (_) {}
  });
}
bootstrap();
