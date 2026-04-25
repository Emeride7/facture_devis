/**
 * ProGestion v3 — CORRIGÉ AVEC MENU LATÉRAL UNIQUE
 */
(function () {
  'use strict';

  /* ============================================================
     SUPABASE
     ============================================================ */
  const SUPABASE_URL  = 'https://qpmxaxcyvwqhjhcbbjhc.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFwbXhheGN5dndxaGpoY2JiamhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMDg1NjAsImV4cCI6MjA5MTU4NDU2MH0.D9KZ9-b1LK5oHH8W7sX0pYScQHWM0exJWTv8Mtbpvdg';

  let supabase;
  try {
    if (!window.supabase?.createClient) throw new Error('SDK manquant');
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
  } catch (e) {
    console.warn('Supabase non chargé :', e.message);
    supabase = {
      auth: {
        getSession:         async () => ({ data: { session: null }, error: null }),
        onAuthStateChange:  ()       => ({ data: { subscription: { unsubscribe: () => {} } } }),
        signInWithPassword: async () => ({ error: { message: 'Serveur indisponible' } }),
        signUp:             async () => ({ error: { message: 'Serveur indisponible' } }),
        signOut:            async () => ({})
      },
      from: () => ({
        select: () => ({ count: 'exact', head: true, eq: () => ({ eq: () => ({}) }) }),
        insert: async () => ({ error: null }),
        update: () => ({ eq: () => ({ eq: () => ({}) }) }),
        delete: () => ({ eq: () => ({ eq: () => ({}) }) }),
        upsert: async () => ({ error: null })
      })
    };
  }

  /* ============================================================
     CONSTANTES
     ============================================================ */
  const DOC_LIMIT = 10;
  const MAX_UNDO  = 25;

  const STORAGE_KEYS = {
    draft:    'pg_draft.v6',
    counters: 'pg_counters.v6',
    clients:  'pg_clients.v6'
  };

  const MODES = {
    devis:    { label: 'DEVIS',     prefix: 'D', hasValidity: true  },
    facture:  { label: 'FACTURE',   prefix: 'F', hasValidity: false },
    proforma: { label: 'PRO FORMA', prefix: 'P', hasValidity: true  }
  };

  const STATUS_INFO = {
    draft:    { label: 'Brouillon', icon: '📝', cls: 'st-draft'    },
    sent:     { label: 'Envoyé',    icon: '📤', cls: 'st-sent'     },
    accepted: { label: 'Accepté',   icon: '✅', cls: 'st-accepted' },
    invoiced: { label: 'Facturé',   icon: '💰', cls: 'st-invoiced' },
    refused:  { label: 'Refusé',    icon: '❌', cls: 'st-refused'  },
    expired:  { label: 'Expiré',    icon: '⏰', cls: 'st-expired'  }
  };

  const TEMPLATES = [
    { id:'service',    name:'Prestation de service', icon:'fas fa-briefcase',          desc:'Consulting, mission',
      notes:'Paiement sous 30 jours.\nTout retard entraîne des pénalités de 1,5%/mois.',
      items:[{designation:'Prestation de conseil',qty:1,price:0},{designation:'Frais de déplacement',qty:1,price:0}] },
    { id:'produit',    name:'Vente produits',        icon:'fas fa-box',                desc:'Marchandises, équipements',
      notes:'Livraison sous 5-7 jours ouvrés après paiement. Retours acceptés 14 jours.',
      items:[{designation:'Produit ref. —',qty:1,price:0},{designation:'Frais de livraison',qty:1,price:0}] },
    { id:'abonnement', name:'Abonnement mensuel',    icon:'fas fa-sync-alt',           desc:'Maintenance, SaaS',
      notes:'Abonnement renouvelable. Résiliation avec préavis de 30 jours.',
      items:[{designation:'Abonnement mensuel — Plan Standard',qty:1,price:0},{designation:'Support technique',qty:1,price:0}] },
    { id:'transport',  name:'Transport / Livraison', icon:'fas fa-truck',              desc:'Fret, logistique',
      notes:'Prix carburant et manutention inclus. Assurance non incluse.',
      items:[{designation:'Transport de marchandises',qty:1,price:0},{designation:'Frais de manutention',qty:1,price:0}] },
    { id:'btp',        name:'BTP / Travaux',         icon:'fas fa-hard-hat',           desc:'Construction, rénovation',
      notes:'Acompte de 30% requis. Garantie décennale applicable.',
      items:[{designation:'Main d\'œuvre — forfait journalier',qty:1,price:0},{designation:'Fournitures et matériaux',qty:1,price:0},{designation:'Location de matériel',qty:1,price:0}] },
    { id:'formation',  name:'Formation',             icon:'fas fa-chalkboard-teacher', desc:'Cours, ateliers',
      notes:'Certificat de participation fourni à l\'issue de la formation.',
      items:[{designation:'Formation — Module (demi-journée)',qty:1,price:0},{designation:'Support pédagogique (PDF)',qty:1,price:0}] },
    { id:'evenement',  name:'Événementiel',          icon:'fas fa-calendar-check',     desc:'Organisation événements',
      notes:'Acompte de 50% requis à la réservation.',
      items:[{designation:'Organisation et coordination',qty:1,price:0},{designation:'Location salle',qty:1,price:0},{designation:'Traiteur / Restauration',qty:1,price:0}] },
    { id:'vierge',     name:'Document vierge',       icon:'fas fa-file',               desc:'Commencer de zéro',
      notes:'', items:[{designation:'',qty:1,price:0}] }
  ];

  /* ============================================================
     ÉTAT GLOBAL
     ============================================================ */
  const state = {
    mode:              'devis',
    docStatus:         'draft',
    logoDataURL:       null,
    sigImgDataURL:     null,
    _profileLogoDataURL: null,
    draftId:           uid(),
    _saveTimer:        null,
    draggedRow:        null,
    currentUser:       null,
    docCount:          0,
    undoStack:         [],
    redoStack:         [],
    _undoLock:         false
  };

  /* ============================================================
     UTILITAIRES
     ============================================================ */
  function uid() {
    return (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  const $  = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  function fmt(n) {
    const r = Math.round(Number(n) || 0);
    return r.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  function num(v, min = 0) {
    const x = parseFloat(v);
    return Number.isFinite(x) ? Math.max(min, x) : min;
  }

  function todayISO() { return new Date().toISOString().split('T')[0]; }

  function localDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  function daysUntil(isoDate) {
    if (!isoDate) return null;
    return Math.ceil((new Date(isoDate) - new Date(todayISO())) / 86400000);
  }

  function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function toast(msg, type = 'info', duration = 2800) {
    const el = $('#toast');
    if (!el) return;
    const colors = { success:'#14532d', error:'#7f1d1d', warning:'#78350f', info:'var(--primary)' };
    const icons  = { success:'✅', error:'❌', warning:'⚠️', info:'ℹ️' };
    el.textContent = `${icons[type]||''} ${msg}`;
    el.style.background = colors[type] || colors.info;
    el.classList.add('show');
    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => el.classList.remove('show'), duration);
  }

  /* ============================================================
     CARNET CLIENTS
     ============================================================ */
  function getClients() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.clients)) || []; }
    catch { return []; }
  }

  function saveClients(list) {
    localStorage.setItem(STORAGE_KEYS.clients, JSON.stringify(list));
  }

  function saveCurrentClient() {
    const name = $('#clientName')?.value?.trim();
    if (!name) { toast('Renseignez le nom du client d\'abord', 'warning'); return; }
    const clients = getClients();
    const idx = clients.findIndex(c => c.name.toLowerCase() === name.toLowerCase());
    const c = {
      id:      idx >= 0 ? clients[idx].id : uid(),
      name,
      address: $('#clientAddress')?.value || '',
      extra:   $('#clientExtra')?.value   || '',
      siret:   $('#clientSiret')?.value   || '',
      tel:     $('#clientTel')?.value     || '',
      email:   $('#clientEmail')?.value   || '',
      savedAt: new Date().toISOString()
    };
    if (idx >= 0) clients[idx] = c; else clients.unshift(c);
    saveClients(clients);
    populateClientDatalist();
    toast(idx >= 0 ? 'Client mis à jour' : 'Client enregistré ✓', 'success');
  }

  function fillClientFromObj(c) {
    if (!c) return;
    const set = (id, v) => { const el = $(id); if (el) el.value = v||''; };
    set('#clientName',    c.name);
    set('#clientAddress', c.address);
    set('#clientExtra',   c.extra);
    set('#clientSiret',   c.siret);
    set('#clientTel',     c.tel);
    set('#clientEmail',   c.email);
    scheduleSave();
  }

  function renderClientsPanel() {
    const list = $('#clientsList');
    if (!list) return;
    const q = ($('#clientsSearch')?.value || '').toLowerCase();
    const clients = getClients().filter(c =>
      !q || c.name.toLowerCase().includes(q) || (c.tel||'').includes(q)
    );
    list.innerHTML = '';
    if (clients.length === 0) {
      list.innerHTML = `<div class="history-empty"><i class="fas fa-address-book"></i>${q ? 'Aucun résultat' : 'Aucun client enregistré'}</div>`;
      return;
    }
    clients.forEach(c => {
      const docs = getHistory().filter(d => d.client?.name?.toLowerCase() === c.name.toLowerCase());
      const ca   = docs.reduce((s, d) => s + computeTTC(d), 0);
      const div  = document.createElement('div');
      div.className = 'client-card-panel';
      div.innerHTML = `
        <div class="cc-name">${escHtml(c.name)}</div>
        <div class="cc-info">
          ${c.tel   ? `<div>📞 ${escHtml(c.tel)}</div>` : ''}
          ${c.email ? `<div>✉️ ${escHtml(c.email)}</div>` : ''}
          ${c.address ? `<div>📍 ${escHtml(c.address)}</div>` : ''}
        </div>
        <div class="cc-stats">
          <div><div class="cc-stat-label">Documents</div><div class="cc-stat-value">${docs.length}</div></div>
          <div><div class="cc-stat-label">CA total</div><div class="cc-stat-value">${fmt(ca)} CFA</div></div>
        </div>
        <div class="cc-actions">
          <button class="cc-btn-use" data-id="${c.id}"><i class="fas fa-file-alt"></i> Utiliser</button>
          <button class="cc-btn-del" data-id="${c.id}"><i class="fas fa-trash"></i></button>
        </div>`;
      list.appendChild(div);
    });

    list.onclick = e => {
      const useBtn = e.target.closest('.cc-btn-use');
      const delBtn = e.target.closest('.cc-btn-del');
      if (useBtn) {
        const c = getClients().find(x => x.id === useBtn.dataset.id);
        if (c) { fillClientFromObj(c); closeClients(); toast(`Client sélectionné : ${c.name}`, 'success'); }
      }
      if (delBtn) {
        if (confirm('Supprimer ce client ?')) {
          saveClients(getClients().filter(x => x.id !== delBtn.dataset.id));
          renderClientsPanel();
          toast('Client supprimé', 'warning');
        }
      }
    };
  }

  function openClients() { renderClientsPanel(); $('#clientsOverlay')?.classList.add('open'); $('#clientsSearch')?.focus(); }
  function closeClients() { $('#clientsOverlay')?.classList.remove('open'); }

  function populateClientDatalist() {
    const dl = $('#clientDatalist');
    if (!dl) return;
    const names = [...new Set([
      ...getClients().map(c => c.name),
      ...getHistory().map(d => d.client?.name).filter(Boolean)
    ])];
    dl.innerHTML = names.map(n => `<option value="${escHtml(n)}">`).join('');
  }

  /* ============================================================
     NUMÉROTATION AUTOMATIQUE
     ============================================================ */
  function peekNextNumber(mode) {
    const { prefix } = MODES[mode] || MODES.devis;
    const yr = String(new Date().getFullYear()).slice(-2);
    const counters = getCounters();
    const next = (counters[yr] || 0) + 1;
    return `${prefix}${yr}-${String(next).padStart(4, '0')}`;
  }

  function consumeNextNumber(mode) {
    const { prefix } = MODES[mode] || MODES.devis;
    const yr = String(new Date().getFullYear()).slice(-2);
    const counters = getCounters();
    const next = (counters[yr] || 0) + 1;
    counters[yr] = next;
    localStorage.setItem(STORAGE_KEYS.counters, JSON.stringify(counters));
    return `${prefix}${yr}-${String(next).padStart(4, '0')}`;
  }

  function getCounters() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.counters)) || {}; }
    catch { return {}; }
  }

  /* ============================================================
     MODE
     ============================================================ */
  function setMode(mode) {
    if (!MODES[mode]) mode = 'devis';
    state.mode = mode;
    const { label, hasValidity } = MODES[mode];
    const dt = $('#docTitle');     if (dt) dt.textContent = label;
    const tb = $('#docTypeBadge'); if (tb) tb.textContent = label;
    $$('.mode-btn').forEach(b => b.classList.remove('active'));
    const map = { devis:'btnDevis', facture:'btnFacture', proforma:'btnProforma' };
    $('#' + map[mode])?.classList.add('active');
    const vc = $('#validityContainer');
    if (vc) vc.style.display = hasValidity ? '' : 'none';

    const dn = $('#docNumber');
    if (dn && !dn.value) {
      dn.value = consumeNextNumber(mode);
    }
  }

  function setStatus(status) {
    state.docStatus = status || 'draft';
    const sel = $('#docStatus');
    if (sel) sel.value = state.docStatus;
  }

  /* ============================================================
     UNDO / REDO
     ============================================================ */
  function snapshotState() {
    if (state._undoLock) return;
    const snap = JSON.stringify(collectData());
    state.undoStack.push(snap);
    if (state.undoStack.length > MAX_UNDO) state.undoStack.shift();
    state.redoStack = [];
    updateUndoBtns();
  }

  function undo() {
    if (state.undoStack.length < 2) return;
    state.redoStack.push(state.undoStack.pop());
    const snap = state.undoStack[state.undoStack.length - 1];
    if (!snap) return;
    state._undoLock = true;
    applyData(JSON.parse(snap));
    state._undoLock = false;
    updateUndoBtns();
    toast('Annulé', 'info', 1200);
  }

  function redo() {
    if (!state.redoStack.length) return;
    const snap = state.redoStack.pop();
    state.undoStack.push(snap);
    state._undoLock = true;
    applyData(JSON.parse(snap));
    state._undoLock = false;
    updateUndoBtns();
    toast('Rétabli', 'info', 1200);
  }

  function updateUndoBtns() {
    const u = $('#btnUndo'); if (u) u.disabled = state.undoStack.length < 2;
    const r = $('#btnRedo'); if (r) r.disabled = !state.redoStack.length;
  }

  /* ============================================================
     LIGNES
     ============================================================ */
  function createRow(item = {}) {
    const tr = document.createElement('tr');
    tr.dataset.rowId = item.id || uid();

    const makeTd = cls => { const td = document.createElement('td'); if (cls) td.className = cls; return td; };
    const makeInput = (type, cls, ph, val, field) => {
      const inp = document.createElement('input');
      inp.type = type; inp.className = cls; inp.placeholder = ph; inp.value = val; inp.dataset.field = field;
      if (type === 'number') { inp.min = '0'; inp.step = '0.01'; }
      return inp;
    };

    const tdDrag = makeTd('drag-handle');
    tdDrag.innerHTML = '<i class="fas fa-grip-vertical"></i>';
    tr.appendChild(tdDrag);

    const tdD = makeTd('col-designation');
    const inpD = makeInput('text', 'item-input', 'Désignation du produit/service', item.designation||'', 'designation');
    inpD.setAttribute('list', 'itemDatalist');
    tdD.appendChild(inpD);
    tr.appendChild(tdD);

    const tdQ = makeTd('col-qty');
    tdQ.appendChild(makeInput('number','item-input num','0', item.qty??1, 'qty'));
    tr.appendChild(tdQ);

    const tdP = makeTd('col-price');
    tdP.appendChild(makeInput('number','item-input num','0', item.price??0, 'price'));
    tr.appendChild(tdP);

    const tdT = makeTd('line-total-cell');
    tdT.textContent = fmt((item.qty??1)*(item.price??0));
    tr.appendChild(tdT);

    const tdA = makeTd('col-actions');
    const btnDel = document.createElement('button');
    btnDel.type = 'button'; btnDel.className = 'remove-row-btn';
    btnDel.innerHTML = '<i class="fas fa-trash"></i>';
    btnDel.dataset.action = 'remove-row';
    tdA.appendChild(btnDel);
    tr.appendChild(tdA);

    tr.draggable = true;
    tr.addEventListener('dragstart', onDragStart);
    tr.addEventListener('dragover',  onDragOver);
    tr.addEventListener('drop',      onDrop);
    tr.addEventListener('dragend',   onDragEnd);

    return tr;
  }

  function addRow(item = {}, focus = false) {
    const body = $('#itemsBody'); if (!body) return;
    const row = createRow({ id:uid(), qty:1, price:0, ...item });
    body.appendChild(row);
    if (focus) row.querySelector('.item-input')?.focus();
    recalculate();
    scheduleSave();
  }

  function ensureOneRow() {
    if ($('#itemsBody')?.children.length === 0) addRow();
  }

  /* ============================================================
     DRAG & DROP
     ============================================================ */
  function onDragStart(e) {
    if (!e.target.closest('.drag-handle')) { e.preventDefault(); return; }
    state.draggedRow = this;
    e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => this.classList.add('dragging'));
  }

  function onDragOver(e) {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    if (!state.draggedRow || this === state.draggedRow || this.tagName !== 'TR') return;
    const rect = this.getBoundingClientRect();
    this.parentNode.insertBefore(state.draggedRow, (e.clientY - rect.top) > rect.height/2 ? this.nextSibling : this);
  }

  function onDrop(e) { e.preventDefault(); recalculate(); scheduleSave(); }

  function onDragEnd() {
    if (state.draggedRow) state.draggedRow.classList.remove('dragging');
    state.draggedRow = null;
  }

  /* ============================================================
     CALCULS
     ============================================================ */
  function recalculate() {
    const body = $('#itemsBody'); if (!body) return;
    let subtotal = 0;
    for (const tr of body.rows) {
      const q = num(tr.querySelector('[data-field="qty"]')?.value);
      const p = num(tr.querySelector('[data-field="price"]')?.value);
      const lt = q * p; subtotal += lt;
      const cell = tr.querySelector('.line-total-cell');
      if (cell) cell.textContent = fmt(lt);
    }
    const curr        = $('#currency')?.value || 'CFA';
    const discountOn  = $('#discountEnabled')?.checked || false;
    const discountRate = discountOn ? num($('#discountRate')?.value) : 0;
    const discount    = subtotal * discountRate / 100;
    const afterDisc   = subtotal - discount;
    const vatOn       = $('#vatEnabled')?.checked || false;
    const vatRate     = vatOn ? num($('#vatRate')?.value) : 0;
    const tax         = afterDisc * vatRate / 100;
    const total       = afterDisc + tax;

    const drd = $('#discountRateDisplay'); if (drd) drd.textContent = discountRate;
    const dic = $('#discountInputContainer'); if (dic) dic.style.display = discountOn ? 'flex' : 'none';
    const dr  = $('#discountRow');            if (dr)  dr.style.display  = discountOn ? '' : 'none';
    const vrd = $('#vatRateDisplay');         if (vrd) vrd.textContent = vatRate;
    const vic = $('#vatInputContainer');      if (vic) vic.style.display = vatOn ? 'flex' : 'none';
    const vr  = $('#vatRow');                 if (vr)  vr.style.display  = vatOn ? '' : 'none';

    const set = (id, v) => { const el = $('#'+id); if (el) el.textContent = fmt(v); };
    set('subtotal',      subtotal);
    set('totalDiscount', discount);
    set('totalTax',      tax);
    set('grandTotal',    total);
    $$('.curr').forEach(el => { el.textContent = curr; });
  }

  /* ============================================================
     COLLECT / APPLY DATA
     ============================================================ */
  function collectData() {
    const rows = [];
    const body = $('#itemsBody');
    if (body) {
      for (const tr of body.rows) {
        rows.push({
          id:          tr.dataset.rowId,
          designation: tr.querySelector('[data-field="designation"]')?.value || '',
          qty:         num(tr.querySelector('[data-field="qty"]')?.value),
          price:       num(tr.querySelector('[data-field="price"]')?.value)
        });
      }
    }
    const g = id => $(id)?.value || '';
    return {
      id:           state.draftId,
      mode:         state.mode,
      docStatus:    state.docStatus || 'draft',
      docNumber:    g('#docNumber'),
      docDate:      g('#docDate') || todayISO(),
      docValidity:  g('#docValidity'),
      currency:     g('#currency') || 'CFA',
      vatEnabled:   $('#vatEnabled')?.checked ?? true,
      vatRate:      num(g('#vatRate'), 0),
      discountEnabled: $('#discountEnabled')?.checked || false,
      discountRate:    num(g('#discountRate'), 0),
      notes:        g('#docNotes'),
      placeOfIssue: g('#placeOfIssue'),
      signatoryName:g('#signatoryName'),
      signatoryRole:g('#signatoryRole'),
      emitter: {
        name:    g('#emitterName'),
        address: g('#emitterAddress'),
        extra:   g('#emitterExtra'),
        tel:     g('#emitterTel'),
        email:   g('#emitterEmail')
      },
      client: {
        name:    g('#clientName'),
        address: g('#clientAddress'),
        extra:   g('#clientExtra'),
        siret:   g('#clientSiret'),
        tel:     g('#clientTel'),
        email:   g('#clientEmail')
      },
      logo:    state.logoDataURL   || null,
      sigImg:  state.sigImgDataURL || null,
      items:   rows,
      updatedAt: new Date().toISOString()
    };
  }

  function applyData(data) {
    if (!data) return;
    state.draftId       = data.id       || uid();
    state.logoDataURL   = data.logo     || null;
    state.sigImgDataURL = data.sigImg   || null;

    const set = (id, val) => { const el = $(id); if (el) el.value = val||''; };
    set('#emitterName',    data.emitter?.name);
    set('#emitterAddress', data.emitter?.address);
    set('#emitterExtra',   data.emitter?.extra);
    set('#emitterTel',     data.emitter?.tel);
    set('#emitterEmail',   data.emitter?.email);
    set('#clientName',    data.client?.name);
    set('#clientAddress', data.client?.address);
    set('#clientExtra',   data.client?.extra);
    set('#clientSiret',   data.client?.siret);
    set('#clientTel',     data.client?.tel);
    set('#clientEmail',   data.client?.email);
    set('#docNumber',    data.docNumber);
    set('#docDate',      data.docDate || todayISO());
    set('#docValidity',  data.docValidity);
    set('#currency',     data.currency || 'CFA');
    set('#placeOfIssue', data.placeOfIssue);
    set('#docNotes',     data.notes);
    set('#signatoryName', data.signatoryName);
    const sr = $('#signatoryRole'); if (sr) sr.value = data.signatoryRole || '';

    const ve = $('#vatEnabled');      if (ve) ve.checked  = data.vatEnabled !== false;
    const vr = $('#vatRate');         if (vr) vr.value    = data.vatRate ?? 18;
    const de = $('#discountEnabled'); if (de) de.checked  = data.discountEnabled || false;
    const dr = $('#discountRate');    if (dr) dr.value    = data.discountRate ?? 0;

    const lp = $('#logoPreview'), lph = $('#logoPlaceholder');
    if (data.logo && lp && lph) { 
      lp.src = data.logo; 
      lp.style.display = 'block'; 
      lph.style.display = 'none'; 
    } else if (lp && lph) { 
      lp.style.display = 'none'; 
      lph.style.display = 'flex'; 
    }

    const sp = $('#sigImgPreview'), sph = $('#sigUploadHint'), scb = $('#btnClearSig');
    if (data.sigImg && sp && sph) {
      sp.src = data.sigImg; 
      sp.style.display = 'block'; 
      sph.style.display = 'none';
      if (scb) scb.style.display = 'flex';
    } else if (sp && sph) {
      sp.style.display = 'none'; 
      sph.style.display = 'flex';
      if (scb) scb.style.display = 'none';
    }

    const body = $('#itemsBody');
    if (body) {
      body.innerHTML = '';
      if (Array.isArray(data.items) && data.items.length) {
        data.items.forEach(it => body.appendChild(createRow(it)));
      } else addRow();
    }

    setMode(data.mode || 'devis');
    setStatus(data.docStatus || 'draft');
    recalculate();
    populateClientDatalist();
  }

  /* ============================================================
     SAUVEGARDE BROUILLON
     ============================================================ */
  function saveDraft() {
    localStorage.setItem(STORAGE_KEYS.draft, JSON.stringify(collectData()));
  }

  function scheduleSave() {
    showAutosave('saving');
    clearTimeout(state._saveTimer);
    state._saveTimer = setTimeout(() => {
      saveDraft();
      showAutosave('saved');
      snapshotState();
    }, 700);
  }

  function showAutosave(s) {
    const bar = $('#autosaveBar'); if (!bar) return;
    if (s === 'saving') { bar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enregistrement…'; bar.classList.add('visible'); }
    else { bar.innerHTML = '<i class="fas fa-check-circle"></i> Brouillon sauvegardé'; bar.classList.add('visible'); clearTimeout(window._asTimer); window._asTimer = setTimeout(() => bar.classList.remove('visible'), 2200); }
  }

  function loadDraft() {
    const raw = localStorage.getItem(STORAGE_KEYS.draft);
    if (!raw) { resetToNew(); return; }
    try { applyData(JSON.parse(raw)); } catch { resetToNew(); }
  }

  function resetToNew(keepEmitter = true) {
    state.draftId       = uid();
    state.docStatus     = 'draft';
    state.sigImgDataURL = null;

    if (!keepEmitter) {
      ['#emitterName','#emitterAddress','#emitterExtra','#emitterTel','#emitterEmail']
        .forEach(id => { const el = $(id); if (el) el.value = ''; });
      state.logoDataURL = null;
      const lp = $('#logoPreview'), lph = $('#logoPlaceholder');
      if (lp) lp.style.display = 'none'; if (lph) lph.style.display = 'flex';
    }

    ['#clientName','#clientAddress','#clientExtra','#clientSiret','#clientTel','#clientEmail',
     '#docNotes','#placeOfIssue','#signatoryName']
      .forEach(id => { const el = $(id); if (el) el.value = ''; });
    const sr = $('#signatoryRole'); if (sr) sr.value = '';
    const dd = $('#docDate');     if (dd && !dd.value) dd.value = todayISO();
    const dv = $('#docValidity'); if (dv) dv.value = '';
    const cu = $('#currency');    if (cu && !cu.value) cu.value = 'CFA';
    const ve = $('#vatEnabled');  if (ve) ve.checked = true;
    const vr = $('#vatRate');     if (vr) vr.value = 18;
    const de = $('#discountEnabled'); if (de) de.checked = false;
    const dr2 = $('#discountRate');   if (dr2) dr2.value = 0;

    const sp = $('#sigImgPreview'), sph = $('#sigUploadHint'), scb = $('#btnClearSig');
    if (sp) { sp.src='#'; sp.style.display='none'; }
    if (sph) sph.style.display = 'flex';
    if (scb) scb.style.display = 'none';

    const dn = $('#docNumber'); if (dn && !dn.value) dn.value = consumeNextNumber('devis');
    const body = $('#itemsBody'); if (body) { body.innerHTML = ''; addRow(); }

    setMode('devis');
    setStatus('draft');
    recalculate();
    saveDraft();

    state.undoStack = [];
    state.redoStack = [];
    updateUndoBtns();
  }

  /* ============================================================
     DUPLICATION
     ============================================================ */
  function duplicateDocument() {
    const data = collectData();
    data.id        = uid();
    data.docNumber = consumeNextNumber(data.mode);
    data.docDate   = todayISO();
    data.docStatus = 'draft';
    data.savedAt   = null;
    applyData(data);
    toast(`Document dupliqué → ${data.docNumber}`, 'success');
    scheduleSave();
  }

  /* ============================================================
     HISTORIQUE
     ============================================================ */
  function historyKey() {
    return state.currentUser ? `pg_history.v6.${state.currentUser.id}` : 'pg_history.v6.anon';
  }

  function getHistory() {
    try { return JSON.parse(localStorage.getItem(historyKey())) || []; }
    catch { return []; }
  }

  function saveHistory(hist) {
    localStorage.setItem(historyKey(), JSON.stringify(hist.slice(0, 100)));
  }

  async function archiveDocument() {
    const data   = collectData();
    data.savedAt = new Date().toISOString();
    const hist   = getHistory();
    const dupIdx = hist.findIndex(it => it.docNumber === data.docNumber && it.mode === data.mode);
    const isNew  = dupIdx < 0;

    if (isNew && state.currentUser && state.docCount >= DOC_LIMIT) {
      showLimitModal();
      return;
    }

    if (isNew) state.docCount++;

    if (dupIdx >= 0) hist[dupIdx] = data; else hist.unshift(data);
    saveHistory(hist);
    populateClientDatalist();
    updateCounterBadge();

    if (state.currentUser) {
      const result = await syncDocumentToSupabase(data, isNew);
      if (!result.success && isNew) {
        state.docCount--;
        updateCounterBadge();
        toast('Erreur de synchronisation', 'error');
      }
    }

    toast('Document sauvegardé ✓', 'success');
  }

  function renderHistory() {
    const list = $('#historyList'); if (!list) return;
    const q          = ($('#historySearch')?.value || '').toLowerCase();
    const typeFilter = $('#filterType')?.value  || '';
    const statFilter = $('#filterStatus')?.value || '';

    const hist = getHistory().filter(it => {
      const mq = !q || (it.client?.name||'').toLowerCase().includes(q) || (it.docNumber||'').toLowerCase().includes(q);
      const mt = !typeFilter || it.mode === typeFilter;
      const ms = !statFilter || it.docStatus === statFilter;
      return mq && mt && ms;
    });

    list.innerHTML = '';
    if (!hist.length) {
      list.innerHTML = `<div class="history-empty"><i class="fas fa-folder-open"></i>${q||typeFilter||statFilter ? 'Aucun résultat' : 'Aucun document sauvegardé'}</div>`;
      return;
    }

    hist.forEach((item, idx) => {
      const ttc  = computeTTC(item);
      const date = item.savedAt ? new Date(item.savedAt).toLocaleDateString('fr-FR') : '—';
      const ml   = MODES[item.mode]?.label || 'DEVIS';
      const st   = STATUS_INFO[item.docStatus] || STATUS_INFO.draft;
      const days = item.docValidity ? daysUntil(item.docValidity) : null;

      let expiryWarn = '';
      if (days !== null && days >= 0 && days <= 7 && item.mode !== 'facture')
        expiryWarn = `<div class="hi-sub" style="color:var(--warning)"><i class="fas fa-exclamation-triangle"></i> Expire dans ${days}j</div>`;

      const div = document.createElement('div');
      div.className = 'history-item';
      div.innerHTML = `
        <div class="hi-top">
          <span class="hi-badge">${ml}</span>
          <span class="hi-status-badge ${st.cls}">${st.icon} ${st.label}</span>
        </div>
        <div class="hi-title">${escHtml(item.docNumber || 'Sans numéro')}</div>
        <div class="hi-sub"><i class="fas fa-user"></i> ${escHtml(item.client?.name || 'Client non renseigné')}</div>
        <div class="hi-sub"><i class="fas fa-calendar-alt"></i> ${escHtml(item.docDate||'—')}</div>
        <div class="hi-sub"><i class="fas fa-clock"></i> ${date}</div>
        ${expiryWarn}
        <div class="hi-amount">${fmt(ttc)} ${item.currency||'CFA'} TTC</div>
        <div class="history-item-actions">
          <button class="btn-load"     data-idx="${idx}"><i class="fas fa-folder-open"></i> Charger</button>
          <button class="btn-dup-hist" data-idx="${idx}"><i class="fas fa-copy"></i> Dupliquer</button>
          <button class="btn-pdf-hist" data-idx="${idx}"><i class="fas fa-file-pdf"></i></button>
          <button class="btn-del-hist" data-idx="${idx}"><i class="fas fa-trash"></i></button>
        </div>`;
      list.appendChild(div);
    });

    list.onclick = e => {
      const lb  = e.target.closest('.btn-load');
      const db  = e.target.closest('.btn-dup-hist');
      const pb  = e.target.closest('.btn-pdf-hist');
      const dlb = e.target.closest('.btn-del-hist');

      if (lb) {
        const h = getHistory()[+lb.dataset.idx];
        if (h && confirm('Charger ce document ? Le brouillon actuel sera écrasé.')) {
          applyData(h); closeHistory(); toast('Document chargé', 'success');
        }
      }
      if (db) {
        const h = getHistory()[+db.dataset.idx];
        if (h) { applyData(h); closeHistory(); duplicateDocument(); }
      }
      if (pb) {
        const h = getHistory()[+pb.dataset.idx];
        if (h) { applyData(h); closeHistory(); setTimeout(exportPDF, 200); }
      }
      if (dlb) {
        const idx = +dlb.dataset.idx;
        const h   = getHistory();
        if (h[idx] && confirm(`Supprimer "${h[idx].docNumber||'ce document'}" ?`)) {
          const del = h.splice(idx, 1)[0];
          saveHistory(h); renderHistory();
          toast('Document supprimé', 'warning');
          deleteDocFromSupabase(del.docNumber, del.mode);
        }
      }
    };
  }

  function computeTTC(data) {
    if (!data?.items) return 0;
    const sub  = data.items.reduce((s, it) => s + num(it.qty) * num(it.price), 0);
    const disc = data.discountEnabled ? sub * num(data.discountRate) / 100 : 0;
    const after = sub - disc;
    const tax  = (data.vatEnabled !== false) ? after * num(data.vatRate) / 100 : 0;
    return after + tax;
  }

  function openHistory()  { renderHistory(); $('#historyOverlay')?.classList.add('open'); $('#historySearch')?.focus(); }
  function closeHistory() { $('#historyOverlay')?.classList.remove('open'); }

  /* ============================================================
     RAPPELS EXPIRATION
     ============================================================ */
  function checkExpiringDocs() {
    const hist = getHistory();
    const expiring = hist.filter(d => {
      if (!d.docValidity || d.mode === 'facture') return false;
      const days = daysUntil(d.docValidity);
      return days !== null && days >= 0 && days <= 7 && !['accepted','invoiced'].includes(d.docStatus);
    });
    if (!expiring.length) return;
    const first = expiring[0];
    const days  = daysUntil(first.docValidity);
    const banner = $('#reminderBanner'), txt = $('#reminderText');
    if (banner && txt) {
      txt.textContent = `${expiring.length} devis expire${expiring.length>1?'nt':''} bientôt — "${first.docNumber}" dans ${days} jour${days!==1?'s':''}`;
      banner.style.display = 'flex';
    }
  }

  /* ============================================================
     TEMPLATES
     ============================================================ */
  function openTemplateModal() {
    const modal = $('#templateModal'); if (!modal) return;
    const grid  = $('#templateGrid');
    if (grid && !grid.children.length) {
      TEMPLATES.forEach(tpl => {
        const card = document.createElement('div');
        card.className = 'template-card';
        card.innerHTML = `<i class="${tpl.icon}"></i><div class="template-card-name">${tpl.name}</div><div class="template-card-desc">${tpl.desc}</div>`;
        card.addEventListener('click', () => applyTemplate(tpl));
        grid.appendChild(card);
      });
    }
    modal.classList.add('open');
  }

  function applyTemplate(tpl) {
    if (!confirm(`Appliquer "${tpl.name}" ? Le contenu actuel sera remplacé.`)) return;
    const body = $('#itemsBody');
    if (body) {
      body.innerHTML = '';
      tpl.items.forEach(it => body.appendChild(createRow({ id:uid(), ...it })));
    }
    const n = $('#docNotes'); if (n && tpl.notes) n.value = tpl.notes;
    recalculate(); scheduleSave();
    $('#templateModal')?.classList.remove('open');
    toast(`Template "${tpl.name}" appliqué`, 'success');
  }

  /* ============================================================
     WHATSAPP
     ============================================================ */
  function shareWhatsApp() {
    const clientPhone = $('#clientTel')?.value?.trim();
    const clientName  = $('#clientName')?.value?.trim() || 'Client';
    const docType     = MODES[state.mode]?.label || 'Document';
    const docNum      = $('#docNumber')?.value || '—';
    const total       = $('#grandTotal')?.textContent || '0';
    const curr        = $('#currency')?.value || 'CFA';
    const emitter     = $('#emitterName')?.value || 'Notre entreprise';

    if (!clientPhone) {
      toast('Renseignez le numéro de téléphone du client', 'warning');
      return;
    }

    const phone = clientPhone.replace(/[\s\-().]/g, '');

    const msg = [
      `Bonjour ${clientName},`,
      ``,
      `Veuillez trouver ci-joint votre *${docType}* N° *${docNum}*.`,
      ``,
      `Montant total : *${total} ${curr}*`,
      `Émis par : ${emitter}`,
      ``,
      `Merci de votre confiance.`
    ].join('\n');

    const url = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    toast('Ouverture WhatsApp…', 'info', 2000);
  }

  /* ============================================================
     EXPORT PDF
     ============================================================ */
  function exportPDF() {
    const body = $('#itemsBody');
    if (!body || body.rows.length === 0) { toast('Ajoutez au moins une ligne', 'error'); return; }

    try {
      const { jsPDF } = window.jspdf;
      const doc  = new jsPDF({ unit:'mm', format:'a4' });
      const pw=210, ml=14, mr=14, cw=pw-ml-mr;
      const curr = $('#currency')?.value || 'CFA';
      const mode = MODES[state.mode] || MODES.devis;
      const status = STATUS_INFO[state.docStatus] || STATUS_INFO.draft;

      const C = {
        navy:    [26,54,107], blue:[42,82,152], lightBg:[235,241,255],
        rowAlt:  [249,251,255], line:[210,220,240], textDk:[22,34,60],
        textMd:  [80,95,130], textLt:[140,155,185], white:[255,255,255],
        green:   [21,128,61], red:[185,28,28]
      };

      const setFont  = (style='normal', size=9) => { doc.setFont('helvetica', style); doc.setFontSize(size); };
      const setColor = rgb => doc.setTextColor(...rgb);
      const setFill  = rgb => doc.setFillColor(...rgb);
      const setDraw  = (rgb, lw=0.3) => { doc.setDrawColor(...rgb); doc.setLineWidth(lw); };

      const emitterLines = [
        $('#emitterAddress')?.value,
        $('#emitterExtra')?.value,
        [$('#emitterTel')?.value, $('#emitterEmail')?.value].filter(Boolean).join('   |   ')
      ].filter(Boolean);

      const rightLineCount = 3 + (mode.hasValidity && $('#docValidity')?.value ? 1 : 0);
      const leftBottom     = 20 + emitterLines.length * 5;
      const rightBottom    = 14 + rightLineCount * 6 + 4;
      const hdrH           = Math.max(36, Math.max(leftBottom, rightBottom) + 6);

      setFill(C.navy); doc.rect(0, 0, pw, hdrH, 'F');
      setFont('bold', 7); setColor([200,215,245]);
      doc.text(status.label.toUpperCase(), pw - mr, hdrH - 4, { align:'right' });

      let emitterX = ml;
      if (state.logoDataURL) {
        try {
          const imgFmt = state.logoDataURL.startsWith('data:image/png') ? 'PNG' : 'JPEG';
          const lSize  = Math.min(30, hdrH - 10);
          const lY     = (hdrH - lSize) / 2;
          setFill(C.white); doc.roundedRect(ml, lY, lSize, lSize, 3, 3, 'F');
          doc.addImage(state.logoDataURL, imgFmt, ml+1, lY+1, lSize-2, lSize-2, undefined, 'FAST');
          emitterX = ml + lSize + 6;
        } catch (_) {}
      }

      setColor(C.white); setFont('bold', 13);
      const nameY = Math.min(14, hdrH/3);
      doc.text($('#emitterName')?.value || 'Votre entreprise', emitterX, nameY);
      setFont('normal', 8); setColor([200,215,245]);
      let ey = nameY + 6;
      emitterLines.forEach(line => { doc.text(line, emitterX, ey); ey += 5; });

      const rightX = pw - mr;
      setFont('bold', 24); setColor(C.white);
      doc.text(mode.label, rightX, 16, { align:'right' });
      setDraw([255,255,255], 0.3); doc.line(rightX-52, 19, rightX, 19);
      setFont('normal', 8.5); setColor([200,215,245]);
      doc.text(`N°  ${$('#docNumber')?.value || '—'}`, rightX, 25, { align:'right' });
      doc.text(`Date :  ${localDate($('#docDate')?.value)}`, rightX, 31, { align:'right' });
      if (mode.hasValidity && $('#docValidity')?.value) {
        doc.text(`Valide jusqu'au :  ${localDate($('#docValidity').value)}`, rightX, 37, { align:'right' });
      }

      let y = hdrH + 8;
      const clientLines = [
        $('#clientAddress')?.value,
        $('#clientExtra')?.value,
        [$('#clientTel')?.value, $('#clientEmail')?.value].filter(Boolean).join('   |   '),
        $('#clientSiret')?.value ? `SIRET / IFU : ${$('#clientSiret').value}` : null
      ].filter(Boolean);
      const cardH = Math.max(26, 16 + clientLines.length * 5 + 6);

      setFill(C.lightBg); setDraw(C.line, 0.4);
      doc.roundedRect(ml, y, cw, cardH, 4, 4, 'FD');
      setFill(C.blue); doc.roundedRect(ml, y, 22, cardH, 4, 4, 'F');
      doc.rect(ml+16, y, 6, cardH, 'F');
      setColor(C.white); setFont('bold', 7);
      doc.text('FACTURÉ À', ml+11, y+cardH-4, { angle:90, align:'left' });
      const cx = ml+26;
      setColor(C.textDk); setFont('bold', 11);
      doc.text($('#clientName')?.value || 'Client non renseigné', cx, y+10);
      setFont('normal', 8.5); setColor(C.textMd);
      let cy2 = y+17;
      clientLines.forEach(line => { doc.text(line, cx, cy2); cy2 += 5; });
      y += cardH + 8;

      const tableRows = [];
      for (const tr of body.rows) {
        const q   = num(tr.querySelector('[data-field="qty"]')?.value);
        const p   = num(tr.querySelector('[data-field="price"]')?.value);
        const des = tr.querySelector('[data-field="designation"]')?.value || '';
        tableRows.push([des, String(q), fmt(p), fmt(q*p)]);
      }

      doc.autoTable({
        head: [[
          { content:'Désignation', styles:{ halign:'left' } },
          { content:'Qté',         styles:{ halign:'right' } },
          { content:`Prix unitaire HT`, styles:{ halign:'right' } },
          { content:`Total HT`,         styles:{ halign:'right' } }
        ]],
        body:   tableRows,
        startY: y,
        margin: { left:ml, right:mr },
        styles: { fontSize:9, cellPadding:{ top:4, bottom:4, left:5, right:5 }, textColor:C.textDk, lineColor:C.line, lineWidth:0.25 },
        headStyles: { fillColor:C.navy, textColor:C.white, fontStyle:'bold', fontSize:8.5, cellPadding:{ top:5, bottom:5, left:5, right:5 } },
        alternateRowStyles: { fillColor:C.rowAlt },
        columnStyles: {
          0:{ cellWidth:'auto', halign:'left' },
          1:{ cellWidth:18, halign:'right' },
          2:{ cellWidth:38, halign:'right' },
          3:{ cellWidth:38, halign:'right' }
        },
        didParseCell(data) {
          if (data.column.index === 3 && data.section === 'body') {
            data.cell.styles.fontStyle = 'bold'; data.cell.styles.textColor = C.navy;
          }
        }
      });

      y = doc.lastAutoTable.finalY;

      const subtotal  = tableRows.reduce((s, _, i) => {
        const tr = body.rows[i];
        return s + num(tr.querySelector('[data-field="qty"]')?.value) * num(tr.querySelector('[data-field="price"]')?.value);
      }, 0);
      const discOn   = $('#discountEnabled')?.checked || false;
      const discRate = discOn ? num($('#discountRate')?.value) : 0;
      const discount = subtotal * discRate / 100;
      const afterDisc = subtotal - discount;
      const vatOn    = $('#vatEnabled')?.checked || false;
      const vatRate  = vatOn ? num($('#vatRate')?.value) : 0;
      const tax      = afterDisc * vatRate / 100;
      const total    = afterDisc + tax;

      y += 6;
      const totX = ml + cw*0.52, totW = cw*0.48, colAmt = pw-mr, colLbl = totX+5;
      const totLines = [
        { label:'Sous-total HT', value:subtotal },
        discOn ? { label:`Remise (${discRate}%)`, value:-discount, red:true } : null,
        vatOn  ? { label:`TVA (${vatRate}%)`,     value:tax } : null
      ].filter(Boolean);
      const rowH = 6.5, totalH = totLines.length*rowH + 14;

      setFill(C.lightBg); setDraw(C.line, 0.3);
      doc.roundedRect(totX, y, totW, totalH, 3, 3, 'FD');
      let ty2 = y+7;
      totLines.forEach(row => {
        setFont('normal', 8.5); setColor(row.red ? C.red : C.textMd);
        doc.text(row.label, colLbl, ty2);
        doc.text(`${row.red&&row.value<0?'− ':''}${fmt(Math.abs(row.value))} ${curr}`, colAmt, ty2, { align:'right' });
        ty2 += rowH;
      });
      setDraw(C.blue, 0.5); doc.line(totX+4, ty2-1, pw-mr-4, ty2-1); ty2 += 3;
      const ttcH = 9;
      setFill(C.navy); doc.roundedRect(totX, ty2-5, totW, ttcH, 3, 3, 'F');
      setFont('bold', 10.5); setColor(C.white);
      doc.text('Total TTC', colLbl, ty2+1);
      doc.text(`${fmt(total)} ${curr}`, colAmt, ty2+1, { align:'right' });
      ty2 += ttcH; y = ty2 + 10;

      const notes = $('#docNotes')?.value?.trim();
      if (notes) {
        const notesY = doc.lastAutoTable.finalY + 6;
        const notesW = cw*0.5 - 4;
        const notesLines = doc.splitTextToSize(notes, notesW-12);
        const notesH = notesLines.length*4.5 + 14;
        setFill([245,247,252]); setDraw(C.line, 0.3);
        doc.roundedRect(ml, notesY, notesW, notesH, 3, 3, 'FD');
        setFill(C.blue); doc.roundedRect(ml, notesY, notesW, 8, 3, 3, 'F');
        doc.rect(ml, notesY+4, notesW, 4, 'F');
        setFont('bold', 7.5); setColor(C.white);
        doc.text('NOTES & CONDITIONS', ml+5, notesY+5.5);
        setFont('normal', 8); setColor(C.textMd);
        doc.text(notesLines, ml+5, notesY+13);
        y = Math.max(y, notesY + notesH + 8);
      }

      const signatoryName = $('#signatoryName')?.value?.trim() || '';
      const signatoryRole = $('#signatoryRole')?.value?.trim() || '';
      const sigExtraH = (signatoryName ? 5 : 0) + (signatoryRole ? 5 : 0);
      const sigBoxH = 28 + sigExtraH, sigBoxW = 80, sigY = y;

      setFill(C.lightBg); setDraw(C.line, 0.3);
      doc.roundedRect(ml, sigY, sigBoxW, sigBoxH, 3, 3, 'FD');
      setFont('bold', 7); setColor(C.textMd);
      doc.text('CACHET ET SIGNATURE', ml+4, sigY+6);

      if (state.sigImgDataURL) {
        try {
          const imgFmt = state.sigImgDataURL.startsWith('data:image/png') ? 'PNG' : 'JPEG';
          doc.addImage(state.sigImgDataURL, imgFmt, ml+4, sigY+8, sigBoxW-10, 16, undefined, 'FAST');
        } catch (_) {
          setDraw(C.blue, 0.5); doc.line(ml+4, sigY+20, ml+sigBoxW-6, sigY+20);
        }
      } else {
        setDraw(C.blue, 0.5); doc.line(ml+4, sigY+20, ml+sigBoxW-6, sigY+20);
      }

      let sigTextY = sigY+26;
      if (signatoryName) { setFont('bold', 8.5); setColor(C.textDk); doc.text(signatoryName, ml+4, sigTextY); sigTextY += 5; }
      if (signatoryRole) { setFont('normal', 7.5); setColor(C.textMd); doc.text(signatoryRole, ml+4, sigTextY); }

      const place = $('#placeOfIssue')?.value;
      if (place) {
        setFont('normal', 8); setColor(C.textMd);
        doc.text(`Fait à ${place}, le ${new Date().toLocaleDateString('fr-FR')}`, ml+sigBoxW+8, sigY+sigBoxH/2+2);
      }

      const pageH  = doc.internal.pageSize.height;
      const footY  = pageH - 8;
      setFill(C.navy); doc.rect(0, footY-4, pw, 12, 'F');
      setFont('normal', 7); setColor([170,190,225]);
      doc.text(`${mode.label}  ·  N° ${$('#docNumber')?.value||'—'}  ·  ${$('#emitterName')?.value||''}`, pw/2, footY+1, { align:'center' });
      doc.text(`Généré le ${new Date().toLocaleString('fr-FR')}`, pw-mr, footY+1, { align:'right' });

      const filename = `${mode.label}_${$('#docNumber')?.value||'sans-numero'}.pdf`;
      doc.save(filename);
      toast('PDF généré ✓', 'success');

    } catch (err) {
      console.error('Erreur PDF :', err);
      toast('Erreur lors de la génération du PDF', 'error');
    }
  }

  /* ============================================================
     EXPORT EXCEL
     ============================================================ */
  function exportExcel() {
    const body = $('#itemsBody');
    if (!body || body.rows.length === 0) { toast('Ajoutez au moins une ligne', 'error'); return; }
    try {
      const curr = $('#currency')?.value || 'CFA';
      const ml   = MODES[state.mode]?.label || 'DEVIS';
      const st   = STATUS_INFO[state.docStatus]?.label || 'Brouillon';
      const wb   = XLSX.utils.book_new();
      const rows = [
        [ml],[],
        ['N°', $('#docNumber')?.value||'', 'Date', $('#docDate')?.value||'', 'Statut', st],
        ['Émetteur', $('#emitterName')?.value||''],
        [],['CLIENT'],
        [$('#clientName')?.value||''],[$('#clientAddress')?.value||''],
        [],['Désignation','Qté',`Prix HT (${curr})`,`Total HT (${curr})`]
      ];
      let sub = 0;
      for (const tr of body.rows) {
        const q = num(tr.querySelector('[data-field="qty"]')?.value);
        const p = num(tr.querySelector('[data-field="price"]')?.value);
        rows.push([tr.querySelector('[data-field="designation"]')?.value||'', q, p, q*p]);
        sub += q*p;
      }
      const discOn = $('#discountEnabled')?.checked || false;
      const discRate = discOn ? num($('#discountRate')?.value) : 0;
      const disc   = sub * discRate / 100;
      const after  = sub - disc;
      const vatOn  = $('#vatEnabled')?.checked || false;
      const vatRate = vatOn ? num($('#vatRate')?.value) : 0;
      const tax    = after * vatRate / 100;
      const total  = after + tax;
      rows.push([]);
      rows.push(['Sous-total HT','','','',sub]);
      if (discOn) rows.push([`Remise (${discRate}%)`,'','','',-disc]);
      if (vatOn)  rows.push([`TVA (${vatRate}%)`,'','','',tax]);
      rows.push(['Total TTC','','','',total]);
      const notes = $('#docNotes')?.value?.trim();
      if (notes) { rows.push([]); rows.push(['Notes', notes]); }
      const ws = XLSX.utils.aoa_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, 'Document');
      XLSX.writeFile(wb, `${ml}_${$('#docNumber')?.value||'sans-numero'}.xlsx`);
      toast('Excel généré ✓', 'success');
    } catch (err) { console.error('Excel:', err); toast('Erreur Excel', 'error'); }
  }

  /* ============================================================
     MENU LATÉRAL UNIQUE
     ============================================================ */
  function bindSideMenu() {
    const menu = $('#sideMenu');
    const btn = $('#btnMainMenu');
    const menuToggle = $('#btnMenuToggle');
    const close = $('#btnCloseMenu');
    const exportBtn = $('#btnMenuExport');
    const submenu = $('#submenuExport');
    
    // Ouvrir le menu
    btn?.addEventListener('click', () => menu?.classList.add('open'));
    menuToggle?.addEventListener('click', () => menu?.classList.add('open'));
    close?.addEventListener('click', () => menu?.classList.remove('open'));
    
    // Fermer en cliquant à l'extérieur
    document.addEventListener('click', e => {
      if (!e.target.closest('.side-menu') && 
          !e.target.closest('.btn-main-menu') && 
          !e.target.closest('.btn-menu-toggle')) {
        menu?.classList.remove('open');
      }
    });
    
    // Toggle sous-menu export
    exportBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (submenu) {
        submenu.style.display = submenu.style.display === 'none' ? 'block' : 'none';
      }
    });
    
    // Actions du menu
    $('#btnMenuNew')?.addEventListener('click', () => {
      if (confirm('Créer un nouveau document ?\n(Infos entreprise conservées, champs client vidés)')) {
        resetToNew(true);
        toast('Nouveau document créé', 'success');
      }
      menu?.classList.remove('open');
    });
    
    $('#btnMenuSave')?.addEventListener('click', () => {
      archiveDocument();
      menu?.classList.remove('open');
    });
    
    $('#btnMenuDuplicate')?.addEventListener('click', () => {
      duplicateDocument();
      menu?.classList.remove('open');
    });
    
    $('#btnMenuHistory')?.addEventListener('click', () => {
      openHistory();
      menu?.classList.remove('open');
    });
    
    $('#btnMenuClients')?.addEventListener('click', () => {
      openClients();
      menu?.classList.remove('open');
    });
    
    $('#btnMenuTemplate')?.addEventListener('click', () => {
      openTemplateModal();
      menu?.classList.remove('open');
    });
    
    $('#btnMenuDashboard')?.addEventListener('click', () => {
      $('#dashboardOverlay')?.classList.add('open');
      menu?.classList.remove('open');
    });
    
    $('#btnMenuExportPdf')?.addEventListener('click', () => {
      exportPDF();
      menu?.classList.remove('open');
      if (submenu) submenu.style.display = 'none';
    });
    
    $('#btnMenuExportExcel')?.addEventListener('click', () => {
      exportExcel();
      menu?.classList.remove('open');
      if (submenu) submenu.style.display = 'none';
    });
    
    $('#btnMenuExportWa')?.addEventListener('click', () => {
      shareWhatsApp();
      menu?.classList.remove('open');
      if (submenu) submenu.style.display = 'none';
    });
    
    $('#btnMenuProfile')?.addEventListener('click', () => {
      $('#profileOverlay')?.classList.add('open');
      menu?.classList.remove('open');
    });
    
    $('#btnMenuSettings')?.addEventListener('click', () => {
      $('#settingsOverlay')?.classList.add('open');
      menu?.classList.remove('open');
    });
    
    $('#btnMenuLogout')?.addEventListener('click', async () => {
      if (confirm('Déconnexion ?')) {
        await supabase.auth.signOut();
        menu?.classList.remove('open');
      }
    });
  }

  /* ============================================================
     PROFIL UTILISATEUR
     ============================================================ */
  function bindProfileEvents() {
    $('#btnCloseProfile')?.addEventListener('click', () => {
      $('#profileOverlay')?.classList.remove('open');
    });
    
    $('#profileOverlay')?.addEventListener('click', e => {
      if (e.target === $('#profileOverlay')) {
        $('#profileOverlay')?.classList.remove('open');
      }
    });

    $('#profileLogoZone')?.addEventListener('click', () => {
      $('#profileLogoUpload')?.click();
    });

    $('#profileLogoUpload')?.addEventListener('change', e => {
      const file = e.target.files?.[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        state._profileLogoDataURL = ev.target.result;
        const pp = $('#profileLogoPreview'), pph = $('#profileLogoHint'), pb = $('#btnClearProfileLogo');
        if (pp && pph) {
          pp.src = ev.target.result;
          pp.style.display = 'block';
          pph.style.display = 'none';
        }
        if (pb) pb.style.display = 'flex';
      };
      reader.readAsDataURL(file);
    });

    $('#btnClearProfileLogo')?.addEventListener('click', () => {
      state._profileLogoDataURL = null;
      const pp = $('#profileLogoPreview'), pph = $('#profileLogoHint'), pb = $('#btnClearProfileLogo');
      if (pp && pph) {
        pp.src = '#';
        pp.style.display = 'none';
        pph.style.display = 'flex';
      }
      if (pb) pb.style.display = 'none';
    });

    $('#btnProfileSave')?.addEventListener('click', async () => {
      if (!state.currentUser) { toast('Vous devez être connecté', 'error'); return; }
      
      const profileData = {
        logo:    state._profileLogoDataURL || null,
        name:    $('#profileName')?.value || '',
        address: $('#profileAddress')?.value || '',
        extra:   $('#profileExtra')?.value || '',
        tel:     $('#profileTel')?.value || '',
        email:   $('#profileEmail')?.value || '',
        ifu:     $('#profileIfu')?.value || ''
      };

      try {
        localStorage.setItem(`pg_profile.${state.currentUser.id}`, JSON.stringify(profileData));
        
        const { error } = await supabase.from('user_profiles').upsert({
          user_id: state.currentUser.id,
          data: profileData,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });

        if (error) throw error;
        toast('Profil sauvegardé ✓', 'success');
      } catch (e) {
        console.error('Profile save:', e);
        toast('Erreur sauvegarde profil', 'error');
      }
    });

    $('#btnProfileApply')?.addEventListener('click', () => {
      const set = (id, v) => { const el = $(id); if (el) el.value = v||''; };
      set('#emitterName',    $('#profileName')?.value);
      set('#emitterAddress', $('#profileAddress')?.value);
      set('#emitterExtra',   $('#profileExtra')?.value);
      set('#emitterTel',     $('#profileTel')?.value);
      set('#emitterEmail',   $('#profileEmail')?.value);
      state.logoDataURL = state._profileLogoDataURL || state.logoDataURL;
      
      const lp = $('#logoPreview'), lph = $('#logoPlaceholder');
      if (state.logoDataURL && lp && lph) {
        lp.src = state.logoDataURL;
        lp.style.display = 'block';
        lph.style.display = 'none';
      }
      
      scheduleSave();
      toast('Profil appliqué au document', 'success');
    });
  }

  function applyProfileToUI(profileData) {
    const set = (id, v) => { const el = $(id); if (el) el.value = v||''; };
    set('#profileName',    profileData.name);
    set('#profileAddress', profileData.address);
    set('#profileExtra',   profileData.extra);
    set('#profileTel',     profileData.tel);
    set('#profileEmail',   profileData.email);
    set('#profileIfu',     profileData.ifu);
    
    if (profileData.logo) {
      state._profileLogoDataURL = profileData.logo;
      const pp = $('#profileLogoPreview'), pph = $('#profileLogoHint'), pb = $('#btnClearProfileLogo');
      if (pp && pph) {
        pp.src = profileData.logo;
        pp.style.display = 'block';
        pph.style.display = 'none';
      }
      if (pb) pb.style.display = 'flex';
    }
  }

  async function loadUserProfile(userId) {
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('data')
        .eq('user_id', userId)
        .single();
      
      if (data) {
        applyProfileToUI(data.data);
        return;
      }
    } catch (e) {
      const stored = localStorage.getItem(`pg_profile.${userId}`);
      if (stored) applyProfileToUI(JSON.parse(stored));
    }
  }

  function applyProfileToDocument() {
    if (!state.currentUser) return;
    const profileRaw = localStorage.getItem(`pg_profile.${state.currentUser.id}`);
    if (profileRaw) {
      try {
        const profile = JSON.parse(profileRaw);
        const set = (id, v) => { const el = $(id); if (el && v) el.value = v; };
        set('#emitterName',    profile.name);
        set('#emitterAddress', profile.address);
        set('#emitterExtra',   profile.extra);
        set('#emitterTel',     profile.tel);
        set('#emitterEmail',   profile.email);
        
        if (profile.logo) {
          state.logoDataURL = profile.logo;
          const lp = $('#logoPreview'), lph = $('#logoPlaceholder');
          if (lp && lph) {
            lp.src = profile.logo;
            lp.style.display = 'block';
            lph.style.display = 'none';
          }
        }
      } catch(e) {}
    }
  }

  /* ============================================================
     ÉVÉNEMENTS
     ============================================================ */
  function bindEvents() {
    $('#btnDevis')?.addEventListener('click',    () => setMode('devis'));
    $('#btnFacture')?.addEventListener('click',  () => setMode('facture'));
    $('#btnProforma')?.addEventListener('click', () => setMode('proforma'));

    $('#docStatus')?.addEventListener('change', e => { state.docStatus = e.target.value; scheduleSave(); });

    $('#btnUndo')?.addEventListener('click', undo);
    $('#btnRedo')?.addEventListener('click', redo);

    $('#btnCloseHistory')?.addEventListener('click', closeHistory);
    $('#historyOverlay')?.addEventListener('click',  e => { if (e.target === $('#historyOverlay')) closeHistory(); });
    $('#historySearch')?.addEventListener('input',   renderHistory);
    $('#filterType')?.addEventListener('change',     renderHistory);
    $('#filterStatus')?.addEventListener('change',   renderHistory);

    $('#btnCloseClients')?.addEventListener('click', closeClients);
    $('#clientsOverlay')?.addEventListener('click',  e => { if (e.target === $('#clientsOverlay')) closeClients(); });
    $('#clientsSearch')?.addEventListener('input',   renderClientsPanel);

    $('#btnCloseTemplate')?.addEventListener('click',() => $('#templateModal')?.classList.remove('open'));
    $('#templateModal')?.addEventListener('click',   e => { if (e.target === $('#templateModal')) $('#templateModal').classList.remove('open'); });

    $('#addRow')?.addEventListener('click', () => addRow({}, true));

    $('#itemsBody')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-action="remove-row"]');
      if (!btn) return;
      const tr = btn.closest('tr'); if (!tr) return;
      const body = $('#itemsBody');
      if (body.children.length > 1) tr.remove();
      else {
        tr.querySelector('[data-field="designation"]').value = '';
        tr.querySelector('[data-field="qty"]').value = '1';
        tr.querySelector('[data-field="price"]').value = '0';
      }
      recalculate(); scheduleSave();
    });

    $('#itemsBody')?.addEventListener('input', e => {
      const field = e.target.dataset?.field;
      if (field === 'qty' || field === 'price') {
        const v = parseFloat(e.target.value);
        if (v < 0 || !Number.isFinite(v)) e.target.value = 0;
      }
      recalculate(); scheduleSave();
    });

    $('#vatEnabled')?.addEventListener('change',      () => { recalculate(); scheduleSave(); });
    $('#discountEnabled')?.addEventListener('change', () => { recalculate(); scheduleSave(); });
    ['#vatRate','#discountRate','#currency'].forEach(id =>
      $(id)?.addEventListener('input', () => { recalculate(); scheduleSave(); })
    );

    $('#docValidity')?.addEventListener('change', () => {
      const validity = $('#docValidity')?.value;
      const docDate = $('#docDate')?.value;
      if (validity && docDate && validity < docDate) {
        toast('La date d\'expiration doit être après la date du document', 'warning');
        $('#docValidity').value = '';
      }
    });

    $('#clientEmail')?.addEventListener('blur', () => {
      const email = $('#clientEmail')?.value?.trim();
      if (email && !isValidEmail(email)) {
        toast('Email invalide', 'warning');
      }
    });

    ['#emitterName','#emitterAddress','#emitterExtra','#emitterTel','#emitterEmail',
     '#clientName','#clientAddress','#clientExtra','#clientSiret','#clientTel','#clientEmail',
     '#docNumber','#docDate','#docValidity','#placeOfIssue','#docNotes','#signatoryName']
      .forEach(id => $(id)?.addEventListener('input', scheduleSave));
    $('#signatoryRole')?.addEventListener('change', scheduleSave);

    $('#logoPlaceholder')?.addEventListener('click', () => $('#logoUpload')?.click());
    $('#logoUpload')?.addEventListener('change', e => {
      const file = e.target.files?.[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        state.logoDataURL = ev.target.result;
        saveDraft();
        const lp = $('#logoPreview'), lph = $('#logoPlaceholder');
        if (lp) { lp.src = ev.target.result; lp.style.display = 'block'; }
        if (lph) lph.style.display = 'none';
      };
      reader.readAsDataURL(file);
    });

    $('#sigUploadZone')?.addEventListener('click', () => {
      if (!$('#sigImgPreview').src || $('#sigImgPreview').style.display === 'none')
        $('#sigImgUpload')?.click();
    });
    $('#sigImgUpload')?.addEventListener('change', e => {
      const file = e.target.files?.[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        state.sigImgDataURL = ev.target.result;
        saveDraft();
        const sp = $('#sigImgPreview'), sph = $('#sigUploadHint'), scb = $('#btnClearSig');
        if (sp) { sp.src = ev.target.result; sp.style.display = 'block'; }
        if (sph) sph.style.display = 'none';
        if (scb) scb.style.display = 'flex';
      };
      reader.readAsDataURL(file);
    });
    $('#btnClearSig')?.addEventListener('click', () => {
      state.sigImgDataURL = null;
      const sp = $('#sigImgPreview'), sph = $('#sigUploadHint'), scb = $('#btnClearSig');
      if (sp) { sp.src = '#'; sp.style.display = 'none'; }
      if (sph) sph.style.display = 'flex';
      if (scb) scb.style.display = 'none';
      scheduleSave();
    });

    const cd = $('#currentDate'); if (cd) cd.textContent = new Date().toLocaleDateString('fr-FR');

    $('#btnCloseReminder')?.addEventListener('click', () => {
      const b = $('#reminderBanner'); if (b) b.style.display = 'none';
    });

    $('#btnCloseSettings')?.addEventListener('click', () => $('#settingsOverlay')?.classList.remove('open'));
    $('#settingsOverlay')?.addEventListener('click', e => { if (e.target === $('#settingsOverlay')) $('#settingsOverlay')?.classList.remove('open'); });
    $('#btnSettingsSave')?.addEventListener('click', () => { toast('Paramètres sauvegardés', 'success'); });

    $('#btnCloseProfile')?.addEventListener('click', () => $('#profileOverlay')?.classList.remove('open'));
    $('#btnCloseDashboard')?.addEventListener('click', () => $('#dashboardOverlay')?.classList.remove('open'));
    $('#btnDashboard')?.addEventListener('click', () => $('#dashboardOverlay')?.classList.add('open'));

    document.addEventListener('keydown', e => {
      if ((e.ctrlKey||e.metaKey) && e.key === 's') { e.preventDefault(); archiveDocument(); }
      if ((e.ctrlKey||e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
      if ((e.ctrlKey||e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); }
      if (e.key === 'Escape') {
        closeHistory(); closeClients();
        $('#templateModal')?.classList.remove('open');
        $('#profileOverlay')?.classList.remove('open');
        $('#settingsOverlay')?.classList.remove('open');
        $('#dashboardOverlay')?.classList.remove('open');
        $('#sideMenu')?.classList.remove('open');
      }
    });
  }

  function bindAuthEvents() {
    $('#tabLogin')?.addEventListener('click', () => {
      $('#tabLogin').classList.add('active'); $('#tabRegister').classList.remove('active');
      $('#formLogin').style.display = ''; $('#formRegister').style.display = 'none';
      clearAuthError('loginError');
    });
    $('#tabRegister')?.addEventListener('click', () => {
      $('#tabRegister').classList.add('active'); $('#tabLogin').classList.remove('active');
      $('#formRegister').style.display = ''; $('#formLogin').style.display = 'none';
      clearAuthError('registerError');
    });

    $$('.toggle-pw').forEach(btn => {
      btn.addEventListener('click', () => {
        const inp = $(btn.dataset.target ? '#'+btn.dataset.target : null) || document.getElementById(btn.dataset.target);
        if (!inp) return;
        const hidden = inp.type === 'password';
        inp.type = hidden ? 'text' : 'password';
        btn.querySelector('i').className = hidden ? 'fas fa-eye-slash' : 'fas fa-eye';
      });
    });

    $('#formLogin')?.addEventListener('submit', async e => {
      e.preventDefault();
      e.stopPropagation();
      
      clearAuthError('loginError');
      const email    = $('#loginEmail')?.value?.trim();
      const password = $('#loginPassword')?.value;
      
      if (!email || !password) { 
        showAuthError('loginError','Veuillez remplir tous les champs.'); 
        return; 
      }
      
      setAuthLoading('btnLogin', true);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setAuthLoading('btnLogin', false);
      
      if (error) {
        const msgs = { 
          'Invalid login credentials':'Email ou mot de passe incorrect.', 
          'Email not confirmed':'Confirmez votre email.', 
          'Too many requests':'Trop de tentatives.' 
        };
        showAuthError('loginError', msgs[error.message] || error.message);
      }
    });

    $('#formRegister')?.addEventListener('submit', async e => {
      e.preventDefault(); clearAuthError('registerError');
      const email   = $('#regEmail')?.value?.trim();
      const pass    = $('#regPassword')?.value;
      const confirm = $('#regConfirm')?.value;
      if (!email||!pass||!confirm) { showAuthError('registerError','Remplissez tous les champs.'); return; }
      if (pass.length < 8) { showAuthError('registerError','Mot de passe min. 8 caractères.'); return; }
      if (pass !== confirm) { showAuthError('registerError','Les mots de passe ne correspondent pas.'); return; }
      setAuthLoading('btnRegister', true);
      const { error } = await supabase.auth.signUp({ email, password: pass });
      setAuthLoading('btnRegister', false);
      if (error) { showAuthError('registerError', error.message); return; }
      toast('Compte créé ! Vérifiez votre email.', 'success', 5000); 
      $('#tabLogin')?.click();
    });

    $('#btnLogout')?.addEventListener('click', async () => {
      if (!confirm('Se déconnecter ?')) return;
      await supabase.auth.signOut();
    });

    $('#btnLimitClose')?.addEventListener('click', () => { $('#limitOverlay').style.display = 'none'; });

    $('#btnProfilePill')?.addEventListener('click', () => {
      $('#profileOverlay')?.classList.add('open');
    });
  }

  function setAuthLoading(btnId, loading) {
    const btn = $('#'+btnId) || document.getElementById(btnId); if (!btn) return;
    btn.disabled = loading;
    const txt = btn.querySelector('.btn-text'), ico = btn.querySelector('.btn-loader');
    if (txt) txt.style.display = loading ? 'none' : '';
    if (ico) ico.style.display = loading ? '' : 'none';
  }

  function showAuthError(elId, msg) {
    const el = document.getElementById(elId); if (!el) return;
    el.textContent = msg; el.classList.add('visible');
    setTimeout(() => el.classList.remove('visible'), 5000);
  }

  function clearAuthError(elId) {
    const el = document.getElementById(elId); if (el) { el.textContent = ''; el.classList.remove('visible'); }
  }

  /* ============================================================
     SUPABASE SYNC
     ============================================================ */
  async function syncDocumentToSupabase(data, isNew) {
    try {
      const payload = {
        user_id:     state.currentUser.id,
        mode:        data.mode,
        doc_number:  data.docNumber,
        doc_date:    data.docDate || null,
        doc_status:  data.docStatus || 'draft',
        client_name: data.client?.name || '',
        total_ttc:   computeTTC(data),
        data
      };
      if (isNew) {
        const { error } = await supabase.from('documents').insert(payload);
        return { success: !error };
      } else {
        const { error } = await supabase.from('documents')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('user_id', state.currentUser.id)
          .eq('doc_number', data.docNumber)
          .eq('mode', data.mode);
        return { success: !error };
      }
    } catch (e) {
      console.error('Sync:', e);
      return { success: false };
    }
  }

  async function loadDocCountFromSupabase() {
    if (!state.currentUser) return;
    try {
      const { count, error } = await supabase
        .from('documents')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', state.currentUser.id);
      if (error) { console.error('Count error:', error.message); return; }
      state.docCount = count || 0;
      updateCounterBadge();
    } catch (e) { console.error('Count:', e); }
  }

  async function loadHistoryFromSupabase() {
    if (!state.currentUser) return;
    try {
      const { data: rows, error } = await supabase
        .from('documents')
        .select('data, created_at, updated_at')
        .eq('user_id', state.currentUser.id)
        .order('updated_at', { ascending: false })
        .limit(100);
      if (error) { console.warn('Historique Supabase indisponible'); return; }
      if (rows?.length) {
        const remoteHist = rows.map(r => ({
          ...r.data,
          savedAt: r.updated_at || r.created_at
        }));
        const localHist = getHistory();
        const merged = [...remoteHist];
        localHist.forEach(local => {
          if (!merged.find(r => r.docNumber === local.docNumber && r.mode === local.mode)) {
            merged.push(local);
          }
        });
        merged.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
        saveHistory(merged);
        toast(`${merged.length} documents synchronisés`, 'info', 1500);
      }
    } catch (e) { console.error('History sync:', e); }
  }

  async function deleteDocFromSupabase(docNumber, mode) {
    if (!state.currentUser) return;
    try {
      await supabase.from('documents').delete()
        .eq('user_id', state.currentUser.id)
        .eq('doc_number', docNumber)
        .eq('mode', mode);
      state.docCount = Math.max(0, state.docCount - 1);
      updateCounterBadge();
    } catch (e) { console.error('Delete:', e); }
  }

  function updateCounterBadge() {
    const badge = $('#docCounterBadge'); if (!badge) return;
    badge.textContent = `${state.docCount}/${DOC_LIMIT}`;
    badge.classList.remove('warn','full');
    if (state.docCount >= DOC_LIMIT) badge.classList.add('full');
    else if (state.docCount >= DOC_LIMIT - 3) badge.classList.add('warn');
  }

  function showLimitModal() { const o = $('#limitOverlay'); if (o) o.style.display = 'flex'; }

  function onAuthStateChange(session) {
    if (session?.user) {
      state.currentUser = session.user;
      const overlay = $('#authOverlay'); if (overlay) overlay.style.display = 'none';
      const pill = $('#userPill'); if (pill) pill.style.display = 'flex';
      
      const nameEl = $('#userName');
      if (nameEl) {
        const name = session.user.user_metadata?.full_name 
          || session.user.email.split('@')[0];
        nameEl.textContent = name;
      }

      loadUserProfile(session.user.id);
      loadDocCountFromSupabase();
      
      loadHistoryFromSupabase().then(() => {
        const raw = localStorage.getItem(STORAGE_KEYS.draft);
        if (raw) {
          try { 
            applyData(JSON.parse(raw)); 
          } catch(e) { 
            resetToNew(false); 
          }
        } else {
          applyProfileToDocument();
          resetToNew(false);
        }
        recalculate();
        ensureOneRow();
        populateClientDatalist();
        checkExpiringDocs();
        snapshotState();
      });

    } else {
      state.currentUser = null; state.docCount = 0;
      const overlay = $('#authOverlay'); if (overlay) overlay.style.display = 'flex';
      const pill = $('#userPill'); if (pill) pill.style.display = 'none';
    }
  }

  /* ============================================================
     INIT
     ============================================================ */
  async function init() {
    const authOverlay = $('#authOverlay'); if (authOverlay) authOverlay.style.display = 'flex';

    const dn = $('#docNumber');
    if (dn && !dn.value) dn.placeholder = peekNextNumber('devis');

    const dd = $('#docDate'); if (dd && !dd.value) dd.value = todayISO();
    const cd = $('#currentDate'); if (cd) cd.textContent = new Date().toLocaleDateString('fr-FR');

    bindEvents();
    bindAuthEvents();
    bindProfileEvents();
    bindSideMenu();

    try {
      supabase.auth.onAuthStateChange((_event, session) => onAuthStateChange(session));
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      onAuthStateChange(data?.session ?? null);
    } catch (err) {
      console.error('Auth init:', err);
      toast('Connexion au serveur impossible. Vérifiez votre réseau.', 'error', 5000);
      loadDraft();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();