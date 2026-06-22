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
async function bootApp() {
  document.getElementById('login-screen').classList.remove('show');
  document.getElementById('app').style.display='flex';
  document.getElementById('user-disp').textContent = _user?.display_name||_user?.username||'';

  // マスタを順番に取得（並列だとGASが負荷で落ちることがある）
  const tryLoad = async (action, key) => {
    const r = await api(action, {});
    if (r && r.ok) _masters[key] = r.items || [];
  };
  await tryLoad('colors.list',    'colors');
  await tryLoad('sizes.list',     'sizes');
  await tryLoad('partners.list',  'partners');
  await tryLoad('customers.list', 'customers');
  await tryLoad('materials.list', 'materials');
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
  document.getElementById('fs-badge').innerHTML=statusBadge(res.item.status);
  document.getElementById('fs-tabs').innerHTML=
    '<button class="fs-tab active" id="fstab-product"    onclick="switchFsTab(\'product\')">📋 製品シート</button>'+
    '<button class="fs-tab"        id="fstab-materials"  onclick="switchFsTab(\'materials\')">🧵 資材シート</button>'+
    '<button class="fs-tab"        id="fstab-orderqty"   onclick="switchFsTab(\'orderqty\')">📊 発注数量</button>'+
    '<button class="fs-tab"        id="fstab-processes"  onclick="switchFsTab(\'processes\')">🔧 工程</button>';
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

function switchFsTab(tab) {
  _currentFsTab=tab;
  document.querySelectorAll('.fs-tab').forEach(t=>t.classList.remove('active'));
  const b=document.getElementById('fstab-'+tab); if(b) b.classList.add('active');
  if(tab==='product')   { document.getElementById('fs-body').innerHTML=renderProductForm(_currentProduct); setupImagePaste(); }
  if(tab==='materials')  renderMaterialsTab();
  if(tab==='orderqty')   renderOrderQtyTab();
  if(tab==='processes')  renderProcessesTab();
}
async function saveFsTab() {
  if(_currentFsTab==='product')   await saveProductData();
  if(_currentFsTab==='materials') await saveMaterialsData();
  if(_currentFsTab==='orderqty')  await saveOrderQty();
  if(_currentFsTab==='processes') await saveProcesses();
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
      <div style="display:flex;align-items:center;gap:6px;margin-left:auto">
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
          <th rowspan="2" style="width:28px">No.</th>
          <th rowspan="2" style="min-width:90px">品番</th>
          <th rowspan="2" style="min-width:140px">品名</th>
          <th rowspan="2" style="min-width:80px">規格</th>
          <th rowspan="2" style="width:75px">分類</th>
          <th rowspan="2" style="min-width:110px">使用箇所</th>
          <th rowspan="2" style="width:55px">用尺</th>
          <th rowspan="2" style="width:44px">単位</th>
          ${colorHeaders}
          <th rowspan="2" style="width:48px">ロス%</th>
          <th rowspan="2" style="min-width:100px">仕入先</th>
          <th rowspan="2" style="min-width:80px">メーカー</th>
          <th rowspan="2" style="min-width:80px">メモ</th>
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

const _matFields = ['product_no','product_name','spec','category','usage_location',
  'usage_quantity','unit','loss_rate','supplier_name','maker_name','memo'];

function appendMatRow(tbody, r, idx, supOpts) {
  const sN = s => s.partner_name||s.supplier_name||'';
  if(!supOpts) supOpts='<option value="">-</option>'+_masters.suppliers.map(s=>`<option value="${esc(sN(s))}">${esc(sN(s))}</option>`).join('');

  // カラーセル（カラーコード+単価の2段）
  const prodColors = _productColors.filter(c=>c.code);
  const colorCells = Array.from({length:_matColorCols},(_,n)=>{
    const matCode = r['col'+(n+1)+'_matcode']||'';
    const price   = r['col'+(n+1)+'_price']||'';
    return `<td style="padding:3px 4px;min-width:120px;background:${n%2===0?'#F7FAFF':'#EFF4FF'}">
      <input type="text" data-r="${idx}" data-f="col${n+1}_matcode" value="${esc(matCode)}" placeholder="資材カラーコード" style="font-size:10px;width:100%;margin-bottom:2px;border-radius:3px">
      <input type="number" step="1" data-r="${idx}" data-f="col${n+1}_price" value="${esc(price)}" placeholder="単価" oninput="calcRowTotal(${idx})" style="font-size:11px;width:100%;text-align:right;border-radius:3px;font-weight:600;color:#2B5CE6">
    </td>`;
  }).join('');

  const tr=document.createElement('tr');
  tr.dataset.idx=idx;
  tr.innerHTML=`
    <td class="slot-cell">${idx+1}</td>
    <td><input type="text" data-r="${idx}" data-f="product_no"   value="${esc(r.product_no||'')}"   placeholder="品番" style="min-width:80px"></td>
    <td><input type="text" data-r="${idx}" data-f="product_name" value="${esc(r.product_name||'')}" placeholder="品名" list="mat-names" style="min-width:130px"></td>
    <td><input type="text" data-r="${idx}" data-f="spec"         value="${esc(r.spec||'')}"         placeholder="規格"></td>
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
    <td style="text-align:center;white-space:nowrap">
      <div id="rp-${idx}" style="font-size:10px;font-weight:600;color:var(--c-primary);margin-bottom:2px">-</div>
      <button class="btn btn-secondary btn-sm" style="font-size:10px;padding:2px 5px;margin-bottom:2px" onclick="editMatMaster(${idx})" title="マスタ編集">✏️</button>
      <button class="del-btn" onclick="delMatRow(${idx})" title="削除">✕</button>
    </td>`;
  tbody.appendChild(tr);
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
  const method = document.getElementById('cost-calc-method')?.value || _currentProduct.cost_calc_method||'average';

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

// 資材シートから直接マスタ編集
function editMatMaster(idx) {
  const no   = getMF(idx,'product_no');
  const name = getMF(idx,'product_name');
  // マスタ検索
  const mat = _masters.materials.find(m=>m.product_no===no||m.product_name===name);
  if(mat) {
    openMaterialFormWithColorPrices(mat, _masters.materials.indexOf(mat));
  } else {
    // マスタ未登録の場合は新規登録
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
    // カラー単価
    for(let n=1;n<=_matColorCols;n++){
      o['col'+n+'_matcode'] = getMF(idx,'col'+n+'_matcode');
      o['col'+n+'_price']   = getMF(idx,'col'+n+'_price');
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

async function renderOrderQtyTab() {
  const res = await api('order_qty.get', {style_code: _currentProduct.style_code});
  const rows = res?.items || [];
  // データをマップに変換
  _orderQtyData = {};
  rows.forEach(r => {
    if (!_orderQtyData[r.color_code]) _orderQtyData[r.color_code] = {};
    _orderQtyData[r.color_code][r.size_name] = Number(r.quantity)||0;
  });

  const colors = _productColors.filter(c=>c.code);
  const sizes  = (_currentProduct.size_range||'').split('/').map(s=>s.trim()).filter(Boolean);

  if (!colors.length) { document.getElementById('fs-body').innerHTML='<div class="empty-state"><div class="icon">🎨</div><p>製品シートでカラーを登録してください</p></div>'; return; }
  if (!sizes.length)  { document.getElementById('fs-body').innerHTML='<div class="empty-state"><div class="icon">📐</div><p>製品シートでサイズ展開を登録してください</p></div>'; return; }

  let html = `<div class="section-card">
    <h3>📊 発注数量（カラー × サイズ）</h3>
    <p style="font-size:12px;color:var(--c-text2);margin-bottom:14px">各セルに発注数量を入力してください</p>
    <div style="overflow-x:auto"><table class="material-table" style="min-width:auto">
    <thead><tr><th style="min-width:120px">カラー</th>`;
  sizes.forEach(s => { html += `<th style="width:70px;text-align:right">${esc(s)}</th>`; });
  html += `<th style="width:70px;text-align:right;background:#EEF2FD;color:#2B5CE6">合計</th></tr></thead><tbody>`;

  colors.forEach(c => {
    html += `<tr><td style="font-weight:600">${esc(c.code)} ${esc(c.name)}</td>`;
    sizes.forEach(s => {
      const v = (_orderQtyData[c.code]||{})[s] || '';
      html += `<td><input type="number" min="0" data-color="${esc(c.code)}" data-size="${esc(s)}" value="${v}" placeholder="0" oninput="updateQtyTotal()" style="width:60px;text-align:right;border:none;background:transparent;font-size:13px"></td>`;
    });
    html += `<td id="row-total-${esc(c.code)}" style="text-align:right;font-weight:700;color:var(--c-primary);padding-right:8px">-</td></tr>`;
  });

  // 合計行
  html += `<tr style="background:#EEF2FD"><td style="font-weight:700;color:#2B5CE6">合計</td>`;
  sizes.forEach(s => { html += `<td id="col-total-${esc(s)}" style="text-align:right;font-weight:700;color:#2B5CE6">-</td>`; });
  html += `<td id="grand-total" style="text-align:right;font-weight:700;font-size:15px;color:#2B5CE6">-</td></tr>`;
  html += `</tbody></table></div></div>`;
  document.getElementById('fs-body').innerHTML = html;
  updateQtyTotal();
}

function updateQtyTotal() {
  const colors = _productColors.filter(c=>c.code);
  const sizes  = (_currentProduct.size_range||'').split('/').map(s=>s.trim()).filter(Boolean);
  const colTotals = {}; sizes.forEach(s=>{ colTotals[s]=0; });
  let grand = 0;
  colors.forEach(c => {
    let rowTotal = 0;
    sizes.forEach(s => {
      const v = parseInt(document.querySelector(`[data-color="${c.code}"][data-size="${s}"]`)?.value)||0;
      rowTotal += v; colTotals[s] += v; grand += v;
    });
    const rt = document.getElementById('row-total-'+c.code);
    if(rt) rt.textContent = rowTotal.toLocaleString();
  });
  sizes.forEach(s => {
    const ct = document.getElementById('col-total-'+s);
    if(ct) ct.textContent = colTotals[s].toLocaleString();
  });
  const gt = document.getElementById('grand-total');
  if(gt) gt.textContent = grand.toLocaleString();
}

async function saveOrderQty() {
  const colors = _productColors.filter(c=>c.code);
  const sizes  = (_currentProduct.size_range||'').split('/').map(s=>s.trim()).filter(Boolean);
  const rows = [];
  colors.forEach(c => {
    sizes.forEach(s => {
      const v = parseInt(document.querySelector(`[data-color="${c.code}"][data-size="${s}"]`)?.value)||0;
      if(v>0) rows.push({color_code:c.code, color_name:c.name, size_name:s, quantity:v});
    });
  });
  const res = await api('order_qty.save', {style_code:_currentProduct.style_code, rows});
  if(!res||!res.ok) { toast('保存失敗','error'); return; }
  toast('発注数量を保存しました','success');
}

// ===== 工程タブ =====
let _processRows = [];
const PROCESS_STATUS = {pending:'未着手', in_progress:'進行中', completed:'完了', cancelled:'中止'};

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
    <div style="overflow-x:auto"><table class="material-table">
    <thead><tr>
      <th style="width:28px"><input type="checkbox" id="chk-all" onchange="toggleAllProcess(this)" title="全選択" style="width:14px;height:14px"></th>
      <th style="width:30px">順</th>
      <th style="min-width:90px">工程名</th>
      <th style="width:80px">種別</th>
      <th style="min-width:130px">加工場（実作業）</th>
      <th style="min-width:110px">発注先（仕入先）</th>
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
    const noRes = await api('order_no.generate', {type:'S'});
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
  const m=idx!==undefined?_masters.materials[idx]:null;
  const supOpts='<option value="">-</option>'+_masters.suppliers.map(s=>`<option value="${esc(s.partner_name||s.supplier_name)}" ${m?.supplier_name===(s.partner_name||s.supplier_name)?'selected':''}>${esc(s.partner_name||s.supplier_name)}</option>`).join('');
  const a=document.getElementById('mat-form'); if(!a) return;

  // 既存のカラー単価を取得
  let colorPrices = [];
  if(m?.material_id) {
    const cpRes = await api('material_color_prices.get', {material_id:m.material_id});
    colorPrices = cpRes?.items||[];
  }

  const cpRows = colorPrices.map((cp,i)=>`
    <tr>
      <td><input type="text" id="cp-code-${i}" value="${esc(cp.color_code||'')}" placeholder="#115" style="width:100%;font-size:12px"></td>
      <td><input type="text" id="cp-name-${i}" value="${esc(cp.color_name||'')}" placeholder="ホワイト" style="width:100%;font-size:12px"></td>
      <td><input type="number" id="cp-price-${i}" value="${esc(cp.unit_price||'')}" placeholder="0" style="width:100%;font-size:12px;text-align:right"></td>
      <td><input type="text" id="cp-memo-${i}" value="${esc(cp.memo||'')}" placeholder="備考" style="width:100%;font-size:12px"></td>
      <td><button class="del-btn" onclick="this.closest('tr').remove();updateCpCount()" style="font-size:11px">✕</button></td>
    </tr>`).join('');

  a.innerHTML=`<div class="card" style="margin-top:16px">
    <h3 style="font-size:15px;font-weight:700;margin-bottom:16px">${m?'資材を編集':'新規資材登録'}</h3>
    <div class="form-row form-row-3">
      <div class="form-group"><label>分類</label><select id="mc-cat">${CATEGORIES.map(c=>`<option value="${c}" ${m?.category===c?'selected':''}>${c}</option>`).join('')}</select></div>
      <div class="form-group"><label>品番</label><input type="text" id="mc-no" value="${esc(m?.product_no||'')}"></div>
      <div class="form-group"><label>品名 ★</label><input type="text" id="mc-name" value="${esc(m?.product_name||'')}"></div>
    </div>
    <div class="form-row form-row-3">
      <div class="form-group"><label>規格・サイズ</label><input type="text" id="mc-spec" value="${esc(m?.spec||'')}"></div>
      <div class="form-group"><label>品質・組成</label><input type="text" id="mc-quality" value="${esc(m?.quality||'')}"></div>
      <div class="form-group"><label>単位</label><select id="mc-unit">${UNITS.map(u=>`<option value="${u}" ${m?.unit===u?'selected':''}>${u}</option>`).join('')}</select></div>
    </div>
    <div class="form-row form-row-3">
      <div class="form-group"><label>仕入先</label><select id="mc-sup">${supOpts}</select></div>
      <div class="form-group"><label>メーカー名</label><input type="text" id="mc-maker" value="${esc(m?.maker_name||'')}"></div>
      <div class="form-group"><label>基準単価（円）</label><input type="number" id="mc-price" value="${esc(m?.unit_price||'')}"></div>
    </div>
    <div class="form-group"><label>備考</label><textarea id="mc-memo">${esc(m?.memo||'')}</textarea></div>

    <div style="margin-top:16px;border-top:1px solid var(--c-border);padding-top:14px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <h4 style="font-size:13px;font-weight:700">🎨 カラー別単価</h4>
        <button class="btn btn-secondary btn-sm" type="button" onclick="addCpRow()">＋ カラーを追加</button>
        <span style="font-size:11px;color:var(--c-text3)">規格/カラーごとに単価を設定。資材シートに自動転記されます。</span>
      </div>
      <table class="master-table" style="font-size:12px">
        <thead><tr><th>カラーコード</th><th>カラー名</th><th>単価（円）</th><th>備考</th><th style="width:28px"></th></tr></thead>
        <tbody id="cp-tbody">${cpRows}</tbody>
      </table>
      <div id="cp-count" style="font-size:11px;color:var(--c-text3);margin-top:6px">${colorPrices.length}件登録済み</div>
    </div>

    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn btn-secondary" onclick="document.getElementById('mat-form').innerHTML=''">キャンセル</button>
      <button class="btn btn-primary" onclick="saveMaterial('${esc(m?.material_id||'')}')">保存する</button>
    </div></div>`;
  a.scrollIntoView({behavior:'smooth'});
}

async function openMaterialFormWithColorPrices(m, matIdx) {
  // 資材シートから直接マスタ編集（オーバーレイで開く）
  const supOpts='<option value="">-</option>'+_masters.suppliers.map(s=>`<option value="${esc(s.partner_name||s.supplier_name)}" ${m?.supplier_name===(s.partner_name||s.supplier_name)?'selected':''}>${esc(s.partner_name||s.supplier_name)}</option>`).join('');

  let colorPrices = [];
  if(m?.material_id) {
    const cpRes = await api('material_color_prices.get', {material_id:m.material_id});
    colorPrices = cpRes?.items||[];
  }

  const cpRows = colorPrices.map((cp,i)=>`<tr>
    <td><input type="text" id="mep-code-${i}" value="${esc(cp.color_code||'')}" placeholder="#115" style="width:100%;font-size:12px"></td>
    <td><input type="text" id="mep-name-${i}" value="${esc(cp.color_name||'')}" placeholder="ホワイト" style="width:100%;font-size:12px"></td>
    <td><input type="number" id="mep-price-${i}" value="${esc(cp.unit_price||'')}" placeholder="0" style="width:100%;font-size:12px;text-align:right"></td>
    <td><input type="text" id="mep-memo-${i}" value="${esc(cp.memo||'')}" placeholder="備考" style="width:100%;font-size:12px"></td>
    <td><button class="del-btn" onclick="this.closest('tr').remove()" style="font-size:11px">✕</button></td>
  </tr>`).join('');

  const ov = document.createElement('div');
  ov.id='mat-edit-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9200;display:flex;align-items:center;justify-content:center';
  ov.innerHTML=`<div style="background:var(--c-surface);border-radius:12px;padding:24px;width:640px;max-width:95vw;max-height:85vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.3)">
    <h3 style="font-size:16px;font-weight:700;margin-bottom:16px">✏️ 資材マスタ編集：${esc(m?.product_name||'新規')}</h3>
    <div class="form-row form-row-3">
      <div class="form-group"><label>分類</label><select id="mep-cat">${CATEGORIES.map(c=>`<option value="${c}" ${m?.category===c?'selected':''}>${c}</option>`).join('')}</select></div>
      <div class="form-group"><label>品番</label><input type="text" id="mep-no" value="${esc(m?.product_no||'')}"></div>
      <div class="form-group"><label>品名 ★</label><input type="text" id="mep-name" value="${esc(m?.product_name||'')}"></div>
    </div>
    <div class="form-row form-row-3">
      <div class="form-group"><label>規格</label><input type="text" id="mep-spec" value="${esc(m?.spec||'')}"></div>
      <div class="form-group"><label>単位</label><select id="mep-unit">${UNITS.map(u=>`<option value="${u}" ${m?.unit===u?'selected':''}>${u}</option>`).join('')}</select></div>
      <div class="form-group"><label>基準単価（円）</label><input type="number" id="mep-price-base" value="${esc(m?.unit_price||'')}"></div>
    </div>
    <div class="form-row form-row-2">
      <div class="form-group"><label>仕入先</label><select id="mep-sup">${supOpts}</select></div>
      <div class="form-group"><label>メーカー</label><input type="text" id="mep-maker" value="${esc(m?.maker_name||'')}"></div>
    </div>

    <div style="margin-top:14px;border-top:1px solid var(--c-border);padding-top:12px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <h4 style="font-size:13px;font-weight:700">🎨 カラー別単価</h4>
        <button class="btn btn-secondary btn-sm" type="button" onclick="addMepRow()">＋ カラーを追加</button>
      </div>
      <table class="master-table" style="font-size:12px">
        <thead><tr><th>カラーコード</th><th>カラー名</th><th>単価（円）</th><th>備考</th><th style="width:28px"></th></tr></thead>
        <tbody id="mep-tbody">${cpRows}</tbody>
      </table>
    </div>

    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn btn-secondary" onclick="document.getElementById('mat-edit-ov').remove()">キャンセル</button>
      <button class="btn btn-primary" onclick="saveMatMasterFromSheet('${esc(m?.material_id||'')}')">保存して資材シートに反映</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov) ov.remove();});
}

function addMepRow() {
  const tbody=document.getElementById('mep-tbody'); if(!tbody) return;
  const i=tbody.querySelectorAll('tr').length;
  const tr=document.createElement('tr');
  tr.innerHTML=`
    <td><input type="text" id="mep-code-${i}" placeholder="#115" style="width:100%;font-size:12px"></td>
    <td><input type="text" id="mep-name-${i}" placeholder="ホワイト" style="width:100%;font-size:12px"></td>
    <td><input type="number" id="mep-price-${i}" placeholder="0" style="width:100%;font-size:12px;text-align:right"></td>
    <td><input type="text" id="mep-memo-${i}" placeholder="備考" style="width:100%;font-size:12px"></td>
    <td><button class="del-btn" onclick="this.closest('tr').remove()" style="font-size:11px">✕</button></td>`;
  tbody.appendChild(tr);
}

async function saveMatMasterFromSheet(id) {
  const g = el => document.getElementById(el)?.value||'';
  if(!g('mep-name')){toast('品名を入力してください','error');return;}

  // 資材本体を保存
  const res = await api('materials.upsert',{
    material_id:id||undefined, category:g('mep-cat'), product_no:g('mep-no'),
    product_name:g('mep-name'), spec:g('mep-spec'), unit:g('mep-unit'),
    unit_price:parseFloat(g('mep-price-base'))||0, supplier_name:g('mep-sup'), maker_name:g('mep-maker')
  });
  if(!res||!res.ok){toast('保存失敗','error');return;}

  // カラー単価を保存
  const material_id = id||res.material_id;
  const rows = document.querySelectorAll('#mep-tbody tr');
  const prices = [];
  rows.forEach((tr,i)=>{
    const code  = document.getElementById('mep-code-'+i)?.value||'';
    const name  = document.getElementById('mep-name-'+i)?.value||'';
    const price = parseFloat(document.getElementById('mep-price-'+i)?.value)||0;
    const memo  = document.getElementById('mep-memo-'+i)?.value||'';
    if(code||name) prices.push({color_code:code, color_name:name, unit_price:price, memo});
  });
  if(material_id) {
    await api('material_color_prices.upsert', {material_id, prices});
  }

  toast('マスタを保存しました','success');

  // マスタ更新
  const mr = await api('materials.list'); if(mr) _masters.materials=mr.items;
  document.getElementById('mat-edit-ov')?.remove();

  // 資材シートの該当行の単価を自動反映（製品カラー順にCol.の単価を更新）
  if(prices.length > 0) {
    const prodColors = _productColors.filter(c=>c.code);
    // 現在フォーカスされている行を探す
    const tbody = document.getElementById('mat-tbody');
    if(tbody) {
      const matName = g('mep-name');
      _materialRows.forEach((_,idx)=>{
        const rowName = getMF(idx,'product_name');
        const rowNo   = getMF(idx,'product_no');
        if(rowName===matName || (g('mep-no') && rowNo===g('mep-no'))) {
          // 製品カラーに対応するカラー単価を設定
          prodColors.forEach((pc,ci)=>{
            // 製品カラー名と資材カラー名で照合（部分一致）
            const matched = prices.find(p=>
              p.color_name && pc.name &&
              (p.color_name.includes(pc.name) || pc.name.includes(p.color_name))
            ) || prices[ci]; // 順番でフォールバック
            if(matched) {
              const codeEl  = document.querySelector(`[data-r="${idx}"][data-f="col${ci+1}_matcode"]`);
              const priceEl = document.querySelector(`[data-r="${idx}"][data-f="col${ci+1}_price"]`);
              if(codeEl && !codeEl.value)  codeEl.value  = matched.color_code||'';
              if(priceEl && !priceEl.value) priceEl.value = matched.unit_price||'';
            }
          });
          calcRowTotal(idx);
        }
      });
    }
  }
}

function addCpRow() {
  const tbody = document.getElementById('cp-tbody'); if(!tbody) return;
  const i = tbody.querySelectorAll('tr').length;
  const tr = document.createElement('tr');
  tr.innerHTML=`
    <td><input type="text" id="cp-code-${i}" placeholder="#115" style="width:100%;font-size:12px"></td>
    <td><input type="text" id="cp-name-${i}" placeholder="ホワイト" style="width:100%;font-size:12px"></td>
    <td><input type="number" id="cp-price-${i}" placeholder="0" style="width:100%;font-size:12px;text-align:right"></td>
    <td><input type="text" id="cp-memo-${i}" placeholder="備考" style="width:100%;font-size:12px"></td>
    <td><button class="del-btn" onclick="this.closest('tr').remove();updateCpCount()" style="font-size:11px">✕</button></td>`;
  tbody.appendChild(tr);
  updateCpCount();
}

function updateCpCount() {
  const tbody = document.getElementById('cp-tbody');
  const el = document.getElementById('cp-count');
  if(tbody&&el) el.textContent=tbody.querySelectorAll('tr').length+'件';
}

async function saveMaterial(id) {
  const g=el=>document.getElementById(el)?.value||'';
  if(!g('mc-name')){toast('品名を入力してください','error');return;}

  // 資材本体を保存
  const res=await api('materials.upsert',{
    material_id:id||undefined,category:g('mc-cat'),product_no:g('mc-no'),
    product_name:g('mc-name'),spec:g('mc-spec'),quality:g('mc-quality'),
    unit:g('mc-unit'),supplier_name:g('mc-sup'),maker_name:g('mc-maker'),
    unit_price:parseFloat(g('mc-price'))||0,memo:g('mc-memo')
  });
  if(!res||!res.ok){toast('保存失敗','error');return;}

  // カラー単価を保存
  const material_id = id||res.material_id;
  const cpRows = document.querySelectorAll('#cp-tbody tr');
  const prices = [];
  cpRows.forEach((tr,i)=>{
    const code  = document.getElementById('cp-code-'+i)?.value||'';
    const name  = document.getElementById('cp-name-'+i)?.value||'';
    const price = parseFloat(document.getElementById('cp-price-'+i)?.value)||0;
    const memo  = document.getElementById('cp-memo-'+i)?.value||'';
    if(code||name) prices.push({color_code:code,color_name:name,unit_price:price,memo});
  });
  if(material_id) {
    await api('material_color_prices.upsert', {material_id, prices});
  }

  toast('保存しました（カラー単価'+prices.length+'件）','success');
  const r=await api('materials.list'); if(r) _masters.materials=r.items;
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
