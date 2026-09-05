const root = document.getElementById('root');
const toastEl = document.getElementById('toast');

const state = {
  accessToken: localStorage.getItem('debts_access') || '',
  refreshToken: localStorage.getItem('debts_refresh') || '',
  profile: null,
  branches: [], suppliers: [], supplierRows: [], invoices: [], payments: [], paymentPlans: [], users: [], categories: [], items: [], notifications: [],
  notificationUnread: 0, notificationTimer: null, authRefreshTimer: null,
  supplierBranchId: '',
  supplierCategoryId: '',
  dashboardBranchId: '',
  dashboardCategoryId: '',
  dashboardPeriod: 'all',
  dashboardFromDate: '',
  dashboardToDate: '',
  itemsTab: 'catalog',
  itemCatalogTotal: 0,
  itemCatalogShowAll: false,
  itemCatalogSearch: '',
  itemCatalogSearchTimer: null,
  itemCatalogRequestSeq: 0,
  movementReports: [], movementRows: [], movementReport: null, movementReportId: '', movementBranchId: '', movementSearch: '', movementStatus: 'all', movementSort: 'desc',
  shortagesReports: [], shortagesAnalysis: null, shortagesFile: null, shortagesFileName: '', shortagesMovementReportId: '', shortagesBranchId: '', shortagesTargetDays: 14, shortagesSearch: '', shortagesStatus: 'shortage', shortagesSort: 'urgency', shortagesDraft: {},
  doctorSalesAnalysis: null, doctorSalesSearch: '', doctorSalesSort: 'net_desc', doctorSalesFileName: '', doctorSalesSelectedDoctor: '',
  doctorSalesFile: null, doctorSalesDateFrom: '', doctorSalesDateTo: '',
  doctorCompareSortKey: 'net_sales', doctorCompareSortDir: 'desc', doctorCompareA: '', doctorCompareB: '',
  periodComparePrevious: null, periodCompareCurrent: null, periodComparePreviousFileName: '', periodCompareCurrentFileName: '',
  periodComparePreviousFile: null, periodCompareCurrentFile: null, periodComparePreviousDateFrom: '', periodComparePreviousDateTo: '', periodCompareCurrentDateFrom: '', periodCompareCurrentDateTo: '',
  periodCompareSortKey: 'improvement_score', periodCompareSortDir: 'desc', periodCompareSelectedDoctor: '', periodCompareItemsExpanded: false,
  paymentPlanBranchId: '',
  paymentPlanStatus: 'open',
  paymentPlanSearch: '',
  view: new URLSearchParams(location.search).get('view') || 'dashboard',
  supplierId: new URLSearchParams(location.search).get('supplier_id') || '',
};

const PERMISSION_LABELS = {
  view_dashboard:'عرض الرئيسية', view_suppliers:'عرض الموردين', manage_suppliers:'إدارة الموردين',
  view_invoices:'عرض الفواتير', create_invoices:'إضافة فاتورة', edit_invoices:'تعديل الفاتورة', delete_invoices:'حذف الفاتورة',
  view_payments:'عرض السدادات', create_payments:'إضافة سداد', edit_payments:'تعديل السداد', delete_payments:'حذف السداد',
  manage_branches:'إدارة الفروع', manage_users:'إدارة المستخدمين', view_reports:'عرض التقارير',
  view_item_analysis:'عرض حركة الأصناف', manage_item_catalog:'إدارة دليل الأصناف',
  view_doctor_sales:'عرض مبيعات الدكاترة',
  view_payment_plans:'عرض خطة السداد', manage_payment_plans:'إدارة خطة السداد'
};
const ROLE_LABELS = {admin:'مدير', finance:'مالي', viewer:'مشاهدة فقط'};
const ROLE_DEFAULTS = {
  admin: Object.fromEntries(Object.keys(PERMISSION_LABELS).map(k=>[k,true])),
  finance: {view_dashboard:true,view_suppliers:true,manage_suppliers:true,view_invoices:true,create_invoices:true,edit_invoices:true,view_payments:true,create_payments:true,edit_payments:true,view_reports:true,view_item_analysis:true,manage_item_catalog:true,view_doctor_sales:true,view_payment_plans:true,manage_payment_plans:true},
  viewer: {view_dashboard:true,view_suppliers:true,view_invoices:true,view_payments:true,view_reports:true,view_item_analysis:true,view_doctor_sales:true,view_payment_plans:true}
};
const STATUS_LABELS = {unpaid:'غير مسددة', partial:'جزئي', paid:'مسددة'};

function esc(v=''){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function money(v){return `${Number(v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} د.ل`;}
function isoToday(){const d=new Date(),local=new Date(d.getTime()-d.getTimezoneOffset()*60000);return local.toISOString().slice(0,10);}
function can(p){return !!state.profile?.effective_permissions?.[p];}
function toast(msg, error=false){toastEl.textContent=msg;toastEl.className=`toast show${error?' error':''}`;clearTimeout(toastEl._t);toastEl._t=setTimeout(()=>toastEl.className='toast',2800);}
function confirmAction(msg){return window.confirm(msg);}
let authRefreshPromise = null;
let sessionExpiredShown = false;

function decodeJwtPayload(token){
  try{
    const part=String(token||'').split('.')[1];
    if(!part)return null;
    const normalized=part.replace(/-/g,'+').replace(/_/g,'/');
    const padded=normalized+'='.repeat((4-normalized.length%4)%4);
    const json=decodeURIComponent(Array.from(atob(padded)).map(c=>`%${c.charCodeAt(0).toString(16).padStart(2,'0')}`).join(''));
    return JSON.parse(json);
  }catch{return null;}
}
function accessTokenExpiresInMs(){
  const exp=Number(decodeJwtPayload(state.accessToken)?.exp||0);
  return exp ? exp*1000-Date.now() : null;
}
function accessTokenNeedsRefresh(bufferMs=60000){
  const left=accessTokenExpiresInMs();
  return left!==null && left<=bufferMs;
}
function stopAuthRefreshTimer(){if(state.authRefreshTimer)clearTimeout(state.authRefreshTimer);state.authRefreshTimer=null;}
function scheduleAuthRefresh(){
  stopAuthRefreshTimer();
  if(!state.accessToken||!state.refreshToken)return;
  const left=accessTokenExpiresInMs();
  if(left===null)return;
  const delay=Math.max(5000,left-60000);
  state.authRefreshTimer=setTimeout(()=>refreshSession(true),delay);
}
function setTokens(data){
  state.accessToken=data.access_token||''; state.refreshToken=data.refresh_token||state.refreshToken||'';
  if(state.accessToken)localStorage.setItem('debts_access',state.accessToken);else localStorage.removeItem('debts_access');
  if(state.refreshToken)localStorage.setItem('debts_refresh',state.refreshToken);else localStorage.removeItem('debts_refresh');
  sessionExpiredShown=false;
  scheduleAuthRefresh();
}
function clearSession(){
  if(state.notificationTimer)clearInterval(state.notificationTimer);state.notificationTimer=null;
  stopAuthRefreshTimer();
  localStorage.removeItem('debts_access');localStorage.removeItem('debts_refresh');
  state.accessToken='';state.refreshToken='';state.profile=null;
}
function logout(){clearSession();sessionExpiredShown=false;renderLogin();}
function expireSession(){
  clearSession();
  renderLogin();
  if(!sessionExpiredShown){sessionExpiredShown=true;toast('انتهت الجلسة. سجل الدخول من جديد.',true);}
}
function isSessionTokenError(status,msg=''){
  const text=String(msg||'').toLowerCase();
  if(status===401)return true;
  if(status!==403)return false;
  return /invalid jwt|jwt.*expired|token.*expired|token is expired|invalid claims|unable to parse or verify signature|session.*expired/.test(text);
}
async function refreshSession(showLoginOnFailure=true){
  if(!state.refreshToken){if(showLoginOnFailure)expireSession();return false;}
  if(authRefreshPromise)return authRefreshPromise;
  authRefreshPromise=(async()=>{
    try{
      const rr=await fetch('/api/auth/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:state.refreshToken}),cache:'no-store'});
      if(!rr.ok){
        if([400,401,403].includes(rr.status))expireSession();
        return false;
      }
      const data=await rr.json();
      if(!data?.access_token){expireSession();return false;}
      setTokens(data);
      return true;
    }catch{
      // A temporary network problem is not the same as an expired session.
      scheduleAuthRefresh();
      return false;
    }finally{authRefreshPromise=null;}
  })();
  return authRefreshPromise;
}
async function responseError(res){
  let msg=`خطأ ${res.status}`;
  try{const j=await res.clone().json();msg=j.detail||j.message||j.error_description||j.msg||msg;}catch{try{msg=await res.clone().text()||msg;}catch{}}
  return typeof msg==='string'?msg:JSON.stringify(msg);
}

async function api(path, options={}, retry=true){
  const authRequest=!path.startsWith('/api/auth/');
  if(authRequest && retry && state.refreshToken && (!state.accessToken || accessTokenNeedsRefresh())){
    await refreshSession(false);
  }
  const headers={...(options.headers||{})};
  if(state.accessToken)headers.Authorization=`Bearer ${state.accessToken}`;
  if(options.body && !(options.body instanceof FormData))headers['Content-Type']='application/json';
  const res=await fetch(path,{...options,headers});
  if(!res.ok){
    const msg=await responseError(res);
    if(authRequest && retry && state.refreshToken && isSessionTokenError(res.status,msg)){
      const refreshed=await refreshSession(true);
      if(refreshed)return api(path,options,false);
      throw new Error('انتهت الجلسة. سجل الدخول من جديد.');
    }
    if(authRequest && isSessionTokenError(res.status,msg)){
      expireSession();
      throw new Error('انتهت الجلسة. سجل الدخول من جديد.');
    }
    throw new Error(msg);
  }
  const ct=res.headers.get('content-type')||'';return ct.includes('json')?res.json():res;
}

function fmtDateTime(v){try{return new Intl.DateTimeFormat('ar-LY',{dateStyle:'short',timeStyle:'short'}).format(new Date(v));}catch{return String(v||'');}}
function notificationAccess(){return can('view_invoices')||can('view_payments');}
function updateNotificationBell(){const badge=document.getElementById('notificationBadge');if(!badge)return;const n=Number(state.notificationUnread||0);badge.textContent=n>99?'99+':String(n);badge.classList.toggle('hidden',n<=0);}
async function loadNotifications(silent=true){
  if(!state.profile||!notificationAccess()){state.notifications=[];state.notificationUnread=0;updateNotificationBell();return;}
  try{const data=await api('/api/notifications');state.notifications=data.items||[];state.notificationUnread=Number(data.unread_count||0);updateNotificationBell();}
  catch(e){if(!silent)toast(e.message,true);}
}
function startNotificationPolling(){if(state.notificationTimer)clearInterval(state.notificationTimer);state.notificationTimer=null;if(!notificationAccess())return;state.notificationTimer=setInterval(()=>loadNotifications(true),30000);}
function notificationBody(n){
  if(n.event_type==='invoice_created')return `تمت إضافة فاتورة ${n.invoice_number?`رقم ${esc(n.invoice_number)} `:''}بقيمة <strong>${money(n.amount)}</strong> للمورد <strong>${esc(n.supplier_name)}</strong> — ${esc(n.branch_name)}`;
  return `تم تسجيل سداد بقيمة <strong>${money(n.amount)}</strong> للمورد <strong>${esc(n.supplier_name)}</strong> — ${esc(n.branch_name)}`;
}
async function openNotifications(){
  await loadNotifications(false);
  const list=state.notifications.length?state.notifications.map(n=>`<button class="notification-item ${n.is_read?'':'unread'}" data-notification-id="${n.id}" data-target-view="${n.event_type==='invoice_created'?'invoices':'payments'}"><span class="notification-icon">${n.event_type==='invoice_created'?'🧾':'💳'}</span><span class="notification-content"><strong>${n.event_type==='invoice_created'?'فاتورة جديدة':'سداد جديد'}</strong><span>${notificationBody(n)}</span><small>بواسطة ${esc(n.actor_name)} • ${esc(fmtDateTime(n.created_at))}</small></span></button>`).join(''):'<div class="empty">لا توجد إشعارات حتى الآن</div>';
  const wrap=showModal('الإشعارات',`<div class="notification-list">${list}</div>`,null,{saveText:null});
  wrap.querySelectorAll('[data-notification-id]').forEach(btn=>btn.onclick=async()=>{try{if(btn.classList.contains('unread'))await api(`/api/notifications/${btn.dataset.notificationId}/read`,{method:'POST'});}catch{}wrap.remove();go(btn.dataset.targetView);});
  if(state.notificationUnread>0){try{await api('/api/notifications/read-all',{method:'POST'});state.notificationUnread=0;state.notifications=state.notifications.map(x=>({...x,is_read:true}));updateNotificationBell();}catch{}}
}

async function bootstrap(){
  if(!state.accessToken && state.refreshToken)await refreshSession(false);
  if(!state.accessToken)return renderLogin();
  try{
    state.profile=await api('/api/me');
    await loadBase(); await loadNotifications(true); renderApp(); startNotificationPolling(); scheduleAuthRefresh();
  }catch(e){if(state.accessToken)logout();}
}
async function loadBase(){
  const jobs=[api('/api/admin/branches').then(x=>state.branches=x||[])];
  if(can('view_suppliers')||can('view_payment_plans')) jobs.push(api('/api/suppliers').then(x=>state.suppliers=x||[]));
  if(can('view_dashboard') || can('view_suppliers')) jobs.push(api('/api/admin/supplier-categories').then(x=>state.categories=x||[]));
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
    try{const data=await api('/api/auth/login',{method:'POST',body:JSON.stringify({username:fd.get('username'),password:fd.get('password')})},false);setTokens(data);state.profile=data.profile;await loadBase();await loadNotifications(true);renderApp();startNotificationPolling();}
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
  const allowedViews={dashboard:'view_dashboard',items:'view_item_analysis',shortages:'view_item_analysis',doctorsales:'view_doctor_sales',doctorcompare:'view_doctor_sales',doctorperiodcompare:'view_doctor_sales',suppliers:'view_suppliers',supplier:'view_suppliers',invoices:'view_invoices',payments:'view_payments',paymentplan:'view_payment_plans',settings:null};
  if(allowedViews[state.view] && !can(allowedViews[state.view])) state.view=can('view_dashboard')?'dashboard':can('view_invoices')?'invoices':'settings';
  const settingsVisible=can('manage_branches')||can('manage_suppliers')||can('manage_users');
  root.innerHTML=`<div class="app">
    <header class="topbar"><div class="topbar-inner"><div class="top-title"><div>💰</div><div><strong>Abdo Debts</strong><small>نظام المديونيات</small></div></div><div class="user-box">${notificationAccess()?`<button class="notification-bell" id="notificationBell" aria-label="الإشعارات" title="الإشعارات">🔔<span id="notificationBadge" class="notification-badge ${state.notificationUnread>0?'':'hidden'}">${state.notificationUnread>99?'99+':state.notificationUnread}</span></button>`:''}<span class="user-name">${esc(state.profile.full_name)}</span><button class="btn btn-ghost btn-sm" id="logoutBtn">خروج</button></div></div></header>
    <main class="main" id="main"></main>
    <nav class="nav"><div class="nav-inner">${navButton('dashboard','▦','الرئيسية','view_dashboard')}${navButton('items','▤','حركة الأصناف','view_item_analysis')}${navButton('shortages','📦','النواقص المقترحة','view_item_analysis')}${navButton('doctorsales','📊','مبيعات الدكاترة','view_doctor_sales')}${navButton('doctorcompare','⚖️','مقارنة الدكاترة','view_doctor_sales')}${navButton('doctorperiodcompare','🔄','مقارنة الفترات','view_doctor_sales')}${navButton('suppliers','🏢','الموردين','view_suppliers')}${navButton('invoices','🧾','الفواتير','view_invoices')}${navButton('payments','💳','السدادات','view_payments')}${navButton('paymentplan','📅','خطة السداد','view_payment_plans')}${settingsVisible?navButton('settings','⚙️','الإعدادات',null):''}</div></nav>
  </div>`;
  document.getElementById('logoutBtn').onclick=logout;const bell=document.getElementById('notificationBell');if(bell)bell.onclick=openNotifications;updateNotificationBell();
  root.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>go(b.dataset.view));
  syncStickyOffsets();
  requestAnimationFrame(syncStickyOffsets);
  renderView();
}
function go(view){state.view=view;if(view!=='supplier')state.supplierId='';const u=new URL(location.href);u.searchParams.set('view',view);if(view!=='supplier')u.searchParams.delete('supplier_id');history.replaceState({},'',u);renderApp();}
function openSupplierPage(id){state.view='supplier';state.supplierId=id;const u=new URL(location.href);u.searchParams.set('view','supplier');u.searchParams.set('supplier_id',id);history.pushState({},'',u);renderApp();}
async function renderView(){const main=document.getElementById('main');main.innerHTML='<div class="loading">جاري التحميل...</div>';try{
  if(state.view==='dashboard')await dashboardView(main);
  else if(state.view==='items')await itemsView(main);
  else if(state.view==='shortages')await shortagesView(main);
  else if(state.view==='doctorsales')await doctorSalesView(main);
  else if(state.view==='doctorcompare')await doctorComparisonView(main);
  else if(state.view==='doctorperiodcompare')await doctorPeriodComparisonView(main);
  else if(state.view==='suppliers')await suppliersView(main);
  else if(state.view==='supplier')await supplierDetailView(main);
  else if(state.view==='invoices')await invoicesView(main);
  else if(state.view==='payments')await paymentsView(main);
  else if(state.view==='paymentplan')await paymentPlansView(main);
  else if(state.view==='settings')await settingsView(main);
}catch(e){main.innerHTML=`<div class="panel"><div class="empty">${esc(e.message)}</div></div>`;toast(e.message,true);}}

function branchOptions(includeAll=false, onlyActive=true){const rows=state.branches.filter(b=>!onlyActive||b.active);return `${includeAll?'<option value="">كل الفروع</option>':''}${rows.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('')}`;}
function supplierOptions(includeBlank=true){return `${includeBlank?'<option value="">اختر المورد</option>':''}${state.suppliers.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}`;}
function statusBadge(s){return `<span class="badge ${s==='paid'?'badge-green':s==='partial'?'badge-amber':'badge-red'}">${STATUS_LABELS[s]||s}</span>`;}
function paymentMethod(p){return p.method==='bank'?`🏦 ${esc(p.bank_name||'مصرف')}`:'💵 نقدي';}
function categoryTags(categories=[]){return categories.length?`<div class="category-tags">${categories.map(c=>`<span class="category-tag">${esc(c.name)}</span>`).join('')}</div>`:'<span class="muted">بدون تصنيف</span>';}


function doctorSalesSortRows(rows){
  const list=[...rows],key=state.doctorSalesSort||'net_desc';
  const getters={kpi_desc:x=>Number(x.kpi_score||0),net_desc:x=>Number(x.net_sales||0),sales_desc:x=>Number(x.sales_total||0),invoices_desc:x=>Number(x.invoice_count||0),average_desc:x=>Number(x.average_invoice||0),daily_desc:x=>Number(x.daily_average||0),days_desc:x=>Number(x.active_days||0),items_desc:x=>Number(x.unique_items||0)};
  const getter=getters[key]||getters.net_desc;
  return list.sort((a,b)=>getter(b)-getter(a)||Number(b.sales_total||0)-Number(a.sales_total||0)||String(a.doctor||'').localeCompare(String(b.doctor||''),'ar'));
}
function doctorKpiClass(score){
  if(score===null||score===undefined||score==='')return 'kpi-na';
  const n=Number(score);if(!Number.isFinite(n))return 'kpi-na';
  if(n>=90)return 'kpi-excellent';if(n>=80)return 'kpi-strong';if(n>=70)return 'kpi-good';if(n>=60)return 'kpi-average';return 'kpi-watch';
}
function doctorKpiValue(score){
  if(score===null||score===undefined||score==='')return '—';
  const n=Number(score);return Number.isFinite(n)?`${n.toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1})}/100`:'—';
}
function doctorKpiLabel(doctor){return doctor?.kpi_label||'بيانات غير كافية';}
function renderDoctorKpiSummary(doctor){
  const overall=doctorKpiValue(doctor?.kpi_score),productivity=doctorKpiValue(doctor?.productivity_kpi),basket=doctorKpiValue(doctor?.basket_quality_kpi),consistency=doctorKpiValue(doctor?.consistency_kpi);
  return `<section class="panel doctor-kpi-panel"><div class="doctor-kpi-main ${doctorKpiClass(doctor?.kpi_score)}"><div><span>KPI العام</span><strong>${overall}</strong><em>${esc(doctorKpiLabel(doctor))}</em></div><small>تقييم نسبي مقارنة بباقي الدكاترة داخل نفس التقرير.</small></div><div class="doctor-kpi-subgrid"><div class="doctor-kpi-sub"><span>Productivity KPI</span><strong>${productivity}</strong><small>المبيعات/يوم + فواتير/يوم</small></div><div class="doctor-kpi-sub"><span>Basket Quality KPI</span><strong>${basket}</strong><small>متوسط وMedian والأصناف والفواتير الكبيرة</small></div><div class="doctor-kpi-sub"><span>Consistency KPI</span><strong>${consistency}</strong><small>ثبات الأداء اليومي</small></div><div class="doctor-kpi-sub"><span>تنوع المبيعات</span><strong>${Number(doctor?.diversity_rate||0).toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1})}</strong><small>صنف مختلف لكل 100 فاتورة</small></div></div><div class="doctor-kpi-note">الأوزان: المبيعات/يوم 25% · فواتير/يوم 15% · متوسط الفاتورة 15% · Median 10% · أصناف/فاتورة 10% · نسبة فواتير &gt;100 = 10% · الثبات 10% · التنوع 5%.</div></section>`;
}

function doctorSalesFilteredRows(){
  const data=state.doctorSalesAnalysis;if(!data)return [];
  const q=String(state.doctorSalesSearch||'').trim().toLowerCase();
  let rows=data.doctors||[];
  if(q)rows=rows.filter(x=>String(x.doctor||'').toLowerCase().includes(q));
  return doctorSalesSortRows(rows);
}
function doctorSalesSelected(){
  const rows=state.doctorSalesAnalysis?.doctors||[];
  return rows.find(x=>String(x.doctor_key||'')===String(state.doctorSalesSelectedDoctor||''))||null;
}
async function analyzeDoctorSalesFile(file,dateFrom='',dateTo=''){
  if(!file)throw new Error('ارفع تقرير المبيعات أولًا.');
  const body=new FormData();body.append('file',file);
  if(dateFrom)body.append('date_from',dateFrom);
  if(dateTo)body.append('date_to',dateTo);
  return api('/api/doctor-sales/analyze',{method:'POST',body});
}
function doctorSalesFullPeriodText(data){
  if(!data)return '—';
  return `${data.report_period_start||data.period_start||'—'} ← ${data.report_period_end||data.period_end||'—'}`;
}
async function doctorSalesView(main){
  const selected=doctorSalesSelected();
  if(selected){renderDoctorSalesDetail(main,selected);return;}
  main.innerHTML=`<div class="page-head doctor-sales-head"><div><h2>مبيعات الدكاترة</h2><div class="muted">تحليل أداء الدكاترة من المبيعات النقدية فقط — مبيعات الآجل مستبعدة بالكامل.</div></div><div class="page-head-actions">${state.doctorSalesAnalysis?'<button class="btn btn-soft" id="doctorCompareOpen">⚖️ مقارنة الدكاترة</button><button class="btn btn-soft" id="doctorPeriodCompareOpen">🔄 مقارنة الفترات</button>':''}<button class="btn btn-primary" id="doctorSalesUpload">رفع تقرير مبيعات</button><input id="doctorSalesFile" type="file" accept=".csv,text/csv" hidden></div></div>
  <section class="panel doctor-sales-upload-note"><strong>طريقة الحساب</strong><span>نحسب المبيعات النقدية فقط، ونطرح المرتجعات النقدية من الصافي. أيام النشاط = الأيام التي تحتوي على فاتورة بيع نقدية، والمتوسط اليومي = صافي المبيعات ÷ أيام النشاط.</span></section>
  <div id="doctorSalesResults">${state.doctorSalesAnalysis?'<div class="loading">جاري عرض التحليل...</div>':'<section class="panel"><div class="empty">ارفع تقرير المبيعات لعرض أداء الدكاترة.</div></section>'}</div>`;
  const fileInput=document.getElementById('doctorSalesFile'),uploadBtn=document.getElementById('doctorSalesUpload'),compareBtn=document.getElementById('doctorCompareOpen'),periodCompareBtn=document.getElementById('doctorPeriodCompareOpen');
  if(compareBtn)compareBtn.onclick=()=>go('doctorcompare');
  if(periodCompareBtn)periodCompareBtn.onclick=()=>go('doctorperiodcompare');
  uploadBtn.onclick=()=>fileInput.click();
  fileInput.onchange=async()=>{
    const file=fileInput.files?.[0];if(!file)return;
    uploadBtn.disabled=true;uploadBtn.textContent='جاري تحليل التقرير...';
    try{
      const data=await analyzeDoctorSalesFile(file);
      state.doctorSalesAnalysis=data;state.doctorSalesFile=file;state.doctorSalesFileName=file.name;state.doctorSalesSearch='';state.doctorSalesSort='net_desc';state.doctorSalesSelectedDoctor='';
      state.doctorSalesDateFrom=data.available_start_iso||'';state.doctorSalesDateTo=data.available_end_iso||'';
      toast('تم تحليل المبيعات النقدية للدكاترة');renderDoctorSalesResults();
    }catch(e){toast(e.message,true);}finally{uploadBtn.disabled=false;uploadBtn.textContent='رفع تقرير مبيعات';fileInput.value='';}
  };
  if(state.doctorSalesAnalysis)renderDoctorSalesResults();
}
function renderDoctorSalesResults(){
  const box=document.getElementById('doctorSalesResults'),data=state.doctorSalesAnalysis;if(!box||!data)return;
  const t=data.totals||{};
  box.innerHTML=`<section class="panel doctor-sales-report-info"><div><strong>${esc(data.source||'تقرير المبيعات')}</strong><span>${esc(data.period_start||'—')} ← ${esc(data.period_end||'—')}</span>${data.is_filtered?`<span class="badge badge-amber">فترة مخصصة</span>`:''}${state.doctorSalesFileName?`<small>${esc(state.doctorSalesFileName)}</small>`:''}</div><div class="doctor-sales-report-badges"><span class="badge badge-green">${Number(data.doctor_count||0).toLocaleString('en-US')} دكتور/مستخدم</span><span class="badge">نقدي فقط</span><button class="btn btn-soft btn-sm" id="doctorSalesPdfExport">🧾 تصدير التحليل PDF</button></div></section>
  <section class="panel doctor-sales-period-filter"><div class="doctor-period-filter-head"><div><strong>تحديد فترة داخل التقرير</strong><span>الفترة الكاملة المتاحة: ${esc(doctorSalesFullPeriodText(data))}</span></div>${data.is_filtered?'<span class="badge badge-amber">الفلتر مطبق</span>':'<span class="badge badge-green">التقرير كامل</span>'}</div><div class="doctor-period-filter-controls"><label><span>من تاريخ</span><input class="input" type="date" id="doctorSalesDateFrom" min="${esc(data.available_start_iso||'')}" max="${esc(data.available_end_iso||'')}" value="${esc(state.doctorSalesDateFrom||data.available_start_iso||'')}"></label><label><span>إلى تاريخ</span><input class="input" type="date" id="doctorSalesDateTo" min="${esc(data.available_start_iso||'')}" max="${esc(data.available_end_iso||'')}" value="${esc(state.doctorSalesDateTo||data.available_end_iso||'')}"></label><button class="btn btn-primary" id="doctorSalesApplyPeriod">تطبيق الفترة</button><button class="btn btn-soft" id="doctorSalesResetPeriod" ${data.is_filtered?'':'disabled'}>عرض التقرير كامل</button></div></section>
  <div class="doctor-sales-summary">
    <div class="stat"><div class="label">صافي المبيعات النقدية</div><div class="value">${money(t.net_sales)}</div></div>
    <div class="stat"><div class="label">إجمالي المبيعات النقدية</div><div class="value">${money(t.sales_total)}</div></div>
    <div class="stat"><div class="label">المرتجعات النقدية</div><div class="value">${money(t.returns_total)}</div></div>
    <div class="stat"><div class="label">عدد الفواتير النقدية</div><div class="value">${Number(t.invoice_count||0).toLocaleString('en-US')}</div></div>
    <div class="stat"><div class="label">متوسط الفاتورة</div><div class="value">${money(t.average_invoice)}</div></div>
    <div class="stat"><div class="label">أيام النشاط</div><div class="value">${Number(t.active_days||0).toLocaleString('en-US')}</div></div>
    <div class="stat"><div class="label">متوسط KPI الفريق</div><div class="value">${doctorKpiValue(t.kpi_average)}</div></div>
  </div>
  <section class="doctor-sales-filter-panel"><div class="toolbar doctor-sales-toolbar"><input class="input" id="doctorSalesSearch" value="${esc(state.doctorSalesSearch)}" placeholder="بحث باسم الدكتور..."><select class="select" id="doctorSalesSort"><option value="kpi_desc">الأعلى KPI</option><option value="net_desc">الأعلى صافي مبيعات</option><option value="sales_desc">الأعلى مبيعات</option><option value="invoices_desc">الأكثر فواتير</option><option value="average_desc">الأعلى متوسط فاتورة</option><option value="daily_desc">الأعلى متوسط يومي</option><option value="days_desc">الأكثر أيام نشاط</option><option value="items_desc">الأكثر أصنافًا مختلفة</option></select></div></section>
  <div id="doctorSalesTable"></div>`;
  const search=document.getElementById('doctorSalesSearch'),sort=document.getElementById('doctorSalesSort'),pdfBtn=document.getElementById('doctorSalesPdfExport');sort.value=state.doctorSalesSort||'net_desc';
  search.oninput=()=>{state.doctorSalesSearch=search.value;renderDoctorSalesTable();};
  sort.onchange=()=>{state.doctorSalesSort=sort.value;renderDoctorSalesTable();};
  if(pdfBtn)pdfBtn.onclick=()=>exportDoctorSalesAnalysisPdf();
  const dateFrom=document.getElementById('doctorSalesDateFrom'),dateTo=document.getElementById('doctorSalesDateTo'),applyPeriod=document.getElementById('doctorSalesApplyPeriod'),resetPeriod=document.getElementById('doctorSalesResetPeriod');
  if(applyPeriod)applyPeriod.onclick=async()=>{
    const from=dateFrom?.value||'',to=dateTo?.value||'';
    if(!from||!to){toast('حدد تاريخ البداية والنهاية.',true);return;}
    if(from>to){toast('تاريخ البداية يجب أن يكون قبل تاريخ النهاية.',true);return;}
    if(!state.doctorSalesFile){toast('أعد رفع تقرير المبيعات حتى نقدر نطبق الفترة.',true);return;}
    applyPeriod.disabled=true;applyPeriod.textContent='جاري تطبيق الفترة...';
    try{
      const filtered=await analyzeDoctorSalesFile(state.doctorSalesFile,from,to);
      state.doctorSalesAnalysis=filtered;state.doctorSalesDateFrom=from;state.doctorSalesDateTo=to;state.doctorSalesSelectedDoctor='';
      toast(`تم تحليل الفترة ${filtered.period_start||''} إلى ${filtered.period_end||''}`);renderDoctorSalesResults();
    }catch(e){toast(e.message,true);applyPeriod.disabled=false;applyPeriod.textContent='تطبيق الفترة';}
  };
  if(resetPeriod)resetPeriod.onclick=async()=>{
    if(!state.doctorSalesFile){toast('أعد رفع تقرير المبيعات حتى نقدر نعرض التقرير كامل.',true);return;}
    resetPeriod.disabled=true;resetPeriod.textContent='جاري التحميل...';
    try{
      const full=await analyzeDoctorSalesFile(state.doctorSalesFile);
      state.doctorSalesAnalysis=full;state.doctorSalesDateFrom=full.available_start_iso||'';state.doctorSalesDateTo=full.available_end_iso||'';state.doctorSalesSelectedDoctor='';
      toast('تم الرجوع إلى الفترة الكاملة للتقرير');renderDoctorSalesResults();
    }catch(e){toast(e.message,true);resetPeriod.disabled=false;resetPeriod.textContent='عرض التقرير كامل';}
  };
  renderDoctorSalesTable();
}
function bindDoctorSalesDetailButtons(){
  document.querySelectorAll('[data-doctor-sales-detail]').forEach(btn=>btn.onclick=()=>{
    state.doctorSalesSelectedDoctor=btn.dataset.doctorSalesDetail||'';
    doctorSalesView(document.getElementById('main'));
  });
}
function renderDoctorSalesTable(){
  const box=document.getElementById('doctorSalesTable');if(!box)return;const rows=doctorSalesFilteredRows();
  if(!rows.length){box.innerHTML='<section class="panel"><div class="empty">لا توجد نتائج مطابقة.</div></section>';return;}
  const desktop=`<div class="table-wrap desktop-table"><table class="doctor-sales-table"><thead><tr><th>#</th><th>الدكتور</th><th>KPI</th><th>صافي المبيعات</th><th>الفواتير</th><th>أيام النشاط</th><th>متوسط الفاتورة</th><th>المتوسط اليومي</th><th>الأصناف المختلفة</th><th>أصناف/فاتورة</th><th></th></tr></thead><tbody>${rows.map((x,i)=>`<tr><td>${i+1}</td><td><strong>${esc(x.doctor)}</strong></td><td><span class="doctor-kpi-badge ${doctorKpiClass(x.kpi_score)}">${doctorKpiValue(x.kpi_score)}<small>${esc(doctorKpiLabel(x))}</small></span></td><td class="money doctor-sales-net">${money(x.net_sales)}</td><td>${Number(x.invoice_count||0).toLocaleString('en-US')}</td><td>${Number(x.active_days||0).toLocaleString('en-US')}</td><td class="money">${money(x.average_invoice)}</td><td class="money">${money(x.daily_average)}</td><td>${Number(x.unique_items||0).toLocaleString('en-US')}</td><td>${Number(x.average_items_per_invoice||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td><td><button class="btn btn-soft btn-sm" data-doctor-sales-detail="${esc(x.doctor_key)}">التفاصيل</button></td></tr>`).join('')}</tbody></table></div>`;
  const mobile=`<div class="mobile-list">${rows.map((x,i)=>`<div class="item-card doctor-sales-card"><div class="item-title"><span>${i+1}. ${esc(x.doctor)}</span><span class="doctor-kpi-badge ${doctorKpiClass(x.kpi_score)}">${doctorKpiValue(x.kpi_score)}</span></div><div class="item-meta"><div><span>KPI العام</span><strong>${doctorCompareFormat(doctorCompareNumber(x,'kpi_score'),'score')}</strong></div><div><span>صافي المبيعات</span><strong>${money(x.net_sales)}</strong></div><div><span>الفواتير</span><strong>${Number(x.invoice_count||0).toLocaleString('en-US')}</strong></div><div><span>أيام النشاط</span><strong>${Number(x.active_days||0).toLocaleString('en-US')}</strong></div><div><span>متوسط الفاتورة</span><strong>${money(x.average_invoice)}</strong></div><div><span>المتوسط اليومي</span><strong>${money(x.daily_average)}</strong></div><div><span>التقييم</span><strong>${esc(doctorKpiLabel(x))}</strong></div></div><button class="btn btn-soft doctor-sales-detail-btn" data-doctor-sales-detail="${esc(x.doctor_key)}">عرض تفاصيل الدكتور</button></div>`).join('')}</div>`;
  box.innerHTML=desktop+mobile;bindDoctorSalesDetailButtons();
}
function renderDoctorSalesDetail(main,doctor){
  const topItems=(doctor.top_items||[]).slice(0,50),invoices=(doctor.invoices||[]).filter(x=>Number(x.net_total||0)>100).sort((a,b)=>Number(b.net_total||0)-Number(a.net_total||0));
  main.innerHTML=`<div class="page-head doctor-sales-detail-head"><div><button class="btn btn-soft btn-sm" id="doctorSalesBack">← رجوع لمبيعات الدكاترة</button><h2>${esc(doctor.doctor)}</h2><div class="muted">تفاصيل المبيعات النقدية خلال ${esc(state.doctorSalesAnalysis?.period_start||'—')} ← ${esc(state.doctorSalesAnalysis?.period_end||'—')}</div></div><div class="page-head-actions"><button class="btn btn-primary btn-sm" id="doctorDetailPdfExport">🧾 تصدير PDF</button></div></div>
  ${renderDoctorKpiSummary(doctor)}
  <div class="doctor-sales-summary doctor-detail-summary">
    <div class="stat"><div class="label">صافي المبيعات</div><div class="value">${money(doctor.net_sales)}</div></div>
    <div class="stat"><div class="label">عدد الفواتير</div><div class="value">${Number(doctor.invoice_count||0).toLocaleString('en-US')}</div></div>
    <div class="stat"><div class="label">أيام النشاط</div><div class="value">${Number(doctor.active_days||0).toLocaleString('en-US')}</div></div>
    <div class="stat"><div class="label">متوسط الفاتورة</div><div class="value">${money(doctor.average_invoice)}</div></div>
    <div class="stat"><div class="label">Median الفاتورة</div><div class="value">${money(doctor.median_invoice)}</div></div>
    <div class="stat"><div class="label">المتوسط اليومي</div><div class="value">${money(doctor.daily_average)}</div></div>
    <div class="stat"><div class="label">فواتير / يوم نشاط</div><div class="value">${Number(doctor.invoices_per_active_day||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div></div>
    <div class="stat"><div class="label">نسبة الفواتير فوق 100</div><div class="value">${Number(doctor.high_value_invoice_percentage||0).toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1})}%</div><small>${Number(doctor.high_value_invoice_count||0).toLocaleString('en-US')} فاتورة</small></div>
    <div class="stat"><div class="label">ثبات الأداء</div><div class="value">${doctor.stability_score==null?'—':`${Number(doctor.stability_score).toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1})}%`}</div><small>${esc(doctor.stability_label||'—')}</small></div>
    <div class="stat"><div class="label">متوسط الأصناف/فاتورة</div><div class="value">${Number(doctor.average_items_per_invoice||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div></div>
    <div class="stat"><div class="label">الأصناف المختلفة المباعة</div><div class="value">${Number(doctor.unique_items||0).toLocaleString('en-US')}</div></div>
    <div class="stat"><div class="label">المرتجعات النقدية</div><div class="value">${money(doctor.returns_total)}</div></div>
  </div>
  <div class="muted doctor-stability-note">ثبات الأداء يقيس انتظام قيمة المبيعات النقدية بين أيام النشاط؛ كلما ارتفعت النسبة كان الأداء اليومي أكثر استقرارًا.</div>
  <section class="panel doctor-top-items-panel"><div class="section-head"><div><h3>أكثر 50 صنف بيعًا</h3><div class="muted">يظهر أول 10 أصناف فقط، ويمكن عرض القائمة كاملة عند الحاجة.</div></div>${topItems.length>10?`<button class="btn btn-soft btn-sm" id="doctorTopItemsToggle">إظهار الكل (${Number(topItems.length).toLocaleString('en-US')})</button>`:''}</div><div id="doctorTopItemsBody">${renderDoctorTopItems(topItems.slice(0,10))}</div></section>
  <section class="panel doctor-invoices-panel"><div class="section-head"><div><h3>الفواتير فوق 100 د.ل</h3><div class="muted">${Number(invoices.length).toLocaleString('en-US')} فاتورة بيع نقدية قيمتها أكبر من 100 د.ل — مرتبة من الأعلى إلى الأقل</div></div></div>${renderDoctorInvoices(invoices)}</section>`;
  document.getElementById('doctorSalesBack').onclick=()=>{state.doctorSalesSelectedDoctor='';doctorSalesView(main);};
  const detailPdfBtn=document.getElementById('doctorDetailPdfExport');if(detailPdfBtn)detailPdfBtn.onclick=()=>exportDoctorDetailPdf(doctor);
  const topToggle=document.getElementById('doctorTopItemsToggle'),topBody=document.getElementById('doctorTopItemsBody');
  if(topToggle&&topBody){let expanded=false;topToggle.onclick=()=>{expanded=!expanded;topBody.innerHTML=renderDoctorTopItems(expanded?topItems:topItems.slice(0,10));topToggle.textContent=expanded?'إخفاء وعرض أول 10':`إظهار الكل (${Number(topItems.length).toLocaleString('en-US')})`;};}
}
function renderDoctorTopItems(rows){
  if(!rows.length)return '<div class="empty">لا توجد أصناف مباعة.</div>';
  const desktop=`<div class="table-wrap desktop-table"><table class="doctor-top-items-table"><thead><tr><th>#</th><th>الصنف</th><th>عدد الفواتير</th><th>مرات الظهور</th><th>علب</th><th>فرط</th><th>قيمة البيع</th></tr></thead><tbody>${rows.map((x,i)=>`<tr><td>${i+1}</td><td><strong>${esc(x.item_name)}</strong>${x.item_ref?`<small>${esc(x.item_ref)}</small>`:''}</td><td>${Number(x.invoice_count||0).toLocaleString('en-US')}</td><td>${Number(x.sales_lines||0).toLocaleString('en-US')}</td><td>${Number(x.boxes_quantity||0).toLocaleString('en-US',{maximumFractionDigits:2})}</td><td>${Number(x.loose_quantity||0).toLocaleString('en-US',{maximumFractionDigits:2})}</td><td class="money">${money(x.sales_value)}</td></tr>`).join('')}</tbody></table></div>`;
  const mobile=`<div class="mobile-list">${rows.map((x,i)=>`<div class="item-card doctor-top-item-card"><div class="item-title"><span>${i+1}. ${esc(x.item_name)}</span><strong>${Number(x.invoice_count||0)} فاتورة</strong></div><div class="item-meta"><div><span>علب</span><strong>${Number(x.boxes_quantity||0).toLocaleString('en-US',{maximumFractionDigits:2})}</strong></div><div><span>فرط</span><strong>${Number(x.loose_quantity||0).toLocaleString('en-US',{maximumFractionDigits:2})}</strong></div><div><span>مرات الظهور</span><strong>${Number(x.sales_lines||0).toLocaleString('en-US')}</strong></div><div><span>قيمة البيع</span><strong>${money(x.sales_value)}</strong></div></div></div>`).join('')}</div>`;
  return desktop+mobile;
}
function renderDoctorInvoices(rows){
  if(!rows.length)return '<div class="empty">لا توجد فواتير نقدية قيمتها أكبر من 100 د.ل.</div>';
  const desktop=`<div class="table-wrap desktop-table"><table class="doctor-invoices-table"><thead><tr><th>#</th><th>رقم الفاتورة/الحركة</th><th>التاريخ والوقت</th><th>عدد الأصناف</th><th>قيمة الفاتورة</th></tr></thead><tbody>${rows.map((x,i)=>`<tr><td>${i+1}</td><td><strong>${esc(x.movement_number)}</strong></td><td>${esc(x.date||'—')}</td><td>${Number(x.item_count||0).toLocaleString('en-US')}</td><td class="money">${money(x.net_total)}</td></tr>`).join('')}</tbody></table></div>`;
  const mobile=`<div class="mobile-list doctor-invoice-mobile">${rows.map((x,i)=>`<div class="item-card"><div class="item-title"><span>#${esc(x.movement_number)}</span><strong>${money(x.net_total)}</strong></div><div class="item-meta"><div><span>التاريخ</span><strong>${esc(x.date||'—')}</strong></div><div><span>عدد الأصناف</span><strong>${Number(x.item_count||0).toLocaleString('en-US')}</strong></div></div></div>`).join('')}</div>`;
  return desktop+mobile;
}


function doctorPdfGeneratedAt(){
  return new Date().toLocaleString('en-GB',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
}
function doctorPdfNum(value,digits=0){
  return Number(value||0).toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits});
}
function doctorPdfSafeTitle(value){
  return String(value||'تقرير').replace(/[\\/:*?"<>|]+/g,'-').replace(/\s+/g,' ').trim().slice(0,100)||'تقرير';
}
function openDoctorPdfPrintWindow({title,subtitle='',body='',orientation='portrait'}){
  const printWindow=window.open('','_blank');
  if(!printWindow){toast('المتصفح منع نافذة التصدير. اسمح بالنوافذ المنبثقة وحاول من جديد.',true);return;}
  const safeTitle=doctorPdfSafeTitle(title);
  const html=`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(safeTitle)}</title><style>
  @page{size:A4 ${orientation};margin:10mm 10mm 12mm}
  *{box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
  html,body{margin:0;padding:0;background:#fff;color:#15231f;font-family:Tahoma,Arial,"Segoe UI",sans-serif;direction:rtl}
  body{font-size:10.5px;line-height:1.55}
  .doc{width:100%;margin:0 auto}
  .doc-head{border:1px solid #cfe0da;border-top:5px solid #0f7a5b;border-radius:12px;padding:12px 14px;margin-bottom:10px;background:#f8fcfa}
  .doc-head h1{font-size:20px;line-height:1.25;margin:0 0 5px;color:#0f5f48}
  .doc-head .sub{font-size:10px;color:#596b65;margin-top:2px}.doc-head .meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
  .tag{display:inline-block;border:1px solid #b9d8cd;background:#edf8f4;color:#17644e;border-radius:999px;padding:3px 8px;font-size:9px}
  .section{margin:0 0 10px}.section.page-break{break-before:page;page-break-before:always}.section-title{font-size:13px;color:#0f5f48;margin:0 0 6px;padding-bottom:4px;border-bottom:2px solid #dbe9e4}
  .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:9px}.card{border:1px solid #d8e4e0;border-radius:8px;padding:7px 8px;background:#fff;min-height:49px;break-inside:avoid}.card .label{font-size:8.5px;color:#667872;margin-bottom:3px}.card .value{font-size:13px;font-weight:700;color:#153e32}.card .note{font-size:8px;color:#788983;margin-top:2px}
  .leaders{display:grid;grid-template-columns:repeat(6,1fr);gap:6px}.leader{border:1px solid #d9e5e1;border-radius:8px;padding:7px;background:#f9fbfa;break-inside:avoid}.leader .label{font-size:8px;color:#687a74}.leader .name{font-weight:700;margin:2px 0;color:#203b33}.leader .value{font-size:11px;color:#0f6b50;font-weight:700}
  table{width:100%;border-collapse:collapse;table-layout:fixed;margin:0 0 8px;font-size:8.2px;direction:rtl}thead{display:table-header-group}tfoot{display:table-footer-group}tr{break-inside:avoid;page-break-inside:avoid}th,td{border:1px solid #d9e2df;padding:4px 4px;vertical-align:middle;overflow-wrap:anywhere}th{background:#e8f3ef;color:#1e4e40;font-weight:700;text-align:center}td{text-align:center}td.name{text-align:right;font-weight:700}td.money{white-space:nowrap;font-variant-numeric:tabular-nums}.muted{color:#70817b}.nowrap{white-space:nowrap}.small{font-size:7.5px}
  .note-box{border:1px solid #dfebe7;background:#f8fbfa;border-radius:8px;padding:7px 9px;color:#5e716a;font-size:8.5px;margin:7px 0}.footer-note{margin-top:8px;padding-top:5px;border-top:1px solid #dce7e3;color:#7a8984;font-size:7.5px;text-align:center}
  .doctor-items th:nth-child(1){width:5%}.doctor-items th:nth-child(2){width:43%}.doctor-items th:nth-child(3){width:10%}.doctor-items th:nth-child(4){width:10%}.doctor-items th:nth-child(5){width:8%}.doctor-items th:nth-child(6){width:8%}.doctor-items th:nth-child(7){width:16%}
  .doctor-invoices th:nth-child(1){width:6%}.doctor-invoices th:nth-child(2){width:23%}.doctor-invoices th:nth-child(3){width:31%}.doctor-invoices th:nth-child(4){width:16%}.doctor-invoices th:nth-child(5){width:24%}
  @media print{.doc-head,.card,.leader,.note-box{box-shadow:none}.section-title{break-after:avoid}.no-print{display:none!important}}
  </style></head><body><main class="doc"><header class="doc-head"><h1>${esc(title)}</h1>${subtitle?`<div class="sub">${subtitle}</div>`:''}<div class="meta"><span class="tag">المبيعات النقدية فقط</span><span class="tag">مبيعات الآجل مستبعدة</span><span class="tag">تاريخ التصدير: ${esc(doctorPdfGeneratedAt())}</span></div></header>${body}<div class="footer-note">Abdo Debts - تقرير تحليلي للإدارة</div></main></body></html>`;
  printWindow.document.open();printWindow.document.write(html);printWindow.document.close();
  toast('تم تجهيز التقرير. اختر حفظ كـ PDF من نافذة الطباعة.');
  setTimeout(()=>{try{printWindow.focus();printWindow.print();}catch{}},450);
}
function exportDoctorSalesAnalysisPdf(){
  const data=state.doctorSalesAnalysis;if(!data){toast('ارفع تقرير المبيعات أولًا.',true);return;}
  const doctors=[...(data.doctors||[])].sort((a,b)=>Number(b.net_sales||0)-Number(a.net_sales||0)||String(a.doctor||'').localeCompare(String(b.doctor||''),'ar'));
  const t=data.totals||{},source=data.source||'تقرير المبيعات',period=`${data.period_start||'—'} ← ${data.period_end||'—'}`;
  const bestKpi=doctorCompareBest('kpi_score'),bestNet=doctorCompareBest('net_sales'),bestDaily=doctorCompareBest('daily_average'),bestAvg=doctorCompareBest('average_invoice'),bestInvDay=doctorCompareBest('invoices_per_active_day'),bestStability=doctorCompareBest('stability_score');
  const financialRows=doctors.map((d,i)=>`<tr><td>${i+1}</td><td class="name">${esc(d.doctor)}</td><td>${doctorKpiValue(d.kpi_score)}</td><td class="money">${money(d.net_sales)}</td><td>${doctorPdfNum(d.invoice_count)}</td><td>${doctorPdfNum(d.active_days)}</td><td class="money">${money(d.daily_average)}</td><td>${doctorPdfNum(d.invoices_per_active_day,2)}</td><td class="money">${money(d.average_invoice)}</td><td class="money">${money(d.median_invoice)}</td></tr>`).join('');
  const qualityRows=doctors.map((d,i)=>`<tr><td>${i+1}</td><td class="name">${esc(d.doctor)}</td><td>${doctorPdfNum(d.average_items_per_invoice,2)}</td><td>${doctorPdfNum(d.unique_items)}</td><td>${doctorPdfNum(d.high_value_invoice_count)}</td><td>${doctorPdfNum(d.high_value_invoice_percentage,1)}%</td><td>${d.stability_score==null?'—':`${doctorPdfNum(d.stability_score,1)}%`}</td><td>${esc(d.stability_label||'—')}</td><td class="money">${money(d.returns_total)}</td></tr>`).join('');
  const kpiRows=doctors.map((d,i)=>`<tr><td>${i+1}</td><td class="name">${esc(d.doctor)}</td><td><strong>${doctorKpiValue(d.kpi_score)}</strong></td><td>${esc(doctorKpiLabel(d))}</td><td>${doctorKpiValue(d.productivity_kpi)}</td><td>${doctorKpiValue(d.basket_quality_kpi)}</td><td>${doctorKpiValue(d.consistency_kpi)}</td><td>${doctorPdfNum(d.diversity_rate,1)}</td></tr>`).join('');
  const leader=(label,d,key,format='money')=>`<div class="leader"><div class="label">${esc(label)}</div><div class="name">${d?esc(d.doctor):'—'}</div><div class="value">${!d?'—':format==='money'?money(d[key]):format==='percent'?`${doctorPdfNum(d[key],1)}%`:format==='score'?doctorKpiValue(d[key]):doctorPdfNum(d[key],2)}</div></div>`;
  const body=`
  <section class="section"><div class="cards">
    <div class="card"><div class="label">صافي المبيعات النقدية</div><div class="value">${money(t.net_sales)}</div></div>
    <div class="card"><div class="label">إجمالي المبيعات النقدية</div><div class="value">${money(t.sales_total)}</div></div>
    <div class="card"><div class="label">المرتجعات النقدية</div><div class="value">${money(t.returns_total)}</div></div>
    <div class="card"><div class="label">عدد الفواتير النقدية</div><div class="value">${doctorPdfNum(t.invoice_count)}</div></div>
    <div class="card"><div class="label">متوسط الفاتورة</div><div class="value">${money(t.average_invoice)}</div></div>
    <div class="card"><div class="label">أيام النشاط</div><div class="value">${doctorPdfNum(t.active_days)}</div></div>
    <div class="card"><div class="label">عدد الدكاترة</div><div class="value">${doctorPdfNum(data.doctor_count)}</div></div>
    <div class="card"><div class="label">الأصناف المختلفة</div><div class="value">${doctorPdfNum(t.unique_items)}</div></div>
    <div class="card"><div class="label">متوسط KPI الفريق</div><div class="value">${doctorKpiValue(t.kpi_average)}</div></div>
  </div></section>
  <section class="section"><h2 class="section-title">أبرز مؤشرات الأداء</h2><div class="leaders">${leader('الأعلى KPI',bestKpi,'kpi_score','score')}${leader('الأعلى صافي مبيعات',bestNet,'net_sales')}${leader('الأعلى مبيعات / يوم',bestDaily,'daily_average')}${leader('الأعلى متوسط فاتورة',bestAvg,'average_invoice')}${leader('الأعلى فواتير / يوم',bestInvDay,'invoices_per_active_day','num')}${leader('الأكثر ثباتًا',bestStability,'stability_score','percent')}</div></section>
  <section class="section page-break"><h2 class="section-title">مؤشرات KPI للدكاترة</h2><table><thead><tr><th>#</th><th>الدكتور</th><th>KPI العام</th><th>التقييم</th><th>Productivity</th><th>Basket Quality</th><th>Consistency</th><th>تنوع/100 فاتورة</th></tr></thead><tbody>${kpiRows}</tbody></table><div class="note-box">KPI نسبي داخل نفس التقرير. الأوزان: المبيعات/يوم 25%، فواتير/يوم 15%، متوسط الفاتورة 15%، Median 10%، أصناف/فاتورة 10%، نسبة فواتير فوق 100 = 10%، الثبات 10%، التنوع 5%.</div></section>
  <section class="section page-break"><h2 class="section-title">المقارنة المالية والتشغيلية لجميع الدكاترة</h2><table><thead><tr><th style="width:4%">#</th><th style="width:16%">الدكتور</th><th>KPI</th><th>صافي المبيعات</th><th>الفواتير</th><th>أيام النشاط</th><th>مبيعات/يوم</th><th>فواتير/يوم</th><th>متوسط الفاتورة</th><th>Median</th></tr></thead><tbody>${financialRows}</tbody></table></section>
  <section class="section page-break"><h2 class="section-title">مؤشرات تنوع وجودة الأداء</h2><table><thead><tr><th style="width:4%">#</th><th style="width:18%">الدكتور</th><th>أصناف/فاتورة</th><th>الأصناف المختلفة</th><th>فواتير >100</th><th>نسبة >100</th><th>الثبات</th><th>تقييم الثبات</th><th>المرتجعات</th></tr></thead><tbody>${qualityRows}</tbody></table><div class="note-box">ثبات الأداء يقيس انتظام قيمة المبيعات النقدية بين أيام النشاط. كلما ارتفعت النسبة كان الأداء اليومي أكثر استقرارًا. عدد الفواتير وباقي المؤشرات محسوبة على كل المبيعات النقدية، بينما مبيعات الآجل مستبعدة بالكامل.</div></section>`;
  openDoctorPdfPrintWindow({title:'تحليل مبيعات الدكاترة',subtitle:`${esc(source)} | الفترة: ${esc(period)}${state.doctorSalesFileName?` | الملف: ${esc(state.doctorSalesFileName)}`:''}`,body,orientation:'landscape'});
}
function exportDoctorDetailPdf(doctor){
  if(!doctor)return;
  const data=state.doctorSalesAnalysis||{},topItems=(doctor.top_items||[]).slice(0,50),invoices=(doctor.invoices||[]).filter(x=>Number(x.net_total||0)>100).sort((a,b)=>Number(b.net_total||0)-Number(a.net_total||0));
  const topRows=topItems.map((x,i)=>`<tr><td>${i+1}</td><td class="name">${esc(x.item_name)}${x.item_ref?`<div class="muted small">${esc(x.item_ref)}</div>`:''}</td><td>${doctorPdfNum(x.invoice_count)}</td><td>${doctorPdfNum(x.sales_lines)}</td><td>${doctorPdfNum(x.boxes_quantity,2)}</td><td>${doctorPdfNum(x.loose_quantity,2)}</td><td class="money">${money(x.sales_value)}</td></tr>`).join('');
  const invoiceRows=invoices.map((x,i)=>`<tr><td>${i+1}</td><td>${esc(x.movement_number)}</td><td>${esc(x.date||'—')}</td><td>${doctorPdfNum(x.item_count)}</td><td class="money">${money(x.net_total)}</td></tr>`).join('');
  const stability=doctor.stability_score==null?'—':`${doctorPdfNum(doctor.stability_score,1)}%`;
  const body=`
  <section class="section"><div class="cards">
    <div class="card"><div class="label">KPI العام</div><div class="value">${doctorKpiValue(doctor.kpi_score)}</div><div class="note">${esc(doctorKpiLabel(doctor))}</div></div>
    <div class="card"><div class="label">Productivity KPI</div><div class="value">${doctorKpiValue(doctor.productivity_kpi)}</div></div>
    <div class="card"><div class="label">Basket Quality KPI</div><div class="value">${doctorKpiValue(doctor.basket_quality_kpi)}</div></div>
    <div class="card"><div class="label">Consistency KPI</div><div class="value">${doctorKpiValue(doctor.consistency_kpi)}</div></div>
    <div class="card"><div class="label">صافي المبيعات</div><div class="value">${money(doctor.net_sales)}</div></div>
    <div class="card"><div class="label">عدد الفواتير</div><div class="value">${doctorPdfNum(doctor.invoice_count)}</div></div>
    <div class="card"><div class="label">أيام النشاط</div><div class="value">${doctorPdfNum(doctor.active_days)}</div></div>
    <div class="card"><div class="label">المبيعات / يوم نشاط</div><div class="value">${money(doctor.daily_average)}</div></div>
    <div class="card"><div class="label">فواتير / يوم نشاط</div><div class="value">${doctorPdfNum(doctor.invoices_per_active_day,2)}</div></div>
    <div class="card"><div class="label">متوسط الفاتورة</div><div class="value">${money(doctor.average_invoice)}</div></div>
    <div class="card"><div class="label">Median الفاتورة</div><div class="value">${money(doctor.median_invoice)}</div></div>
    <div class="card"><div class="label">متوسط الأصناف / فاتورة</div><div class="value">${doctorPdfNum(doctor.average_items_per_invoice,2)}</div></div>
    <div class="card"><div class="label">الأصناف المختلفة</div><div class="value">${doctorPdfNum(doctor.unique_items)}</div></div>
    <div class="card"><div class="label">الفواتير فوق 100</div><div class="value">${doctorPdfNum(doctor.high_value_invoice_count)}</div><div class="note">${doctorPdfNum(doctor.high_value_invoice_percentage,1)}% من الفواتير</div></div>
    <div class="card"><div class="label">ثبات الأداء</div><div class="value">${stability}</div><div class="note">${esc(doctor.stability_label||'—')}</div></div>
    <div class="card"><div class="label">المرتجعات النقدية</div><div class="value">${money(doctor.returns_total)}</div></div>
  </div><div class="note-box">KPI نسبي مقارنة بباقي الدكاترة داخل نفس التقرير. الأوزان: المبيعات/يوم 25%، فواتير/يوم 15%، متوسط الفاتورة 15%، Median 10%، أصناف/فاتورة 10%، فواتير فوق 100 = 10%، الثبات 10%، التنوع 5%. ثبات الأداء يقيس انتظام المبيعات بين أيام النشاط. مبيعات الآجل مستبعدة بالكامل.</div></section>
  <section class="section page-break"><h2 class="section-title">أكثر 50 صنف بيعًا</h2>${topItems.length?`<table class="doctor-items"><thead><tr><th>#</th><th>الصنف</th><th>عدد الفواتير</th><th>مرات الظهور</th><th>علب</th><th>فرط</th><th>قيمة البيع</th></tr></thead><tbody>${topRows}</tbody></table>`:'<div class="note-box">لا توجد أصناف مباعة.</div>'}</section>
  <section class="section"><h2 class="section-title">الفواتير النقدية فوق 100 د.ل</h2><div class="note-box">${doctorPdfNum(invoices.length)} فاتورة - مرتبة من الأعلى إلى الأقل.</div>${invoices.length?`<table class="doctor-invoices"><thead><tr><th>#</th><th>رقم الفاتورة/الحركة</th><th>التاريخ والوقت</th><th>عدد الأصناف</th><th>قيمة الفاتورة</th></tr></thead><tbody>${invoiceRows}</tbody></table>`:'<div class="note-box">لا توجد فواتير نقدية قيمتها أكبر من 100 د.ل.</div>'}</section>`;
  const period=`${data.period_start||'—'} ← ${data.period_end||'—'}`;
  openDoctorPdfPrintWindow({title:`تفاصيل مبيعات - ${doctor.doctor}`,subtitle:`الفترة: ${esc(period)} | ${esc(data.source||'تقرير المبيعات')}`,body,orientation:'portrait'});
}


const DOCTOR_COMPARE_METRICS = [
  {key:'kpi_score',label:'KPI العام',format:'score'},
  {key:'productivity_kpi',label:'Productivity KPI',format:'score'},
  {key:'basket_quality_kpi',label:'Basket Quality KPI',format:'score'},
  {key:'consistency_kpi',label:'Consistency KPI',format:'scoreNullable'},
  {key:'net_sales',label:'صافي المبيعات',format:'money'},
  {key:'active_days',label:'أيام النشاط',format:'int'},
  {key:'daily_average',label:'المبيعات / يوم نشاط',format:'money'},
  {key:'invoice_count',label:'عدد الفواتير',format:'int'},
  {key:'invoices_per_active_day',label:'فواتير / يوم نشاط',format:'num2'},
  {key:'average_invoice',label:'متوسط الفاتورة',format:'money'},
  {key:'median_invoice',label:'Median الفاتورة',format:'money'},
  {key:'average_items_per_invoice',label:'أصناف / فاتورة',format:'num2'},
  {key:'unique_items',label:'الأصناف المختلفة',format:'int'},
  {key:'high_value_invoice_count',label:'فواتير فوق 100',format:'int'},
  {key:'high_value_invoice_percentage',label:'نسبة الفواتير فوق 100',format:'percent'},
  {key:'stability_score',label:'ثبات الأداء',format:'percentNullable'},
];
function doctorCompareNumber(doctor,key){
  const value=doctor?.[key];
  if(value===null||value===undefined||value==='')return null;
  const n=Number(value);return Number.isFinite(n)?n:null;
}
function doctorCompareFormat(value,format){
  if(value===null||value===undefined||!Number.isFinite(Number(value)))return '—';
  const n=Number(value);
  if(format==='money')return money(n);
  if(format==='int')return n.toLocaleString('en-US',{maximumFractionDigits:0});
  if(format==='num2')return n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  if(format==='percent'||format==='percentNullable')return `${n.toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1})}%`;
  if(format==='score'||format==='scoreNullable')return `${n.toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1})}/100`;
  return n.toLocaleString('en-US',{maximumFractionDigits:2});
}
function doctorCompareMetric(key){return DOCTOR_COMPARE_METRICS.find(x=>x.key===key)||DOCTOR_COMPARE_METRICS[0];}
function doctorCompareSortedRows(){
  const rows=[...(state.doctorSalesAnalysis?.doctors||[])],key=state.doctorCompareSortKey||'net_sales',dir=state.doctorCompareSortDir==='asc'?1:-1;
  rows.sort((a,b)=>{
    const av=doctorCompareNumber(a,key),bv=doctorCompareNumber(b,key);
    if(av===null&&bv===null)return String(a.doctor||'').localeCompare(String(b.doctor||''),'ar');
    if(av===null)return 1;if(bv===null)return -1;
    const diff=(av-bv)*dir;
    return diff||Number(b.net_sales||0)-Number(a.net_sales||0)||String(a.doctor||'').localeCompare(String(b.doctor||''),'ar');
  });
  return rows;
}
function doctorCompareBest(key){
  return (state.doctorSalesAnalysis?.doctors||[]).filter(x=>doctorCompareNumber(x,key)!==null).sort((a,b)=>Number(b[key]||0)-Number(a[key]||0))[0]||null;
}
async function doctorComparisonView(main){
  const data=state.doctorSalesAnalysis;
  if(!data){
    main.innerHTML=`<div class="page-head"><div><h2>مقارنة الدكاترة</h2><div class="muted">ارفع تقرير المبيعات أولًا حتى نقدر نقارن الدكاترة.</div></div></div><section class="panel"><div class="empty">لا يوجد تحليل مبيعات محمّل حاليًا.<br><button class="btn btn-primary" id="doctorCompareGoUpload" style="margin-top:12px">الذهاب لمبيعات الدكاترة</button></div></section>`;
    document.getElementById('doctorCompareGoUpload').onclick=()=>go('doctorsales');return;
  }
  const doctors=data.doctors||[];
  if(!doctors.length){main.innerHTML='<section class="panel"><div class="empty">لا توجد بيانات دكاترة للمقارنة.</div></section>';return;}
  if(!doctors.some(x=>x.doctor_key===state.doctorCompareA))state.doctorCompareA=doctors[0]?.doctor_key||'';
  if(!doctors.some(x=>x.doctor_key===state.doctorCompareB)||state.doctorCompareB===state.doctorCompareA)state.doctorCompareB=doctors.find(x=>x.doctor_key!==state.doctorCompareA)?.doctor_key||state.doctorCompareA;
  const bestKpi=doctorCompareBest('kpi_score'),bestNet=doctorCompareBest('net_sales'),bestDaily=doctorCompareBest('daily_average'),bestAvg=doctorCompareBest('average_invoice'),bestInvoicesDay=doctorCompareBest('invoices_per_active_day'),bestStability=doctorCompareBest('stability_score');
  main.innerHTML=`<div class="page-head doctor-compare-head"><div><h2>مقارنة الدكاترة</h2><div class="muted">مقارنة المبيعات النقدية فقط خلال ${esc(data.period_start||'—')} ← ${esc(data.period_end||'—')}</div></div><div class="page-head-actions"><button class="btn btn-soft" id="doctorCompareBack">← مبيعات الدكاترة</button></div></div>
  <div class="doctor-compare-leaders">
    ${renderDoctorCompareLeader('الأعلى KPI',bestKpi,'kpi_score','score')}
    ${renderDoctorCompareLeader('الأعلى صافي مبيعات',bestNet,'net_sales','money')}
    ${renderDoctorCompareLeader('الأعلى مبيعات/يوم',bestDaily,'daily_average','money')}
    ${renderDoctorCompareLeader('الأعلى متوسط فاتورة',bestAvg,'average_invoice','money')}
    ${renderDoctorCompareLeader('الأعلى فواتير/يوم',bestInvoicesDay,'invoices_per_active_day','num2')}
    ${renderDoctorCompareLeader('الأكثر ثباتًا',bestStability,'stability_score','percentNullable')}
  </div>
  <section class="panel doctor-pair-panel"><div class="section-head"><div><h3>دكتور ضد دكتور</h3><div class="muted">اختر دكتورين وشوف الفرق في كل مؤشر مباشرة.</div></div></div>
    <div class="doctor-pair-selectors"><div class="field"><label>الدكتور الأول</label><select class="select" id="doctorCompareA">${doctorCompareOptions(doctors,state.doctorCompareA)}</select></div><div class="doctor-vs-badge">VS</div><div class="field"><label>الدكتور الثاني</label><select class="select" id="doctorCompareB">${doctorCompareOptions(doctors,state.doctorCompareB)}</select></div></div>
    <div id="doctorPairResults"></div>
  </section>
  <section class="panel doctor-all-compare-panel"><div class="section-head"><div><h3>مقارنة الجميع</h3><div class="muted">اضغط على عنوان أي عمود لترتيب الدكاترة، أو استخدم خيارات الترتيب.</div></div></div>
    <div class="doctor-compare-toolbar"><select class="select" id="doctorCompareSortMetric">${DOCTOR_COMPARE_METRICS.map(m=>`<option value="${m.key}">${esc(m.label)}</option>`).join('')}</select><button class="btn btn-soft" id="doctorCompareDir">${state.doctorCompareSortDir==='asc'?'من الأقل للأعلى ↑':'من الأعلى للأقل ↓'}</button></div>
    <div id="doctorAllCompare"></div>
  </section>`;
  document.getElementById('doctorCompareBack').onclick=()=>go('doctorsales');
  const a=document.getElementById('doctorCompareA'),b=document.getElementById('doctorCompareB');
  a.onchange=()=>{state.doctorCompareA=a.value;if(state.doctorCompareB===a.value){const alt=doctors.find(x=>x.doctor_key!==a.value);if(alt)state.doctorCompareB=alt.doctor_key;b.value=state.doctorCompareB;}renderDoctorPairComparison();};
  b.onchange=()=>{state.doctorCompareB=b.value;if(state.doctorCompareA===b.value){const alt=doctors.find(x=>x.doctor_key!==b.value);if(alt)state.doctorCompareA=alt.doctor_key;a.value=state.doctorCompareA;}renderDoctorPairComparison();};
  const metric=document.getElementById('doctorCompareSortMetric'),dir=document.getElementById('doctorCompareDir');metric.value=state.doctorCompareSortKey||'net_sales';
  metric.onchange=()=>{state.doctorCompareSortKey=metric.value;renderDoctorAllComparison();};
  dir.onclick=()=>{state.doctorCompareSortDir=state.doctorCompareSortDir==='asc'?'desc':'asc';dir.textContent=state.doctorCompareSortDir==='asc'?'من الأقل للأعلى ↑':'من الأعلى للأقل ↓';renderDoctorAllComparison();};
  renderDoctorPairComparison();renderDoctorAllComparison();
}
function renderDoctorCompareLeader(label,doctor,key,format){
  if(!doctor)return `<div class="stat doctor-leader-card"><div class="label">${esc(label)}</div><div class="value">—</div></div>`;
  return `<div class="stat doctor-leader-card"><div class="label">${esc(label)}</div><div class="doctor-leader-name">${esc(doctor.doctor)}</div><div class="value">${doctorCompareFormat(doctorCompareNumber(doctor,key),format)}</div></div>`;
}
function doctorCompareOptions(doctors,selected){return doctors.map(x=>`<option value="${esc(x.doctor_key)}" ${x.doctor_key===selected?'selected':''}>${esc(x.doctor)}</option>`).join('');}
function doctorByKey(key){return (state.doctorSalesAnalysis?.doctors||[]).find(x=>x.doctor_key===key)||null;}
function renderDoctorPairComparison(){
  const box=document.getElementById('doctorPairResults');if(!box)return;const a=doctorByKey(state.doctorCompareA),b=doctorByKey(state.doctorCompareB);if(!a||!b){box.innerHTML='<div class="empty">اختر دكتورين للمقارنة.</div>';return;}
  const rows=DOCTOR_COMPARE_METRICS.map(metric=>{
    const av=doctorCompareNumber(a,metric.key),bv=doctorCompareNumber(b,metric.key),both=av!==null&&bv!==null,diff=both?Math.abs(av-bv):null;
    let winner='—',winnerClass='';if(both){if(Math.abs(av-bv)<1e-9)winner='تعادل';else if(av>bv){winner=a.doctor;winnerClass='winner-a';}else{winner=b.doctor;winnerClass='winner-b';}}
    return `<tr><td><strong>${esc(metric.label)}</strong></td><td class="doctor-pair-value ${winnerClass==='winner-a'?'is-winner':''}">${doctorCompareFormat(av,metric.format)}</td><td class="doctor-pair-value ${winnerClass==='winner-b'?'is-winner':''}">${doctorCompareFormat(bv,metric.format)}</td><td>${diff===null?'—':doctorCompareFormat(diff,metric.format)}</td><td><span class="doctor-winner ${winnerClass}">${esc(winner)}</span></td></tr>`;
  }).join('');
  box.innerHTML=`<div class="doctor-pair-names"><div><span>الدكتور الأول</span><strong>${esc(a.doctor)}</strong></div><div><span>الدكتور الثاني</span><strong>${esc(b.doctor)}</strong></div></div><div class="table-wrap"><table class="doctor-pair-table"><thead><tr><th>المؤشر</th><th>${esc(a.doctor)}</th><th>${esc(b.doctor)}</th><th>الفرق</th><th>الأعلى</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function setDoctorCompareSort(key){
  if(state.doctorCompareSortKey===key)state.doctorCompareSortDir=state.doctorCompareSortDir==='asc'?'desc':'asc';else{state.doctorCompareSortKey=key;state.doctorCompareSortDir='desc';}
  const metric=document.getElementById('doctorCompareSortMetric'),dir=document.getElementById('doctorCompareDir');if(metric)metric.value=state.doctorCompareSortKey;if(dir)dir.textContent=state.doctorCompareSortDir==='asc'?'من الأقل للأعلى ↑':'من الأعلى للأقل ↓';renderDoctorAllComparison();
}
function renderDoctorAllComparison(){
  const box=document.getElementById('doctorAllCompare');if(!box)return;const rows=doctorCompareSortedRows();
  const cols=DOCTOR_COMPARE_METRICS.map(m=>`<th><button class="doctor-sort-head ${state.doctorCompareSortKey===m.key?'active':''}" data-compare-sort="${m.key}">${esc(m.label)}${state.doctorCompareSortKey===m.key?(state.doctorCompareSortDir==='asc'?' ↑':' ↓'):''}</button></th>`).join('');
  const body=rows.map((x,i)=>`<tr><td>${i+1}</td><td class="doctor-compare-name"><strong>${esc(x.doctor)}</strong></td>${DOCTOR_COMPARE_METRICS.map(m=>`<td>${doctorCompareFormat(doctorCompareNumber(x,m.key),m.format)}</td>`).join('')}<td><button class="btn btn-soft btn-sm" data-compare-detail="${esc(x.doctor_key)}">التفاصيل</button></td></tr>`).join('');
  const desktop=`<div class="table-wrap desktop-table doctor-all-table-wrap"><table class="doctor-all-compare-table"><thead><tr><th>#</th><th>الدكتور</th>${cols}<th></th></tr></thead><tbody>${body}</tbody></table></div>`;
  const mobile=`<div class="mobile-list doctor-compare-mobile">${rows.map((x,i)=>`<div class="item-card"><div class="item-title"><span>${i+1}. ${esc(x.doctor)}</span><strong>${doctorCompareFormat(doctorCompareNumber(x,state.doctorCompareSortKey),doctorCompareMetric(state.doctorCompareSortKey).format)}</strong></div><div class="item-meta"><div><span>صافي المبيعات</span><strong>${money(x.net_sales)}</strong></div><div><span>مبيعات/يوم</span><strong>${money(x.daily_average)}</strong></div><div><span>فواتير/يوم</span><strong>${doctorCompareFormat(doctorCompareNumber(x,'invoices_per_active_day'),'num2')}</strong></div><div><span>متوسط الفاتورة</span><strong>${money(x.average_invoice)}</strong></div><div><span>Median</span><strong>${money(x.median_invoice)}</strong></div><div><span>ثبات الأداء</span><strong>${doctorCompareFormat(doctorCompareNumber(x,'stability_score'),'percentNullable')}</strong></div></div><button class="btn btn-soft doctor-sales-detail-btn" data-compare-detail="${esc(x.doctor_key)}">عرض التفاصيل</button></div>`).join('')}</div>`;
  box.innerHTML=desktop+mobile;
  box.querySelectorAll('[data-compare-sort]').forEach(btn=>btn.onclick=()=>setDoctorCompareSort(btn.dataset.compareSort));
  box.querySelectorAll('[data-compare-detail]').forEach(btn=>btn.onclick=()=>{state.doctorSalesSelectedDoctor=btn.dataset.compareDetail||'';go('doctorsales');});
}


const PERIOD_COMPARE_OVERALL_METRICS = [
  {key:'kpi_average',label:'متوسط KPI الفريق',format:'score',points:true},
  {key:'net_sales',label:'صافي المبيعات',format:'money'},
  {key:'invoice_count',label:'عدد الفواتير',format:'int'},
  {key:'active_days',label:'أيام النشاط',format:'int'},
  {key:'daily_average',label:'المبيعات / يوم نشاط',format:'money'},
  {key:'invoices_per_active_day',label:'فواتير / يوم نشاط',format:'num2'},
  {key:'average_invoice',label:'متوسط الفاتورة',format:'money'},
  {key:'median_invoice',label:'Median الفاتورة',format:'money'},
  {key:'high_value_invoice_percentage',label:'نسبة الفواتير فوق 100',format:'percent',points:true},
  {key:'unique_items',label:'الأصناف المختلفة',format:'int'},
];
const PERIOD_COMPARE_SORT_OPTIONS = [
  {key:'improvement_score',label:'مؤشر التحسن الإجمالي'},
  {key:'kpi_score',label:'تغير KPI العام'},
  {key:'productivity_kpi',label:'تغير Productivity KPI'},
  {key:'basket_quality_kpi',label:'تغير Basket Quality KPI'},
  {key:'consistency_kpi',label:'تغير Consistency KPI'},
  {key:'daily_average',label:'نمو المبيعات / يوم نشاط'},
  {key:'invoices_per_active_day',label:'نمو الفواتير / يوم نشاط'},
  {key:'average_invoice',label:'نمو متوسط الفاتورة'},
  {key:'median_invoice',label:'نمو Median الفاتورة'},
  {key:'net_sales',label:'نمو صافي المبيعات'},
  {key:'high_value_invoice_percentage',label:'تغير نسبة الفواتير فوق 100'},
  {key:'stability_score',label:'تغير ثبات الأداء'},
];
function periodCompareIsPointMetric(key){
  return ['high_value_invoice_percentage','stability_score','kpi_score','productivity_kpi','basket_quality_kpi','consistency_kpi','kpi_average'].includes(key);
}
function periodComparePeriodLabel(data){
  if(!data)return 'لم يتم رفع التقرير';
  return `${data.period_start||'—'} ← ${data.period_end||'—'}`;
}
function periodCompareNum(value){
  if(value===null||value===undefined||value==='')return null;
  const n=Number(value);return Number.isFinite(n)?n:null;
}
function periodCompareRelativeChange(previous,current){
  const p=periodCompareNum(previous),c=periodCompareNum(current);
  if(p===null&&c===null)return null;
  if(p===null)return null;
  if(c===null)return -100;
  if(Math.abs(p)<1e-9){
    if(Math.abs(c)<1e-9)return 0;
    return null;
  }
  return ((c-p)/Math.abs(p))*100;
}
function periodCompareChangeText(previous,current,{points=false}={}){
  const p=periodCompareNum(previous),c=periodCompareNum(current);
  if(p===null&&c===null)return '—';
  if(p===null&&c!==null)return 'جديد';
  if(p!==null&&c===null)return 'لم يظهر';
  if(points){
    const d=c-p,sign=d>0?'+':'';
    return `${sign}${d.toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1})} نقطة`;
  }
  const ch=periodCompareRelativeChange(p,c);
  if(ch===null)return c>p?'جديد':'—';
  const sign=ch>0?'+':'';
  return `${sign}${ch.toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1})}%`;
}
function periodCompareChangeClass(previous,current){
  const p=periodCompareNum(previous),c=periodCompareNum(current);
  if(p===null||c===null)return '';
  if(Math.abs(c-p)<1e-9)return 'same';
  return c>p?'up':'down';
}
function periodCompareImprovement(previous,current){
  if(!previous)return null;
  if(!current)return -100;
  const keys=['daily_average','invoices_per_active_day','average_invoice','median_invoice'];
  const changes=[];
  for(const key of keys){
    const p=periodCompareNum(previous[key]),c=periodCompareNum(current[key]);
    if(p===null||c===null||p<=0)continue;
    const value=((c-p)/p)*100;
    changes.push(Math.max(-200,Math.min(200,value)));
  }
  if(!changes.length)return null;
  return changes.reduce((a,b)=>a+b,0)/changes.length;
}
function periodCompareDoctorRows(){
  const previous=state.periodComparePrevious?.doctors||[],current=state.periodCompareCurrent?.doctors||[];
  const map=new Map();
  previous.forEach(d=>map.set(d.doctor_key,{doctor_key:d.doctor_key,doctor:d.doctor,previous:d,current:null}));
  current.forEach(d=>{
    const row=map.get(d.doctor_key)||{doctor_key:d.doctor_key,doctor:d.doctor,previous:null,current:null};
    row.current=d;row.doctor=d.doctor||row.doctor;map.set(d.doctor_key,row);
  });
  return [...map.values()].map(row=>({
    ...row,
    status:row.previous&&row.current?'مستمر':row.current?'جديد في الفترة الجديدة':'لم يظهر في الفترة الجديدة',
    improvement_score:periodCompareImprovement(row.previous,row.current),
  }));
}
function periodCompareMetricGrowth(row,key){
  if(!row)return null;
  if(key==='improvement_score')return row.improvement_score;
  const p=row.previous?periodCompareNum(row.previous[key]):null,c=row.current?periodCompareNum(row.current[key]):null;
  if(!row.previous)return null;
  if(!row.current)return -100;
  if(periodCompareIsPointMetric(key)){
    if(p===null||c===null)return null;
    return c-p;
  }
  return periodCompareRelativeChange(p,c);
}
function periodCompareSortedDoctorRows(){
  const rows=periodCompareDoctorRows(),key=state.periodCompareSortKey||'improvement_score',dir=state.periodCompareSortDir==='asc'?1:-1;
  return rows.sort((a,b)=>{
    const av=periodCompareMetricGrowth(a,key),bv=periodCompareMetricGrowth(b,key);
    if(av===null&&bv===null)return String(a.doctor||'').localeCompare(String(b.doctor||''),'ar');
    if(av===null)return 1;if(bv===null)return -1;
    return (av-bv)*dir||String(a.doctor||'').localeCompare(String(b.doctor||''),'ar');
  });
}
function periodCompareBestRow(mode='best'){
  const rows=periodCompareDoctorRows().filter(x=>x.previous&&x.current&&x.improvement_score!==null);
  rows.sort((a,b)=>Number(b.improvement_score)-Number(a.improvement_score));
  return mode==='worst'?rows[rows.length-1]||null:rows[0]||null;
}
function periodCompareBestGrowth(key){
  return periodCompareDoctorRows().filter(x=>x.previous&&x.current&&periodCompareMetricGrowth(x,key)!==null)
    .sort((a,b)=>Number(periodCompareMetricGrowth(b,key))-Number(periodCompareMetricGrowth(a,key)))[0]||null;
}
function periodCompareDoctorByKey(data,key){return (data?.doctors||[]).find(x=>x.doctor_key===key)||null;}
function periodCompareDoctorStatusBadge(row){
  const cls=row.previous&&row.current?'matched':row.current?'new':'missing';
  return `<span class="period-doctor-status ${cls}">${esc(row.status)}</span>`;
}
function periodCompareReportCard(slot,title,data,fileName){
  const id=slot==='previous'?'PeriodComparePrevious':'PeriodCompareCurrent';
  const currentAvailable=!!state.doctorSalesAnalysis;
  const dateFrom=slot==='previous'?state.periodComparePreviousDateFrom:state.periodCompareCurrentDateFrom;
  const dateTo=slot==='previous'?state.periodComparePreviousDateTo:state.periodCompareCurrentDateTo;
  return `<section class="panel period-upload-card ${data?'loaded':''}">
    <div class="period-upload-head"><div><span class="period-step">${slot==='previous'?'1':'2'}</span><h3>${esc(title)}</h3></div>${data?'<span class="badge badge-green">جاهز</span>':'<span class="badge">مطلوب</span>'}</div>
    ${data?`<div class="period-upload-info"><strong>${esc(periodComparePeriodLabel(data))}</strong><span>${Number(data.doctor_count||0).toLocaleString('en-US')} دكتور · ${Number(data.totals?.invoice_count||0).toLocaleString('en-US')} فاتورة نقدية</span><small>الفترة الكاملة: ${esc(doctorSalesFullPeriodText(data))}</small>${fileName?`<small>${esc(fileName)}</small>`:''}</div><div class="period-card-date-filter"><label><span>من</span><input class="input" type="date" id="dateFrom${id}" min="${esc(data.available_start_iso||'')}" max="${esc(data.available_end_iso||'')}" value="${esc(dateFrom||data.available_start_iso||'')}"></label><label><span>إلى</span><input class="input" type="date" id="dateTo${id}" min="${esc(data.available_start_iso||'')}" max="${esc(data.available_end_iso||'')}" value="${esc(dateTo||data.available_end_iso||'')}"></label><button class="btn btn-soft btn-sm" id="applyDate${id}">تطبيق الفترة</button></div>`:'<div class="muted period-upload-empty">ارفع تقرير المبيعات CSV لهذه الفترة.</div>'}
    <div class="period-upload-actions"><button class="btn ${data?'btn-soft':'btn-primary'}" id="upload${id}">${data?'تغيير التقرير':'رفع التقرير'}</button>${currentAvailable?`<button class="btn btn-ghost" id="useCurrent${id}">استخدام التقرير المحمّل</button>`:''}<input id="file${id}" type="file" accept=".csv,text/csv" hidden></div>
  </section>`;
}
async function periodCompareAnalyzeFile(file,slot,dateFrom='',dateTo=''){
  if(!file)return;
  toast(`جاري تحليل ${slot==='previous'?'الفترة السابقة':'الفترة الجديدة'}...`);
  try{
    const data=await analyzeDoctorSalesFile(file,dateFrom,dateTo);
    if(slot==='previous'){state.periodComparePrevious=data;state.periodComparePreviousFileName=file.name;state.periodComparePreviousFile=file;state.periodComparePreviousDateFrom=dateFrom||data.available_start_iso||'';state.periodComparePreviousDateTo=dateTo||data.available_end_iso||'';}
    else{state.periodCompareCurrent=data;state.periodCompareCurrentFileName=file.name;state.periodCompareCurrentFile=file;state.periodCompareCurrentDateFrom=dateFrom||data.available_start_iso||'';state.periodCompareCurrentDateTo=dateTo||data.available_end_iso||'';}
    state.periodCompareSelectedDoctor='';state.periodCompareItemsExpanded=false;
    await doctorPeriodComparisonView(document.getElementById('main'));
    toast('تم تحليل التقرير وإضافته للمقارنة');
  }catch(e){toast(e.message,true);}
}
async function doctorPeriodComparisonView(main){
  if(state.periodCompareSelectedDoctor&&state.periodComparePrevious&&state.periodCompareCurrent){
    renderPeriodDoctorDetail(main,state.periodCompareSelectedDoctor);return;
  }
  const previous=state.periodComparePrevious,current=state.periodCompareCurrent,both=!!(previous&&current);
  main.innerHTML=`<div class="page-head period-compare-head"><div><h2>مقارنة الفترات</h2><div class="muted">قارن تقرير مبيعات بفترة أخرى لمعرفة التحسن أو التراجع على مستوى الصيدلية وكل دكتور.</div></div><div class="page-head-actions">${both?'<button class="btn btn-soft" id="periodComparePdf">🧾 تصدير المقارنة PDF</button><button class="btn btn-ghost" id="periodCompareSwap">⇄ تبديل الفترتين</button>':''}<button class="btn btn-soft" id="periodCompareBack">← مبيعات الدكاترة</button></div></div>
  <section class="panel period-compare-note"><strong>مقارنة عادلة للفترات المختلفة</strong><span>إجمالي المبيعات يظهر كما هو، لكن مؤشر التحسن يعتمد على المبيعات/يوم، فواتير/يوم، متوسط الفاتورة وMedian. KPI يُحسب نسبيًا داخل فريق كل فترة، لذلك تغيره يوضح تغير موقع الدكتور مقارنة بزملائه.</span></section>
  <div class="period-upload-grid">
    ${periodCompareReportCard('previous','الفترة السابقة',previous,state.periodComparePreviousFileName)}
    ${periodCompareReportCard('current','الفترة الجديدة',current,state.periodCompareCurrentFileName)}
  </div>
  <div id="periodCompareResults">${both?'<div class="loading">جاري تجهيز المقارنة...</div>':'<section class="panel"><div class="empty">ارفع التقريرين حتى تظهر المقارنة.</div></section>'}</div>`;
  document.getElementById('periodCompareBack').onclick=()=>go('doctorsales');
  for(const slot of ['Previous','Current']){
    const lower=slot==='Previous'?'previous':'current',upload=document.getElementById(`uploadPeriodCompare${slot}`),input=document.getElementById(`filePeriodCompare${slot}`),use=document.getElementById(`useCurrentPeriodCompare${slot}`),apply=document.getElementById(`applyDatePeriodCompare${slot}`);
    if(upload&&input){upload.onclick=()=>input.click();input.onchange=()=>periodCompareAnalyzeFile(input.files?.[0],lower);}
    if(use)use.onclick=async()=>{
      if(lower==='previous'){state.periodComparePrevious=state.doctorSalesAnalysis;state.periodComparePreviousFileName=state.doctorSalesFileName||'التقرير المحمّل';state.periodComparePreviousFile=state.doctorSalesFile;state.periodComparePreviousDateFrom=state.doctorSalesAnalysis?.filter_start_iso||state.doctorSalesAnalysis?.available_start_iso||'';state.periodComparePreviousDateTo=state.doctorSalesAnalysis?.filter_end_iso||state.doctorSalesAnalysis?.available_end_iso||'';}
      else{state.periodCompareCurrent=state.doctorSalesAnalysis;state.periodCompareCurrentFileName=state.doctorSalesFileName||'التقرير المحمّل';state.periodCompareCurrentFile=state.doctorSalesFile;state.periodCompareCurrentDateFrom=state.doctorSalesAnalysis?.filter_start_iso||state.doctorSalesAnalysis?.available_start_iso||'';state.periodCompareCurrentDateTo=state.doctorSalesAnalysis?.filter_end_iso||state.doctorSalesAnalysis?.available_end_iso||'';}
      state.periodCompareSelectedDoctor='';state.periodCompareItemsExpanded=false;await doctorPeriodComparisonView(main);
    };
    if(apply)apply.onclick=async()=>{
      const file=lower==='previous'?state.periodComparePreviousFile:state.periodCompareCurrentFile;
      const from=document.getElementById(`dateFromPeriodCompare${slot}`)?.value||'',to=document.getElementById(`dateToPeriodCompare${slot}`)?.value||'';
      if(!file){toast('أعد رفع التقرير حتى نقدر نطبق فترة مخصصة.',true);return;}
      if(!from||!to||from>to){toast('راجع تاريخ البداية والنهاية.',true);return;}
      apply.disabled=true;apply.textContent='جاري التطبيق...';
      await periodCompareAnalyzeFile(file,lower,from,to);
    };
  }
  const swap=document.getElementById('periodCompareSwap');
  if(swap)swap.onclick=async()=>{
    [state.periodComparePrevious,state.periodCompareCurrent]=[state.periodCompareCurrent,state.periodComparePrevious];
    [state.periodComparePreviousFileName,state.periodCompareCurrentFileName]=[state.periodCompareCurrentFileName,state.periodComparePreviousFileName];
    [state.periodComparePreviousFile,state.periodCompareCurrentFile]=[state.periodCompareCurrentFile,state.periodComparePreviousFile];
    [state.periodComparePreviousDateFrom,state.periodCompareCurrentDateFrom]=[state.periodCompareCurrentDateFrom,state.periodComparePreviousDateFrom];
    [state.periodComparePreviousDateTo,state.periodCompareCurrentDateTo]=[state.periodCompareCurrentDateTo,state.periodComparePreviousDateTo];
    state.periodCompareSelectedDoctor='';state.periodCompareItemsExpanded=false;await doctorPeriodComparisonView(main);
  };
  const pdf=document.getElementById('periodComparePdf');if(pdf)pdf.onclick=exportPeriodComparisonPdf;
  if(both)renderPeriodComparisonResults();
}
function periodCompareOverallValue(data,key){
  return periodCompareNum(data?.totals?.[key]);
}
function renderPeriodComparisonResults(){
  const box=document.getElementById('periodCompareResults'),previous=state.periodComparePrevious,current=state.periodCompareCurrent;if(!box||!previous||!current)return;
  const overallCards=PERIOD_COMPARE_OVERALL_METRICS.map(m=>{
    const p=periodCompareOverallValue(previous,m.key),c=periodCompareOverallValue(current,m.key),cls=periodCompareChangeClass(p,c);
    return `<div class="period-metric-card"><div class="label">${esc(m.label)}</div><div class="period-values"><span><small>السابقة</small><strong>${doctorCompareFormat(p,m.format)}</strong></span><span><small>الجديدة</small><strong>${doctorCompareFormat(c,m.format)}</strong></span></div><div class="period-change ${cls}">${periodCompareChangeText(p,c,{points:!!m.points})}</div></div>`;
  }).join('');
  const best=periodCompareBestRow('best'),worst=periodCompareBestRow('worst'),bestKpi=periodCompareBestGrowth('kpi_score'),bestDaily=periodCompareBestGrowth('daily_average'),bestAvg=periodCompareBestGrowth('average_invoice'),bestInvDay=periodCompareBestGrowth('invoices_per_active_day');
  const leader=(label,row,key='improvement_score')=>{
    if(!row)return `<div class="stat period-leader-card"><div class="label">${esc(label)}</div><div class="value">—</div></div>`;
    const value=key==='improvement_score'?row.improvement_score:periodCompareMetricGrowth(row,key);
    const suffix=periodCompareIsPointMetric(key)?' نقطة':'%';
    return `<div class="stat period-leader-card"><div class="label">${esc(label)}</div><div class="period-leader-name">${esc(row.doctor)}</div><div class="value ${Number(value)>=0?'period-positive':'period-negative'}">${Number(value)>=0?'+':''}${Number(value).toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1})}${suffix}</div></div>`;
  };
  box.innerHTML=`<section class="panel period-summary-panel"><div class="section-head"><div><h3>الصيدلية ككل</h3><div class="muted">${esc(periodComparePeriodLabel(previous))} مقابل ${esc(periodComparePeriodLabel(current))}</div></div></div><div class="period-overall-grid">${overallCards}</div></section>
  <div class="period-leaders-grid">${leader('الأكثر تحسنًا إجمالًا',best)}${leader('الأكثر تراجعًا',worst)}${leader('أعلى تحسن KPI',bestKpi,'kpi_score')}${leader('أعلى نمو مبيعات/يوم',bestDaily,'daily_average')}${leader('أعلى نمو متوسط فاتورة',bestAvg,'average_invoice')}${leader('أعلى نمو فواتير/يوم',bestInvDay,'invoices_per_active_day')}</div>
  <section class="panel period-doctors-panel"><div class="section-head"><div><h3>مقارنة كل الدكاترة</h3><div class="muted">مؤشر التحسن = متوسط تغير المبيعات/يوم + فواتير/يوم + متوسط الفاتورة + Median.</div></div></div>
    <div class="period-compare-toolbar"><select class="select" id="periodCompareSort">${PERIOD_COMPARE_SORT_OPTIONS.map(x=>`<option value="${x.key}">${esc(x.label)}</option>`).join('')}</select><button class="btn btn-soft" id="periodCompareSortDir">${state.periodCompareSortDir==='asc'?'الأقل للأعلى ↑':'الأعلى للأقل ↓'}</button></div>
    <div id="periodDoctorsTable"></div>
  </section>`;
  const sort=document.getElementById('periodCompareSort'),dir=document.getElementById('periodCompareSortDir');sort.value=state.periodCompareSortKey||'improvement_score';
  sort.onchange=()=>{state.periodCompareSortKey=sort.value;renderPeriodDoctorsTable();};
  dir.onclick=()=>{state.periodCompareSortDir=state.periodCompareSortDir==='asc'?'desc':'asc';dir.textContent=state.periodCompareSortDir==='asc'?'الأقل للأعلى ↑':'الأعلى للأقل ↓';renderPeriodDoctorsTable();};
  renderPeriodDoctorsTable();
}
function periodCompareGrowthBadge(row,key){
  const value=periodCompareMetricGrowth(row,key);
  if(value===null)return row.previous?'—':'جديد';
  const cls=value>0?'up':value<0?'down':'same',sign=value>0?'+':'';
  return `<span class="period-growth ${cls}">${sign}${Number(value).toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1})}${periodCompareIsPointMetric(key)?' نقطة':'%'}</span>`;
}
function renderPeriodDoctorsTable(){
  const box=document.getElementById('periodDoctorsTable');if(!box)return;const rows=periodCompareSortedDoctorRows();
  const desktop=`<div class="table-wrap desktop-table period-doctor-table-wrap"><table class="period-doctor-table"><thead><tr><th>#</th><th>الدكتور</th><th>الحالة</th><th>KPI سابق</th><th>KPI جديد</th><th>Δ KPI</th><th>صافي سابق</th><th>صافي جديد</th><th>Δ الصافي</th><th>مبيعات/يوم سابق</th><th>مبيعات/يوم جديد</th><th>Δ اليومي</th><th>متوسط فاتورة سابق</th><th>متوسط فاتورة جديد</th><th>فواتير/يوم سابق</th><th>فواتير/يوم جديد</th><th>مؤشر التحسن</th><th></th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${i+1}</td><td class="doctor-compare-name"><strong>${esc(r.doctor)}</strong></td><td>${periodCompareDoctorStatusBadge(r)}</td><td>${r.previous?doctorKpiValue(r.previous.kpi_score):'—'}</td><td>${r.current?doctorKpiValue(r.current.kpi_score):'—'}</td><td>${periodCompareGrowthBadge(r,'kpi_score')}</td><td class="money">${r.previous?money(r.previous.net_sales):'—'}</td><td class="money">${r.current?money(r.current.net_sales):'—'}</td><td>${periodCompareGrowthBadge(r,'net_sales')}</td><td class="money">${r.previous?money(r.previous.daily_average):'—'}</td><td class="money">${r.current?money(r.current.daily_average):'—'}</td><td>${periodCompareGrowthBadge(r,'daily_average')}</td><td class="money">${r.previous?money(r.previous.average_invoice):'—'}</td><td class="money">${r.current?money(r.current.average_invoice):'—'}</td><td>${r.previous?doctorCompareFormat(r.previous.invoices_per_active_day,'num2'):'—'}</td><td>${r.current?doctorCompareFormat(r.current.invoices_per_active_day,'num2'):'—'}</td><td>${r.improvement_score===null?'—':`<strong class="${r.improvement_score>=0?'period-positive':'period-negative'}">${r.improvement_score>=0?'+':''}${r.improvement_score.toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1})}%</strong>`}</td><td><button class="btn btn-soft btn-sm" data-period-doctor="${esc(r.doctor_key)}">التفاصيل</button></td></tr>`).join('')}</tbody></table></div>`;
  const mobile=`<div class="mobile-list period-doctor-mobile">${rows.map(r=>`<div class="item-card"><div class="item-title"><span>${esc(r.doctor)}</span>${periodCompareDoctorStatusBadge(r)}</div><div class="item-meta"><div><span>KPI السابقة → الجديدة</span><strong>${r.previous?doctorKpiValue(r.previous.kpi_score):'—'} → ${r.current?doctorKpiValue(r.current.kpi_score):'—'}</strong></div><div><span>تغير KPI</span><strong>${periodCompareGrowthBadge(r,'kpi_score')}</strong></div><div><span>صافي السابقة</span><strong>${r.previous?money(r.previous.net_sales):'—'}</strong></div><div><span>صافي الجديدة</span><strong>${r.current?money(r.current.net_sales):'—'}</strong></div><div><span>تغير مبيعات/يوم</span><strong>${periodCompareGrowthBadge(r,'daily_average')}</strong></div><div><span>تغير متوسط الفاتورة</span><strong>${periodCompareGrowthBadge(r,'average_invoice')}</strong></div><div><span>تغير فواتير/يوم</span><strong>${periodCompareGrowthBadge(r,'invoices_per_active_day')}</strong></div><div><span>مؤشر التحسن</span><strong class="${Number(r.improvement_score)>=0?'period-positive':'period-negative'}">${r.improvement_score===null?'—':`${r.improvement_score>=0?'+':''}${r.improvement_score.toFixed(1)}%`}</strong></div></div><button class="btn btn-soft doctor-sales-detail-btn" data-period-doctor="${esc(r.doctor_key)}">تفاصيل مقارنة الدكتور</button></div>`).join('')}</div>`;
  box.innerHTML=desktop+mobile;
  box.querySelectorAll('[data-period-doctor]').forEach(btn=>btn.onclick=()=>{state.periodCompareSelectedDoctor=btn.dataset.periodDoctor||'';state.periodCompareItemsExpanded=false;doctorPeriodComparisonView(document.getElementById('main'));});
}
function periodCompareMetricChangeCell(previous,current,metric){
  const p=previous?doctorCompareNumber(previous,metric.key):null,c=current?doctorCompareNumber(current,metric.key):null;
  const points=periodCompareIsPointMetric(metric.key);
  return `<tr><td><strong>${esc(metric.label)}</strong></td><td>${doctorCompareFormat(p,metric.format)}</td><td>${doctorCompareFormat(c,metric.format)}</td><td><span class="period-growth ${periodCompareChangeClass(p,c)}">${periodCompareChangeText(p,c,{points})}</span></td></tr>`;
}
function periodItemIdentity(item){
  const ref=String(item?.item_ref||'').trim();if(ref&&ref!=='0')return `ref:${ref}`;
  return `name:${String(item?.item_name||'').trim().toLowerCase()}`;
}
function periodCompareTopItems(previous,current){
  const map=new Map();
  (previous?.top_items||[]).slice(0,50).forEach((item,index)=>map.set(periodItemIdentity(item),{identity:periodItemIdentity(item),name:item.item_name,ref:item.item_ref,previous:item,current:null,previous_rank:index+1,current_rank:null}));
  (current?.top_items||[]).slice(0,50).forEach((item,index)=>{
    const key=periodItemIdentity(item),row=map.get(key)||{identity:key,name:item.item_name,ref:item.item_ref,previous:null,current:null,previous_rank:null,current_rank:null};
    row.current=item;row.current_rank=index+1;row.name=item.item_name||row.name;row.ref=item.item_ref||row.ref;map.set(key,row);
  });
  return [...map.values()].map(row=>{
    if(row.previous_rank&&row.current_rank){
      const delta=row.previous_rank-row.current_rank;
      row.status=delta>0?`صاعد +${delta}`:delta<0?`هابط ${delta}`:'ثابت';
      row.status_order=delta>0?1:delta<0?3:2;row.rank_delta=delta;
    }else if(row.current_rank){row.status='جديد في Top 50';row.status_order=0;row.rank_delta=999;}
    else{row.status='خرج من Top 50';row.status_order=4;row.rank_delta=-999;}
    return row;
  }).sort((a,b)=>a.status_order-b.status_order||(b.rank_delta-a.rank_delta)||(a.current_rank||999)-(b.current_rank||999)||(a.previous_rank||999)-(b.previous_rank||999));
}
function renderPeriodItemsTable(rows){
  if(!rows.length)return '<div class="empty">لا توجد أصناف للمقارنة.</div>';
  const visible=state.periodCompareItemsExpanded?rows:rows.slice(0,20);
  return `<div class="table-wrap desktop-table"><table class="period-items-table"><thead><tr><th>الصنف</th><th>ترتيب سابق</th><th>ترتيب جديد</th><th>الحركة</th><th>فواتير سابق</th><th>فواتير جديد</th><th>قيمة سابق</th><th>قيمة جديد</th></tr></thead><tbody>${visible.map(r=>`<tr><td class="name"><strong>${esc(r.name)}</strong>${r.ref?`<small>${esc(r.ref)}</small>`:''}</td><td>${r.previous_rank||'—'}</td><td>${r.current_rank||'—'}</td><td><span class="period-item-status status-${r.status_order}">${esc(r.status)}</span></td><td>${r.previous?Number(r.previous.invoice_count||0).toLocaleString('en-US'):'—'}</td><td>${r.current?Number(r.current.invoice_count||0).toLocaleString('en-US'):'—'}</td><td class="money">${r.previous?money(r.previous.sales_value):'—'}</td><td class="money">${r.current?money(r.current.sales_value):'—'}</td></tr>`).join('')}</tbody></table></div>${rows.length>20?`<button class="btn btn-soft period-items-toggle" id="periodItemsToggle">${state.periodCompareItemsExpanded?'إخفاء وعرض أول 20':`إظهار الكل (${rows.length})`}</button>`:''}`;
}
function renderPeriodDoctorDetail(main,key){
  const previousData=state.periodComparePrevious,currentData=state.periodCompareCurrent,previous=periodCompareDoctorByKey(previousData,key),current=periodCompareDoctorByKey(currentData,key),name=current?.doctor||previous?.doctor||'الدكتور';
  const row=periodCompareDoctorRows().find(x=>x.doctor_key===key)||{previous,current,doctor:name,improvement_score:null};
  const topItems=periodCompareTopItems(previous,current);
  main.innerHTML=`<div class="page-head period-doctor-detail-head"><div><button class="btn btn-soft btn-sm" id="periodDoctorBack">← رجوع لمقارنة الفترات</button><h2>${esc(name)}</h2><div class="muted">${esc(periodComparePeriodLabel(previousData))} مقابل ${esc(periodComparePeriodLabel(currentData))}</div></div><div class="page-head-actions"><button class="btn btn-primary btn-sm" id="periodDoctorPdf">🧾 تصدير PDF</button></div></div>
  <div class="period-kpi-shift"><div><span>KPI الفترة السابقة</span><strong>${previous?doctorKpiValue(previous.kpi_score):'—'}</strong><small>${previous?esc(doctorKpiLabel(previous)):'—'}</small></div><div class="period-kpi-arrow">←</div><div><span>KPI الفترة الجديدة</span><strong>${current?doctorKpiValue(current.kpi_score):'—'}</strong><small>${current?esc(doctorKpiLabel(current)):'—'}</small></div><div class="period-kpi-delta ${previous&&current&&Number(current.kpi_score)>=Number(previous.kpi_score)?'period-positive':'period-negative'}">${previous&&current?periodCompareChangeText(previous.kpi_score,current.kpi_score,{points:true}):'—'}</div></div>
  <div class="period-detail-score"><span>مؤشر التحسن الإجمالي</span><strong class="${Number(row.improvement_score)>=0?'period-positive':'period-negative'}">${row.improvement_score===null?'—':`${row.improvement_score>=0?'+':''}${row.improvement_score.toFixed(1)}%`}</strong><small>متوسط تغير 4 مؤشرات إنتاجية؛ مستقل عن KPI النسبي للفريق.</small></div>
  <section class="panel"><div class="section-head"><div><h3>المؤشرات بالتفصيل</h3><div class="muted">السابقة مقابل الجديدة والفرق بينهما.</div></div></div><div class="table-wrap"><table class="period-detail-metrics"><thead><tr><th>المؤشر</th><th>الفترة السابقة</th><th>الفترة الجديدة</th><th>التغير</th></tr></thead><tbody>${DOCTOR_COMPARE_METRICS.map(m=>periodCompareMetricChangeCell(previous,current,m)).join('')}</tbody></table></div></section>
  <section class="panel period-items-panel"><div class="section-head"><div><h3>تغير Top 50 للأصناف</h3><div class="muted">نعرض الأصناف الجديدة، الصاعدة، الهابطة، والثابتة أو التي خرجت من Top 50.</div></div></div><div id="periodItemsComparison">${renderPeriodItemsTable(topItems)}</div></section>`;
  document.getElementById('periodDoctorBack').onclick=()=>{state.periodCompareSelectedDoctor='';state.periodCompareItemsExpanded=false;doctorPeriodComparisonView(main);};
  document.getElementById('periodDoctorPdf').onclick=()=>exportPeriodDoctorPdf(row);
  const toggle=document.getElementById('periodItemsToggle');if(toggle)toggle.onclick=()=>{state.periodCompareItemsExpanded=!state.periodCompareItemsExpanded;document.getElementById('periodItemsComparison').innerHTML=renderPeriodItemsTable(topItems);const again=document.getElementById('periodItemsToggle');if(again)again.onclick=()=>{state.periodCompareItemsExpanded=!state.periodCompareItemsExpanded;renderPeriodDoctorDetail(main,key);};};
}
function exportPeriodComparisonPdf(){
  const previous=state.periodComparePrevious,current=state.periodCompareCurrent;if(!previous||!current){toast('ارفع التقريرين أولًا.',true);return;}
  const rows=periodCompareSortedDoctorRows();
  const overall=PERIOD_COMPARE_OVERALL_METRICS.map(m=>{const p=periodCompareOverallValue(previous,m.key),c=periodCompareOverallValue(current,m.key);return `<tr><td class="name">${esc(m.label)}</td><td>${doctorCompareFormat(p,m.format)}</td><td>${doctorCompareFormat(c,m.format)}</td><td>${esc(periodCompareChangeText(p,c,{points:!!m.points}))}</td></tr>`;}).join('');
  const doctors=rows.map((r,i)=>`<tr><td>${i+1}</td><td class="name">${esc(r.doctor)}</td><td>${esc(r.status)}</td><td>${r.previous?doctorKpiValue(r.previous.kpi_score):'—'}</td><td>${r.current?doctorKpiValue(r.current.kpi_score):'—'}</td><td>${r.previous&&r.current?periodCompareChangeText(r.previous.kpi_score,r.current.kpi_score,{points:true}):'—'}</td><td class="money">${r.previous?money(r.previous.net_sales):'—'}</td><td class="money">${r.current?money(r.current.net_sales):'—'}</td><td>${r.previous&&r.current?periodCompareChangeText(r.previous.daily_average,r.current.daily_average):'—'}</td><td>${r.previous&&r.current?periodCompareChangeText(r.previous.average_invoice,r.current.average_invoice):'—'}</td><td>${r.previous&&r.current?periodCompareChangeText(r.previous.invoices_per_active_day,r.current.invoices_per_active_day):'—'}</td><td>${r.improvement_score===null?'—':`${r.improvement_score>=0?'+':''}${r.improvement_score.toFixed(1)}%`}</td></tr>`).join('');
  const body=`<section class="section"><h2 class="section-title">مقارنة الصيدلية ككل</h2><table><thead><tr><th>المؤشر</th><th>الفترة السابقة</th><th>الفترة الجديدة</th><th>التغير</th></tr></thead><tbody>${overall}</tbody></table><div class="note-box">مؤشر التحسن الإجمالي = متوسط تغير المبيعات/يوم، فواتير/يوم، متوسط الفاتورة وMedian. KPI منفصل ويقيس موقع الدكتور نسبيًا داخل فريق كل فترة؛ تغير KPI يظهر بالنقاط. مبيعات الآجل مستبعدة من الفترتين.</div></section><section class="section page-break"><h2 class="section-title">مقارنة كل الدكاترة</h2><table><thead><tr><th>#</th><th>الدكتور</th><th>الحالة</th><th>KPI سابق</th><th>KPI جديد</th><th>Δ KPI</th><th>صافي سابق</th><th>صافي جديد</th><th>Δ مبيعات/يوم</th><th>Δ متوسط فاتورة</th><th>Δ فواتير/يوم</th><th>مؤشر التحسن</th></tr></thead><tbody>${doctors}</tbody></table></section>`;
  openDoctorPdfPrintWindow({title:'مقارنة فترات مبيعات الدكاترة',subtitle:`السابقة: ${esc(periodComparePeriodLabel(previous))} | الجديدة: ${esc(periodComparePeriodLabel(current))}`,body,orientation:'landscape'});
}
function exportPeriodDoctorPdf(row){
  if(!row)return;const previous=row.previous,current=row.current,name=row.doctor||current?.doctor||previous?.doctor||'الدكتور',items=periodCompareTopItems(previous,current);
  const metricRows=DOCTOR_COMPARE_METRICS.map(m=>{const p=previous?doctorCompareNumber(previous,m.key):null,c=current?doctorCompareNumber(current,m.key):null,points=periodCompareIsPointMetric(m.key);return `<tr><td class="name">${esc(m.label)}</td><td>${doctorCompareFormat(p,m.format)}</td><td>${doctorCompareFormat(c,m.format)}</td><td>${esc(periodCompareChangeText(p,c,{points}))}</td></tr>`;}).join('');
  const itemRows=items.map((r,i)=>`<tr><td>${i+1}</td><td class="name">${esc(r.name)}</td><td>${r.previous_rank||'—'}</td><td>${r.current_rank||'—'}</td><td>${esc(r.status)}</td><td>${r.previous?doctorPdfNum(r.previous.invoice_count):'—'}</td><td>${r.current?doctorPdfNum(r.current.invoice_count):'—'}</td><td class="money">${r.previous?money(r.previous.sales_value):'—'}</td><td class="money">${r.current?money(r.current.sales_value):'—'}</td></tr>`).join('');
  const body=`<section class="section"><div class="cards"><div class="card"><div class="label">KPI الفترة السابقة</div><div class="value">${previous?doctorKpiValue(previous.kpi_score):'—'}</div></div><div class="card"><div class="label">KPI الفترة الجديدة</div><div class="value">${current?doctorKpiValue(current.kpi_score):'—'}</div></div><div class="card"><div class="label">تغير KPI</div><div class="value">${previous&&current?periodCompareChangeText(previous.kpi_score,current.kpi_score,{points:true}):'—'}</div></div><div class="card"><div class="label">مؤشر التحسن الإجمالي</div><div class="value">${row.improvement_score===null?'—':`${row.improvement_score>=0?'+':''}${row.improvement_score.toFixed(1)}%`}</div></div><div class="card"><div class="label">صافي الفترة السابقة</div><div class="value">${previous?money(previous.net_sales):'—'}</div></div><div class="card"><div class="label">صافي الفترة الجديدة</div><div class="value">${current?money(current.net_sales):'—'}</div></div><div class="card"><div class="label">الحالة</div><div class="value">${esc(row.status)}</div></div></div><h2 class="section-title">المؤشرات بالتفصيل</h2><table><thead><tr><th>المؤشر</th><th>السابقة</th><th>الجديدة</th><th>التغير</th></tr></thead><tbody>${metricRows}</tbody></table></section><section class="section page-break"><h2 class="section-title">تغير Top 50 للأصناف</h2><table><thead><tr><th>#</th><th>الصنف</th><th>ترتيب سابق</th><th>ترتيب جديد</th><th>الحركة</th><th>فواتير سابق</th><th>فواتير جديد</th><th>قيمة سابق</th><th>قيمة جديد</th></tr></thead><tbody>${itemRows}</tbody></table></section>`;
  openDoctorPdfPrintWindow({title:`مقارنة فترات - ${name}`,subtitle:`السابقة: ${esc(periodComparePeriodLabel(state.periodComparePrevious))} | الجديدة: ${esc(periodComparePeriodLabel(state.periodCompareCurrent))}`,body,orientation:'landscape'});
}

async function dashboardView(main){
  main.innerHTML=`<div class="page-head"><div><h2>الرئيسية</h2><div class="muted">نظرة سريعة على المديونيات الحالية</div></div></div>
  <section class="dashboard-filter-panel">
    <div class="dashboard-filters">
      <div class="field dashboard-filter-field"><label>الفرع</label><select class="select" id="dashboardBranch">${branchOptions(true,false)}</select></div>
      <div class="field dashboard-filter-field"><label>التصنيف</label><select class="select" id="dashboardCategory"><option value="">كل التصنيفات</option>${state.categories.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field dashboard-filter-field"><label>الفترة</label><select class="select" id="dashboardPeriod"><option value="all">كل الوقت</option><option value="this_month">هذا الشهر</option><option value="last_month">الشهر الماضي</option><option value="custom">فترة مخصصة</option></select></div>
    </div>
    <div class="dashboard-custom-dates hidden" id="dashboardCustomDates">
      <div class="field"><label>من تاريخ</label><input class="input" type="date" id="dashboardFromDate"></div>
      <div class="field"><label>إلى تاريخ</label><input class="input" type="date" id="dashboardToDate"></div>
    </div>
    <div class="dashboard-filter-summary" id="dashboardFilterSummary"></div>
  </section>
  <div id="dashboardResults"><div class="loading">جاري تحميل البيانات...</div></div>`;

  const branch=document.getElementById('dashboardBranch'),category=document.getElementById('dashboardCategory'),period=document.getElementById('dashboardPeriod'),from=document.getElementById('dashboardFromDate'),to=document.getElementById('dashboardToDate'),custom=document.getElementById('dashboardCustomDates');
  branch.value=state.dashboardBranchId||'';category.value=state.dashboardCategoryId||'';period.value=state.dashboardPeriod||'all';from.value=state.dashboardFromDate||'';to.value=state.dashboardToDate||'';
  const syncCustom=()=>custom.classList.toggle('hidden',period.value!=='custom');
  const refresh=async()=>{
    state.dashboardBranchId=branch.value;state.dashboardCategoryId=category.value;state.dashboardPeriod=period.value;state.dashboardFromDate=from.value;state.dashboardToDate=to.value;syncCustom();
    await refreshDashboardResults();
  };
  branch.onchange=refresh;category.onchange=refresh;period.onchange=refresh;from.onchange=refresh;to.onchange=refresh;syncCustom();await refreshDashboardResults();
}
function dashboardPeriodLabel(){return ({all:'كل الوقت',this_month:'هذا الشهر',last_month:'الشهر الماضي',custom:'الفترة المخصصة'})[state.dashboardPeriod||'all']||'كل الوقت';}
async function refreshDashboardResults(){
  const box=document.getElementById('dashboardResults');if(!box)return;box.innerHTML='<div class="loading">جاري تحديث الرئيسية...</div>';
  const q=new URLSearchParams();if(state.dashboardBranchId)q.set('branch_id',state.dashboardBranchId);if(state.dashboardCategoryId)q.set('category_id',state.dashboardCategoryId);q.set('period',state.dashboardPeriod||'all');if(state.dashboardPeriod==='custom'){if(state.dashboardFromDate)q.set('from_date',state.dashboardFromDate);if(state.dashboardToDate)q.set('to_date',state.dashboardToDate);}
  try{
    const data=await api(`/api/dashboard?${q.toString()}`),paymentLabel=dashboardPeriodLabel(),branch=state.branches.find(b=>b.id===state.dashboardBranchId),category=state.categories.find(c=>c.id===state.dashboardCategoryId),summary=document.getElementById('dashboardFilterSummary'),aging=data.aging||{};
    if(summary)summary.innerHTML=`<span>العرض الحالي:</span><strong>${esc(branch?.name||'كل الفروع')}</strong><span>·</span><strong>${esc(category?.name||'كل التصنيفات')}</strong><span>·</span><strong>${esc(paymentLabel)}</strong>${state.dashboardPeriod==='custom'&&(state.dashboardFromDate||state.dashboardToDate)?`<small>${esc(state.dashboardFromDate||'البداية')} ← ${esc(state.dashboardToDate||'اليوم')}</small>`:''}`;
    box.innerHTML=`<div class="cards">
      <div class="stat"><div class="label">إجمالي الفواتير</div><div class="value">${money(data.totals.invoiced)}</div></div>
      <div class="stat"><div class="label">إجمالي المسدد</div><div class="value">${money(data.totals.paid)}</div></div>
      <div class="stat"><div class="label">إجمالي المتبقي</div><div class="value">${money(data.totals.balance)}</div></div>
      <div class="stat"><div class="label">المتأخر</div><div class="value">${money(data.totals.overdue)}</div><div class="sub">حسب تاريخ الاستحقاق</div></div>
    </div>
    <section class="panel aging-panel"><div class="aging-head"><div><h3>أعمار الديون (Aging)</h3><div class="muted">الرصيد المتبقي الحالي — حسب تاريخ الاستحقاق، وإن لم يوجد فتاريخ الفاتورة. لا يتأثر بفلتر الفترة.</div></div><strong class="money aging-total">${money(aging.total||0)}</strong></div><div class="aging-grid">
      <div class="aging-card aging-current"><span>غير مستحق بعد</span><strong>${money(aging.not_due?.amount||0)}</strong><small>${aging.not_due?.count||0} فاتورة</small></div>
      <div class="aging-card"><span>0–30 يوم</span><strong>${money(aging.days_0_30?.amount||0)}</strong><small>${aging.days_0_30?.count||0} فاتورة</small></div>
      <div class="aging-card"><span>31–60 يوم</span><strong>${money(aging.days_31_60?.amount||0)}</strong><small>${aging.days_31_60?.count||0} فاتورة</small></div>
      <div class="aging-card aging-warning"><span>61–90 يوم</span><strong>${money(aging.days_61_90?.amount||0)}</strong><small>${aging.days_61_90?.count||0} فاتورة</small></div>
      <div class="aging-card aging-danger"><span>أكثر من 90 يوم</span><strong>${money(aging.days_90_plus?.amount||0)}</strong><small>${aging.days_90_plus?.count||0} فاتورة</small></div>
    </div></section>
    <div class="grid-2"><section class="panel"><h3>حالة الفواتير</h3><div class="mini-list">
      <div class="mini-row"><span>🔴 غير مسددة</span><strong>${data.counts.unpaid||0}</strong></div><div class="mini-row"><span>🟡 مسددة جزئيًا</span><strong>${data.counts.partial||0}</strong></div><div class="mini-row"><span>🟢 مسددة بالكامل</span><strong>${data.counts.paid||0}</strong></div>
      <div class="mini-row"><span>💵 نقدي — ${esc(paymentLabel)}</span><strong class="money">${money((data.period_payments||data.month_payments||{}).cash)}</strong></div><div class="mini-row"><span>🏦 مصرف — ${esc(paymentLabel)}</span><strong class="money">${money((data.period_payments||data.month_payments||{}).bank)}</strong></div></div></section>
      <section class="panel"><h3>أعلى الموردين مديونية</h3><div class="mini-list">${data.top_suppliers.length?data.top_suppliers.map(x=>`<div class="mini-row"><span>${esc(x.name)}</span><strong class="money">${money(x.balance)}</strong></div>`).join(''):'<div class="empty">لا توجد بيانات</div>'}</div></section></div>
    <section class="panel" style="margin-top:14px"><h3>المديونية حسب الفروع</h3><div class="mini-list">${data.branches.length?data.branches.map(x=>`<div class="mini-row"><span>${esc(x.name)}</span><strong class="money">${money(x.balance)}</strong></div>`).join(''):'<div class="empty">لا توجد بيانات</div>'}</div></section>`;
  }catch(e){box.innerHTML=`<div class="panel"><div class="empty">${esc(e.message)}</div></div>`;toast(e.message,true);}
}


async function itemsView(main){
  main.innerHTML=`<div class="page-head"><div><h2>حركة الأصناف</h2><div class="muted">قسم مستقل عن الموردين والفواتير والسدادات</div></div></div>
  <section class="items-module-banner"><strong>دليل الأصناف هو المرجع الأساسي</strong><span>الكود + اسم الصنف + وحدة البيع + عدد الفرط في العلبة</span></section>
  <div class="settings-tabs items-tabs"><button class="btn btn-ghost ${state.itemsTab==='catalog'?'active':''}" data-items-tab="catalog">دليل الأصناف</button><button class="btn btn-ghost ${state.itemsTab==='analysis'?'active':''}" data-items-tab="analysis">تحليل الحركة</button></div>
  <div id="itemsTabBox"></div>`;
  main.querySelectorAll('[data-items-tab]').forEach(b=>b.onclick=()=>{state.itemsTab=b.dataset.itemsTab;itemsView(main);});
  await renderItemsTab();
}

async function renderItemsTab(){
  const box=document.getElementById('itemsTabBox');if(!box)return;
  if(state.itemsTab==='analysis'){
    await renderMovementAnalysis(box);
    return;
  }
  state.itemCatalogShowAll=false;
  box.innerHTML=`<div class="page-head item-catalog-head"><div><h3>دليل الأصناف</h3><div class="muted" id="itemCount">جاري تحميل الأصناف...</div></div>${can('manage_item_catalog')?`<div class="page-head-actions"><button class="btn btn-danger" id="resetItemCatalog">حذف الدليل</button><button class="btn btn-soft" id="importItems">استيراد Excel</button><button class="btn btn-primary" id="addItem">+ صنف</button></div>`:''}</div>
  <div class="toolbar item-toolbar"><input class="input" id="itemSearch" value="${esc(state.itemCatalogSearch)}" placeholder="بحث سريع بالكود أو اسم الصنف..."><button class="btn btn-soft item-view-toggle" id="itemViewToggle" type="button" hidden>إظهار الكل</button></div>
  <div id="itemRows"><div class="loading">جاري تحميل أول 100 صنف...</div></div>`;
  const searchInput=document.getElementById('itemSearch');
  searchInput.oninput=()=>{state.itemCatalogSearch=searchInput.value;state.itemCatalogShowAll=false;clearTimeout(state.itemCatalogSearchTimer);state.itemCatalogSearchTimer=setTimeout(()=>loadItemCatalog(true),280);};
  document.getElementById('itemViewToggle').onclick=async()=>{state.itemCatalogShowAll=!state.itemCatalogShowAll;await loadItemCatalog(true);};
  if(can('manage_item_catalog')){document.getElementById('addItem').onclick=()=>itemModal();document.getElementById('importItems').onclick=()=>itemImportModal();document.getElementById('resetItemCatalog').onclick=()=>resetItemCatalogModal();}
  await loadItemCatalog(false);
}

async function loadItemCatalog(showLoading=false){
  const box=document.getElementById('itemRows');if(!box)return;
  const requestId=++state.itemCatalogRequestSeq;
  const q=(document.getElementById('itemSearch')?.value||state.itemCatalogSearch||'').trim();
  state.itemCatalogSearch=q;
  const limit=state.itemCatalogShowAll?30000:100;
  if(showLoading)box.innerHTML=`<div class="loading">${state.itemCatalogShowAll?'جاري تحميل كل الأصناف...':'جاري البحث...'}</div>`;
  try{
    const params=new URLSearchParams({limit:String(limit),with_meta:'true'});if(q)params.set('search',q);
    const data=await api(`/api/items?${params.toString()}`);
    if(requestId!==state.itemCatalogRequestSeq)return;
    state.items=Array.isArray(data)?data:(data.items||[]);
    state.itemCatalogTotal=Array.isArray(data)?state.items.length:Number(data.total||0);
    renderItemRows();
  }catch(e){if(requestId!==state.itemCatalogRequestSeq)return;box.innerHTML=`<div class="panel"><div class="empty">${esc(e.message)}</div></div>`;toast(e.message,true);}
}

function renderItemRows(){
  const box=document.getElementById('itemRows');if(!box)return;
  const rows=state.items;
  const q=(state.itemCatalogSearch||'').trim();
  const count=document.getElementById('itemCount');
  if(count)count.textContent=q?`عرض ${rows.length.toLocaleString('en-US')} من ${state.itemCatalogTotal.toLocaleString('en-US')} نتيجة`:`عرض ${rows.length.toLocaleString('en-US')} من ${state.itemCatalogTotal.toLocaleString('en-US')} صنف`;
  const toggle=document.getElementById('itemViewToggle');
  if(toggle){const hasMore=state.itemCatalogTotal>100;toggle.hidden=!state.itemCatalogShowAll&&!hasMore;toggle.textContent=state.itemCatalogShowAll?'عرض 100 فقط':'إظهار الكل';}
  const actions=x=>can('manage_item_catalog')?`<div class="actions"><button class="btn btn-ghost btn-sm" data-item-edit="${x.id}">تعديل</button><button class="btn btn-danger btn-sm" data-item-delete="${x.id}">حذف</button></div>`:'';
  box.innerHTML=rows.length?`<div class="table-wrap desktop-table"><table><thead><tr><th>الكود</th><th>اسم الصنف</th><th>وحدة البيع</th><th>فرط / علبة</th>${can('manage_item_catalog')?'<th>إجراءات</th>':''}</tr></thead><tbody>${rows.map(x=>`<tr><td><strong>${esc(x.item_code)}</strong></td><td>${esc(x.item_name)}</td><td>${esc(x.package_form||'—')}</td><td><strong>${Number(x.units_per_box||0).toLocaleString('en-US')}</strong></td>${can('manage_item_catalog')?`<td>${actions(x)}</td>`:''}</tr>`).join('')}</tbody></table></div>
  <div class="mobile-list">${rows.map(x=>`<div class="item-card"><div class="item-title"><span>${esc(x.item_name)}</span><strong>${esc(x.item_code)}</strong></div><div class="item-meta"><div><span>وحدة البيع</span>${esc(x.package_form||'—')}</div><div><span>فرط / علبة</span><strong>${Number(x.units_per_box||0).toLocaleString('en-US')}</strong></div></div>${can('manage_item_catalog')?`<div class="item-actions">${actions(x)}</div>`:''}</div>`).join('')}</div>`:'<div class="panel"><div class="empty">لا توجد أصناف مطابقة</div></div>';
  box.querySelectorAll('[data-item-edit]').forEach(b=>b.onclick=()=>itemModal(state.items.find(x=>x.id===b.dataset.itemEdit)));
  box.querySelectorAll('[data-item-delete]').forEach(b=>b.onclick=async()=>{if(!confirmAction('حذف الصنف من دليل الأصناف؟'))return;try{await api(`/api/items/${b.dataset.itemDelete}`,{method:'DELETE'});toast('تم حذف الصنف');await loadItemCatalog(false);}catch(e){toast(e.message,true);}});
}


function movementNumber(v,digits=2){const n=Number(v);if(!Number.isFinite(n))return '—';return n.toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits});}
function movementPeriod(r){return `${esc(r.period_start||'')} ← ${esc(r.period_end||'')}`;}
function movementMatchBadge(row){
  if(!row.item_id)return `<span class="movement-match unmatched">يحتاج مطابقة</span>`;
  const labels={exact:'مطابق تلقائيًا',alias:'مطابقة محفوظة',manual:'مطابق يدويًا'};
  return `<span class="movement-match matched">${esc(labels[row.matched_by]||'مطابق')}</span>`;
}
async function renderMovementAnalysis(box){
  box.innerHTML=`<div class="page-head movement-head"><div><h3>تحليل حركة الأصناف</h3><div class="muted">ارفع تقرير الحركة كما يخرج من منظومة البيع، والبرنامج يجمع المبيعات ويحوّل الفرط إلى علب.</div></div>${can('manage_item_catalog')?'<div class="page-head-actions"><button class="btn btn-primary" id="uploadMovementReport">+ رفع تقرير حركة</button></div>':''}</div>
  <section class="movement-filter-panel"><div class="movement-filters"><div class="field"><label>الفرع</label><select class="select" id="movementBranchFilter"><option value="">كل الفروع</option>${branchOptions(false,false)}</select></div><div class="field"><label>التقرير</label><select class="select" id="movementReportSelect"><option value="">جاري تحميل التقارير...</option></select></div><div class="field"><label>الحالة</label><select class="select" id="movementStatusFilter"><option value="all">كل الأصناف</option><option value="unmatched">تحتاج مطابقة</option><option value="blocking">غير محسوبة بسبب الفرط</option></select></div><div class="field"><label>ترتيب معدل البيع</label><select class="select" id="movementSortFilter"><option value="desc">الأعلى إلى الأقل</option><option value="asc">الأقل إلى الأعلى</option></select></div></div><div class="toolbar movement-search-toolbar"><input class="input" id="movementSearch" value="${esc(state.movementSearch)}" placeholder="بحث باسم الصنف أو الكود..."></div></section>
  <div id="movementAnalysisBox"><div class="loading">جاري تحميل تقارير الحركة...</div></div>`;
  const branch=document.getElementById('movementBranchFilter'),status=document.getElementById('movementStatusFilter'),sort=document.getElementById('movementSortFilter'),search=document.getElementById('movementSearch');
  branch.value=state.movementBranchId||'';status.value=state.movementStatus||'all';sort.value=state.movementSort||'desc';
  branch.onchange=async()=>{state.movementBranchId=branch.value;state.movementReportId='';await loadMovementReports();};
  status.onchange=()=>{state.movementStatus=status.value;renderMovementRows();};
  sort.onchange=()=>{state.movementSort=sort.value;renderMovementRows();};
  search.oninput=()=>{state.movementSearch=search.value;renderMovementRows();};
  if(can('manage_item_catalog'))document.getElementById('uploadMovementReport').onclick=()=>movementUploadModal();
  await loadMovementReports();
}
async function loadMovementReports(){
  const box=document.getElementById('movementAnalysisBox');if(box)box.innerHTML='<div class="loading">جاري تحميل تقارير الحركة...</div>';
  try{
    const q=new URLSearchParams();if(state.movementBranchId)q.set('branch_id',state.movementBranchId);
    state.movementReports=await api(`/api/item-movements/reports?${q.toString()}`)||[];
    const select=document.getElementById('movementReportSelect');if(!select)return;
    if(!state.movementReports.length){select.innerHTML='<option value="">لا توجد تقارير</option>';state.movementReportId='';state.movementReport=null;state.movementRows=[];if(box)box.innerHTML='<section class="panel"><div class="empty">لا يوجد تقرير حركة محفوظ. ارفع أول تقرير للفرع.</div></section>';return;}
    if(!state.movementReportId||!state.movementReports.some(r=>r.id===state.movementReportId))state.movementReportId=state.movementReports[0].id;
    select.innerHTML=state.movementReports.map(r=>`<option value="${r.id}">${esc((r.branches||{}).name||'فرع')} · ${esc(r.period_start)} → ${esc(r.period_end)}${Number(r.unresolved_count)>0?` · ${Number(r.unresolved_count)} تحتاج مطابقة`:''}</option>`).join('');
    select.value=state.movementReportId;select.onchange=async()=>{state.movementReportId=select.value;await loadMovementReportDetail();};
    await loadMovementReportDetail();
  }catch(e){if(box)box.innerHTML=`<section class="panel"><div class="empty">${esc(e.message)}</div></section>`;toast(e.message,true);}
}
async function loadMovementReportDetail(){
  const box=document.getElementById('movementAnalysisBox');if(!box||!state.movementReportId)return;
  box.innerHTML='<div class="loading">جاري تحليل التقرير...</div>';
  try{const data=await api(`/api/item-movements/reports/${state.movementReportId}`);state.movementReport=data.report||null;state.movementRows=data.rows||[];state.movementReport.total_equivalent_boxes=Number(data.total_equivalent_boxes||0);state.movementReport.blocking_count=Number(data.blocking_count||0);renderMovementRows();}catch(e){box.innerHTML=`<section class="panel"><div class="empty">${esc(e.message)}</div></section>`;toast(e.message,true);}
}
function movementFilteredSortedRows(){
  const q=(state.movementSearch||'').trim().toLowerCase(),status=state.movementStatus||'all';
  const rows=state.movementRows.filter(x=>{const cat=x.item_catalog||{};const text=`${x.report_name||''} ${cat.item_name||''} ${cat.item_code||''}`.toLowerCase();if(q&&!text.includes(q))return false;if(status==='unmatched'&&x.item_id)return false;if(status==='blocking'&&(x.item_id||Number(x.loose_sold||0)<=0))return false;return true;});
  const dir=(state.movementSort||'desc')==='asc'?1:-1;
  return [...rows].sort((a,b)=>{
    const aHas=a.daily_rate!==null&&a.daily_rate!==undefined&&a.daily_rate!==''&&Number.isFinite(Number(a.daily_rate));
    const bHas=b.daily_rate!==null&&b.daily_rate!==undefined&&b.daily_rate!==''&&Number.isFinite(Number(b.daily_rate));
    if(!aHas&&!bHas)return String(a.report_name||'').localeCompare(String(b.report_name||''),'ar',{sensitivity:'base'});
    if(!aHas)return 1;if(!bHas)return -1;
    const diff=(Number(a.daily_rate)-Number(b.daily_rate))*dir;
    return diff||String(a.report_name||'').localeCompare(String(b.report_name||''),'ar',{sensitivity:'base'});
  });
}
function movementStatusText(){return ({all:'كل الأصناف',unmatched:'تحتاج مطابقة',blocking:'غير محسوبة بسبب الفرط'})[state.movementStatus||'all']||'كل الأصناف';}
function exportMovementReportPdf(){
  const r=state.movementReport;if(!r)return;
  const rows=movementFilteredSortedRows();if(!rows.length){toast('لا توجد أصناف لتصديرها حسب الفلتر الحالي',true);return;}
  const branch=(r.branches||{}).name||'—',sortText=(state.movementSort||'desc')==='asc'?'الأقل إلى الأعلى':'الأعلى إلى الأقل';
  const popup=window.open('','_blank');if(!popup){toast('اسمح بالنوافذ المنبثقة لتصدير PDF',true);return;}
  const generated=new Date().toLocaleString('ar-LY');
  const exportedEquivalent=rows.reduce((sum,x)=>sum+Number(x.equivalent_boxes||0),0);
  const rowsHtml=rows.map(x=>{const cat=x.item_catalog||{};const name=x.report_name||cat.item_name||'—';return `<tr><td class="item-name"><strong>${esc(name)}</strong></td><td>${movementNumber(x.boxes_sold,2)}</td><td>${movementNumber(x.loose_sold,2)}</td><td>${movementNumber(x.equivalent_boxes,2)}</td><td class="rate">${movementNumber(x.daily_rate,3)}</td></tr>`;}).join('');
  popup.document.open();
  popup.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>تقرير حركة الأصناف - ${esc(branch)}</title><style>@page{size:A4 landscape;margin:9mm}*{box-sizing:border-box}body{font-family:Arial,Tahoma,sans-serif;color:#173b36;margin:0;background:#fff;direction:rtl}.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f6259;padding-bottom:8px;margin-bottom:10px}.head h1{margin:0 0 4px;font-size:20px;color:#0f6259}.meta{font-size:10px;line-height:1.8;color:#536a66}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:8px 0 10px}.card{border:1px solid #d7e2df;border-radius:8px;padding:7px;text-align:center}.card span{display:block;font-size:8px;color:#6e817d}.card strong{display:block;margin-top:2px;font-size:12px;color:#173b36}.filters{font-size:9px;background:#f3f8f7;border:1px solid #d7e2df;border-radius:7px;padding:6px 8px;margin-bottom:8px}table{width:100%;border-collapse:collapse;font-size:8px;table-layout:fixed}thead{display:table-header-group}th{background:#0f6259;color:#fff;font-weight:700;padding:5px 4px;border:1px solid #0d574f}td{padding:4px;border:1px solid #dce5e3;text-align:center;vertical-align:middle;word-break:break-word}tbody tr:nth-child(even){background:#f7faf9}.item-name{text-align:right;width:44%}.item-name strong{display:block}.rate{font-weight:700;color:#0f6259}.foot{font-size:8px;color:#75837f;margin-top:7px;display:flex;justify-content:space-between}.no-print{margin:10px 0;text-align:center}@media print{.no-print{display:none}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body><div class="head"><div><h1>تقرير حركة الأصناف</h1><div class="meta">الفرع: <strong>${esc(branch)}</strong><br>الفترة: ${esc(r.period_start)} → ${esc(r.period_end)} (${Number(r.days_count||0)} يوم)</div></div><div class="meta">Abdo Debts<br>تاريخ التصدير: ${esc(generated)}</div></div><div class="summary"><div class="card"><span>عدد الأصناف في التصدير</span><strong>${rows.length.toLocaleString('en-US')}</strong></div><div class="card"><span>حركات البيع</span><strong>${Number(r.transaction_count||0).toLocaleString('en-US')}</strong></div><div class="card"><span>إجمالي العلب في التصدير</span><strong>${movementNumber(exportedEquivalent,2)}</strong></div></div><div class="filters">الحالة: <strong>${esc(movementStatusText())}</strong> · ترتيب معدل البيع: <strong>${esc(sortText)}</strong>${state.movementSearch?` · البحث: <strong>${esc(state.movementSearch)}</strong>`:''}</div><table><thead><tr><th style="width:44%">الصنف</th><th>علب مباعة</th><th>فرط مباع</th><th>الإجمالي بالعلبة</th><th>معدل/يوم</th></tr></thead><tbody>${rowsHtml}</tbody></table><div class="foot"><span>معدل البيع اليومي = إجمالي العلب المكافئة ÷ عدد أيام التقرير</span><span>${rows.length.toLocaleString('en-US')} صنف</span></div><div class="no-print"><button id="movementPrintButton" style="font:inherit;padding:8px 18px;border:0;border-radius:8px;background:#0f6259;color:#fff;cursor:pointer">حفظ كـ PDF / طباعة</button></div></body></html>`);
  popup.document.close();
  const doPrint=()=>{try{popup.focus();popup.print();}catch{toast('تعذر فتح نافذة الطباعة',true);}};
  const printBtn=popup.document.getElementById('movementPrintButton');if(printBtn)printBtn.onclick=doPrint;
  setTimeout(doPrint,650);
}
function renderMovementRows(){
  const box=document.getElementById('movementAnalysisBox');if(!box||!state.movementReport)return;
  const r=state.movementReport,rows=movementFilteredSortedRows();
  const unresolved=Number(r.unresolved_count||0),blocking=Number(r.blocking_count||0),branch=(r.branches||{}).name||'';
  box.innerHTML=`<div class="movement-summary cards"><div class="stat"><div class="label">الفترة</div><div class="value movement-period-value">${esc(r.period_start)} → ${esc(r.period_end)}</div><div class="sub">${Number(r.days_count||0)} يوم</div></div><div class="stat"><div class="label">عدد الأصناف</div><div class="value">${Number(r.unique_item_count||0).toLocaleString('en-US')}</div><div class="sub">${Number(r.transaction_count||0).toLocaleString('en-US')} حركة بيع</div></div><div class="stat"><div class="label">إجمالي العلب المكافئة</div><div class="value">${movementNumber(r.total_equivalent_boxes,2)}</div><div class="sub">للأصناف المحسوبة</div></div><div class="stat ${unresolved?'movement-warning-stat':''}"><div class="label">تحتاج مطابقة</div><div class="value">${unresolved.toLocaleString('en-US')}</div><div class="sub">${blocking?`${blocking} منها تمنع حساب الفرط`:'كل المعدلات محسوبة'}</div></div></div>
  <section class="panel movement-report-info"><div><strong>${esc(branch)}</strong><span>${movementPeriod(r)}</span>${r.source_name?`<small>المصدر: ${esc(r.source_name)}</small>`:''}</div><div class="actions">${unresolved?`<button class="btn btn-soft btn-sm" id="showUnmatchedMovement">إظهار غير المطابق (${unresolved})</button>`:''}<button class="btn btn-soft btn-sm" id="exportMovementPdf">تصدير PDF</button>${can('manage_item_catalog')?`<button class="btn btn-danger btn-sm" id="deleteMovementReport">حذف التقرير</button>`:''}</div></section>
  <div class="movement-results-head"><span>عرض ${rows.length.toLocaleString('en-US')} من ${state.movementRows.length.toLocaleString('en-US')} صنف</span><small>معدل البيع = إجمالي العلب المكافئة ÷ ${Number(r.days_count||0)} يوم · ${state.movementSort==='asc'?'الأقل إلى الأعلى':'الأعلى إلى الأقل'}</small></div>
  ${rows.length?`<div class="table-wrap desktop-table"><table class="movement-table"><thead><tr><th>الصنف</th><th>علب</th><th>فرط</th><th>فرط/علبة</th><th>إجمالي بالعلب</th><th>معدل/يوم</th><th>المطابقة</th></tr></thead><tbody>${rows.map(x=>{const cat=x.item_catalog||{};return `<tr><td><strong>${esc(x.report_name)}</strong>${cat.item_name&&cat.item_name!==x.report_name?`<small>${esc(cat.item_name)}</small>`:''}${cat.item_code?`<small>كود: ${esc(cat.item_code)}</small>`:''}</td><td>${movementNumber(x.boxes_sold,2)}</td><td>${movementNumber(x.loose_sold,2)}</td><td>${x.units_per_box?Number(x.units_per_box).toLocaleString('en-US'):'—'}</td><td><strong>${movementNumber(x.equivalent_boxes,2)}</strong></td><td><strong class="movement-rate">${movementNumber(x.daily_rate,3)}</strong></td><td>${movementMatchBadge(x)}${!x.item_id&&can('manage_item_catalog')?`<div class="movement-row-actions"><button class="btn btn-ghost btn-sm movement-map-btn" data-map-movement="${x.id}">مطابقة</button><button class="btn btn-soft btn-sm" data-add-movement-catalog="${x.id}">+ إضافة للدليل</button></div>`:''}</td></tr>`}).join('')}</tbody></table></div>
  <div class="mobile-list">${rows.map(x=>{const cat=x.item_catalog||{};return `<div class="item-card movement-card"><div class="item-title"><span>${esc(x.report_name)}</span><strong>${movementNumber(x.daily_rate,3)}/يوم</strong></div>${cat.item_name?`<div class="muted movement-catalog-name">${esc(cat.item_name)}${cat.item_code?` · ${esc(cat.item_code)}`:''}</div>`:''}<div class="item-meta"><div><span>علب مباعة</span><b>${movementNumber(x.boxes_sold,2)}</b></div><div><span>فرط مبيوع</span><b>${movementNumber(x.loose_sold,2)}</b></div><div><span>فرط/علبة</span><b>${x.units_per_box?Number(x.units_per_box).toLocaleString('en-US'):'—'}</b></div><div><span>إجمالي بالعلب</span><b>${movementNumber(x.equivalent_boxes,2)}</b></div></div><div class="item-actions">${movementMatchBadge(x)}${!x.item_id&&can('manage_item_catalog')?`<button class="btn btn-ghost btn-sm" data-map-movement="${x.id}">مطابقة بصنف موجود</button><button class="btn btn-soft btn-sm" data-add-movement-catalog="${x.id}">+ إضافة إلى دليل الأصناف</button>`:''}</div></div>`}).join('')}</div>`:'<section class="panel"><div class="empty">لا توجد أصناف مطابقة للفلتر الحالي</div></section>'}`;
  document.getElementById('showUnmatchedMovement')?.addEventListener('click',()=>{state.movementStatus='unmatched';const s=document.getElementById('movementStatusFilter');if(s)s.value='unmatched';renderMovementRows();});
  document.getElementById('exportMovementPdf')?.addEventListener('click',exportMovementReportPdf);
  document.getElementById('deleteMovementReport')?.addEventListener('click',async()=>{if(!confirmAction('حذف تقرير الحركة الحالي؟'))return;try{await api(`/api/item-movements/reports/${r.id}`,{method:'DELETE'});toast('تم حذف تقرير الحركة');state.movementReportId='';await loadMovementReports();}catch(e){toast(e.message,true);}});
  box.querySelectorAll('[data-map-movement]').forEach(b=>b.onclick=()=>movementMapModal(state.movementRows.find(x=>x.id===b.dataset.mapMovement)));
  box.querySelectorAll('[data-add-movement-catalog]').forEach(b=>b.onclick=()=>movementAddToCatalogModal(state.movementRows.find(x=>x.id===b.dataset.addMovementCatalog)));
}
function movementUploadModal(){
  let preview=null;const wrap=showModal('رفع تقرير حركة الأصناف',`<form id="movementUploadForm" class="form-grid"><div class="field"><label>الفرع *</label><select class="select" name="branch_id" required><option value="">— اختر الفرع —</option>${branchOptions(false,false)}</select></div><div class="field"><label>تقرير الحركة *</label><input class="input" type="file" name="file" accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required><div class="hint">ارفع الملف كما يخرج من منظومة البيع بدون تعديل.</div></div><div class="full"><button class="btn btn-soft" id="previewMovementFile" type="button">قراءة التقرير</button></div></form><div id="movementPreviewBox"><div class="hint">بعد قراءة الملف سيظهر تاريخ التقرير وعدد الأصناف قبل الحفظ.</div></div>`,async()=>{
    const form=document.getElementById('movementUploadForm');if(!form.reportValidity())return false;if(!preview){toast('اضغط قراءة التقرير أولًا',true);return false;}const fd=new FormData(form);try{const data=await api('/api/item-movements/import',{method:'POST',body:fd});state.movementBranchId=String(fd.get('branch_id')||'');state.movementReportId=data.report_id;const branchFilter=document.getElementById('movementBranchFilter');if(branchFilter)branchFilter.value=state.movementBranchId;toast('تم حفظ تحليل حركة الأصناف');await loadMovementReports();return true;}catch(e){toast(e.message,true);return false;}
  },{saveText:'حفظ التحليل',large:true});
  const form=wrap.querySelector('#movementUploadForm'),previewBox=wrap.querySelector('#movementPreviewBox');if(state.movementBranchId)form.elements.branch_id.value=state.movementBranchId;const resetPreview=()=>{preview=null;previewBox.innerHTML='<div class="hint">اضغط قراءة التقرير للتأكد من الفترة وعدد الأصناف قبل الحفظ.</div>';};form.elements.branch_id.onchange=resetPreview;form.elements.file.onchange=resetPreview;
  wrap.querySelector('#previewMovementFile').onclick=async()=>{if(!form.reportValidity())return;const btn=wrap.querySelector('#previewMovementFile');btn.disabled=true;previewBox.innerHTML='<div class="loading">جاري قراءة تقرير الحركة...</div>';try{const fd=new FormData(form);preview=await api('/api/item-movements/preview',{method:'POST',body:fd});previewBox.innerHTML=`<div class="movement-preview-grid"><div><span>الفترة</span><strong>${esc(preview.period_start)} → ${esc(preview.period_end)}</strong></div><div><span>عدد الأيام</span><strong>${Number(preview.days_count)}</strong></div><div><span>حركات البيع</span><strong>${Number(preview.transaction_count).toLocaleString('en-US')}</strong></div><div><span>الأصناف</span><strong>${Number(preview.unique_item_count).toLocaleString('en-US')}</strong></div><div><span>تحتاج مطابقة</span><strong>${Number(preview.unresolved_count).toLocaleString('en-US')}</strong></div><div><span>تمنع حساب الفرط</span><strong>${Number(preview.blocking_count).toLocaleString('en-US')}</strong></div></div>${preview.source_name?`<div class="hint">اسم المصدر داخل التقرير: ${esc(preview.source_name)}</div>`:''}<div class="movement-preview-note">الأصناف المطابقة تُحسب تلقائيًا. غير المطابقة تُحفظ في قائمة للمطابقة مرة واحدة، وبعدها يتذكرها البرنامج في التقارير القادمة.</div>`;}catch(e){preview=null;previewBox.innerHTML=`<div class="empty">${esc(e.message)}</div>`;toast(e.message,true);}finally{btn.disabled=false;}};
}
function movementMapModal(row){
  if(!row)return;let selectedId='';let timer=null;const wrap=showModal('مطابقة صنف تقرير الحركة',`<div class="movement-map-source"><small>الاسم في تقرير البيع</small><strong>${esc(row.report_name)}</strong><span>${movementNumber(row.boxes_sold,2)} علبة + ${movementNumber(row.loose_sold,2)} فرط</span></div><div class="field"><label>ابحث في دليل الأصناف</label><input class="input" id="movementCatalogSearch" placeholder="اكتب جزءًا من الاسم أو الكود..."></div><div id="movementCatalogResults"><div class="hint">اكتب اسم الصنف الصحيح كما هو موجود في دليل الأصناف.</div></div>`,async()=>{if(!selectedId){toast('اختر الصنف الصحيح من دليل الأصناف',true);return false;}try{await api(`/api/item-movements/rows/${row.id}/map`,{method:'POST',body:JSON.stringify({item_id:selectedId})});toast('تم حفظ المطابقة وستُستخدم تلقائيًا في التقارير القادمة');await loadMovementReportDetail();return true;}catch(e){toast(e.message,true);return false;}},{saveText:'حفظ المطابقة',large:true});
  const input=wrap.querySelector('#movementCatalogSearch'),results=wrap.querySelector('#movementCatalogResults');
  const search=async()=>{const q=input.value.trim();selectedId='';if(!q){results.innerHTML='<div class="hint">اكتب جزءًا من الاسم أو الكود.</div>';return;}results.innerHTML='<div class="loading">جاري البحث...</div>';try{const params=new URLSearchParams({search:q,limit:'30',with_meta:'true'}),data=await api(`/api/items?${params}`),items=Array.isArray(data)?data:(data.items||[]);results.innerHTML=items.length?`<div class="movement-candidate-list">${items.map(x=>`<button type="button" class="movement-candidate" data-candidate="${x.id}"><span><strong>${esc(x.item_name)}</strong><small>${esc(x.item_code)}</small></span><b>${Number(x.units_per_box||0)} فرط/علبة</b></button>`).join('')}</div>`:'<div class="empty">لا توجد نتائج في دليل الأصناف</div>';results.querySelectorAll('[data-candidate]').forEach(btn=>btn.onclick=()=>{selectedId=btn.dataset.candidate;results.querySelectorAll('.movement-candidate').forEach(x=>x.classList.toggle('selected',x===btn));});}catch(e){results.innerHTML=`<div class="empty">${esc(e.message)}</div>`;}};
  input.oninput=()=>{clearTimeout(timer);timer=setTimeout(search,280);};
}

function movementAddToCatalogModal(row){
  if(!row)return;
  const defaultPack=Number(row.loose_sold||0)>0?'علبة / فرط':'علبة';
  const defaultUnits=Number(row.loose_sold||0)>0?'':'1';
  const wrap=showModal('إضافة صنف جديد إلى دليل الأصناف',`<div class="movement-map-source"><small>الاسم في تقرير الحركة</small><strong>${esc(row.report_name)}</strong><span>${movementNumber(row.boxes_sold,2)} علبة + ${movementNumber(row.loose_sold,2)} فرط</span></div><form id="movementAddCatalogForm" class="form-grid"><div class="field full"><label>اسم الصنف *</label><input class="input" name="item_name" required maxlength="240" value="${esc(row.report_name)}"></div><div class="field"><label>كود الصنف <small class="hint">(اختياري)</small></label><input class="input" name="item_code" maxlength="160" placeholder="اتركه فارغًا لإنشاء كود داخلي تلقائي"></div><div class="field"><label>وحدة البيع</label><input class="input" name="package_form" maxlength="120" value="${esc(defaultPack)}"></div><div class="field"><label>عدد الفرط في العلبة *</label><input class="input" type="number" name="units_per_box" min="1" max="100000" step="1" required value="${defaultUnits}" placeholder="مثال: 20"></div><div class="movement-preview-note full">الحفظ سيضيف الصنف إلى دليل الأصناف ويربطه بهذا التقرير فورًا. إذا كان الصنف موجودًا أصلًا باسم مختلف، استخدم «مطابقة بصنف موجود» بدل الإضافة لتجنب التكرار.</div></form>`,async()=>{const form=wrap.querySelector('#movementAddCatalogForm');if(!form.reportValidity())return false;const fd=new FormData(form);const payload={item_name:String(fd.get('item_name')||'').trim(),item_code:String(fd.get('item_code')||'').trim()||null,package_form:String(fd.get('package_form')||'').trim()||null,units_per_box:Number(fd.get('units_per_box'))};try{const result=await api(`/api/item-movements/rows/${row.id}/add-to-catalog`,{method:'POST',body:JSON.stringify(payload)});const code=result?.item?.item_code||'';toast(`تمت إضافة الصنف إلى الدليل وربطه بالتقرير${result?.generated_code&&code?` — الكود الداخلي: ${code}`:''}`);state.items=[];state.itemCatalogTotal=0;await loadMovementReportDetail();return true;}catch(e){toast(e.message,true);return false;}},{saveText:'إضافة وربط',large:true});
}


function shortageStatusBadge(row){
  const cls={out:'out',urgent:'urgent',soon:'soon',monitor:'monitor',sufficient:'sufficient',unmatched:'unmatched'}[row?.status]||'unmatched';
  return `<span class="shortage-status ${cls}">${esc(row?.status_label||'—')}</span>`;
}
function shortageMatchText(row){return ({code:'الكود',code_normalized:'الكود',name:'الاسم',unmatched:'غير مطابق'})[row?.matched_by]||'—';}
function shortageReportOption(r){const branch=(r.branches||{}).name||'فرع';return `${branch} — ${r.period_start||'—'} → ${r.period_end||'—'}`;}
async function loadShortageMovementReports(){
  const params=new URLSearchParams();if(state.shortagesBranchId)params.set('branch_id',state.shortagesBranchId);
  state.shortagesReports=await api(`/api/item-movements/reports${params.toString()?`?${params}`:''}`);
  if(!state.shortagesReports.some(r=>String(r.id)===String(state.shortagesMovementReportId))){
    const preferred=state.shortagesReports.find(r=>String(r.id)===String(state.movementReportId));
    state.shortagesMovementReportId=String(preferred?.id||state.shortagesReports[0]?.id||'');
  }
  const select=document.getElementById('shortagesMovementReport');
  if(select){
    select.innerHTML=state.shortagesReports.length?state.shortagesReports.map(r=>`<option value="${esc(r.id)}">${esc(shortageReportOption(r))}</option>`).join(''):'<option value="">لا توجد تقارير حركة محفوظة</option>';
    select.value=state.shortagesMovementReportId||'';
  }
  const analyze=document.getElementById('shortagesAnalyze');if(analyze)analyze.disabled=!state.shortagesMovementReportId;
}
function shortagesDraftFor(row){
  const key=String(row.movement_row_id||row.item_code||row.item_name||'');
  if(!state.shortagesDraft[key])state.shortagesDraft[key]={selected:Number(row.suggested_quantity||0)>0,qty:Number(row.suggested_quantity||0)};
  return state.shortagesDraft[key];
}
function shortageFilteredRows(){
  const analysis=state.shortagesAnalysis;if(!analysis)return [];
  const q=String(state.shortagesSearch||'').trim().toLocaleLowerCase('ar');
  let rows=[...(analysis.rows||[])];
  if(q)rows=rows.filter(x=>`${x.item_name||''} ${x.report_name||''} ${x.stock_name||''} ${x.item_code||''} ${x.barcode||''}`.toLocaleLowerCase('ar').includes(q));
  const status=state.shortagesStatus||'shortage';
  if(status==='shortage')rows=rows.filter(x=>x.status!=='unmatched'&&Number(x.suggested_quantity||0)>0);
  else if(status!=='all')rows=rows.filter(x=>x.status===status);
  const num=(x,k,missing=Number.POSITIVE_INFINITY)=>{const n=Number(x?.[k]);return Number.isFinite(n)?n:missing;};
  const sort=state.shortagesSort||'urgency';
  rows.sort((a,b)=>{
    if(sort==='daily_desc')return num(b,'daily_rate',0)-num(a,'daily_rate',0)||String(a.item_name||'').localeCompare(String(b.item_name||''),'ar');
    if(sort==='cover_asc')return num(a,'days_cover')-num(b,'days_cover')||num(b,'daily_rate',0)-num(a,'daily_rate',0);
    if(sort==='suggested_desc')return num(b,'suggested_quantity',0)-num(a,'suggested_quantity',0)||num(a,'days_cover')-num(b,'days_cover');
    if(sort==='stock_asc')return num(a,'stock_quantity')-num(b,'stock_quantity')||num(b,'daily_rate',0)-num(a,'daily_rate',0);
    return num(a,'priority_rank',99)-num(b,'priority_rank',99)||num(a,'days_cover')-num(b,'days_cover')||num(b,'daily_rate',0)-num(a,'daily_rate',0);
  });
  return rows;
}
function shortageSelectedRows(){
  if(!state.shortagesAnalysis)return [];
  return (state.shortagesAnalysis.rows||[]).map(row=>({row,draft:shortagesDraftFor(row)})).filter(x=>x.draft.selected&&Number(x.draft.qty||0)>0&&x.row.status!=='unmatched');
}
function shortageSyncDraftFromDom(box=document){
  box.querySelectorAll?.('[data-shortage-check]').forEach(el=>{if(el.offsetParent===null)return;const key=el.dataset.shortageCheck;if(state.shortagesDraft[key])state.shortagesDraft[key].selected=!!el.checked;});
  box.querySelectorAll?.('[data-shortage-qty]').forEach(el=>{if(el.offsetParent===null)return;const key=el.dataset.shortageQty;if(state.shortagesDraft[key])state.shortagesDraft[key].qty=Math.max(0,Math.ceil(Number(el.value||0)));});
}
function shortageCopyList(){
  shortageSyncDraftFromDom();
  const selected=shortageSelectedRows();if(!selected.length){toast('اختر صنفًا واحدًا على الأقل وحدد الكمية المطلوبة',true);return;}
  const analysis=state.shortagesAnalysis,period=analysis?.movement_report?`${analysis.movement_report.period_start} → ${analysis.movement_report.period_end}`:'—';
  const lines=[`النواقص المقترحة — تغطية ${Number(analysis?.target_days||0)} يوم`,`فترة الحركة: ${period}`,`تاريخ المخزون: ${analysis?.stock_report?.report_date||'—'}`,''];
  selected.forEach((x,i)=>lines.push(`${i+1}. ${x.row.item_name||x.row.report_name||'—'}${x.row.item_code?` [${x.row.item_code}]`:''} — ${Number(x.draft.qty||0)} علبة`));
  const text=lines.join('\n');
  const fallback=()=>{const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();try{document.execCommand('copy');toast(`تم نسخ ${selected.length} صنف`);}catch{toast('تعذر النسخ تلقائيًا',true);}ta.remove();};
  if(navigator.clipboard?.writeText)navigator.clipboard.writeText(text).then(()=>toast(`تم نسخ ${selected.length} صنف`)).catch(fallback);else fallback();
}
function shortageExportCsv(){
  shortageSyncDraftFromDom();
  const selected=shortageSelectedRows();if(!selected.length){toast('اختر أصناف النواقص أولًا',true);return;}
  const quote=v=>`"${String(v??'').replace(/"/g,'""')}"`;
  const rows=[['الكود','اسم الصنف','الرصيد الحالي','معدل البيع/يوم','أيام التغطية','الحالة','المقترح','الكمية المطلوبة']];
  selected.forEach(x=>rows.push([x.row.item_code||'',x.row.item_name||x.row.report_name||'',x.row.stock_quantity??'',x.row.daily_rate??'',x.row.days_cover??'',x.row.status_label||'',x.row.suggested_quantity??'',Number(x.draft.qty||0)]));
  const csv='\ufeff'+rows.map(r=>r.map(quote).join(',')).join('\r\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`shortages-${state.shortagesAnalysis?.stock_report?.report_date||isoToday()}.csv`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(`تم تصدير ${selected.length} صنف`);
}
function shortageSelectVisible(value){
  const box=document.getElementById('shortagesResults');if(!box)return;shortageSyncDraftFromDom(box);shortageFilteredRows().forEach(row=>{if(row.status==='unmatched')return;const draft=shortagesDraftFor(row);if(Number(draft.qty||0)>0)draft.selected=value;});renderShortageRows();
}
function renderShortageRows(){
  const box=document.getElementById('shortagesResults');if(!box||!state.shortagesAnalysis)return;
  const data=state.shortagesAnalysis,summary=data.summary||{},rows=shortageFilteredRows(),report=data.movement_report||{},stock=data.stock_report||{},branch=(report.branches||{}).name||'—';
  const matchedByText={code:'بالكود',code_normalized:'بالكود',name:'بالاسم'};
  const rowHtml=row=>{const key=String(row.movement_row_id||row.item_code||row.item_name||''),draft=shortagesDraftFor(row),canSelect=row.status!=='unmatched';return `<tr><td class="shortage-item"><strong>${esc(row.item_name||row.report_name||'—')}</strong>${row.item_code?`<small>كود: ${esc(row.item_code)}</small>`:''}${row.stock_name&&row.stock_name!==row.item_name?`<small>اسم المخزون: ${esc(row.stock_name)}</small>`:''}</td><td>${row.stock_quantity===null?'—':movementNumber(row.stock_quantity,2)}</td><td><strong>${movementNumber(row.daily_rate,3)}</strong></td><td>${row.days_cover===null?'—':movementNumber(row.days_cover,1)}</td><td>${shortageStatusBadge(row)}<small class="shortage-match-note">${esc(matchedByText[row.matched_by]||'يحتاج مطابقة')}</small></td><td>${row.suggested_quantity===null?'—':Number(row.suggested_quantity||0).toLocaleString('en-US')}</td><td>${canSelect?`<input class="input shortage-qty" type="number" min="0" step="1" value="${Number(draft.qty||0)}" data-shortage-qty="${esc(key)}">`:'—'}</td><td>${canSelect?`<input class="shortage-check" type="checkbox" ${draft.selected?'checked':''} data-shortage-check="${esc(key)}" aria-label="اختيار الصنف">`:'—'}</td></tr>`;};
  const cardHtml=row=>{const key=String(row.movement_row_id||row.item_code||row.item_name||''),draft=shortagesDraftFor(row),canSelect=row.status!=='unmatched';return `<div class="item-card shortage-card"><div class="item-title"><span>${esc(row.item_name||row.report_name||'—')}</span>${shortageStatusBadge(row)}</div>${row.item_code?`<div class="muted">كود: ${esc(row.item_code)} · المطابقة: ${esc(shortageMatchText(row))}</div>`:''}<div class="item-meta shortage-meta"><div><span>الرصيد</span><b>${row.stock_quantity===null?'—':movementNumber(row.stock_quantity,2)}</b></div><div><span>المعدل/يوم</span><b>${movementNumber(row.daily_rate,3)}</b></div><div><span>أيام التغطية</span><b>${row.days_cover===null?'—':movementNumber(row.days_cover,1)}</b></div><div><span>المقترح</span><b>${row.suggested_quantity===null?'—':Number(row.suggested_quantity||0).toLocaleString('en-US')}</b></div></div>${canSelect?`<div class="shortage-mobile-edit"><label><input class="shortage-check" type="checkbox" ${draft.selected?'checked':''} data-shortage-check="${esc(key)}"> إضافة للقائمة</label><div class="field"><label>الكمية المطلوبة</label><input class="input shortage-qty" type="number" min="0" step="1" value="${Number(draft.qty||0)}" data-shortage-qty="${esc(key)}"></div></div>`:`<div class="movement-preview-note">الصنف نشط في الحركة لكن لم تتم مطابقته مع تقرير المخزون، لذلك لم يحسب البرنامج كمية طلب تلقائية.</div>`}</div>`;};
  box.innerHTML=`<div class="shortage-summary cards"><div class="stat"><div class="label">النواقص المقترحة</div><div class="value">${Number(summary.shortage_count||0).toLocaleString('en-US')}</div><div class="sub">هدف تغطية ${Number(data.target_days||0)} يوم</div></div><div class="stat shortage-out-stat"><div class="label">نفد من المخزون</div><div class="value">${Number(summary.out_of_stock_count||0).toLocaleString('en-US')}</div><div class="sub">عنده حركة بيع</div></div><div class="stat shortage-urgent-stat"><div class="label">عاجل ≤ 7 أيام</div><div class="value">${Number(summary.urgent_count||0).toLocaleString('en-US')}</div><div class="sub">قبل الوصول للصفر</div></div><div class="stat"><div class="label">إجمالي المقترح</div><div class="value">${Number(summary.total_suggested_boxes||0).toLocaleString('en-US')}</div><div class="sub">علبة قبل التعديل اليدوي</div></div><div class="stat ${Number(summary.unmatched_stock_count||0)?'movement-warning-stat':''}"><div class="label">تحتاج مراجعة مطابقة</div><div class="value">${Number(summary.unmatched_stock_count||0).toLocaleString('en-US')}</div><div class="sub">غير موجودة بالمخزون بالكود/الاسم</div></div></div>
  <section class="panel shortage-source-info"><div><strong>${esc(branch)}</strong><span>حركة: ${esc(report.period_start||'—')} → ${esc(report.period_end||'—')} (${Number(report.days_count||0)} يوم)</span><span>المخزون: ${esc(stock.report_date||'تاريخ غير مقروء')} · ${Number(stock.stock_item_count||0).toLocaleString('en-US')} صنف</span></div><small>الكمية المقترحة = (معدل البيع اليومي × ${Number(data.target_days||0)} يوم) − الرصيد الحالي، ويتم التقريب لأعلى إلى علبة كاملة.</small></section>
  <section class="movement-filter-panel shortage-result-filters"><div class="shortage-filter-grid"><div class="field"><label>الحالة</label><select class="select" id="shortagesStatusFilter"><option value="shortage">النواقص فقط</option><option value="out">نفد</option><option value="urgent">عاجل ≤ 7 أيام</option><option value="soon">قريب ينقص 8–14</option><option value="monitor">يحتاج استكمال</option><option value="sufficient">كافي</option><option value="unmatched">تحتاج مطابقة</option><option value="all">كل الأصناف المحللة</option></select></div><div class="field"><label>الترتيب</label><select class="select" id="shortagesSortFilter"><option value="urgency">الأكثر إلحاحًا</option><option value="daily_desc">أعلى معدل بيع</option><option value="cover_asc">أقل أيام تغطية</option><option value="suggested_desc">أكبر كمية مقترحة</option><option value="stock_asc">أقل رصيد</option></select></div><div class="field shortage-search-field"><label>بحث</label><input class="input" id="shortagesSearch" value="${esc(state.shortagesSearch)}" placeholder="اسم الصنف أو الكود..."></div></div></section>
  <div class="shortage-actions"><div><button class="btn btn-soft btn-sm" id="shortageSelectAll">تحديد الظاهر</button><button class="btn btn-ghost btn-sm" id="shortageClearVisible">إلغاء تحديد الظاهر</button></div><div><button class="btn btn-soft btn-sm" id="shortageCopy">📋 نسخ النواقص</button><button class="btn btn-primary btn-sm" id="shortageCsv">تصدير CSV</button></div></div>
  <div class="movement-results-head"><span>عرض ${rows.length.toLocaleString('en-US')} صنف</span><small>تقدر تعدل «الكمية المطلوبة» يدويًا قبل النسخ أو التصدير.</small></div>
  ${rows.length?`<div class="table-wrap desktop-table"><table class="shortage-table"><thead><tr><th>الصنف</th><th>الرصيد</th><th>معدل/يوم</th><th>أيام التغطية</th><th>الحالة</th><th>المقترح</th><th>المطلوب</th><th>✓</th></tr></thead><tbody>${rows.map(rowHtml).join('')}</tbody></table></div><div class="mobile-list">${rows.map(cardHtml).join('')}</div>`:'<section class="panel"><div class="empty">لا توجد أصناف مطابقة للفلتر الحالي</div></section>'}`;
  const status=document.getElementById('shortagesStatusFilter'),sort=document.getElementById('shortagesSortFilter'),search=document.getElementById('shortagesSearch');status.value=state.shortagesStatus||'shortage';sort.value=state.shortagesSort||'urgency';
  status.onchange=()=>{shortageSyncDraftFromDom(box);state.shortagesStatus=status.value;renderShortageRows();};sort.onchange=()=>{shortageSyncDraftFromDom(box);state.shortagesSort=sort.value;renderShortageRows();};let shortageSearchTimer=null;search.oninput=()=>{shortageSyncDraftFromDom(box);state.shortagesSearch=search.value;clearTimeout(shortageSearchTimer);shortageSearchTimer=setTimeout(()=>renderShortageRows(),280);};
  box.querySelectorAll('[data-shortage-check]').forEach(el=>el.onchange=()=>{const key=el.dataset.shortageCheck;if(state.shortagesDraft[key])state.shortagesDraft[key].selected=el.checked;});
  box.querySelectorAll('[data-shortage-qty]').forEach(el=>el.onchange=()=>{const key=el.dataset.shortageQty;if(state.shortagesDraft[key]){state.shortagesDraft[key].qty=Math.max(0,Math.ceil(Number(el.value||0)));el.value=state.shortagesDraft[key].qty;}});
  document.getElementById('shortageSelectAll').onclick=()=>shortageSelectVisible(true);document.getElementById('shortageClearVisible').onclick=()=>shortageSelectVisible(false);document.getElementById('shortageCopy').onclick=shortageCopyList;document.getElementById('shortageCsv').onclick=shortageExportCsv;
}
async function analyzeShortages(){
  const reportId=String(document.getElementById('shortagesMovementReport')?.value||state.shortagesMovementReportId||''),target=Math.max(1,Math.min(180,Math.round(Number(document.getElementById('shortagesTargetDays')?.value||state.shortagesTargetDays||14))));
  if(!reportId){toast('اختر تقرير حركة أولًا',true);return;}if(!state.shortagesFile){toast('ارفع تقرير المخزون المتوفر أولًا',true);return;}
  state.shortagesMovementReportId=reportId;state.shortagesTargetDays=target;const btn=document.getElementById('shortagesAnalyze'),box=document.getElementById('shortagesResults');btn.disabled=true;btn.textContent='جاري التحليل...';box.innerHTML='<div class="loading">جاري ربط الحركة بالمخزون وحساب النواقص...</div>';
  try{const fd=new FormData();fd.append('movement_report_id',reportId);fd.append('target_days',String(target));fd.append('file',state.shortagesFile);const data=await api('/api/shortages/analyze',{method:'POST',body:fd});state.shortagesAnalysis=data;state.shortagesDraft={};(data.rows||[]).forEach(row=>{const key=String(row.movement_row_id||row.item_code||row.item_name||'');state.shortagesDraft[key]={selected:Number(row.suggested_quantity||0)>0,qty:Number(row.suggested_quantity||0)};});renderShortageRows();toast(`تم اقتراح ${Number(data.summary?.shortage_count||0).toLocaleString('en-US')} صنف ناقص`);}catch(e){box.innerHTML=`<section class="panel"><div class="empty">${esc(e.message)}</div></section>`;toast(e.message,true);}finally{btn.disabled=false;btn.textContent=state.shortagesAnalysis?'إعادة تحليل النواقص':'تحليل النواقص';}
}
async function shortagesView(main){
  main.innerHTML=`<div class="page-head shortages-head"><div><h2>📦 النواقص المقترحة</h2><div class="muted">اربط تقرير حركة الأصناف بتقرير المخزون المتوفر، والبرنامج يقترح شن تحتاج تطلب حسب معدل البيع.</div></div><div class="page-head-actions"><button class="btn btn-soft" id="shortagesOpenMovement">فتح تحليل الحركة</button></div></div>
  <section class="panel shortage-setup"><div class="shortage-how"><strong>طريقة الحساب</strong><span>معدل البيع من تقرير الحركة + الرصيد الحالي من تقرير المخزون = أيام التغطية والكمية المقترحة.</span></div><div class="shortage-setup-grid"><div class="field"><label>الفرع</label><select class="select" id="shortagesBranch"><option value="">كل الفروع</option>${branchOptions(false,false)}</select></div><div class="field shortage-report-field"><label>تقرير الحركة *</label><select class="select" id="shortagesMovementReport"><option value="">جاري تحميل التقارير...</option></select></div><div class="field"><label>تقرير المخزون المتوفر *</label><input class="input" id="shortagesStockFile" type="file" accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"><div class="hint" id="shortagesFileName">${state.shortagesFileName?`الملف الحالي: ${esc(state.shortagesFileName)}`:'ارفع التقرير كما يخرج من منظومة المخزون بدون تعديل.'}</div></div><div class="field"><label>التغطية المستهدفة (يوم) *</label><input class="input" id="shortagesTargetDays" type="number" min="1" max="180" step="1" value="${Number(state.shortagesTargetDays||14)}"><div class="shortage-presets"><button type="button" data-days="7">7</button><button type="button" data-days="14">14</button><button type="button" data-days="21">21</button><button type="button" data-days="30">30</button></div></div></div><div class="shortage-analyze-row"><button class="btn btn-primary" id="shortagesAnalyze">${state.shortagesAnalysis?'إعادة تحليل النواقص':'تحليل النواقص'}</button><span class="hint">مثال: لو تختار 14 يوم، البرنامج يكمل رصيد كل صنف متحرك حتى يكفي تقريبًا 14 يوم.</span></div></section>
  <div id="shortagesResults">${state.shortagesAnalysis?'<div class="loading">جاري عرض آخر تحليل...</div>':'<section class="panel"><div class="empty">اختر تقرير حركة، ارفع المخزون الحالي، وحدد مدة التغطية ثم اضغط «تحليل النواقص».</div></section>'}</div>`;
  const branch=document.getElementById('shortagesBranch'),report=document.getElementById('shortagesMovementReport'),file=document.getElementById('shortagesStockFile'),target=document.getElementById('shortagesTargetDays');branch.value=state.shortagesBranchId||'';
  branch.onchange=async()=>{state.shortagesBranchId=branch.value;state.shortagesMovementReportId='';await loadShortageMovementReports();};report.onchange=()=>{state.shortagesMovementReportId=report.value;};file.onchange=()=>{state.shortagesFile=file.files?.[0]||null;state.shortagesFileName=state.shortagesFile?.name||'';document.getElementById('shortagesFileName').textContent=state.shortagesFileName?`الملف الحالي: ${state.shortagesFileName}`:'ارفع التقرير كما يخرج من منظومة المخزون بدون تعديل.';};target.onchange=()=>{const n=Math.max(1,Math.min(180,Math.round(Number(target.value||14))));target.value=n;state.shortagesTargetDays=n;};
  main.querySelectorAll('[data-days]').forEach(b=>b.onclick=()=>{target.value=b.dataset.days;state.shortagesTargetDays=Number(b.dataset.days);});document.getElementById('shortagesAnalyze').onclick=analyzeShortages;document.getElementById('shortagesOpenMovement').onclick=()=>{state.itemsTab='analysis';go('items');};
  try{await loadShortageMovementReports();if(state.shortagesAnalysis)renderShortageRows();}catch(e){document.getElementById('shortagesResults').innerHTML=`<section class="panel"><div class="empty">${esc(e.message)}</div></section>`;toast(e.message,true);}
}

function resetItemCatalogModal(){
  const modal=showModal('حذف دليل الأصناف بالكامل',`<div class="catalog-reset-warning"><strong>هذه العملية تحذف دليل الأصناف الحالي بالكامل.</strong><p>تقارير حركة الأصناف القديمة لن تُحذف، لكن المطابقات المرتبطة بالدليل القديم ستُلغى. بعد الحذف يمكنك استيراد دليل أصناف جديد مباشرة.</p></div><div class="field"><label>للتأكيد اكتب: <b>حذف الدليل</b></label><input class="input" id="catalogResetConfirm" autocomplete="off" placeholder="حذف الدليل"></div>`,async()=>{
    const confirmation=String(modal.querySelector('#catalogResetConfirm')?.value||'').trim();
    if(confirmation!=='حذف الدليل'){toast('اكتب عبارة حذف الدليل كما هي للتأكيد',true);return false;}
    try{
      const result=await api('/api/items/catalog/reset',{method:'POST',body:JSON.stringify({confirmation})});
      state.items=[];state.itemCatalogTotal=0;state.itemCatalogSearch='';state.itemCatalogShowAll=false;
      toast(`تم حذف ${Number(result?.deleted_items||0).toLocaleString('en-US')} صنف من الدليل`);
      await renderItemsTab();
      return true;
    }catch(e){toast(e.message,true);return false;}
  },{saveText:'حذف الدليل بالكامل'});
}

function itemModal(item=null){
  showModal(`${item?'تعديل':'إضافة'} صنف`,`<form id="itemForm" class="form-grid"><div class="field"><label>كود الصنف *</label><input class="input" name="item_code" required maxlength="160" value="${esc(item?.item_code||'')}"></div><div class="field"><label>اسم الصنف *</label><input class="input" name="item_name" required maxlength="240" value="${esc(item?.item_name||'')}"></div><div class="field"><label>وحدة البيع</label><input class="input" name="package_form" maxlength="120" value="${esc(item?.package_form||'')}" placeholder="مثال: علبة / فرط"></div><div class="field"><label>عدد الفرط في العلبة *</label><input class="input" type="number" name="units_per_box" min="1" step="1" required value="${esc(item?.units_per_box||'')}"></div></form>`,async()=>{const f=document.getElementById('itemForm');if(!f.reportValidity())return false;const fd=new FormData(f);const payload={item_code:String(fd.get('item_code')||'').trim(),item_name:String(fd.get('item_name')||'').trim(),package_form:String(fd.get('package_form')||'').trim()||null,units_per_box:Number(fd.get('units_per_box'))};await api(item?`/api/items/${item.id}`:'/api/items',{method:item?'PUT':'POST',body:JSON.stringify(payload)});toast('تم حفظ الصنف');await renderItemsTab();return true;});
}

function excelColumnOptions(headers,selected=''){return `<option value="">— اختر العمود —</option>${headers.map((h,i)=>`<option value="${i+1}" ${String(selected)===String(i+1)?'selected':''}>${esc(h||`العمود ${i+1}`)}</option>`).join('')}`;}
function guessExcelColumn(headers,words){const normalized=headers.map(x=>String(x||'').trim().toLowerCase());const i=normalized.findIndex(h=>words.some(w=>h.includes(w)));return i>=0?String(i+1):'';}
function itemImportModal(){
  let preview=null;
  const modal=showModal('استيراد دليل الأصناف من Excel',`<div class="import-step"><div class="field"><label>ملف دليل الأصناف (.xls أو .xlsx)</label><input class="input" id="itemsExcelFile" type="file" accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></div><button class="btn btn-soft" id="previewItemsExcel" type="button">قراءة الملف</button><div class="hint"><b>الكود هو هوية الصنف.</b> إذا تكرر نفس الكود باسم جديد، يُحدّث الاسم الظاهر ويحفظ الاسم السابق كاسم بديل لنفس الصنف. وإذا كان الكود جديدًا يُضاف صنف جديد.</div></div><div id="itemsImportMap"></div>`,async()=>{
    const file=document.getElementById('itemsExcelFile')?.files?.[0];const form=document.getElementById('itemsImportMapping');if(!file||!preview||!form){toast('اقرأ ملف Excel وحدد الأعمدة أولًا',true);return false;}if(!form.reportValidity())return false;
    const fd=new FormData(form);const body=new FormData();body.append('file',file);body.append('sheet_name',fd.get('sheet_name'));body.append('header_row',fd.get('header_row'));body.append('code_column',fd.get('code_column'));body.append('name_column',fd.get('name_column'));body.append('units_column',fd.get('units_column'));if(fd.get('package_column'))body.append('package_column',fd.get('package_column'));
    const result=await api('/api/items/import',{method:'POST',body});const summary=[`${Number(result.new_items||0).toLocaleString('en-US')} صنف جديد`,`${Number(result.renamed_codes||0).toLocaleString('en-US')} تغير اسمه`,`${Number(result.aliases_added||0).toLocaleString('en-US')} اسم بديل محفوظ`];toast(`تم تحديث الدليل: ${summary.join(' — ')}${result.skipped?` — تم تجاهل ${result.skipped} صف`:''}`);if(result.alias_conflicts){toast(`تنبيه: ${result.alias_conflicts} اسم بديل متعارض لم يتم ربطه تلقائيًا`,true);}state.itemsTab='catalog';await renderItemsTab();return true;
  },{large:true,saveText:'استيراد الأصناف'});
  const previewBtn=modal.querySelector('#previewItemsExcel');
  previewBtn.onclick=async()=>{const file=modal.querySelector('#itemsExcelFile')?.files?.[0];if(!file){toast('اختر ملف Excel أولًا',true);return;}previewBtn.disabled=true;previewBtn.textContent='جاري قراءة الملف...';try{const body=new FormData();body.append('file',file);preview=await api('/api/items/import/preview',{method:'POST',body});renderItemImportMapping(modal,preview);}catch(e){toast(e.message,true);}finally{previewBtn.disabled=false;previewBtn.textContent='قراءة الملف';}};
}
function renderItemImportMapping(modal,preview){
  const box=modal.querySelector('#itemsImportMap');const sheets=preview.sheets||[];if(!sheets.length){box.innerHTML='<div class="empty">لم يتم العثور على أوراق داخل الملف</div>';return;}
  const suggestedHeader=Number.isInteger(Number(preview.suggested_header_row))?Number(preview.suggested_header_row):1;
  box.innerHTML=`<form id="itemsImportMapping" class="import-map"><div class="form-grid"><div class="field"><label>ورقة Excel</label><select class="select" name="sheet_name">${sheets.map(s=>`<option value="${esc(s.name)}">${esc(s.name)}</option>`).join('')}</select></div><div class="field"><label>صف العناوين <small class="hint">(0 = الملف بدون عناوين)</small></label><input class="input" type="number" name="header_row" min="0" max="20" value="${suggestedHeader}" required></div></div><div id="itemsColumnMap"></div></form>`;
  const form=box.querySelector('#itemsImportMapping');const render=()=>{const sheet=sheets.find(s=>s.name===form.elements.sheet_name.value)||sheets[0];const rawNo=Number(form.elements.header_row.value);const rowNo=Number.isFinite(rawNo)?Math.max(0,Math.min(20,rawNo)):1;const maxCols=Math.max(1,...(sheet.rows||[]).map(r=>r.length));const headers=rowNo===0?Array.from({length:maxCols},(_,i)=>`العمود ${i+1}`):(sheet.rows?.[rowNo-1]||[]).map((x,i)=>x||`العمود ${i+1}`);const suggested=rowNo===0?(preview.suggested_columns||{}):{};const code=suggested.code?String(suggested.code):guessExcelColumn(headers,['كود','code','item code','barcode']);const name=suggested.name?String(suggested.name):guessExcelColumn(headers,['اسم الصنف','الصنف','item name','product','name']);const pack=suggested.package?String(suggested.package):guessExcelColumn(headers,['شكل التعبئة','التعبئة','package','pack']);const units=suggested.units?String(suggested.units):guessExcelColumn(headers,['فرط','وحدة','units per','pieces','piece','unit']);box.querySelector('#itemsColumnMap').innerHTML=`<div class="form-grid import-columns"><div class="field"><label>عمود كود الصنف *</label><select class="select" name="code_column" required>${excelColumnOptions(headers,code)}</select></div><div class="field"><label>عمود اسم الصنف *</label><select class="select" name="name_column" required>${excelColumnOptions(headers,name)}</select></div><div class="field"><label>عمود شكل التعبئة</label><select class="select" name="package_column">${excelColumnOptions(headers,pack)}</select></div><div class="field"><label>عمود عدد الفرط في العلبة *</label><select class="select" name="units_column" required>${excelColumnOptions(headers,units)}</select></div></div><div class="excel-preview"><small>${rowNo===0?'الملف بدون صف عناوين — تم ترقيم الأعمدة تلقائيًا':'معاينة صف العناوين'}</small><div>${headers.map((h,i)=>`<span><b>${i+1}</b>${esc(h)}</span>`).join('')}</div></div>`;};form.elements.sheet_name.onchange=render;form.elements.header_row.oninput=render;render();
}


function supplierAgingBadge(days){
  if(days===null||days===undefined||days==='')return '<span class="supplier-aging-empty">—</span>';
  const n=Math.max(0,Number(days)||0);
  const level=n>90?'danger':n>60?'warning':n>30?'watch':'fresh';
  return `<span class="supplier-aging-badge ${level}" title="عمر أقدم فاتورة مفتوحة">${n.toLocaleString('en-US')} يوم</span>`;
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
  box.innerHTML=`<div class="table-wrap desktop-table"><table><thead><tr><th>المورد</th><th>التصنيفات</th><th>المتبقي</th><th>Aging</th><th>الهاتف</th><th>ملاحظات</th><th></th></tr></thead><tbody>${rows.map(s=>`<tr><td><strong>${esc(s.name)}</strong></td><td>${categoryTags(s.categories)}</td><td class="money supplier-balance-cell">${money(s.balance)}</td><td>${supplierAgingBadge(s.aging_days)}</td><td>${esc(s.phone||'-')}</td><td>${esc(s.notes||'-')}</td><td><div class="actions">${actions(s)}</div></td></tr>`).join('')}</tbody></table></div><div class="mobile-list">${rows.map(s=>`<div class="item-card"><div class="item-title supplier-item-title"><div><span>${esc(s.name)}</span>${categoryTags(s.categories)}</div><div class="supplier-mobile-balance"><small>المتبقي</small><strong class="money">${money(s.balance)}</strong></div></div><div class="item-meta"><div><span>Aging · أقدم فاتورة مفتوحة</span>${supplierAgingBadge(s.aging_days)}</div><div><span>الهاتف</span>${esc(s.phone||'-')}</div><div><span>ملاحظات</span>${esc(s.notes||'-')}</div></div><div class="item-actions">${actions(s)}</div></div>`).join('')||'<div class="empty">لا توجد نتائج</div>'}</div>`;
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
 <div class="field"><label>رقم الفاتورة *</label><input class="input" name="invoice_number" required value="${esc(i?.invoice_number||'')}"><div class="hint">لا يمكن تكرار نفس رقم الفاتورة لنفس المورد.</div></div>
 <div class="field"><label>قيمة الفاتورة *</label><input class="input" name="amount" type="number" min="0.01" step="0.01" required value="${i?.amount??''}"></div>
 <div class="field"><label>تاريخ الفاتورة *</label><input class="input" name="invoice_date" type="date" required value="${i?.invoice_date||isoToday()}"></div>
 <div class="field"><label>تاريخ الاستحقاق <span class="muted">اختياري</span></label><input class="input" name="due_date" type="date" value="${i?.due_date||''}"></div>
 <div class="field full"><label>PDF الفاتورة <span class="muted">اختياري — حتى 10MB</span></label><input class="input" name="pdf" type="file" accept="application/pdf"></div>
 <div class="field full"><label>ملاحظات</label><textarea class="textarea" name="notes">${esc(i?.notes||'')}</textarea></div></form>`,async()=>{const f=document.getElementById('invoiceForm');if(!f.reportValidity())return false;const fd=new FormData(f);const payload={supplier_id:lockedSupplier||fd.get('supplier_id'),branch_id:fd.get('branch_id'),invoice_number:fd.get('invoice_number'),amount:Number(fd.get('amount')),invoice_date:fd.get('invoice_date'),due_date:fd.get('due_date')||null,notes:fd.get('notes')||null};const saved=await api(i?`/api/invoices/${i.id}`:'/api/invoices',{method:i?'PUT':'POST',body:JSON.stringify(payload)});const id=i?.id||saved.id;const file=fd.get('pdf');if(file&&file.size){const up=new FormData();up.append('file',file);await api(`/api/invoices/${id}/pdf`,{method:'POST',body:up});}toast('تم حفظ الفاتورة');if(!i)await loadNotifications(true);if(opts.onSaved)await opts.onSaved(saved);else if(state.view==='invoices')await invoicesView(document.getElementById('main'));return true;});
 const f=document.getElementById('invoiceForm');const supplierCombo=wireSupplierCombobox(initialSupplier,!!lockedSupplier);f.elements.branch_id.value=i?.branch_id||'';const quick=document.getElementById('quickSupplier');if(quick)quick.onclick=()=>supplierModal(null,s=>{supplierCombo?.setSupplier(s.id);});}


const PAYMENT_PLAN_STATUS_LABELS={planned:'مخطط',postponed:'مؤجل',overdue:'متأخر',due_today:'مستحق اليوم',completed:'تم السداد',cancelled:'ملغي'};
function paymentPlanStatusBadge(p){
  const st=p.display_status||p.status||'planned';
  const cls=st==='completed'?'badge-green':st==='cancelled'?'badge-red':st==='overdue'?'badge-red':st==='due_today'?'badge-amber':st==='postponed'?'badge-blue':'badge-green';
  let text=PAYMENT_PLAN_STATUS_LABELS[st]||st;
  if(st==='overdue'&&Number.isFinite(Number(p.days_to_due)))text+=` · ${Math.abs(Number(p.days_to_due))} يوم`;
  if((st==='planned'||st==='postponed')&&Number(p.days_to_due)>0)text+=` · بعد ${Number(p.days_to_due)} يوم`;
  return `<span class="badge ${cls}">${esc(text)}</span>`;
}
function paymentPlanSummary(rows){
  const out={overdue:0,due_today:0,next_7_days:0,later:0,open_total:0,open_count:0};
  rows.forEach(p=>{
    if(!['planned','postponed'].includes(p.status))return;
    const amount=Number(p.planned_amount||0);out.open_total+=amount;out.open_count++;
    if(p.display_status==='overdue')out.overdue+=amount;
    else if(p.display_status==='due_today')out.due_today+=amount;
    else if(Number(p.days_to_due)>0&&Number(p.days_to_due)<=7)out.next_7_days+=amount;
    else out.later+=amount;
  });return out;
}
function paymentPlanSummaryMarkup(rows){const d=paymentPlanSummary(rows);return `<div class="cards payment-plan-cards"><div class="stat plan-stat overdue"><div class="label">متأخر</div><div class="value">${money(d.overdue)}</div><div class="sub">مواعيد فات موعدها</div></div><div class="stat plan-stat today"><div class="label">مستحق اليوم</div><div class="value">${money(d.due_today)}</div><div class="sub">يحتاج إجراء اليوم</div></div><div class="stat plan-stat week"><div class="label">خلال 7 أيام</div><div class="value">${money(d.next_7_days)}</div><div class="sub">سيولة مطلوبة قريبًا</div></div><div class="stat plan-stat total"><div class="label">إجمالي المخطط المفتوح</div><div class="value">${money(d.open_total)}</div><div class="sub">${d.open_count} موعد مفتوح</div></div></div>`;}
async function paymentPlansView(main){
  if(!state.suppliers.length)state.suppliers=await api('/api/suppliers');
  const data=await api('/api/payment-plans');state.paymentPlans=data.items||[];
  main.innerHTML=`<div class="page-head"><div><h2>خطة السداد</h2><div class="muted">نظم مواعيد السداد واعرف المطلوب قبل موعده</div></div><div class="page-head-actions">${can('manage_payment_plans')?'<button class="btn btn-primary" id="addPaymentPlan">+ موعد سداد</button>':''}</div></div>
  <div id="paymentPlanSummary"></div>
  <section class="panel payment-plan-filter-panel"><div class="toolbar payment-plan-toolbar"><input class="input" id="paymentPlanSearch" placeholder="بحث باسم المورد..." value="${esc(state.paymentPlanSearch||'')}"><select class="select" id="paymentPlanBranch">${branchOptions(true,false)}</select><select class="select" id="paymentPlanStatus"><option value="open">المواعيد المفتوحة</option><option value="overdue">المتأخرة</option><option value="due_today">مستحقة اليوم</option><option value="upcoming">القادمة</option><option value="postponed">المؤجلة</option><option value="completed">تم السداد</option><option value="cancelled">الملغاة</option><option value="all">الكل</option></select></div></section><div id="paymentPlanRows"></div>`;
  const branch=document.getElementById('paymentPlanBranch'),status=document.getElementById('paymentPlanStatus'),search=document.getElementById('paymentPlanSearch');branch.value=state.paymentPlanBranchId||'';status.value=state.paymentPlanStatus||'open';
  if(can('manage_payment_plans'))document.getElementById('addPaymentPlan').onclick=()=>paymentPlanModal();
  const refresh=()=>{state.paymentPlanBranchId=branch.value;state.paymentPlanStatus=status.value;state.paymentPlanSearch=search.value;renderPaymentPlanRows();};branch.oninput=refresh;status.oninput=refresh;search.oninput=refresh;renderPaymentPlanRows();
}
function renderPaymentPlanRows(){
  const box=document.getElementById('paymentPlanRows'),summaryBox=document.getElementById('paymentPlanSummary');if(!box||!summaryBox)return;
  const bid=state.paymentPlanBranchId||'',q=(state.paymentPlanSearch||'').trim().toLowerCase(),filter=state.paymentPlanStatus||'open';
  const scope=state.paymentPlans.filter(p=>(!bid||p.branch_id===bid)&&(!q||(p.supplier_name||'').toLowerCase().includes(q)));
  summaryBox.innerHTML=paymentPlanSummaryMarkup(scope);
  const rows=scope.filter(p=>{if(filter==='all')return true;if(filter==='open')return ['planned','postponed'].includes(p.status);if(filter==='upcoming')return ['planned','postponed'].includes(p.status)&&Number(p.days_to_due)>0;if(filter==='postponed')return p.status==='postponed';return p.display_status===filter||p.status===filter;});
  const priority={overdue:0,due_today:1,postponed:2,planned:3,completed:4,cancelled:5};rows.sort((a,b)=>(priority[a.display_status]??9)-(priority[b.display_status]??9)||String(a.planned_date).localeCompare(String(b.planned_date)));
  const actions=p=>{const open=['planned','postponed'].includes(p.status);return `${open&&can('create_payments')&&can('manage_payment_plans')?`<button class="btn btn-primary btn-sm" data-plan-pay="${p.id}">تسجيل سداد</button>`:''}${open&&can('manage_payment_plans')?`<button class="btn btn-soft btn-sm" data-plan-postpone="${p.id}">تأجيل</button><button class="btn btn-ghost btn-sm" data-plan-edit="${p.id}">تعديل</button><button class="btn btn-danger btn-sm" data-plan-cancel="${p.id}">إلغاء</button>`:''}`;};
  const completedInfo=p=>p.status==='completed'&&p.actual_amount!=null?`<div class="plan-actual">الفعلي: <strong>${money(p.actual_amount)}</strong>${p.actual_payment_date?` · ${esc(p.actual_payment_date)}`:''}</div>`:'';
  box.innerHTML=`<div class="table-wrap desktop-table"><table><thead><tr><th>المورد</th><th>الفرع</th><th>المبلغ المخطط</th><th>الدين الحالي</th><th>موعد السداد</th><th>الحالة</th><th>ملاحظات</th><th></th></tr></thead><tbody>${rows.map(p=>`<tr><td><strong>${esc(p.supplier_name)}</strong>${Number(p.postpone_count)>0?`<div class="muted">تأجل ${Number(p.postpone_count)} مرة</div>`:''}</td><td>${esc(p.branch_name)}</td><td class="money">${money(p.planned_amount)}${completedInfo(p)}</td><td class="money">${money(p.current_balance)}</td><td><strong>${esc(p.planned_date)}</strong></td><td>${paymentPlanStatusBadge(p)}</td><td>${esc(p.notes||p.last_postpone_reason||'-')}</td><td><div class="actions">${actions(p)}</div></td></tr>`).join('')}</tbody></table></div><div class="mobile-list">${rows.map(p=>`<div class="item-card payment-plan-card"><div class="item-title"><span>${esc(p.supplier_name)}</span>${paymentPlanStatusBadge(p)}</div><div class="muted" style="margin-top:5px">${esc(p.branch_name)}</div><div class="item-meta"><div><span>المبلغ المخطط</span><b>${money(p.planned_amount)}</b>${completedInfo(p)}</div><div><span>موعد السداد</span><b>${esc(p.planned_date)}</b></div><div><span>الدين الحالي</span><b>${money(p.current_balance)}</b></div><div><span>مرات التأجيل</span>${Number(p.postpone_count||0)}</div></div>${p.notes?`<div class="plan-note">${esc(p.notes)}</div>`:''}<div class="item-actions">${actions(p)}</div></div>`).join('')||'<div class="empty">لا توجد مواعيد مطابقة</div>'}</div>`;
  box.querySelectorAll('[data-plan-edit]').forEach(b=>b.onclick=()=>paymentPlanModal(state.paymentPlans.find(p=>p.id===b.dataset.planEdit)));
  box.querySelectorAll('[data-plan-postpone]').forEach(b=>b.onclick=()=>paymentPlanPostponeModal(state.paymentPlans.find(p=>p.id===b.dataset.planPostpone)));
  box.querySelectorAll('[data-plan-cancel]').forEach(b=>b.onclick=async()=>{if(!confirmAction('إلغاء موعد السداد؟ سيبقى محفوظًا في السجل كموعد ملغي.'))return;try{await api(`/api/payment-plans/${b.dataset.planCancel}/cancel`,{method:'POST'});toast('تم إلغاء الموعد');await paymentPlansView(document.getElementById('main'));}catch(e){toast(e.message,true);}});
  box.querySelectorAll('[data-plan-pay]').forEach(b=>b.onclick=()=>{const p=state.paymentPlans.find(x=>x.id===b.dataset.planPay);if(!p)return;paymentModal(null,{supplierId:p.supplier_id,branchId:p.branch_id,plannedAmount:Number(p.planned_amount),onSaved:async saved=>{if(saved?.id){try{await api(`/api/payment-plans/${p.id}/complete`,{method:'POST',body:JSON.stringify({payment_id:saved.id})});toast('تم السداد وإغلاق الموعد');}catch(e){toast(`تم حفظ السداد لكن تعذر إغلاق الموعد: ${e.message}`,true);}}await paymentPlansView(document.getElementById('main'));}});});
}
function paymentPlanSupplierComboboxMarkup(selectedId=''){const selected=state.suppliers.find(s=>s.id===selectedId);return `<div class="supplier-combobox" id="paymentPlanSupplierCombo"><input type="hidden" name="supplier_id" id="planSupplier" value="${esc(selectedId)}"><div class="supplier-combobox-control"><input class="input supplier-combobox-input" id="planSupplierSearch" type="text" autocomplete="off" placeholder="ابحث باسم المورد..." value="${esc(selected?.name||'')}" required role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="planSupplierList"><button type="button" class="supplier-combobox-toggle" id="planSupplierToggle" aria-label="عرض كل الموردين">⌄</button></div><div class="supplier-combobox-menu hidden" id="planSupplierList" role="listbox"></div></div>`;}
function wirePaymentPlanSupplierCombobox(){const hidden=document.getElementById('planSupplier'),input=document.getElementById('planSupplierSearch'),toggle=document.getElementById('planSupplierToggle'),menu=document.getElementById('planSupplierList'),combo=document.getElementById('paymentPlanSupplierCombo');if(!hidden||!input||!menu||!combo)return null;let activeIndex=-1;const selectedName=()=>state.suppliers.find(s=>s.id===hidden.value)?.name||'';const validate=()=>input.setCustomValidity(hidden.value?'':'اختر المورد من القائمة');const filtered=(query='')=>{const q=query.trim().toLowerCase();return state.suppliers.filter(s=>!q||s.name.toLowerCase().includes(q));};const close=()=>{menu.classList.add('hidden');input.setAttribute('aria-expanded','false');activeIndex=-1;};const setSupplier=id=>{const s=state.suppliers.find(x=>x.id===id);if(!s)return;hidden.value=s.id;input.value=s.name;validate();close();input.focus();};const render=rows=>{menu.innerHTML=rows.length?rows.map((s,idx)=>`<button type="button" class="supplier-combobox-option${s.id===hidden.value?' selected':''}" data-plan-supplier-option="${s.id}" data-index="${idx}" role="option" aria-selected="${s.id===hidden.value?'true':'false'}"><span>${esc(s.name)}</span>${(s.categories||[]).length?`<small>${esc((s.categories||[]).map(c=>c.name).join(' · '))}</small>`:''}</button>`).join(''):'<div class="supplier-combobox-empty">لا يوجد مورد مطابق</div>';menu.classList.remove('hidden');input.setAttribute('aria-expanded','true');menu.querySelectorAll('[data-plan-supplier-option]').forEach(btn=>btn.onclick=()=>setSupplier(btn.dataset.planSupplierOption));};input.oninput=()=>{if(input.value!==selectedName())hidden.value='';validate();render(filtered(input.value));};input.onfocus=()=>{if(!hidden.value)render(filtered(input.value));};if(toggle)toggle.onclick=()=>{if(menu.classList.contains('hidden'))render(filtered(''));else close();};input.onkeydown=e=>{if(e.key==='Escape'){close();return;}const options=[...menu.querySelectorAll('[data-plan-supplier-option]')];if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(menu.classList.contains('hidden')){render(filtered(input.value));return;}if(!options.length)return;activeIndex=e.key==='ArrowDown'?Math.min(activeIndex+1,options.length-1):Math.max(activeIndex-1,0);options.forEach((x,i)=>x.classList.toggle('active',i===activeIndex));options[activeIndex]?.scrollIntoView({block:'nearest'});}else if(e.key==='Enter'&&!menu.classList.contains('hidden')&&activeIndex>=0){e.preventDefault();setSupplier(options[activeIndex].dataset.planSupplierOption);}};const outside=e=>{if(!combo.contains(e.target)){close();document.removeEventListener('pointerdown',outside,true);}};combo.addEventListener('pointerdown',()=>setTimeout(()=>document.addEventListener('pointerdown',outside,true),0),{once:true});validate();return {setSupplier};}
function paymentPlanModal(plan=null){
  const initialSupplier=plan?.supplier_id||'';
  showModal(`${plan?'تعديل':'إضافة'} موعد سداد`,`<form id="paymentPlanForm" class="form-grid"><div class="field"><label>المورد *</label>${paymentPlanSupplierComboboxMarkup(initialSupplier)}</div><div class="field"><label>الفرع *</label><select class="select" name="branch_id" required><option value="">اختر الفرع</option>${branchOptions(false)}</select></div><div class="field"><label>المبلغ المخطط *</label><input class="input" type="number" name="planned_amount" min="0.01" step="0.01" required value="${plan?.planned_amount??''}"></div><div class="field"><label>موعد السداد *</label><input class="input" type="date" name="planned_date" required value="${plan?.planned_date||isoToday()}"></div><div class="field full"><label>ملاحظات</label><textarea class="textarea" name="notes" placeholder="مثال: دفعة حسب الاتفاق مع الشركة">${esc(plan?.notes||'')}</textarea><div class="hint">النظام يمنع أن يتجاوز مجموع المبالغ المخططة الدين المتبقي للمورد في الفرع.</div></div></form>`,async()=>{const f=document.getElementById('paymentPlanForm');if(!f.reportValidity())return false;const fd=new FormData(f);const payload={supplier_id:fd.get('supplier_id'),branch_id:fd.get('branch_id'),planned_amount:Number(fd.get('planned_amount')),planned_date:fd.get('planned_date'),notes:fd.get('notes')||null};await api(plan?`/api/payment-plans/${plan.id}`:'/api/payment-plans',{method:plan?'PUT':'POST',body:JSON.stringify(payload)});toast('تم حفظ موعد السداد');await paymentPlansView(document.getElementById('main'));return true;});
  const f=document.getElementById('paymentPlanForm');f.elements.branch_id.value=plan?.branch_id||'';wirePaymentPlanSupplierCombobox();
}
function paymentPlanPostponeModal(plan){if(!plan)return;showModal('تأجيل موعد السداد',`<form id="postponePlanForm"><div class="field"><label>الموعد الحالي</label><input class="input" value="${esc(plan.planned_date)}" disabled></div><div class="field"><label>الموعد الجديد *</label><input class="input" type="date" name="planned_date" min="${isoToday()}" required></div><div class="field"><label>سبب التأجيل *</label><textarea class="textarea" name="reason" required minlength="2" placeholder="اكتب سبب التأجيل حتى نعرف سبب عدم الالتزام بالموعد"></textarea></div></form>`,async()=>{const f=document.getElementById('postponePlanForm');if(!f.reportValidity())return false;const fd=new FormData(f);await api(`/api/payment-plans/${plan.id}/postpone`,{method:'POST',body:JSON.stringify({planned_date:fd.get('planned_date'),reason:fd.get('reason')})});toast('تم تأجيل الموعد');await paymentPlansView(document.getElementById('main'));return true;});}

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
function paymentModal(p=null,opts={}){const lockedSupplier=opts.supplierId||'',lockedBranch=opts.branchId||'',plannedAmount=Number(opts.plannedAmount||0);showModal(`${p?'تعديل':'إضافة'} سداد`,`<form id="paymentForm" class="form-grid">
 <div class="field"><label>المورد *</label><select class="select" name="supplier_id" id="paySupplier" required>${supplierOptions()}</select></div><div class="field"><label>الفرع *</label><select class="select" name="branch_id" id="payBranch" required><option value="">اختر الفرع</option>${branchOptions(false)}</select></div>
 <div class="field"><label>تاريخ السداد *</label><input class="input" type="date" name="payment_date" required value="${p?.payment_date||isoToday()}"></div><div class="field"><label>طريقة السداد *</label><select class="select" name="method" id="payMethod"><option value="cash">نقدي</option><option value="bank">مصرف</option></select></div>
 <div class="field full hidden" id="bankField"><label>اسم المصرف *</label><input class="input" name="bank_name" value="${esc(p?.bank_name||'')}"></div><div class="field full"><label>ملاحظات</label><textarea class="textarea" name="notes">${esc(p?.notes||'')}</textarea></div>
 ${plannedAmount>0?`<div class="full plan-payment-target"><span>المبلغ المخطط لهذا الموعد</span><strong>${money(plannedAmount)}</strong><small>تم اقتراح التوزيع تلقائيًا على أقدم الفواتير ويمكنك تعديله قبل الحفظ.</small></div>`:''}
 <div class="full"><div style="display:flex;justify-content:space-between;align-items:center"><strong>توزيع السداد على الفواتير</strong><span class="hint">اختر الفواتير واكتب المبلغ لكل فاتورة</span></div><div id="allocationList" class="allocation-list"><div class="empty">اختر المورد والفرع</div></div><div class="sum-box"><span>إجمالي السداد</span><span id="paymentSum">0.00 د.ل</span></div></div></form>`,async()=>{const f=document.getElementById('paymentForm');if(!f.reportValidity())return false;const selected=[...document.querySelectorAll('.alloc-check:checked')];const allocations=selected.map(c=>({invoice_id:c.dataset.id,amount:Number(document.querySelector(`[data-amount="${c.dataset.id}"]`).value||0)})).filter(x=>x.amount>0);const amount=allocations.reduce((s,x)=>s+x.amount,0);if(!allocations.length){toast('اختر فاتورة واحدة على الأقل وحدد مبلغ السداد',true);return false;}const fd=new FormData(f);const payload={supplier_id:lockedSupplier||fd.get('supplier_id'),branch_id:lockedBranch||fd.get('branch_id'),amount:Number(amount.toFixed(2)),payment_date:fd.get('payment_date'),method:fd.get('method'),bank_name:fd.get('method')==='bank'?fd.get('bank_name'):null,notes:fd.get('notes')||null,allocations};const saved=await api(p?`/api/payments/${p.id}`:'/api/payments',{method:p?'PUT':'POST',body:JSON.stringify(payload)});toast('تم حفظ السداد');if(!p)await loadNotifications(true);if(opts.onSaved){try{await opts.onSaved(saved);}catch(e){toast(`تم حفظ السداد لكن تعذر تحديث العملية المرتبطة: ${e.message}`,true);}}else if(state.view==='payments')await paymentsView(document.getElementById('main'));return true;},{large:true});
 const f=document.getElementById('paymentForm'),supplier=f.elements.supplier_id,branch=f.elements.branch_id,method=f.elements.method;supplier.value=p?.supplier_id||lockedSupplier||'';if(lockedSupplier)supplier.disabled=true;branch.value=p?.branch_id||lockedBranch||'';if(lockedBranch)branch.disabled=true;method.value=p?.method||'cash';
 const toggleBank=()=>{const bank=document.getElementById('bankField');bank.classList.toggle('hidden',method.value!=='bank');f.elements.bank_name.required=method.value==='bank';};method.onchange=toggleBank;toggleBank();
 let old={};(p?.payment_allocations||[]).forEach(a=>old[a.invoice_id]=Number(a.amount));
 const load=async()=>{const sid=lockedSupplier||supplier.value,bid=lockedBranch||branch.value,box=document.getElementById('allocationList');if(!sid||!bid){box.innerHTML='<div class="empty">اختر المورد والفرع</div>';return;}box.innerHTML='<div class="loading">جاري تحميل الفواتير...</div>';try{const rows=await api(`/api/invoices?supplier_id=${encodeURIComponent(sid)}&branch_id=${encodeURIComponent(bid)}`);const available=rows.filter(i=>Number(i.balance)>0||old[i.id]);const suggested={};if(!p&&plannedAmount>0){let remaining=plannedAmount;[...available].sort((a,b)=>String(a.invoice_date).localeCompare(String(b.invoice_date))).forEach(i=>{if(remaining<=0)return;const max=Number(i.balance||0);const take=Math.min(max,remaining);if(take>0){suggested[i.id]=Number(take.toFixed(2));remaining=Number((remaining-take).toFixed(2));}});}box.innerHTML=available.length?available.map(i=>{const current=old[i.id]||suggested[i.id]||0;const max=Number(i.balance)+Number(old[i.id]||0);return `<label class="allocation-row"><input class="alloc-check" type="checkbox" data-id="${i.id}" ${current?'checked':''}><div class="desc"><strong>فاتورة ${esc(i.invoice_number)}</strong>المتبقي المتاح: ${money(max)} — ${esc(i.invoice_date)}</div><input class="input alloc-amount" data-amount="${i.id}" type="number" min="0" max="${max}" step="0.01" value="${current||''}" ${current?'':'disabled'}></label>`;}).join(''):'<div class="empty">لا توجد فواتير عليها رصيد لهذا المورد والفرع</div>';wireAllocations();}catch(e){box.innerHTML=`<div class="empty">${esc(e.message)}</div>`;}};
 const wireAllocations=()=>{document.querySelectorAll('.alloc-check').forEach(c=>c.onchange=()=>{const inp=document.querySelector(`[data-amount="${c.dataset.id}"]`);inp.disabled=!c.checked;if(!c.checked)inp.value='';updateSum();});document.querySelectorAll('.alloc-amount').forEach(i=>i.oninput=updateSum);updateSum();};
 const updateSum=()=>{const s=[...document.querySelectorAll('.alloc-check:checked')].reduce((sum,c)=>sum+Number(document.querySelector(`[data-amount="${c.dataset.id}"]`).value||0),0);document.getElementById('paymentSum').textContent=money(s);};supplier.onchange=load;branch.onchange=load;if(p||(lockedSupplier&&lockedBranch))load();}

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
