// ============================================================
//  Raises Lab OMS — app.js  Phase 1 FINAL
//  ・全通信JSONP方式（CORS完全回避）
//  ・ペイロード圧縮（不要フィールドを省いてURL長を削減）
//  ・ログイン含む全API統一
// ============================================================

const GAS_URL = 'https://script.google.com/macros/s/AKfycbyZCr5xU1nOmT4AcyWi7PyImHUy4TLWlfYTgHNH4SNElo1Trtl6iz23VTN1R2-4Z0-O/exec';

// ===== 状態 =====
let _token  = localStorage.getItem('rl_token') || null;
let _user   = JSON.parse(localStorage.getItem('rl_user') || 'null');
let _masters = { colors:[], sizes:[], partners:[], materials:[], factories:[], suppliers:[], customers:[] };
let _currentProduct = null;
let _currentFsTab   = 'product';
let _productPage    = 1;
let _materialRows   = [];
let _matColorCols   = 3; // デフォルト3列、最大7
let _productImages  = ['','','','','',''];
let _productColors  = Array(7).fill(null).map(()=>({code:'',name:''}));

const STATUS_LABELS = {
  draft:'下書き', sampling:'サンプル中', bulk_order:'資材発注',
  in_production:'生産中', completed:'完成', cancelled:'中止',
};
const ITEMS = [
  {code:'JK',name:'ジャケット'},{code:'PT',name:'パンツ'},{code:'OP',name:'ワンピース'},
  {code:'SK',name:'スカート'}, {code:'TS',name:'Tシャツ'},{code:'SH',name:'シャツ'},
  {code:'CT',name:'コート'},   {code:'KN',name:'ニット'}, {code:'BL',name:'ブルゾン'},
  {code:'CB',name:'カーディガン'},{code:'SW',name:'スウェット'},{code:'OT',name:'その他'},
];
const CATEGORIES = ['生地','裏地','芯地','副資材','下げ札等','その他'];
const UNITS = ['m','個','枚','本','組','式','yd','kg','g'];
const PROCESS_TYPES = ['縫製','裁断','プリント','刺繍','染色','整理加工','生地加工','検品','その他'];
const PROCESS_STATUS = {pending:'未着手', in_progress:'進行中', completed:'完了', cancelled:'中止'};

// タブキャッシュ・カラーキャッシュ
let _processRows = [];
let _orderLots   = [];
let _tabCache    = {};
let _matColorCache = {};

// ===== JSONP通信（全API共通） =====
function callGAS(payload) {
  return new Promise((resolve) => {
    const cb  = 'cb' + Date.now() + Math.floor(Math.random()*9999);
    const url = GAS_URL + '?payload=' + encodeURIComponent(JSON.stringify(payload)) + '&callback=' + cb;

    let done = false;
    const finish = (data) => {
      if (done) return;
      done = true;
      showLoading(false);
      delete window[cb];
      const el = document.getElementById('_s_' + cb);
      if (el) el.remove();
      resolve(data);
    };

    window[cb] = (data) => finish(data);

    const s = document.createElement('script');
    s.id  = '_s_' + cb;
    s.src = url;
    s.onerror = () => finish(null);
    setTimeout(() => finish(null), 30000);
    document.head.appendChild(s);
  });
}

async function api(action, body = {}) {
  showLoading(true);
  // 空文字・nullのフィールドは送らない（ペイロード削減）
  const clean = {};
  Object.keys(body).forEach(k => {
    if (body[k] !== '' && body[k] !== null && body[k] !== undefined) clean[k] = body[k];
  });
  const data = await callGAS({ action, token: _token, ...clean });
  if (!data) {
    toast('通信エラー。しばらく待って再試行してください。', 'error');
    return null;
  }
  if (!data.ok && data.error === 'UNAUTHORIZED') { forceLogout(); return null; }
  return data;
}

// ===== UI =====
function showLoading(v) {
  const el = document.getElementById('loading');
  if (el) el.classList.toggle('show', v);
}
function toast(msg, type='default') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function statusBadge(s) {
  return '<span class="badge badge-'+s+'">'+(STATUS_LABELS[s]||s)+'</span>';
}
function nokiCounter(d) {
  if (!d) return '';
  const days = Math.round((new Date(d)-new Date())/86400000);
  const cls  = days>30?'noki-green':days>=0?'noki-yellow':'noki-red';
  return '<span class="noki-counter '+cls+'">納期 '+days+'日</span>';
}

// ===== 認証 =====
function doLogin() {
  const username = (document.getElementById('l-user').value||'').trim();
  const password =  document.getElementById('l-pass').value||'';
  if (!username||!password) return;
  const errEl = document.getElementById('l-error');
  errEl.style.display = 'none';
  showLoading(true);

  const cb  = 'login' + Date.now();
  const url = GAS_URL + '?payload=' + encodeURIComponent(JSON.stringify({action:'login',username,password})) + '&callback=' + cb;
  let done  = false;

  window[cb] = (data) => {
    if (done) return; done = true;
    showLoading(false);
    delete window[cb];
    document.getElementById('_s_'+cb)?.remove();
    if (!data) { errEl.textContent='通信エラー'; errEl.style.display='block'; return; }
    if (data.ok) {
      _token = data.token; _user = data.user;
      localStorage.setItem('rl_token', _token);
      localStorage.setItem('rl_user', JSON.stringify(_user));
      bootApp();
    } else {
      errEl.textContent = data.error||'ログインに失敗しました';
      errEl.style.display = 'block';
    }
  };
  const s = document.createElement('script');
  s.id='_s_'+cb; s.src=url;
  s.onerror=()=>{ if(!done){done=true;showLoading(false);delete window[cb];s.remove();errEl.textContent='通信エラー';errEl.style.display='block';} };
  setTimeout(()=>{ if(!done){done=true;showLoading(false);delete window[cb];s.remove();errEl.textContent='タイムアウト';errEl.style.display='block';} },30000);
  document.head.appendChild(s);
}

async function doLogout() { await callGAS({action:'logout',token:_token}); forceLogout(); }
function forceLogout() {
  _token=null; _user=null;
  localStorage.removeItem('rl_token'); localStorage.removeItem('rl_user');
  document.getElementById('app').style.display='none';
  document.getElementById('login-screen').classList.add('show');
}

// ===== 起動 =====
// タブデータキャッシュ（重複取得防止）
function clearTabCache(style_code) { 
  Object.keys(_tabCache).forEach(k=>{ if(k.startsWith(style_code)) delete _tabCache[k]; });
}

async function bootApp() {
  document.getElementById('login-screen').classList.remove('show');
  document.getElementById('app').style.display='flex';
  document.getElementById('user-disp').textContent = _user?.display_name||_user?.username||'';

  // マスタを並列取得（GAS負荷を考慮して2段階に分ける）
  const tryLoad = async (action, key) => {
    try {
      const r = await api(action, {});
      if(r && r.ok) _masters[key] = r.items || [];
    } catch(e) { console.warn('Master load failed:', action); }
  };

  // 第1段階：必須マスタ（並列）
  await Promise.all([
    tryLoad('colors.list',    'colors'),
    tryLoad('sizes.list',     'sizes'),
    tryLoad('materials.list', 'materials'),
  ]);

  // 第2段階：パートナー系（並列）
  await Promise.all([
    tryLoad('partners.list',  'partners'),
    tryLoad('customers.list', 'customers'),
  ]);

  // 後方互換
  _masters.suppliers = _masters.partners.filter(p=>p.is_supplier===true||p.is_supplier==='TRUE');
  _masters.factories  = _masters.partners.filter(p=>p.is_factory===true||p.is_factory==='TRUE');

  showPage('products');
}

// ===== ページ切替 =====
function showPage(name) {
  document.querySelectorAll('#topbar nav button').forEach(b=>b.classList.remove('active'));
  const nb = document.getElementById('nav-'+name);
  if (nb) nb.classList.add('active');
  const main = document.getElementById('main');
  if (name==='products') renderProductsPage(main);
  if (name==='masters')  renderMastersPage(main);
}

// ===== 品番一覧 =====
let _searchTimer = null;
function renderProductsPage(main) {
  main.innerHTML = `
    <div class="page-header">
      <h1>品番一覧</h1>
      <div class="actions"><button class="btn btn-primary" onclick="openNewProductForm()">＋ 新規品番</button></div>
    </div>
    <div class="search-bar">
      <input type="text" id="s-q" placeholder="品番・品名・ブランドで検索..." oninput="triggerSearch()">
      <select id="s-status" onchange="loadProducts()">
        <option value="">全ステータス</option>
        ${Object.entries(STATUS_LABELS).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}
      </select>
      <select id="s-season" onchange="loadProducts()">
        <option value="">全シーズン</option>
        ${['26AW','26SS','25AW','25SS','27AW','27SS'].map(s=>`<option value="${s}">${s}</option>`).join('')}
      </select>
      <button class="btn btn-secondary btn-sm" onclick="clearSearch()">クリア</button>
    </div>
    <div id="product-grid-area"></div>
    <div id="pagination-area"></div>`;
  _productPage=1; loadProducts();
}
function triggerSearch() {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(()=>{ _productPage=1; loadProducts(); }, 350);
}
function clearSearch() {
  ['s-q','s-status','s-season'].forEach(id=>{ const e=document.getElementById(id); if(e) e.value=''; });
  _productPage=1; loadProducts();
}
async function loadProducts() {
  const q  = document.getElementById('s-q')?.value||'';
  const st = document.getElementById('s-status')?.value||'';
  const se = document.getElementById('s-season')?.value||'';
  const res = await api('products.list', {search:q,status:st,season:se,page:_productPage,per:24});
  const area = document.getElementById('product-grid-area');
  if (!area) return;
  if (!res || !res.items || res.items.length===0) {
    area.innerHTML='<div class="empty-state"><div class="icon">📦</div><p>品番が登録されていません</p><button class="btn btn-primary" style="margin-top:16px" onclick="openNewProductForm()">＋ 新規品番を登録</button></div>';
    const pa=document.getElementById('pagination-area'); if(pa) pa.innerHTML='';
    return;
  }
  area.innerHTML='<div class="product-grid">'+res.items.map(productCard).join('')+'</div>';
  renderPagination(res.total, _productPage, 24);
}
function productCard(p) {
  const img = p.image_url_1?`<img src="${esc(p.image_url_1)}" alt="" loading="lazy">`:'<div class="no-img">🧥</div>';
  return `<div class="product-card" onclick="openProduct('${esc(p.style_code)}')">
    <div class="thumb">${img}</div>
    <div class="body">
      <div class="style-code">${esc(p.style_code)}</div>
      <div class="brand-no">${esc(p.brand_product_no)||'（品番未設定）'}</div>
      <div class="name">${esc(p.product_name||'')}${p.brand?' / '+esc(p.brand):''}</div>
      <div class="meta">${statusBadge(p.status)}<span style="font-size:11px;color:var(--c-text2)">${esc(p.year||'')}${esc(p.season||'')}</span>${nokiCounter(p.delivery_date)}</div>
    </div></div>`;
}
function renderPagination(total, page, per) {
  const pages=Math.ceil(total/per);
  const area=document.getElementById('pagination-area');
  if (!area||pages<=1) { if(area) area.innerHTML=''; return; }
  let h='<div class="pagination">';
  h+=`<button onclick="goPage(${page-1})" ${page<=1?'disabled':''}>‹</button>`;
  for(let i=1;i<=pages;i++){
    if(pages>7&&Math.abs(i-page)>2&&i!==1&&i!==pages){if(i===2||i===pages-1)h+='<button disabled>…</button>';continue;}
    h+=`<button class="${i===page?'active':''}" onclick="goPage(${i})">${i}</button>`;
  }
  h+=`<button onclick="goPage(${page+1})" ${page>=pages?'disabled':''}>›</button></div>`;
  h+=`<div style="text-align:center;font-size:12px;color:var(--c-text3);margin-top:6px">${total}件</div>`;
  area.innerHTML=h;
}
function goPage(p) { _productPage=p; loadProducts(); }

// ===== 全画面モーダル =====
function openFull(title) {
  document.getElementById('fs-title').textContent=title;
  document.getElementById('fullscreen-modal').classList.add('show');
  document.body.style.overflow='hidden';
}
function closeFull() {
  document.getElementById('fullscreen-modal').classList.remove('show');
  document.body.style.overflow='';
  _currentProduct=null;
  _productImages=['','','','','',''];
  _productColors=Array(7).fill(null).map(()=>({code:'',name:''}));
  loadProducts();
}

// ===== 新規品番 =====
function openNewProductForm() {
  _currentProduct=null;
  _productImages=['','','','','',''];
  _productColors=Array(7).fill(null).map(()=>({code:'',name:''}));
  document.getElementById('fs-badge').innerHTML='';
  document.getElementById('fs-tabs').innerHTML='';
  document.getElementById('fs-actions').innerHTML='';
  document.getElementById('fs-footer').innerHTML=
    '<button class="btn btn-secondary" onclick="closeFull()">キャンセル</button>'+
    '<button class="btn btn-primary" onclick="saveNewProduct()">登録する</button>';
  document.getElementById('fs-body').innerHTML=renderProductForm(null);
  setupImagePaste();
  openFull('新規品番の登録');
}

// ===== 品番詳細を開く =====
async function openProduct(style_code) {
  const res = await api('products.get', {style_code});
  if (!res||!res.ok) { toast('取得に失敗しました','error'); return; }
  _currentProduct = res.item;
  _productImages  = [1,2,3,4,5,6].map(i=>res.item['image_url_'+i]||'');
  _productColors  = Array(7).fill(null).map((_,i)=>({
    code: res.item['product_color'+(i+1)+'_code']||'',
    name: res.item['product_color'+(i+1)+'_name']||'',
  }));
  _currentFsTab='product';
  _matColorCols = 3; // 品番を開くたびにリセット
  _matColorCache = {}; // カラーキャッシュもリセット
  Object.keys(_tabCache).forEach(k=>delete _tabCache[k]); // タブキャッシュリセット
  document.getElementById('fs-badge').innerHTML=statusBadge(res.item.status);
  document.getElementById('fs-tabs').innerHTML=
    '<button class="fs-tab active" id="fstab-product"    onclick="switchFsTab(\'product\')">📋 製品シート</button>'+
    '<button class="fs-tab"        id="fstab-materials"  onclick="switchFsTab(\'materials\')">🧵 資材シート</button>'+
    '<button class="fs-tab"        id="fstab-orderqty"   onclick="switchFsTab(\'orderqty\')">📋 製品発注書</button>'+
    '<button class="fs-tab"        id="fstab-processes"  onclick="switchFsTab(\'processes\')">🔧 工程</button>'+
    '<button class="fs-tab"        id="fstab-progress"   onclick="switchFsTab(\'progress\')">📈 生産進捗</button>'+
    '<button class="fs-tab"        id="fstab-cost"       onclick="switchFsTab(\'cost\')">💰 原価・見積</button>'+
    '<button class="fs-tab"        id="fstab-history"    onclick="switchFsTab(\'history\')">📜 発注履歴</button>';
  document.getElementById('fs-actions').innerHTML=
    '<button class="btn btn-secondary btn-sm" onclick="showPdfMenu()">📄 PDF出力 ▼</button>'+
    '<div id="pdf-menu" style="display:none;position:absolute;right:20px;top:52px;background:var(--c-surface);border:1px solid var(--c-border);border-radius:var(--radius);box-shadow:0 4px 12px rgba(0,0,0,.1);z-index:200;min-width:200px">'+
      '<button class="btn" style="display:block;width:100%;text-align:left;border:none;padding:10px 16px;border-radius:0" onclick="pdfSpec()">① 縫製仕様書_資材表</button>'+
      '<button class="btn" style="display:block;width:100%;text-align:left;border:none;padding:10px 16px;border-radius:0" onclick="pdfProductSheet()">② 製品情報シート（発注書兼用）</button>'+
      '<button class="btn" style="display:block;width:100%;text-align:left;border:none;padding:10px 16px;border-radius:0" onclick="pdfProcessOrder()">③ 加工発注書</button>'+
      '<button class="btn" style="display:block;width:100%;text-align:left;border:none;padding:10px 16px;border-radius:0" onclick="pdfProcessSheet()">④ 工程表</button>'+
    '</div>';
  document.getElementById('fs-footer').innerHTML=
    '<button class="btn btn-secondary" onclick="closeFull()">閉じる</button>'+
    '<button class="btn btn-primary"   onclick="saveFsTab()">保存する</button>';
  document.getElementById('fs-body').innerHTML=renderProductForm(_currentProduct);
  setupImagePaste();
  openFull(res.item.brand_product_no||res.item.style_code);
  // PDFメニューを閉じる
  document.addEventListener('click', closePdfMenu);
}

function showPdfMenu() {
  const m=document.getElementById('pdf-menu');
  if(m) m.style.display = m.style.display==='none' ? 'block' : 'none';
}
function closePdfMenu(e) {
  const m=document.getElementById('pdf-menu');
  if(m && !m.contains(e.target) && !e.target.textContent.includes('PDF出力')) {
    m.style.display='none';
  }
}

async function switchFsTab(tab) {
  // 資材シートは切り替え前に保存（内容があれば）
  if(_currentFsTab==='materials' && tab!=='materials' && _materialRows.some(r=>r.product_name||r.product_no)) await saveMaterialsData();
  _currentFsTab=tab;
  document.querySelectorAll('.fs-tab').forEach(t=>t.classList.remove('active'));
  const b=document.getElementById('fstab-'+tab); if(b) b.classList.add('active');

  const cacheKey = (_currentProduct?.style_code||'')+':'+tab;

  if(tab==='product') {
    document.getElementById('fs-body').innerHTML=renderProductForm(_currentProduct);
    setupImagePaste(); return;
  }
  // 履歴は常に最新取得
  if(tab==='history') { await renderHistoryTab(); return; }

  // キャッシュがあれば再描画しない（保存後はclearTabCacheで無効化）
  if(tab!=='materials' && _tabCache[cacheKey]) {
    document.getElementById('fs-body').innerHTML=_tabCache[cacheKey];
    return;
  }

  if(tab==='materials') await renderMaterialsTab();
  else if(tab==='orderqty')  await renderOrderLotsTab();
  else if(tab==='processes') await renderProcessesTab();
  else if(tab==='progress')  await renderProgressTab();
  else if(tab==='cost')      await renderCostTab();

  // 資材シート以外はキャッシュに保存
  if(tab!=='materials') _tabCache[cacheKey]=document.getElementById('fs-body')?.innerHTML||'';
}
async function saveFsTab() {
  if(_currentFsTab==='product')   await saveProductData();
  if(_currentFsTab==='materials') await saveMaterialsData();
  if(_currentFsTab==='orderqty')  await saveOrderLots();
  if(_currentFsTab==='processes') await saveProcesses();
  if(_currentFsTab==='progress')  await saveProgress();
  if(_currentFsTab==='cost')      await saveCostEstimate();
}

// ===== 製品フォーム =====
function renderProductForm(p) {
  const imgSlots = _productImages.map((url,i)=>
    `<div class="image-slot" id="imgslot-${i}" onclick="triggerImgUpload(${i})" ondragover="event.preventDefault()" ondrop="handleImgDrop(event,${i})">
      ${url?`<img id="imgprev-${i}" src="${esc(url)}" alt="">`:'<div class="img-placeholder">📷</div><div class="img-label">写真 '+(i+1)+'</div>'}
      <div class="img-overlay"><button class="btn btn-sm" style="background:#fff;color:#333;font-size:11px" onclick="event.stopPropagation();clearImg(${i})">削除</button></div>
      <input type="file" id="imgfile-${i}" accept="image/*" style="display:none" onchange="handleImgFile(event,${i})">
    </div>`
  ).join('');

  const supOpts = '<option value="">-- 選択 --</option>'+
    _masters.customers.map(c=>`<option value="${esc(c.customer_id||'')}" ${p?.client_id===c.customer_id?'selected':''}>${esc(c.customer_name)}${c.brand_name?' / '+esc(c.brand_name):''}</option>`).join('');

  // 加工場は partners から is_factory のものを使う（後方互換）
  const facList = _masters.factories.length ? _masters.factories :
    _masters.partners.filter(x=>x.is_factory===true||x.is_factory==='TRUE');
  const facName = (f) => f.factory_name||f.partner_name||'';
  const facOpts = '<option value="">-- 選択 --</option>'+
    facList.map(f=>`<option value="${esc(facName(f))}" ${p?.factory_name===facName(f)?'selected':''}>${esc(facName(f))}${f.process_type?' ('+esc(f.process_type)+')':f.category?' ('+esc(f.category)+')':''}</option>`).join('');

  const colorSelRows = _productColors.map((c,i)=>{
    const opts = '<option value="">-- 選択 --</option>'+
      _masters.colors.map(col=>`<option value="${esc(col.color_code)}" data-name="${esc(col.color_name_ja)}" ${c.code===col.color_code?'selected':''}>${esc(col.color_code)} ${esc(col.color_name_ja)}</option>`).join('');
    return `<div style="display:grid;grid-template-columns:24px 1fr;gap:5px;align-items:center;margin-bottom:5px">
      <div style="font-size:11px;font-weight:600;color:var(--c-text2);text-align:center">${i+1}</div>
      <select id="pc-sel-${i}" onchange="onColorSel(${i},this)" style="font-size:12px;padding:5px 8px">${opts}</select>
    </div>`;
  }).join('');

  return `<div style="display:grid;grid-template-columns:1fr 300px;gap:20px;align-items:start">
  <div>
    <div class="section-card"><h3>📦 基本情報</h3>
      <div class="form-row form-row-2">
        <div class="form-group"><label>お客様品番 ★</label><input type="text" id="f-brand-no" value="${esc(p?.brand_product_no||'')}" placeholder="例: K1709LJ046EK"></div>
        <div class="form-group"><label>仮品番</label><input type="text" id="f-temp-no" value="${esc(p?.temp_product_no||'')}"></div>
      </div>
      <div class="form-row form-row-2">
        <div class="form-group"><label>品名（日本語）</label><input type="text" id="f-name-ja" value="${esc(p?.product_name||'')}" placeholder="品名"></div>
        <div class="form-group"><label>品名（英語）</label><input type="text" id="f-name-en" value="${esc(p?.product_name_en||'')}"></div>
      </div>
      <div class="form-row form-row-2">
        <div class="form-group"><label>ブランド</label><input type="text" id="f-brand" value="${esc(p?.brand||'')}"></div>
        <div class="form-group"><label>取引先</label>
          ${_masters.customers.length > 0 ? `
          <input type="text" id="f-client-search" placeholder="取引先を絞り込み..." oninput="filterClientSel(this)" style="margin-bottom:4px;font-size:12px">
          <select id="f-client-sel" onchange="onClientSel(this)" style="width:100%">${supOpts}</select>
          <input type="hidden" id="f-client-id" value="${esc(p?.client_id||'')}">
          ` : `
          <input type="text" id="f-client-free" value="${esc(p?.client_name||p?.client_id||'')}" placeholder="取引先名（得意先マスタ登録後は選択式になります）">
          <input type="hidden" id="f-client-id" value="${esc(p?.client_id||'')}">
          <input type="hidden" id="f-client-sel" value="">
          <p style="font-size:10px;color:var(--c-text3);margin-top:4px">💡 マスタ管理→得意先から登録できます</p>
          `}
        </div>
      </div>
      <div class="form-row form-row-3">
        <div class="form-group"><label>アイテム</label>
          <select id="f-item">${ITEMS.map(i=>`<option value="${i.code}" ${p?.item_code===i.code?'selected':''}>${i.code} ${i.name}</option>`).join('')}</select>
        </div>
        <div class="form-group"><label>年度</label>
          <select id="f-year">${['2026','2027','2025'].map(y=>`<option value="${y.slice(-2)}" ${p?.year===y.slice(-2)?'selected':''}>${y}</option>`).join('')}</select>
        </div>
        <div class="form-group"><label>シーズン</label>
          <select id="f-season">${[['AW','秋冬'],['SS','春夏'],['HO','Holiday'],['RE','Resort'],['NS','通年']].map(([v,l])=>`<option value="${v}" ${p?.season===v?'selected':''}>${v} ${l}</option>`).join('')}</select>
        </div>
      </div>
      <div class="form-group"><label>サイズ展開</label>
        <div style="display:flex;gap:6px;align-items:center">
          <input type="text" id="f-size-range" value="${esc(p?.size_range||'')}" placeholder="クリックしてサイズを選択..." readonly style="cursor:pointer;flex:1" onclick="openSizePopup()">
          <button class="btn btn-secondary btn-sm" type="button" onclick="openSizePopup()">選択 📐</button>
        </div>
      </div>
      <div class="form-group"><label>🎨 製品カラー（Col.1〜7）</label>
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">
          <input type="text" id="f-color-display" value="${_productColors.filter(c=>c.code).map(c=>c.code+' '+c.name).join(' / ') || ''}" placeholder="クリックしてカラーを選択..." readonly style="cursor:pointer;flex:1" onclick="openColorPopup()">
          <button class="btn btn-secondary btn-sm" type="button" onclick="openColorPopup()">選択 🎨</button>
        </div>
        <div id="color-preview" style="display:flex;flex-wrap:wrap;gap:4px">
          ${_productColors.filter(c=>c.code).map((c,i)=>`
            <span style="display:inline-flex;align-items:center;gap:4px;background:var(--c-primary-bg);color:var(--c-primary);padding:2px 8px;border-radius:4px;font-size:12px">
              <span style="font-weight:600">Col.${_productColors.indexOf(c)+1}</span> ${esc(c.code)} ${esc(c.name)}
            </span>`).join('')}
        </div>
      </div>
      <div class="form-group"><label>原産国</label><input type="text" id="f-country" value="${esc(p?.country_of_origin||'')}"></div>
    </div>
    <div class="section-card" style="margin-top:16px"><h3>🏭 生産情報</h3>
      <div class="form-row form-row-2">
        <div class="form-group"><label>パタンナー</label><input type="text" id="f-patternmaker" value="${esc(p?.patternmaker||'')}"></div>
        <div class="form-group"><label>パターンNo.</label><input type="text" id="f-pattern-no" value="${esc(p?.pattern_no||'')}"></div>
      </div>
      <div class="form-row form-row-2">
        <div class="form-group"><label>サンプルNo.</label><input type="text" id="f-sample-no" value="${esc(p?.sample_no||'')}"></div>
        <div class="form-group"><label>縫製工場</label>
          ${facList.length > 0 ? `
          <input type="text" id="f-factory-search" placeholder="工場名で絞り込み..." oninput="filterFactory()" style="margin-bottom:4px">
          <select id="f-factory" style="width:100%;font-size:12px">
            <option value="">-- 選択 --</option>
            ${facList.map(f=>`<option value="${esc(facName(f))}" ${p?.factory_name===facName(f)?'selected':''}>${esc(facName(f))}${f.process_type?' ('+esc(f.process_type)+')':f.category?' ('+esc(f.category)+')':''}</option>`).join('')}
          </select>
          ` : `
          <input type="text" id="f-factory" value="${esc(p?.factory_name||'')}" placeholder="工場名を入力（仕入/加工先マスタに登録すると選択式になります）">
          <p style="font-size:10px;color:var(--c-text3);margin-top:4px">💡 マスタ管理→仕入/加工先から加工先として登録できます</p>
          `}
        </div>
      </div>
      <div class="form-row form-row-2">
        <div class="form-group"><label>製品納期</label><input type="date" id="f-delivery" value="${esc(p?.delivery_date||'')}"></div>
        <div class="form-group"><label>ステータス</label>
          <select id="f-status">${Object.entries(STATUS_LABELS).map(([v,l])=>`<option value="${v}" ${p?.status===v?'selected':''}>${l}</option>`).join('')}</select>
        </div>
      </div>
      <div class="form-group"><label>コメント・備考</label><textarea id="f-memo">${esc(p?.memo||'')}</textarea></div>
    </div>
  </div>
  <div>
    <div class="section-card"><h3>📷 写真</h3>
      <p style="font-size:11px;color:var(--c-text2);margin-bottom:10px">クリック・ドラッグ&ドロップ・Ctrl+Vで追加（最大6枚）</p>
      <div class="image-grid">${imgSlots}</div>
    </div>
  </div>
</div>`;
}

function onClientSel(sel) {
  document.getElementById('f-client-id').value = sel.value;
}

// 取引先キーワード絞り込み
function filterClientSel(input) {
  const q = input.value.toLowerCase();
  const sel = document.getElementById('f-client-sel'); if(!sel) return;
  Array.from(sel.options).forEach(opt=>{
    opt.style.display = !q||opt.text.toLowerCase().includes(q)?'':'none';
  });
}

// 加工場キーワード絞り込み
function filterFactory() {
  const q = (document.getElementById('f-factory-search')?.value||'').toLowerCase();
  const sel = document.getElementById('f-factory'); if (!sel) return;
  Array.from(sel.options).forEach(opt => {
    opt.style.display = !q || opt.text.toLowerCase().includes(q) ? '' : 'none';
  });
}

// カラー選択ポップアップ（チェックボックス方式）
function openColorPopup() {
  const ov = document.createElement('div');
  ov.id = 'color-ov';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9000;display:flex;align-items:center;justify-content:center';

  const box = document.createElement('div');
  box.style.cssText = 'background:var(--c-surface);border-radius:12px;padding:24px;width:560px;max-width:95vw;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,.25)';

  box.innerHTML = `
    <h3 style="font-size:16px;font-weight:700;margin-bottom:12px">🎨 製品カラーを選択（最大7色）</h3>
    <input type="text" id="color-search" placeholder="カラー名・コードで絞り込み..." oninput="filterColorList()" style="margin-bottom:12px">
    <div id="color-list" style="flex:1;overflow-y:auto;display:grid;grid-template-columns:1fr 1fr;gap:6px;max-height:400px">
      ${_masters.colors.map(c => {
        const already = _productColors.find(pc=>pc.code===c.color_code);
        const slotNum = already ? _productColors.indexOf(already)+1 : 0;
        return `<label style="display:flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid var(--c-border);border-radius:6px;cursor:pointer;${slotNum?'background:var(--c-primary-bg);border-color:var(--c-primary);':''}">
          <input type="checkbox" name="color-cb" value="${esc(c.color_code)}" data-name="${esc(c.color_name_ja)}" ${slotNum?'checked':''} style="width:14px;height:14px">
          <span style="display:inline-block;width:16px;height:16px;border-radius:3px;background:${esc(c.hex||'#ccc')};border:1px solid var(--c-border);flex-shrink:0"></span>
          <span style="font-size:12px"><span style="font-family:monospace;font-weight:600">${esc(c.color_code)}</span> ${esc(c.color_name_ja)}</span>
          ${slotNum?`<span style="margin-left:auto;font-size:10px;color:var(--c-primary);font-weight:600">Col.${slotNum}</span>`:''}
        </label>`;
      }).join('')}
    </div>
    <p style="font-size:11px;color:var(--c-text3);margin-top:10px">チェックした順にCol.1〜7に割り当てられます（最大7色）</p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
      <button class="btn btn-secondary" onclick="document.getElementById('color-ov').remove()">キャンセル</button>
      <button class="btn btn-primary" onclick="confirmColors()">確定</button>
    </div>`;

  ov.appendChild(box);
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if(e.target===ov) ov.remove(); });
}

function filterColorList() {
  const q = (document.getElementById('color-search')?.value||'').toLowerCase();
  document.querySelectorAll('#color-list label').forEach(label => {
    const text = label.textContent.toLowerCase();
    label.style.display = !q || text.includes(q) ? '' : 'none';
  });
}

function confirmColors() {
  const checked = Array.from(document.querySelectorAll('#color-list input[name="color-cb"]:checked'));
  if (checked.length > 7) { alert('カラーは最大7色まで選択できます'); return; }
  _productColors = Array(7).fill(null).map((_,i) => {
    if (i < checked.length) return { code: checked[i].value, name: checked[i].dataset.name||'' };
    return { code:'', name:'' };
  });
  // 表示を更新
  const disp = document.getElementById('f-color-display');
  if (disp) disp.value = _productColors.filter(c=>c.code).map(c=>c.code+' '+c.name).join(' / ');
  const prev = document.getElementById('color-preview');
  if (prev) prev.innerHTML = _productColors.filter(c=>c.code).map((c,i)=>
    `<span style="display:inline-flex;align-items:center;gap:4px;background:var(--c-primary-bg);color:var(--c-primary);padding:2px 8px;border-radius:4px;font-size:12px">
      <span style="font-weight:600">Col.${i+1}</span> ${esc(c.code)} ${esc(c.name)}
    </span>`
  ).join('');
  document.getElementById('color-ov')?.remove();
}

function collectProductForm() {
  const g = id => document.getElementById(id)?.value||'';
  const colors = {};
  for (let i=0;i<7;i++) {
    colors['product_color'+(i+1)+'_code'] = _productColors[i]?.code||'';
    colors['product_color'+(i+1)+'_name'] = _productColors[i]?.name||'';
  }
  return {
    brand_product_no:  g('f-brand-no'),
    temp_product_no:   g('f-temp-no'),
    product_name:      g('f-name-ja'),
    product_name_en:   g('f-name-en'),
    brand:             g('f-brand'),
    client_id:         document.getElementById('f-client-id')?.value || document.getElementById('f-client-free')?.value||'',
    client_name:       _masters.customers.find(c=>c.customer_id===(document.getElementById('f-client-id')?.value||''))?.customer_name || document.getElementById('f-client-free')?.value||'',
    item_code:         g('f-item'),
    item_name:         ITEMS.find(i=>i.code===g('f-item'))?.name||'',
    year:              g('f-year'),
    season:            g('f-season'),
    size_range:        g('f-size-range'),
    country_of_origin: g('f-country'),
    patternmaker:      g('f-patternmaker'),
    pattern_no:        g('f-pattern-no'),
    sample_no:         g('f-sample-no'),
    factory_name:      (()=>{ const el=document.getElementById('f-factory'); return el?el.value:''; })(),
    delivery_date:     g('f-delivery'),
    status:            g('f-status'),
    memo:              g('f-memo'),
    ...colors,
  };
}

async function saveNewProduct() {
  const data = collectProductForm();
  if (!data.brand_product_no && !data.product_name) { toast('品番または品名を入力してください','error'); return; }
  const res = await api('products.create', data);
  if (!res) return;
  if (!res.ok) { toast(res.error||'登録に失敗しました','error'); return; }
  toast('登録しました（'+res.style_code+'）','success');
  document.getElementById('fullscreen-modal').classList.remove('show');
  document.body.style.overflow='';
  _currentProduct=null;
  setTimeout(()=>loadProducts(), 300);
}

async function saveProductData() {
  const data = collectProductForm();
  const res  = await api('products.update', {style_code:_currentProduct.style_code, ...data});
  if (!res||!res.ok) { toast(res?.error||'保存に失敗しました','error'); return; }
  toast('保存しました','success');
  Object.assign(_currentProduct, data);
  document.getElementById('fs-badge').innerHTML=statusBadge(data.status);
  document.getElementById('fs-title').textContent=data.brand_product_no||_currentProduct.style_code;
}

// ===== 画像処理 =====
function triggerImgUpload(i) { document.getElementById('imgfile-'+i)?.click(); }
function handleImgFile(e, i) {
  const f=e.target.files[0]; if(!f) return;
  const r=new FileReader(); r.onload=ev=>setImg(i,ev.target.result); r.readAsDataURL(f);
}
function handleImgDrop(e, i) {
  e.preventDefault();
  const f=e.dataTransfer.files[0]; if(!f||!f.type.startsWith('image/')) return;
  const r=new FileReader(); r.onload=ev=>setImg(i,ev.target.result); r.readAsDataURL(f);
}
function setImg(i, url) {
  _productImages[i]=url;
  const slot=document.getElementById('imgslot-'+i); if(!slot) return;
  slot.innerHTML=`<img id="imgprev-${i}" src="${url}" alt="">
    <div class="img-overlay"><button class="btn btn-sm" style="background:#fff;color:#333;font-size:11px" onclick="event.stopPropagation();clearImg(${i})">削除</button></div>
    <input type="file" id="imgfile-${i}" accept="image/*" style="display:none" onchange="handleImgFile(event,${i})">`;
}
function clearImg(i) {
  _productImages[i]='';
  const slot=document.getElementById('imgslot-'+i); if(!slot) return;
  slot.innerHTML=`<div class="img-placeholder">📷</div><div class="img-label">写真 ${i+1}</div>
    <div class="img-overlay"></div>
    <input type="file" id="imgfile-${i}" accept="image/*" style="display:none" onchange="handleImgFile(event,${i})">`;
}
let _pasteH=null;
function setupImagePaste() {
  if(_pasteH) document.removeEventListener('paste',_pasteH);
  _pasteH=(e)=>{
    const items=e.clipboardData?.items; if(!items) return;
    for(const item of items) {
      if(item.type.startsWith('image/')) {
        const idx=_productImages.findIndex(u=>!u);
        if(idx<0){toast('画像スロットが満杯です','error');return;}
        const r=new FileReader();
        r.onload=ev=>{setImg(idx,ev.target.result);toast('写真'+(idx+1)+'に貼り付けました','success');};
        r.readAsDataURL(item.getAsFile()); break;
      }
    }
  };
  document.addEventListener('paste',_pasteH);
}

// ===== サイズ選択ポップアップ =====
function openSizePopup() {
  const current=(document.getElementById('f-size-range')?.value||'').split('/').map(s=>s.trim()).filter(Boolean);
  const ov=document.createElement('div');
  ov.id='size-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9000;display:flex;align-items:center;justify-content:center';
  const box=document.createElement('div');
  box.style.cssText='background:var(--c-surface);border-radius:12px;padding:24px;width:360px;max-width:90vw;box-shadow:0 8px 32px rgba(0,0,0,.2)';
  box.innerHTML='<h3 style="font-size:16px;font-weight:700;margin-bottom:16px">📐 サイズ展開を選択</h3>'+
    '<div id="size-checks" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px">'+
    _masters.sizes.map(s=>{
      const chk=current.includes(s.size_name);
      return `<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;padding:6px 8px;border:1px solid var(--c-border);border-radius:6px;${chk?'background:var(--c-primary-bg);border-color:var(--c-primary);':''}">
        <input type="checkbox" value="${esc(s.size_name)}" ${chk?'checked':''} style="width:14px;height:14px"> ${esc(s.size_name)}</label>`;
    }).join('')+
    '</div><div style="display:flex;gap:8px;justify-content:flex-end">'+
    '<button class="btn btn-secondary" onclick="document.getElementById(\'size-ov\').remove()">キャンセル</button>'+
    '<button class="btn btn-primary" onclick="confirmSize()">確定</button></div>';
  ov.appendChild(box);
  document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
}
function confirmSize() {
  const checks=document.querySelectorAll('#size-checks input:checked');
  const order=_masters.sizes.map(s=>s.size_name);
  const sel=Array.from(checks).map(c=>c.value).sort((a,b)=>order.indexOf(a)-order.indexOf(b));
  const f=document.getElementById('f-size-range'); if(f) f.value=sel.join(' / ');
  document.getElementById('size-ov')?.remove();
}

// ===== 資材シート =====

async function renderMaterialsTab() {
  const res = await api('product_materials.get', {style_code:_currentProduct.style_code});
  _materialRows = (res?.items||[]).filter(r=>r.product_no||r.product_name);
  _matColorCache = {}; // キャッシュリセット

  // 製品カラー（Col.ヘッダー用）
  const prodColors = _productColors.filter(c=>c.code);
  const numCols = Math.max(prodColors.length, _matColorCols, 3);
  _matColorCols = numCols;

  // カラーヘッダー（製品カラー名を表示）
  const colorHeaders = Array.from({length:numCols},(_,i)=>{
    const c = prodColors[i];
    return `<th style="min-width:130px;background:#1B3A6B;color:#fff">
      <div style="font-size:11px;font-weight:600">Col.${i+1}</div>
      <div style="font-size:10px;opacity:.85">${c?esc(c.code)+' '+esc(c.name):'（未設定）'}</div>
    </th>`;
  }).join('');
  const colorSubHeaders = Array.from({length:numCols},()=>
    `<th style="background:#2B5CE6;color:#fff;font-size:10px;min-width:130px">
      <span style="opacity:.8">資材カラーコード</span> / <span style="opacity:.8">単価(円)</span>
    </th>`
  ).join('');

  // 着単価計算方法
  const calcMethod = _currentProduct.cost_calc_method||'average';

  const sN = s => s.partner_name||s.supplier_name||'';
  const supOpts='<option value="">-</option>'+_masters.suppliers.map(s=>`<option value="${esc(sN(s))}">${esc(sN(s))}</option>`).join('');

  document.getElementById('fs-body').innerHTML=`
    <div style="margin-bottom:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <code style="background:var(--c-bg);padding:2px 8px;border-radius:4px;font-size:12px">${esc(_currentProduct.style_code)}</code>
      <button class="btn btn-secondary btn-sm" onclick="addMatRow()">＋ 行を追加</button>
      <button class="btn btn-secondary btn-sm" onclick="openMatSearchPopup()">🔍 資材マスタから追加</button>
      ${numCols<7?`<button class="btn btn-secondary btn-sm" onclick="addMatColorColNew()">＋ カラー列を追加</button>`:''}
      <button class="btn btn-secondary btn-sm" onclick="pdfMaterialOrder()">📦 資材発注書</button>      <div style="display:flex;align-items:center;gap:6px;margin-left:auto">
        <span style="font-size:12px;color:var(--c-text2)">着単価計算：</span>
        <select id="cost-calc-method" onchange="saveCostCalcMethod(this.value)" style="font-size:12px">
          <option value="average" ${calcMethod==='average'?'selected':''}>平均法</option>
          <option value="per_color" ${calcMethod==='per_color'?'selected':''}>カラー毎</option>
        </select>
        <span style="font-size:13px">着単価合計: <strong id="mat-total" style="font-size:15px;color:var(--c-primary)">-</strong></span>
      </div>
    </div>
    <datalist id="mat-names">${_masters.materials.map(m=>`<option value="${esc(m.product_name)}">`).join('')}</datalist>
    <div style="overflow-x:auto">
    <table class="material-table" id="mat-table">
      <thead>
        <tr>
          <th rowspan="2" style="width:24px"><input type="checkbox" id="mat-chk-all" onchange="toggleAllMatChk(this)" style="width:13px;height:13px" title="全選択"></th>
          <th rowspan="2" style="width:28px">No.</th>
          <th rowspan="2" style="min-width:90px">品番</th>
          <th rowspan="2" style="min-width:140px">品名</th>
          <th rowspan="2" style="min-width:80px">規格</th>
          <th rowspan="2" style="width:80px">対応サイズ</th>
          <th rowspan="2" style="width:75px">分類</th>
          <th rowspan="2" style="min-width:110px">使用箇所</th>
          <th rowspan="2" style="width:55px">用尺</th>
          <th rowspan="2" style="width:44px">単位</th>
          ${colorHeaders}
          <th rowspan="2" style="width:48px">ロス%</th>
          <th rowspan="2" style="min-width:100px">仕入先</th>
          <th rowspan="2" style="min-width:80px">メーカー</th>
          <th rowspan="2" style="min-width:80px">メモ</th>
          <th rowspan="2" style="width:90px;background:#EEF2FD;color:#2B5CE6">📅 資材納期</th>
          <th rowspan="2" style="width:56px">操作</th>
        </tr>
        <tr>${colorSubHeaders}</tr>
      </thead>
      <tbody id="mat-tbody"></tbody>
    </table>
    ${_materialRows.length===0?'<div style="text-align:center;padding:30px;color:var(--c-text3)">「＋ 行を追加」または「資材マスタから追加」で資材を登録してください</div>':''}
    </div>`;

  const tbody=document.getElementById('mat-tbody');
  _materialRows.forEach((r,i)=>appendMatRow(tbody,r,i,supOpts));
  calcMatTotal();
}

async function saveCostCalcMethod(val) {
  _currentProduct.cost_calc_method = val;
  await api('products.update', {style_code:_currentProduct.style_code, cost_calc_method:val});
  calcMatTotal();
  toast('計算方法を変更しました','success');
}

function addMatColorColNew() {
  if(_matColorCols>=7) return;
  // 入力値を保存
  _matFields.forEach(f=>{
    _materialRows.forEach((_,i)=>{ if(_materialRows[i]) _materialRows[i][f]=getMF(i,f); });
  });
  // カラー単価も保存
  _materialRows.forEach((_,i)=>{
    for(let n=1;n<=_matColorCols;n++){
      _materialRows[i]['col'+n+'_matcode'] = getMF(i,'col'+n+'_matcode');
      _materialRows[i]['col'+n+'_price']   = getMF(i,'col'+n+'_price');
    }
  });
  _matColorCols++;
  renderMaterialsTab();
}

const _matFields = ['product_no','product_name','spec','applicable_sizes','category','usage_location',
  'usage_quantity','unit','loss_rate','supplier_name','maker_name','memo','delivery_date',
  'col1_matcode','col1_matcname','col1_price',
  'col2_matcode','col2_matcname','col2_price',
  'col3_matcode','col3_matcname','col3_price',
  'col4_matcode','col4_matcname','col4_price',
  'col5_matcode','col5_matcname','col5_price',
  'col6_matcode','col6_matcname','col6_price',
  'col7_matcode','col7_matcname','col7_price'];

function appendMatRow(tbody, r, idx, supOpts) {
  const sN = s => s.partner_name||s.supplier_name||'';
  if(!supOpts) supOpts='<option value="">-</option>'+_masters.suppliers.map(s=>`<option value="${esc(sN(s))}">${esc(sN(s))}</option>`).join('');

  // カラーセル用datalistをbodyに直接追加（行ごと）
  const matName = r.product_name||'';
  const matNo   = r.product_no||'';
  const matMaster = _masters.materials.find(m=>m.product_name===matName||m.product_no===matNo);
  const matColors = matMaster?._colorPrices||[];

  // カラーセル（規格選択→カラーコード入力→カラー名・単価自動）
  const prodColors = _productColors.filter(c=>c.code);
  const colorCells = Array.from({length:_matColorCols},(_,n)=>{
    const matCode  = r['col'+(n+1)+'_matcode']||'';
    const matCname = r['col'+(n+1)+'_matcname']||'';
    const price    = r['col'+(n+1)+'_price']||'';
    const pc = prodColors[n];
    return `<td style="padding:3px 4px;min-width:130px;background:${n%2===0?'#F7FAFF':'#EFF4FF'}">
      <div style="font-size:9px;color:#2B5CE6;font-weight:600;margin-bottom:2px">${pc?esc(pc.name):'Col.'+(n+1)}</div>
      <input type="text" data-r="${idx}" data-f="col${n+1}_matcode" value="${esc(matCode)}"
        placeholder="カラーコード" style="font-size:10px;width:100%;margin-bottom:1px;border-radius:3px"
        oninput="onMatColorInput(${idx},${n+1})"
        onfocus="loadMatColorDl(${idx})"
        list="dl-mat-colors-${idx}">
      <input type="text" data-r="${idx}" data-f="col${n+1}_matcname" value="${esc(matCname)}"
        placeholder="カラー名" style="font-size:10px;width:100%;margin-bottom:1px;border-radius:3px;color:#555"
        readonly>
      <input type="number" step="1" data-r="${idx}" data-f="col${n+1}_price" value="${esc(price)}"
        placeholder="単価" oninput="calcRowTotal(${idx})"
        style="font-size:11px;width:100%;text-align:right;border-radius:3px;font-weight:600;color:#2B5CE6">
    </td>`;
  }).join('');

  const tr=document.createElement('tr');
  tr.dataset.idx=idx;
  tr.innerHTML=`
    <td style="text-align:center"><input type="checkbox" class="mat-order-chk" data-idx="${idx}" style="width:13px;height:13px"></td>
    <td class="slot-cell">${idx+1}</td>
    <td><input type="text" data-r="${idx}" data-f="product_no"   value="${esc(r.product_no||'')}"   placeholder="品番" style="min-width:80px"></td>
    <td><input type="text" data-r="${idx}" data-f="product_name" value="${esc(r.product_name||'')}" placeholder="品名" list="mat-names" style="min-width:130px" onchange="onMatNameChange(${idx})"></td>
    <td>
      <input type="text" data-r="${idx}" data-f="spec" value="${esc(r.spec||'')}" placeholder="規格" style="min-width:70px" list="dl-spec-${idx}" onchange="onMatSpecChange(${idx})">
    </td>
    <td>
      <input type="text" data-r="${idx}" data-f="applicable_sizes"
        value="${esc(r.applicable_sizes||'全サイズ')}"
        placeholder="全サイズ" style="width:74px;font-size:11px"
        title="対応サイズを / 区切りで入力。全サイズは「全サイズ」"
        list="dl-sizes-${idx}">
    </td>
    <td><select data-r="${idx}" data-f="category" style="font-size:11px;width:100%">
      ${CATEGORIES.map(c=>`<option value="${c}" ${r.category===c?'selected':''}>${c}</option>`).join('')}
    </select></td>
    <td><input type="text" data-r="${idx}" data-f="usage_location" value="${esc(r.usage_location||'')}" placeholder="使用箇所" style="min-width:100px"></td>
    <td><input type="number" step="0.01" data-r="${idx}" data-f="usage_quantity" value="${esc(r.usage_quantity||'')}" placeholder="0" oninput="calcRowTotal(${idx})" style="width:50px;text-align:right"></td>
    <td><select data-r="${idx}" data-f="unit" style="font-size:11px;width:42px">
      ${UNITS.map(u=>`<option value="${u}" ${r.unit===u?'selected':''}>${u}</option>`).join('')}
    </select></td>
    ${colorCells}
    <td><input type="number" step="0.1" data-r="${idx}" data-f="loss_rate" value="${esc(r.loss_rate||'')}" placeholder="0" oninput="calcRowTotal(${idx})" style="width:44px;text-align:right"></td>
    <td><select data-r="${idx}" data-f="supplier_name" style="font-size:11px;width:100%">
      <option value="">-</option>${_masters.suppliers.map(s=>`<option value="${esc(sN(s))}" ${r.supplier_name===sN(s)?'selected':''}>${esc(sN(s))}</option>`).join('')}
    </select></td>
    <td><input type="text" data-r="${idx}" data-f="maker_name" value="${esc(r.maker_name||'')}" placeholder="メーカー" style="min-width:70px"></td>
    <td><input type="text" data-r="${idx}" data-f="memo"       value="${esc(r.memo||'')}"       placeholder="メモ"     style="min-width:70px"></td>
    <td><input type="date" data-r="${idx}" data-f="delivery_date" value="${esc(r.delivery_date||'')}" style="width:88px;font-size:11px;color:#2B5CE6;font-weight:600" title="資材納期"></td>
    <td style="text-align:center;white-space:nowrap">
      <div id="rp-${idx}" style="font-size:10px;font-weight:600;color:var(--c-primary);margin-bottom:2px">-</div>
      <button class="btn btn-secondary btn-sm" style="font-size:10px;padding:2px 5px;margin-bottom:2px" onclick="editMatMaster(${idx})" title="マスタ編集">✏️</button>
      <button class="del-btn" onclick="delMatRow(${idx})" title="削除">✕</button>
    </td>`;
  tbody.appendChild(tr);

  // カラーdatalistをbody直下に追加（list属性はbody直下のdatalistのみ有効）
  let colorDl = document.getElementById('dl-mat-colors-'+idx);
  if(!colorDl) {
    colorDl = document.createElement('datalist');
    colorDl.id = 'dl-mat-colors-'+idx;
    document.body.appendChild(colorDl);
  }
  // 規格datalistもbody直下に追加
  let specDlBody = document.getElementById('dl-spec-'+idx);
  if(!specDlBody) {
    specDlBody = document.createElement('datalist');
    specDlBody.id = 'dl-spec-'+idx;
    document.body.appendChild(specDlBody);
  }
  // 対応サイズdatalistもbody直下に追加
  let sizesDl = document.getElementById('dl-sizes-'+idx);
  if(!sizesDl) {
    sizesDl = document.createElement('datalist');
    sizesDl.id = 'dl-sizes-'+idx;
    // 全サイズ + 製品のサイズ展開
    const prodSizes = (_currentProduct?.size_range||'').split('/').map(s=>s.trim()).filter(Boolean);
    sizesDl.innerHTML = '<option value="全サイズ">' +
      prodSizes.map(s=>`<option value="${esc(s)}">`).join('');
    document.body.appendChild(sizesDl);
  }

  // カラーdatalistはユーザーがフォーカスした時だけ取得（起動時は取得しない）
  if(matMaster?.material_id) {
    if(_materialRows[idx]) _materialRows[idx]._material_id = matMaster.material_id;
    // キャッシュがあれば即時更新
    const cached = _matColorCache[matMaster.material_id];
    if(cached) {
      colorDl.innerHTML = [...new Set(cached.map(c=>c.color_code).filter(Boolean))].map(code=>{
        const f=cached.find(x=>x.color_code===code);
        return `<option value="${esc(code)}">${esc(code)}${f?.color_name?' '+esc(f.color_name):''}${f?.unit_price?' ('+f.unit_price+'円)':''}`;
      }).join('');
    }
    // キャッシュがなければフォーカス時に取得（ここでは何もしない）
  }

  calcRowTotal(idx);
}

function addMatRow() {
  const newRow = { material_slot: String(_materialRows.length+1).padStart(2,'0') };
  _materialRows.push(newRow);
  const tbody = document.getElementById('mat-tbody');
  if(tbody) appendMatRow(tbody, newRow, _materialRows.length-1);
  calcMatTotal();
}

function delMatRow(idx) {
  _matFields.forEach(f=>{ if(_materialRows[idx]) _materialRows[idx][f]=getMF(idx,f); });
  _materialRows.splice(idx,1);
  const tbody = document.getElementById('mat-tbody');
  if(tbody) {
    tbody.innerHTML='';
    const sN = s=>s.partner_name||s.supplier_name||'';
    const supOpts='<option value="">-</option>'+_masters.suppliers.map(s=>`<option value="${esc(sN(s))}">${esc(sN(s))}</option>`).join('');
    _materialRows.forEach((r,i)=>appendMatRow(tbody,r,i,supOpts));
    calcMatTotal();
  }
}

function getMF(idx,f) {
  const el=document.querySelector(`[data-r="${idx}"][data-f="${f}"]`); return el?el.value:'';
}

function calcRowTotal(idx) {
  const qty  = parseFloat(getMF(idx,'usage_quantity'))||0;
  const loss = (parseFloat(getMF(idx,'loss_rate'))||0)/100;
  const method = _currentProduct.cost_calc_method||'average';

  let total = 0;
  if(method==='average') {
    // 平均法：全カラーの単価平均
    const prices=[];
    for(let n=1;n<=_matColorCols;n++){
      const p=parseFloat(getMF(idx,'col'+n+'_price'));
      if(p) prices.push(p);
    }
    const avg = prices.length ? prices.reduce((a,b)=>a+b,0)/prices.length : 0;
    total = Math.round(qty * avg * (1+loss));
  } else {
    // カラー毎：Col.1の単価で代表表示（全カラー合計/カラー数）
    const prices=[];
    for(let n=1;n<=_matColorCols;n++){
      const p=parseFloat(getMF(idx,'col'+n+'_price'));
      if(p) prices.push(p);
    }
    total = prices.length ? Math.round(qty * (prices.reduce((a,b)=>a+b,0)/prices.length) * (1+loss)) : 0;
  }

  const el=document.getElementById('rp-'+idx);
  if(el) el.textContent = total ? total.toLocaleString()+'円' : '-';
  calcMatTotal();
}

function calcMatTotal() {
  let t=0;
  _materialRows.forEach((_,i)=>{
    const el=document.getElementById('rp-'+i);
    if(el) {
      const v=parseInt(el.textContent.replace(/[^0-9]/g,''));
      if(!isNaN(v)) t+=v;
    }
  });
  const el=document.getElementById('mat-total');
  if(el) el.textContent=t?t.toLocaleString()+'円':'-';
}

// カラーdatalistをフォーカス時だけ取得（遅延読み込みで軽量化）
async function loadMatColorDl(idx) {
  const matId = _materialRows[idx]?._material_id;
  if(!matId) return;
  // キャッシュがあればスキップ
  if(_matColorCache[matId]) return;

  const res = await api('material_color_prices.get', {material_id: matId});
  const items = res?.items||[];
  _matColorCache[matId] = items;

  // カラーdatalist更新
  const colorDl = document.getElementById('dl-mat-colors-'+idx);
  if(colorDl) {
    colorDl.innerHTML = [...new Set(items.map(c=>c.color_code).filter(Boolean))].map(code=>{
      const f = items.find(x=>x.color_code===code);
      return `<option value="${esc(code)}">${esc(code)}${f?.color_name?' '+esc(f.color_name):''}${f?.unit_price?' ('+f.unit_price+'円)':''}`;
    }).join('');
  }
  // 規格datalist更新
  const specDl = document.getElementById('dl-spec-'+idx);
  if(specDl) {
    const specs = [...new Set(items.map(c=>c.spec||'').filter(Boolean))];
    specDl.innerHTML = specs.map(s=>`<option value="${esc(s)}">`).join('');
  }
}

// 品名変更時：マスタ検索して規格リスト・カラーリストを更新
async function onMatNameChange(idx) {
  const name = getMF(idx,'product_name');
  const no   = getMF(idx,'product_no');
  const mat  = _masters.materials.find(m=>m.product_name===name||m.product_no===no);
  if(!mat) return;

  // 品番・仕入先・メーカーを自動入力
  const setIfEmpty = (f, val) => {
    const el = document.querySelector(`[data-r="${idx}"][data-f="${f}"]`);
    if(el && !el.value && val) el.value = val;
  };
  setIfEmpty('product_no',    mat.product_no||'');
  setIfEmpty('supplier_name', mat.supplier_name||'');
  setIfEmpty('maker_name',    mat.maker_name||'');

  // material_idを保存
  if(_materialRows[idx]) _materialRows[idx]._material_id = mat.material_id;

  // キャッシュがあれば使う、なければ取得
  let cp = _matColorCache[mat.material_id];
  if(!cp) {
    const cpRes = await api('material_color_prices.get', {material_id:mat.material_id});
    cp = cpRes?.items||[];
    _matColorCache[mat.material_id] = cp;
  }

  // 規格datalistを更新（dl-spec-${idx}）- 自動入力はしない
  const specDl2 = document.getElementById('dl-spec-'+idx);
  if(specDl2) {
    const specs = [...new Set(cp.map(c=>c.spec||'').filter(Boolean))];
    specDl2.innerHTML = specs.map(s=>`<option value="${esc(s)}">`).join('');
    // ★ 自動入力はしない（ユーザーがドロップダウンから選択）
  }

  // カラーdatalistを更新（dl-mat-colors-${idx}）
  // マスタに登録された資材カラーコード・カラー名が候補に出る（自由入力も可能）
  const colorDl2 = document.getElementById('dl-mat-colors-'+idx);
  if(colorDl2) {
    const codes = [...new Set(cp.map(c=>c.color_code).filter(Boolean))];
    colorDl2.innerHTML = codes.map(code=>{
      const found = cp.find(x=>x.color_code===code);
      return `<option value="${esc(code)}">${esc(code)}${found?.color_name?' '+esc(found.color_name):''}${found?.unit_price?' ('+found.unit_price+'円)':''}`;
    }).join('');
  }
}

// 規格変更時：カラー候補を絞り込み＋既設定カラーの単価を再取得
async function onMatSpecChange(idx) {
  const spec  = getMF(idx,'spec');
  const matId = _materialRows[idx]?._material_id;
  if(!matId) return;

  const cpRes = await api('material_color_prices.get', {material_id: matId});
  const items = cpRes?.items||[];
  const filtered = spec ? items.filter(c=>(c.spec||'')===spec) : items;

  // カラーdatalist更新
  const colorDl = document.getElementById('dl-mat-colors-'+idx);
  if(colorDl) {
    const codes = [...new Set(filtered.map(c=>c.color_code).filter(Boolean))];
    colorDl.innerHTML = codes.map(code=>{
      const found = filtered.find(x=>x.color_code===code);
      return `<option value="${esc(code)}">${esc(code)}${found?.color_name?' '+esc(found.color_name):''}${found?.unit_price?' ('+found.unit_price+'円)':''}`;
    }).join('');
  }

  // 既設定カラーの単価・カラー名を新規格に合わせて更新
  for(let n=1; n<=_matColorCols; n++) {
    const code    = getMF(idx,'col'+n+'_matcode');
    const priceEl = document.querySelector(`[data-r="${idx}"][data-f="col${n}_price"]`);
    const nameEl  = document.querySelector(`[data-r="${idx}"][data-f="col${n}_matcname"]`);
    if(!code) continue;
    const matched = filtered.find(c=>c.color_code===code);
    if(matched) {
      if(priceEl) priceEl.value = matched.unit_price||'';
      if(nameEl)  nameEl.value  = matched.color_name||'';
    } else {
      if(priceEl) priceEl.value = '';
      if(nameEl)  nameEl.value  = '';
    }
  }
  calcRowTotal(idx);
  toast('規格を変更しました。カラー単価・名称を更新しました。','success');
}
async function onMatColorInput(idx, colNum) {
  const code    = getMF(idx,'col'+colNum+'_matcode');
  const spec    = getMF(idx,'spec');
  const nameEl  = document.querySelector(`[data-r="${idx}"][data-f="col${colNum}_matcname"]`);
  const priceEl = document.querySelector(`[data-r="${idx}"][data-f="col${colNum}_price"]`);

  if(!code) {
    if(nameEl)  nameEl.value  = '';
    if(priceEl) priceEl.value = '';
    calcRowTotal(idx);
    return;
  }

  // material_idが未設定なら品名・品番からマスタを逆引き
  let matId = _materialRows[idx]?._material_id;
  if(!matId) {
    const pName = getMF(idx,'product_name');
    const pNo   = getMF(idx,'product_no');
    const mat   = _masters.materials.find(m=>m.product_name===pName||m.product_no===pNo);
    if(mat) {
      matId = mat.material_id;
      if(_materialRows[idx]) _materialRows[idx]._material_id = matId;
    }
  }
  if(!matId) return;

  // キャッシュがあれば使う
  let items = _matColorCache[matId];
  if(!items) {
    const res2 = await api('material_color_prices.get',{material_id:matId});
    items = res2?.items||[];
    _matColorCache[matId] = items;
  }
  // specとcolor_codeで絞り込み
  const matched = items.find(c=>c.color_code===code && (c.spec||'')===(spec||''))
                || items.find(c=>c.color_code===code); // specが違っても候補表示
  if(matched) {
    if(nameEl)  nameEl.value  = matched.color_name||'';
    if(priceEl) priceEl.value = matched.unit_price||'';
    calcRowTotal(idx);
  }
}

function toggleAllMatChk(chk) {
  document.querySelectorAll('.mat-order-chk').forEach(c=>{ c.checked=chk.checked; });
}

// 資材シートから直接マスタ編集
function editMatMaster(idx) {
  const no   = getMF(idx,'product_no');
  const name = getMF(idx,'product_name');
  const mat = _masters.materials.find(m=>m.product_no===no||m.product_name===name);
  if(mat) {
    openMaterialFormWithColorPrices(mat, _masters.materials.indexOf(mat));
  } else {
    openMatMasterPopup(name, no);
    toast('資材マスタに未登録です。新規登録してください。','error');
  }
}

async function saveMaterialsData() {
  const rows = [];
  _materialRows.forEach((_,idx)=>{
    const no   = getMF(idx,'product_no');
    const name = getMF(idx,'product_name');
    if(!no && !name) return;
    const o = { material_slot: String(rows.length+1).padStart(2,'0') };
    _matFields.forEach(f=>{ o[f] = getMF(idx,f); });
    // カラー単価・カラー名
    for(let n=1;n<=_matColorCols;n++){
      o['col'+n+'_matcode']  = getMF(idx,'col'+n+'_matcode');
      o['col'+n+'_matcname'] = getMF(idx,'col'+n+'_matcname');
      o['col'+n+'_price']    = getMF(idx,'col'+n+'_price');
    }
    rows.push(o);
  });
  const res = await api('product_materials.save', {style_code:_currentProduct.style_code, rows});
  if(!res||!res.ok){ toast(res?.error||'保存に失敗しました','error'); return; }
  toast('資材シートを保存しました（'+rows.length+'行）','success');
  _materialRows = rows;
}

// ===== 郵便番号自動入力 =====
async function lookupZip(zipFieldId, addrFieldId) {
  const zip = (document.getElementById(zipFieldId)?.value||'').replace(/[^0-9]/g,'');
  if(zip.length !== 7) { toast('郵便番号は7桁で入力してください','error'); return; }
  showLoading(true);
  try {
    const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip}`);
    const data = await res.json();
    showLoading(false);
    if(data.results && data.results.length > 0) {
      const r = data.results[0];
      const addr = r.address1 + r.address2 + r.address3;
      const el = document.getElementById(addrFieldId);
      if(el) el.value = addr;
      toast('住所を自動入力しました','success');
    } else {
      toast('住所が見つかりませんでした','error');
    }
  } catch(e) {
    showLoading(false);
    toast('郵便番号検索に失敗しました','error');
  }
}

function zipInput(zipId, addrId) {
  return `<div style="display:flex;gap:6px;align-items:center">
    <input type="text" id="${zipId}" placeholder="例: 6158520" maxlength="8" style="flex:1"
      oninput="this.value=this.value.replace(/[^0-9]/g,'')"
      onkeydown="if(event.key==='Enter'){lookupZip('${zipId}','${addrId}');event.preventDefault()}">
    <button class="btn btn-secondary btn-sm" type="button" onclick="lookupZip('${zipId}','${addrId}')">住所検索</button>
  </div>`;
}
let _orderQtyData = {}; // {color_code: {size_name: qty}}

async function renderProcessesTab() {
  const res = await api('processes.get', {style_code: _currentProduct.style_code});
  _processRows = res?.items || [];
  if(_processRows.length===0) {
    _processRows = [{seq:1,process_name:'',process_type:'',factory_name:'',supplier_name:'',planned_date:'',actual_date:'',status:'pending',memo:''}];
  }
  renderProcessTable();
}

function renderProcessTable() {
  // 加工場リスト（partnersのis_factoryまたはfactoriesから）
  const facList = _masters.factories.length ? _masters.factories :
    _masters.partners.filter(x=>x.is_factory===true||x.is_factory==='TRUE');
  const getFacName = f => f.factory_name||f.partner_name||'';
  const getSupName = f => f.supplier_name||f.payment_partner_name||'';

  const facOpts = '<option value="">-- 選択 --</option>'+
    facList.map(f=>`<option value="${esc(getFacName(f))}">${esc(getFacName(f))}${f.process_type?' ('+esc(f.process_type)+')':f.category?' ('+esc(f.category)+')':''}</option>`).join('');
  const supOpts = '<option value="">-- 選択 --</option>'+
    (_masters.suppliers.length ? _masters.suppliers : _masters.partners.filter(x=>x.is_supplier===true||x.is_supplier==='TRUE'))
    .map(s=>`<option value="${esc(s.partner_name||s.supplier_name)}">${esc(s.partner_name||s.supplier_name)}</option>`).join('');

  let html = `<div class="section-card">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
      <h3 style="flex:1">🔧 工程管理</h3>
      <button class="btn btn-secondary btn-sm" onclick="addProcessRow()">＋ 工程を追加</button>
      <button class="btn btn-secondary btn-sm" onclick="pdfProcessOrder()">📄 加工発注書</button>
    </div>
    <p style="font-size:11px;color:var(--c-text2);margin-bottom:8px">外注費（円/着）は原価計算に自動転記されます。</p>
    <div style="overflow-x:auto"><table class="material-table">
    <thead><tr>
      <th style="width:28px"><input type="checkbox" id="chk-all" onchange="toggleAllProcess(this)" title="全選択" style="width:14px;height:14px"></th>
      <th style="width:30px">順</th>
      <th style="min-width:90px">工程名</th>
      <th style="width:80px">種別</th>
      <th style="min-width:130px">加工場（実作業）</th>
      <th style="min-width:110px">発注先（仕入先）</th>
      <th style="width:75px;color:#2B5CE6">外注費<br>円/着</th>
      <th style="width:90px">予定納期</th>
      <th style="width:90px">実績完了日</th>
      <th style="width:70px">ステータス</th>
      <th style="min-width:100px">備考</th>
      <th style="width:28px"></th>
    </tr></thead><tbody id="process-tbody">`;

  _processRows.forEach((r,i) => {
    const facSelected = facOpts.replace(`value="${esc(r.factory_name)}"`,`value="${esc(r.factory_name)}" selected`);
    const supSelected = supOpts.replace(`value="${esc(r.supplier_name)}"`,`value="${esc(r.supplier_name)}" selected`);
    html += `<tr data-idx="${i}">
      <td style="text-align:center"><input type="checkbox" class="process-chk" data-idx="${i}" style="width:14px;height:14px"></td>
      <td><input type="number" data-p="${i}" data-f="seq" value="${i+1}" style="width:36px;text-align:center;border:none;background:transparent;font-size:12px"></td>
      <td><input type="text" data-p="${i}" data-f="process_name" value="${esc(r.process_name||'')}" placeholder="裁断・刺繍・縫製" style="min-width:80px"></td>
      <td><select data-p="${i}" data-f="process_type" style="font-size:11px;width:100%">
        ${PROCESS_TYPES.map(t=>`<option value="${t}" ${r.process_type===t?'selected':''}>${t}</option>`).join('')}
      </select></td>
      <td>
        <input type="text" data-p="${i}" data-f="factory_s" placeholder="絞り込み..." oninput="filterProcFactory(${i})" style="margin-bottom:3px;font-size:11px;width:100%">
        <select data-p="${i}" data-f="factory_name" style="font-size:11px;width:100%" onchange="autoFillSupplier(${i})">${facSelected}</select>
      </td>
      <td><select data-p="${i}" data-f="supplier_name" style="font-size:11px;width:100%">${supSelected}</select></td>
      <td><input type="number" step="1" data-p="${i}" data-f="outsource_cost" value="${esc(r.outsource_cost||'')}" placeholder="0" style="width:70px;text-align:right;font-size:12px;font-weight:600;color:#2B5CE6" title="外注費（円/着）"></td>
      <td><input type="date" data-p="${i}" data-f="planned_date" value="${esc(r.planned_date||'')}" style="font-size:11px;width:100%"></td>
      <td><input type="date" data-p="${i}" data-f="actual_date"  value="${esc(r.actual_date||'')}"  style="font-size:11px;width:100%"></td>
      <td><select data-p="${i}" data-f="status" style="font-size:11px;width:100%">
        ${Object.entries(PROCESS_STATUS).map(([v,l])=>`<option value="${v}" ${r.status===v?'selected':''}>${l}</option>`).join('')}
      </select></td>
      <td><input type="text" data-p="${i}" data-f="memo" value="${esc(r.memo||'')}" placeholder="備考"></td>
      <td><button class="del-btn" onclick="delProcessRow(${i})">✕</button></td>
    </tr>`;
  });
  html += `</tbody></table></div></div>`;
  document.getElementById('fs-body').innerHTML = html;
}

function filterProcFactory(idx) {
  const q = (document.querySelector(`[data-p="${idx}"][data-f="factory_s"]`)?.value||'').toLowerCase();
  const sel = document.querySelector(`[data-p="${idx}"][data-f="factory_name"]`); if(!sel) return;
  Array.from(sel.options).forEach(opt => { opt.style.display = !q||opt.text.toLowerCase().includes(q)?'':'none'; });
}

function autoFillSupplier(idx) {
  const facName = document.querySelector(`[data-p="${idx}"][data-f="factory_name"]`)?.value||'';
  const allFac = _masters.factories.length ? _masters.factories :
    _masters.partners.filter(x=>x.is_factory===true||x.is_factory==='TRUE');
  const fac = allFac.find(f=>(f.factory_name||f.partner_name)===facName);
  if(fac) {
    const supName = fac.supplier_name||fac.payment_partner_name||'';
    const supSel = document.querySelector(`[data-p="${idx}"][data-f="supplier_name"]`);
    if(supSel && supName) supSel.value = supName;
  }
}

function toggleAllProcess(chk) {
  document.querySelectorAll('.process-chk').forEach(c=>{ c.checked=chk.checked; });
}

function addProcessRow() {
  // 現在の入力値を保存してから追加
  _processRows.forEach((_,i)=>{
    _processRows[i].process_name   = getProcessField(i,'process_name');
    _processRows[i].process_type   = getProcessField(i,'process_type');
    _processRows[i].factory_name   = getProcessField(i,'factory_name');
    _processRows[i].supplier_name  = getProcessField(i,'supplier_name');
    _processRows[i].planned_date   = getProcessField(i,'planned_date');
    _processRows[i].actual_date    = getProcessField(i,'actual_date');
    _processRows[i].status         = getProcessField(i,'status');
    _processRows[i].memo           = getProcessField(i,'memo');
  });
  _processRows.push({seq:_processRows.length+1,process_name:'',process_type:'縫製',factory_name:'',supplier_name:'',planned_date:'',actual_date:'',status:'pending',memo:''});
  renderProcessTable();
}
function delProcessRow(idx) {
  _processRows.forEach((_,i)=>{
    _processRows[i].process_name  = getProcessField(i,'process_name');
    _processRows[i].process_type  = getProcessField(i,'process_type');
    _processRows[i].factory_name  = getProcessField(i,'factory_name');
    _processRows[i].supplier_name = getProcessField(i,'supplier_name');
    _processRows[i].planned_date  = getProcessField(i,'planned_date');
    _processRows[i].actual_date   = getProcessField(i,'actual_date');
    _processRows[i].status        = getProcessField(i,'status');
    _processRows[i].memo          = getProcessField(i,'memo');
  });
  _processRows.splice(idx,1);
  renderProcessTable();
}

function getProcessField(idx, field) {
  const el = document.querySelector(`[data-p="${idx}"][data-f="${field}"]`); return el?el.value:'';
}

async function saveProcesses() {
  const rows = _processRows.map((_,i)=>({
    seq: i+1,
    process_name:    getProcessField(i,'process_name'),
    process_type:    getProcessField(i,'process_type'),
    factory_name:    getProcessField(i,'factory_name'),
    supplier_name:   getProcessField(i,'supplier_name'),
    planned_date:    getProcessField(i,'planned_date'),
    actual_date:     getProcessField(i,'actual_date'),
    status:          getProcessField(i,'status'),
    memo:            getProcessField(i,'memo'),
  })).filter(r=>r.process_name||r.factory_name);
  const res = await api('processes.save', {style_code:_currentProduct.style_code, rows});
  if(!res||!res.ok) { toast('保存失敗','error'); return; }
  toast('工程を保存しました','success');
}

// ===== 資材シートから資材マスタ登録ポップアップ =====
function openMatMasterPopup(defaultName, defaultNo) {
  // 検索ポップアップが開いていたら一旦閉じる
  document.getElementById('mat-search-ov')?.remove();

  const supOpts = '<option value="">-</option>'+
    (_masters.suppliers.length ? _masters.suppliers : _masters.partners.filter(p=>p.is_supplier===true||p.is_supplier==='TRUE'))
    .map(s=>`<option value="${esc(s.partner_name||s.supplier_name)}">${esc(s.partner_name||s.supplier_name)}</option>`).join('');

  const ov = document.createElement('div');
  ov.id = 'mat-master-ov';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9100;display:flex;align-items:center;justify-content:center';
  ov.innerHTML = `<div style="background:var(--c-surface);border-radius:12px;padding:24px;width:480px;max-width:95vw;box-shadow:0 8px 32px rgba(0,0,0,.3)">
    <h3 style="font-size:16px;font-weight:700;margin-bottom:16px">🧵 資材マスタに登録</h3>
    <div class="form-row form-row-2" style="margin-bottom:10px">
      <div class="form-group"><label>分類</label><select id="mp-cat">${CATEGORIES.map(c=>`<option value="${c}">${c}</option>`).join('')}</select></div>
      <div class="form-group"><label>品番</label><input type="text" id="mp-no" value="${esc(defaultNo||'')}" placeholder="品番（任意）"></div>
    </div>
    <div class="form-group" style="margin-bottom:10px"><label>品名 ★</label><input type="text" id="mp-name" value="${esc(defaultName||'')}" placeholder="品名を入力"></div>
    <div class="form-row form-row-2" style="margin-bottom:10px">
      <div class="form-group"><label>規格</label><input type="text" id="mp-spec" placeholder="例: 160cm巾"></div>
      <div class="form-group"><label>品質・組成</label><input type="text" id="mp-quality" placeholder="例: 綿100%"></div>
    </div>
    <div class="form-row form-row-3" style="margin-bottom:10px">
      <div class="form-group"><label>単位</label><select id="mp-unit">${UNITS.map(u=>`<option value="${u}">${u}</option>`).join('')}</select></div>
      <div class="form-group"><label>単価（円）</label><input type="number" id="mp-price" placeholder="0"></div>
      <div class="form-group"><label>仕入先</label><select id="mp-sup">${supOpts}</select></div>
    </div>
    <div class="form-group" style="margin-bottom:16px"><label>メーカー名</label><input type="text" id="mp-maker" placeholder="メーカー名"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn btn-secondary" onclick="document.getElementById('mat-master-ov').remove()">キャンセル</button>
      <button class="btn btn-primary" onclick="saveMatMasterFromPopup()">資材マスタに登録</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e=>{ if(e.target===ov) ov.remove(); });
  // 品名フィールドにフォーカス
  setTimeout(()=>document.getElementById('mp-name')?.focus(), 100);
}

async function saveMatMasterFromPopup() {
  const g = id => document.getElementById(id)?.value||'';
  if(!g('mp-name')) { toast('品名を入力してください','error'); return; }
  const res = await api('materials.upsert',{
    category:g('mp-cat'), product_no:g('mp-no'), product_name:g('mp-name'),
    spec:g('mp-spec'), quality:g('mp-quality'), unit:g('mp-unit'),
    unit_price:parseFloat(g('mp-price'))||0, supplier_name:g('mp-sup'), maker_name:g('mp-maker')
  });
  if(!res||!res.ok) { toast('保存失敗','error'); return; }
  toast('資材マスタに登録しました','success');
  document.getElementById('mat-master-ov').remove();
  // バックグラウンドで更新（UIをブロックしない）
  api('materials.list').then(m=>{ if(m) _masters.materials=m.items; });
}

// ===== PDF出力（ブラウザ印刷方式） =====
function openPrintWindow(html, title) {
  const win = window.open('','_blank','width=900,height=700');
  win.document.write(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
    <title>${title}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:Arial,'Hiragino Sans',sans-serif;font-size:9pt;color:#000;background:#fff}
      @page{margin:12mm 10mm}
      @media print{.no-print{display:none}.page-break{page-break-before:always}}
      table{border-collapse:collapse;width:100%}
      th{background:#1B2A4A;color:#fff;padding:4pt 5pt;text-align:left;font-size:8pt;white-space:nowrap}
      td{padding:3pt 5pt;border-bottom:0.5pt solid #ddd;vertical-align:top;font-size:8.5pt}
      tr:nth-child(even) td{background:#F7F6F3}
      .header{display:flex;justify-content:space-between;border-bottom:2pt solid #1B2A4A;padding-bottom:6pt;margin-bottom:10pt}
      .logo{font-size:16pt;font-weight:700;color:#1B2A4A}.logo span{color:#2B5CE6}
      .doc-title{font-size:13pt;font-weight:700;text-align:right;color:#1B2A4A}
      .doc-no{font-size:8pt;color:#888;text-align:right;margin-top:2pt}
      .sec-title{font-size:7.5pt;font-weight:700;color:#2B5CE6;border-bottom:0.5pt solid #2B5CE6;padding-bottom:2pt;margin:8pt 0 4pt;letter-spacing:0.05em}
      .grid2{display:grid;grid-template-columns:1fr 90pt;gap:10pt;margin-bottom:8pt}
      .info-row{display:flex;gap:4pt;margin-bottom:2pt;font-size:8.5pt}
      .lbl{color:#888;min-width:60pt;flex-shrink:0}.val{font-weight:500}
      .photo-box{width:88pt;height:108pt;border:0.5pt solid #ddd;border-radius:3pt;display:flex;align-items:center;justify-content:center;font-size:24pt;color:#ccc}
      .sign-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10pt;margin-top:10pt}
      .sign-box{border-top:0.5pt solid #888;padding-top:3pt;font-size:7.5pt;color:#888;text-align:center;height:28pt}
      .footer{border-top:0.5pt solid #ddd;padding-top:5pt;margin-top:10pt;display:flex;justify-content:space-between;font-size:7.5pt;color:#888}
      .total-row td{background:#EEF2FD!important;color:#2B5CE6;font-weight:700}
      .badge{display:inline-block;padding:1pt 5pt;border-radius:3pt;font-size:7.5pt}
      .print-btn{position:fixed;top:10px;right:10px;background:#2B5CE6;color:#fff;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-size:14px}
    </style>
  </head><body>
  <button class="print-btn no-print" onclick="window.print()">🖨️ 印刷・PDF保存</button>
  ${html}
  </body></html>`);
  win.document.close();
}

// ① 縫製仕様書_資材表
async function pdfSpec() {
  document.getElementById('pdf-menu').style.display='none';
  const p = _currentProduct;
  const matRes = await api('product_materials.get', {style_code:p.style_code});
  const mats = matRes?.items||[];
  const colors = _productColors.filter(c=>c.code);

  const colHeaders = colors.map((c,i)=>`<th style="width:38pt">Col.${i+1}<br><small style="font-size:7pt">${esc(c.code)}</small></th>`).join('');
  const imgHtml = p.image_url_1 ? `<img src="${esc(p.image_url_1)}" style="width:100%;height:100%;object-fit:cover">` : '📷';

  // 行を生成
  const rowsHtml = mats.map((m,i)=>{
    const colCells = colors.map((c,ci)=>`<td style="text-align:center">${esc(m['color'+(ci+1)+'_code']||'')}${m['color'+(ci+1)+'_name']?'<br><small style="font-size:7pt">'+esc(m['color'+(ci+1)+'_name'])+'</small>':''}</td>`).join('');
    return `<tr>
      <td style="text-align:center">${i+1}</td>
      <td>${esc(m.category||'')}</td>
      <td style="font-family:monospace;font-size:8pt">${esc(m.product_no||'')}</td>
      <td style="min-width:120pt">${esc(m.product_name||'')}</td>
      <td>${esc(m.spec||'')}</td>
      <td>${esc(m.maker_name||m.supplier_name||'')}</td>
      <td>${esc(m.usage_location||'')}</td>
      <td style="text-align:right">${esc(m.usage_quantity||'')}</td>
      <td>${esc(m.unit||'')}</td>
      ${colCells}
      <td>${esc(m.memo||'')}</td>
    </tr>`;
  });

  // 1ページあたり15行で分割
  const perPage = 15;
  let pages = '';
  for(let page=0; page*perPage<mats.length; page++) {
    const isFirst = page===0;
    const slice = rowsHtml.slice(page*perPage, (page+1)*perPage);
    const pageNum = `${page+1} / ${Math.ceil(mats.length/perPage)}`;
    pages += `${page>0?'<div class="page-break"></div>':''}
    <div class="header">
      <div><div class="logo">RL <span>OMS</span></div><div style="font-size:7pt;color:#888">Raises Lab Co., Ltd.</div></div>
      <div><div class="doc-title">縫製仕様書_資材表${page>0?' （続き）':''}</div>
      <div class="doc-no">${esc(p.brand_product_no||'')} / ${esc(p.style_code)} / ${new Date().toLocaleDateString('ja-JP')}</div></div>
    </div>
    ${isFirst ? `<div class="grid2" style="margin-bottom:10pt">
      <div>
        <div class="sec-title">製品情報</div>
        <div class="info-row"><span class="lbl">お客様品番：</span><span class="val" style="font-size:11pt;font-weight:700;color:#1B2A4A">${esc(p.brand_product_no||'')}</span></div>
        <div class="info-row"><span class="lbl">品名：</span><span class="val">${esc(p.product_name||'')}</span></div>
        <div class="info-row"><span class="lbl">ブランド：</span><span class="val">${esc(p.brand||'')}</span></div>
        <div class="info-row"><span class="lbl">取引先：</span><span class="val">${esc(p.client_name||'')}</span></div>
        <div class="info-row"><span class="lbl">年度/シーズン：</span><span class="val">${esc(p.year||'')} / ${esc(p.season||'')}</span></div>
        <div class="info-row"><span class="lbl">サイズ：</span><span class="val">${esc(p.size_range||'')}</span></div>
        <div class="info-row"><span class="lbl">縫製工場：</span><span class="val">${esc(p.factory_name||'')}</span></div>
        <div class="info-row"><span class="lbl">納期：</span><span class="val" style="color:#CC2A2A;font-weight:700">${esc(p.delivery_date||'')}</span></div>
      </div>
      <div><div class="photo-box">${p.image_url_1?`<img src="${esc(p.image_url_1)}" style="width:88pt;height:108pt;object-fit:cover;border-radius:3pt">`:'📷'}</div>
      <div style="font-size:7pt;color:#888;text-align:center;margin-top:2pt">製品写真</div></div>
    </div>` : ''}
    <div class="sec-title">資材明細${page>0?' （続き）':''}</div>
    <table>
      <thead><tr>
        <th style="width:16pt">No.</th><th style="width:36pt">分類</th>
        <th style="width:56pt">品番</th><th>品名</th>
        <th style="width:46pt">規格</th><th style="width:50pt">メーカー</th>
        <th style="width:46pt">使用箇所</th><th style="width:28pt;text-align:right">要尺</th><th style="width:18pt">単位</th>
        ${colHeaders}
        <th>備考</th>
      </tr></thead>
      <tbody>${slice.join('')}</tbody>
    </table>
    ${isFirst&&mats.length<=perPage ? `<div class="sign-row"><div class="sign-box">確認</div><div class="sign-box">承認</div><div class="sign-box">出力者</div></div>` : ''}
    <div class="footer"><span>Raises Lab Co., Ltd. — 機密文書</span><span>${pageNum}</span></div>`;
  }
  openPrintWindow(pages, '縫製仕様書_資材表');
}

// ② 製品情報シート（発注書兼用）
async function pdfProductSheet() {
  document.getElementById('pdf-menu').style.display='none';
  const p = _currentProduct;
  const qtyRes = await api('order_qty.get', {style_code:p.style_code});
  const qtyRows = qtyRes?.items||[];
  const colors = _productColors.filter(c=>c.code);
  const sizes  = (p.size_range||'').split('/').map(s=>s.trim()).filter(Boolean);

  // 発注数量テーブル
  let qtyHtml = '';
  if(colors.length && sizes.length) {
    const qtyMap = {};
    qtyRows.forEach(r=>{ if(!qtyMap[r.color_code]) qtyMap[r.color_code]={}; qtyMap[r.color_code][r.size_name]=Number(r.quantity)||0; });
    const colTotals = {}; sizes.forEach(s=>colTotals[s]=0);
    let grand=0;
    const qRows = colors.map(c=>{
      let rowTotal=0;
      const cells = sizes.map(s=>{ const v=(qtyMap[c.code]||{})[s]||0; rowTotal+=v; colTotals[s]+=v; grand+=v; return `<td style="text-align:right">${v||''}</td>`; }).join('');
      return `<tr><td>${esc(c.code)} ${esc(c.name)}</td>${cells}<td style="text-align:right;font-weight:700">${rowTotal}</td></tr>`;
    }).join('');
    const totCells = sizes.map(s=>`<td style="text-align:right;font-weight:700;color:#2B5CE6">${colTotals[s]}</td>`).join('');
    qtyHtml = `<div class="sec-title">発注数量（カラー × サイズ）</div>
    <table><thead><tr><th>カラー</th>${sizes.map(s=>`<th style="text-align:right">${esc(s)}</th>`).join('')}<th style="text-align:right">合計</th></tr></thead>
    <tbody>${qRows}<tr class="total-row"><td style="font-weight:700">合計</td>${totCells}<td style="text-align:right;font-weight:700;font-size:11pt">${grand}</td></tr></tbody></table>`;
  }

  const colorBadges = colors.map((c,i)=>`<span style="background:#F7F6F3;border:0.5pt solid #ddd;border-radius:3pt;padding:2pt 6pt;font-size:8pt;margin-right:4pt">Col.${i+1} ${esc(c.code)} ${esc(c.name)}</span>`).join('');

  const html = `<div class="header">
    <div><div class="logo">RL <span>OMS</span></div><div style="font-size:7pt;color:#888">Raises Lab Co., Ltd.</div></div>
    <div><div class="doc-title">製 品 情 報 シ ー ト</div><div class="doc-no">出力日：${new Date().toLocaleDateString('ja-JP')}</div></div>
  </div>
  <div class="grid2">
    <div>
      <div class="sec-title">基本情報</div>
      <div class="info-row"><span class="lbl">お客様品番：</span><span class="val" style="font-size:12pt;font-weight:700;color:#1B2A4A">${esc(p.brand_product_no||'')}</span></div>
      <div class="info-row"><span class="lbl">品名（日）：</span><span class="val">${esc(p.product_name||'')}</span></div>
      <div class="info-row"><span class="lbl">品名（英）：</span><span class="val">${esc(p.product_name_en||'')}</span></div>
      <div class="info-row"><span class="lbl">ブランド：</span><span class="val">${esc(p.brand||'')}</span></div>
      <div class="info-row"><span class="lbl">取引先：</span><span class="val">${esc(p.client_name||'')}</span></div>
      <div class="info-row"><span class="lbl">年度/シーズン：</span><span class="val">${esc(p.year||'')} / ${esc(p.season||'')}</span></div>
      <div class="info-row"><span class="lbl">サイズ展開：</span><span class="val">${esc(p.size_range||'')}</span></div>
      <div class="info-row"><span class="lbl">原産国：</span><span class="val">${esc(p.country_of_origin||'')}</span></div>
      <div class="info-row"><span class="lbl">縫製工場：</span><span class="val">${esc(p.factory_name||'')}</span></div>
      <div class="info-row"><span class="lbl">製品納期：</span><span class="val" style="color:#CC2A2A;font-weight:700">${esc(p.delivery_date||'')}</span></div>
      <div class="info-row"><span class="lbl">パタンナー：</span><span class="val">${esc(p.patternmaker||'')}</span></div>
      <div class="info-row"><span class="lbl">パターンNo.：</span><span class="val">${esc(p.pattern_no||'')}</span></div>
      <div class="info-row"><span class="lbl">社内コード：</span><span class="val" style="font-family:monospace;font-size:8pt">${esc(p.style_code||'')}</span></div>
    </div>
    <div>
      <div class="photo-box">${p.image_url_1?`<img src="${esc(p.image_url_1)}" style="width:88pt;height:108pt;object-fit:cover;border-radius:3pt">`:'📷'}</div>
      <div style="font-size:7pt;color:#888;text-align:center;margin-top:2pt">製品写真</div>
    </div>
  </div>
  <div class="sec-title">製品カラー</div>
  <div style="margin-bottom:8pt">${colorBadges}</div>
  ${qtyHtml}
  <div class="sign-row"><div class="sign-box">確認</div><div class="sign-box">承認</div><div class="sign-box">出力者</div></div>
  <div class="footer"><span>Raises Lab Co., Ltd. — 機密文書</span><span>1 / 1</span></div>`;
  openPrintWindow(html, '製品情報シート_'+p.brand_product_no);
}

// ③ 加工発注書（単価入力ポップアップ→PDF生成）
async function pdfProcessOrder() {
  document.getElementById('pdf-menu').style.display='none';
  if(!_processRows.length) {
    const res = await api('processes.get', {style_code:_currentProduct.style_code});
    _processRows = res?.items||[];
  }
  const checked = Array.from(document.querySelectorAll('.process-chk:checked')).map(c=>Number(c.dataset.idx));
  if(!checked.length) { toast('工程タブで発注する工程にチェックを入れてください','error'); return; }

  const selected = checked.map(i=>({
    ...(_processRows[i]||{}),
    process_name:  getProcessField(i,'process_name') ||_processRows[i]?.process_name||'',
    supplier_name: getProcessField(i,'supplier_name')||_processRows[i]?.supplier_name||'',
    factory_name:  getProcessField(i,'factory_name') ||_processRows[i]?.factory_name||'',
    planned_date:  getProcessField(i,'planned_date') ||_processRows[i]?.planned_date||'',
  }));

  // 発注先でグループ化
  const groups = {};
  selected.forEach(r=>{
    const key = r.supplier_name||r.factory_name||'直取引';
    if(!groups[key]) groups[key]={supplier:r.supplier_name||'直取引', factory:r.factory_name, processes:[]};
    groups[key].processes.push(r);
  });

  const colors = _productColors.filter(c=>c.code);

  // 単価入力ポップアップ
  const ov = document.createElement('div');
  ov.id='order-price-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9000;display:flex;align-items:center;justify-content:center';

  let groupsHtml = '';
  Object.entries(groups).forEach(([key,g],gi)=>{
    const processNames = g.processes.map(p=>p.process_name).join('・');
    groupsHtml += `<div style="margin-bottom:16px;padding:12px;border:1px solid var(--c-border);border-radius:8px">
      <div style="font-weight:600;margin-bottom:8px;color:var(--c-primary)">【発注先: ${esc(g.supplier)}】${esc(processNames)}</div>
      <p style="font-size:11px;color:var(--c-text2);margin-bottom:8px">カラーごとに工賃単価を入力してください（円/着）</p>
      ${colors.map((c,ci)=>`
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
          <span style="font-size:12px;min-width:120px">Col.${ci+1} ${esc(c.code)} ${esc(c.name)}</span>
          <input type="number" id="price-${gi}-${ci}" placeholder="0" min="0" style="width:100px;text-align:right"> 円/着
        </div>`).join('')}
    </div>`;
  });

  ov.innerHTML = `<div style="background:var(--c-surface);border-radius:12px;padding:24px;width:500px;max-width:95vw;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.25)">
    <h3 style="font-size:16px;font-weight:700;margin-bottom:16px">📄 加工発注書 — 工賃単価入力</h3>
    ${groupsHtml}
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn btn-secondary" onclick="document.getElementById('order-price-ov').remove()">キャンセル</button>
      <button class="btn btn-primary" onclick="generateProcessOrderPDF()">発注書を発行する</button>
    </div>
  </div>`;
  document.body.appendChild(ov);

  // グループ情報をグローバルに保持
  window._orderGroups = groups;
}

async function generateProcessOrderPDF() {
  const groups = window._orderGroups || {};
  const colors = _productColors.filter(c=>c.code);
  const p = _currentProduct;

  // 発注数量取得
  const qtyRes = await api('order_qty.get', {style_code:p.style_code});
  const qtyRows = qtyRes?.items||[];
  const sizes = (p.size_range||'').split('/').map(s=>s.trim()).filter(Boolean);
  const qtyMap = {};
  qtyRows.forEach(r=>{ if(!qtyMap[r.color_code]) qtyMap[r.color_code]={}; qtyMap[r.color_code][r.size_name]=Number(r.quantity)||0; });

  let pages='', pageIdx=0;
  const totalPages = Object.keys(groups).length;

  for(const [key,g] of Object.entries(groups)) {
    const gi = Object.keys(groups).indexOf(key);
    const noRes = await api('order_no.generate', {type:'K'});
    const orderNo = noRes?.order_no||'RL-S-??????';
    const processNames = g.processes.map(r=>r.process_name).join('・');
    const plannedDate = g.processes.map(r=>r.planned_date).filter(Boolean).sort().pop()||'';

    // 発注数量テーブル＋単価＋金額
    let grandTotal=0, grandAmt=0;
    const colTotals={}; sizes.forEach(s=>colTotals[s]=0);
    const colAmts={}; colors.forEach((c,ci)=>colAmts[ci]=0);

    const qRows = colors.map((c,ci)=>{
      const price = parseFloat(document.getElementById(`price-${gi}-${ci}`)?.value)||0;
      let rowTotal=0, rowAmt=0;
      const cells=sizes.map(s=>{ const v=(qtyMap[c.code]||{})[s]||0; rowTotal+=v; colTotals[s]+=v; return `<td style="text-align:right">${v||''}</td>`; }).join('');
      rowAmt = rowTotal*price;
      grandTotal+=rowTotal; grandAmt+=rowAmt;
      return `<tr><td>${esc(c.code)} ${esc(c.name)}</td>${cells}<td style="text-align:right;font-weight:700">${rowTotal}</td><td style="text-align:right">${price?price.toLocaleString()+'円':''}</td><td style="text-align:right;font-weight:700">${rowAmt?rowAmt.toLocaleString()+'円':''}</td></tr>`;
    }).join('');
    const totCells=sizes.map(s=>`<td style="text-align:right;font-weight:700;color:#2B5CE6">${colTotals[s]||''}</td>`).join('');

    // 履歴保存
    await api('order_history.save',{order_no:orderNo,order_type:'加工発注',style_code:p.style_code,supplier_name:g.supplier,process_names:processNames,total_qty:grandTotal,total_amount:grandAmt,memo:''});

    pages+=`${pageIdx>0?'<div class="page-break"></div>':''}
    <div class="header">
      <div><div class="logo">RL <span>OMS</span></div><div style="font-size:7pt;color:#888">Raises Lab Co., Ltd.</div></div>
      <div><div class="doc-title">加 工 発 注 書</div><div class="doc-no">発注No.: ${esc(orderNo)} / 発注日: ${new Date().toLocaleDateString('ja-JP')}</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4pt 16pt;margin-bottom:8pt;padding-bottom:6pt;border-bottom:0.5pt solid #ddd;font-size:8.5pt">
      <div class="info-row"><span class="lbl">発注先：</span><span class="val" style="font-weight:700;font-size:11pt">${esc(g.supplier)}</span></div>
      <div class="info-row"><span class="lbl">品番：</span><span class="val" style="font-weight:700">${esc(p.brand_product_no||'')}</span></div>
      <div class="info-row"><span class="lbl">投入先：</span><span class="val">${esc(g.factory||g.supplier)}</span></div>
      <div class="info-row"><span class="lbl">品名：</span><span class="val">${esc(p.product_name||'')}</span></div>
      <div class="info-row"><span class="lbl">加工内容：</span><span class="val" style="color:#2B5CE6;font-weight:700">${esc(processNames)}</span></div>
      <div class="info-row"><span class="lbl">納期：</span><span class="val" style="color:#CC2A2A;font-weight:700">${esc(plannedDate)}</span></div>
    </div>
    <div class="sec-title">発注数量・工賃</div>
    <table><thead><tr><th>カラー</th>${sizes.map(s=>`<th style="text-align:right">${esc(s)}</th>`).join('')}<th style="text-align:right">合計</th><th style="text-align:right">工賃単価</th><th style="text-align:right">金額</th></tr></thead>
    <tbody>${qRows}<tr class="total-row"><td>合計</td>${totCells}<td style="text-align:right;font-weight:700;color:#2B5CE6">${grandTotal}</td><td></td><td style="text-align:right;font-weight:700;font-size:11pt;color:#2B5CE6">${grandAmt.toLocaleString()}円</td></tr></tbody></table>
    <div style="margin-top:10pt"><div class="sec-title">備考・指示事項</div>
    <div style="border:0.5pt solid #ddd;border-radius:3pt;padding:6pt;min-height:36pt;color:#888;font-size:8.5pt">（指示事項）</div></div>
    <div class="sign-row"><div class="sign-box">確認</div><div class="sign-box">承認</div><div class="sign-box">出力者</div></div>
    <div class="footer"><span>Raises Lab Co., Ltd. — 機密文書 / ${esc(orderNo)}</span><span>${pageIdx+1} / ${totalPages}</span></div>`;
    pageIdx++;
  }

  document.getElementById('order-price-ov')?.remove();
  openPrintWindow(pages,'加工発注書_'+p.brand_product_no);
  toast('発注書を発行しました（履歴保存済）','success');
}

// ④ 工程表
async function pdfProcessSheet() {
  document.getElementById('pdf-menu').style.display='none';
  if(!_processRows.length) {
    const res = await api('processes.get', {style_code:_currentProduct.style_code});
    _processRows = res?.items||[];
  }
  const p = _currentProduct;
  const statusColor = {pending:'#888', in_progress:'#B05C00', completed:'#0F6E56', cancelled:'#CC2A2A'};
  const statusBg    = {pending:'#F7F6F3', in_progress:'#FFF3E0', completed:'#E1F5EE', cancelled:'#FEF2F2'};

  const rows = _processRows.map((r,i)=>{
    const s=r.status||'pending';
    return `<tr>
      <td style="text-align:center">${r.seq||i+1}</td>
      <td><strong>${esc(r.process_name||'')}</strong></td>
      <td>${esc(r.process_type||'')}</td>
      <td>${esc(r.factory_name||'')}</td>
      <td>${esc(r.supplier_name||'')}${r.supplier_name&&r.supplier_name!==r.factory_name?'<br><small style="color:#888">（間接取引）</small>':r.factory_name?'<br><small style="color:#888">（直取引）</small>':''}</td>
      <td style="font-size:7.5pt">${esc(r.factory_address||'')}</td>
      <td>${esc(r.planned_date||'')}</td>
      <td>${esc(r.actual_date||'')}</td>
      <td><span style="background:${statusBg[s]};color:${statusColor[s]};padding:1pt 5pt;border-radius:3pt;font-size:7.5pt;font-weight:700">${PROCESS_STATUS[s]||s}</span></td>
      <td style="font-size:8pt">${esc(r.memo||'')}</td>
    </tr>`;
  }).join('');

  const html = `<div class="header">
    <div><div class="logo">RL <span>OMS</span></div></div>
    <div><div class="doc-title">工 程 表</div><div class="doc-no">${esc(p.brand_product_no||'')} / ${new Date().toLocaleDateString('ja-JP')}</div></div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:2pt 16pt;margin-bottom:8pt;padding-bottom:6pt;border-bottom:0.5pt solid #ddd;font-size:8.5pt">
    <div class="info-row"><span class="lbl">品番：</span><span class="val" style="font-weight:700">${esc(p.brand_product_no||'')}</span></div>
    <div class="info-row"><span class="lbl">品名：</span><span class="val">${esc(p.product_name||'')}</span></div>
    <div class="info-row"><span class="lbl">縫製工場：</span><span class="val">${esc(p.factory_name||'')}</span></div>
    <div class="info-row"><span class="lbl">最終納期：</span><span class="val" style="color:#CC2A2A;font-weight:700">${esc(p.delivery_date||'')}</span></div>
  </div>
  <table>
    <thead><tr>
      <th style="width:18pt">順</th><th style="min-width:56pt">工程名</th>
      <th style="width:44pt">種別</th><th style="min-width:70pt">加工場（実作業）</th>
      <th style="min-width:70pt">発注先（仕入先）</th><th style="min-width:60pt">住所</th>
      <th style="width:54pt">予定納期</th><th style="width:54pt">実績完了日</th>
      <th style="width:42pt">状態</th><th>備考</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="sign-row"><div class="sign-box">確認</div><div class="sign-box">承認</div><div class="sign-box">出力者</div></div>
  <div class="footer"><span>Raises Lab Co., Ltd. — 機密文書</span><span>1 / 1</span></div>`;
  openPrintWindow(html, '工程表_'+p.brand_product_no);
}

// ===== ① 製品発注ロット管理 =====

async function renderOrderLotsTab() {
  const res = await api('order_lots.get', {style_code:_currentProduct.style_code});
  _orderLots = res?.items||[];
  if(!_orderLots.length) _orderLots = [{lot_no:1,lot_name:'初回',order_date:'',order_no:'',status:'draft',memo:'',quantities:[]}];

  const prodColors = _productColors.filter(c=>c.code);
  const sizes = (_currentProduct.size_range||'').split('/').map(s=>s.trim()).filter(Boolean);

  let html = `<div style="margin-bottom:12px;display:flex;align-items:center;gap:10px">
    <h3 style="flex:1">📋 製品発注書</h3>
    <button class="btn btn-secondary btn-sm" onclick="addOrderLot()">＋ 追加発注を追加</button>
    <button class="btn btn-primary btn-sm" onclick="pdfOrderLots()">📄 発注書PDF発行</button>
  </div>
  <p style="font-size:11px;color:var(--c-text2);margin-bottom:10px">PDF発行するロットにチェックを入れてください</p>`;

  _orderLots.forEach((lot,li)=>{
    const qtyMap = {};
    (lot.quantities||[]).forEach(q=>{ if(!qtyMap[q.color_code]) qtyMap[q.color_code]={}; qtyMap[q.color_code][q.size_name]=Number(q.quantity)||0; });

    const lotLabel = lot.lot_no===1 ? '初回発注' : `追加発注-${lot.lot_no-1}`;
    const lotBadgeStyle = lot.lot_no===1
      ? 'background:#EEF2FD;color:#2B5CE6;border:1px solid #2B5CE6'
      : 'background:#FFF3E0;color:#854F0B;border:1px solid #F9A825';

    html += `<div class="section-card" style="margin-bottom:14px;border:1.5px solid ${lot.lot_no===1?'#2B5CE6':'#F9A825'}">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <input type="checkbox" id="lot-chk-${li}" checked style="width:16px;height:16px" title="このロットをPDFに含める">
        <span style="padding:3px 10px;border-radius:4px;font-size:13px;font-weight:700;${lotBadgeStyle}">${lotLabel}</span>
        <select id="lot-status-${li}" style="font-size:12px" onchange="_orderLots[${li}].status=this.value">
          <option value="draft" ${lot.status==='draft'?'selected':''}>下書き</option>
          <option value="ordered" ${lot.status==='ordered'?'selected':''}>発注済</option>
          <option value="completed" ${lot.status==='completed'?'selected':''}>完了</option>
        </select>
        <input type="date" id="lot-date-${li}" value="${esc(lot.order_date||'')}" style="font-size:12px" title="発注日">
        <input type="text" id="lot-no-${li}" value="${esc(lot.order_no||'')}" placeholder="発注書No." style="font-size:12px;width:130px">
        <input type="text" id="lot-memo-${li}" value="${esc(lot.memo||'')}" placeholder="備考" style="font-size:12px;flex:1">
        ${li>0?`<button class="del-btn" onclick="delOrderLot(${li})">✕</button>`:''}
      </div>
      <div style="overflow-x:auto"><table class="material-table">
        <thead><tr><th>カラー</th>${sizes.map(s=>`<th style="text-align:right">${esc(s)}</th>`).join('')}<th style="text-align:right;color:var(--c-primary)">小計</th></tr></thead>
        <tbody>
          ${prodColors.map((c,ci)=>{
            let rowTotal=0;
            const cells=sizes.map(s=>{const v=(qtyMap[c.code]||{})[s]||0;rowTotal+=v;return`<td><input type="number" min="0" data-lot="${li}" data-col="${c.code}" data-sz="${s}" value="${v||''}" placeholder="0" oninput="updateLotTotal(${li})" style="width:55px;text-align:right;border:none;background:transparent;font-size:13px"></td>`;}).join('');
            return`<tr><td style="font-weight:600">${esc(c.code)} ${esc(c.name)}</td>${cells}<td id="lot-row-${li}-${ci}" style="text-align:right;font-weight:700;color:var(--c-primary);padding-right:8px">${rowTotal||'-'}</td></tr>`;
          }).join('')}
          <tr style="background:#EEF2FD"><td style="font-weight:700;color:#2B5CE6">合計</td>
            ${sizes.map(s=>`<td id="lot-col-${li}-${s}" style="text-align:right;font-weight:700;color:#2B5CE6">-</td>`).join('')}
            <td id="lot-grand-${li}" style="text-align:right;font-size:15px;font-weight:700;color:#2B5CE6">-</td>
          </tr>
        </tbody>
      </table></div>
    </div>`;
  });

  // 全ロット合計
  if(_orderLots.length>1) {
    html+=`<div class="section-card" style="background:#EEF2FD;border:1px solid #2B5CE6">
      <h4 style="color:#2B5CE6;margin-bottom:8px">📊 全ロット累計</h4>
      <div id="lot-total-summary" style="font-size:13px"></div>
    </div>`;
  }

  document.getElementById('fs-body').innerHTML=html;
  _orderLots.forEach((_,li)=>updateLotTotal(li));
}

function updateLotTotal(li) {
  const prodColors=_productColors.filter(c=>c.code);
  const sizes=(_currentProduct.size_range||'').split('/').map(s=>s.trim()).filter(Boolean);
  const colTotals={}; sizes.forEach(s=>colTotals[s]=0);
  let grand=0;
  prodColors.forEach((c,ci)=>{
    let rowTotal=0;
    sizes.forEach(s=>{const el=document.querySelector(`[data-lot="${li}"][data-col="${c.code}"][data-sz="${s}"]`);const v=parseInt(el?.value)||0;rowTotal+=v;colTotals[s]+=v;grand+=v;});
    const rt=document.getElementById(`lot-row-${li}-${ci}`);if(rt)rt.textContent=rowTotal||'-';
  });
  sizes.forEach(s=>{const ct=document.getElementById(`lot-col-${li}-${s}`);if(ct)ct.textContent=colTotals[s]||'-';});
  const gt=document.getElementById(`lot-grand-${li}`);if(gt)gt.textContent=grand?grand.toLocaleString()+'着':'-';
}

async function pdfOrderLots() {
  const p = _currentProduct;
  const prodColors = _productColors.filter(c=>c.code);
  const sizes = (p.size_range||'').split('/').map(s=>s.trim()).filter(Boolean);

  // まず現在の入力内容を保存
  await saveOrderLots();

  // 保存後にGASから最新データを取得
  const lotRes = await api('order_lots.get',{style_code:p.style_code});
  const savedLots = lotRes?.items||[];

  // チェックされたロットのみ（_orderLotsのインデックスと一致）
  const checkedIdxs = _orderLots.map((_,li)=>li).filter(li=>document.getElementById('lot-chk-'+li)?.checked);
  if(!checkedIdxs.length){ toast('PDF発行するロットにチェックを入れてください','error'); return; }

  const clientName = _masters.customers.find(c=>c.customer_id===p.client_id)?.customer_name || p.client_id || '';

  let pages = '', pageIdx = 0;

  for(const li of checkedIdxs) {
    const lot = savedLots[li] || _orderLots[li];
    if(!lot) continue;

    const lotLabel = lot.lot_no===1 ? '初回発注' : `追加発注-${lot.lot_no-1}`;

    // 数量はGAS保存済みデータから取得
    const qtyMap = {};
    (lot.quantities||[]).forEach(q=>{
      if(!qtyMap[q.color_code]) qtyMap[q.color_code]={};
      qtyMap[q.color_code][q.size_name] = Number(q.quantity)||0;
    });

    // DOMからも補完（未保存の場合）
    prodColors.forEach(c=>{
      sizes.forEach(s=>{
        const el = document.querySelector(`[data-lot="${li}"][data-col="${c.code}"][data-sz="${s}"]`);
        if(el) {
          const v = parseInt(el.value)||0;
          if(v>0) { if(!qtyMap[c.code]) qtyMap[c.code]={}; qtyMap[c.code][s]=v; }
        }
      });
    });

    const colTotals = {}; sizes.forEach(s=>colTotals[s]=0);
    let grandTotal = 0;

    const qRows = prodColors.map(c=>{
      let rowTotal = 0;
      const cells = sizes.map(s=>{
        const v = (qtyMap[c.code]||{})[s]||0;
        rowTotal += v; colTotals[s] += v; grandTotal += v;
        return `<td style="text-align:right">${v||''}</td>`;
      }).join('');
      return `<tr><td>${esc(c.code)} ${esc(c.name)}</td>${cells}<td style="text-align:right;font-weight:700;color:#2B5CE6">${rowTotal||''}</td></tr>`;
    }).join('');

    const totCells = sizes.map(s=>`<td style="text-align:right;font-weight:700;color:#2B5CE6">${colTotals[s]||''}</td>`).join('');

    const noRes = await api('order_no.generate',{type:'P'});
    const orderNo = noRes?.order_no || '2606-P-0001';
    const orderDate = lot.order_date || document.getElementById('lot-date-'+li)?.value || '';
    const memo      = lot.memo       || document.getElementById('lot-memo-'+li)?.value  || '';

    pages += `${pageIdx>0?'<div class="page-break"></div>':''}
    <div class="header">
      <div><div class="logo">RL <span>OMS</span></div><div style="font-size:7pt;color:#888">Raises Lab Co., Ltd.</div></div>
      <div>
        <div class="doc-title">製 品 発 注 書 <span style="font-size:10pt;color:#854F0B">${esc(lotLabel)}</span></div>
        <div class="doc-no">発注No.: ${esc(orderNo)} / 発注日: ${new Date().toLocaleDateString('ja-JP')}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4pt 16pt;margin-bottom:8pt;padding-bottom:6pt;border-bottom:0.5pt solid #ddd;font-size:8.5pt">
      <div class="info-row"><span class="lbl">発注先（得意先）：</span><span class="val" style="font-weight:700;font-size:11pt">${esc(clientName)}</span></div>
      <div class="info-row"><span class="lbl">品番：</span><span class="val" style="font-weight:700">${esc(p.brand_product_no||'')}</span></div>
      <div class="info-row"><span class="lbl">品名：</span><span class="val">${esc(p.product_name||'')}</span></div>
      <div class="info-row"><span class="lbl">ブランド：</span><span class="val">${esc(p.brand||'')}</span></div>
      <div class="info-row"><span class="lbl">年度/シーズン：</span><span class="val">${esc(String(p.year||''))} ${esc(p.season||'')}</span></div>
      <div class="info-row"><span class="lbl">発注日：</span><span class="val">${esc(orderDate)}</span></div>
    </div>
    <div class="sec-title">発注数量　合計：<strong style="font-size:12pt;color:#2B5CE6">${grandTotal.toLocaleString()}着</strong></div>
    <table>
      <thead><tr>
        <th>カラー</th>
        ${sizes.map(s=>`<th style="text-align:right">${esc(s)}</th>`).join('')}
        <th style="text-align:right">合計</th>
      </tr></thead>
      <tbody>
        ${qRows}
        <tr class="total-row">
          <td style="font-weight:700">合計</td>${totCells}
          <td style="text-align:right;font-weight:700;font-size:12pt;color:#2B5CE6">${grandTotal.toLocaleString()}</td>
        </tr>
      </tbody>
    </table>
    ${memo?`<div style="margin-top:8pt"><div class="sec-title">備考</div>
    <div style="border:0.5pt solid #ddd;border-radius:3pt;padding:6pt;font-size:8.5pt">${esc(memo)}</div></div>`:''}
    <div class="sign-row"><div class="sign-box">確認</div><div class="sign-box">承認</div><div class="sign-box">出力者</div></div>
    <div class="footer"><span>Raises Lab Co., Ltd. / ${esc(orderNo)}</span><span>${pageIdx+1} / ${checkedIdxs.length}</span></div>`;
    pageIdx++;
  }

  openPrintWindow(pages, '製品発注書_'+p.brand_product_no);
  toast('製品発注書を発行しました','success');
}

function addOrderLot() {
  _orderLots.push({lot_no:_orderLots.length+1,lot_name:'追加',order_date:'',order_no:'',status:'draft',memo:'',quantities:[]});
  renderOrderLotsTab();
}
function delOrderLot(li) { _orderLots.splice(li,1); renderOrderLotsTab(); }

async function saveOrderLots() {
  const prodColors=_productColors.filter(c=>c.code);
  const sizes=(_currentProduct.size_range||'').split('/').map(s=>s.trim()).filter(Boolean);
  const lots = _orderLots.map((lot,li)=>{
    const qtys=[];
    prodColors.forEach(c=>{sizes.forEach(s=>{
      const el=document.querySelector(`[data-lot="${li}"][data-col="${c.code}"][data-sz="${s}"]`);
      const v=parseInt(el?.value)||0;
      if(v>0) qtys.push({color_code:c.code,color_name:c.name,size_name:s,quantity:v});
    });});
    return {
      lot_no:li+1, lot_name:lot.lot_name||'',
      order_date:document.getElementById(`lot-date-${li}`)?.value||'',
      order_no:  document.getElementById(`lot-no-${li}`)?.value||'',
      status:    document.getElementById(`lot-status-${li}`)?.value||'draft',
      memo:      document.getElementById(`lot-memo-${li}`)?.value||'',
      quantities:qtys
    };
  });
  const res=await api('order_lots.save',{style_code:_currentProduct.style_code,lots});
  if(!res||!res.ok){toast('保存失敗','error');return;}
  toast('発注ロットを保存しました','success');
}

// ===== ② 生産進捗管理 =====
let _progressRows=[];
const PROGRESS_STATUS={pending:'未着手',in_progress:'進行中',completed:'完了',cancelled:'中止'};

async function renderProgressTab() {
  const res=await api('progress.get',{style_code:_currentProduct.style_code});
  _progressRows=res?.items||[];

  // 工程データから初期化（未登録なら工程タブのデータを参照）
  if(!_progressRows.length) {
    const pRes=await api('processes.get',{style_code:_currentProduct.style_code});
    const procs=pRes?.items||[];
    _progressRows=procs.map((p,i)=>({
      process_seq:i+1,process_name:p.process_name,factory_name:p.factory_name,
      input_qty:'',defect_qty:'',defect_reason:'',good_qty:'',
      planned_date:p.planned_date,actual_date:'',status:'pending',memo:''
    }));
  }

  // 累計B品率
  const totalIn=_progressRows.reduce((a,r)=>a+(Number(r.input_qty)||0),0);
  const totalDef=_progressRows.reduce((a,r)=>a+(Number(r.defect_qty)||0),0);
  const defRate=totalIn>0?(totalDef/totalIn*100).toFixed(1):0;

  let html=`
  <div style="background:#EEF2FD;border-radius:8px;padding:12px;margin-bottom:14px;font-size:12px;line-height:1.8">
    <strong>📌 使い方：</strong>
    ① 工程タブで工程を登録すると、下の表に自動で工程リストが作られます<br>
    ② 各工程が完了したら <strong>「投入数」</strong>（その工程に入れた着数）と <strong>「B品数」</strong>（不良品数）を入力します<br>
    ③ 良品数・B品率が自動計算されます　④「実績完了日」と「状態」を更新して保存します
  </div>
  <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px;flex-wrap:wrap">
    <h3>📈 生産進捗管理</h3>
    <div style="display:flex;gap:10px;align-items:center;padding:8px 14px;background:${defRate>3?'#FEF2F2':'#E1F5EE'};border-radius:6px">
      <span style="font-size:12px">累計B品率：</span>
      <strong style="color:${defRate>3?'#CC2A2A':'#0F6E56'};font-size:18px">${defRate}%</strong>
      <span style="font-size:11px;color:var(--c-text2)">B品${totalDef}着 / 投入${totalIn}着</span>
    </div>
  </div>
  <div style="overflow-x:auto"><table class="material-table">
    <thead><tr>
      <th>順</th><th>工程名</th><th>加工場</th>
      <th style="text-align:right">投入数</th><th style="text-align:right">B品数</th>
      <th style="min-width:120px">B品理由</th><th style="text-align:right;color:#0F6E56">良品数</th>
      <th style="width:90px">B品率</th>
      <th>予定納期</th><th>実績完了日</th>
      <th style="width:70px">状態</th><th>備考</th>
    </tr></thead>
    <tbody>`;

  _progressRows.forEach((r,i)=>{
    const goodQty=Math.max(0,(Number(r.input_qty)||0)-(Number(r.defect_qty)||0));
    const rowRate=r.input_qty>0?((Number(r.defect_qty)||0)/(Number(r.input_qty)||1)*100).toFixed(1):'';
    html+=`<tr>
      <td style="text-align:center">${r.process_seq||i+1}</td>
      <td><strong>${esc(r.process_name||'')}</strong></td>
      <td>${esc(r.factory_name||'')}</td>
      <td><input type="number" id="pg-in-${i}" value="${r.input_qty||''}" placeholder="0" oninput="calcGoodQty(${i})" style="width:60px;text-align:right;border:none;background:transparent"></td>
      <td><input type="number" id="pg-def-${i}" value="${r.defect_qty||''}" placeholder="0" oninput="calcGoodQty(${i})" style="width:55px;text-align:right;border:none;background:transparent;color:#CC2A2A"></td>
      <td><input type="text" id="pg-reason-${i}" value="${esc(r.defect_reason||'')}" placeholder="理由" style="min-width:100px"></td>
      <td id="pg-good-${i}" style="text-align:right;font-weight:700;color:#0F6E56">${goodQty||'-'}</td>
      <td id="pg-rate-${i}" style="text-align:right;color:${rowRate>3?'#CC2A2A':'#888'}">${rowRate?rowRate+'%':''}</td>
      <td><input type="date" id="pg-plan-${i}" value="${esc(r.planned_date||'')}" style="font-size:11px"></td>
      <td><input type="date" id="pg-act-${i}"  value="${esc(r.actual_date||'')}"  style="font-size:11px"></td>
      <td><select id="pg-stat-${i}" style="font-size:11px">
        ${Object.entries(PROGRESS_STATUS).map(([v,l])=>`<option value="${v}" ${r.status===v?'selected':''}>${l}</option>`).join('')}
      </select></td>
      <td><input type="text" id="pg-memo-${i}" value="${esc(r.memo||'')}" placeholder="備考"></td>
    </tr>`;
  });

  html+=`</tbody></table></div>`;
  document.getElementById('fs-body').innerHTML=html;
}

function calcGoodQty(i) {
  const inQ=parseInt(document.getElementById('pg-in-'+i)?.value)||0;
  const def=parseInt(document.getElementById('pg-def-'+i)?.value)||0;
  const good=Math.max(0,inQ-def);
  const el=document.getElementById('pg-good-'+i);
  if(el) el.textContent=good||'-';
  const rate=inQ>0?(def/inQ*100).toFixed(1):'';
  const re=document.getElementById('pg-rate-'+i);
  if(re){re.textContent=rate?rate+'%':'';re.style.color=parseFloat(rate)>3?'#CC2A2A':'#888';}
}

async function saveProgress() {
  const rows=_progressRows.map((_,i)=>{
    const inQ=parseInt(document.getElementById('pg-in-'+i)?.value)||0;
    const def=parseInt(document.getElementById('pg-def-'+i)?.value)||0;
    return {
      process_seq:_progressRows[i].process_seq||i+1,
      process_name:_progressRows[i].process_name||'',
      factory_name:_progressRows[i].factory_name||'',
      input_qty:inQ, defect_qty:def, defect_reason:document.getElementById('pg-reason-'+i)?.value||'',
      good_qty:Math.max(0,inQ-def),
      planned_date:document.getElementById('pg-plan-'+i)?.value||'',
      actual_date: document.getElementById('pg-act-'+i)?.value||'',
      status:      document.getElementById('pg-stat-'+i)?.value||'pending',
      memo:        document.getElementById('pg-memo-'+i)?.value||'',
    };
  });
  const res=await api('progress.save',{style_code:_currentProduct.style_code,rows});
  if(!res||!res.ok){toast('保存失敗','error');return;}
  toast('進捗を保存しました','success');
}

// ===== ③ 原価・見積タブ =====
async function renderCostTab() {
  const p = _currentProduct;
  // 全データを並列取得
  const [matRes, ceRes, procRes, lotRes] = await Promise.all([
    api('product_materials.get', {style_code:p.style_code}),
    api('cost_estimate.get',     {style_code:p.style_code}),
    api('processes.get',         {style_code:p.style_code}),
    api('order_lots.get',        {style_code:p.style_code}),
  ]);

  const mats      = (matRes?.items||[]).filter(r=>r.product_name||r.product_no);
  const ce        = ceRes?.item||{};
  const procs     = procRes?.items||[];
  const lots      = lotRes?.items||[];
  const prodColors= _productColors.filter(c=>c.code);
  const allSizes  = (p.size_range||'').split('/').map(s=>s.trim()).filter(Boolean);

  // 工程外注費を集計
  const procCosts = {
    sewing:     0, // 工賃
    cutting:    0, // 外注裁断賃
    button:     0, // 釦付/釦ホール
    dyeing:     0, // 染め/洗い加工
    outsource1: 0, // 外注加工-1
    outsource2: 0, // 外注加工-2
    outsource3: 0, // 外注加工-3
    inhouse1:   0, // 社内加工-1
    inhouse2:   0, // 社内加工-2
    inhouse3:   0, // 社内加工-3
    washing:    0, // 洗い仕上
    embroidery: 0, // 手振刺繍
    piecework:  0, // 内職
    name:       0, // ネーム賃
    other_proc: 0, // その他（工程）
  };
  procs.forEach(proc=>{
    const cost = parseFloat(proc.outsource_cost)||0;
    if(!cost) return;
    const type = proc.process_type||'';
    const name = proc.process_name||'';
    if(type==='縫製' || name.includes('縫製')) procCosts.sewing += cost;
    else if(name.includes('裁断')) procCosts.cutting += cost;
    else if(name.includes('釦') || name.includes('ボタン')) procCosts.button += cost;
    else if(name.includes('染') || name.includes('洗い')) procCosts.dyeing += cost;
    else if(name.includes('刺繍')) procCosts.embroidery += cost;
    else if(name.includes('ネーム')) procCosts.name += cost;
    else if(name.includes('内職')) procCosts.piecework += cost;
    else if(name.includes('洗い仕上')) procCosts.washing += cost;
    else if(!procCosts.outsource1 || name.includes('加工-1')) procCosts.outsource1 += cost;
    else if(!procCosts.outsource2 || name.includes('加工-2')) procCosts.outsource2 += cost;
    else procCosts.outsource3 += cost;
  });

  // 発注数（全ロット合計）
  const qtyMap = {}; // {color_code: {size: qty}}
  lots.forEach(lot=>{
    (lot.quantities||[]).forEach(q=>{
      if(!qtyMap[q.color_code]) qtyMap[q.color_code]={};
      qtyMap[q.color_code][q.size_name] = (qtyMap[q.color_code][q.size_name]||0) + (Number(q.quantity)||0);
    });
  });

  // カラー別 資材費計算（対応サイズ・カラーコードグループを正確に処理）
  const calcMatCostByColor = () => {
    const costs = {};
    prodColors.forEach(c=>costs[c.code]=0);

    mats.forEach(mat=>{
      const usageQty = parseFloat(mat.usage_quantity)||0;
      const lossRate = (parseFloat(mat.loss_rate)||0)/100;
      const appStr   = mat.applicable_sizes||'';
      const appSizes = appStr.split('/').map(s=>s.trim()).filter(s=>s&&s!=='全サイズ');
      const targetSizes = appSizes.length ? appSizes : allSizes;

      // 資材カラーコードでグループ化
      const matColorGroups = {};
      for(let n=1;n<=7;n++){
        const mc = mat['col'+n+'_matcode']||'';
        const pr = parseFloat(mat['col'+n+'_price'])||0;
        const pc = prodColors[n-1];
        if(!mc||!pr||!pc) continue;
        if(!matColorGroups[mc]) matColorGroups[mc]={price:pr, prodCodes:[]};
        matColorGroups[mc].prodCodes.push(pc.code);
      }

      Object.entries(matColorGroups).forEach(([mc, {price, prodCodes}])=>{
        // この資材カラーに対応する製品カラーの着数合計
        let totalQty = 0;
        prodCodes.forEach(pc=>{
          const sizeQty = qtyMap[pc]||{};
          targetSizes.forEach(sz=>{ totalQty += Number(sizeQty[sz]||0); });
        });
        if(!totalQty) return;
        const unitCost = usageQty * price * (1+lossRate);
        // 各製品カラーに按分
        prodCodes.forEach(pc=>{ costs[pc] = (costs[pc]||0) + unitCost; });
      });
    });
    return costs;
  };

  const matCostByColor = calcMatCostByColor();
  const matCostAvg = prodColors.length
    ? Math.round(Object.values(matCostByColor).reduce((a,b)=>a+b,0)/prodColors.length)
    : 0;

  // 保存済み設定
  const calcMethod   = ce.calc_method||'average';
  const sewingCost   = parseFloat(ce.sewing_cost)||procCosts.sewing;
  const cuttingCost  = parseFloat(ce.cutting_cost)||procCosts.cutting;
  const buttonCost   = parseFloat(ce.button_cost)||procCosts.button;
  const dyeingCost   = parseFloat(ce.dyeing_cost)||procCosts.dyeing;
  const outsource1   = parseFloat(ce.outsource1)||procCosts.outsource1;
  const outsource2   = parseFloat(ce.outsource2)||procCosts.outsource2;
  const outsource3   = parseFloat(ce.outsource3)||procCosts.outsource3;
  const inhouse1     = parseFloat(ce.inhouse1)||procCosts.inhouse1;
  const inhouse2     = parseFloat(ce.inhouse2)||procCosts.inhouse2;
  const inhouse3     = parseFloat(ce.inhouse3)||procCosts.inhouse3;
  const washingCost  = parseFloat(ce.washing_cost)||procCosts.washing;
  const embroidery   = parseFloat(ce.embroidery)||procCosts.embroidery;
  const piecework    = parseFloat(ce.piecework)||procCosts.piecework;
  const nameCost     = parseFloat(ce.name_cost)||procCosts.name;
  const sampleCost   = parseFloat(ce.sample_cost)||0;
  const patternCost  = parseFloat(ce.pattern_cost)||0;
  const importCost   = parseFloat(ce.import_cost)||0;
  const otherCost    = parseFloat(ce.other_cost)||0;

  // 工程から転記された費目のみ表示（値がある項目のみ）＋保存済み手入力項目
  const PROC_ITEMS = [
    {key:'sewing_cost',  label:'工賃/製品買',   procVal:procCosts.sewing,     savedVal:parseFloat(ce.sewing_cost)||0},
    {key:'cutting_cost', label:'外注裁断賃',     procVal:procCosts.cutting,    savedVal:parseFloat(ce.cutting_cost)||0},
    {key:'button_cost',  label:'釦付/釦ホール',  procVal:procCosts.button,     savedVal:parseFloat(ce.button_cost)||0},
    {key:'dyeing_cost',  label:'染め/洗い加工',  procVal:procCosts.dyeing,     savedVal:parseFloat(ce.dyeing_cost)||0},
    {key:'outsource1',   label:'外注加工-1',     procVal:procCosts.outsource1, savedVal:parseFloat(ce.outsource1)||0},
    {key:'outsource2',   label:'外注加工-2',     procVal:procCosts.outsource2, savedVal:parseFloat(ce.outsource2)||0},
    {key:'outsource3',   label:'外注加工-3',     procVal:procCosts.outsource3, savedVal:parseFloat(ce.outsource3)||0},
    {key:'inhouse1',     label:'社内加工-1',     procVal:procCosts.inhouse1,   savedVal:parseFloat(ce.inhouse1)||0},
    {key:'inhouse2',     label:'社内加工-2',     procVal:procCosts.inhouse2,   savedVal:parseFloat(ce.inhouse2)||0},
    {key:'inhouse3',     label:'社内加工-3',     procVal:procCosts.inhouse3,   savedVal:parseFloat(ce.inhouse3)||0},
    {key:'washing_cost', label:'洗い仕上',        procVal:procCosts.washing,    savedVal:parseFloat(ce.washing_cost)||0},
    {key:'embroidery',   label:'手振刺繍',        procVal:procCosts.embroidery, savedVal:parseFloat(ce.embroidery)||0},
    {key:'piecework',    label:'内職',            procVal:procCosts.piecework,  savedVal:parseFloat(ce.piecework)||0},
    {key:'name_cost',    label:'ネーム賃',        procVal:procCosts.name,       savedVal:parseFloat(ce.name_cost)||0},
  ];
  // 手入力専用費目（常に表示）
  const MANUAL_ITEMS = [
    {key:'sample_cost',  label:'サンプル費用割', val:parseFloat(ce.sample_cost)||0},
    {key:'pattern_cost', label:'パターン費用割', val:parseFloat(ce.pattern_cost)||0},
    {key:'import_cost',  label:'輸入経費',       val:parseFloat(ce.import_cost)||0},
    {key:'other_cost',   label:'その他',         val:parseFloat(ce.other_cost)||0},
  ];
  // 追加手入力行（保存済み extra_items）
  let extraItems = [];
  try { extraItems = JSON.parse(ce.extra_items||'[]'); } catch(e){}

  // 工程転記 or 保存済みで値があるものを表示
  const visibleProcItems = PROC_ITEMS.filter(i=>i.procVal>0||i.savedVal>0);
  const allVal = item => item.savedVal || item.procVal || 0;

  const totalProcCost = [...visibleProcItems, ...MANUAL_ITEMS, ...extraItems]
    .reduce((a,i)=>a+(parseFloat(allVal(i))||parseFloat(i.val)||0),0);
  const totalCostAvg  = Math.round(matCostAvg + totalProcCost);

  let html = `<div style="display:grid;grid-template-columns:1fr 320px;gap:16px;align-items:start">
  <!-- 左：設定 -->
  <div>
    <div class="section-card" style="margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <h3>💰 原価・見積設定</h3>
        <select id="ce-method" style="font-size:12px" onchange="renderCostTab()">
          <option value="average" ${calcMethod==='average'?'selected':''}>平均法</option>
          <option value="bycolor" ${calcMethod==='bycolor'?'selected':''}>カラー毎</option>
        </select>
      </div>
      <table class="master-table" style="font-size:12px">
        <thead><tr><th>費目</th><th style="text-align:right">円/着</th><th style="width:55px">入力元</th></tr></thead>
        <tbody>
          <tr style="background:#EEF2FD"><td colspan="3" style="font-weight:600;color:#2B5CE6">📦 資材費</td></tr>
          ${calcMethod==='bycolor'
            ? prodColors.map(c=>`<tr><td style="padding-left:12px">${esc(c.name)}</td>
                <td style="text-align:right;font-weight:600">${Math.round(matCostByColor[c.code]||0).toLocaleString()}</td>
                <td style="font-size:10px;color:#888">自動</td></tr>`).join('')
            : `<tr><td style="padding-left:12px">資材費（平均）</td>
                <td style="text-align:right;font-weight:600">${matCostAvg.toLocaleString()}</td>
                <td style="font-size:10px;color:#888">自動</td></tr>`
          }
          <tr style="background:#EEF2FD"><td colspan="3" style="font-weight:600;color:#2B5CE6">🔧 工程加工費（工程タブから転記）</td></tr>
          ${visibleProcItems.length===0
            ? `<tr><td colspan="3" style="text-align:center;color:var(--c-text3);font-size:11px;padding:8px">工程タブで外注費を入力してください</td></tr>`
            : visibleProcItems.map(item=>`<tr>
              <td style="padding-left:12px">${item.label}</td>
              <td><input type="number" id="ce-${item.key}" value="${allVal(item)||''}" placeholder="0"
                style="width:100%;text-align:right;font-size:12px" oninput="updateCostTotal()"></td>
              <td style="font-size:10px;color:#2B5CE6">工程</td>
            </tr>`).join('')
          }
          <tr style="background:#EEF2FD"><td colspan="3" style="font-weight:600;color:#854F0B">✏️ 手入力費目</td></tr>
          ${MANUAL_ITEMS.map(item=>`<tr>
            <td style="padding-left:12px">${item.label}</td>
            <td><input type="number" id="ce-${item.key}" value="${item.val||''}" placeholder="0"
              style="width:100%;text-align:right;font-size:12px" oninput="updateCostTotal()"></td>
            <td style="font-size:10px;color:#854F0B">手入力</td>
          </tr>`).join('')}
          <tbody id="ce-extra-tbody">
          ${extraItems.map((item,ei)=>`<tr id="ce-extra-${ei}">
            <td style="padding-left:12px"><input type="text" id="ce-extra-label-${ei}" value="${esc(item.label||'')}" placeholder="費目名" style="width:100%;font-size:11px"></td>
            <td><input type="number" id="ce-extra-val-${ei}" value="${item.val||''}" placeholder="0" style="width:100%;text-align:right;font-size:12px" oninput="updateCostTotal()"></td>
            <td><button class="del-btn" style="font-size:10px" onclick="removeExtraItem(${ei})">✕</button></td>
          </tr>`).join('')}
          </tbody>
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3" style="padding:4px 8px">
              <button class="btn btn-secondary btn-sm" style="font-size:11px" onclick="addExtraItem()">＋ 費目を追加</button>
            </td>
          </tr>
          <tr style="background:#1B2A4A;color:white">
            <td style="font-weight:700">原価合計</td>
            <td id="ce-total" data-mat-cost="${matCostAvg}" data-proc-cost="${totalProcCost}" style="text-align:right;font-weight:700;font-size:14px">${totalCostAvg.toLocaleString()}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
    <div class="section-card">
      <h3 style="margin-bottom:10px">💴 見積・売価設定</h3>
      <div class="form-row form-row-3">
        <div class="form-group"><label>売価（円）</label>
          <input type="number" id="ce-sell" value="${sellPrice||''}" placeholder="0" style="font-size:14px;font-weight:700" oninput="updateCostTotal()">
        </div>
        <div class="form-group"><label>利益率（%）</label>
          <input type="number" id="ce-markup" value="${markupRate||''}" placeholder="0" oninput="calcSellFromMarkup()">
        </div>
        <div class="form-group"><label>備考</label>
          <input type="text" id="ce-memo" value="${esc(ce.memo||'')}">
        </div>
      </div>
      <div id="ce-gross" style="font-size:13px;color:var(--c-text2);margin-top:6px"></div>
    </div>
  </div>

  <!-- 右：サマリー -->
  <div class="section-card">
    <h3 style="margin-bottom:10px">📊 資材着単価明細</h3>
    <table class="master-table" style="font-size:11px">
      <thead><tr><th>品名</th><th>規格</th><th>対象</th>${prodColors.map(c=>`<th style="text-align:right">${esc(c.name)}</th>`).join('')}</tr></thead>
      <tbody>
        ${mats.map(mat=>{
          const qty  = parseFloat(mat.usage_quantity)||0;
          const loss = (parseFloat(mat.loss_rate)||0)/100;
          const appStr  = mat.applicable_sizes||'';
          const appSizes= appStr.split('/').map(s=>s.trim()).filter(s=>s&&s!=='全サイズ');
          const cells = prodColors.map((c,ci)=>{
            const pr = parseFloat(mat['col'+(ci+1)+'_price'])||0;
            const cost = pr ? Math.round(qty*pr*(1+loss)) : 0;
            return`<td style="text-align:right">${cost?cost.toLocaleString():'-'}</td>`;
          }).join('');
          return`<tr>
            <td>${esc(mat.product_name||'')}</td>
            <td style="font-size:10px">${esc(mat.spec||'')}</td>
            <td style="font-size:10px;color:var(--c-text2)">${appSizes.length?appSizes.join('/'):''}</td>
            ${cells}
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    <div style="margin-top:12px;display:flex;gap:6px">
      <button class="btn btn-secondary btn-sm" onclick="saveCostEstimate()">💾 保存</button>
      <button class="btn btn-primary btn-sm" onclick="pdfCostEstimate()">📄 見積原価表PDF</button>
    </div>
  </div>
</div>`;

  document.getElementById('fs-body').innerHTML = html;
  updateCostTotal();
}

function updateCostTotal() {
  const procKeys = ['sewing_cost','cutting_cost','button_cost','dyeing_cost',
    'outsource1','outsource2','outsource3','inhouse1','inhouse2','inhouse3',
    'washing_cost','embroidery','piecework','name_cost'];
  const manualKeys = ['sample_cost','pattern_cost','import_cost','other_cost'];
  let total = 0;
  [...procKeys,...manualKeys].forEach(k=>{
    total += parseFloat(document.getElementById('ce-'+k)?.value)||0;
  });
  // 追加費目
  document.querySelectorAll('[id^="ce-extra-val-"]').forEach(el=>{
    total += parseFloat(el.value)||0;
  });
  // 資材費（現在の表示から取得）
  const matCell = document.querySelector('#ce-total');
  const matText = matCell?.closest('table')?.querySelector('tbody td[style*="font-weight:600"]');
  // 資材費はgetの計算値を使う（DOMからは取れないのでtotalのみ更新）
  const totalEl = document.getElementById('ce-total');
  // 資材費を保持するために前回の合計から加工費のみ差し替え
  const prevTotal = parseInt((totalEl?.textContent||'0').replace(/[^0-9]/g,''))||0;
  // 資材費 = 前回合計 - 前回加工費（近似）→ 正確にはrenderCostTabで計算
  if(totalEl) {
    // 加工費のみ更新（資材費は renderCostTab が設定した値を保持）
    totalEl.dataset.procCost = total;
    const mat = parseInt(totalEl.dataset.matCost||'0')||0;
    const grand = mat + total;
    totalEl.textContent = grand.toLocaleString();
    // 粗利表示
    const sell = parseFloat(document.getElementById('ce-sell')?.value)||0;
    const gross = sell ? sell - grand : 0;
    const rate  = sell ? (gross/sell*100).toFixed(1) : 0;
    const ge = document.getElementById('ce-gross');
    if(ge && sell) ge.innerHTML = `粗利：<strong style="color:${gross>=0?'#0F6E56':'#CC2A2A'}">${gross.toLocaleString()}円</strong>（粗利率 ${rate}%）`;
    else if(ge) ge.innerHTML = '';
  }
}

function calcSellFromMarkup() {
  const markup = parseFloat(document.getElementById('ce-markup')?.value)||0;
  const total  = parseInt((document.getElementById('ce-total')?.textContent||'0').replace(/[^0-9]/g,''))||0;
  if(markup && total) {
    const sell = Math.round(total*(1+markup/100));
    const el = document.getElementById('ce-sell');
    if(el) el.value = sell;
  }
  updateCostTotal();
}

function addExtraItem() {
  const tbody = document.getElementById('ce-extra-tbody'); if(!tbody) return;
  const ei = tbody.querySelectorAll('tr').length;
  const tr = document.createElement('tr');
  tr.id = 'ce-extra-'+ei;
  tr.innerHTML = `
    <td style="padding-left:12px"><input type="text" id="ce-extra-label-${ei}" placeholder="費目名" style="width:100%;font-size:11px"></td>
    <td><input type="number" id="ce-extra-val-${ei}" placeholder="0" style="width:100%;text-align:right;font-size:12px" oninput="updateCostTotal()"></td>
    <td><button class="del-btn" style="font-size:10px" onclick="removeExtraItem(${ei})">✕</button></td>`;
  tbody.appendChild(tr);
}

function removeExtraItem(ei) {
  document.getElementById('ce-extra-'+ei)?.remove();
  updateCostTotal();
}

async function saveCostEstimate() {
  const g = id => parseFloat(document.getElementById(id)?.value)||0;
  // 追加費目を収集
  const extraItems = [];
  document.querySelectorAll('[id^="ce-extra-label-"]').forEach(el=>{
    const ei = el.id.replace('ce-extra-label-','');
    const label = el.value||'';
    const val   = parseFloat(document.getElementById('ce-extra-val-'+ei)?.value)||0;
    if(label||val) extraItems.push({label, val});
  });

  const res = await api('cost_estimate.save',{
    style_code:  _currentProduct.style_code,
    calc_method: document.getElementById('ce-method')?.value||'average',
    sewing_cost: g('ce-sewing_cost'), cutting_cost:g('ce-cutting_cost'),
    button_cost: g('ce-button_cost'), sample_cost: g('ce-sample_cost'),
    pattern_cost:g('ce-pattern_cost'),dyeing_cost: g('ce-dyeing_cost'),
    import_cost: g('ce-import_cost'), outsource1:  g('ce-outsource1'),
    outsource2:  g('ce-outsource2'),  outsource3:  g('ce-outsource3'),
    inhouse1:    g('ce-inhouse1'),    inhouse2:    g('ce-inhouse2'),
    inhouse3:    g('ce-inhouse3'),    washing_cost:g('ce-washing_cost'),
    embroidery:  g('ce-embroidery'),  piecework:   g('ce-piecework'),
    name_cost:   g('ce-name_cost'),   other_cost:  g('ce-other_cost'),
    markup_rate: g('ce-markup'),      sell_price:  g('ce-sell'),
    extra_items: JSON.stringify(extraItems),
    memo: document.getElementById('ce-memo')?.value||'',
  });
  if(!res||!res.ok){toast('保存失敗','error');return;}
  clearTabCache(_currentProduct.style_code);
  toast('原価・見積を保存しました','success');
}

async function pdfCostEstimate() {
  const p = _currentProduct;
  const matRes = await api('product_materials.get',{style_code:p.style_code});
  const mats   = (matRes?.items||[]).filter(r=>r.product_name||r.product_no);
  const prodColors = _productColors.filter(c=>c.code);
  const allSizes   = (p.size_range||'').split('/').map(s=>s.trim()).filter(Boolean);

  const g = id => parseFloat(document.getElementById(id)?.value)||0;
  const ITEMS = [
    {label:'工賃/製品買',   val:g('ce-sewing_cost')},
    {label:'外注裁断賃',    val:g('ce-cutting_cost')},
    {label:'釦付/釦ホール', val:g('ce-button_cost')},
    {label:'サンプル費用割',val:g('ce-sample_cost')},
    {label:'パターン費用割',val:g('ce-pattern_cost')},
    {label:'染め/洗い加工', val:g('ce-dyeing_cost')},
    {label:'輸入経費',      val:g('ce-import_cost')},
    {label:'外注加工-1',    val:g('ce-outsource1')},
    {label:'外注加工-2',    val:g('ce-outsource2')},
    {label:'外注加工-3',    val:g('ce-outsource3')},
    {label:'社内加工-1',    val:g('ce-inhouse1')},
    {label:'社内加工-2',    val:g('ce-inhouse2')},
    {label:'社内加工-3',    val:g('ce-inhouse3')},
    {label:'洗い仕上',      val:g('ce-washing_cost')},
    {label:'手振刺繍',      val:g('ce-embroidery')},
    {label:'内職',          val:g('ce-piecework')},
    {label:'ネーム賃',      val:g('ce-name_cost')},
    {label:'その他',        val:g('ce-other_cost')},
  ];
  const procTotal = ITEMS.reduce((a,i)=>a+(i.val||0),0);

  // 資材費（カラー別）
  const matRows = mats.map(mat=>{
    const qty=parseFloat(mat.usage_quantity)||0;const loss=(parseFloat(mat.loss_rate)||0)/100;
    const cells=prodColors.map((_,ci)=>{const pr=parseFloat(mat['col'+(ci+1)+'_price'])||0;return`<td style="text-align:right">${pr?Math.round(qty*pr*(1+loss)).toLocaleString():'-'}</td>`;}).join('');
    return`<tr><td>${esc(mat.product_name||'')}</td><td>${esc(mat.spec||'')}</td><td>${qty}${esc(mat.unit||'')}</td>${cells}</tr>`;
  }).join('');

  const matTotals = prodColors.map((_,ci)=>{
    let t=0;mats.forEach(mat=>{const qty=parseFloat(mat.usage_quantity)||0;const loss=(parseFloat(mat.loss_rate)||0)/100;const pr=parseFloat(mat['col'+(ci+1)+'_price'])||0;t+=Math.round(qty*pr*(1+loss));});return t;
  });
  const avgMat = matTotals.length?Math.round(matTotals.reduce((a,b)=>a+b,0)/matTotals.length):0;
  const total  = avgMat + procTotal;
  const sell   = g('ce-sell');
  const gross  = sell ? sell - total : 0;

  const html=`
    <div class="header">
      <div><div class="logo">RL <span>OMS</span></div></div>
      <div><div class="doc-title">見 積 原 価 表</div><div class="doc-no">${esc(p.brand_product_no||'')} / ${new Date().toLocaleDateString('ja-JP')}</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4pt;margin-bottom:8pt;font-size:8.5pt">
      <div>品番：<strong>${esc(p.brand_product_no||'')}</strong></div>
      <div>品名：${esc(p.product_name||'')}</div>
      <div>ブランド：${esc(p.brand||'')}</div>
      <div>年度/シーズン：${esc(String(p.year||''))} ${esc(p.season||'')}</div>
    </div>
    <div class="sec-title">資材着単価明細（カラー別）</div>
    <table style="margin-bottom:8pt">
      <thead><tr><th>品名</th><th>規格</th><th>用尺</th>${prodColors.map(c=>`<th style="text-align:right">${esc(c.name)}</th>`).join('')}</tr></thead>
      <tbody>${matRows}</tbody>
      <tfoot><tr style="background:#EEF2FD;font-weight:700">
        <td colspan="3" style="text-align:right;color:#2B5CE6">資材費小計</td>
        ${matTotals.map(t=>`<td style="text-align:right;color:#2B5CE6">${t.toLocaleString()}</td>`).join('')}
      </tr></tfoot>
    </table>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8pt">
      <div>
        <div class="sec-title">加工費明細</div>
        <table>
          ${ITEMS.filter(i=>i.val>0).map(i=>`<tr><td>${i.label}</td><td style="text-align:right">${i.val.toLocaleString()}円</td></tr>`).join('')}
          <tr style="font-weight:700;background:#EEF2FD"><td>加工費合計</td><td style="text-align:right">${procTotal.toLocaleString()}円</td></tr>
        </table>
      </div>
      <div>
        <div class="sec-title">原価サマリー</div>
        <table>
          <tr><td>資材費（平均）</td><td style="text-align:right">${avgMat.toLocaleString()}円/着</td></tr>
          <tr><td>加工費合計</td><td style="text-align:right">${procTotal.toLocaleString()}円/着</td></tr>
          <tr style="font-weight:700;background:#1B2A4A;color:white"><td>原価合計</td><td style="text-align:right">${total.toLocaleString()}円/着</td></tr>
          ${sell?`<tr><td>売価</td><td style="text-align:right">${sell.toLocaleString()}円</td></tr>
          <tr style="font-weight:700;color:${gross>=0?'#0F6E56':'#CC2A2A'}"><td>粗利</td><td style="text-align:right">${gross.toLocaleString()}円（${sell?(gross/sell*100).toFixed(1):0}%）</td></tr>`:''}
        </table>
      </div>
    </div>
    <div class="sign-row"><div class="sign-box">確認</div><div class="sign-box">承認</div><div class="sign-box">出力者</div></div>
    <div class="footer"><span>Raises Lab Co., Ltd.</span><span>1 / 1</span></div>`;
  openPrintWindow(html, '見積原価表_'+p.brand_product_no);
}

async function renderHistoryTab() {
  const res=await api('order_history.list',{style_code:_currentProduct.style_code});
  const items=res?.items||[];

  const typeColor={
    '資材発注(量産)':'b-blue','資材発注(サンプル)':'b-amber',
    '加工発注':'b-green','資材発注':'b-blue'
  };

  let html=`<div style="margin-bottom:12px;display:flex;align-items:center;gap:10px">
    <h3>📜 発注履歴</h3>
    <span style="font-size:12px;color:var(--c-text2)">${items.length}件</span>
  </div>`;

  if(!items.length){
    html+='<div class="empty-state"><div class="icon">📄</div><p>発注履歴がありません</p></div>';
  } else {
    html+=`<table class="master-table">
      <thead><tr>
        <th>発注No.</th><th>種別</th><th>発注先</th><th>加工内容/工程</th>
        <th style="text-align:right">合計数</th><th style="text-align:right">金額</th>
        <th>発注日</th><th>担当</th>
      </tr></thead>
      <tbody>
        ${items.slice().reverse().map(h=>{
          const tc=typeColor[h.order_type]||'b-blue';
          const isSample=h.order_type?.includes('サンプル');
          return`<tr>
            <td><code style="font-size:11px">${esc(h.order_no)}</code></td>
            <td>
              <span class="badge ${tc}" style="font-size:11px">${esc(h.order_type||'')}</span>
              ${isSample?'':'<span class="badge badge-in_production" style="font-size:10px;margin-left:3px">量産</span>'}
            </td>
            <td>${esc(h.supplier_name||'')}</td>
            <td style="font-size:11px;color:var(--c-text2)">${esc(h.process_names||'')}</td>
            <td style="text-align:right">${h.total_qty?Number(h.total_qty).toLocaleString()+'着':'-'}</td>
            <td style="text-align:right;font-weight:600">${h.total_amount?Number(h.total_amount).toLocaleString()+'円':'-'}</td>
            <td style="font-size:11px">${esc((h.issued_at||'').substring(0,10))}</td>
            <td style="font-size:11px">${esc(h.issued_by||'')}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
  }
  document.getElementById('fs-body').innerHTML=html;
}

// ===== 資材発注書 =====
async function pdfMaterialOrder() {
  document.getElementById('pdf-menu').style.display='none';

  // 現在の入力値を_materialRowsに保存してから処理
  _materialRows.forEach((_,idx)=>{
    _matFields.forEach(f=>{ if(_materialRows[idx]) _materialRows[idx][f]=getMF(idx,f)||_materialRows[idx][f]||''; });
    for(let n=1;n<=_matColorCols;n++){
      if(_materialRows[idx]) {
        _materialRows[idx]['col'+n+'_matcode'] = getMF(idx,'col'+n+'_matcode')||_materialRows[idx]['col'+n+'_matcode']||'';
        _materialRows[idx]['col'+n+'_price']   = getMF(idx,'col'+n+'_price')  ||_materialRows[idx]['col'+n+'_price']  ||'';
      }
    }
  });

  let rows = _materialRows.filter(r=>r.product_name||r.product_no);
  if(!rows.length) {
    const res = await api('product_materials.get',{style_code:_currentProduct.style_code});
    rows = (res?.items||[]).filter(r=>r.product_name||r.product_no);
  }

  // チェックされた行を取得
  const checked = Array.from(document.querySelectorAll('.mat-order-chk:checked')).map(c=>Number(c.dataset.idx));
  const targetRows = checked.length > 0 ? checked.map(i=>rows[i]).filter(Boolean) : rows;

  if(!targetRows.length){ toast('資材シートにデータがありません','error'); return; }

  // 発注数量データ取得
  const qtyRes = await api('order_qty.get',{style_code:_currentProduct.style_code});
  const qtyData = qtyRes?.items||[];
  const p = _currentProduct;
  const prodColors = _productColors.filter(c=>c.code);
  const allSizes = (p.size_range||'').split('/').map(s=>s.trim()).filter(Boolean);

  // カラー×サイズ数量マップ: {color_code: {size: qty}}
  const qtyMap = {};
  qtyData.forEach(q=>{
    if(!qtyMap[q.color_code]) qtyMap[q.color_code]={};
    qtyMap[q.color_code][q.size_name] = Number(q.quantity)||0;
  });

  // 計算関数（matRowのデータを直接参照）
  const calcOrderQty = (matRow) => {
    const usageQty  = parseFloat(matRow.usage_quantity)||0;
    const lossRate  = (parseFloat(matRow.loss_rate)||0)/100;
    const appStr    = matRow.applicable_sizes||'';
    const appSizes  = appStr.split('/').map(s=>s.trim()).filter(s=>s&&s!=='全サイズ');
    const targetSizes = appSizes.length ? appSizes : allSizes;

    // 資材カラーコードでグループ化（_materialRowsのデータを直接使用）
    const matColorGroups = {};
    for(let n=1;n<=7;n++){
      const mc = matRow['col'+n+'_matcode']||'';
      if(!mc) continue;
      const pc = prodColors[n-1];
      if(!pc) continue;
      if(!matColorGroups[mc]) matColorGroups[mc]=[];
      matColorGroups[mc].push({colIdx:n, prodColor:pc});
    }

    const results = [];
    Object.entries(matColorGroups).forEach(([matCode, cols])=>{
      let totalQty = 0;
      const prodColorNames = [];
      cols.forEach(({prodColor})=>{
        prodColorNames.push(prodColor.name);
        const sizeQty = qtyMap[prodColor.code]||{};
        targetSizes.forEach(sz=>{ totalQty += Number(sizeQty[sz]||0); });
      });
      const orderQty = Math.ceil(totalQty * usageQty * (1+lossRate));
      const price = parseFloat(matRow['col'+cols[0].colIdx+'_price'])||0;
      results.push({matCode, prodColorNames:prodColorNames.join('・'), totalQty, orderQty, price, amount:orderQty*price});
    });

    // カラー設定なし→全カラー合計
    if(!results.length) {
      let totalQty = 0;
      targetSizes.forEach(sz=>{ prodColors.forEach(pc=>{ totalQty += Number((qtyMap[pc.code]||{})[sz]||0); }); });
      const orderQty = Math.ceil(totalQty * usageQty * (1+lossRate));
      results.push({matCode:'', prodColorNames:'全カラー', totalQty, orderQty, price:0, amount:0});
    }
    return results;
  };

  // 仕入先でグループ化
  const supplierGroups = {};
  targetRows.forEach(r=>{
    const sup = r.supplier_name||'未設定';
    if(!supplierGroups[sup]) supplierGroups[sup]=[];
    supplierGroups[sup].push(r);
  });

  // ポップアップ表示
  const ov = document.createElement('div');
  ov.id='mat-order-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9000;display:flex;align-items:center;justify-content:center';

  // 出荷先候補（自社 + 仕入先 + 得意先）
  const SELF = {name:'Raises Lab Co., Ltd.（自社）', zip:'615-0000', address:'京都市右京区西京極...', tel:'075-755-7973'};
  const shipCandidates = [
    SELF,
    ..._masters.partners.map(p=>({name:p.partner_name, zip:p.zip||'', address:p.address||'', tel:p.tel||''})),
    ..._masters.customers.map(c=>({name:c.customer_name, zip:c.zip||'', address:c.address||'', tel:c.tel||''})),
  ];
  const shipDatalist = shipCandidates.map(s=>`<option value="${esc(s.name)}">`).join('');
  window._shipCandidates = shipCandidates;

  let popHtml = `<div style="background:var(--c-surface);border-radius:12px;padding:24px;width:760px;max-width:95vw;max-height:85vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.25)">
    <h3 style="font-size:16px;font-weight:700;margin-bottom:4px">📦 資材発注書 — 発注内容確認</h3>
    <p style="font-size:11px;color:var(--c-text2);margin-bottom:14px">数量・単価を確認・訂正してから発注書を発行してください</p>
    <datalist id="ship-list">${shipDatalist}</datalist>`;

  Object.entries(supplierGroups).forEach(([sup, supRows], gi)=>{
    popHtml += `<div style="margin-bottom:20px;border:1.5px solid var(--c-border);border-radius:10px;padding:14px">
      <div style="font-weight:700;font-size:13px;margin-bottom:10px;color:var(--c-primary)">【発注先: ${esc(sup)}】</div>

      <!-- ヘッダー入力エリア -->
      <div style="display:grid;grid-template-columns:100px 1fr 1fr 100px;gap:10px;margin-bottom:12px;padding:10px;background:var(--c-bg);border-radius:6px">
        <div>
          <label style="font-size:11px;font-weight:600;color:var(--c-text2)">サンプル/量産</label>
          <select id="pop-type-${gi}" style="width:100%;margin-top:4px;font-size:12px;font-weight:600">
            <option value="量産">量産</option>
            <option value="サンプル">サンプル</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px;font-weight:600;color:#CC2A2A">📅 納期 ★</label>
          <input type="date" id="pop-delivery-${gi}" style="width:100%;margin-top:4px;font-size:13px;font-weight:700;color:#CC2A2A;border:1.5px solid #CC2A2A;border-radius:4px;padding:4px 6px">
        </div>
        <div>
          <label style="font-size:11px;font-weight:600;color:#2B5CE6">🚚 出荷先 ★</label>
          <input type="text" id="pop-ship-name-${gi}" placeholder="出荷先名" list="ship-list" style="width:100%;margin-top:4px;font-size:12px;font-weight:600;border:1.5px solid #2B5CE6;border-radius:4px;padding:4px 6px" oninput="onShipNameInput(${gi})">
        </div>
        <div>
          <label style="font-size:11px;font-weight:600;color:var(--c-text2)">備考</label>
          <input type="text" id="pop-note-${gi}" placeholder="指示事項など" style="width:100%;margin-top:4px;font-size:12px">
        </div>
      </div>
      <!-- 出荷先詳細 -->
      <div style="display:grid;grid-template-columns:80px 1fr 1fr;gap:8px;margin-bottom:12px" id="pop-ship-detail-${gi}">
        <div>
          <label style="font-size:10px;color:var(--c-text2)">郵便番号</label>
          <input type="text" id="pop-ship-zip-${gi}" placeholder="0000000" maxlength="8" style="width:100%;font-size:11px" oninput="onShipZipInput(${gi})">
        </div>
        <div>
          <label style="font-size:10px;color:var(--c-text2)">住所</label>
          <input type="text" id="pop-ship-addr-${gi}" placeholder="住所" style="width:100%;font-size:11px">
        </div>
        <div>
          <label style="font-size:10px;color:var(--c-text2)">TEL</label>
          <input type="text" id="pop-ship-tel-${gi}" placeholder="TEL" style="width:100%;font-size:11px">
        </div>
      </div>

      <!-- 明細テーブル -->
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead><tr style="background:var(--c-bg)">
          <th style="padding:4px 6px;text-align:left">品番</th>
          <th style="padding:4px 6px;text-align:left">品名</th>
          <th style="padding:4px 6px">規格</th>
          <th style="padding:4px 6px">資材カラー/製品カラー</th>
          <th style="padding:4px 6px">サイズ</th>
          <th style="padding:4px 6px;text-align:right">数量</th>
          <th style="padding:4px 6px">単位</th>
          <th style="padding:4px 6px;text-align:right">単価</th>
          <th style="padding:4px 6px;text-align:right">金額</th>
        </tr></thead>
        <tbody>`;

    supRows.forEach((r,ri)=>{
      const results = calcOrderQty(r);
      results.forEach((res,resi)=>{
        const rowId = `r${gi}_${ri}_${resi}`;
        popHtml += `<tr style="border-bottom:0.5px solid var(--c-border)">
          <td style="padding:3px 5px;font-family:monospace;font-size:10px">${esc(r.product_no||'')}</td>
          <td style="padding:3px 5px">${esc(r.product_name||'')}</td>
          <td style="padding:3px 5px">${esc(r.spec||'')}</td>
          <td style="padding:3px 5px">${esc(res.matCode||'')}${res.matCode?' / ':''}<span style="color:var(--c-text2)">${esc(res.prodColorNames)}</span></td>
          <td style="padding:3px 5px;font-size:10px">${esc(r.applicable_sizes||'全サイズ')}</td>
          <td style="padding:2px"><input type="number" id="pop-qty-${rowId}" value="${res.orderQty}" min="0" style="width:60px;text-align:right;font-size:11px" oninput="updatePopAmount('${rowId}')"></td>
          <td style="padding:3px 5px">${esc(r.unit||'')}</td>
          <td style="padding:2px"><input type="number" id="pop-price-${rowId}" value="${res.price||''}" min="0" style="width:70px;text-align:right;font-size:11px" oninput="updatePopAmount('${rowId}')" placeholder="単価"></td>
          <td style="padding:3px 5px;text-align:right;font-weight:600" id="pop-amt-${rowId}">${res.amount?res.amount.toLocaleString()+'円':'-'}</td>
        </tr>`;
      });
    });

    popHtml += `</tbody></table></div>`;
  });

  popHtml += `<div style="display:flex;gap:8px;justify-content:space-between;margin-top:12px">
    <p style="font-size:11px;color:var(--c-text2)">※ 数量・単価は手動で訂正できます</p>
    <div style="display:flex;gap:8px">
      <button class="btn btn-secondary" onclick="document.getElementById('mat-order-ov').remove()">キャンセル</button>
      <button class="btn btn-primary" onclick="generateMaterialOrderPDF()">📄 発注書を発行</button>
    </div>
  </div></div>`;

  ov.innerHTML = popHtml;
  document.body.appendChild(ov);
  // ★ 背景クリックでは閉じない（行消失防止）
  window._matOrderGroups = supplierGroups;
}

function updatePopAmount(rowId) {
  const qty   = parseFloat(document.getElementById('pop-qty-'+rowId)?.value)||0;
  const price = parseFloat(document.getElementById('pop-price-'+rowId)?.value)||0;
  const el    = document.getElementById('pop-amt-'+rowId);
  if(el) el.textContent = qty&&price ? Math.round(qty*price).toLocaleString()+'円' : '-';
}

function onShipNameInput(gi) {
  const name = document.getElementById('pop-ship-name-'+gi)?.value||'';
  const found = (window._shipCandidates||[]).find(s=>s.name===name);
  if(found) {
    const z = document.getElementById('pop-ship-zip-'+gi);
    const a = document.getElementById('pop-ship-addr-'+gi);
    const t = document.getElementById('pop-ship-tel-'+gi);
    if(z && !z.value) z.value = found.zip||'';
    if(a && !a.value) a.value = found.address||'';
    if(t && !t.value) t.value = found.tel||'';
  }
}

async function onShipZipInput(gi) {
  const zip = (document.getElementById('pop-ship-zip-'+gi)?.value||'').replace(/[^0-9]/g,'');
  if(zip.length!==7) return;
  try {
    const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip}`);
    const data = await res.json();
    if(data.results) {
      const r=data.results[0];
      const a=document.getElementById('pop-ship-addr-'+gi);
      if(a && !a.value) a.value=r.address1+r.address2+r.address3;
    }
  } catch(e){}
}

async function generateMaterialOrderPDF() {
  const p = _currentProduct;
  const groups = window._matOrderGroups||{};
  let pages='', pageIdx=0;
  const totalPages = Object.keys(groups).length;
  // 納期を資材行に転記するためのマップ {product_name+spec: delivery_date}
  const deliveryMap = {};

  for(const [sup, supRows] of Object.entries(groups)) {
    const gi = Object.keys(groups).indexOf(sup);
    const noRes = await api('order_no.generate',{type:'M'});
    const orderNo   = noRes?.order_no||'RL-M-??????';
    const orderType = document.getElementById('pop-type-'+gi)?.value||'量産';
    const delivery  = document.getElementById('pop-delivery-'+gi)?.value||'';
    const shipName  = document.getElementById('pop-ship-name-'+gi)?.value||'';
    const shipZip   = document.getElementById('pop-ship-zip-'+gi)?.value||'';
    const shipAddr  = document.getElementById('pop-ship-addr-'+gi)?.value||'';
    const shipTel   = document.getElementById('pop-ship-tel-'+gi)?.value||'';
    const note      = document.getElementById('pop-note-'+gi)?.value||'';

    // 納期を資材行マップに記録（ポップアップを閉じる前に取得）
    supRows.forEach(r=>{ deliveryMap[r.product_name+(r.spec||'')] = delivery; });

    let grandAmt=0;
    const detailRows=[];
    supRows.forEach((r,ri)=>{
      for(let resi=0;;resi++){
        const rowId=`r${gi}_${ri}_${resi}`;
        const qtyEl=document.getElementById('pop-qty-'+rowId);
        if(!qtyEl) break;
        const qty=parseFloat(qtyEl.value)||0;
        const price=parseFloat(document.getElementById('pop-price-'+rowId)?.value)||0;
        const amt=Math.round(qty*price);
        grandAmt+=amt;
        let colorDesc='';
        for(let n=1;n<=7;n++){
          const mc=r['col'+n+'_matcode']||'';
          if(mc){colorDesc=mc;break;}
        }
        // 対応サイズ列は不要なので削除
        detailRows.push(`<tr>
          <td style="font-family:monospace;font-size:8pt">${esc(r.product_no||'')}</td>
          <td>${esc(r.product_name||'')}</td>
          <td>${esc(r.spec||'')}</td>
          <td>${esc(colorDesc)}</td>
          <td style="text-align:right">${qty.toLocaleString()}</td>
          <td>${esc(r.unit||'')}</td>
          <td style="text-align:right">${price?price.toLocaleString()+'円':''}</td>
          <td style="text-align:right;font-weight:700">${amt?amt.toLocaleString()+'円':''}</td>
        </tr>`);
      }
    });

    await api('order_history.save',{
      order_no:orderNo, order_type:`資材発注(${orderType})`, style_code:p.style_code,
      supplier_name:sup, process_names:'', total_qty:0, total_amount:grandAmt, memo:note
    });

    pages+=`${pageIdx>0?'<div class="page-break"></div>':''}
    <div class="header">
      <div><div class="logo">RL <span>OMS</span></div><div style="font-size:7pt;color:#888">Raises Lab Co., Ltd. / TEL:075-755-7973</div></div>
      <div><div class="doc-title">資 材 発 注 書（${esc(orderType)}）</div><div class="doc-no">発注No.: ${esc(orderNo)} / 発注日: ${new Date().toLocaleDateString('ja-JP')}</div></div>
    </div>
    <!-- 発注先・納期・出荷先 -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8pt;margin-bottom:8pt;padding-bottom:6pt;border-bottom:0.5pt solid #ddd">
      <div>
        <div class="sec-title">発注先</div>
        <div style="font-size:11pt;font-weight:700">${esc(sup)}</div>
      </div>
      <div>
        <div class="sec-title">納期</div>
        <div style="font-size:13pt;font-weight:700">${esc(delivery)||'未設定'}</div>
      </div>
    </div>
    ${shipName?`<div style="margin-bottom:8pt;padding:6pt;background:#EEF2FD;border-radius:4pt;font-size:8.5pt">
      <div style="font-weight:700;color:#2B5CE6;margin-bottom:4pt">🚚 出荷先</div>
      <div style="font-weight:700;font-size:10pt;margin-bottom:2pt">${esc(shipName)}</div>
      ${shipZip?`<div style="word-break:break-all;white-space:normal">〒${esc(shipZip)}</div>`:''}
      ${shipAddr?`<div style="word-break:break-all;white-space:normal;line-height:1.5">${esc(shipAddr)}</div>`:''}
      ${shipTel?`<div>TEL: ${esc(shipTel)}</div>`:''}
    </div>`:''}
    <!-- 品番情報 -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4pt 16pt;margin-bottom:8pt;font-size:8.5pt">
      <div class="info-row"><span class="lbl">品番：</span><span class="val" style="font-weight:700">${esc(p.brand_product_no||'')}</span></div>
      <div class="info-row"><span class="lbl">品名：</span><span class="val">${esc(p.product_name||'')}</span></div>
    </div>
    <div class="sec-title">発注明細</div>
    <table>
      <thead><tr>
        <th style="width:56pt">品番</th><th>品名</th><th style="width:46pt">規格</th>
        <th style="width:46pt">資材カラー</th>
        <th style="width:36pt;text-align:right">数量</th><th style="width:20pt">単位</th>
        <th style="width:50pt;text-align:right">単価</th><th style="width:60pt;text-align:right">金額</th>
      </tr></thead>
      <tbody>${detailRows.join('')}</tbody>
      <tfoot><tr class="total-row">
        <td colspan="7" style="text-align:right;padding-right:8pt">合計金額</td>
        <td style="text-align:right;font-size:11pt;font-weight:700">${grandAmt.toLocaleString()}円</td>
      </tr></tfoot>
    </table>
    ${note?`<div style="margin-top:8pt"><div class="sec-title">備考・指示事項</div>
    <div style="border:0.5pt solid #ddd;border-radius:3pt;padding:6pt;font-size:8.5pt">${esc(note)}</div></div>`:''}
    <!-- 付記 -->
    <div style="margin-top:10pt;padding:8pt;border:0.5pt solid #ddd;border-radius:4pt;font-size:8pt;line-height:1.8">
      ※ 出荷明細を出荷日に必ずFAXまたは担当者にメール連絡をお願い致します。<br>
      ※ 生地は出荷時に必ず生地の表裏の表記をつけて出荷して下さい。<br>
      ※ 出荷伝票/請求伝票に必ず本発注書下部の使用品番を明記して下さい。
    </div>
    <!-- 使用品番 -->
    <div style="margin-top:8pt;padding:6pt;background:#F7F6F3;border-radius:4pt;font-size:8pt">
      使用品番：${esc(p.brand_product_no||'')}　${esc(p.product_name||'')}　${esc(p.year||'')}${esc(p.season||'')}
    </div>
    <div class="sign-row"><div class="sign-box">確認</div><div class="sign-box">承認</div><div class="sign-box">出力者</div></div>
    <div class="footer"><span>Raises Lab Co., Ltd. / ${esc(orderNo)}</span><span>${pageIdx+1} / ${totalPages}</span></div>`;
    pageIdx++;
  }

  // 先にポップアップを閉じてからDOMに転記
  document.getElementById('mat-order-ov')?.remove();

  // 資材シートの納期を転記（ポップアップ閉じた後でもdeliveryMapは残っている）
  _materialRows.forEach((row,idx)=>{
    const name = row.product_name || getMF(idx,'product_name') || '';
    const spec  = row.spec        || getMF(idx,'spec')         || '';
    const key   = name + spec;
    if(deliveryMap[key]) {
      // DOMに反映（資材シートが開いていれば）
      const delEl = document.querySelector(`[data-r="${idx}"][data-f="delivery_date"]`);
      if(delEl) delEl.value = deliveryMap[key];
      // _materialRowsにも保存
      _materialRows[idx].delivery_date = deliveryMap[key];
    }
  });

  // 納期が転記されたら自動保存
  const hasDelivery = Object.keys(deliveryMap).length > 0;
  if(hasDelivery && _materialRows.length > 0) {
    await saveMaterialsData();
  }

  openPrintWindow(pages,'資材発注書_'+p.brand_product_no);
  toast('資材発注書を発行しました（納期を資材シートに転記・保存済）','success');
}
// ===== マスタ管理 =====
let _masterTab='supplier';
function renderMastersPage(main) {
  main.innerHTML=`<div class="page-header"><h1>マスタ管理</h1></div>
    <div style="display:flex;gap:4px;border-bottom:1px solid var(--c-border);margin-bottom:20px;flex-wrap:wrap">
      <button class="fs-tab ${_masterTab==='partner'?'active':''}"   onclick="switchMasterTab('partner')">🏭 仕入/加工先</button>
      <button class="fs-tab ${_masterTab==='customer'?'active':''}"  onclick="switchMasterTab('customer')">👤 得意先</button>
      <button class="fs-tab ${_masterTab==='material'?'active':''}"  onclick="switchMasterTab('material')">🧵 資材</button>
      <button class="fs-tab ${_masterTab==='color'?'active':''}"     onclick="switchMasterTab('color')">🎨 カラー</button>
      <button class="fs-tab ${_masterTab==='size'?'active':''}"      onclick="switchMasterTab('size')">📐 サイズ</button>
    </div>
    <div id="master-content"></div>`;
  switchMasterTab(_masterTab);
}
function switchMasterTab(tab) {
  _masterTab=tab;
  document.querySelectorAll('.fs-tab').forEach(t=>t.classList.remove('active'));
  const tabs=document.querySelectorAll('.fs-tab');
  const idx=['supplier','factory','material','color','size'].indexOf(tab);
  if(tabs[idx]) tabs[idx].classList.add('active');
  const c=document.getElementById('master-content'); if(!c) return;
  if(tab==='partner')   renderPartnerPage(c);
  if(tab==='customer')  renderCustomerPage(c);
  if(tab==='material')  renderMaterialPage(c);
  if(tab==='color')    renderColorPage(c);
  if(tab==='size')     renderSizePage(c);
}

// ---- 仕入/加工先マスタ（統合） ----
const PARTNER_CATEGORIES = ['生地仕入先','副資材仕入先','縫製工場','刺繍工場','プリント工場','染色工場','整理加工','検品','商社','その他'];

function renderPartnerPage(c) {
  c.innerHTML=`<div class="card">
    <div style="display:flex;gap:8px;margin-bottom:16px;align-items:center;flex-wrap:wrap">
      <h3 style="font-size:15px;font-weight:700;flex:1">仕入/加工先マスタ</h3>
      <button class="btn btn-primary btn-sm" onclick="openPartnerForm()">＋ 新規登録</button>
      <label class="btn btn-secondary btn-sm" style="cursor:pointer">📥 CSVインポート<input type="file" accept=".csv" style="display:none" onchange="importPartnerCSV(event)"></label>
      <button class="btn btn-secondary btn-sm" onclick="exportCSV(_masters.partners,['partner_id','partner_name','is_supplier','is_factory','category','payment_partner_name','contact_name','tel','fax','email','address','payment_terms','memo'],'仕入加工先マスタ')">📤 エクスポート</button>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">
      <button class="btn btn-secondary btn-sm" onclick="filterPartners('')" id="pf-all">全て</button>
      <button class="btn btn-secondary btn-sm" onclick="filterPartners('supplier')" id="pf-sup">仕入先のみ</button>
      <button class="btn btn-secondary btn-sm" onclick="filterPartners('factory')" id="pf-fac">加工先のみ</button>
    </div>
    <table class="master-table" id="partner-table">
      <thead><tr><th>名称</th><th>種別</th><th>カテゴリ</th><th>支払先</th><th>担当者</th><th>TEL</th><th style="width:80px">操作</th></tr></thead>
      <tbody>${renderPartnerRows(_masters.partners)}</tbody>
    </table></div>
    <div id="partner-form"></div>`;
}

function renderPartnerRows(items) {
  if(!items||!items.length) return '<tr><td colspan="7" style="text-align:center;color:var(--c-text3);padding:30px">登録なし</td></tr>';
  return items.map((p,i)=>{
    const types = [];
    if(p.is_supplier===true||p.is_supplier==='TRUE') types.push('<span class="badge badge-sampling">仕入先</span>');
    if(p.is_factory===true||p.is_factory==='TRUE')   types.push('<span class="badge badge-in_production">加工先</span>');
    return `<tr><td><strong>${esc(p.partner_name)}</strong></td><td>${types.join(' ')}</td>
      <td>${esc(p.category||'')}</td><td>${esc(p.payment_partner_name||'（直取引）')}</td>
      <td>${esc(p.contact_name||'')}</td><td>${esc(p.tel||'')}</td>
      <td><button class="btn btn-secondary btn-sm" onclick="openPartnerForm(${i})">編集</button></td></tr>`;
  }).join('');
}

function filterPartners(type) {
  let items = _masters.partners;
  if(type==='supplier') items=items.filter(p=>p.is_supplier===true||p.is_supplier==='TRUE');
  if(type==='factory')  items=items.filter(p=>p.is_factory===true||p.is_factory==='TRUE');
  const tbody=document.querySelector('#partner-table tbody');
  if(tbody) tbody.innerHTML=renderPartnerRows(items);
}

function openPartnerForm(idx) {
  const p = idx!==undefined ? _masters.partners[idx] : null;
  const isS = p?.is_supplier===true||p?.is_supplier==='TRUE';
  const isF = p?.is_factory===true||p?.is_factory==='TRUE';
  // 支払先（仕入先）の選択肢
  const payOpts = '<option value="">（直取引・支払先なし）</option>'+
    _masters.partners.filter(x=>x.is_supplier===true||x.is_supplier==='TRUE').map(x=>
      `<option value="${esc(x.partner_id)}" data-name="${esc(x.partner_name)}" ${p?.payment_partner_id===x.partner_id?'selected':''}>${esc(x.partner_name)}</option>`
    ).join('');
  const a=document.getElementById('partner-form'); if(!a) return;
  a.innerHTML=`<div class="card" style="margin-top:16px">
    <h3 style="font-size:15px;font-weight:700;margin-bottom:16px">${p?'編集':'新規登録'}</h3>
    <div class="form-row form-row-2">
      <div class="form-group"><label>名称 ★</label><input type="text" id="pt-name" value="${esc(p?.partner_name||'')}"></div>
      <div class="form-group"><label>カテゴリ</label>
        <select id="pt-cat">${PARTNER_CATEGORIES.map(c=>`<option value="${c}" ${p?.category===c?'selected':''}>${c}</option>`).join('')}</select>
      </div>
    </div>
    <div class="form-group" style="margin-bottom:12px">
      <label>種別（複数選択可）★</label>
      <div style="display:flex;gap:16px;margin-top:6px">
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
          <input type="checkbox" id="pt-is-sup" ${isS?'checked':''} style="width:15px;height:15px" onchange="checkPartnerType()"> 仕入先（請求受取・支払先）
        </label>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
          <input type="checkbox" id="pt-is-fac" ${isF?'checked':''} style="width:15px;height:15px" onchange="checkPartnerType()"> 加工先（実作業場所）
        </label>
      </div>
    </div>
    <div class="form-group" id="payment-partner-wrap" style="${isS?'display:none':''}">
      <label>支払先（仕入先）<span style="color:var(--c-danger);font-size:11px"> ※加工先のみの場合は必須</span></label>
      <select id="pt-pay" onchange="onPayPartnerSel(this)">${payOpts}</select>
      <input type="hidden" id="pt-pay-id" value="${esc(p?.payment_partner_id||'')}">
      <input type="hidden" id="pt-pay-name" value="${esc(p?.payment_partner_name||'')}">
    </div>
    <div class="form-row form-row-2">
      <div class="form-group"><label>担当者名</label><input type="text" id="pt-contact" value="${esc(p?.contact_name||'')}"></div>
      <div class="form-group"><label>TEL</label><input type="text" id="pt-tel" value="${esc(p?.tel||'')}"></div>
    </div>
    <div class="form-row form-row-2">
      <div class="form-group"><label>FAX</label><input type="text" id="pt-fax" value="${esc(p?.fax||'')}"></div>
      <div class="form-group"><label>メール</label><input type="text" id="pt-email" value="${esc(p?.email||'')}"></div>
    </div>
    <div class="form-group"><label>郵便番号</label>${zipInput('pt-zip','pt-addr')}</div>
    <div class="form-group"><label>住所</label><input type="text" id="pt-addr" value="${esc(p?.address||'')}"></div>
    <div class="form-group"><label>支払条件</label><input type="text" id="pt-pay-terms" value="${esc(p?.payment_terms||'')}"></div>
    <div class="form-group"><label>備考</label><textarea id="pt-memo">${esc(p?.memo||'')}</textarea></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
      <button class="btn btn-secondary" onclick="document.getElementById('partner-form').innerHTML=''">キャンセル</button>
      <button class="btn btn-primary" onclick="savePartner('${esc(p?.partner_id||'')}')">保存する</button>
    </div></div>`;
  a.scrollIntoView({behavior:'smooth'});
}

function checkPartnerType() {
  const isSup = document.getElementById('pt-is-sup')?.checked;
  const wrap  = document.getElementById('payment-partner-wrap');
  if(wrap) wrap.style.display = isSup ? 'none' : '';
}
function onPayPartnerSel(sel) {
  const opt=sel.options[sel.selectedIndex];
  document.getElementById('pt-pay-id').value=opt.value;
  document.getElementById('pt-pay-name').value=opt.dataset.name||'';
}

async function savePartner(id) {
  const g=el=>document.getElementById(el)?.value||'';
  const isSup=document.getElementById('pt-is-sup')?.checked||false;
  const isFac=document.getElementById('pt-is-fac')?.checked||false;
  if(!g('pt-name')){toast('名称を入力してください','error');return;}
  if(!isSup&&!isFac){toast('仕入先または加工先にチェックを入れてください','error');return;}
  if(!isSup&&isFac&&!g('pt-pay-id')){toast('加工先のみの場合は支払先の仕入先を選択してください','error');return;}
  const res=await api('partners.upsert',{partner_id:id||undefined,partner_name:g('pt-name'),category:g('pt-cat'),is_supplier:isSup,is_factory:isFac,payment_partner_id:g('pt-pay-id'),payment_partner_name:g('pt-pay-name'),contact_name:g('pt-contact'),tel:g('pt-tel'),fax:g('pt-fax'),email:g('pt-email'),address:g('pt-addr'),payment_terms:g('pt-pay-terms'),memo:g('pt-memo')});
  if(!res||!res.ok){toast(res?.error||'保存失敗','error');return;}
  toast('保存しました','success');
  const r=await api('partners.list'); if(r){_masters.partners=r.items;_masters.suppliers=r.items.filter(p=>p.is_supplier===true||p.is_supplier==='TRUE');_masters.factories=r.items.filter(p=>p.is_factory===true||p.is_factory==='TRUE');}
  renderPartnerPage(document.getElementById('master-content'));
}

async function importPartnerCSV(e) {
  const f=e.target.files[0]; if(!f) return;
  const rows=(await f.text()).split('\n').map(r=>r.split(',').map(v=>v.replace(/^"|"$/g,'').trim()));
  let n=0;
  for(let i=1;i<rows.length;i++){
    if(!rows[i][0]) continue;
    await api('partners.upsert',{partner_name:rows[i][0]||'',is_supplier:rows[i][1]==='TRUE',is_factory:rows[i][2]==='TRUE',category:rows[i][3]||'',contact_name:rows[i][4]||'',tel:rows[i][5]||'',email:rows[i][6]||'',address:rows[i][7]||''});
    n++;
  }
  toast(n+'件インポートしました','success');
  const r=await api('partners.list'); if(r){_masters.partners=r.items;_masters.suppliers=r.items.filter(p=>p.is_supplier===true||p.is_supplier==='TRUE');_masters.factories=r.items.filter(p=>p.is_factory===true||p.is_factory==='TRUE');}
  renderPartnerPage(document.getElementById('master-content'));
}

// ---- 得意先マスタ ----
function renderCustomerPage(c) {
  c.innerHTML=`<div class="card">
    <div style="display:flex;gap:8px;margin-bottom:16px;align-items:center">
      <h3 style="font-size:15px;font-weight:700;flex:1">得意先マスタ</h3>
      <button class="btn btn-primary btn-sm" onclick="openCustomerForm()">＋ 新規登録</button>
    </div>
    <table class="master-table">
      <thead><tr><th>得意先名</th><th>ブランド名</th><th>担当者</th><th>TEL</th><th>メール</th><th style="width:80px">操作</th></tr></thead>
      <tbody>${_masters.customers.length===0?'<tr><td colspan="6" style="text-align:center;color:var(--c-text3);padding:30px">登録なし</td></tr>':
        _masters.customers.map((cu,i)=>`<tr><td><strong>${esc(cu.customer_name)}</strong></td><td>${esc(cu.brand_name||'')}</td><td>${esc(cu.contact_name||'')}</td><td>${esc(cu.tel||'')}</td><td>${esc(cu.email||'')}</td>
          <td><button class="btn btn-secondary btn-sm" onclick="openCustomerForm(${i})">編集</button></td></tr>`).join('')}
      </tbody>
    </table></div>
    <div id="customer-form"></div>`;
}

function openCustomerForm(idx) {
  const cu=idx!==undefined?_masters.customers[idx]:null;
  const a=document.getElementById('customer-form'); if(!a) return;
  a.innerHTML=`<div class="card" style="margin-top:16px">
    <h3 style="font-size:15px;font-weight:700;margin-bottom:16px">${cu?'得意先を編集':'新規得意先登録'}</h3>
    <div class="form-row form-row-2">
      <div class="form-group"><label>得意先名 ★</label><input type="text" id="cu-name" value="${esc(cu?.customer_name||'')}"></div>
      <div class="form-group"><label>ブランド名</label><input type="text" id="cu-brand" value="${esc(cu?.brand_name||'')}"></div>
    </div>
    <div class="form-row form-row-2">
      <div class="form-group"><label>担当者名</label><input type="text" id="cu-contact" value="${esc(cu?.contact_name||'')}"></div>
      <div class="form-group"><label>TEL</label><input type="text" id="cu-tel" value="${esc(cu?.tel||'')}"></div>
    </div>
    <div class="form-row form-row-2">
      <div class="form-group"><label>FAX</label><input type="text" id="cu-fax" value="${esc(cu?.fax||'')}"></div>
      <div class="form-group"><label>メール</label><input type="text" id="cu-email" value="${esc(cu?.email||'')}"></div>
    </div>
    <div class="form-group"><label>郵便番号</label>${zipInput('cu-zip','cu-addr')}</div>
    <div class="form-group"><label>住所</label><input type="text" id="cu-addr" value="${esc(cu?.address||'')}"></div>
    <div class="form-group"><label>備考</label><textarea id="cu-memo">${esc(cu?.memo||'')}</textarea></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
      <button class="btn btn-secondary" onclick="document.getElementById('customer-form').innerHTML=''">キャンセル</button>
      <button class="btn btn-primary" onclick="saveCustomer('${esc(cu?.customer_id||'')}')">保存する</button>
    </div></div>`;
  a.scrollIntoView({behavior:'smooth'});
}

async function saveCustomer(id) {
  const g=el=>document.getElementById(el)?.value||'';
  if(!g('cu-name')){toast('得意先名を入力してください','error');return;}
  const res=await api('customers.upsert',{customer_id:id||undefined,customer_name:g('cu-name'),brand_name:g('cu-brand'),contact_name:g('cu-contact'),tel:g('cu-tel'),fax:g('cu-fax'),email:g('cu-email'),address:g('cu-addr'),memo:g('cu-memo')});
  if(!res||!res.ok){toast('保存失敗','error');return;}
  toast('保存しました','success');
  const r=await api('customers.list'); if(r) _masters.customers=r.items;
  renderCustomerPage(document.getElementById('master-content'));
}
// 資材マスタ検索ポップアップ（資材シートから追加）
function openMatSearchPopup() {
  const ov=document.createElement('div');
  ov.id='mat-search-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9000;display:flex;align-items:center;justify-content:center';
  ov.innerHTML=`<div style="background:var(--c-surface);border-radius:12px;padding:24px;width:600px;max-width:95vw;max-height:82vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,.25)">
    <h3 style="font-size:16px;font-weight:700;margin-bottom:12px">🔍 資材マスタから検索・追加</h3>
    <div style="display:flex;gap:8px;margin-bottom:10px">
      <input type="text" id="msp-q" placeholder="品番・品名・メーカーで検索..." style="flex:1" oninput="filterMatPopup()" autofocus>
      <select id="msp-cat" onchange="filterMatPopup()" style="width:110px;font-size:12px">
        <option value="">全分類</option>
        ${CATEGORIES.map(c=>`<option value="${c}">${c}</option>`).join('')}
      </select>
    </div>
    <div id="msp-list" style="flex:1;overflow-y:auto;border:0.5px solid var(--c-border);border-radius:8px">
      ${renderMatPopupList(_masters.materials)}
    </div>
    <p style="font-size:11px;color:var(--c-text3);margin-top:8px">行をクリックすると資材シートに追加されます</p>
    <div style="display:flex;gap:8px;justify-content:space-between;margin-top:10px">
      <button class="btn btn-primary btn-sm" onclick="openMatMasterPopup(document.getElementById('msp-q')?.value||'','')">＋ 新規資材をマスタに登録</button>
      <button class="btn btn-secondary" onclick="document.getElementById('mat-search-ov').remove()">閉じる</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov) ov.remove();});
  _matPopupFiltered = _masters.materials;
  document.getElementById('msp-q')?.focus();
}

function renderMatPopupList(items) {
  if(!items||!items.length) return '<div style="text-align:center;color:var(--c-text3);padding:30px">該当なし</div>';
  return '<table style="width:100%;border-collapse:collapse;font-size:12px">'+
    '<thead><tr style="position:sticky;top:0;background:var(--c-bg)">'+
    '<th style="padding:6px 8px;text-align:left;border-bottom:0.5px solid var(--c-border)">品番</th>'+
    '<th style="padding:6px 8px;text-align:left;border-bottom:0.5px solid var(--c-border)">品名</th>'+
    '<th style="padding:6px 8px;border-bottom:0.5px solid var(--c-border)">分類</th>'+
    '<th style="padding:6px 8px;border-bottom:0.5px solid var(--c-border)">規格</th>'+
    '<th style="padding:6px 8px;border-bottom:0.5px solid var(--c-border)">メーカー</th>'+
    '<th style="padding:6px 8px;text-align:right;border-bottom:0.5px solid var(--c-border)">単価</th>'+
    '</tr></thead><tbody>'+
    items.map((m,i)=>{
      // data属性にインデックスを持たせてグローバルキャッシュから取得する方式
      return `<tr data-mat-idx="${i}" onclick="selectMatFromPopup(${i})" style="cursor:pointer;border-bottom:0.5px solid var(--c-border)" onmouseover="this.style.background='var(--c-primary-bg)'" onmouseout="this.style.background=''">
        <td style="padding:6px 8px;font-family:monospace;font-size:11px">${esc(m.product_no||'')}</td>
        <td style="padding:6px 8px"><strong>${esc(m.product_name||'')}</strong></td>
        <td style="padding:6px 8px">${esc(m.category||'')}</td>
        <td style="padding:6px 8px">${esc(m.spec||'')}</td>
        <td style="padding:6px 8px">${esc(m.maker_name||'')}</td>
        <td style="padding:6px 8px;text-align:right">${m.unit_price?Number(m.unit_price).toLocaleString()+'円':''}</td>
      </tr>`;
    }).join('')+
    '</tbody></table>';
}

// フィルター済みリストを保持
let _matPopupFiltered = [];

function filterMatPopup() {
  const q  = (document.getElementById('msp-q')?.value||'').toLowerCase();
  const cat= document.getElementById('msp-cat')?.value||'';
  let items = _masters.materials;
  if(q)   items=items.filter(m=>(m.product_name||'').toLowerCase().includes(q)||(m.product_no||'').toLowerCase().includes(q)||(m.maker_name||'').toLowerCase().includes(q));
  if(cat) items=items.filter(m=>m.category===cat);
  _matPopupFiltered = items;
  const el=document.getElementById('msp-list');
  if(el) el.innerHTML=renderMatPopupList(items);
}

function selectMatFromPopup(filteredIdx) {
  const list = _matPopupFiltered.length ? _matPopupFiltered : _masters.materials;
  const m = list[filteredIdx];
  if(!m) { toast('資材データの取得に失敗しました','error'); return; }

  const newRow = {
    material_slot: String(_materialRows.length+1).padStart(2,'0'),
    product_no:    m.product_no||'',
    product_name:  m.product_name||'',
    spec:          m.spec||'',
    category:      m.category||'',
    unit:          m.unit||'m',
    unit_price:    m.unit_price||'',
    supplier_name: m.supplier_name||'',
    maker_name:    m.maker_name||'',
  };
  _materialRows.push(newRow);

  // 資材シートが表示されていない場合は切り替えてから追加
  const tbody = document.getElementById('mat-tbody');
  if(!tbody) {
    // まず資材タブに切り替えてから追加
    document.getElementById('mat-search-ov')?.remove();
    switchFsTab('materials');
    // タブ切替後にDOMが描画されてから追加
    setTimeout(()=>{
      const tb = document.getElementById('mat-tbody');
      if(tb) {
        appendMatRow(tb, newRow, _materialRows.length-1);
        calcMatTotal();
      }
      toast('「'+m.product_name+'」を資材シートに追加しました','success');
    }, 300);
    return;
  }
  appendMatRow(tbody, newRow, _materialRows.length-1);
  calcMatTotal();
  toast('「'+m.product_name+'」を資材シートに追加しました','success');
  document.getElementById('mat-search-ov')?.remove();
}

// ---- 資材マスタページ（CSV対応強化） ----
function renderMaterialPage(c) {
  c.innerHTML=`<div class="card">
    <div style="display:flex;gap:8px;margin-bottom:16px;align-items:center;flex-wrap:wrap">
      <h3 style="font-size:15px;font-weight:700;flex:1">資材マスタ（${_masters.materials.length}件）</h3>
      <input type="text" id="mat-s" placeholder="品番・品名・メーカーで検索..." style="max-width:180px" oninput="filterMat()">
      <select id="mat-cat-filter" onchange="filterMat()" style="width:90px;font-size:12px">
        <option value="">全分類</option>${CATEGORIES.map(c2=>`<option value="${c2}">${c2}</option>`).join('')}
      </select>
      <button class="btn btn-primary btn-sm" onclick="openMaterialForm()">＋ 新規登録</button>
      <label class="btn btn-secondary btn-sm" style="cursor:pointer">📥 CSVインポート<input type="file" accept=".csv" style="display:none" onchange="importMaterialCSV(event)"></label>
      <button class="btn btn-secondary btn-sm" onclick="downloadMatTemplate()">📋 テンプレDL</button>
    </div>
    <table class="master-table" id="mat-master-table">
      <thead><tr><th>ID</th><th>分類</th><th>品番</th><th>品名</th><th>規格</th><th>単位</th><th>単価</th><th>仕入先</th><th>メーカー</th><th style="width:80px">操作</th></tr></thead>
      <tbody>${matRows(_masters.materials)}</tbody>
    </table></div>
    <div id="mat-form"></div>`;
}
function matRows(items) {
  if(!items||!items.length) return '<tr><td colspan="10" style="text-align:center;color:var(--c-text3);padding:30px">登録なし</td></tr>';
  return items.map((m,i)=>`<tr>
    <td><code style="font-size:11px">${esc(m.material_id)}</code></td>
    <td>${esc(m.category||'')}</td><td>${esc(m.product_no||'')}</td>
    <td>${esc(m.product_name||'')}</td><td>${esc(m.spec||'')}</td>
    <td>${esc(m.unit||'')}</td><td>${m.unit_price?Number(m.unit_price).toLocaleString()+'円':''}</td>
    <td>${esc(m.supplier_name||'')}</td><td>${esc(m.maker_name||'')}</td>
    <td><button class="btn btn-secondary btn-sm" onclick="openMaterialForm(${i})">編集</button></td></tr>`).join('');
}
function filterMat() {
  const q  = (document.getElementById('mat-s')?.value||'').toLowerCase();
  const cat= document.getElementById('mat-cat-filter')?.value||'';
  let items = _masters.materials;
  if(q)   items=items.filter(m=>(m.product_name||'').toLowerCase().includes(q)||(m.product_no||'').toLowerCase().includes(q)||(m.maker_name||'').toLowerCase().includes(q));
  if(cat) items=items.filter(m=>m.category===cat);
  const tbody=document.querySelector('#mat-master-table tbody'); if(tbody) tbody.innerHTML=matRows(items);
}
function downloadMatTemplate() {
  const fields=['category','product_no','product_name','spec','quality','unit','supplier_name','maker_name','unit_price','memo'];
  const csv='"'+fields.join('","')+'"\n'+
    '"生地","TJ-001","サンプル天竺","160cm巾","綿100%","m","株式会社サンプル","サンプルテキスタイル","1200","サンプル"';
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'}));
  a.download='資材マスタ_インポートテンプレート.csv'; a.click();
  toast('テンプレートをダウンロードしました','success');
}
async function importMaterialCSV(e) {
  const f=e.target.files[0]; if(!f) return;
  const text=await f.text();
  const lines=text.split('\n');
  const headers=lines[0].split(',').map(v=>v.replace(/^"|"$/g,'').trim());
  const rows=[];
  for(let i=1;i<lines.length;i++){
    if(!lines[i].trim()) continue;
    const vals=lines[i].split(',').map(v=>v.replace(/^"|"$/g,'').trim());
    const obj={};
    headers.forEach((h,hi)=>{ obj[h]=vals[hi]||''; });
    rows.push(obj);
  }
  showLoading(true);
  const res=await callGAS({action:'materials.import',token:_token,rows});
  showLoading(false);
  if(!res||!res.ok){toast('インポート失敗','error');return;}
  toast(`${res.added}件追加・${res.skipped}件スキップ（重複品番）`,'success');
  const m=await api('materials.list'); if(m) _masters.materials=m.items;
  renderMaterialPage(document.getElementById('master-content'));
}
async function openMaterialForm(idx) {
  const m = idx!==undefined ? _masters.materials[idx] : null;
  const supOpts='<option value="">-</option>'+_masters.suppliers.map(s=>`<option value="${esc(s.partner_name||s.supplier_name)}" ${m?.supplier_name===(s.partner_name||s.supplier_name)?'selected':''}>${esc(s.partner_name||s.supplier_name)}</option>`).join('');
  const a = document.getElementById('mat-form'); if(!a) return;

  // 既存のカラー単価を取得
  let colorPrices = [];
  if(m?.material_id) {
    const cpRes = await api('material_color_prices.get', {material_id:m.material_id});
    colorPrices = cpRes?.items||[];
  }

  // 規格ごとにグループ化
  const specGroups = {};
  colorPrices.forEach(cp=>{
    const spec = cp.spec||'（規格なし）';
    if(!specGroups[spec]) specGroups[spec]=[];
    specGroups[spec].push(cp);
  });
  // 規格なしグループを初期表示
  if(Object.keys(specGroups).length===0) specGroups['']=[{}];

  const renderSpecGroup = (spec, items, gi) => `
    <div class="spec-group" id="sg-${gi}" style="border:1px solid var(--c-border);border-radius:8px;padding:12px;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <label style="font-size:12px;font-weight:600;color:var(--c-text2);white-space:nowrap">規格/サイズ：</label>
        <input type="text" id="sg-spec-${gi}" value="${esc(spec==='（規格なし）'?'':spec)}" placeholder="例: 11.5mm / 160cm巾 / XL" style="flex:1;font-size:12px;font-weight:600">
        <button class="del-btn" onclick="document.getElementById('sg-${gi}').remove()" title="この規格を削除">✕</button>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead><tr style="background:var(--c-bg)">
          <th style="padding:4px 6px;text-align:left;border-bottom:0.5px solid var(--c-border)">カラーコード</th>
          <th style="padding:4px 6px;text-align:left;border-bottom:0.5px solid var(--c-border)">カラー名</th>
          <th style="padding:4px 6px;text-align:right;border-bottom:0.5px solid var(--c-border)">単価（円）</th>
          <th style="padding:4px 6px;border-bottom:0.5px solid var(--c-border)">備考</th>
          <th style="width:24px;border-bottom:0.5px solid var(--c-border)"></th>
        </tr></thead>
        <tbody id="sg-tbody-${gi}">
          ${items.map((cp,ci)=>`<tr>
            <td style="padding:3px 4px"><input type="text" class="sg-code" data-gi="${gi}" placeholder="#115" value="${esc(cp.color_code||'')}" style="width:100%;font-size:11px"></td>
            <td style="padding:3px 4px"><input type="text" class="sg-cname" data-gi="${gi}" placeholder="ホワイト" value="${esc(cp.color_name||'')}" style="width:100%;font-size:11px"></td>
            <td style="padding:3px 4px"><input type="number" class="sg-price" data-gi="${gi}" placeholder="0" value="${esc(cp.unit_price||'')}" style="width:100%;font-size:11px;text-align:right"></td>
            <td style="padding:3px 4px"><input type="text" class="sg-memo" data-gi="${gi}" placeholder="" value="${esc(cp.memo||'')}" style="width:100%;font-size:11px"></td>
            <td style="padding:3px 4px"><button class="del-btn" onclick="this.closest('tr').remove()" style="font-size:10px">✕</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
      <button class="btn btn-secondary btn-sm" style="margin-top:6px;font-size:11px" onclick="addCpColorRow(${gi})">＋ カラーを追加</button>
    </div>`;

  a.innerHTML=`<div class="card" style="margin-top:16px">
    <h3 style="font-size:15px;font-weight:700;margin-bottom:16px">${m?'資材を編集':'新規資材登録'}</h3>
    <div class="form-row form-row-3">
      <div class="form-group"><label>分類</label><select id="mc-cat">${CATEGORIES.map(c=>`<option value="${c}" ${m?.category===c?'selected':''}>${c}</option>`).join('')}</select></div>
      <div class="form-group"><label>品番</label><input type="text" id="mc-no" value="${esc(m?.product_no||'')}" placeholder="例: TJ-16021"></div>
      <div class="form-group"><label>品名 ★</label><input type="text" id="mc-name" value="${esc(m?.product_name||'')}" placeholder="品名"></div>
    </div>
    <div class="form-row form-row-3">
      <div class="form-group"><label>品質・組成</label><input type="text" id="mc-quality" value="${esc(m?.quality||'')}" placeholder="例: 綿100%"></div>
      <div class="form-group"><label>単位</label><select id="mc-unit">${UNITS.map(u=>`<option value="${u}" ${m?.unit===u?'selected':''}>${u}</option>`).join('')}</select></div>
      <div class="form-group"><label>基準単価（円）</label><input type="number" id="mc-price" value="${esc(m?.unit_price||'')}" placeholder="0"></div>
    </div>
    <div class="form-row form-row-2">
      <div class="form-group"><label>仕入先</label><select id="mc-sup">${supOpts}</select></div>
      <div class="form-group"><label>メーカー名</label><input type="text" id="mc-maker" value="${esc(m?.maker_name||'')}"></div>
    </div>
    <div class="form-group"><label>備考</label><textarea id="mc-memo">${esc(m?.memo||'')}</textarea></div>

    <div style="margin-top:16px;border-top:1px solid var(--c-border);padding-top:14px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <h4 style="font-size:13px;font-weight:700">📐 規格 × 🎨 カラー別単価</h4>
        <button class="btn btn-secondary btn-sm" onclick="addSpecGroup()">＋ 規格を追加</button>
        <span style="font-size:11px;color:var(--c-text3)">規格（サイズ）ごとにカラーと単価を登録します</span>
      </div>
      <div id="spec-groups">
        ${Object.entries(specGroups).map(([spec,items],gi)=>renderSpecGroup(spec,items,gi)).join('')}
      </div>
    </div>

    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn btn-secondary" onclick="document.getElementById('mat-form').innerHTML=''">キャンセル</button>
      <button class="btn btn-primary" onclick="saveMaterial('${esc(m?.material_id||'')}')">保存する</button>
    </div></div>`;
  a.scrollIntoView({behavior:'smooth'});
}

// 規格グループを追加
function addSpecGroup() {
  const container = document.getElementById('spec-groups'); if(!container) return;
  const gi = container.querySelectorAll('.spec-group').length;
  const div = document.createElement('div');
  div.className='spec-group';
  div.id='sg-'+gi;
  div.style.cssText='border:1px solid var(--c-border);border-radius:8px;padding:12px;margin-bottom:10px';
  div.innerHTML=`
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <label style="font-size:12px;font-weight:600;color:var(--c-text2);white-space:nowrap">規格/サイズ：</label>
      <input type="text" id="sg-spec-${gi}" placeholder="例: 13mm / 110cm巾" style="flex:1;font-size:12px;font-weight:600">
      <button class="del-btn" onclick="document.getElementById('sg-${gi}').remove()" title="削除">✕</button>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead><tr style="background:var(--c-bg)">
        <th style="padding:4px 6px;text-align:left;border-bottom:0.5px solid var(--c-border)">カラーコード</th>
        <th style="padding:4px 6px;text-align:left;border-bottom:0.5px solid var(--c-border)">カラー名</th>
        <th style="padding:4px 6px;text-align:right;border-bottom:0.5px solid var(--c-border)">単価（円）</th>
        <th style="padding:4px 6px;border-bottom:0.5px solid var(--c-border)">備考</th>
        <th style="width:24px;border-bottom:0.5px solid var(--c-border)"></th>
      </tr></thead>
      <tbody id="sg-tbody-${gi}"></tbody>
    </table>
    <button class="btn btn-secondary btn-sm" style="margin-top:6px;font-size:11px" onclick="addCpColorRow(${gi})">＋ カラーを追加</button>`;
  container.appendChild(div);
  addCpColorRow(gi);
}

// カラー行を追加
function addCpColorRow(gi) {
  const tbody = document.getElementById('sg-tbody-'+gi); if(!tbody) return;
  const tr = document.createElement('tr');
  tr.innerHTML=`
    <td style="padding:3px 4px"><input type="text" class="sg-code" data-gi="${gi}" placeholder="#115" style="width:100%;font-size:11px"></td>
    <td style="padding:3px 4px"><input type="text" class="sg-cname" data-gi="${gi}" placeholder="ホワイト" style="width:100%;font-size:11px"></td>
    <td style="padding:3px 4px"><input type="number" class="sg-price" data-gi="${gi}" placeholder="0" style="width:100%;font-size:11px;text-align:right"></td>
    <td style="padding:3px 4px"><input type="text" class="sg-memo" data-gi="${gi}" placeholder="" style="width:100%;font-size:11px"></td>
    <td style="padding:3px 4px"><button class="del-btn" onclick="this.closest('tr').remove()" style="font-size:10px">✕</button></td>`;
  tbody.appendChild(tr);
}

async function openMaterialFormWithColorPrices(m, matIdx) {
  const supOpts='<option value="">-</option>'+_masters.suppliers.map(s=>`<option value="${esc(s.partner_name||s.supplier_name)}" ${m?.supplier_name===(s.partner_name||s.supplier_name)?'selected':''}>${esc(s.partner_name||s.supplier_name)}</option>`).join('');

  let colorPrices = [];
  if(m?.material_id) {
    const cpRes = await api('material_color_prices.get', {material_id:m.material_id});
    colorPrices = cpRes?.items||[];
  }

  // 規格ごとにグループ化
  const specGroups = {};
  colorPrices.forEach(cp=>{
    const spec = cp.spec||'';
    if(!specGroups[spec]) specGroups[spec]=[];
    specGroups[spec].push(cp);
  });
  if(Object.keys(specGroups).length===0) specGroups['']=[{}];

  const renderMepGroup = (spec, items, gi) => `
    <div class="mep-group" id="mepg-${gi}" style="border:1px solid var(--c-border);border-radius:8px;padding:12px;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <label style="font-size:12px;font-weight:600;white-space:nowrap">規格/サイズ：</label>
        <input type="text" id="mepg-spec-${gi}" value="${esc(spec)}" placeholder="例: 11.5mm" style="flex:1;font-size:12px;font-weight:600">
        <button class="del-btn" onclick="document.getElementById('mepg-${gi}').remove()">✕</button>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead><tr style="background:var(--c-bg)">
          <th style="padding:4px 6px;border-bottom:0.5px solid var(--c-border)">カラーコード</th>
          <th style="padding:4px 6px;border-bottom:0.5px solid var(--c-border)">カラー名</th>
          <th style="padding:4px 6px;text-align:right;border-bottom:0.5px solid var(--c-border)">単価（円）</th>
          <th style="padding:4px 6px;border-bottom:0.5px solid var(--c-border)">備考</th>
          <th style="width:24px;border-bottom:0.5px solid var(--c-border)"></th>
        </tr></thead>
        <tbody id="mepg-tbody-${gi}">
          ${items.map(cp=>`<tr>
            <td style="padding:3px 4px"><input type="text" class="mepg-code" placeholder="#115" value="${esc(cp.color_code||'')}" style="width:100%;font-size:11px"></td>
            <td style="padding:3px 4px"><input type="text" class="mepg-cname" placeholder="ホワイト" value="${esc(cp.color_name||'')}" style="width:100%;font-size:11px"></td>
            <td style="padding:3px 4px"><input type="number" class="mepg-price" placeholder="0" value="${esc(cp.unit_price||'')}" style="width:100%;font-size:11px;text-align:right"></td>
            <td style="padding:3px 4px"><input type="text" class="mepg-memo" placeholder="" value="${esc(cp.memo||'')}" style="width:100%;font-size:11px"></td>
            <td style="padding:3px 4px"><button class="del-btn" onclick="this.closest('tr').remove()" style="font-size:10px">✕</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
      <button class="btn btn-secondary btn-sm" style="margin-top:6px;font-size:11px" onclick="addMepColorRow(${gi})">＋ カラーを追加</button>
    </div>`;

  const ov = document.createElement('div');
  ov.id='mat-edit-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9200;display:flex;align-items:center;justify-content:center';
  ov.innerHTML=`<div style="background:var(--c-surface);border-radius:12px;padding:24px;width:660px;max-width:95vw;max-height:85vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.3)">
    <h3 style="font-size:16px;font-weight:700;margin-bottom:16px">✏️ 資材マスタ編集：${esc(m?.product_name||'新規')}</h3>
    <div class="form-row form-row-3">
      <div class="form-group"><label>分類</label><select id="mep-cat">${CATEGORIES.map(c=>`<option value="${c}" ${m?.category===c?'selected':''}>${c}</option>`).join('')}</select></div>
      <div class="form-group"><label>品番</label><input type="text" id="mep-no" value="${esc(m?.product_no||'')}"></div>
      <div class="form-group"><label>品名 ★</label><input type="text" id="mep-name" value="${esc(m?.product_name||'')}"></div>
    </div>
    <div class="form-row form-row-3">
      <div class="form-group"><label>品質・組成</label><input type="text" id="mep-quality" value="${esc(m?.quality||'')}"></div>
      <div class="form-group"><label>単位</label><select id="mep-unit">${UNITS.map(u=>`<option value="${u}" ${m?.unit===u?'selected':''}>${u}</option>`).join('')}</select></div>
      <div class="form-group"><label>基準単価（円）</label><input type="number" id="mep-price-base" value="${esc(m?.unit_price||'')}"></div>
    </div>
    <div class="form-row form-row-2">
      <div class="form-group"><label>仕入先</label><select id="mep-sup">${supOpts}</select></div>
      <div class="form-group"><label>メーカー</label><input type="text" id="mep-maker" value="${esc(m?.maker_name||'')}"></div>
    </div>
    <div style="margin-top:14px;border-top:1px solid var(--c-border);padding-top:12px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <h4 style="font-size:13px;font-weight:700">📐 規格 × 🎨 カラー別単価</h4>
        <button class="btn btn-secondary btn-sm" onclick="addMepGroup()">＋ 規格を追加</button>
      </div>
      <div id="mep-groups">
        ${Object.entries(specGroups).map(([spec,items],gi)=>renderMepGroup(spec,items,gi)).join('')}
      </div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn btn-secondary" onclick="document.getElementById('mat-edit-ov').remove()">キャンセル</button>
      <button class="btn btn-primary" onclick="saveMatMasterFromSheet('${esc(m?.material_id||'')}')">保存して資材シートに反映</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov) ov.remove();});
}

function addMepGroup() {
  const container=document.getElementById('mep-groups'); if(!container) return;
  const gi=container.querySelectorAll('.mep-group').length;
  const div=document.createElement('div');
  div.className='mep-group'; div.id='mepg-'+gi;
  div.style.cssText='border:1px solid var(--c-border);border-radius:8px;padding:12px;margin-bottom:10px';
  div.innerHTML=`
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <label style="font-size:12px;font-weight:600;white-space:nowrap">規格/サイズ：</label>
      <input type="text" id="mepg-spec-${gi}" placeholder="例: 13mm" style="flex:1;font-size:12px;font-weight:600">
      <button class="del-btn" onclick="document.getElementById('mepg-${gi}').remove()">✕</button>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead><tr style="background:var(--c-bg)">
        <th style="padding:4px 6px;border-bottom:0.5px solid var(--c-border)">カラーコード</th>
        <th style="padding:4px 6px;border-bottom:0.5px solid var(--c-border)">カラー名</th>
        <th style="padding:4px 6px;text-align:right;border-bottom:0.5px solid var(--c-border)">単価（円）</th>
        <th style="padding:4px 6px;border-bottom:0.5px solid var(--c-border)">備考</th>
        <th style="width:24px;border-bottom:0.5px solid var(--c-border)"></th>
      </tr></thead>
      <tbody id="mepg-tbody-${gi}"></tbody>
    </table>
    <button class="btn btn-secondary btn-sm" style="margin-top:6px;font-size:11px" onclick="addMepColorRow(${gi})">＋ カラーを追加</button>`;
  container.appendChild(div);
  addMepColorRow(gi);
}

function addMepColorRow(gi) {
  const tbody=document.getElementById('mepg-tbody-'+gi); if(!tbody) return;
  const tr=document.createElement('tr');
  tr.innerHTML=`
    <td style="padding:3px 4px"><input type="text" class="mepg-code" placeholder="#115" style="width:100%;font-size:11px"></td>
    <td style="padding:3px 4px"><input type="text" class="mepg-cname" placeholder="ホワイト" style="width:100%;font-size:11px"></td>
    <td style="padding:3px 4px"><input type="number" class="mepg-price" placeholder="0" style="width:100%;font-size:11px;text-align:right"></td>
    <td style="padding:3px 4px"><input type="text" class="mepg-memo" placeholder="" style="width:100%;font-size:11px"></td>
    <td style="padding:3px 4px"><button class="del-btn" onclick="this.closest('tr').remove()" style="font-size:10px">✕</button></td>`;
  tbody.appendChild(tr);
}

async function saveMatMasterFromSheet(id) {
  const g = el => document.getElementById(el)?.value||'';
  if(!g('mep-name')){ toast('品名を入力してください','error'); return; }

  const res = await api('materials.upsert',{
    material_id:id||undefined, category:g('mep-cat'), product_no:g('mep-no'),
    product_name:g('mep-name'), quality:g('mep-quality'), unit:g('mep-unit'),
    unit_price:parseFloat(g('mep-price-base'))||0, supplier_name:g('mep-sup'), maker_name:g('mep-maker')
  });
  if(!res||!res.ok){ toast('保存失敗','error'); return; }

  const material_id = id||res.material_id;
  const prices = [];
  document.querySelectorAll('.mep-group').forEach((grp,gi)=>{
    const spec = (document.getElementById('mepg-spec-'+gi)?.value||'').trim();
    grp.querySelectorAll('tbody tr').forEach(tr=>{
      const code  = tr.querySelector('.mepg-code')?.value||'';
      const cname = tr.querySelector('.mepg-cname')?.value||'';
      const price = parseFloat(tr.querySelector('.mepg-price')?.value)||0;
      const memo  = tr.querySelector('.mepg-memo')?.value||'';
      if(code||cname) prices.push({spec, color_code:code, color_name:cname, unit_price:price, memo});
    });
  });

  if(material_id) await api('material_color_prices.upsert',{material_id,prices});

  toast('マスタを保存しました（カラー単価'+prices.length+'件）','success');
  const mr = await api('materials.list'); if(mr) _masters.materials=mr.items;
  document.getElementById('mat-edit-ov')?.remove();

  // 資材シートの該当行に単価を自動反映
  if(prices.length>0) {
    const prodColors = _productColors.filter(c=>c.code);
    const specVal = prices[0]?.spec||'';
    _materialRows.forEach((_,idx)=>{
      const rowName = getMF(idx,'product_name');
      if(rowName===g('mep-name') || getMF(idx,'product_no')===g('mep-no')) {
        if(_materialRows[idx]) _materialRows[idx]._material_id = material_id;
        // 規格を自動設定
        const specEl = document.querySelector(`[data-r="${idx}"][data-f="spec"]`);
        if(specEl && !specEl.value && specVal) specEl.value = specVal;
        // 製品カラーに対応する単価を設定
        const useSpec = specEl?.value||specVal;
        const filteredPrices = prices.filter(p=>(p.spec||'')===(useSpec||''));
        prodColors.forEach((pc,ci)=>{
          const matched = filteredPrices.find(p=>
            p.color_name&&pc.name&&(p.color_name.includes(pc.name)||pc.name.includes(p.color_name))
          ) || filteredPrices[ci];
          if(matched) {
            const codeEl  = document.querySelector(`[data-r="${idx}"][data-f="col${ci+1}_matcode"]`);
            const priceEl = document.querySelector(`[data-r="${idx}"][data-f="col${ci+1}_price"]`);
            if(codeEl)  codeEl.value  = matched.color_code||'';
            if(priceEl) priceEl.value = matched.unit_price||'';
          }
        });
        calcRowTotal(idx);
      }
    });
  }
}

async function saveMaterial(id) {
  const g = el => document.getElementById(el)?.value||'';
  if(!g('mc-name')){ toast('品名を入力してください','error'); return; }

  // 資材本体を保存
  const res = await api('materials.upsert',{
    material_id:id||undefined, category:g('mc-cat'), product_no:g('mc-no'),
    product_name:g('mc-name'), quality:g('mc-quality'), unit:g('mc-unit'),
    unit_price:parseFloat(g('mc-price'))||0, supplier_name:g('mc-sup'),
    maker_name:g('mc-maker'), memo:g('mc-memo')
  });
  if(!res||!res.ok){ toast('保存失敗','error'); return; }

  // 規格×カラー単価を収集して保存
  const material_id = id||res.material_id;
  const prices = [];
  const groups = document.querySelectorAll('.spec-group');
  groups.forEach((grp, gi)=>{
    const spec = (document.getElementById('sg-spec-'+gi)?.value||'').trim();
    const rows = grp.querySelectorAll('tbody tr');
    rows.forEach(tr=>{
      const codes  = tr.querySelectorAll('.sg-code');
      const cnames = tr.querySelectorAll('.sg-cname');
      const prs    = tr.querySelectorAll('.sg-price');
      const memos  = tr.querySelectorAll('.sg-memo');
      if(!codes.length) return;
      const code  = codes[0].value||'';
      const cname = cnames[0].value||'';
      const price = parseFloat(prs[0].value)||0;
      const memo  = memos[0].value||'';
      if(code||cname) prices.push({spec, color_code:code, color_name:cname, unit_price:price, memo});
    });
  });

  if(material_id) {
    await api('material_color_prices.upsert', {material_id, prices});
  }

  toast('保存しました（規格グループ'+(document.querySelectorAll('.spec-group').length)+'件・カラー単価'+prices.length+'件）','success');
  const r = await api('materials.list'); if(r) _masters.materials=r.items;
  renderMaterialPage(document.getElementById('master-content'));
}

// ---- カラー ----
function renderColorPage(c) {
  c.innerHTML=`<div class="card">
    <div style="display:flex;gap:8px;margin-bottom:16px;align-items:center">
      <h3 style="font-size:15px;font-weight:700;flex:1">カラーマスタ（${_masters.colors.length}色）</h3>
      <button class="btn btn-primary btn-sm" onclick="openAddColor()">＋ カラー追加</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px">
      ${_masters.colors.map(col=>`<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--c-border);border-radius:6px">
        <span style="display:inline-block;width:20px;height:20px;border-radius:4px;background:${esc(col.hex||'#ccc')};border:1px solid var(--c-border);flex-shrink:0"></span>
        <div style="min-width:0"><div style="font-size:11px;font-weight:600;font-family:monospace">${esc(col.color_code)}</div>
        <div style="font-size:11px;color:var(--c-text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(col.color_name_ja)}</div></div>
      </div>`).join('')}
    </div></div>`;
}
async function openAddColor() {
  const code=prompt('カラーコード（001〜 例: 101）'); if(!code) return;
  const nameJa=prompt('カラー名（日本語）'); if(!nameJa) return;
  const nameEn=prompt('Color name (English)')||'';
  const hex=prompt('HEXカラーコード（例: #C8B89A）')||'';
  const res=await api('colors.upsert',{color_code:code,color_name_ja:nameJa,color_name_en:nameEn,hex,sort_order:_masters.colors.length+1});
  if(!res||!res.ok){toast('保存失敗','error');return;}
  toast('カラーを追加しました','success');
  const r=await api('colors.list'); if(r) _masters.colors=r.items;
  renderColorPage(document.getElementById('master-content'));
}

// ---- サイズ ----
function renderSizePage(c) {
  c.innerHTML=`<div class="card">
    <div style="display:flex;gap:8px;margin-bottom:16px;align-items:center">
      <h3 style="font-size:15px;font-weight:700;flex:1">サイズマスタ</h3>
      <button class="btn btn-primary btn-sm" onclick="openAddSize()">＋ サイズ追加</button>
    </div>
    <table class="master-table"><thead><tr><th>サイズ名</th><th>グループ</th><th>表示順</th></tr></thead>
    <tbody>${_masters.sizes.map(s=>`<tr><td><strong>${esc(s.size_name)}</strong></td><td>${esc(s.size_group)}</td><td>${esc(s.sort_order)}</td></tr>`).join('')}</tbody>
    </table></div>`;
}
async function openAddSize() {
  const name=prompt('サイズ名（例: 2XL / 38 / F）'); if(!name) return;
  const res=await api('sizes.upsert',{size_name:name,size_group:'adult',sort_order:_masters.sizes.length+1});
  if(!res||!res.ok){toast('保存失敗','error');return;}
  toast('サイズを追加しました','success');
  const r=await api('sizes.list'); if(r) _masters.sizes=r.items;
  renderSizePage(document.getElementById('master-content'));
}

// ---- CSV共通 ----
function exportCSV(items, fields, filename) {
  const rows=[fields];
  items.forEach(item=>rows.push(fields.map(f=>String(item[f]||''))));
  const csv=rows.map(r=>r.map(v=>'"'+v.replace(/"/g,'""')+'"').join(',')).join('\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'}));
  a.download=filename+'.csv'; a.click();
}

// ===== 起動 =====
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('l-pass').addEventListener('keydown', e=>{if(e.key==='Enter') doLogin();});
  if (_token && _user) { bootApp(); }
  else { document.getElementById('login-screen').classList.add('show'); }
});
