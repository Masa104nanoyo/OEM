// ============================================================
//  app.js  —  Raises Lab OMS Phase 1 v3.4
//  修正内容:
//  - 加工場マスタ追加（仕入先との発注先/納品先分離）
//  - カラーマスタ100色初期登録
//  - サイズ展開をチェックボックス小窓で選択
//  - 製品カラーをカラーマスタから選択に変更
//  - 縫製工場を加工場マスタから選択に変更
// ============================================================

const GAS_URL = 'https://script.google.com/macros/s/AKfycbwKxypPrqzxHtac7V4vGtvdYi11Vd8PfhJTS3PqMztyQbuIIzGWQzgsb_iLyt55NxDh/exec';

// ===== 状態 =====
let _token   = localStorage.getItem('rl_token') || null;
let _user    = JSON.parse(localStorage.getItem('rl_user') || 'null');
let _masters = { colors: [], sizes: [], suppliers: [], materials: [], factories: [] };
let _currentProduct = null;
let _currentFsTab   = 'product';
let _productPage    = 1;
let _materialRows   = [];
let _productImages  = ['','','','','',''];
let _productColors  = Array(7).fill(null).map(()=>({code:'',name:''})); // 製品カラー Col.1〜7

const STATUS_LABELS = {
  draft:'下書き', sampling:'サンプル中', bulk_order:'資材発注',
  in_production:'生産中', completed:'完成', cancelled:'中止',
};
const SEASONS = ['26AW','26SS','26HO','25AW','25SS','27AW','27SS'];
const ITEMS = [
  {code:'JK',name:'ジャケット'},{code:'PT',name:'パンツ'},{code:'OP',name:'ワンピース'},
  {code:'SK',name:'スカート'}, {code:'TS',name:'Tシャツ'},{code:'SH',name:'シャツ'},
  {code:'CT',name:'コート'},   {code:'KN',name:'ニット'}, {code:'BL',name:'ブルゾン'},
  {code:'CB',name:'カーディガン'},{code:'SW',name:'スウェット'},{code:'OT',name:'その他'},
];
const CATEGORIES = ['生地','裏地','芯地','副資材','下げ札等','その他'];
const UNITS = ['m','個','枚','本','組','式','yd','kg','g'];

// ===== API（GETパラメータ方式） =====
async function api(action, body = {}) {
  showLoading(true);
  try {
    const payload = JSON.stringify({ action, token: _token, ...body });
    const url     = GAS_URL + '?payload=' + encodeURIComponent(payload);
    const res     = await fetch(url, { method: 'GET' });
    const text    = await res.text();
    const data    = JSON.parse(text);
    if (!data.ok && data.error === 'UNAUTHORIZED') { forceLogout(); return null; }
    return data;
  } catch (e) {
    console.error('API Error:', e);
    toast('通信エラーが発生しました', 'error');
    return null;
  } finally {
    showLoading(false);
  }
}

// ===== UI Helpers =====
function showLoading(v) { document.getElementById('loading').classList.toggle('show', v); }
function toast(msg, type = 'default') {
  const el = document.createElement('div');
  el.className = 'toast ' + type; el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
function statusBadge(s) {
  return '<span class="badge badge-' + s + '">' + (STATUS_LABELS[s] || s) + '</span>';
}
function nokiCounter(d) {
  if (!d) return '';
  const days = Math.round((new Date(d) - new Date()) / 86400000);
  const cls  = days > 30 ? 'noki-green' : days >= 0 ? 'noki-yellow' : 'noki-red';
  return '<span class="noki-counter ' + cls + '">納期 ' + days + '日</span>';
}
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ===== ページ切替 =====
function showPage(name) {
  document.querySelectorAll('#topbar nav button').forEach(b => b.classList.remove('active'));
  const nb = document.getElementById('nav-' + name);
  if (nb) nb.classList.add('active');
  const main = document.getElementById('main');
  if (name === 'products') renderProductsPage(main);
  if (name === 'masters')  renderMastersPage(main);
}

// ===== Auth =====
async function doLogin() {
  const username = document.getElementById('l-user').value.trim();
  const password = document.getElementById('l-pass').value;
  if (!username || !password) return;
  const errEl = document.getElementById('l-error');
  errEl.style.display = 'none';
  showLoading(true);
  try {
    const payload = JSON.stringify({ action:'login', username, password });
    const url     = GAS_URL + '?payload=' + encodeURIComponent(payload);
    const res     = await fetch(url, { method:'GET' });
    const data    = await res.json();
    if (data.ok) {
      _token = data.token; _user = data.user;
      localStorage.setItem('rl_token', _token);
      localStorage.setItem('rl_user', JSON.stringify(_user));
      bootApp();
    } else {
      errEl.textContent = data.error || 'ログインに失敗しました';
      errEl.style.display = 'block';
    }
  } catch (e) {
    errEl.textContent = '通信エラー: ' + e.message;
    errEl.style.display = 'block';
  } finally { showLoading(false); }
}
async function doLogout() { await api('logout'); forceLogout(); }
function forceLogout() {
  _token = null; _user = null;
  localStorage.removeItem('rl_token'); localStorage.removeItem('rl_user');
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').classList.add('show');
}

// ===== Boot =====
async function bootApp() {
  document.getElementById('login-screen').classList.remove('show');
  document.getElementById('app').style.display = 'flex';
  document.getElementById('user-disp').textContent = _user?.display_name || _user?.username || '';
  const [c, s, sup, mat, fac] = await Promise.all([
    api('colors.list'), api('sizes.list'), api('suppliers.list'), api('materials.list'), api('factories.list'),
  ]);
  if (c)   _masters.colors    = c.items || [];
  if (s)   _masters.sizes     = s.items || [];
  if (sup) _masters.suppliers = sup.items || [];
  if (mat) _masters.materials = mat.items || [];
  if (fac) _masters.factories = fac.items || [];
  showPage('products');
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
        ${Object.entries(STATUS_LABELS).map(([v,l]) => '<option value="'+v+'">'+l+'</option>').join('')}
      </select>
      <select id="s-season" onchange="loadProducts()">
        <option value="">全シーズン</option>
        ${SEASONS.map(s => '<option value="'+s+'">'+s+'</option>').join('')}
      </select>
      <button class="btn btn-secondary btn-sm" onclick="clearSearch()">クリア</button>
    </div>
    <div id="product-grid-area"></div>
    <div id="pagination-area"></div>`;
  _productPage = 1; loadProducts();
}
function triggerSearch() {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => { _productPage = 1; loadProducts(); }, 350);
}
function clearSearch() {
  ['s-q','s-status','s-season'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
  _productPage = 1; loadProducts();
}
async function loadProducts() {
  const search = document.getElementById('s-q')?.value || '';
  const status = document.getElementById('s-status')?.value || '';
  const season = document.getElementById('s-season')?.value || '';
  const res = await api('products.list', { search, status, season, page: _productPage, per: 24 });
  if (!res) return;
  const area = document.getElementById('product-grid-area');
  if (!area) return;
  if (!res.items || res.items.length === 0) {
    area.innerHTML = '<div class="empty-state"><div class="icon">📦</div><p>品番が登録されていません</p><button class="btn btn-primary" style="margin-top:16px" onclick="openNewProductForm()">＋ 新規品番を登録</button></div>';
    document.getElementById('pagination-area').innerHTML = '';
    return;
  }
  area.innerHTML = '<div class="product-grid">' + res.items.map(productCard).join('') + '</div>';
  renderPagination(res.total, _productPage, 24);
}
function productCard(p) {
  const img = p.image_url_1 ? '<img src="'+esc(p.image_url_1)+'" alt="" loading="lazy">' : '<div class="no-img">🧥</div>';
  return '<div class="product-card" onclick="openProduct(\''+esc(p.style_code)+'\')">' +
    '<div class="thumb">'+img+'</div>' +
    '<div class="body">' +
      '<div class="style-code">'+esc(p.style_code)+'</div>' +
      '<div class="brand-no">'+(esc(p.brand_product_no)||'（品番未設定）')+'</div>' +
      '<div class="name">'+esc(p.product_name||'')+(p.brand?' / '+esc(p.brand):'')+'</div>' +
      '<div class="meta">'+statusBadge(p.status)+'<span style="font-size:11px;color:var(--c-text2)">'+esc(p.year||'')+esc(p.season||'')+'</span>'+nokiCounter(p.delivery_date)+'</div>' +
    '</div></div>';
}
function renderPagination(total, page, per) {
  const pages = Math.ceil(total/per);
  const area  = document.getElementById('pagination-area');
  if (!area||pages<=1) { if(area) area.innerHTML=''; return; }
  let html = '<div class="pagination">';
  html += '<button onclick="goPage('+(page-1)+')" '+(page<=1?'disabled':'')+'>‹</button>';
  for (let i=1; i<=pages; i++) {
    if (pages>7&&Math.abs(i-page)>2&&i!==1&&i!==pages) { if(i===2||i===pages-1) html+='<button disabled>…</button>'; continue; }
    html += '<button class="'+(i===page?'active':'')+'" onclick="goPage('+i+')">'+i+'</button>';
  }
  html += '<button onclick="goPage('+(page+1)+')" '+(page>=pages?'disabled':'')+'>›</button></div>';
  html += '<div style="text-align:center;font-size:12px;color:var(--c-text3);margin-top:6px">'+total+'件</div>';
  area.innerHTML = html;
}
function goPage(p) { _productPage = p; loadProducts(); }

// ===== 全画面モーダル =====
function openFull(title) {
  document.getElementById('fs-title').textContent = title;
  document.getElementById('fullscreen-modal').classList.add('show');
  document.body.style.overflow = 'hidden';
}
function closeFull() {
  document.getElementById('fullscreen-modal').classList.remove('show');
  document.body.style.overflow = '';
  _currentProduct = null;
  loadProducts();
}

// ===== 新規品番 =====
function openNewProductForm() {
  _currentProduct = null;
  _productImages  = ['','','','','',''];
  _productColors  = Array(7).fill(null).map(()=>({code:'',name:''}));
  document.getElementById('fs-badge').innerHTML   = '';
  document.getElementById('fs-tabs').innerHTML    = '';
  document.getElementById('fs-actions').innerHTML = '';
  document.getElementById('fs-footer').innerHTML  =
    '<button class="btn btn-secondary" onclick="closeFull()">キャンセル</button>' +
    '<button class="btn btn-primary" onclick="saveNewProduct()">登録する</button>';
  document.getElementById('fs-body').innerHTML = renderProductForm(null);
  setupImagePaste();
  openFull('新規品番の登録');
}

// ===== 品番詳細 =====
async function openProduct(style_code) {
  const res = await api('products.get', { style_code });
  if (!res||!res.ok) { toast('取得に失敗しました','error'); return; }
  _currentProduct = res.item;
  _productImages  = [
    res.item.image_url_1||'', res.item.image_url_2||'',
    res.item.image_url_3||'', res.item.image_url_4||'',
    res.item.image_url_5||'', res.item.image_url_6||'',
  ];
  // 製品カラー読み込み
  _productColors = Array(7).fill(null).map((_,i) => ({
    code: res.item['product_color'+(i+1)+'_code'] || '',
    name: res.item['product_color'+(i+1)+'_name'] || '',
  }));
  _currentFsTab = 'product';
  document.getElementById('fs-badge').innerHTML = statusBadge(res.item.status);
  document.getElementById('fs-tabs').innerHTML =
    '<button class="fs-tab active" id="fstab-product"   onclick="switchFsTab(\'product\')">📋 製品シート</button>' +
    '<button class="fs-tab"        id="fstab-materials" onclick="switchFsTab(\'materials\')">🧵 資材シート</button>';
  document.getElementById('fs-footer').innerHTML =
    '<button class="btn btn-secondary" onclick="closeFull()">閉じる</button>' +
    '<button class="btn btn-primary"   onclick="saveFsTab()">保存する</button>';
  document.getElementById('fs-body').innerHTML = renderProductForm(_currentProduct);
  setupImagePaste();
  openFull(res.item.brand_product_no || res.item.style_code);
}

function switchFsTab(tab) {
  _currentFsTab = tab;
  document.querySelectorAll('.fs-tab').forEach(t => t.classList.remove('active'));
  const btn = document.getElementById('fstab-' + tab);
  if (btn) btn.classList.add('active');
  if (tab === 'product')   { document.getElementById('fs-body').innerHTML = renderProductForm(_currentProduct); setupImagePaste(); }
  if (tab === 'materials') renderMaterialsTab();
}
async function saveFsTab() {
  if (_currentFsTab === 'product')   await saveProductData();
  if (_currentFsTab === 'materials') await saveMaterialsData();
}

// ===== 製品フォーム =====
function renderProductForm(p) {
  const imgSlots = _productImages.map((url, i) =>
    '<div class="image-slot" id="imgslot-'+i+'" onclick="triggerImgUpload('+i+')" ondragover="event.preventDefault()" ondrop="handleImgDrop(event,'+i+')">' +
    (url ? '<img id="imgprev-'+i+'" src="'+esc(url)+'" alt="">' : '<div class="img-placeholder">📷</div><div class="img-label">写真 '+(i+1)+'</div>') +
    '<div class="img-overlay"><button class="btn btn-sm" style="background:#fff;color:#333;font-size:11px" onclick="event.stopPropagation();clearImg('+i+')">削除</button></div>' +
    '<input type="file" id="imgfile-'+i+'" accept="image/*" style="display:none" onchange="handleImgFile(event,'+i+')">' +
    '</div>'
  ).join('');

  // 取引先マスタ選択肢
  const clientOpts = '<option value="">-- 選択 --</option>' +
    _masters.suppliers.map(s =>
      '<option value="'+esc(s.supplier_id||'')+'" '+(p?.client_id===s.supplier_id?'selected':'')+'>'+esc(s.supplier_name)+'</option>'
    ).join('');

  // 加工場選択肢
  const factoryOpts = '<option value="">-- 選択 --</option>' +
    _masters.factories.map(f =>
      '<option value="'+esc(f.factory_name||'')+'" '+(p?.factory_name===f.factory_name?'selected':'')+'>'+
      esc(f.factory_name)+(f.process_type?' ('+esc(f.process_type)+')':'')+'</option>'
    ).join('');

  // 製品カラー（カラーマスタから選択）
  const colorSelOpts = '<option value="">-- 選択 --</option>' +
    _masters.colors.map(c =>
      '<option value="'+esc(c.color_code)+'" data-name="'+esc(c.color_name_ja)+'">'+
      esc(c.color_code)+' '+esc(c.color_name_ja)+'</option>'
    ).join('');
  const colorSelRows = _productColors.map((c, i) => {
    const opts = colorSelOpts.replace('value="'+esc(c.code)+'"','value="'+esc(c.code)+'" selected');
    return '<div style="display:grid;grid-template-columns:24px 1fr;gap:5px;align-items:center;margin-bottom:5px">' +
      '<div style="font-size:11px;font-weight:600;color:var(--c-text2);text-align:center">'+(i+1)+'</div>' +
      '<select id="pc-sel-'+i+'" onchange="onColorSel('+i+',this)" style="font-size:12px;padding:5px 8px">'+opts+'</select>' +
      '</div>';
  }).join('');

  return '<div style="display:grid;grid-template-columns:1fr 300px;gap:20px;align-items:start">' +
  '<div>' +
  '<div class="section-card"><h3>\u{1F4E6} \u57FA\u672C\u60C5\u5831</h3>' +
  '<div class="form-row form-row-2"><div class="form-group"><label>\u304A\u5BA2\u69D8\u54C1\u756A \u2605</label><input type="text" id="f-brand-no" value="'+esc(p?.brand_product_no||'')+'" placeholder="\u4F8B: K1709LJ046EK"></div>' +
  '<div class="form-group"><label>\u4EEE\u54C1\u756A</label><input type="text" id="f-temp-no" value="'+esc(p?.temp_product_no||'')+'" placeholder="\u4EEE\u54C1\u756A"></div></div>' +
  '<div class="form-row form-row-2"><div class="form-group"><label>\u54C1\u540D\uFF08\u65E5\u672C\u8A9E\uFF09</label><input type="text" id="f-name-ja" value="'+esc(p?.product_name||'')+'" placeholder="\u54C1\u540D"></div>' +
  '<div class="form-group"><label>\u54C1\u540D\uFF08\u82F1\u8A9E\uFF09</label><input type="text" id="f-name-en" value="'+esc(p?.product_name_en||'')+'" placeholder="Product Name"></div></div>' +
  '<div class="form-row form-row-2"><div class="form-group"><label>\u30D6\u30E9\u30F3\u30C9</label><input type="text" id="f-brand" value="'+esc(p?.brand||'')+'" placeholder="\u30D6\u30E9\u30F3\u30C9\u540D"></div>' +
  '<div class="form-group"><label>\u53D6\u5F15\u5148 \u2605</label><select id="f-client-select" onchange="onClientSelect(this)">'+clientOpts+'</select><input type="hidden" id="f-client-id" value="'+esc(p?.client_id||'')+'"></div></div>' +
  '<div class="form-row form-row-3">' +
  '<div class="form-group"><label>\u30A2\u30A4\u30C6\u30E0</label><select id="f-item-code">'+ITEMS.map(i=>'<option value="'+i.code+'" '+(p?.item_code===i.code?'selected':'')+'>'+i.code+' '+i.name+'</option>').join('')+'</select></div>' +
  '<div class="form-group"><label>\u5E74\u5EA6</label><select id="f-year">'+['2026','2027','2025'].map(y=>'<option value="'+y.slice(-2)+'" '+(p?.year===y.slice(-2)?'selected':'')+'>'+y+'</option>').join('')+'</select></div>' +
  '<div class="form-group"><label>\u30B7\u30FC\u30BA\u30F3</label><select id="f-season">'+[['AW','\u79CB\u51AC'],['SS','\u6625\u590F'],['HO','Holiday'],['RE','Resort'],['NS','\u901A\u5E74']].map(([v,l])=>'<option value="'+v+'" '+(p?.season===v?'selected':'')+'>'+v+' '+l+'</option>').join('')+'</select></div>' +
  '</div>' +
  '<div class="form-group"><label>\u30B5\u30A4\u30BA\u5C55\u958B</label>' +
  '<div style="display:flex;gap:6px;align-items:center">' +
  '<input type="text" id="f-size-range" value="'+esc(p?.size_range||'')+'" placeholder="\u30AF\u30EA\u30C3\u30AF\u3057\u3066\u30B5\u30A4\u30BA\u3092\u9078\u629E..." readonly style="cursor:pointer;flex:1" onclick="openSizePopup()">' +
  '<button class="btn btn-secondary btn-sm" type="button" onclick="openSizePopup()">\u9078\u629E \u{1F4D0}</button>' +
  '</div></div>' +
  '<div class="form-group"><label>\u539F\u7523\u56FD</label><input type="text" id="f-country" value="'+esc(p?.country_of_origin||'')+'" placeholder="\u65E5\u672C\u3001\u4E2D\u56FD\u3001\u30D9\u30C8\u30CA\u30E0 \u7B49"></div>' +
  '</div></div>' +
  '<div class="section-card" style="margin-top:16px"><h3>\u{1F3ED} \u751F\u7523\u60C5\u5831</h3>' +
  '<div class="form-row form-row-2"><div class="form-group"><label>\u30D1\u30BF\u30F3\u30CA\u30FC</label><input type="text" id="f-patternmaker" value="'+esc(p?.patternmaker||'')+'" placeholder="\u30D1\u30BF\u30F3\u30CA\u30FC\u540D"></div>' +
  '<div class="form-group"><label>\u30D1\u30BF\u30FC\u30F3No.</label><input type="text" id="f-pattern-no" value="'+esc(p?.pattern_no||'')+'" placeholder="\u30D1\u30BF\u30FC\u30F3No."></div></div>' +
  '<div class="form-row form-row-2"><div class="form-group"><label>\u30B5\u30F3\u30D7\u30EBNo.</label><input type="text" id="f-sample-no" value="'+esc(p?.sample_no||'')+'" placeholder="\u30B5\u30F3\u30D7\u30EBNo."></div>' +
  '<div class="form-group"><label>\u7E2B\u88FD\u5DE5\u5834</label><select id="f-factory">'+factoryOpts+'</select></div></div>' +
  '<div class="form-row form-row-2"><div class="form-group"><label>\u88FD\u54C1\u7D0D\u671F</label><input type="date" id="f-delivery" value="'+esc(p?.delivery_date||'')+'"></div>' +
  '<div class="form-group"><label>\u30B9\u30C6\u30FC\u30BF\u30B9</label><select id="f-status">'+Object.entries(STATUS_LABELS).map(([v,l])=>'<option value="'+v+'" '+(p?.status===v?'selected':'')+'>'+l+'</option>').join('')+'</select></div></div>' +
  '<div class="form-group"><label>\u30B3\u30E1\u30F3\u30C8\u30FB\u5099\u8003</label><textarea id="f-memo">'+esc(p?.memo||'')+'</textarea></div>' +
  '</div></div>' +
  '<div>' +
  '<div class="section-card"><h3>\u{1F4F7} \u5199\u771F</h3>' +
  '<p style="font-size:11px;color:var(--c-text2);margin-bottom:10px">\u30AF\u30EA\u30C3\u30AF\u30FB\u30C9\u30E9\u30C3\u30B0&\u30C9\u30ED\u30C3\u30D7\u30EFCtrl+V\u3067\u8FFD\u52A0\uFF08\u6700\u5927\uFF16\u679A\uFF09</p>' +
  '<div class="image-grid">'+imgSlots+'</div></div>' +
  '<div class="section-card" style="margin-top:14px"><h3>\u{1F3A8} \u88FD\u54C1\u30AB\u30E9\u30FC\uFF08Col.1\uFF5E7\uFF09</h3>' +
  '<p style="font-size:10px;color:var(--c-text3);margin-bottom:8px">\u30AB\u30E9\u30FC\u30DE\u30B9\u30BF\u304B\u3089\u9078\u629E</p>' +
  colorSelRows +
  '</div></div>' +
  '</div>';
}

function onClientSelect(sel) {
  document.getElementById('f-client-id').value = sel.value;
}

function onColorSel(i, sel) {
  const opt = sel.options[sel.selectedIndex];
  _productColors[i] = { code: opt.value, name: opt.dataset.name || '' };
}

function openSizePopup() {
  const current = (document.getElementById('f-size-range')?.value || '').split('/').map(s=>s.trim()).filter(Boolean);
  const overlay = document.createElement('div');
  overlay.id = 'size-popup-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9000;display:flex;align-items:center;justify-content:center';
  const popup = document.createElement('div');
  popup.style.cssText = 'background:var(--c-surface);border-radius:12px;padding:24px;width:360px;max-width:90vw;box-shadow:0 8px 32px rgba(0,0,0,.2)';
  popup.innerHTML =
    '<h3 style="font-size:16px;font-weight:700;margin-bottom:16px">\u{1F4D0} \u30B5\u30A4\u30BA\u5C55\u958B\u3092\u9078\u629E</h3>' +
    '<div id="size-checks" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px">' +
    _masters.sizes.map(s => {
      const checked = current.includes(s.size_name);
      return '<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;padding:6px 8px;border:1px solid var(--c-border);border-radius:6px;'+(checked?'background:var(--c-primary-bg);border-color:var(--c-primary);':'')+'">' +
        '<input type="checkbox" value="'+esc(s.size_name)+'" '+(checked?'checked':'')+' style="width:14px;height:14px"> '+esc(s.size_name)+'</label>';
    }).join('') +
    '</div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end">' +
    '<button class="btn btn-secondary" onclick="closeSizePopup()">\u30AD\u30E3\u30F3\u30BB\u30EB</button>' +
    '<button class="btn btn-primary" onclick="confirmSizePopup()">\u78BA\u5B9A</button>' +
    '</div>';
  overlay.appendChild(popup);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if(e.target===overlay) closeSizePopup(); });
}
function closeSizePopup() { const el = document.getElementById('size-popup-overlay'); if(el) el.remove(); }
function confirmSizePopup() {
  const checks = document.querySelectorAll('#size-checks input[type=checkbox]:checked');
  const sizeOrder = _masters.sizes.map(s => s.size_name);
  const selected = Array.from(checks).map(c => c.value).sort((a,b) => sizeOrder.indexOf(a) - sizeOrder.indexOf(b));
  const field = document.getElementById('f-size-range');
  if (field) field.value = selected.join(' / ');
  closeSizePopup();
}

function collectProductForm() {
  const g = id => document.getElementById(id)?.value || '';
  // 製品カラー収集（カラーマスタ選択から）
  const colorFields = {};
  for (let i = 0; i < 7; i++) {
    const sel = document.getElementById('pc-sel-'+i);
    const code = sel ? sel.value : (_productColors[i]?.code || '');
    const opt  = sel ? sel.options[sel.selectedIndex] : null;
    const name = opt ? (opt.dataset.name || '') : (_productColors[i]?.name || '');
    colorFields['product_color'+(i+1)+'_code'] = code;
    colorFields['product_color'+(i+1)+'_name'] = name;
  }
  return {
    brand_product_no: g('f-brand-no'), temp_product_no: g('f-temp-no'),
    product_name: g('f-name-ja'), product_name_en: g('f-name-en'),
    brand: g('f-brand'), client_id: g('f-client-id'),
    item_code: g('f-item-code'), item_name: (ITEMS.find(i=>i.code===g('f-item-code'))||{}).name||'',
    year: g('f-year'), season: g('f-season'), size_range: g('f-size-range'),
    country_of_origin: g('f-country'), patternmaker: g('f-patternmaker'),
    pattern_no: g('f-pattern-no'), sample_no: g('f-sample-no'),
    factory_name: g('f-factory'), delivery_date: g('f-delivery'),
    status: g('f-status'), memo: g('f-memo'),
    image_url_1: _productImages[0]||'', image_url_2: _productImages[1]||'',
    image_url_3: _productImages[2]||'', image_url_4: _productImages[3]||'',
    image_url_5: _productImages[4]||'', image_url_6: _productImages[5]||'',
    ...colorFields,
  };
}
async function saveNewProduct() {
  const data = collectProductForm();
  if (!data.brand_product_no && !data.product_name) { toast('品番または品名を入力してください','error'); return; }
  // 速度改善：画像はBase64をGASに送らず、登録後に別途保存
  const dataNoImg = { ...data };
  ['image_url_1','image_url_2','image_url_3','image_url_4','image_url_5','image_url_6'].forEach(k => {
    if (dataNoImg[k] && dataNoImg[k].startsWith('data:')) dataNoImg[k] = ''; // Base64は除外
  });
  const res = await api('products.create', dataNoImg);
  if (!res) return;
  if (!res.ok) { toast(res.error||'登録に失敗しました','error'); return; }
  toast('登録しました（'+res.style_code+'）','success');
  // バグ修正：全画面を閉じてから一覧を再取得
  document.getElementById('fullscreen-modal').classList.remove('show');
  document.body.style.overflow = '';
  _currentProduct = null;
  await loadProducts(); // ← 確実に再取得
}
async function saveProductData() {
  const data = collectProductForm();
  const res  = await api('products.update', { style_code: _currentProduct.style_code, ...data });
  if (!res) return;
  if (!res.ok) { toast(res.error||'保存に失敗しました','error'); return; }
  toast('保存しました','success');
  Object.assign(_currentProduct, data);
  document.getElementById('fs-badge').innerHTML = statusBadge(data.status);
  document.getElementById('fs-title').textContent = data.brand_product_no || _currentProduct.style_code;
}

// ===== 画像処理 =====
function triggerImgUpload(i) { document.getElementById('imgfile-'+i).click(); }
function handleImgFile(event, i) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => setImage(i, e.target.result);
  reader.readAsDataURL(file);
}
function handleImgDrop(event, i) {
  event.preventDefault();
  const file = event.dataTransfer.files[0];
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = e => setImage(i, e.target.result);
  reader.readAsDataURL(file);
}
function setImage(i, dataUrl) {
  _productImages[i] = dataUrl;
  const slot = document.getElementById('imgslot-'+i);
  if (!slot) return;
  slot.innerHTML =
    '<img id="imgprev-'+i+'" src="'+dataUrl+'" alt="">' +
    '<div class="img-overlay"><button class="btn btn-sm" style="background:#fff;color:#333;font-size:11px" onclick="event.stopPropagation();clearImg('+i+')">削除</button></div>' +
    '<input type="file" id="imgfile-'+i+'" accept="image/*" style="display:none" onchange="handleImgFile(event,'+i+')">';
}
function clearImg(i) {
  _productImages[i] = '';
  const slot = document.getElementById('imgslot-'+i);
  if (slot) slot.innerHTML =
    '<div class="img-placeholder">📷</div><div class="img-label">写真 '+(i+1)+'</div>' +
    '<div class="img-overlay"></div>' +
    '<input type="file" id="imgfile-'+i+'" accept="image/*" style="display:none" onchange="handleImgFile(event,'+i+')">';
}
let _pasteHandler = null;
function setupImagePaste() {
  if (_pasteHandler) document.removeEventListener('paste', _pasteHandler);
  _pasteHandler = (e) => {
    const items = e.clipboardData?.items; if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const emptyIdx = _productImages.findIndex(u => !u);
        if (emptyIdx < 0) { toast('画像スロットが満杯です（最大6枚）','error'); return; }
        const reader = new FileReader();
        reader.onload = ev => { setImage(emptyIdx, ev.target.result); toast('写真'+(emptyIdx+1)+'に貼り付けました','success'); };
        reader.readAsDataURL(item.getAsFile());
        break;
      }
    }
  };
  document.addEventListener('paste', _pasteHandler);
}

// ===== 資材シート =====
async function renderMaterialsTab() {
  const res = await api('product_materials.get', { style_code: _currentProduct.style_code });
  _materialRows = res?.items || [];
  if (_materialRows.length === 0) {
    for (let i = 0; i < 10; i++) _materialRows.push({ material_slot: String(i+1).padStart(2,'0') });
  }

  const colorOpts = '<option value="">-</option>' + _masters.colors.map(c =>
    '<option value="'+esc(c.color_code)+'">'+esc(c.color_code)+' '+esc(c.color_name_ja)+'</option>'
  ).join('');
  const supOpts = '<option value="">-</option>' + _masters.suppliers.map(s =>
    '<option value="'+esc(s.supplier_name)+'">'+esc(s.supplier_name)+'</option>'
  ).join('');

  document.getElementById('fs-body').innerHTML =
    '<div style="margin-bottom:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
    '<code style="font-family:monospace;background:var(--c-bg);padding:2px 8px;border-radius:4px;font-size:12px">'+esc(_currentProduct.style_code)+'</code>' +
    '<button class="btn btn-secondary btn-sm" onclick="addMatRow()">＋ 行を追加</button>' +
    '<div style="margin-left:auto;font-size:13px">着単価合計: <strong id="mat-total" style="font-size:16px;color:var(--c-primary)">-</strong></div>' +
    '</div>' +
    '<datalist id="mat-namelist">'+_masters.materials.map(m=>'<option value="'+esc(m.product_name)+'">').join('')+'</datalist>' +
    '<div class="material-table-wrap"><table class="material-table"><thead><tr>' +
    '<th style="width:32px">No.</th><th style="min-width:180px">品名</th><th style="min-width:140px">品番</th>' +
    '<th style="min-width:100px">規格</th><th style="width:90px">分類</th><th style="min-width:100px">使用箇所</th>' +
    '<th style="width:65px">要尺</th><th style="width:55px">単位</th>' +
    '<th style="min-width:130px">Col.1<br><span style="font-size:9px;font-weight:400">コード / カラー名</span></th>' +
    '<th style="min-width:130px">Col.2<br><span style="font-size:9px;font-weight:400">コード / カラー名</span></th>' +
    '<th style="min-width:130px">Col.3<br><span style="font-size:9px;font-weight:400">コード / カラー名</span></th>' +
    '<th style="min-width:130px">Col.4<br><span style="font-size:9px;font-weight:400">コード / カラー名</span></th>' +
    '<th style="min-width:130px">Col.5<br><span style="font-size:9px;font-weight:400">コード / カラー名</span></th>' +
    '<th style="min-width:130px">Col.6<br><span style="font-size:9px;font-weight:400">コード / カラー名</span></th>' +
    '<th style="min-width:130px">Col.7<br><span style="font-size:9px;font-weight:400">コード / カラー名</span></th>' +
    '<th style="width:60px">ロス%</th><th style="width:75px">単価(円)</th><th style="width:80px">着単価</th>' +
    '<th style="min-width:130px">仕入先</th><th style="min-width:110px">メモ</th><th style="width:30px"></th>' +
    '</tr></thead><tbody id="mat-tbody"></tbody></table></div>';

  const tbody = document.getElementById('mat-tbody');
  _materialRows.forEach((r, idx) => appendMatRow(tbody, r, idx, colorOpts, supOpts));
  calcMatTotals();
}

function appendMatRow(tbody, r, idx, _unused1, supOpts) {
  if (!supOpts) {
    supOpts = '<option value="">-</option>' + _masters.suppliers.map(s =>
      '<option value="'+esc(s.supplier_name)+'">'+esc(s.supplier_name)+'</option>').join('');
  }

  // Col.1〜7：コード（上段）＋カラー名（下段）の2段自由入力
  const colCell = (n) => {
    const code = esc(r['color'+n+'_code']||'');
    const name = esc(r['color'+n+'_name']||'');
    return '<td style="padding:3px 4px;min-width:120px">' +
      '<input type="text" data-r="'+idx+'" data-f="color'+n+'_code" value="'+code+'" placeholder="コード" style="font-size:11px;border-bottom:none;border-radius:4px 4px 0 0;border-color:var(--c-border)">' +
      '<input type="text" data-r="'+idx+'" data-f="color'+n+'_name" value="'+name+'" placeholder="カラー名" style="font-size:11px;border-radius:0 0 4px 4px;margin-top:-1px;border-color:var(--c-border)">' +
      '</td>';
  };

  const selSup = () => {
    const val = esc(r.supplier_name||'');
    return '<select data-r="'+idx+'" data-f="supplier_name" style="font-size:11px;width:100%">' +
      supOpts.replace('value="'+val+'"', 'value="'+val+'" selected') + '</select>';
  };

  const tr = document.createElement('tr');
  tr.dataset.idx = idx;
  tr.innerHTML =
    '<td class="slot-cell">'+(idx+1)+'</td>' +
    '<td><input type="text" data-r="'+idx+'" data-f="product_name" value="'+esc(r.product_name||'')+'" placeholder="品名" list="mat-namelist" style="min-width:160px"></td>' +
    '<td><input type="text" data-r="'+idx+'" data-f="product_no"   value="'+esc(r.product_no||'')+'"   placeholder="品番" style="min-width:120px"></td>' +
    '<td><input type="text" data-r="'+idx+'" data-f="spec"         value="'+esc(r.spec||'')+'"         placeholder="規格"></td>' +
    '<td><select data-r="'+idx+'" data-f="category" style="font-size:11px;width:100%">'+
      CATEGORIES.map(c=>'<option value="'+c+'" '+(r.category===c?'selected':'')+'>'+c+'</option>').join('')+'</select></td>' +
    '<td><input type="text" data-r="'+idx+'" data-f="usage_location" value="'+esc(r.usage_location||'')+'" placeholder="使用箇所"></td>' +
    '<td><input type="number" step="0.01" data-r="'+idx+'" data-f="usage_quantity" value="'+esc(r.usage_quantity||'')+'" placeholder="0" oninput="calcRowPrice('+idx+')" style="width:60px;text-align:right"></td>' +
    '<td><select data-r="'+idx+'" data-f="unit" style="font-size:11px;width:52px">'+UNITS.map(u=>'<option value="'+u+'" '+(r.unit===u?'selected':'')+'>'+u+'</option>').join('')+'</select></td>' +
    colCell(1)+colCell(2)+colCell(3)+colCell(4)+colCell(5)+colCell(6)+colCell(7) +
    '<td><input type="number" step="0.1" data-r="'+idx+'" data-f="loss_rate"  value="'+esc(r.loss_rate||'')+'"  placeholder="0" style="width:55px;text-align:right"></td>' +
    '<td><input type="number" step="1"   data-r="'+idx+'" data-f="unit_price" value="'+esc(r.unit_price||'')+'" placeholder="0" oninput="calcRowPrice('+idx+')" style="width:68px;text-align:right"></td>' +
    '<td id="rowprice-'+idx+'" style="text-align:right;font-weight:600;font-size:12px;color:var(--c-primary);padding-right:8px">'+(r.unit_price&&r.usage_quantity?Math.round(r.unit_price*r.usage_quantity).toLocaleString()+'円':'-')+'</td>' +
    '<td>'+selSup()+'</td>' +
    '<td><input type="text" data-r="'+idx+'" data-f="memo" value="'+esc(r.memo||'')+'" placeholder="メモ"></td>' +
    '<td><button class="del-btn" onclick="delMatRow('+idx+')" title="削除">✕</button></td>';
  tbody.appendChild(tr);
}

function addMatRow() {
  const idx = _materialRows.length;
  const row = { material_slot: String(idx+1).padStart(2,'0') };
  _materialRows.push(row);
  appendMatRow(document.getElementById('mat-tbody'), row, idx);
}

function delMatRow(idx) {
  _materialRows.splice(idx, 1);
  renderMaterialsTab();
}

function getMatField(idx, field) {
  const el = document.querySelector('[data-r="'+idx+'"][data-f="'+field+'"]');
  return el ? el.value : '';
}

function calcRowPrice(idx) {
  const qty   = parseFloat(getMatField(idx,'usage_quantity')) || 0;
  const price = parseFloat(getMatField(idx,'unit_price'))    || 0;
  const cell  = document.getElementById('rowprice-'+idx);
  if (cell) cell.textContent = qty&&price ? Math.round(qty*price).toLocaleString()+'円' : '-';
  calcMatTotals();
}
function calcMatTotals() {
  let total = 0;
  _materialRows.forEach((_,idx) => {
    total += (parseFloat(getMatField(idx,'usage_quantity'))||0) * (parseFloat(getMatField(idx,'unit_price'))||0);
  });
  const el = document.getElementById('mat-total');
  if (el) el.textContent = Math.round(total).toLocaleString() + '円';
}

async function saveMaterialsData() {
  const fields = ['product_name','product_no','spec','category','usage_location',
                  'usage_quantity','unit','loss_rate','unit_price','supplier_name','memo',
                  'color1_code','color1_name','color2_code','color2_name',
                  'color3_code','color3_name','color4_code','color4_name',
                  'color5_code','color5_name','color6_code','color6_name',
                  'color7_code','color7_name'];
  const rows = _materialRows.map((_,idx) => {
    const obj = { material_slot: String(idx+1).padStart(2,'0') };
    fields.forEach(f => { obj[f] = getMatField(idx,f); });
    return obj;
  }).filter(r => r.product_name || r.product_no);

  const res = await api('product_materials.save', { style_code: _currentProduct.style_code, rows });
  if (!res) return;
  if (!res.ok) { toast(res.error||'保存に失敗しました','error'); return; }
  toast('資材シートを保存しました','success');
}

// ===== マスタ管理 =====
let _masterTab = 'supplier';

function renderMastersPage(main) {
  main.innerHTML =
    '<div class="page-header"><h1>マスタ管理</h1></div>' +
    '<div style="display:flex;gap:4px;border-bottom:1px solid var(--c-border);margin-bottom:20px">' +
    '<button class="fs-tab '+(_masterTab==='supplier'?'active':'')+'" onclick="switchMasterTab(\'supplier\')">🏭 仕入先マスタ</button>' +
    '<button class="fs-tab '+(_masterTab==='factory'?'active':'')+'"  onclick="switchMasterTab(\'factory\')">🏗️ 加工場マスタ</button>' +
    '<button class="fs-tab '+(_masterTab==='material'?'active':'')+'" onclick="switchMasterTab(\'material\')">🧵 資材マスタ</button>' +
    '<button class="fs-tab '+(_masterTab==='color'?'active':'')+'"    onclick="switchMasterTab(\'color\')">🎨 カラーマスタ</button>' +
    '<button class="fs-tab '+(_masterTab==='size'?'active':'')+'"     onclick="switchMasterTab(\'size\')">📐 サイズマスタ</button>' +
    '</div>' +
    '<div id="master-content"></div>';
  switchMasterTab(_masterTab);
}

function switchMasterTab(tab) {
  _masterTab = tab;
  document.querySelectorAll('.fs-tab').forEach(t => t.classList.remove('active'));
  const tabs = document.querySelectorAll('.fs-tab');
  const idx  = ['supplier','material','color','size'].indexOf(tab);
  if (tabs[idx]) tabs[idx].classList.add('active');
  const c = document.getElementById('master-content');
  if (!c) return;
  if (tab === 'supplier') renderSupplierMasterPage(c);
  if (tab === 'factory')  renderFactoryMasterPage(c);
  if (tab === 'material') renderMaterialMasterPage(c);
  if (tab === 'color')    renderColorMasterPage(c);
  if (tab === 'size')     renderSizeMasterPage(c);
}

// ---- 加工場マスタ ----
const PROCESS_TYPES = ['縫製','裁断','プリント','刺繍','染色','整理加工','生地加工','検品','その他'];

function renderFactoryMasterPage(c) {
  c.innerHTML =
    '<div class="card">' +
    '<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center">' +
    '<h3 style="font-size:15px;font-weight:700;flex:1">加工場マスタ</h3>' +
    '<button class="btn btn-primary btn-sm" onclick="openFactoryForm()">＋ 新規登録</button>' +
    '<label class="btn btn-secondary btn-sm" style="cursor:pointer">📥 CSVインポート<input type="file" accept=".csv" style="display:none" onchange="importFactoryCSV(event)"></label>' +
    '<button class="btn btn-secondary btn-sm" onclick="exportFactoryCSV()">📤 CSVエクスポート</button>' +
    '</div>' +
    '<p style="font-size:12px;color:var(--c-text2);margin-bottom:12px">加工場名,加工種別,メーカー名,発注先（仕入先）,担当者,TEL,メール,住所 の形式でCSVインポートできます</p>' +
    '<table class="master-table">' +
    '<thead><tr><th>加工場名</th><th>加工種別</th><th>発注先（仕入先）</th><th>担当者</th><th>TEL</th><th>住所</th><th style="width:80px">操作</th></tr></thead>' +
    '<tbody>' +
    (_masters.factories.length === 0 ?
      '<tr><td colspan="7" style="text-align:center;color:var(--c-text3);padding:30px">加工場が登録されていません</td></tr>' :
      _masters.factories.map((f,i) =>
        '<tr>' +
        '<td><strong>'+esc(f.factory_name)+'</strong>'+(f.maker_name?'<br><span style="font-size:11px;color:var(--c-text2)">メーカー: '+esc(f.maker_name)+'</span>':'')+'</td>' +
        '<td><span class="badge badge-blue">'+esc(f.process_type||'')+'</span></td>' +
        '<td>'+esc(f.supplier_name||'（直取引）')+'</td>' +
        '<td>'+esc(f.contact_name||'')+'</td>' +
        '<td>'+esc(f.tel||'')+'</td>' +
        '<td style="font-size:12px">'+esc(f.address||'')+'</td>' +
        '<td><button class="btn btn-secondary btn-sm" onclick="openFactoryForm('+i+')">編集</button></td>' +
        '</tr>'
      ).join('')
    ) +
    '</tbody></table></div>' +
    '<div id="factory-form-area"></div>';
}

function openFactoryForm(idx) {
  const f = idx !== undefined ? _masters.factories[idx] : null;
  const supOpts = '<option value="">（直取引）</option>' +
    _masters.suppliers.map(s =>
      '<option value="'+esc(s.supplier_id||'')+'" data-name="'+esc(s.supplier_name||'')+'" '+
      (f?.supplier_id===s.supplier_id?'selected':'')+'>'+esc(s.supplier_name)+'</option>'
    ).join('');
  const area = document.getElementById('factory-form-area');
  if (!area) return;
  area.innerHTML =
    '<div class="card" style="margin-top:16px">' +
    '<h3 style="font-size:15px;font-weight:700;margin-bottom:16px">'+(f?'加工場を編集':'新規加工場登録')+'</h3>' +
    '<div class="form-row form-row-3">' +
    '<div class="form-group"><label>加工場名 ★</label><input type="text" id="fac-name" value="'+esc(f?.factory_name||'')+'" placeholder="加工場名"></div>' +
    '<div class="form-group"><label>加工種別 ★</label><select id="fac-type">'+PROCESS_TYPES.map(t=>'<option value="'+t+'" '+(f?.process_type===t?'selected':'')+'>'+t+'</option>').join('')+'</select></div>' +
    '<div class="form-group"><label>メーカー名（仕入先と異なる場合）</label><input type="text" id="fac-maker" value="'+esc(f?.maker_name||'')+'" placeholder="例: YKK"></div>' +
    '</div>' +
    '<div class="form-row form-row-2">' +
    '<div class="form-group"><label>発注先（仕入先）<span style="font-size:10px;color:var(--c-text3)"> ※空白＝直接取引</span></label>' +
    '<select id="fac-sup" onchange="onFactorySupSelect(this)">'+supOpts+'</select>' +
    '<input type="hidden" id="fac-sup-id" value="'+esc(f?.supplier_id||'')+'">' +
    '<input type="hidden" id="fac-sup-name" value="'+esc(f?.supplier_name||'')+'">' +
    '</div>' +
    '<div class="form-group"><label>担当者名</label><input type="text" id="fac-contact" value="'+esc(f?.contact_name||'')+'" placeholder="担当者名"></div>' +
    '</div>' +
    '<div class="form-row form-row-2">' +
    '<div class="form-group"><label>TEL</label><input type="text" id="fac-tel" value="'+esc(f?.tel||'')+'" placeholder="TEL"></div>' +
    '<div class="form-group"><label>FAX</label><input type="text" id="fac-fax" value="'+esc(f?.fax||'')+'" placeholder="FAX"></div>' +
    '</div>' +
    '<div class="form-group"><label>メール <span style="font-size:10px;color:var(--c-text3)">※発注書の送付先</span></label><input type="text" id="fac-email" value="'+esc(f?.email||'')+'" placeholder="メールアドレス"></div>' +
    '<div class="form-group"><label>住所 <span style="font-size:10px;color:var(--c-text3)">※荷物の送り先</span></label><input type="text" id="fac-address" value="'+esc(f?.address||'')+'" placeholder="住所"></div>' +
    '<div class="form-row form-row-2">' +
    '<div class="form-group"><label>最小ロット（着）</label><input type="number" id="fac-minlot" value="'+esc(f?.min_lot||'')+'" placeholder="0"></div>' +
    '<div class="form-group"><label>リードタイム（日）</label><input type="number" id="fac-lead" value="'+esc(f?.lead_time_days||'')+'" placeholder="0"></div>' +
    '</div>' +
    '<div class="form-group"><label>備考（得意加工・設備など）</label><textarea id="fac-memo">'+esc(f?.memo||'')+'</textarea></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">' +
    '<button class="btn btn-secondary" onclick="document.getElementById(\'factory-form-area\').innerHTML=\'\'">キャンセル</button>' +
    '<button class="btn btn-primary" onclick="saveFactory('+(f?'\''+esc(f.factory_id||'')+'\'':'null')+')">保存する</button>' +
    '</div></div>';
  area.scrollIntoView({ behavior:'smooth' });
}

function onFactorySupSelect(sel) {
  const opt = sel.options[sel.selectedIndex];
  document.getElementById('fac-sup-id').value   = opt.value;
  document.getElementById('fac-sup-name').value = opt.dataset.name || '';
}

async function saveFactory(factory_id) {
  const g = id => document.getElementById(id)?.value || '';
  const data = {
    factory_id:    factory_id || undefined,
    factory_name:  g('fac-name'),
    process_type:  g('fac-type'),
    maker_name:    g('fac-maker'),
    supplier_id:   g('fac-sup-id'),
    supplier_name: g('fac-sup-name'),
    contact_name:  g('fac-contact'),
    tel:           g('fac-tel'),
    fax:           g('fac-fax'),
    email:         g('fac-email'),
    address:       g('fac-address'),
    min_lot:       g('fac-minlot'),
    lead_time_days:g('fac-lead'),
    memo:          g('fac-memo'),
  };
  if (!data.factory_name) { toast('加工場名を入力してください','error'); return; }
  const res = await api('factories.upsert', data);
  if (!res||!res.ok) { toast('保存に失敗しました','error'); return; }
  toast('保存しました','success');
  const fac = await api('factories.list');
  if (fac) _masters.factories = fac.items;
  const cont = document.getElementById('master-content');
  if (cont) renderFactoryMasterPage(cont);
}

function exportFactoryCSV() {
  const rows = [['加工場名','加工種別','メーカー名','発注先（仕入先）','担当者','TEL','FAX','メール','住所','最小ロット','リードタイム','備考']];
  _masters.factories.forEach(f => rows.push([
    f.factory_name||'', f.process_type||'', f.maker_name||'', f.supplier_name||'',
    f.contact_name||'', f.tel||'', f.fax||'', f.email||'', f.address||'',
    f.min_lot||'', f.lead_time_days||'', f.memo||''
  ]));
  const csv  = rows.map(r => r.map(v => '"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n');
  const blob = new Blob(['\uFEFF'+csv], { type:'text/csv;charset=utf-8;' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob); a.download = '加工場マスタ.csv'; a.click();
}

async function importFactoryCSV(event) {
  const file = event.target.files[0]; if (!file) return;
  const text = await file.text();
  const rows = text.split('\n').map(r => r.split(',').map(v => v.replace(/^"|"$/g,'').replace(/""/g,'"').trim()));
  let imported = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]; if (!row[0]) continue;
    await api('factories.upsert', {
      factory_name:row[0]||'', process_type:row[1]||'', maker_name:row[2]||'',
      supplier_name:row[3]||'', contact_name:row[4]||'', tel:row[5]||'',
      fax:row[6]||'', email:row[7]||'', address:row[8]||'',
      min_lot:row[9]||'', lead_time_days:row[10]||'', memo:row[11]||'',
    });
    imported++;
  }
  toast(imported+'件インポートしました','success');
  const fac = await api('factories.list');
  if (fac) _masters.factories = fac.items;
  const cont = document.getElementById('master-content');
  if (cont) renderFactoryMasterPage(cont);
}

// ---- 仕入先マスタ ----
function renderSupplierMasterPage(c) {
  c.innerHTML =
    '<div class="card">' +
    '<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center">' +
    '<h3 style="font-size:15px;font-weight:700;flex:1">仕入先マスタ</h3>' +
    '<button class="btn btn-primary btn-sm" onclick="openSupplierForm()">＋ 新規登録</button>' +
    '<label class="btn btn-secondary btn-sm" style="cursor:pointer">📥 CSVインポート<input type="file" accept=".csv" style="display:none" onchange="importSupplierCSV(event)"></label>' +
    '<button class="btn btn-secondary btn-sm" onclick="exportSupplierCSV()">📤 CSVエクスポート</button>' +
    '</div>' +
    '<p style="font-size:12px;color:var(--c-text2);margin-bottom:12px">CSVインポートはMyBridge形式（会社名,担当者,TEL,メール,住所,種別）に対応</p>' +
    '<table class="master-table">' +
    '<thead><tr><th>仕入先名</th><th>種別</th><th>担当者</th><th>TEL</th><th>メール</th><th>住所</th><th style="width:80px">操作</th></tr></thead>' +
    '<tbody>' +
    (_masters.suppliers.length === 0 ?
      '<tr><td colspan="7" style="text-align:center;color:var(--c-text3);padding:30px">仕入先が登録されていません</td></tr>' :
      _masters.suppliers.map((s,i) =>
        '<tr id="sup-row-'+i+'">' +
        '<td><strong>'+esc(s.supplier_name)+'</strong></td>' +
        '<td>'+esc(s.type||'')+'</td>' +
        '<td>'+esc(s.contact_name||'')+'</td>' +
        '<td>'+esc(s.tel||'')+'</td>' +
        '<td>'+esc(s.email||'')+'</td>' +
        '<td style="font-size:12px">'+esc(s.address||'')+'</td>' +
        '<td><button class="btn btn-secondary btn-sm" onclick="openSupplierForm('+i+')">編集</button></td>' +
        '</tr>'
      ).join('')
    ) +
    '</tbody></table></div>' +
    '<div id="supplier-form-area"></div>';
}

function openSupplierForm(idx) {
  const s = idx !== undefined ? _masters.suppliers[idx] : null;
  const area = document.getElementById('supplier-form-area');
  if (!area) return;
  area.innerHTML =
    '<div class="card" style="margin-top:16px">' +
    '<h3 style="font-size:15px;font-weight:700;margin-bottom:16px">'+(s?'仕入先を編集':'新規仕入先登録')+'</h3>' +
    '<div class="form-row form-row-2">' +
    '<div class="form-group"><label>仕入先名 ★</label><input type="text" id="sup-name" value="'+esc(s?.supplier_name||'')+'" placeholder="仕入先名"></div>' +
    '<div class="form-group"><label>種別</label><select id="sup-type"><option value="factory" '+(s?.type==='factory'?'selected':'')+'>工場</option><option value="trading" '+(s?.type==='trading'?'selected':'')+'>商社</option><option value="maker" '+(s?.type==='maker'?'selected':'')+'>メーカー</option></select></div>' +
    '</div>' +
    '<div class="form-row form-row-2">' +
    '<div class="form-group"><label>担当者名</label><input type="text" id="sup-contact" value="'+esc(s?.contact_name||'')+'" placeholder="担当者名"></div>' +
    '<div class="form-group"><label>TEL</label><input type="text" id="sup-tel" value="'+esc(s?.tel||'')+'" placeholder="TEL"></div>' +
    '</div>' +
    '<div class="form-row form-row-2">' +
    '<div class="form-group"><label>メール</label><input type="text" id="sup-email" value="'+esc(s?.email||'')+'" placeholder="メールアドレス"></div>' +
    '<div class="form-group"><label>FAX</label><input type="text" id="sup-fax" value="'+esc(s?.fax||'')+'" placeholder="FAX"></div>' +
    '</div>' +
    '<div class="form-group"><label>住所</label><input type="text" id="sup-address" value="'+esc(s?.address||'')+'" placeholder="住所"></div>' +
    '<div class="form-group"><label>支払条件</label><input type="text" id="sup-payment" value="'+esc(s?.payment_terms||'')+'" placeholder="例: 月末締め翌月末払い"></div>' +
    '<div class="form-group"><label>備考</label><textarea id="sup-memo">'+esc(s?.memo||'')+'</textarea></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">' +
    '<button class="btn btn-secondary" onclick="document.getElementById(\'supplier-form-area\').innerHTML=\'\'">キャンセル</button>' +
    '<button class="btn btn-primary" onclick="saveSupplier('+(s?'\''+esc(s.supplier_id||'')+'\'':'null')+')">保存する</button>' +
    '</div></div>';
  area.scrollIntoView({ behavior:'smooth' });
}

async function saveSupplier(supplier_id) {
  const g = id => document.getElementById(id)?.value || '';
  const data = {
    supplier_id: supplier_id || undefined,
    supplier_name:  g('sup-name'),
    type:           g('sup-type'),
    contact_name:   g('sup-contact'),
    tel:            g('sup-tel'),
    email:          g('sup-email'),
    fax:            g('sup-fax'),
    address:        g('sup-address'),
    payment_terms:  g('sup-payment'),
    memo:           g('sup-memo'),
  };
  if (!data.supplier_name) { toast('仕入先名を入力してください','error'); return; }
  const res = await api('suppliers.upsert', data);
  if (!res||!res.ok) { toast('保存に失敗しました','error'); return; }
  toast('保存しました','success');
  const s = await api('suppliers.list');
  if (s) _masters.suppliers = s.items;
  const c = document.getElementById('master-content');
  if (c) renderSupplierMasterPage(c);
}

function exportSupplierCSV() {
  const rows = [['仕入先名','種別','担当者','TEL','FAX','メール','住所','支払条件','備考']];
  _masters.suppliers.forEach(s => rows.push([
    s.supplier_name||'', s.type||'', s.contact_name||'', s.tel||'', s.fax||'', s.email||'', s.address||'', s.payment_terms||'', s.memo||''
  ]));
  const csv  = rows.map(r => r.map(v => '"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n');
  const blob = new Blob(['\uFEFF'+csv], { type:'text/csv;charset=utf-8;' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = '仕入先マスタ.csv';
  a.click();
}

async function importSupplierCSV(event) {
  const file = event.target.files[0]; if (!file) return;
  const text = await file.text();
  const rows = text.split('\n').map(r => r.split(',').map(v => v.replace(/^"|"$/g,'').replace(/""/g,'"').trim()));
  const header = rows[0];
  let imported = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]) continue;
    await api('suppliers.upsert', {
      supplier_name: row[0]||'', type: row[1]||'factory', contact_name: row[2]||'',
      tel: row[3]||'', fax: row[4]||'', email: row[5]||'',
      address: row[6]||'', payment_terms: row[7]||'', memo: row[8]||'',
    });
    imported++;
  }
  toast(imported+'件インポートしました','success');
  const s = await api('suppliers.list');
  if (s) _masters.suppliers = s.items;
  const c = document.getElementById('master-content');
  if (c) renderSupplierMasterPage(c);
}

// ---- 資材マスタ ----
function renderMaterialMasterPage(c) {
  const supOpts = '<option value="">-- 仕入先を選択 --</option>' +
    _masters.suppliers.map(s => '<option value="'+esc(s.supplier_name)+'">'+esc(s.supplier_name)+'</option>').join('');

  c.innerHTML =
    '<div class="card">' +
    '<div style="display:flex;gap:8px;margin-bottom:16px;align-items:center;flex-wrap:wrap">' +
    '<h3 style="font-size:15px;font-weight:700;flex:1">資材マスタ</h3>' +
    '<input type="text" id="mat-search" placeholder="品名・品番で検索..." style="max-width:220px" oninput="filterMaterials()">' +
    '<button class="btn btn-primary btn-sm" onclick="openMaterialForm()">＋ 新規登録</button>' +
    '</div>' +
    '<table class="master-table">' +
    '<thead><tr><th>ID</th><th>分類</th><th>品番</th><th>品名</th><th>規格</th><th>単位</th><th>単価</th><th>仕入先</th><th style="width:80px">操作</th></tr></thead>' +
    '<tbody id="material-master-body">' +
    renderMaterialRows(_masters.materials) +
    '</tbody></table></div>' +
    '<div id="material-form-area"></div>';
}

function renderMaterialRows(items) {
  if (!items || items.length === 0) return '<tr><td colspan="9" style="text-align:center;color:var(--c-text3);padding:30px">資材が登録されていません</td></tr>';
  return items.map((m,i) =>
    '<tr><td><code style="font-size:11px">'+esc(m.material_id)+'</code></td>' +
    '<td>'+esc(m.category||'')+'</td><td>'+esc(m.product_no||'')+'</td><td>'+esc(m.product_name||'')+'</td>' +
    '<td>'+esc(m.spec||'')+'</td><td>'+esc(m.unit||'')+'</td>' +
    '<td>'+(m.unit_price?Number(m.unit_price).toLocaleString()+'円':'')+'</td>' +
    '<td>'+esc(m.supplier_name||'')+'</td>' +
    '<td><button class="btn btn-secondary btn-sm" onclick="openMaterialForm('+i+')">編集</button></td></tr>'
  ).join('');
}

function filterMaterials() {
  const q = document.getElementById('mat-search')?.value || '';
  const items = q ? _masters.materials.filter(m=>(m.product_name||'').includes(q)||(m.product_no||'').includes(q)) : _masters.materials;
  const tbody = document.getElementById('material-master-body');
  if (tbody) tbody.innerHTML = renderMaterialRows(items);
}

function openMaterialForm(idx) {
  const m = idx !== undefined ? _masters.materials[idx] : null;
  const supOpts = '<option value="">-- 仕入先を選択 --</option>' +
    _masters.suppliers.map(s =>
      '<option value="'+esc(s.supplier_name)+'" '+(m?.supplier_name===s.supplier_name?'selected':'')+'>'+esc(s.supplier_name)+'</option>'
    ).join('');
  const area = document.getElementById('material-form-area');
  if (!area) return;
  area.innerHTML =
    '<div class="card" style="margin-top:16px">' +
    '<h3 style="font-size:15px;font-weight:700;margin-bottom:16px">'+(m?'資材を編集':'新規資材登録')+'</h3>' +
    '<div class="form-row form-row-3">' +
    '<div class="form-group"><label>分類</label><select id="mat-cat">'+CATEGORIES.map(cat=>'<option value="'+cat+'" '+(m?.category===cat?'selected':'')+'>'+cat+'</option>').join('')+'</select></div>' +
    '<div class="form-group"><label>品番</label><input type="text" id="mat-no" value="'+esc(m?.product_no||'')+'" placeholder="品番"></div>' +
    '<div class="form-group"><label>品名 ★</label><input type="text" id="mat-name" value="'+esc(m?.product_name||'')+'" placeholder="品名"></div>' +
    '</div>' +
    '<div class="form-row form-row-3">' +
    '<div class="form-group"><label>規格・サイズ</label><input type="text" id="mat-spec" value="'+esc(m?.spec||'')+'" placeholder="規格"></div>' +
    '<div class="form-group"><label>品質・組成</label><input type="text" id="mat-quality" value="'+esc(m?.quality||'')+'" placeholder="例: 綿100%"></div>' +
    '<div class="form-group"><label>単位</label><select id="mat-unit">'+UNITS.map(u=>'<option value="'+u+'" '+(m?.unit===u?'selected':'')+'>'+u+'</option>').join('')+'</select></div>' +
    '</div>' +
    '<div class="form-row form-row-3">' +
    '<div class="form-group"><label>仕入先 ★</label><select id="mat-sup">'+supOpts+'</select></div>' +
    '<div class="form-group"><label>メーカー名</label><input type="text" id="mat-maker" value="'+esc(m?.maker_name||'')+'" placeholder="メーカー名"></div>' +
    '<div class="form-group"><label>単価（円）</label><input type="number" id="mat-price" value="'+esc(m?.unit_price||'')+'" placeholder="0"></div>' +
    '</div>' +
    '<div class="form-row form-row-2">' +
    '<div class="form-group"><label>リードタイム（日）</label><input type="number" id="mat-lead" value="'+esc(m?.lead_time_days||'')+'" placeholder="0"></div>' +
    '<div class="form-group"><label>最低発注数</label><input type="number" id="mat-minq" value="'+esc(m?.min_order_qty||'')+'" placeholder="0"></div>' +
    '</div>' +
    '<div class="form-group"><label>備考</label><textarea id="mat-memo">'+esc(m?.memo||'')+'</textarea></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">' +
    '<button class="btn btn-secondary" onclick="document.getElementById(\'material-form-area\').innerHTML=\'\'">キャンセル</button>' +
    '<button class="btn btn-primary" onclick="saveMaterial('+(m?'\''+esc(m.material_id||'')+'\'':'null')+')">保存する</button>' +
    '</div></div>';
  area.scrollIntoView({ behavior:'smooth' });
}

async function saveMaterial(material_id) {
  const g = id => document.getElementById(id)?.value || '';
  const data = {
    material_id:    material_id || undefined,
    category:       g('mat-cat'),
    product_no:     g('mat-no'),
    product_name:   g('mat-name'),
    spec:           g('mat-spec'),
    quality:        g('mat-quality'),
    unit:           g('mat-unit'),
    supplier_name:  g('mat-sup'),
    maker_name:     g('mat-maker'),
    unit_price:     parseFloat(g('mat-price')) || 0,
    lead_time_days: g('mat-lead'),
    min_order_qty:  g('mat-minq'),
    memo:           g('mat-memo'),
  };
  if (!data.product_name) { toast('品名を入力してください','error'); return; }
  const res = await api('materials.upsert', data);
  if (!res||!res.ok) { toast('保存に失敗しました','error'); return; }
  toast('保存しました','success');
  const m = await api('materials.list');
  if (m) _masters.materials = m.items;
  const c = document.getElementById('master-content');
  if (c) renderMaterialMasterPage(c);
}

// ---- カラーマスタ ----
function renderColorMasterPage(c) {
  c.innerHTML =
    '<div class="card">' +
    '<div style="display:flex;gap:8px;margin-bottom:16px;align-items:center">' +
    '<h3 style="font-size:15px;font-weight:700;flex:1">カラーマスタ</h3>' +
    '<button class="btn btn-primary btn-sm" onclick="openAddColor()">＋ カラー追加</button>' +
    '</div>' +
    '<table class="master-table"><thead><tr><th>コード</th><th>カラー名</th><th>English</th><th>色見本</th></tr></thead><tbody>' +
    _masters.colors.map(col =>
      '<tr><td><code>'+esc(col.color_code)+'</code></td><td>'+esc(col.color_name_ja)+'</td><td>'+esc(col.color_name_en)+'</td>' +
      '<td><span style="display:inline-block;width:22px;height:22px;border-radius:4px;background:'+esc(col.hex||'#ccc')+';border:1px solid var(--c-border)"></span></td></tr>'
    ).join('') +
    '</tbody></table></div>';
}

// ---- サイズマスタ ----
function renderSizeMasterPage(c) {
  c.innerHTML =
    '<div class="card">' +
    '<div style="display:flex;gap:8px;margin-bottom:16px;align-items:center">' +
    '<h3 style="font-size:15px;font-weight:700;flex:1">サイズマスタ</h3>' +
    '<button class="btn btn-primary btn-sm" onclick="openAddSize()">＋ サイズ追加</button>' +
    '</div>' +
    '<table class="master-table"><thead><tr><th>サイズ名</th><th>グループ</th><th>表示順</th></tr></thead><tbody>' +
    _masters.sizes.map(s =>
      '<tr><td><strong>'+esc(s.size_name)+'</strong></td><td>'+esc(s.size_group)+'</td><td>'+esc(s.sort_order)+'</td></tr>'
    ).join('') +
    '</tbody></table></div>';
}

async function openAddColor() {
  const code   = prompt('カラーコード（3文字英大文字 例: BEG）'); if (!code) return;
  const nameJa = prompt('カラー名（日本語 例: ベージュ）'); if (!nameJa) return;
  const nameEn = prompt('Color name (e.g. Beige)') || '';
  const hex    = prompt('HEXカラーコード（例: #C8B89A）') || '';
  const res = await api('colors.upsert', { color_code:code.toUpperCase(), color_name_ja:nameJa, color_name_en:nameEn, hex, sort_order:_masters.colors.length+1 });
  if (!res||!res.ok) { toast('保存に失敗しました','error'); return; }
  toast('カラーを追加しました','success');
  const col = await api('colors.list');
  if (col) { _masters.colors = col.items; const c = document.getElementById('master-content'); if(c) renderColorMasterPage(c); }
}
async function openAddSize() {
  const name = prompt('サイズ名（例: 2XL / 38 / F）'); if (!name) return;
  const res = await api('sizes.upsert', { size_name:name, size_group:'adult', sort_order:_masters.sizes.length+1 });
  if (!res||!res.ok) { toast('保存に失敗しました','error'); return; }
  toast('サイズを追加しました','success');
  const s = await api('sizes.list');
  if (s) { _masters.sizes = s.items; const c = document.getElementById('master-content'); if(c) renderSizeMasterPage(c); }
}

// ===== 起動 =====
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('l-pass').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
  if (_token && _user) { bootApp(); }
  else { document.getElementById('login-screen').classList.add('show'); }
});
