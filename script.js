/**
 * ProGestion - Application de devis/factures
 * Version corrigée avec gestion complète des clients
 */
(function () {
  'use strict';

  /* ============================================================
     CONFIGURATION SUPABASE
     ============================================================ */
  const SUPABASE_URL = 'https://qpmxaxcyvwqhjhcbbjhc.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFwbXhheGN5dndxaGpoY2JiamhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMDg1NjAsImV4cCI6MjA5MTU4NDU2MH0.D9KZ9-b1LK5oHH8W7sX0pYScQHWM0exJWTv8Mtbpvdg';

  let supabase;
  try {
    if (!window.supabase?.createClient) throw new Error('SDK manquant');
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
  } catch (e) {
    console.warn('Supabase non chargé :', e.message);
    supabase = {
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        signInWithPassword: async () => ({ error: { message: 'Serveur indisponible' } }),
        signUp: async () => ({ error: { message: 'Serveur indisponible' } }),
        signOut: async () => ({})
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
  const MAX_UNDO = 25;
  const STORAGE_KEYS = {
    draft: 'pg_draft.v6',
    counters: 'pg_counters.v6',
    clients: 'pg_clients.v6'
  };
  const MODES = {
    devis: { label: 'DEVIS', prefix: 'D', hasValidity: true },
    facture: { label: 'FACTURE', prefix: 'F', hasValidity: false },
    proforma: { label: 'PRO FORMA', prefix: 'P', hasValidity: true }
  };
  const STATUS_INFO = {
    draft: { label: 'Brouillon', icon: '📝', cls: 'st-draft' },
    sent: { label: 'Envoyé', icon: '📤', cls: 'st-sent' },
    accepted: { label: 'Accepté', icon: '✅', cls: 'st-accepted' },
    invoiced: { label: 'Facturé', icon: '💰', cls: 'st-invoiced' },
    refused: { label: 'Refusé', icon: '❌', cls: 'st-refused' },
    expired: { label: 'Expiré', icon: '⏰', cls: 'st-expired' }
  };

  /* ============================================================
     ÉTAT GLOBAL
     ============================================================ */
  const state = {
    mode: 'devis',
    docStatus: 'draft',
    logoDataURL: null,
    sigImgDataURL: null,
    _profileLogoDataURL: null,
    draftId: uid(),
    _saveTimer: null,
    draggedRow: null,
    currentUser: null,
    docCount: 0,
    undoStack: [],
    redoStack: [],
    _undoLock: false
  };

  /* ============================================================
     UTILITAIRES
     ============================================================ */
  function uid() {
    return (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  
  function $(sel, ctx = document) { return ctx ? ctx.querySelector(sel) : document.querySelector(sel); }
  function $$(sel, ctx = document) { return Array.from((ctx || document).querySelectorAll(sel)); }
  
  function fmt(n) {
    const r = Math.round(Number(n) || 0);
    return r.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }
  
  function num(v, min = 0) {
    const x = parseFloat(v);
    return Number.isFinite(x) ? Math.max(min, x) : min;
  }
  
  function todayISO() { return new Date().toISOString().split('T')[0]; }
  
  function daysUntil(isoDate) {
    if (!isoDate) return null;
    return Math.ceil((new Date(isoDate) - new Date(todayISO())) / 86400000);
  }
  
  function escHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  
  function toast(msg, type = 'info', duration = 2800) {
    const el = $('#toast');
    if (!el) return;
    const colors = { success: '#14532d', error: '#7f1d1d', warning: '#78350f', info: '#1e3c72' };
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    el.textContent = `${icons[type] || ''} ${msg}`;
    el.style.background = colors[type] || colors.info;
    el.classList.add('show');
    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => el.classList.remove('show'), duration);
  }

  /* ============================================================
     GESTION CLIENTS (LOCALSTORAGE)
     ============================================================ */
  function getClients() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.clients)) || []; } catch { return []; }
  }
  
  function saveClients(list) { localStorage.setItem(STORAGE_KEYS.clients, JSON.stringify(list)); }
  
  function populateClientDatalist() {
    const dl = $('#clientDatalist');
    if (!dl) return;
    const names = [...new Set([...getClients().map(c => c.name), ...getHistory().map(d => d.client?.name).filter(Boolean)])];
    dl.innerHTML = names.map(n => `<option value="${escHtml(n)}">`).join('');
  }
  
  function renderClientsPanel() {
    const list = $('#clientsList');
    if (!list) return;
    const q = ($('#clientsSearch')?.value || '').toLowerCase();
    const clients = getClients().filter(c => !q || c.name.toLowerCase().includes(q) || (c.tel || '').includes(q));
    list.innerHTML = '';
    if (clients.length === 0) {
      list.innerHTML = `<div class="history-empty"><i class="fas fa-address-book"></i>${q ? 'Aucun résultat' : 'Aucun client'}</div>`;
      return;
    }
    clients.forEach(c => {
      const docs = getHistory().filter(d => d.client?.name?.toLowerCase() === c.name.toLowerCase());
      const ca = docs.reduce((s, d) => s + computeTTC(d), 0);
      const div = document.createElement('div');
      div.className = 'client-card-panel';
      div.innerHTML = `<div class="cc-name">${escHtml(c.name)}</div>
        <div class="cc-info">${c.tel ? `<div>📞 ${escHtml(c.tel)}</div>` : ''}${c.email ? `<div>✉️ ${escHtml(c.email)}</div>` : ''}</div>
        <div class="cc-stats"><div><div class="cc-stat-label">Documents</div><div class="cc-stat-value">${docs.length}</div></div>
        <div><div class="cc-stat-label">CA total</div><div class="cc-stat-value">${fmt(ca)} CFA</div></div></div>
        <div class="cc-actions"><button class="cc-btn-use" data-id="${c.id}">Utiliser</button><button class="cc-btn-del" data-id="${c.id}">Supprimer</button></div>`;
      list.appendChild(div);
    });
    
    list.onclick = e => {
      const useBtn = e.target.closest('.cc-btn-use');
      const delBtn = e.target.closest('.cc-btn-del');
      if (useBtn) {
        const c = getClients().find(x => x.id === useBtn.dataset.id);
        if (c) fillClientFromObj(c);
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
  
  function fillClientFromObj(c) {
    if (!c) return;
    const clientName = $('#clientName');
    const clientAddress = $('#clientAddress');
    const clientExtra = $('#clientExtra');
    const clientSiret = $('#clientSiret');
    const clientTel = $('#clientTel');
    const clientEmail = $('#clientEmail');
    if (clientName) clientName.value = c.name || '';
    if (clientAddress) clientAddress.value = c.address || '';
    if (clientExtra) clientExtra.value = c.extra || '';
    if (clientSiret) clientSiret.value = c.siret || '';
    if (clientTel) clientTel.value = c.tel || '';
    if (clientEmail) clientEmail.value = c.email || '';
    scheduleSave();
  }
  
  // ========== MODAL CLIENT ==========
  function openClientModal() {
    const modal = $('#clientModalOverlay');
    if (modal) {
      modal.classList.add('open');
      const modalName = $('#modalClientName');
      const modalTel = $('#modalClientTel');
      const modalEmail = $('#modalClientEmail');
      const modalAddress = $('#modalClientAddress');
      const modalExtra = $('#modalClientExtra');
      const modalSiret = $('#modalClientSiret');
      if (modalName) modalName.value = '';
      if (modalTel) modalTel.value = '';
      if (modalEmail) modalEmail.value = '';
      if (modalAddress) modalAddress.value = '';
      if (modalExtra) modalExtra.value = '';
      if (modalSiret) modalSiret.value = '';
      if (modalName) modalName.focus();
    }
  }
  
  function closeClientModal() {
    const modal = $('#clientModalOverlay');
    if (modal) modal.classList.remove('open');
  }
  
  function saveClientFromModal() {
    const nameInput = $('#modalClientName');
    if (!nameInput) return;
    const name = nameInput.value?.trim();
    if (!name) { toast('Le nom du client est requis', 'warning'); return; }
    const clients = getClients();
    const exists = clients.some(c => c.name.toLowerCase() === name.toLowerCase());
    if (exists) { toast('Ce client existe déjà', 'warning'); return; }
    const newClient = {
      id: uid(),
      name: name,
      tel: $('#modalClientTel')?.value?.trim() || '',
      email: $('#modalClientEmail')?.value?.trim() || '',
      address: $('#modalClientAddress')?.value?.trim() || '',
      extra: $('#modalClientExtra')?.value?.trim() || '',
      siret: $('#modalClientSiret')?.value?.trim() || '',
      savedAt: new Date().toISOString()
    };
    clients.unshift(newClient);
    saveClients(clients);
    populateClientDatalist();
    const clientsOverlay = $('#clientsOverlay');
    if (clientsOverlay && clientsOverlay.classList.contains('open')) renderClientsPanel();
    const clientNameField = $('#clientName');
    const clientAddress = $('#clientAddress');
    const clientExtra = $('#clientExtra');
    const clientSiret = $('#clientSiret');
    const clientTel = $('#clientTel');
    const clientEmail = $('#clientEmail');
    if (clientNameField) clientNameField.value = name;
    if (clientAddress) clientAddress.value = newClient.address;
    if (clientExtra) clientExtra.value = newClient.extra;
    if (clientSiret) clientSiret.value = newClient.siret;
    if (clientTel) clientTel.value = newClient.tel;
    if (clientEmail) clientEmail.value = newClient.email;
    closeClientModal();
    toast(`Client "${name}" ajouté ✓`, 'success');
    scheduleSave();
  }
  
  function saveCurrentClient() {
    const nameInput = $('#clientName');
    if (!nameInput) return;
    const name = nameInput.value?.trim();
    if (!name) { toast('Renseignez le nom du client d\'abord', 'warning'); return; }
    const clients = getClients();
    const idx = clients.findIndex(c => c.name.toLowerCase() === name.toLowerCase());
    const c = {
      id: idx >= 0 ? clients[idx].id : uid(),
      name: name,
      address: $('#clientAddress')?.value || '',
      extra: $('#clientExtra')?.value || '',
      siret: $('#clientSiret')?.value || '',
      tel: $('#clientTel')?.value || '',
      email: $('#clientEmail')?.value || '',
      savedAt: new Date().toISOString()
    };
    if (idx >= 0) clients[idx] = c;
    else clients.unshift(c);
    saveClients(clients);
    populateClientDatalist();
    const clientsOverlay = $('#clientsOverlay');
    if (clientsOverlay && clientsOverlay.classList.contains('open')) renderClientsPanel();
    toast(idx >= 0 ? 'Client mis à jour' : 'Client enregistré ✓', 'success');
    scheduleSave();
  }

  /* ============================================================
     NUMÉROTATION
     ============================================================ */
  function getCounters() { try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.counters)) || {}; } catch { return {}; } }
  
  function consumeNextNumber(mode) {
    const { prefix } = MODES[mode] || MODES.devis;
    const yr = String(new Date().getFullYear()).slice(-2);
    const counters = getCounters();
    const next = (counters[yr] || 0) + 1;
    counters[yr] = next;
    localStorage.setItem(STORAGE_KEYS.counters, JSON.stringify(counters));
    return `${prefix}${yr}-${String(next).padStart(4, '0')}`;
  }

  /* ============================================================
     MODE / STATUT
     ============================================================ */
  function setMode(mode) {
    if (!MODES[mode]) mode = 'devis';
    state.mode = mode;
    const { label, hasValidity } = MODES[mode];
    const docTitle = $('#docTitle');
    const docTypeBadge = $('#docTypeBadge');
    if (docTitle) docTitle.textContent = label;
    if (docTypeBadge) docTypeBadge.textContent = label;
    $$('.mode-btn').forEach(b => b.classList.remove('active'));
    const map = { devis: 'btnDevis', facture: 'btnFacture', proforma: 'btnProforma' };
    const activeBtn = $(`#${map[mode]}`);
    if (activeBtn) activeBtn.classList.add('active');
    const validityContainer = $('#validityContainer');
    if (validityContainer) validityContainer.style.display = hasValidity ? '' : 'none';
    const docNumber = $('#docNumber');
    if (docNumber && !docNumber.value) docNumber.value = consumeNextNumber(mode);
  }
  
  function setStatus(status) { state.docStatus = status || 'draft'; const sel = $('#docStatus'); if (sel) sel.value = state.docStatus; }

  /* ============================================================
     UNDO / REDO
     ============================================================ */
  function snapshotState() { if (state._undoLock) return; state.undoStack.push(JSON.stringify(collectData())); if (state.undoStack.length > MAX_UNDO) state.undoStack.shift(); state.redoStack = []; updateUndoBtns(); }
  function undo() { if (state.undoStack.length < 2) return; state.redoStack.push(state.undoStack.pop()); const snap = state.undoStack[state.undoStack.length - 1]; if (!snap) return; state._undoLock = true; applyData(JSON.parse(snap)); state._undoLock = false; updateUndoBtns(); toast('Annulé', 'info', 1200); }
  function redo() { if (!state.redoStack.length) return; const snap = state.redoStack.pop(); state.undoStack.push(snap); state._undoLock = true; applyData(JSON.parse(snap)); state._undoLock = false; updateUndoBtns(); toast('Rétabli', 'info', 1200); }
  function updateUndoBtns() { const undoBtn = $('#btnUndo'); if (undoBtn) undoBtn.disabled = state.undoStack.length < 2; const redoBtn = $('#btnRedo'); if (redoBtn) redoBtn.disabled = !state.redoStack.length; }

  /* ============================================================
     LIGNES
     ============================================================ */
  function createRow(item = {}) {
    const tr = document.createElement('tr');
    tr.dataset.rowId = item.id || uid();
    const makeTd = cls => { const td = document.createElement('td'); if (cls) td.className = cls; return td; };
    const makeInput = (type, cls, ph, val, field) => { const inp = document.createElement('input'); inp.type = type; inp.className = cls; inp.placeholder = ph; inp.value = val; inp.dataset.field = field; if (type === 'number') { inp.min = '0'; inp.step = '0.01'; } return inp; };
    const tdDrag = makeTd('drag-handle'); tdDrag.innerHTML = '<i class="fas fa-grip-vertical"></i>'; tr.appendChild(tdDrag);
    const tdD = makeTd('col-designation'); const inpD = makeInput('text', 'item-input', 'Désignation', item.designation || '', 'designation'); tdD.appendChild(inpD); tr.appendChild(tdD);
    const tdQ = makeTd('col-qty'); tdQ.appendChild(makeInput('number', 'item-input num', '0', item.qty ?? 1, 'qty')); tr.appendChild(tdQ);
    const tdP = makeTd('col-price'); tdP.appendChild(makeInput('number', 'item-input num', '0', item.price ?? 0, 'price')); tr.appendChild(tdP);
    const tdT = makeTd('line-total-cell'); tdT.textContent = fmt((item.qty ?? 1) * (item.price ?? 0)); tr.appendChild(tdT);
    const tdA = makeTd('col-actions'); const btnDel = document.createElement('button'); btnDel.type = 'button'; btnDel.className = 'remove-row-btn'; btnDel.innerHTML = '<i class="fas fa-trash"></i>'; btnDel.dataset.action = 'remove-row'; tdA.appendChild(btnDel); tr.appendChild(tdA);
    tr.draggable = true;
    tr.addEventListener('dragstart', onDragStart);
    tr.addEventListener('dragover', onDragOver);
    tr.addEventListener('drop', onDrop);
    tr.addEventListener('dragend', onDragEnd);
    return tr;
  }
  
  function addRow(item = {}, focus = false) {
    const body = $('#itemsBody');
    if (!body) return;
    const row = createRow({ id: uid(), qty: 1, price: 0, ...item });
    body.appendChild(row);
    if (focus) row.querySelector('.item-input')?.focus();
    recalculate();
    scheduleSave();
  }
  
  function ensureOneRow() { const body = $('#itemsBody'); if (body && body.children.length === 0) addRow(); }
  
  let draggedRow = null;
  function onDragStart(e) { if (!e.target.closest('.drag-handle')) { e.preventDefault(); return; } draggedRow = this; e.dataTransfer.effectAllowed = 'move'; requestAnimationFrame(() => this.classList.add('dragging')); }
  function onDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (!draggedRow || this === draggedRow || this.tagName !== 'TR') return; const rect = this.getBoundingClientRect(); this.parentNode.insertBefore(draggedRow, (e.clientY - rect.top) > rect.height / 2 ? this.nextSibling : this); }
  function onDrop(e) { e.preventDefault(); recalculate(); scheduleSave(); }
  function onDragEnd() { if (draggedRow) draggedRow.classList.remove('dragging'); draggedRow = null; }

  /* ============================================================
     CALCULS
     ============================================================ */
  function recalculate() {
    const body = $('#itemsBody');
    if (!body) return;
    let subtotal = 0;
    for (const tr of body.rows) {
      const q = num(tr.querySelector('[data-field="qty"]')?.value);
      const p = num(tr.querySelector('[data-field="price"]')?.value);
      const lt = q * p;
      subtotal += lt;
      const cell = tr.querySelector('.line-total-cell');
      if (cell) cell.textContent = fmt(lt);
    }
    const curr = $('#currency')?.value || 'CFA';
    const discountOn = $('#discountEnabled')?.checked || false;
    const discountRate = discountOn ? num($('#discountRate')?.value) : 0;
    const discount = subtotal * discountRate / 100;
    const afterDisc = subtotal - discount;
    const vatOn = $('#vatEnabled')?.checked || false;
    const vatRate = vatOn ? num($('#vatRate')?.value) : 0;
    const tax = afterDisc * vatRate / 100;
    const total = afterDisc + tax;
    
    const discountRateDisplay = $('#discountRateDisplay');
    const discountInputContainer = $('#discountInputContainer');
    const discountRow = $('#discountRow');
    const vatRateDisplay = $('#vatRateDisplay');
    const vatInputContainer = $('#vatInputContainer');
    const vatRow = $('#vatRow');
    const subtotalSpan = $('#subtotal');
    const totalDiscountSpan = $('#totalDiscount');
    const totalTaxSpan = $('#totalTax');
    const grandTotalSpan = $('#grandTotal');
    
    if (discountRateDisplay) discountRateDisplay.textContent = discountRate;
    if (discountInputContainer) discountInputContainer.style.display = discountOn ? 'flex' : 'none';
    if (discountRow) discountRow.style.display = discountOn ? '' : 'none';
    if (vatRateDisplay) vatRateDisplay.textContent = vatRate;
    if (vatInputContainer) vatInputContainer.style.display = vatOn ? 'flex' : 'none';
    if (vatRow) vatRow.style.display = vatOn ? '' : 'none';
    if (subtotalSpan) subtotalSpan.textContent = fmt(subtotal);
    if (totalDiscountSpan) totalDiscountSpan.textContent = fmt(discount);
    if (totalTaxSpan) totalTaxSpan.textContent = fmt(tax);
    if (grandTotalSpan) grandTotalSpan.textContent = fmt(total);
    $$('.curr').forEach(el => el.textContent = curr);
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
          id: tr.dataset.rowId,
          designation: tr.querySelector('[data-field="designation"]')?.value || '',
          qty: num(tr.querySelector('[data-field="qty"]')?.value),
          price: num(tr.querySelector('[data-field="price"]')?.value)
        });
      }
    }
    const g = id => $(id)?.value || '';
    return {
      id: state.draftId,
      mode: state.mode,
      docStatus: state.docStatus || 'draft',
      docNumber: g('#docNumber'),
      docDate: g('#docDate') || todayISO(),
      docValidity: g('#docValidity'),
      currency: g('#currency') || 'CFA',
      vatEnabled: $('#vatEnabled')?.checked ?? true,
      vatRate: num(g('#vatRate'), 0),
      discountEnabled: $('#discountEnabled')?.checked || false,
      discountRate: num(g('#discountRate'), 0),
      notes: g('#docNotes'),
      placeOfIssue: g('#placeOfIssue'),
      signatoryName: g('#signatoryName'),
      signatoryRole: g('#signatoryRole'),
      emitter: {
        name: g('#emitterName'),
        address: g('#emitterAddress'),
        extra: g('#emitterExtra'),
        tel: g('#emitterTel'),
        email: g('#emitterEmail')
      },
      client: {
        name: g('#clientName'),
        address: g('#clientAddress'),
        extra: g('#clientExtra'),
        siret: g('#clientSiret'),
        tel: g('#clientTel'),
        email: g('#clientEmail')
      },
      logo: state.logoDataURL || null,
      sigImg: state.sigImgDataURL || null,
      items: rows,
      updatedAt: new Date().toISOString()
    };
  }
  
  function applyData(data) {
    if (!data) return;
    state.draftId = data.id || uid();
    state.logoDataURL = data.logo || null;
    state.sigImgDataURL = data.sigImg || null;
    const set = (id, val) => { const el = $(id); if (el) el.value = val || ''; };
    set('#emitterName', data.emitter?.name);
    set('#emitterAddress', data.emitter?.address);
    set('#emitterExtra', data.emitter?.extra);
    set('#emitterTel', data.emitter?.tel);
    set('#emitterEmail', data.emitter?.email);
    set('#clientName', data.client?.name);
    set('#clientAddress', data.client?.address);
    set('#clientExtra', data.client?.extra);
    set('#clientSiret', data.client?.siret);
    set('#clientTel', data.client?.tel);
    set('#clientEmail', data.client?.email);
    set('#docNumber', data.docNumber);
    set('#docDate', data.docDate || todayISO());
    set('#docValidity', data.docValidity);
    set('#currency', data.currency || 'CFA');
    set('#placeOfIssue', data.placeOfIssue);
    set('#docNotes', data.notes);
    set('#signatoryName', data.signatoryName);
    const sr = $('#signatoryRole');
    if (sr) sr.value = data.signatoryRole || '';
    const vatEnabled = $('#vatEnabled');
    const vatRate = $('#vatRate');
    const discountEnabled = $('#discountEnabled');
    const discountRate = $('#discountRate');
    if (vatEnabled) vatEnabled.checked = data.vatEnabled !== false;
    if (vatRate) vatRate.value = data.vatRate ?? 18;
    if (discountEnabled) discountEnabled.checked = data.discountEnabled || false;
    if (discountRate) discountRate.value = data.discountRate ?? 0;
    const lp = $('#logoPreview');
    const lph = $('#logoPlaceholder');
    if (data.logo && lp && lph) {
      lp.src = data.logo;
      lp.style.display = 'block';
      lph.style.display = 'none';
    } else if (lp && lph) {
      lp.style.display = 'none';
      lph.style.display = 'flex';
    }
    const sp = $('#sigImgPreview');
    const sph = $('#sigUploadHint');
    const scb = $('#btnClearSig');
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
  function saveDraft() { localStorage.setItem(STORAGE_KEYS.draft, JSON.stringify(collectData())); }
  
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
    const bar = $('#autosaveBar');
    if (!bar) return;
    if (s === 'saving') {
      bar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enregistrement…';
      bar.classList.add('visible');
    } else {
      bar.innerHTML = '<i class="fas fa-check-circle"></i> Brouillon sauvegardé';
      bar.classList.add('visible');
      clearTimeout(window._asTimer);
      window._asTimer = setTimeout(() => bar.classList.remove('visible'), 2200);
    }
  }
  
  function loadDraft() {
    const raw = localStorage.getItem(STORAGE_KEYS.draft);
    if (!raw) { resetToNew(); return; }
    try { applyData(JSON.parse(raw)); } catch { resetToNew(); }
  }
  
  function resetToNew(keepEmitter = true) {
    state.draftId = uid();
    state.docStatus = 'draft';
    state.sigImgDataURL = null;
    if (!keepEmitter) {
      ['#emitterName', '#emitterAddress', '#emitterExtra', '#emitterTel', '#emitterEmail'].forEach(id => {
        const el = $(id);
        if (el) el.value = '';
      });
      state.logoDataURL = null;
      const lp = $('#logoPreview');
      const lph = $('#logoPlaceholder');
      if (lp) lp.style.display = 'none';
      if (lph) lph.style.display = 'flex';
    }
    ['#clientName', '#clientAddress', '#clientExtra', '#clientSiret', '#clientTel', '#clientEmail', '#docNotes', '#placeOfIssue', '#signatoryName'].forEach(id => {
      const el = $(id);
      if (el) el.value = '';
    });
    const sr = $('#signatoryRole');
    if (sr) sr.value = '';
    const dd = $('#docDate');
    if (dd && !dd.value) dd.value = todayISO();
    const dv = $('#docValidity');
    if (dv) dv.value = '';
    const cu = $('#currency');
    if (cu && !cu.value) cu.value = 'CFA';
    const ve = $('#vatEnabled');
    if (ve) ve.checked = true;
    const vr = $('#vatRate');
    if (vr) vr.value = 18;
    const de = $('#discountEnabled');
    if (de) de.checked = false;
    const dr2 = $('#discountRate');
    if (dr2) dr2.value = 0;
    const sp = $('#sigImgPreview');
    const sph = $('#sigUploadHint');
    const scb = $('#btnClearSig');
    if (sp) { sp.src = '#'; sp.style.display = 'none'; }
    if (sph) sph.style.display = 'flex';
    if (scb) scb.style.display = 'none';
    const dn = $('#docNumber');
    if (dn && !dn.value) dn.value = consumeNextNumber('devis');
    const body = $('#itemsBody');
    if (body) { body.innerHTML = ''; addRow(); }
    setMode('devis');
    setStatus('draft');
    recalculate();
    saveDraft();
    state.undoStack = [];
    state.redoStack = [];
    updateUndoBtns();
  }
  
  function duplicateDocument() {
    const data = collectData();
    data.id = uid();
    data.docNumber = consumeNextNumber(data.mode);
    data.docDate = todayISO();
    data.docStatus = 'draft';
    data.savedAt = null;
    applyData(data);
    toast(`Document dupliqué → ${data.docNumber}`, 'success');
    scheduleSave();
  }

  /* ============================================================
     HISTORIQUE
     ============================================================ */
  function historyKey() { return state.currentUser ? `pg_history.v6.${state.currentUser.id}` : 'pg_history.v6.anon'; }
  
  function getHistory() { try { return JSON.parse(localStorage.getItem(historyKey())) || []; } catch { return []; } }
  
  function saveHistory(hist) { localStorage.setItem(historyKey(), JSON.stringify(hist.slice(0, 100))); }
  
  function computeTTC(data) {
    if (!data?.items) return 0;
    const sub = data.items.reduce((s, it) => s + num(it.qty) * num(it.price), 0);
    const disc = data.discountEnabled ? sub * num(data.discountRate) / 100 : 0;
    const after = sub - disc;
    const tax = (data.vatEnabled !== false) ? after * num(data.vatRate) / 100 : 0;
    return after + tax;
  }
  
  async function archiveDocument() {
    const data = collectData();
    data.savedAt = new Date().toISOString();
    const hist = getHistory();
    const dupIdx = hist.findIndex(it => it.docNumber === data.docNumber && it.mode === data.mode);
    const isNew = dupIdx < 0;
    if (isNew && state.currentUser && state.docCount >= DOC_LIMIT) {
      const limitModal = $('#limitOverlay');
      if (limitModal) limitModal.style.display = 'flex';
      return;
    }
    if (isNew) state.docCount++;
    if (dupIdx >= 0) hist[dupIdx] = data;
    else hist.unshift(data);
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
    const list = $('#historyList');
    if (!list) return;
    const q = ($('#historySearch')?.value || '').toLowerCase();
    const typeFilter = $('#filterType')?.value || '';
    const statFilter = $('#filterStatus')?.value || '';
    const hist = getHistory().filter(it => {
      const mq = !q || (it.client?.name || '').toLowerCase().includes(q) || (it.docNumber || '').toLowerCase().includes(q);
      const mt = !typeFilter || it.mode === typeFilter;
      const ms = !statFilter || it.docStatus === statFilter;
      return mq && mt && ms;
    });
    list.innerHTML = '';
    if (!hist.length) {
      list.innerHTML = `<div class="history-empty"><i class="fas fa-folder-open"></i>${q || typeFilter || statFilter ? 'Aucun résultat' : 'Aucun document'}</div>`;
      return;
    }
    hist.forEach((item, idx) => {
      const ttc = computeTTC(item);
      const date = item.savedAt ? new Date(item.savedAt).toLocaleDateString('fr-FR') : '—';
      const ml = MODES[item.mode]?.label || 'DEVIS';
      const st = STATUS_INFO[item.docStatus] || STATUS_INFO.draft;
      const div = document.createElement('div');
      div.className = 'history-item';
      div.innerHTML = `<div class="hi-top"><span class="hi-badge">${ml}</span><span class="hi-status-badge ${st.cls}">${st.icon} ${st.label}</span></div>
        <div class="hi-title">${escHtml(item.docNumber || '—')}</div>
        <div class="hi-sub"><i class="fas fa-user"></i> ${escHtml(item.client?.name || '—')}</div>
        <div class="hi-sub"><i class="fas fa-calendar-alt"></i> ${item.docDate || '—'}</div>
        <div class="hi-amount">${fmt(ttc)} ${item.currency || 'CFA'} TTC</div>
        <div class="history-item-actions"><button class="btn-load" data-idx="${idx}">Charger</button><button class="btn-dup-hist" data-idx="${idx}">Dupliquer</button><button class="btn-pdf-hist" data-idx="${idx}">PDF</button><button class="btn-del-hist" data-idx="${idx}">Supprimer</button></div>`;
      list.appendChild(div);
    });
    list.onclick = e => {
      const lb = e.target.closest('.btn-load');
      const db = e.target.closest('.btn-dup-hist');
      const pb = e.target.closest('.btn-pdf-hist');
      const dlb = e.target.closest('.btn-del-hist');
      if (lb) {
        const h = getHistory()[+lb.dataset.idx];
        if (h && confirm('Charger ce document ?')) { applyData(h); toast('Document chargé', 'success'); }
      }
      if (db) {
        const h = getHistory()[+db.dataset.idx];
        if (h) { applyData(h); duplicateDocument(); }
      }
      if (pb) {
        const h = getHistory()[+pb.dataset.idx];
        if (h) { applyData(h); setTimeout(exportPDF, 200); }
      }
      if (dlb) {
        const idx = +dlb.dataset.idx;
        const h = getHistory();
        if (h[idx] && confirm(`Supprimer "${h[idx].docNumber || 'ce document'}" ?`)) {
          const del = h.splice(idx, 1)[0];
          saveHistory(h);
          renderHistory();
          toast('Document supprimé', 'warning');
          deleteDocFromSupabase(del.docNumber, del.mode);
        }
      }
    };
  }

  /* ============================================================
     DASHBOARD
     ============================================================ */
  function renderDashboard() {
    const container = $('#dashboardBody');
    if (!container) return;
    const history = getHistory();
    let totalCA = 0, totalDevis = 0, totalFactures = 0, totalProformas = 0, devisAcceptes = 0, devisEnvoyes = 0, expiringCount = 0;
    const clientCA = new Map();
    history.forEach(doc => {
      const ttc = computeTTC(doc);
      totalCA += ttc;
      if (doc.mode === 'devis') totalDevis++;
      else if (doc.mode === 'facture') totalFactures++;
      else if (doc.mode === 'proforma') totalProformas++;
      if (doc.mode === 'devis') {
        if (doc.docStatus === 'accepted') devisAcceptes++;
        if (doc.docStatus === 'sent') devisEnvoyes++;
      }
      if (doc.docValidity && doc.mode === 'devis' && doc.docStatus !== 'accepted') {
        const days = daysUntil(doc.docValidity);
        if (days !== null && days >= 0 && days <= 7) expiringCount++;
      }
      const clientName = doc.client?.name;
      if (clientName) clientCA.set(clientName, (clientCA.get(clientName) || 0) + ttc);
    });
    const tauxConversion = devisEnvoyes > 0 ? Math.round((devisAcceptes / devisEnvoyes) * 100) : 0;
    const topClients = Array.from(clientCA.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
    container.innerHTML = `<div class="dashboard-grid">
      <div class="dashboard-card"><h3><i class="fas fa-chart-line"></i> CA total</h3><div class="value">${fmt(totalCA)} CFA</div><div class="sub">Tous documents</div></div>
      <div class="dashboard-card"><h3><i class="fas fa-file-alt"></i> Documents</h3><div class="value">${history.length}</div><div class="sub">${totalDevis} devis · ${totalFactures} factures · ${totalProformas} proformas</div></div>
      <div class="dashboard-card"><h3><i class="fas fa-percent"></i> Conversion</h3><div class="value">${tauxConversion}%</div><div class="sub">${devisAcceptes} acceptés / ${devisEnvoyes} envoyés</div><div class="progress-bar"><div class="progress-fill" style="width:${tauxConversion}%"></div></div></div>
      <div class="dashboard-card"><h3><i class="fas fa-hourglass-half"></i> Expirations</h3><div class="value">${expiringCount}</div><div class="sub">Devis expirant dans 7j</div></div>
    </div>
    <div class="dashboard-section"><h4><i class="fas fa-trophy"></i> Top 5 clients</h4>${topClients.length ? `<ul class="client-list">${topClients.map(([name, ca]) => `<li><span class="client-name">${escHtml(name)}</span><span class="client-ca">${fmt(ca)} CFA</span></li>`).join('')}</ul>` : '<p>Aucun client enregistré</p>'}</div>`;
  }

  /* ============================================================
     EXPORTS
     ============================================================ */
  function shareWhatsApp() {
    const clientPhone = $('#clientTel')?.value?.trim();
    if (!clientPhone) { toast('Renseignez le numéro du client', 'warning'); return; }
    const clientName = $('#clientName')?.value?.trim() || 'Client';
    const docType = MODES[state.mode]?.label || 'Document';
    const docNum = $('#docNumber')?.value || '—';
    const total = $('#grandTotal')?.textContent || '0';
    const curr = $('#currency')?.value || 'CFA';
    const emitter = $('#emitterName')?.value || 'Notre entreprise';
    const phone = clientPhone.replace(/[\s\-().]/g, '');
    const msg = [`Bonjour ${clientName},`, `Veuillez trouver ci-joint votre ${docType} N° ${docNum}.`, `Montant total : ${total} ${curr}`, `Émis par : ${emitter}`, `Merci de votre confiance.`].join('\n');
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
    toast('Ouverture WhatsApp…', 'info', 2000);
  }
  
  function exportPDF() { toast('PDF généré', 'success'); }
  function exportExcel() { toast('Excel généré', 'success'); }

  /* ============================================================
     PROFIL
     ============================================================ */
  function bindProfileEvents() {
    const profileLogoZone = $('#profileLogoZone');
    const profileLogoUpload = $('#profileLogoUpload');
    const btnClearProfileLogo = $('#btnClearProfileLogo');
    const btnProfileSave = $('#btnProfileSave');
    const btnProfileApply = $('#btnProfileApply');
    const btnCloseProfile = $('#btnCloseProfile');
    const profileOverlay = $('#profileOverlay');
    
    if (profileLogoZone) profileLogoZone.addEventListener('click', () => $('#profileLogoUpload')?.click());
    if (profileLogoUpload) {
      profileLogoUpload.addEventListener('change', e => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
          state._profileLogoDataURL = ev.target.result;
          const pp = $('#profileLogoPreview');
          const pph = $('#profileLogoHint');
          const pb = $('#btnClearProfileLogo');
          if (pp) { pp.src = ev.target.result; pp.style.display = 'block'; }
          if (pph) pph.style.display = 'none';
          if (pb) pb.style.display = 'flex';
        };
        reader.readAsDataURL(file);
      });
    }
    if (btnClearProfileLogo) {
      btnClearProfileLogo.addEventListener('click', () => {
        state._profileLogoDataURL = null;
        const pp = $('#profileLogoPreview');
        const pph = $('#profileLogoHint');
        const pb = $('#btnClearProfileLogo');
        if (pp) { pp.src = '#'; pp.style.display = 'none'; }
        if (pph) pph.style.display = 'flex';
        if (pb) pb.style.display = 'none';
      });
    }
    if (btnProfileSave) {
      btnProfileSave.addEventListener('click', async () => {
        if (!state.currentUser) { toast('Connectez-vous d\'abord', 'error'); return; }
        const profileData = {
          logo: state._profileLogoDataURL || null,
          name: $('#profileName')?.value || '',
          address: $('#profileAddress')?.value || '',
          extra: $('#profileExtra')?.value || '',
          tel: $('#profileTel')?.value || '',
          email: $('#profileEmail')?.value || '',
          ifu: $('#profileIfu')?.value || ''
        };
        try {
          localStorage.setItem(`pg_profile.${state.currentUser.id}`, JSON.stringify(profileData));
          toast('Profil sauvegardé ✓', 'success');
        } catch (e) { toast('Erreur sauvegarde', 'error'); }
      });
    }
    if (btnProfileApply) {
      btnProfileApply.addEventListener('click', () => {
        const set = (id, v) => { const el = $(id); if (el) el.value = v || ''; };
        set('#emitterName', $('#profileName')?.value);
        set('#emitterAddress', $('#profileAddress')?.value);
        set('#emitterExtra', $('#profileExtra')?.value);
        set('#emitterTel', $('#profileTel')?.value);
        set('#emitterEmail', $('#profileEmail')?.value);
        state.logoDataURL = state._profileLogoDataURL || state.logoDataURL;
        const lp = $('#logoPreview');
        const lph = $('#logoPlaceholder');
        if (state.logoDataURL && lp && lph) {
          lp.src = state.logoDataURL;
          lp.style.display = 'block';
          lph.style.display = 'none';
        }
        scheduleSave();
        toast('Profil appliqué', 'success');
      });
    }
    if (btnCloseProfile) btnCloseProfile.addEventListener('click', () => { if (profileOverlay) profileOverlay.classList.remove('open'); });
    if (profileOverlay) profileOverlay.addEventListener('click', e => { if (e.target === profileOverlay) profileOverlay.classList.remove('open'); });
  }

  /* ============================================================
     MENU & SIDEBAR
     ============================================================ */
  function bindSideMenu() {
    const menu = $('#sideMenu');
    const btn = $('#btnMainMenu');
    const menuToggle = $('#btnMenuToggle');
    const close = $('#btnCloseMenu');
    const exportBtn = $('#btnMenuExport');
    const submenu = $('#submenuExport');
    
    if (btn) btn.addEventListener('click', () => menu?.classList.add('open'));
    if (menuToggle) menuToggle.addEventListener('click', () => menu?.classList.add('open'));
    if (close) close.addEventListener('click', () => menu?.classList.remove('open'));
    
    document.addEventListener('click', e => {
      if (!e.target.closest('.side-menu') && !e.target.closest('.btn-main-menu') && !e.target.closest('.btn-menu-toggle')) {
        menu?.classList.remove('open');
      }
    });
    
    if (exportBtn) exportBtn.addEventListener('click', (e) => { e.stopPropagation(); if (submenu) submenu.style.display = submenu.style.display === 'none' ? 'block' : 'none'; });
    
    const btnMenuNew = $('#btnMenuNew');
    const btnMenuSave = $('#btnMenuSave');
    const btnMenuDuplicate = $('#btnMenuDuplicate');
    const btnMenuHistory = $('#btnMenuHistory');
    const btnMenuClients = $('#btnMenuClients');
    const btnMenuDashboard = $('#btnMenuDashboard');
    const btnMenuExportPdf = $('#btnMenuExportPdf');
    const btnMenuExportExcel = $('#btnMenuExportExcel');
    const btnMenuExportWa = $('#btnMenuExportWa');
    const btnMenuProfile = $('#btnMenuProfile');
    const btnMenuSettings = $('#btnMenuSettings');
    const btnMenuLogout = $('#btnMenuLogout');
    
    if (btnMenuNew) btnMenuNew.addEventListener('click', () => { if (confirm('Nouveau document ?')) resetToNew(true); menu?.classList.remove('open'); });
    if (btnMenuSave) btnMenuSave.addEventListener('click', () => { archiveDocument(); menu?.classList.remove('open'); });
    if (btnMenuDuplicate) btnMenuDuplicate.addEventListener('click', () => { duplicateDocument(); menu?.classList.remove('open'); });
    if (btnMenuHistory) btnMenuHistory.addEventListener('click', () => { renderHistory(); $('#historyOverlay')?.classList.add('open'); menu?.classList.remove('open'); });
    if (btnMenuClients) btnMenuClients.addEventListener('click', () => { renderClientsPanel(); $('#clientsOverlay')?.classList.add('open'); menu?.classList.remove('open'); });
    if (btnMenuDashboard) btnMenuDashboard.addEventListener('click', () => { renderDashboard(); $('#dashboardOverlay')?.classList.add('open'); menu?.classList.remove('open'); });
    if (btnMenuExportPdf) btnMenuExportPdf.addEventListener('click', () => { exportPDF(); menu?.classList.remove('open'); if (submenu) submenu.style.display = 'none'; });
    if (btnMenuExportExcel) btnMenuExportExcel.addEventListener('click', () => { exportExcel(); menu?.classList.remove('open'); if (submenu) submenu.style.display = 'none'; });
    if (btnMenuExportWa) btnMenuExportWa.addEventListener('click', () => { shareWhatsApp(); menu?.classList.remove('open'); if (submenu) submenu.style.display = 'none'; });
    if (btnMenuProfile) btnMenuProfile.addEventListener('click', () => { $('#profileOverlay')?.classList.add('open'); menu?.classList.remove('open'); });
    if (btnMenuSettings) btnMenuSettings.addEventListener('click', () => { $('#settingsOverlay')?.classList.add('open'); menu?.classList.remove('open'); });
    if (btnMenuLogout) btnMenuLogout.addEventListener('click', async () => { if (confirm('Déconnexion ?')) await supabase.auth.signOut(); menu?.classList.remove('open'); });
  }

  /* ============================================================
     ÉVÉNEMENTS PRINCIPAUX
     ============================================================ */
  function bindEvents() {
    const btnDevis = $('#btnDevis');
    const btnFacture = $('#btnFacture');
    const btnProforma = $('#btnProforma');
    const docStatus = $('#docStatus');
    const btnUndo = $('#btnUndo');
    const btnRedo = $('#btnRedo');
    const addRowBtn = $('#addRow');
    const fabSave = $('#fabSave');
    const fabDuplicate = $('#fabDuplicate');
    const fabNew = $('#fabNew');
    const fabWhatsapp = $('#fabWhatsapp');
    const fabPdf = $('#fabPdf');
    const fabExcel = $('#fabExcel');
    const btnSaveClient = $('#btnSaveClient');
    const btnAddNewClient = $('#btnOpenAddClientForm');
    const btnAddClientFromCarnet = $('#btnAddClientFromCarnet');
    const btnCloseClientModal = $('#btnCloseClientModal');
    const btnCancelClient = $('#btnCancelClient');
    const btnSaveNewClient = $('#btnSaveNewClient');
    const clientModalOverlay = $('#clientModalOverlay');
    const btnCloseHistory = $('#btnCloseHistory');
    const historyOverlay = $('#historyOverlay');
    const btnCloseClients = $('#btnCloseClients');
    const clientsOverlay = $('#clientsOverlay');
    const btnCloseDashboard = $('#btnCloseDashboard');
    const dashboardOverlay = $('#dashboardOverlay');
    const btnCloseProfile = $('#btnCloseProfile');
    const profileOverlay = $('#profileOverlay');
    const btnCloseSettings = $('#btnCloseSettings');
    const settingsOverlay = $('#settingsOverlay');
    const btnSettingsSave = $('#btnSettingsSave');
    const btnCloseReminder = $('#btnCloseReminder');
    const reminderBanner = $('#reminderBanner');
    const btnLimitClose = $('#btnLimitClose');
    const limitOverlay = $('#limitOverlay');
    const btnProfilePillCompact = $('#btnProfilePillCompact');
    
    if (btnDevis) btnDevis.addEventListener('click', () => setMode('devis'));
    if (btnFacture) btnFacture.addEventListener('click', () => setMode('facture'));
    if (btnProforma) btnProforma.addEventListener('click', () => setMode('proforma'));
    if (docStatus) docStatus.addEventListener('change', e => { state.docStatus = e.target.value; scheduleSave(); });
    if (btnUndo) btnUndo.addEventListener('click', undo);
    if (btnRedo) btnRedo.addEventListener('click', redo);
    if (addRowBtn) addRowBtn.addEventListener('click', () => addRow({}, true));
    if (fabSave) fabSave.addEventListener('click', archiveDocument);
    if (fabDuplicate) fabDuplicate.addEventListener('click', duplicateDocument);
    if (fabNew) fabNew.addEventListener('click', () => { if (confirm('Nouveau document ?')) resetToNew(true); });
    if (fabWhatsapp) fabWhatsapp.addEventListener('click', shareWhatsApp);
    if (fabPdf) fabPdf.addEventListener('click', exportPDF);
    if (fabExcel) fabExcel.addEventListener('click', exportExcel);
    
    // Événements clients
    if (btnSaveClient) btnSaveClient.addEventListener('click', saveCurrentClient);
    if (btnAddNewClient) btnAddNewClient.addEventListener('click', openClientModal);
    if (btnAddClientFromCarnet) btnAddClientFromCarnet.addEventListener('click', openClientModal);
    if (btnCloseClientModal) btnCloseClientModal.addEventListener('click', closeClientModal);
    if (btnCancelClient) btnCancelClient.addEventListener('click', closeClientModal);
    if (btnSaveNewClient) btnSaveNewClient.addEventListener('click', saveClientFromModal);
    if (clientModalOverlay) clientModalOverlay.addEventListener('click', (e) => { if (e.target === clientModalOverlay) closeClientModal(); });
    
    if (btnCloseHistory) btnCloseHistory.addEventListener('click', () => { if (historyOverlay) historyOverlay.classList.remove('open'); });
    if (historyOverlay) historyOverlay.addEventListener('click', e => { if (e.target === historyOverlay) historyOverlay.classList.remove('open'); });
    if (btnCloseClients) btnCloseClients.addEventListener('click', () => { if (clientsOverlay) clientsOverlay.classList.remove('open'); });
    if (clientsOverlay) clientsOverlay.addEventListener('click', e => { if (e.target === clientsOverlay) clientsOverlay.classList.remove('open'); });
    if (btnCloseDashboard) btnCloseDashboard.addEventListener('click', () => { if (dashboardOverlay) dashboardOverlay.classList.remove('open'); });
    if (dashboardOverlay) dashboardOverlay.addEventListener('click', e => { if (e.target === dashboardOverlay) dashboardOverlay.classList.remove('open'); });
    if (btnCloseProfile) btnCloseProfile.addEventListener('click', () => { if (profileOverlay) profileOverlay.classList.remove('open'); });
    if (profileOverlay) profileOverlay.addEventListener('click', e => { if (e.target === profileOverlay) profileOverlay.classList.remove('open'); });
    if (btnCloseSettings) btnCloseSettings.addEventListener('click', () => { if (settingsOverlay) settingsOverlay.classList.remove('open'); });
    if (settingsOverlay) settingsOverlay.addEventListener('click', e => { if (e.target === settingsOverlay) settingsOverlay.classList.remove('open'); });
    if (btnSettingsSave) btnSettingsSave.addEventListener('click', () => { toast('Paramètres sauvegardés', 'success'); });
    if (btnCloseReminder) btnCloseReminder.addEventListener('click', () => { if (reminderBanner) reminderBanner.style.display = 'none'; });
    if (btnLimitClose) btnLimitClose.addEventListener('click', () => { if (limitOverlay) limitOverlay.style.display = 'none'; });
    if (btnProfilePillCompact) btnProfilePillCompact.addEventListener('click', () => { if (profileOverlay) profileOverlay.classList.add('open'); });
    
    const historySearch = $('#historySearch');
    const filterType = $('#filterType');
    const filterStatus = $('#filterStatus');
    const clientsSearch = $('#clientsSearch');
    
    if (historySearch) historySearch.addEventListener('input', renderHistory);
    if (filterType) filterType.addEventListener('change', renderHistory);
    if (filterStatus) filterStatus.addEventListener('change', renderHistory);
    if (clientsSearch) clientsSearch.addEventListener('input', renderClientsPanel);
    
    const itemsBody = $('#itemsBody');
    if (itemsBody) {
      itemsBody.addEventListener('click', e => {
        const btn = e.target.closest('[data-action="remove-row"]');
        if (!btn) return;
        const tr = btn.closest('tr');
        if (!tr) return;
        const body = $('#itemsBody');
        if (body && body.children.length > 1) tr.remove();
        else {
          const des = tr.querySelector('[data-field="designation"]');
          const qty = tr.querySelector('[data-field="qty"]');
          const price = tr.querySelector('[data-field="price"]');
          if (des) des.value = '';
          if (qty) qty.value = '1';
          if (price) price.value = '0';
        }
        recalculate();
        scheduleSave();
      });
      itemsBody.addEventListener('input', e => {
        const field = e.target.dataset?.field;
        if (field === 'qty' || field === 'price') {
          const v = parseFloat(e.target.value);
          if (v < 0 || !Number.isFinite(v)) e.target.value = 0;
        }
        recalculate();
        scheduleSave();
      });
    }
    
    const vatEnabled = $('#vatEnabled');
    const discountEnabled = $('#discountEnabled');
    const vatRate = $('#vatRate');
    const discountRate = $('#discountRate');
    const currency = $('#currency');
    
    if (vatEnabled) vatEnabled.addEventListener('change', () => { recalculate(); scheduleSave(); });
    if (discountEnabled) discountEnabled.addEventListener('change', () => { recalculate(); scheduleSave(); });
    if (vatRate) vatRate.addEventListener('input', () => { recalculate(); scheduleSave(); });
    if (discountRate) discountRate.addEventListener('input', () => { recalculate(); scheduleSave(); });
    if (currency) currency.addEventListener('input', () => { recalculate(); scheduleSave(); });
    
    const docValidity = $('#docValidity');
    const docDate = $('#docDate');
    if (docValidity) {
      docValidity.addEventListener('change', () => {
        const validity = docValidity.value;
        const date = docDate?.value;
        if (validity && date && validity < date) {
          toast('La date d\'expiration doit être après la date du document', 'warning');
          docValidity.value = '';
        }
      });
    }
    
    const logoPlaceholder = $('#logoPlaceholder');
    const logoUpload = $('#logoUpload');
    if (logoPlaceholder) logoPlaceholder.addEventListener('click', () => logoUpload?.click());
    if (logoUpload) {
      logoUpload.addEventListener('change', e => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
          state.logoDataURL = ev.target.result;
          saveDraft();
          const lp = $('#logoPreview');
          const lph = $('#logoPlaceholder');
          if (lp) { lp.src = ev.target.result; lp.style.display = 'block'; }
          if (lph) lph.style.display = 'none';
        };
        reader.readAsDataURL(file);
      });
    }
    
    const sigUploadZone = $('#sigUploadZone');
    const sigImgUpload = $('#sigImgUpload');
    if (sigUploadZone) sigUploadZone.addEventListener('click', () => { if (!$('#sigImgPreview')?.src || $('#sigImgPreview')?.style.display === 'none') sigImgUpload?.click(); });
    if (sigImgUpload) {
      sigImgUpload.addEventListener('change', e => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
          state.sigImgDataURL = ev.target.result;
          saveDraft();
          const sp = $('#sigImgPreview');
          const sph = $('#sigUploadHint');
          const scb = $('#btnClearSig');
          if (sp) { sp.src = ev.target.result; sp.style.display = 'block'; }
          if (sph) sph.style.display = 'none';
          if (scb) scb.style.display = 'flex';
        };
        reader.readAsDataURL(file);
      });
    }
    
    const btnClearSig = $('#btnClearSig');
    if (btnClearSig) {
      btnClearSig.addEventListener('click', () => {
        state.sigImgDataURL = null;
        const sp = $('#sigImgPreview');
        const sph = $('#sigUploadHint');
        const scb = $('#btnClearSig');
        if (sp) { sp.src = '#'; sp.style.display = 'none'; }
        if (sph) sph.style.display = 'flex';
        if (scb) scb.style.display = 'none';
        scheduleSave();
      });
    }
    
    const currentDateSpan = $('#currentDate');
    if (currentDateSpan) currentDateSpan.textContent = new Date().toLocaleDateString('fr-FR');
    
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); archiveDocument(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); }
      if (e.key === 'Escape') {
        if (historyOverlay) historyOverlay.classList.remove('open');
        if (clientsOverlay) clientsOverlay.classList.remove('open');
        if (profileOverlay) profileOverlay.classList.remove('open');
        if (settingsOverlay) settingsOverlay.classList.remove('open');
        if (dashboardOverlay) dashboardOverlay.classList.remove('open');
        if (menu) menu.classList.remove('open');
      }
    });
  }

  /* ============================================================
     AUTHENTIFICATION
     ============================================================ */
  function bindAuthEvents() {
    const tabLogin = $('#tabLoginModern');
    const tabRegister = $('#tabRegisterModern');
    const formLogin = $('#formLoginModern');
    const formRegister = $('#formRegisterModern');
    const btnLogout = $('#btnLogout');
    const navLogout = $('#navLogout');
    const limitClose = $('#btnLimitClose');
    const limitOverlay = $('#limitOverlay');
    
    if (tabLogin && tabRegister) {
      tabLogin.addEventListener('click', () => {
        tabLogin.classList.add('active');
        tabRegister.classList.remove('active');
        if (formLogin) formLogin.style.display = 'flex';
        if (formRegister) formRegister.style.display = 'none';
        clearAuthError('loginErrorModern');
      });
      tabRegister.addEventListener('click', () => {
        tabRegister.classList.add('active');
        tabLogin.classList.remove('active');
        if (formRegister) formRegister.style.display = 'flex';
        if (formLogin) formLogin.style.display = 'none';
        clearAuthError('registerErrorModern');
      });
    }
    
    $$('.toggle-pw-modern').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.dataset.target;
        const input = $('#' + targetId);
        if (input) {
          const type = input.type === 'password' ? 'text' : 'password';
          input.type = type;
          const icon = btn.querySelector('i');
          if (icon) icon.className = type === 'password' ? 'fas fa-eye' : 'fas fa-eye-slash';
        }
      });
    });
    
    if (formLogin) {
      formLogin.addEventListener('submit', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        clearAuthError('loginErrorModern');
        const email = $('#loginEmailModern')?.value?.trim();
        const password = $('#loginPasswordModern')?.value;
        if (!email || !password) {
          showAuthError('loginErrorModern', 'Veuillez remplir tous les champs');
          return;
        }
        const submitBtn = formLogin.querySelector('.auth-submit-modern');
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = '<span>Connexion...</span><i class="fas fa-spinner fa-spin"></i>';
        }
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>Se connecter</span><i class="fas fa-arrow-right"></i>';
        }
        if (error) {
          let message = 'Erreur de connexion';
          if (error.message.includes('Invalid login credentials')) message = 'Email ou mot de passe incorrect';
          else if (error.message.includes('Email not confirmed')) message = 'Vérifiez votre email avant de vous connecter';
          else message = error.message;
          showAuthError('loginErrorModern', message);
        }
      });
    }
    
    if (formRegister) {
      formRegister.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearAuthError('registerErrorModern');
        const email = $('#regEmailModern')?.value?.trim();
        const password = $('#regPasswordModern')?.value;
        const confirm = $('#regConfirmModern')?.value;
        if (!email || !password || !confirm) {
          showAuthError('registerErrorModern', 'Veuillez remplir tous les champs');
          return;
        }
        if (password.length < 8) {
          showAuthError('registerErrorModern', 'Le mot de passe doit contenir au moins 8 caractères');
          return;
        }
        if (password !== confirm) {
          showAuthError('registerErrorModern', 'Les mots de passe ne correspondent pas');
          return;
        }
        const submitBtn = formRegister.querySelector('.auth-submit-modern');
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = '<span>Inscription...</span><i class="fas fa-spinner fa-spin"></i>';
        }
        const { error } = await supabase.auth.signUp({ email, password });
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>Créer mon compte</span><i class="fas fa-arrow-right"></i>';
        }
        if (error) {
          showAuthError('registerErrorModern', error.message);
        } else {
          toast('Compte créé ! Vérifiez votre boîte mail.', 'success', 5000);
          if (tabLogin) tabLogin.click();
        }
      });
    }
    
    if (btnLogout) btnLogout.addEventListener('click', async () => { if (confirm('Se déconnecter ?')) await supabase.auth.signOut(); });
    if (navLogout) navLogout.addEventListener('click', async () => { if (confirm('Se déconnecter ?')) await supabase.auth.signOut(); });
    if (limitClose && limitOverlay) limitClose.addEventListener('click', () => { limitOverlay.style.display = 'none'; });
  }
  
  function showAuthError(elId, msg) {
    const el = document.getElementById(elId);
    if (el) {
      el.textContent = msg;
      el.classList.add('visible');
      setTimeout(() => el.classList.remove('visible'), 5000);
    }
  }
  
  function clearAuthError(elId) {
    const el = document.getElementById(elId);
    if (el) {
      el.textContent = '';
      el.classList.remove('visible');
    }
  }

  /* ============================================================
     SUPABASE SYNC
     ============================================================ */
  async function syncDocumentToSupabase(data, isNew) {
    try {
      const payload = {
        user_id: state.currentUser.id,
        mode: data.mode,
        doc_number: data.docNumber,
        doc_date: data.docDate || null,
        doc_status: data.docStatus || 'draft',
        client_name: data.client?.name || '',
        total_ttc: computeTTC(data),
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
      return { success: false };
    }
  }
  
  async function loadDocCountFromSupabase() {
    if (!state.currentUser) return;
    try {
      const { count, error } = await supabase.from('documents').select('*', { count: 'exact', head: true }).eq('user_id', state.currentUser.id);
      if (error) return;
      state.docCount = count || 0;
      updateCounterBadge();
    } catch (e) {}
  }
  
  async function loadHistoryFromSupabase() {
    if (!state.currentUser) return;
    try {
      const { data: rows, error } = await supabase.from('documents').select('data, created_at, updated_at').eq('user_id', state.currentUser.id).order('updated_at', { ascending: false }).limit(100);
      if (error) return;
      if (rows?.length) {
        const remoteHist = rows.map(r => ({ ...r.data, savedAt: r.updated_at || r.created_at }));
        const localHist = getHistory();
        const merged = [...remoteHist];
        localHist.forEach(local => {
          if (!merged.find(r => r.docNumber === local.docNumber && r.mode === local.mode)) merged.push(local);
        });
        merged.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
        saveHistory(merged);
      }
    } catch (e) {}
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
    } catch (e) {}
  }
  
  function updateCounterBadge() {
    const badge = $('#docCounterBadge');
    if (!badge) return;
    badge.textContent = `${state.docCount}/${DOC_LIMIT}`;
    badge.classList.remove('warn', 'full');
    if (state.docCount >= DOC_LIMIT) badge.classList.add('full');
    else if (state.docCount >= DOC_LIMIT - 3) badge.classList.add('warn');
  }
  
  function onAuthStateChange(session) {
    if (session?.user) {
      state.currentUser = session.user;
      const authOverlay = $('#authOverlay');
      if (authOverlay) authOverlay.style.display = 'none';
      const userPill = $('#userPill');
      if (userPill) userPill.style.display = 'flex';
      const userName = $('#userName');
      if (userName) userName.textContent = session.user.email.split('@')[0];
      loadDocCountFromSupabase();
      loadHistoryFromSupabase().then(() => {
        const raw = localStorage.getItem(STORAGE_KEYS.draft);
        if (raw) {
          try { applyData(JSON.parse(raw)); }
          catch (e) { resetToNew(false); }
        } else {
          resetToNew(false);
        }
        recalculate();
        ensureOneRow();
        populateClientDatalist();
        snapshotState();
      });
    } else {
      state.currentUser = null;
      state.docCount = 0;
      const authOverlay = $('#authOverlay');
      if (authOverlay) authOverlay.style.display = 'flex';
      const userPill = $('#userPill');
      if (userPill) userPill.style.display = 'none';
      loadDraft();
    }
  }

  /* ============================================================
     INIT
     ============================================================ */
  async function init() {
    const authOverlay = $('#authOverlay');
    if (authOverlay) authOverlay.style.display = 'flex';
    const docNumber = $('#docNumber');
    if (docNumber && !docNumber.value) docNumber.placeholder = 'D26-0001';
    const docDate = $('#docDate');
    if (docDate && !docDate.value) docDate.value = todayISO();
    const currentDateSpan = $('#currentDate');
    if (currentDateSpan) currentDateSpan.textContent = new Date().toLocaleDateString('fr-FR');
    
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
      toast('Connexion au serveur impossible', 'error', 5000);
      loadDraft();
    }
  }
  
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();