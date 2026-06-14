// ============================================================
//  Raises Lab OMS — app.js  Phase 1 FINAL
//  ・全通信JSONP方式（CORS完全回避）
//  ・ペイロード圧縮（不要フィールドを省いてURL長を削減）
//  ・ログイン含む全API統一
// ============================================================

const GAS_URL = 'https://script.google.com/macros/s/AKfycbwKxypPrqzxHtac7V4vGtvdYi11Vd8PfhJTS3PqMztyQbuIIzGWQzgsb_iLyt55NxDh/exec';

// ===== 状態 =====
let _token  = localStorage.getItem('rl_token') || null;
let _user   = JSON.parse(localStorage.getItem('rl_user') || 'null');
let _masters = { colors:[], sizes:[], suppliers:[], materials:[], factories:[] };
let _currentProduct = null;
let _currentFsTab   = 'product';
let _productPage    = 1;
let _materialRows   = [];
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
  await tryLoad('suppliers.list', 'suppliers');
  await tryLoad('factories.list', 'factories');
  await tryLoad('materials.list', 'materials');

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
    '<button class="fs-tab"        id="fstab-materials"  onclick="switchFsTab(\'materials\')">🧵 資材シート</button>';
  document.getElementById('fs-footer').innerHTML=
    '<button class="btn btn-secondary" onclick="closeFull()">閉じる</button>'+
    '<button class="btn btn-primary"   onclick="saveFsTab()">保存する</button>';
  document.getElementById('fs-body').innerHTML=renderProductForm(_currentProduct);
  setupImagePaste();
  openFull(res.item.brand_product_no||res.item.style_code);
}
function switchFsTab(tab) {
  _currentFsTab=tab;
  document.querySelectorAll('.fs-tab').forEach(t=>t.classList.remove('active'));
  const b=document.getElementById('fstab-'+tab); if(b) b.classList.add('active');
  if(tab==='product')  { document.getElementById('fs-body').innerHTML=renderProductForm(_currentProduct); setupImagePaste(); }
  if(tab==='materials') renderMaterialsTab();
}
async function saveFsTab() {
  if(_currentFsTab==='product')   await saveProductData();
  if(_currentFsTab==='materials') await saveMaterialsData();
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
    _masters.suppliers.map(s=>`<option value="${esc(s.supplier_id||'')}" ${p?.client_id===s.supplier_id?'selected':''}>${esc(s.supplier_name)}</option>`).join('');

  const facOpts = '<option value="">-- 選択 --</option>'+
    _masters.factories.map(f=>`<option value="${esc(f.factory_name||'')}" ${p?.factory_name===f.factory_name?'selected':''}>${esc(f.factory_name)}${f.process_type?' ('+esc(f.process_type)+')':''}</option>`).join('');

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
          <select id="f-client-sel" onchange="onClientSel(this)">${supOpts}</select>
          <input type="hidden" id="f-client-id" value="${esc(p?.client_id||'')}">
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
      <div class="form-group"><label>原産国</label><input type="text" id="f-country" value="${esc(p?.country_of_origin||'')}"></div>
    </div>
    <div class="section-card" style="margin-top:16px"><h3>🏭 生産情報</h3>
      <div class="form-row form-row-2">
        <div class="form-group"><label>パタンナー</label><input type="text" id="f-patternmaker" value="${esc(p?.patternmaker||'')}"></div>
        <div class="form-group"><label>パターンNo.</label><input type="text" id="f-pattern-no" value="${esc(p?.pattern_no||'')}"></div>
      </div>
      <div class="form-row form-row-2">
        <div class="form-group"><label>サンプルNo.</label><input type="text" id="f-sample-no" value="${esc(p?.sample_no||'')}"></div>
        <div class="form-group"><label>縫製工場</label><select id="f-factory">${facOpts}</select></div>
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
    <div class="section-card" style="margin-top:14px"><h3>🎨 製品カラー（Col.1〜7）</h3>
      <p style="font-size:10px;color:var(--c-text3);margin-bottom:8px">カラーマスタから選択</p>
      ${colorSelRows}
    </div>
  </div>
</div>`;
}

function onClientSel(sel) {
  document.getElementById('f-client-id').value = sel.value;
}
function onColorSel(i, sel) {
  const opt = sel.options[sel.selectedIndex];
  _productColors[i] = { code: opt.value, name: opt.dataset.name||'' };
}

function collectProductForm() {
  const g = id => document.getElementById(id)?.value||'';
  const colors = {};
  for (let i=0;i<7;i++) {
    const sel = document.getElementById('pc-sel-'+i);
    colors['product_color'+(i+1)+'_code'] = sel?.value||'';
    colors['product_color'+(i+1)+'_name'] = sel?.options[sel.selectedIndex]?.dataset?.name||'';
  }
  return {
    brand_product_no:  g('f-brand-no'),
    temp_product_no:   g('f-temp-no'),
    product_name:      g('f-name-ja'),
    product_name_en:   g('f-name-en'),
    brand:             g('f-brand'),
    client_id:         g('f-client-id'),
    item_code:         g('f-item'),
    item_name:         ITEMS.find(i=>i.code===g('f-item'))?.name||'',
    year:              g('f-year'),
    season:            g('f-season'),
    size_range:        g('f-size-range'),
    country_of_origin: g('f-country'),
    patternmaker:      g('f-patternmaker'),
    pattern_no:        g('f-pattern-no'),
    sample_no:         g('f-sample-no'),
    factory_name:      g('f-factory'),
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
  _materialRows = res?.items||[];
  if (_materialRows.length===0) {
    for(let i=0;i<10;i++) _materialRows.push({material_slot:String(i+1).padStart(2,'0')});
  }
  const supOpts='<option value="">-</option>'+_masters.suppliers.map(s=>`<option value="${esc(s.supplier_name)}">${esc(s.supplier_name)}</option>`).join('');

  document.getElementById('fs-body').innerHTML=`
    <div style="margin-bottom:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <code style="background:var(--c-bg);padding:2px 8px;border-radius:4px;font-size:12px">${esc(_currentProduct.style_code)}</code>
      <button class="btn btn-secondary btn-sm" onclick="addMatRow()">＋ 行を追加</button>
      <div style="margin-left:auto;font-size:13px">着単価合計: <strong id="mat-total" style="font-size:16px;color:var(--c-primary)">-</strong></div>
    </div>
    <datalist id="mat-names">${_masters.materials.map(m=>`<option value="${esc(m.product_name)}">`).join('')}</datalist>
    <div style="overflow-x:auto">
    <table class="material-table" id="mat-table">
      <thead><tr>
        <th style="width:32px">No.</th>
        <th style="min-width:160px">品名</th>
        <th style="min-width:120px">品番</th>
        <th style="min-width:90px">規格</th>
        <th style="width:80px">分類</th>
        <th style="min-width:90px">使用箇所</th>
        <th style="width:60px">要尺</th>
        <th style="width:50px">単位</th>
        <th style="min-width:120px">Col.1<br><small>コード/カラー名</small></th>
        <th style="min-width:120px">Col.2<br><small>コード/カラー名</small></th>
        <th style="min-width:120px">Col.3<br><small>コード/カラー名</small></th>
        <th style="min-width:120px">Col.4<br><small>コード/カラー名</small></th>
        <th style="min-width:120px">Col.5<br><small>コード/カラー名</small></th>
        <th style="min-width:120px">Col.6<br><small>コード/カラー名</small></th>
        <th style="min-width:120px">Col.7<br><small>コード/カラー名</small></th>
        <th style="width:55px">ロス%</th>
        <th style="width:70px">単価</th>
        <th style="width:70px">着単価</th>
        <th style="min-width:110px">仕入先</th>
        <th style="min-width:100px">メモ</th>
        <th style="width:28px"></th>
      </tr></thead>
      <tbody id="mat-tbody"></tbody>
    </table></div>`;

  const tbody=document.getElementById('mat-tbody');
  _materialRows.forEach((r,i)=>appendMatRow(tbody,r,i,supOpts));
  calcMatTotal();
}

function colCell(r, idx, n) {
  return `<td style="padding:3px 4px;min-width:110px">
    <input type="text" data-r="${idx}" data-f="color${n}_code" value="${esc(r['color'+n+'_code']||'')}" placeholder="コード" style="font-size:11px;border-radius:4px 4px 0 0;margin-bottom:-1px">
    <input type="text" data-r="${idx}" data-f="color${n}_name" value="${esc(r['color'+n+'_name']||'')}" placeholder="カラー名" style="font-size:11px;border-radius:0 0 4px 4px">
  </td>`;
}

function appendMatRow(tbody, r, idx, supOpts) {
  if (!supOpts) supOpts='<option value="">-</option>'+_masters.suppliers.map(s=>`<option value="${esc(s.supplier_name)}" ${r.supplier_name===s.supplier_name?'selected':''}>${esc(s.supplier_name)}</option>`).join('');
  const tr=document.createElement('tr');
  tr.dataset.idx=idx;
  tr.innerHTML=`
    <td class="slot-cell">${idx+1}</td>
    <td><input type="text" data-r="${idx}" data-f="product_name" value="${esc(r.product_name||'')}" placeholder="品名" list="mat-names" style="min-width:140px"></td>
    <td><input type="text" data-r="${idx}" data-f="product_no" value="${esc(r.product_no||'')}" placeholder="品番" style="min-width:100px"></td>
    <td><input type="text" data-r="${idx}" data-f="spec" value="${esc(r.spec||'')}" placeholder="規格"></td>
    <td><select data-r="${idx}" data-f="category" style="font-size:11px;width:100%">
      ${CATEGORIES.map(c=>`<option value="${c}" ${r.category===c?'selected':''}>${c}</option>`).join('')}
    </select></td>
    <td><input type="text" data-r="${idx}" data-f="usage_location" value="${esc(r.usage_location||'')}" placeholder="使用箇所"></td>
    <td><input type="number" step="0.01" data-r="${idx}" data-f="usage_quantity" value="${esc(r.usage_quantity||'')}" placeholder="0" oninput="calcRowPrice(${idx})" style="width:55px;text-align:right"></td>
    <td><select data-r="${idx}" data-f="unit" style="font-size:11px;width:48px">
      ${UNITS.map(u=>`<option value="${u}" ${r.unit===u?'selected':''}>${u}</option>`).join('')}
    </select></td>
    ${[1,2,3,4,5,6,7].map(n=>colCell(r,idx,n)).join('')}
    <td><input type="number" step="0.1" data-r="${idx}" data-f="loss_rate" value="${esc(r.loss_rate||'')}" placeholder="0" style="width:50px;text-align:right"></td>
    <td><input type="number" step="1" data-r="${idx}" data-f="unit_price" value="${esc(r.unit_price||'')}" placeholder="0" oninput="calcRowPrice(${idx})" style="width:65px;text-align:right"></td>
    <td id="rp-${idx}" style="text-align:right;font-weight:600;font-size:12px;color:var(--c-primary);padding-right:6px">${r.unit_price&&r.usage_quantity?Math.round(r.unit_price*r.usage_quantity).toLocaleString()+'円':'-'}</td>
    <td><select data-r="${idx}" data-f="supplier_name" style="font-size:11px;width:100%">
      <option value="">-</option>${_masters.suppliers.map(s=>`<option value="${esc(s.supplier_name)}" ${r.supplier_name===s.supplier_name?'selected':''}>${esc(s.supplier_name)}</option>`).join('')}
    </select></td>
    <td><input type="text" data-r="${idx}" data-f="memo" value="${esc(r.memo||'')}" placeholder="メモ" style="min-width:90px"></td>
    <td><button class="del-btn" onclick="delMatRow(${idx})" title="削除">✕</button></td>`;
  tbody.appendChild(tr);
}

function addMatRow() {
  const idx=_materialRows.length;
  _materialRows.push({material_slot:String(idx+1).padStart(2,'0')});
  appendMatRow(document.getElementById('mat-tbody'),_materialRows[idx],idx);
}
function delMatRow(idx) { _materialRows.splice(idx,1); renderMaterialsTab(); }

function getMF(idx,f) {
  const el=document.querySelector(`[data-r="${idx}"][data-f="${f}"]`); return el?el.value:'';
}
function calcRowPrice(idx) {
  const qty=parseFloat(getMF(idx,'usage_quantity'))||0;
  const prc=parseFloat(getMF(idx,'unit_price'))||0;
  const el=document.getElementById('rp-'+idx);
  if(el) el.textContent=qty&&prc?Math.round(qty*prc).toLocaleString()+'円':'-';
  calcMatTotal();
}
function calcMatTotal() {
  let t=0;
  _materialRows.forEach((_,i)=>{t+=(parseFloat(getMF(i,'usage_quantity'))||0)*(parseFloat(getMF(i,'unit_price'))||0);});
  const el=document.getElementById('mat-total'); if(el) el.textContent=Math.round(t).toLocaleString()+'円';
}

async function saveMaterialsData() {
  const FIELDS=['product_name','product_no','spec','category','usage_location','usage_quantity','unit',
    'loss_rate','unit_price','supplier_name','memo',
    'color1_code','color1_name','color2_code','color2_name','color3_code','color3_name',
    'color4_code','color4_name','color5_code','color5_name','color6_code','color6_name','color7_code','color7_name'];
  const rows=_materialRows.map((_,idx)=>{
    const o={material_slot:String(idx+1).padStart(2,'0')};
    FIELDS.forEach(f=>{o[f]=getMF(idx,f);});
    return o;
  }).filter(r=>r.product_name||r.product_no);
  const res=await api('product_materials.save',{style_code:_currentProduct.style_code,rows});
  if(!res||!res.ok){toast(res?.error||'保存に失敗しました','error');return;}
  toast('資材シートを保存しました','success');
}

// ===== マスタ管理 =====
let _masterTab='supplier';
function renderMastersPage(main) {
  main.innerHTML=`<div class="page-header"><h1>マスタ管理</h1></div>
    <div style="display:flex;gap:4px;border-bottom:1px solid var(--c-border);margin-bottom:20px">
      <button class="fs-tab ${_masterTab==='supplier'?'active':''}" onclick="switchMasterTab('supplier')">🏭 仕入先</button>
      <button class="fs-tab ${_masterTab==='factory'?'active':''}"  onclick="switchMasterTab('factory')">🏗️ 加工場</button>
      <button class="fs-tab ${_masterTab==='material'?'active':''}" onclick="switchMasterTab('material')">🧵 資材</button>
      <button class="fs-tab ${_masterTab==='color'?'active':''}"    onclick="switchMasterTab('color')">🎨 カラー</button>
      <button class="fs-tab ${_masterTab==='size'?'active':''}"     onclick="switchMasterTab('size')">📐 サイズ</button>
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
  if(tab==='supplier') renderSupplierPage(c);
  if(tab==='factory')  renderFactoryPage(c);
  if(tab==='material') renderMaterialPage(c);
  if(tab==='color')    renderColorPage(c);
  if(tab==='size')     renderSizePage(c);
}

// ---- 仕入先 ----
function renderSupplierPage(c) {
  c.innerHTML=`<div class="card">
    <div style="display:flex;gap:8px;margin-bottom:16px;align-items:center;flex-wrap:wrap">
      <h3 style="font-size:15px;font-weight:700;flex:1">仕入先マスタ</h3>
      <button class="btn btn-primary btn-sm" onclick="openSupplierForm()">＋ 新規登録</button>
      <label class="btn btn-secondary btn-sm" style="cursor:pointer">📥 CSVインポート<input type="file" accept=".csv" style="display:none" onchange="importSupplierCSV(event)"></label>
      <button class="btn btn-secondary btn-sm" onclick="exportCSV(_masters.suppliers,['supplier_id','supplier_name','category','contact_name','tel','fax','email','address','payment_terms','memo'],'仕入先マスタ')">📤 エクスポート</button>
    </div>
    <table class="master-table"><thead><tr><th>仕入先名</th><th>カテゴリ</th><th>担当者</th><th>TEL</th><th>メール</th><th style="width:80px">操作</th></tr></thead>
    <tbody>${_masters.suppliers.length===0?'<tr><td colspan="6" style="text-align:center;color:var(--c-text3);padding:30px">登録なし</td></tr>':
      _masters.suppliers.map((s,i)=>`<tr><td><strong>${esc(s.supplier_name)}</strong></td><td>${esc(s.category||'')}</td><td>${esc(s.contact_name||'')}</td><td>${esc(s.tel||'')}</td><td>${esc(s.email||'')}</td>
        <td><button class="btn btn-secondary btn-sm" onclick="openSupplierForm(${i})">編集</button></td></tr>`).join('')}
    </tbody></table></div>
    <div id="sup-form"></div>`;
}
function openSupplierForm(idx) {
  const s=idx!==undefined?_masters.suppliers[idx]:null;
  const a=document.getElementById('sup-form'); if(!a) return;
  a.innerHTML=`<div class="card" style="margin-top:16px">
    <h3 style="font-size:15px;font-weight:700;margin-bottom:16px">${s?'仕入先を編集':'新規仕入先登録'}</h3>
    <div class="form-row form-row-2">
      <div class="form-group"><label>仕入先名 ★</label><input type="text" id="sup-name" value="${esc(s?.supplier_name||'')}" placeholder="仕入先名"></div>
      <div class="form-group"><label>カテゴリ</label>
        <select id="sup-cat">${['生地仕入先','副資材仕入先','加工商社','その他'].map(t=>`<option value="${t}" ${s?.category===t?'selected':''}>${t}</option>`).join('')}</select>
      </div>
    </div>
    <div class="form-row form-row-2">
      <div class="form-group"><label>担当者名</label><input type="text" id="sup-contact" value="${esc(s?.contact_name||'')}"></div>
      <div class="form-group"><label>TEL</label><input type="text" id="sup-tel" value="${esc(s?.tel||'')}"></div>
    </div>
    <div class="form-row form-row-2">
      <div class="form-group"><label>メール</label><input type="text" id="sup-email" value="${esc(s?.email||'')}"></div>
      <div class="form-group"><label>FAX</label><input type="text" id="sup-fax" value="${esc(s?.fax||'')}"></div>
    </div>
    <div class="form-group"><label>住所</label><input type="text" id="sup-addr" value="${esc(s?.address||'')}"></div>
    <div class="form-group"><label>支払条件</label><input type="text" id="sup-pay" value="${esc(s?.payment_terms||'')}"></div>
    <div class="form-group"><label>備考</label><textarea id="sup-memo">${esc(s?.memo||'')}</textarea></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
      <button class="btn btn-secondary" onclick="document.getElementById('sup-form').innerHTML=''">キャンセル</button>
      <button class="btn btn-primary" onclick="saveSupplier('${esc(s?.supplier_id||'')}')">保存する</button>
    </div></div>`;
  a.scrollIntoView({behavior:'smooth'});
}
async function saveSupplier(id) {
  const g=el=>document.getElementById(el)?.value||'';
  if(!g('sup-name')){toast('仕入先名を入力してください','error');return;}
  const res=await api('suppliers.upsert',{supplier_id:id||undefined,supplier_name:g('sup-name'),category:g('sup-cat'),contact_name:g('sup-contact'),tel:g('sup-tel'),email:g('sup-email'),fax:g('sup-fax'),address:g('sup-addr'),payment_terms:g('sup-pay'),memo:g('sup-memo')});
  if(!res||!res.ok){toast('保存失敗','error');return;}
  toast('保存しました','success');
  const r=await api('suppliers.list'); if(r) _masters.suppliers=r.items;
  renderSupplierPage(document.getElementById('master-content'));
}
async function importSupplierCSV(e) {
  const f=e.target.files[0]; if(!f) return;
  const rows=(await f.text()).split('\n').map(r=>r.split(',').map(v=>v.replace(/^"|"$/g,'').trim()));
  let n=0;
  for(let i=1;i<rows.length;i++){
    if(!rows[i][0]) continue;
    await api('suppliers.upsert',{supplier_name:rows[i][0]||'',category:rows[i][1]||'',contact_name:rows[i][2]||'',tel:rows[i][3]||'',fax:rows[i][4]||'',email:rows[i][5]||'',address:rows[i][6]||'',payment_terms:rows[i][7]||'',memo:rows[i][8]||''});
    n++;
  }
  toast(n+'件インポートしました','success');
  const r=await api('suppliers.list'); if(r) _masters.suppliers=r.items;
  renderSupplierPage(document.getElementById('master-content'));
}

// ---- 加工場 ----
function renderFactoryPage(c) {
  c.innerHTML=`<div class="card">
    <div style="display:flex;gap:8px;margin-bottom:16px;align-items:center;flex-wrap:wrap">
      <h3 style="font-size:15px;font-weight:700;flex:1">加工場マスタ</h3>
      <button class="btn btn-primary btn-sm" onclick="openFactoryForm()">＋ 新規登録</button>
      <label class="btn btn-secondary btn-sm" style="cursor:pointer">📥 CSVインポート<input type="file" accept=".csv" style="display:none" onchange="importFactoryCSV(event)"></label>
      <button class="btn btn-secondary btn-sm" onclick="exportCSV(_masters.factories,['factory_id','factory_name','process_type','maker_name','supplier_name','contact_name','tel','fax','email','address','min_lot','lead_time_days','memo'],'加工場マスタ')">📤 エクスポート</button>
    </div>
    <table class="master-table"><thead><tr><th>加工場名</th><th>加工種別</th><th>発注先（仕入先）</th><th>担当者</th><th>住所（荷物送付先）</th><th style="width:80px">操作</th></tr></thead>
    <tbody>${_masters.factories.length===0?'<tr><td colspan="6" style="text-align:center;color:var(--c-text3);padding:30px">登録なし</td></tr>':
      _masters.factories.map((f,i)=>`<tr><td><strong>${esc(f.factory_name)}</strong>${f.maker_name?`<br><small style="color:var(--c-text2)">メーカー:${esc(f.maker_name)}</small>`:''}</td>
        <td><span class="badge badge-sampling">${esc(f.process_type||'')}</span></td>
        <td>${esc(f.supplier_name||'（直取引）')}</td>
        <td>${esc(f.contact_name||'')}</td><td style="font-size:12px">${esc(f.address||'')}</td>
        <td><button class="btn btn-secondary btn-sm" onclick="openFactoryForm(${i})">編集</button></td></tr>`).join('')}
    </tbody></table></div>
    <div id="fac-form"></div>`;
}
function openFactoryForm(idx) {
  const f=idx!==undefined?_masters.factories[idx]:null;
  const supOpts='<option value="">（直取引）</option>'+_masters.suppliers.map(s=>`<option value="${esc(s.supplier_id||'')}" data-name="${esc(s.supplier_name)}" ${f?.supplier_id===s.supplier_id?'selected':''}>${esc(s.supplier_name)}</option>`).join('');
  const a=document.getElementById('fac-form'); if(!a) return;
  a.innerHTML=`<div class="card" style="margin-top:16px">
    <h3 style="font-size:15px;font-weight:700;margin-bottom:16px">${f?'加工場を編集':'新規加工場登録'}</h3>
    <div class="form-row form-row-3">
      <div class="form-group"><label>加工場名 ★</label><input type="text" id="fac-name" value="${esc(f?.factory_name||'')}"></div>
      <div class="form-group"><label>加工種別 ★</label>
        <select id="fac-type">${PROCESS_TYPES.map(t=>`<option value="${t}" ${f?.process_type===t?'selected':''}>${t}</option>`).join('')}</select>
      </div>
      <div class="form-group"><label>メーカー名（仕入先と異なる場合）</label><input type="text" id="fac-maker" value="${esc(f?.maker_name||'')}"></div>
    </div>
    <div class="form-row form-row-2">
      <div class="form-group"><label>発注先（仕入先）<small style="color:var(--c-text3)"> ※空白=直接取引</small></label>
        <select id="fac-sup" onchange="onFacSupSel(this)">${supOpts}</select>
        <input type="hidden" id="fac-sup-id" value="${esc(f?.supplier_id||'')}">
        <input type="hidden" id="fac-sup-name" value="${esc(f?.supplier_name||'')}">
      </div>
      <div class="form-group"><label>担当者名</label><input type="text" id="fac-contact" value="${esc(f?.contact_name||'')}"></div>
    </div>
    <div class="form-row form-row-2">
      <div class="form-group"><label>TEL</label><input type="text" id="fac-tel" value="${esc(f?.tel||'')}"></div>
      <div class="form-group"><label>FAX</label><input type="text" id="fac-fax" value="${esc(f?.fax||'')}"></div>
    </div>
    <div class="form-group"><label>メール<small style="color:var(--c-text3)">（発注書送付先）</small></label><input type="text" id="fac-email" value="${esc(f?.email||'')}"></div>
    <div class="form-group"><label>住所<small style="color:var(--c-text3)">（荷物の送り先）</small></label><input type="text" id="fac-addr" value="${esc(f?.address||'')}"></div>
    <div class="form-row form-row-2">
      <div class="form-group"><label>最小ロット（着）</label><input type="number" id="fac-minlot" value="${esc(f?.min_lot||'')}"></div>
      <div class="form-group"><label>リードタイム（日）</label><input type="number" id="fac-lead" value="${esc(f?.lead_time_days||'')}"></div>
    </div>
    <div class="form-group"><label>備考（得意加工・設備など）</label><textarea id="fac-memo">${esc(f?.memo||'')}</textarea></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
      <button class="btn btn-secondary" onclick="document.getElementById('fac-form').innerHTML=''">キャンセル</button>
      <button class="btn btn-primary" onclick="saveFactory('${esc(f?.factory_id||'')}')">保存する</button>
    </div></div>`;
  a.scrollIntoView({behavior:'smooth'});
}
function onFacSupSel(sel) {
  const opt=sel.options[sel.selectedIndex];
  document.getElementById('fac-sup-id').value=opt.value;
  document.getElementById('fac-sup-name').value=opt.dataset.name||'';
}
async function saveFactory(id) {
  const g=el=>document.getElementById(el)?.value||'';
  if(!g('fac-name')){toast('加工場名を入力してください','error');return;}
  const res=await api('factories.upsert',{factory_id:id||undefined,factory_name:g('fac-name'),process_type:g('fac-type'),maker_name:g('fac-maker'),supplier_id:g('fac-sup-id'),supplier_name:g('fac-sup-name'),contact_name:g('fac-contact'),tel:g('fac-tel'),fax:g('fac-fax'),email:g('fac-email'),address:g('fac-addr'),min_lot:g('fac-minlot'),lead_time_days:g('fac-lead'),memo:g('fac-memo')});
  if(!res||!res.ok){toast('保存失敗','error');return;}
  toast('保存しました','success');
  const r=await api('factories.list'); if(r) _masters.factories=r.items;
  renderFactoryPage(document.getElementById('master-content'));
}
async function importFactoryCSV(e) {
  const f=e.target.files[0]; if(!f) return;
  const rows=(await f.text()).split('\n').map(r=>r.split(',').map(v=>v.replace(/^"|"$/g,'').trim()));
  let n=0;
  for(let i=1;i<rows.length;i++){
    if(!rows[i][0]) continue;
    await api('factories.upsert',{factory_name:rows[i][0]||'',process_type:rows[i][1]||'',maker_name:rows[i][2]||'',supplier_name:rows[i][3]||'',contact_name:rows[i][4]||'',tel:rows[i][5]||'',fax:rows[i][6]||'',email:rows[i][7]||'',address:rows[i][8]||'',min_lot:rows[i][9]||'',lead_time_days:rows[i][10]||'',memo:rows[i][11]||''});
    n++;
  }
  toast(n+'件インポートしました','success');
  const r=await api('factories.list'); if(r) _masters.factories=r.items;
  renderFactoryPage(document.getElementById('master-content'));
}

// ---- 資材 ----
function renderMaterialPage(c) {
  c.innerHTML=`<div class="card">
    <div style="display:flex;gap:8px;margin-bottom:16px;align-items:center;flex-wrap:wrap">
      <h3 style="font-size:15px;font-weight:700;flex:1">資材マスタ</h3>
      <input type="text" id="mat-s" placeholder="品名・品番で検索..." style="max-width:220px" oninput="filterMat()">
      <button class="btn btn-primary btn-sm" onclick="openMaterialForm()">＋ 新規登録</button>
    </div>
    <table class="master-table" id="mat-master-table">
      <thead><tr><th>ID</th><th>分類</th><th>品番</th><th>品名</th><th>規格</th><th>単位</th><th>単価</th><th>仕入先</th><th style="width:80px">操作</th></tr></thead>
      <tbody>${matRows(_masters.materials)}</tbody>
    </table></div>
    <div id="mat-form"></div>`;
}
function matRows(items) {
  if(!items||!items.length) return '<tr><td colspan="9" style="text-align:center;color:var(--c-text3);padding:30px">登録なし</td></tr>';
  return items.map((m,i)=>`<tr><td><code style="font-size:11px">${esc(m.material_id)}</code></td><td>${esc(m.category||'')}</td><td>${esc(m.product_no||'')}</td><td>${esc(m.product_name||'')}</td><td>${esc(m.spec||'')}</td><td>${esc(m.unit||'')}</td><td>${m.unit_price?Number(m.unit_price).toLocaleString()+'円':''}</td><td>${esc(m.supplier_name||'')}</td><td><button class="btn btn-secondary btn-sm" onclick="openMaterialForm(${i})">編集</button></td></tr>`).join('');
}
function filterMat() {
  const q=document.getElementById('mat-s')?.value||'';
  const items=q?_masters.materials.filter(m=>(m.product_name||'').includes(q)||(m.product_no||'').includes(q)):_masters.materials;
  const tbody=document.querySelector('#mat-master-table tbody'); if(tbody) tbody.innerHTML=matRows(items);
}
function openMaterialForm(idx) {
  const m=idx!==undefined?_masters.materials[idx]:null;
  const supOpts='<option value="">-</option>'+_masters.suppliers.map(s=>`<option value="${esc(s.supplier_name)}" ${m?.supplier_name===s.supplier_name?'selected':''}>${esc(s.supplier_name)}</option>`).join('');
  const a=document.getElementById('mat-form'); if(!a) return;
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
      <div class="form-group"><label>仕入先 ★</label><select id="mc-sup">${supOpts}</select></div>
      <div class="form-group"><label>メーカー名</label><input type="text" id="mc-maker" value="${esc(m?.maker_name||'')}"></div>
      <div class="form-group"><label>単価（円）</label><input type="number" id="mc-price" value="${esc(m?.unit_price||'')}"></div>
    </div>
    <div class="form-group"><label>備考</label><textarea id="mc-memo">${esc(m?.memo||'')}</textarea></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
      <button class="btn btn-secondary" onclick="document.getElementById('mat-form').innerHTML=''">キャンセル</button>
      <button class="btn btn-primary" onclick="saveMaterial('${esc(m?.material_id||'')}')">保存する</button>
    </div></div>`;
  a.scrollIntoView({behavior:'smooth'});
}
async function saveMaterial(id) {
  const g=el=>document.getElementById(el)?.value||'';
  if(!g('mc-name')){toast('品名を入力してください','error');return;}
  const res=await api('materials.upsert',{material_id:id||undefined,category:g('mc-cat'),product_no:g('mc-no'),product_name:g('mc-name'),spec:g('mc-spec'),quality:g('mc-quality'),unit:g('mc-unit'),supplier_name:g('mc-sup'),maker_name:g('mc-maker'),unit_price:parseFloat(g('mc-price'))||0,memo:g('mc-memo')});
  if(!res||!res.ok){toast('保存失敗','error');return;}
  toast('保存しました','success');
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
