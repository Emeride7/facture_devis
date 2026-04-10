/**
 * ProGestion — script principal
 * Corrections : double toast, opacity drag, compteur, @media CSS manquant,
 *               remise, notes, pro forma, validité, PDF amélioré.
 */
(function () {
  'use strict';

  /* ============================================================
     CONFIGURATION
     ============================================================ */
  const STORAGE_KEYS = {
    draft:    'pg_draft.v5',
    history:  'pg_history.v5',
    counters: 'pg_counters.v5'
  };

  const MODES = {
    devis:    { label: 'DEVIS',     prefix: 'D', hasValidity: true  },
    facture:  { label: 'FACTURE',   prefix: 'F', hasValidity: false },
    proforma: { label: 'PRO FORMA', prefix: 'P', hasValidity: true  }
  };

  /* ============================================================
     ÉTAT GLOBAL
     ============================================================ */
  const state = {
    mode:         'devis',
    logoDataURL:  null,
    draftId:      uid(),
    _saveTimer:   null,
    _autosaveTimer: null,
    draggedRow:   null
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

  /** Formater un montant entier avec espaces comme séparateur de milliers */
  function fmt(n) {
    const r = Math.round(Number(n) || 0);
    return r.toLocaleString('fr-FR');           // '1 234 567'
  }

  /** Valeur numérique sûre, ≥ min */
  function num(v, min = 0) {
    const x = parseFloat(v);
    return Number.isFinite(x) ? Math.max(min, x) : min;
  }

  function todayISO() {
    return new Date().toISOString().split('T')[0];
  }

  function localDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  /** Toast de notification
   *  @param {string} msg
   *  @param {'info'|'success'|'error'|'warning'} type
   *  @param {number} duration ms
   */
  function toast(msg, type = 'info', duration = 2800) {
    const el = $('#toast');
    if (!el) return;

    const colors = {
      success: '#14532d',
      error:   '#7f1d1d',
      warning: '#78350f',
      info:    'var(--primary)'
    };

    const icons = {
      success: '✅',
      error:   '❌',
      warning: '⚠️',
      info:    'ℹ️'
    };

    el.textContent = `${icons[type] || ''} ${msg}`;
    el.style.background = colors[type] || colors.info;
    el.classList.add('show');
    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => el.classList.remove('show'), duration);
  }

  /* ============================================================
     RÉFÉRENCES DOM
     ============================================================ */
  const R = {};
  const domMap = [
    'btnDevis','btnFacture','btnProforma',
    'btnHistory','btnArchive','btnNew','btnPdf','btnExcel',
    'btnCloseHistory','historyOverlay','historySearch','historyList',
    'itemsBody','addRow',
    'vatEnabled','vatRate','vatRateDisplay','vatRow','vatInputContainer',
    'discountEnabled','discountRate','discountRateDisplay','discountRow','discountInputContainer',
    'currency','docTitle','docNumber','docDate','docValidity',
    'emitterName','emitterAddress','emitterExtra','emitterTel','emitterEmail',
    'clientName','clientAddress','clientExtra','clientSiret','clientTel','clientEmail',
    'logoUpload','logoPreview','logoPlaceholder',
    'placeOfIssue','currentDate',
    'docNotes','validityContainer','autosaveBar'
  ];

  function cacheRefs() {
    domMap.forEach(id => { R[id] = document.getElementById(id); });
  }

  /* ============================================================
     NUMÉROTATION AUTOMATIQUE
     Séparation lecture (peek) / incrémentation (consume)
     → le compteur n'avance QUE lors de la création d'un nouveau doc
     ============================================================ */
  function peekNextNumber(mode) {
    const { prefix } = MODES[mode] || MODES.devis;
    const year = String(new Date().getFullYear()).slice(-2);
    const counters = getCounters();
    const key = `${mode}-${year}`;
    const next = (counters[key] || 0) + 1;
    return `${prefix}${year}-${String(next).padStart(4, '0')}`;
  }

  function consumeNextNumber(mode) {
    const { prefix } = MODES[mode] || MODES.devis;
    const year = String(new Date().getFullYear()).slice(-2);
    const counters = getCounters();
    const key = `${mode}-${year}`;
    const next = (counters[key] || 0) + 1;
    counters[key] = next;
    localStorage.setItem(STORAGE_KEYS.counters, JSON.stringify(counters));
    return `${prefix}${year}-${String(next).padStart(4, '0')}`;
  }

  function getCounters() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.counters)) || {}; }
    catch { return {}; }
  }

  /* ============================================================
     MODE DEVIS / FACTURE / PRO FORMA
     (ne génère PAS de nouveau numéro — seulement resetToNew le fait)
     ============================================================ */
  function setMode(mode) {
    if (!MODES[mode]) mode = 'devis';
    state.mode = mode;

    const { label, hasValidity } = MODES[mode];

    if (R.docTitle) R.docTitle.textContent = label;

    // Activer le bouton correspondant
    $$('.mode-btn').forEach(b => b.classList.remove('active'));
    const btnMap = { devis: 'btnDevis', facture: 'btnFacture', proforma: 'btnProforma' };
    R[btnMap[mode]]?.classList.add('active');

    // Afficher/masquer le champ "Validité"
    if (R.validityContainer) {
      R.validityContainer.style.display = hasValidity ? '' : 'none';
    }
  }

  /* ============================================================
     CRÉATION DE LIGNES DU TABLEAU
     ============================================================ */
  function createRow(item = {}) {
    const tr = document.createElement('tr');
    tr.dataset.rowId = item.id || uid();

    const makeTd = (cls = '') => {
      const td = document.createElement('td');
      if (cls) td.className = cls;
      return td;
    };

    const makeInput = (type, cls, placeholder, value, field) => {
      const inp = document.createElement('input');
      inp.type = type;
      inp.className = cls;
      inp.placeholder = placeholder;
      inp.value = value;
      inp.dataset.field = field;
      if (type === 'number') {
        inp.min = '0';
        inp.step = (field === 'qty') ? '1' : '1';
      }
      return inp;
    };

    // Poignée drag
    const tdDrag = makeTd('drag-handle');
    tdDrag.innerHTML = '<i class="fas fa-grip-vertical"></i>';
    tdDrag.setAttribute('title', 'Glisser pour réordonner');
    tr.appendChild(tdDrag);

    // Désignation
    const tdD = makeTd('col-designation');
    const inpD = makeInput('text', 'item-input', 'Désignation du produit/service', item.designation || '', 'designation');
    inpD.setAttribute('list', 'itemDatalist');
    tdD.appendChild(inpD);
    tr.appendChild(tdD);

    // Quantité
    const tdQ = makeTd('col-qty');
    tdQ.appendChild(makeInput('number', 'item-input num', '0', item.qty ?? 1, 'qty'));
    tr.appendChild(tdQ);

    // Prix unitaire
    const tdP = makeTd('col-price');
    tdP.appendChild(makeInput('number', 'item-input num', '0', item.price ?? 0, 'price'));
    tr.appendChild(tdP);

    // Total
    const tdT = makeTd('line-total-cell');
    tdT.textContent = fmt((item.qty ?? 1) * (item.price ?? 0));
    tr.appendChild(tdT);

    // Bouton supprimer
    const tdA = makeTd('col-actions');
    const btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.className = 'remove-row-btn';
    btnDel.innerHTML = '<i class="fas fa-trash"></i>';
    btnDel.dataset.action = 'remove-row';
    btnDel.title = 'Supprimer la ligne';
    tdA.appendChild(btnDel);
    tr.appendChild(tdA);

    // Drag & drop
    tr.draggable = true;
    tr.addEventListener('dragstart', onDragStart);
    tr.addEventListener('dragover',  onDragOver);
    tr.addEventListener('drop',      onDrop);
    tr.addEventListener('dragend',   onDragEnd);

    return tr;
  }

  function addRow(item = {}, focus = false) {
    const row = createRow({ id: uid(), qty: 1, price: 0, ...item });
    R.itemsBody.appendChild(row);
    if (focus) row.querySelector('.item-input')?.focus();
    recalculate();
    scheduleSave();
  }

  function ensureOneRow() {
    if (R.itemsBody && R.itemsBody.children.length === 0) addRow();
  }

  /* ============================================================
     DRAG & DROP
     Correction : opacity appliquée sur la ligne GLISSÉE, pas la cible
     ============================================================ */
  function onDragStart(e) {
    if (!e.target.closest('.drag-handle')) {
      e.preventDefault();
      return;
    }
    state.draggedRow = this;
    e.dataTransfer.effectAllowed = 'move';
    // Ajouter la classe sur la ligne glissée (pas la cible)
    requestAnimationFrame(() => this.classList.add('dragging'));
  }

  function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!state.draggedRow || this === state.draggedRow || this.tagName !== 'TR') return;
    const rect   = this.getBoundingClientRect();
    const isAfter = (e.clientY - rect.top) > rect.height / 2;
    this.parentNode.insertBefore(state.draggedRow, isAfter ? this.nextSibling : this);
  }

  function onDrop(e) {
    e.preventDefault();
    recalculate();
    scheduleSave();
  }

  function onDragEnd() {
    // Correction bug original : nettoyer la ligne GLISSÉE
    if (state.draggedRow) {
      state.draggedRow.classList.remove('dragging');
    }
    state.draggedRow = null;
  }

  /* ============================================================
     CALCULS
     ============================================================ */
  function getRowValues() {
    if (!R.itemsBody) return [];
    return Array.from(R.itemsBody.rows).map(tr => ({
      designation: tr.querySelector('[data-field="designation"]')?.value || '',
      qty:   num(tr.querySelector('[data-field="qty"]')?.value),
      price: num(tr.querySelector('[data-field="price"]')?.value),
      total: num(tr.querySelector('[data-field="qty"]')?.value)
             * num(tr.querySelector('[data-field="price"]')?.value)
    }));
  }

  function recalculate() {
    if (!R.itemsBody) return;

    let subtotal = 0;
    for (const tr of R.itemsBody.rows) {
      const q = num(tr.querySelector('[data-field="qty"]')?.value);
      const p = num(tr.querySelector('[data-field="price"]')?.value);
      const lineTotal = q * p;
      subtotal += lineTotal;
      const cell = tr.querySelector('.line-total-cell');
      if (cell) cell.textContent = fmt(lineTotal);
    }

    const curr = R.currency?.value || 'CFA';

    // Remise
    const discountOn   = R.discountEnabled?.checked || false;
    const discountRate = discountOn ? num(R.discountRate?.value) : 0;
    const discount     = subtotal * discountRate / 100;
    const afterDiscount = subtotal - discount;

    if (R.discountRateDisplay) R.discountRateDisplay.textContent = discountRate;
    if (R.discountInputContainer) {
      R.discountInputContainer.style.display = discountOn ? 'flex' : 'none';
    }
    if (R.discountRow) {
      R.discountRow.style.display = discountOn ? '' : 'none';
    }

    // TVA
    const vatOn   = R.vatEnabled?.checked || false;
    const vatRate = vatOn ? num(R.vatRate?.value) : 0;
    const tax     = afterDiscount * vatRate / 100;
    const total   = afterDiscount + tax;

    if (R.vatRateDisplay) R.vatRateDisplay.textContent = vatRate;
    if (R.vatInputContainer) {
      R.vatInputContainer.style.display = vatOn ? 'flex' : 'none';
    }
    if (R.vatRow) R.vatRow.style.display = vatOn ? '' : 'none';

    // Affichage
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = fmt(v); };
    set('subtotal',      subtotal);
    set('totalDiscount', discount);
    set('totalTax',      tax);
    set('grandTotal',    total);

    // Devise
    $$('.curr').forEach(el => { el.textContent = curr; });
  }

  /* ============================================================
     PERSISTANCE — Brouillon
     ============================================================ */
  function collectData() {
    const rows = [];
    if (R.itemsBody) {
      for (const tr of R.itemsBody.rows) {
        rows.push({
          id:          tr.dataset.rowId,
          designation: tr.querySelector('[data-field="designation"]')?.value || '',
          qty:         num(tr.querySelector('[data-field="qty"]')?.value),
          price:       num(tr.querySelector('[data-field="price"]')?.value)
        });
      }
    }

    return {
      id:         state.draftId,
      mode:       state.mode,
      docNumber:  R.docNumber?.value    || '',
      docDate:    R.docDate?.value      || todayISO(),
      docValidity: R.docValidity?.value || '',
      currency:   R.currency?.value     || 'CFA',
      vatEnabled: R.vatEnabled?.checked ?? true,
      vatRate:    num(R.vatRate?.value, 0),
      discountEnabled: R.discountEnabled?.checked || false,
      discountRate:    num(R.discountRate?.value, 0),
      notes:      R.docNotes?.value     || '',
      placeOfIssue: R.placeOfIssue?.value || '',
      emitter: {
        name:    R.emitterName?.value    || '',
        address: R.emitterAddress?.value || '',
        extra:   R.emitterExtra?.value   || '',
        tel:     R.emitterTel?.value     || '',
        email:   R.emitterEmail?.value   || ''
      },
      client: {
        name:    R.clientName?.value    || '',
        address: R.clientAddress?.value || '',
        extra:   R.clientExtra?.value   || '',
        siret:   R.clientSiret?.value   || '',
        tel:     R.clientTel?.value     || '',
        email:   R.clientEmail?.value   || ''
      },
      logo:  state.logoDataURL,
      items: rows,
      updatedAt: new Date().toISOString()
    };
  }

  function applyData(data) {
    if (!data) return;

    state.draftId    = data.id   || uid();
    state.logoDataURL = data.logo || null;

    const set = (ref, val) => { if (R[ref]) R[ref].value = val || ''; };

    set('emitterName',    data.emitter?.name);
    set('emitterAddress', data.emitter?.address);
    set('emitterExtra',   data.emitter?.extra);
    set('emitterTel',     data.emitter?.tel);
    set('emitterEmail',   data.emitter?.email);

    set('clientName',    data.client?.name);
    set('clientAddress', data.client?.address);
    set('clientExtra',   data.client?.extra);
    set('clientSiret',   data.client?.siret);
    set('clientTel',     data.client?.tel);
    set('clientEmail',   data.client?.email);

    set('docNumber',   data.docNumber);
    set('docDate',     data.docDate || todayISO());
    set('docValidity', data.docValidity);
    set('currency',    data.currency || 'CFA');
    set('placeOfIssue', data.placeOfIssue);
    set('docNotes',    data.notes);

    if (R.vatEnabled)  R.vatEnabled.checked  = data.vatEnabled !== false;
    if (R.vatRate)     R.vatRate.value        = data.vatRate ?? 18;
    if (R.discountEnabled) R.discountEnabled.checked = data.discountEnabled || false;
    if (R.discountRate)    R.discountRate.value       = data.discountRate ?? 0;

    // Logo
    if (data.logo && R.logoPreview && R.logoPlaceholder) {
      R.logoPreview.src   = data.logo;
      R.logoPreview.style.display      = 'block';
      R.logoPlaceholder.style.display  = 'none';
    } else if (R.logoPreview && R.logoPlaceholder) {
      R.logoPreview.style.display      = 'none';
      R.logoPlaceholder.style.display  = 'flex';
    }

    // Lignes
    if (R.itemsBody) {
      R.itemsBody.innerHTML = '';
      if (Array.isArray(data.items) && data.items.length) {
        data.items.forEach(it => {
          R.itemsBody.appendChild(createRow({
            ...it,
            designation: it.designation || it.description || ''
          }));
        });
      } else {
        addRow();
      }
    }

    setMode(data.mode || 'devis');
    recalculate();
    populateClientDatalist();
  }

  function saveDraft() {
    localStorage.setItem(STORAGE_KEYS.draft, JSON.stringify(collectData()));
  }

  function scheduleSave() {
    clearTimeout(state._saveTimer);
    state._saveTimer = setTimeout(() => {
      saveDraft();
      showAutosaveIndicator();
    }, 600);
  }

  function showAutosaveIndicator() {
    if (!R.autosaveBar) return;
    R.autosaveBar.classList.add('visible');
    clearTimeout(state._autosaveTimer);
    state._autosaveTimer = setTimeout(() => R.autosaveBar.classList.remove('visible'), 2500);
  }

  function loadDraft() {
    const raw = localStorage.getItem(STORAGE_KEYS.draft);
    if (!raw) { resetToNew(); return; }
    try   { applyData(JSON.parse(raw)); }
    catch { resetToNew(); }
  }

  /**
   * Réinitialise uniquement les données du document (client + lignes).
   * Conserve les informations de l'émetteur et le logo.
   */
  function resetToNew(clearEmitter = false) {
    state.draftId = uid();

    if (clearEmitter) {
      ['emitterName','emitterAddress','emitterExtra','emitterTel','emitterEmail']
        .forEach(id => { if (R[id]) R[id].value = ''; });
      state.logoDataURL = null;
      if (R.logoPreview)     R.logoPreview.style.display = 'none';
      if (R.logoPlaceholder) R.logoPlaceholder.style.display = 'flex';
    }

    // Toujours effacer les données client
    ['clientName','clientAddress','clientExtra','clientSiret','clientTel','clientEmail']
      .forEach(id => { if (R[id]) R[id].value = ''; });

    if (R.docDate)     R.docDate.value     = todayISO();
    if (R.docValidity) R.docValidity.value = '';
    if (R.docNotes)    R.docNotes.value    = '';
    if (R.placeOfIssue) R.placeOfIssue.value = '';
    if (R.currency)    R.currency.value    = 'CFA';
    if (R.vatEnabled)  R.vatEnabled.checked = true;
    if (R.vatRate)     R.vatRate.value      = 18;
    if (R.discountEnabled) R.discountEnabled.checked = false;
    if (R.discountRate)    R.discountRate.value       = 0;

    // Nouveau numéro → incrémenter le compteur
    const newNumber = consumeNextNumber('devis');
    if (R.docNumber) R.docNumber.value = newNumber;

    if (R.itemsBody) {
      R.itemsBody.innerHTML = '';
      addRow();
    }

    setMode('devis');
    recalculate();
    saveDraft();
  }

  /* ============================================================
     HISTORIQUE
     ============================================================ */
  function getHistory() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.history)) || []; }
    catch { return []; }
  }

  function saveHistory(hist) {
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(hist.slice(0, 60)));
  }

  /**
   * Correction : détection de doublon par docNumber + mode uniquement
   * (updatedAt changeait à chaque sauvegarde auto → jamais de doublon détecté)
   */
  function archiveDocument() {
    const data = collectData();
    data.savedAt = new Date().toISOString();

    const hist = getHistory();
    const dupIdx = hist.findIndex(
      it => it.docNumber === data.docNumber && it.mode === data.mode
    );

    if (dupIdx >= 0) {
      // Remplacer la version existante
      hist[dupIdx] = data;
    } else {
      hist.unshift(data);
    }

    saveHistory(hist);
    populateClientDatalist();
    // Un seul toast ici (correction du bug original du double toast)
    toast('Document sauvegardé dans l\'historique', 'success');
  }

  function renderHistory() {
    if (!R.historyList) return;
    const q = (R.historySearch?.value || '').toLowerCase();
    const hist = getHistory().filter(it =>
      !q ||
      (it.client?.name   || '').toLowerCase().includes(q) ||
      (it.docNumber      || '').toLowerCase().includes(q) ||
      (it.emitter?.name  || '').toLowerCase().includes(q)
    );

    R.historyList.innerHTML = '';

    if (hist.length === 0) {
      R.historyList.innerHTML = `
        <div class="history-empty">
          <i class="fas fa-folder-open"></i>
          ${q ? 'Aucun résultat pour « ' + q + ' »' : 'Aucun document sauvegardé'}
        </div>`;
      return;
    }

    hist.forEach((item, idx) => {
      const sub  = computeTTC(item);
      const date = item.savedAt ? new Date(item.savedAt).toLocaleString('fr-FR') : '—';
      const modeLabel = MODES[item.mode]?.label || item.mode?.toUpperCase() || 'DEVIS';

      const div = document.createElement('div');
      div.className = 'history-item';
      div.innerHTML = `
        <div class="hi-badge">${modeLabel}</div>
        <div class="hi-title">${escHtml(item.docNumber || 'Sans numéro')}</div>
        <div class="hi-sub"><i class="fas fa-user"></i> ${escHtml(item.client?.name || 'Client non renseigné')}</div>
        <div class="hi-sub"><i class="fas fa-calendar-alt"></i> ${escHtml(item.docDate || '—')}</div>
        <div class="hi-sub"><i class="fas fa-clock"></i> Sauvegardé le ${date}</div>
        <div class="hi-amount">${fmt(sub)} ${item.currency || 'CFA'} TTC</div>
        <div class="history-item-actions">
          <button class="btn-load" data-idx="${idx}" title="Charger ce document">
            <i class="fas fa-folder-open"></i> Charger
          </button>
          <button class="btn-del-hist" data-idx="${idx}" title="Supprimer">
            <i class="fas fa-trash"></i> Supprimer
          </button>
        </div>`;
      R.historyList.appendChild(div);
    });

    // Délégation d'événements sur la liste
    R.historyList.onclick = (e) => {
      const loadBtn = e.target.closest('.btn-load');
      const delBtn  = e.target.closest('.btn-del-hist');

      if (loadBtn) {
        const idx = parseInt(loadBtn.dataset.idx, 10);
        const h   = getHistory();
        if (h[idx] && confirm('Charger ce document ? Les données non sauvegardées seront perdues.')) {
          applyData(h[idx]);
          closeHistory();
          toast('Document chargé', 'success');
        }
      }

      if (delBtn) {
        const idx = parseInt(delBtn.dataset.idx, 10);
        const h   = getHistory();
        if (h[idx] && confirm(`Supprimer "${h[idx].docNumber || 'ce document'}" ?`)) {
          h.splice(idx, 1);
          saveHistory(h);
          renderHistory();
          toast('Document supprimé', 'warning');
        }
      }
    };
  }

  function computeTTC(data) {
    if (!data?.items) return 0;
    const sub = data.items.reduce((s, it) => s + (num(it.qty) * num(it.price)), 0);
    const disc = data.discountEnabled ? sub * (num(data.discountRate) / 100) : 0;
    const afterDisc = sub - disc;
    const tax  = (data.vatEnabled !== false) ? afterDisc * (num(data.vatRate) / 100) : 0;
    return afterDisc + tax;
  }

  function openHistory() {
    renderHistory();
    R.historyOverlay?.classList.add('open');
    R.historySearch?.focus();
  }

  function closeHistory() {
    R.historyOverlay?.classList.remove('open');
  }

  /** Alimenter la datalist "clientDatalist" depuis l'historique */
  function populateClientDatalist() {
    const dl = document.getElementById('clientDatalist');
    if (!dl) return;
    const names = [...new Set(
      getHistory()
        .map(it => it.client?.name)
        .filter(Boolean)
    )];
    dl.innerHTML = names.map(n => `<option value="${escHtml(n)}">`).join('');
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }

  /* ============================================================
     EXPORT PDF — rendu premium
     ============================================================ */
  function exportPDF() {
    if (!R.itemsBody || R.itemsBody.rows.length === 0) {
      toast('Ajoutez au moins une ligne de prestation', 'error');
      return;
    }

    try {
      const { jsPDF } = window.jspdf;
      const doc  = new jsPDF({ unit: 'mm', format: 'a4' });
      const pw   = 210;           // largeur page
      const ml   = 14;            // marge gauche
      const mr   = 14;            // marge droite
      const cw   = pw - ml - mr;  // largeur contenu
      const curr = R.currency?.value || 'CFA';
      const mode = MODES[state.mode] || MODES.devis;

      // ── Palette ──
      const C = {
        navy:    [26,  54, 107],
        blue:    [42,  82, 152],
        lightBg: [235, 241, 255],
        rowAlt:  [249, 251, 255],
        line:    [210, 220, 240],
        textDk:  [22,  34,  60],
        textMd:  [80,  95, 130],
        textLt:  [140, 155, 185],
        white:   [255, 255, 255],
        green:   [21, 128,  61],
        red:     [185,  28,  28]
      };

      // ── Helpers ──
      const setFont = (style = 'normal', size = 9) => {
        doc.setFont('helvetica', style);
        doc.setFontSize(size);
      };
      const setColor = (rgb) => doc.setTextColor(...rgb);
      const setFill  = (rgb) => doc.setFillColor(...rgb);
      const setDraw  = (rgb, lw = 0.3) => {
        doc.setDrawColor(...rgb);
        doc.setLineWidth(lw);
      };

      // ════════════════════════════════════════════════
      // BLOC EN-TÊTE : bandeau bleu navy pleine largeur
      // ════════════════════════════════════════════════
      const hdrH = 48;
      setFill(C.navy);
      doc.rect(0, 0, pw, hdrH, 'F');

      // ── Logo ──
      let emitterX = ml;
      if (state.logoDataURL) {
        try {
          const imgFmt = state.logoDataURL.startsWith('data:image/png') ? 'PNG' : 'JPEG';
          const lSize = 30;
          const lY    = (hdrH - lSize) / 2;
          // fond blanc arrondi derrière le logo
          setFill(C.white);
          doc.roundedRect(ml, lY, lSize, lSize, 3, 3, 'F');
          doc.addImage(state.logoDataURL, imgFmt, ml + 1, lY + 1, lSize - 2, lSize - 2, undefined, 'FAST');
          emitterX = ml + lSize + 6;
        } catch (_) {}
      }

      // ── Nom & coordonnées émetteur (colonne gauche) ──
      setColor(C.white);
      setFont('bold', 13);
      doc.text(R.emitterName?.value || 'Votre entreprise', emitterX, 14);

      setFont('normal', 8);
      setColor([200, 215, 245]);
      let ey = 20;
      const emitterLines = [
        R.emitterAddress?.value,
        R.emitterExtra?.value,
        [R.emitterTel?.value, R.emitterEmail?.value].filter(Boolean).join('   |   ')
      ].filter(Boolean);
      emitterLines.forEach(line => {
        doc.text(line, emitterX, ey);
        ey += 5;
      });

      // ── Titre du document + références (colonne droite) ──
      const rightX = pw - mr;

      // Titre (grand)
      setFont('bold', 24);
      setColor(C.white);
      doc.text(mode.label, rightX, 16, { align: 'right' });

      // Filet fin sous le titre
      setDraw([255, 255, 255], 0.3);
      doc.line(rightX - 52, 19, rightX, 19);

      // Numéro & date
      setFont('normal', 8.5);
      setColor([200, 215, 245]);
      doc.text(`N°  ${R.docNumber?.value || '—'}`, rightX, 25, { align: 'right' });
      doc.text(`Date :  ${localDate(R.docDate?.value)}`, rightX, 31, { align: 'right' });

      if (mode.hasValidity && R.docValidity?.value) {
        doc.text(`Valide jusqu'au :  ${localDate(R.docValidity.value)}`, rightX, 37, { align: 'right' });
      }

      // ════════════════════════════════════════════════
      // CARTE CLIENT (sous l'en-tête, légèrement décalée)
      // ════════════════════════════════════════════════
      let y = hdrH + 8;

      // Fond carte client
      setFill(C.lightBg);
      setDraw(C.line, 0.4);
      doc.roundedRect(ml, y, cw, 36, 4, 4, 'FD');

      // Bandeau "FACTURÉ À" sur le côté gauche
      setFill(C.blue);
      doc.roundedRect(ml, y, 22, 36, 4, 4, 'F');
      // Couvrir les coins arrondis droits du bandeau pour qu'il soit carré à droite
      doc.rect(ml + 16, y, 6, 36, 'F');

      // Texte vertical "FACTURÉ À"
      setColor(C.white);
      setFont('bold', 7);
      doc.text('FACTURÉ À', ml + 11, y + 30, { angle: 90, align: 'left' });

      // Infos client
      const cx = ml + 26;
      setColor(C.textDk);
      setFont('bold', 11);
      doc.text(R.clientName?.value || 'Client non renseigné', cx, y + 10);

      setFont('normal', 8.5);
      setColor(C.textMd);
      let cy2 = y + 17;
      const clientLines = [
        R.clientAddress?.value,
        R.clientExtra?.value,
        [R.clientTel?.value, R.clientEmail?.value].filter(Boolean).join('   |   '),
        R.clientSiret?.value ? `SIRET / IFU : ${R.clientSiret.value}` : null
      ].filter(Boolean);
      clientLines.forEach(line => {
        doc.text(line, cx, cy2);
        cy2 += 5;
      });

      y += 44;

      // ════════════════════════════════════════════════
      // TABLEAU DES PRESTATIONS
      // ════════════════════════════════════════════════
      const tableRows = [];
      for (const tr of R.itemsBody.rows) {
        const q   = num(tr.querySelector('[data-field="qty"]')?.value);
        const p   = num(tr.querySelector('[data-field="price"]')?.value);
        const des = tr.querySelector('[data-field="designation"]')?.value || '';
        tableRows.push([des, String(q), fmt(p), fmt(q * p)]);
      }

      doc.autoTable({
        head: [[
          { content: 'Désignation',          styles: { halign: 'left'  } },
          { content: 'Qté',                  styles: { halign: 'right' } },
          { content: `Prix unitaire HT`,     styles: { halign: 'right' } },
          { content: `Total HT`,             styles: { halign: 'right' } }
        ]],
        body:   tableRows,
        startY: y,
        margin: { left: ml, right: mr },
        styles: {
          fontSize:    9,
          cellPadding: { top: 4, bottom: 4, left: 5, right: 5 },
          textColor:   C.textDk,
          lineColor:   C.line,
          lineWidth:   0.25
        },
        headStyles: {
          fillColor:   C.navy,
          textColor:   C.white,
          fontStyle:   'bold',
          fontSize:    8.5,
          cellPadding: { top: 5, bottom: 5, left: 5, right: 5 }
        },
        alternateRowStyles: { fillColor: C.rowAlt },
        columnStyles: {
          0: { cellWidth: 'auto',  halign: 'left'  },
          1: { cellWidth: 18,      halign: 'right' },
          2: { cellWidth: 38,      halign: 'right' },
          3: { cellWidth: 38,      halign: 'right' }
        },
        didParseCell(data) {
          // Dernière colonne en gras
          if (data.column.index === 3 && data.section === 'body') {
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.textColor = C.navy;
          }
        }
      });

      y = doc.lastAutoTable.finalY;

      // ════════════════════════════════════════════════
      // CALCULS
      // ════════════════════════════════════════════════
      const subtotal  = tableRows.reduce((s, _, i) => {
        const tr   = R.itemsBody.rows[i];
        return s + num(tr.querySelector('[data-field="qty"]')?.value)
                 * num(tr.querySelector('[data-field="price"]')?.value);
      }, 0);
      const discOn   = R.discountEnabled?.checked || false;
      const discRate = discOn ? num(R.discountRate?.value) : 0;
      const discount = subtotal * discRate / 100;
      const afterDisc = subtotal - discount;
      const vatOn    = R.vatEnabled?.checked || false;
      const vatRate  = vatOn ? num(R.vatRate?.value) : 0;
      const tax      = afterDisc * vatRate / 100;
      const total    = afterDisc + tax;

      // ════════════════════════════════════════════════
      // ZONE TOTAUX (alignée à droite)
      // ════════════════════════════════════════════════
      y += 6;

      const totX    = ml + cw * 0.52;   // début zone totaux
      const totW    = cw * 0.48;        // largeur
      const colAmt  = pw - mr;          // colonne montants (alignée droite)
      const colLbl  = totX + 5;         // colonne labels

      // Lignes de totaux à afficher
      const totLines = [
        { label: 'Sous-total HT',           value: subtotal,  dim: true,  bold: false },
        discOn ? { label: `Remise (${discRate} %)`, value: -discount, dim: true,  bold: false, red: true } : null,
        vatOn  ? { label: `TVA (${vatRate} %)`,     value: tax,       dim: true,  bold: false } : null,
      ].filter(Boolean);

      const rowH  = 6.5;
      const totalH = totLines.length * rowH + 14;  // +14 pour la ligne TTC

      setFill(C.lightBg);
      setDraw(C.line, 0.3);
      doc.roundedRect(totX, y, totW, totalH, 3, 3, 'FD');

      let ty2 = y + 7;

      totLines.forEach(row => {
        setFont('normal', 8.5);
        setColor(row.red ? C.red : C.textMd);
        doc.text(row.label, colLbl, ty2);
        const amtStr = `${row.red && row.value < 0 ? '− ' : ''}${fmt(Math.abs(row.value))} ${curr}`;
        doc.text(amtStr, colAmt, ty2, { align: 'right' });
        ty2 += rowH;
      });

      // Séparateur avant TTC
      setDraw(C.blue, 0.5);
      doc.line(totX + 4, ty2 - 1, pw - mr - 4, ty2 - 1);
      ty2 += 3;

      // Ligne TTC — fond navy
      const ttcH = 9;
      setFill(C.navy);
      doc.roundedRect(totX, ty2 - 5, totW, ttcH, 3, 3, 'F');
      setFont('bold', 10.5);
      setColor(C.white);
      doc.text('Total TTC', colLbl, ty2 + 1);
      doc.text(`${fmt(total)} ${curr}`, colAmt, ty2 + 1, { align: 'right' });
      ty2 += ttcH;

      y = ty2 + 10;

      // ════════════════════════════════════════════════
      // NOTES & CONDITIONS (côté gauche)
      // ════════════════════════════════════════════════
      const notes = R.docNotes?.value?.trim();
      if (notes) {
        const notesY = doc.lastAutoTable.finalY + 6;
        setFill([245, 247, 252]);
        setDraw(C.line, 0.3);
        const notesW = cw * 0.5 - 4;
        const notesLines = doc.splitTextToSize(notes, notesW - 12);
        const notesH = notesLines.length * 4.5 + 14;
        doc.roundedRect(ml, notesY, notesW, notesH, 3, 3, 'FD');

        // Étiquette
        setFill(C.blue);
        doc.roundedRect(ml, notesY, notesW, 8, 3, 3, 'F');
        doc.rect(ml, notesY + 4, notesW, 4, 'F');  // coins inférieurs carrés
        setFont('bold', 7.5);
        setColor(C.white);
        doc.text('NOTES & CONDITIONS', ml + 5, notesY + 5.5);

        setFont('normal', 8);
        setColor(C.textMd);
        doc.text(notesLines, ml + 5, notesY + 13);

        y = Math.max(y, notesY + notesH + 8);
      }

      // ════════════════════════════════════════════════
      // SIGNATURE
      // ════════════════════════════════════════════════
      const sigY = y;

      setFill(C.lightBg);
      setDraw(C.line, 0.3);
      doc.roundedRect(ml, sigY, 70, 28, 3, 3, 'FD');

      setFont('bold', 7.5);
      setColor(C.textMd);
      doc.text('CACHET ET SIGNATURE', ml + 4, sigY + 6);

      // Ligne de signature
      setDraw(C.blue, 0.5);
      doc.line(ml + 4, sigY + 22, ml + 60, sigY + 22);

      // Lieu / date
      const place = R.placeOfIssue?.value;
      if (place) {
        setFont('normal', 8);
        setColor(C.textMd);
        doc.text(
          `Fait à ${place}, le ${new Date().toLocaleDateString('fr-FR')}`,
          ml + 76, sigY + 14
        );
      }

      // ════════════════════════════════════════════════
      // PIED DE PAGE
      // ════════════════════════════════════════════════
      const pageH  = doc.internal.pageSize.height;
      const footY  = pageH - 8;

      setFill(C.navy);
      doc.rect(0, footY - 4, pw, 12, 'F');

      setFont('normal', 7);
      setColor([170, 190, 225]);
      doc.text(
        `${mode.label}  ·  N° ${R.docNumber?.value || '—'}  ·  ${R.emitterName?.value || ''}`,
        pw / 2, footY + 1, { align: 'center' }
      );
      doc.text(
        `Généré le ${new Date().toLocaleString('fr-FR')}`,
        pw - mr, footY + 1, { align: 'right' }
      );

      // ════════════════════════════════════════════════
      // SAUVEGARDE
      // ════════════════════════════════════════════════
      const filename = `${mode.label}_${R.docNumber?.value || 'sans-numero'}.pdf`;
      doc.save(filename);
      toast('PDF généré avec succès', 'success');

    } catch (err) {
      console.error('Erreur génération PDF :', err);
      toast('Erreur lors de la génération du PDF', 'error');
    }
  }

  /* ============================================================
     EXPORT EXCEL
     ============================================================ */
  function exportExcel() {
    if (!R.itemsBody || R.itemsBody.rows.length === 0) {
      toast('Ajoutez au moins une ligne de prestation', 'error');
      return;
    }

    try {
      const curr  = R.currency?.value || 'CFA';
      const modeLabel = MODES[state.mode]?.label || 'DEVIS';
      const wb    = XLSX.utils.book_new();

      const rows = [
        [modeLabel],
        [],
        ['N°', R.docNumber?.value || '', 'Date', R.docDate?.value || ''],
        ['Émetteur', R.emitterName?.value || ''],
        [],
        ['CLIENT'],
        [R.clientName?.value    || ''],
        [R.clientAddress?.value || ''],
        [],
        ['Désignation', 'Qté', `Prix HT (${curr})`, `Total HT (${curr})`]
      ];

      for (const tr of R.itemsBody.rows) {
        const q  = num(tr.querySelector('[data-field="qty"]')?.value);
        const p  = num(tr.querySelector('[data-field="price"]')?.value);
        rows.push([
          tr.querySelector('[data-field="designation"]')?.value || '',
          q,
          p,
          q * p
        ]);
      }

      const subtotal  = Array.from(R.itemsBody.rows).reduce((s, tr) =>
        s + num(tr.querySelector('[data-field="qty"]')?.value)
          * num(tr.querySelector('[data-field="price"]')?.value), 0);
      const discOn   = R.discountEnabled?.checked || false;
      const discRate = discOn ? num(R.discountRate?.value) : 0;
      const discount = subtotal * discRate / 100;
      const afterDisc = subtotal - discount;
      const vatOn    = R.vatEnabled?.checked || false;
      const vatRate  = vatOn ? num(R.vatRate?.value) : 0;
      const tax      = afterDisc * vatRate / 100;
      const total    = afterDisc + tax;

      rows.push([]);
      rows.push(['Sous-total HT', '', '', '', subtotal]);
      if (discOn) rows.push([`Remise (${discRate}%)`, '', '', '', -discount]);
      if (vatOn)  rows.push([`TVA (${vatRate}%)`,     '', '', '', tax]);
      rows.push(['Total TTC',   '', '', '', total]);

      const notes = R.docNotes?.value?.trim();
      if (notes) { rows.push([]); rows.push(['Notes', notes]); }

      const ws = XLSX.utils.aoa_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, 'Document');
      XLSX.writeFile(wb, `${modeLabel}_${R.docNumber?.value || 'sans-numero'}.xlsx`);
      toast('Fichier Excel généré', 'success');

    } catch (err) {
      console.error('Erreur Excel :', err);
      toast('Erreur lors de la génération Excel', 'error');
    }
  }

  /* ============================================================
     ÉVÉNEMENTS
     ============================================================ */
  function bindEvents() {
    // Mode
    R.btnDevis?.addEventListener('click',    () => setMode('devis'));
    R.btnFacture?.addEventListener('click',  () => setMode('facture'));
    R.btnProforma?.addEventListener('click', () => setMode('proforma'));

    // Historique
    R.btnHistory?.addEventListener('click', openHistory);
    R.btnCloseHistory?.addEventListener('click', closeHistory);
    R.historyOverlay?.addEventListener('click', e => {
      if (e.target === R.historyOverlay) closeHistory();
    });
    R.historySearch?.addEventListener('input', renderHistory);

    // Correction : un seul toast (celui dans archiveDocument)
    R.btnArchive?.addEventListener('click', archiveDocument);

    // Nouveau document
    R.btnNew?.addEventListener('click', () => {
      if (confirm('Créer un nouveau document ?\nLes informations client et les lignes seront effacées.\n(Les infos de votre entreprise sont conservées.)')) {
        resetToNew(false);
        toast('Nouveau document créé', 'success');
      }
    });

    // PDF / Excel
    R.btnPdf?.addEventListener('click',   exportPDF);
    R.btnExcel?.addEventListener('click', exportExcel);

    // Ajouter ligne
    R.addRow?.addEventListener('click', () => addRow({}, true));

    // Actions sur le tableau (délégation)
    R.itemsBody?.addEventListener('click', e => {
      const btn = e.target.closest('[data-action="remove-row"]');
      if (!btn) return;
      const tr = btn.closest('tr');
      if (!tr) return;

      if (R.itemsBody.children.length > 1) {
        tr.remove();
      } else {
        // Dernière ligne : vider sans supprimer
        tr.querySelector('[data-field="designation"]').value = '';
        tr.querySelector('[data-field="qty"]').value   = '1';
        tr.querySelector('[data-field="price"]').value = '0';
      }
      recalculate();
      scheduleSave();
    });

    R.itemsBody?.addEventListener('input', e => {
      const field = e.target.dataset?.field;
      if (field === 'qty' || field === 'price') {
        const v = parseFloat(e.target.value);
        if (v < 0 || !Number.isFinite(v)) e.target.value = 0;
      }
      recalculate();
      scheduleSave();
    });

    // Checkboxes TVA / Remise
    R.vatEnabled?.addEventListener('change', () => { recalculate(); scheduleSave(); });
    R.discountEnabled?.addEventListener('change', () => { recalculate(); scheduleSave(); });

    // Champs déclenchant recalcul
    [R.vatRate, R.discountRate, R.currency].forEach(el => {
      el?.addEventListener('input', () => { recalculate(); scheduleSave(); });
    });

    // Tous les autres champs → sauvegarde auto
    const allInputs = [
      R.emitterName, R.emitterAddress, R.emitterExtra, R.emitterTel, R.emitterEmail,
      R.clientName, R.clientAddress, R.clientExtra, R.clientSiret, R.clientTel, R.clientEmail,
      R.docNumber, R.docDate, R.docValidity, R.placeOfIssue, R.docNotes
    ];
    allInputs.forEach(el => el?.addEventListener('input', scheduleSave));

    // Logo
    R.logoPlaceholder?.addEventListener('click', () => R.logoUpload?.click());
    R.logoUpload?.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        state.logoDataURL = ev.target.result;
        R.logoPreview.src = ev.target.result;
        R.logoPreview.style.display      = 'block';
        R.logoPlaceholder.style.display  = 'none';
        scheduleSave();
      };
      reader.readAsDataURL(file);
    });

    // Date du jour dans la signature
    if (R.currentDate) {
      R.currentDate.textContent = new Date().toLocaleDateString('fr-FR');
    }

    // Raccourcis clavier
    document.addEventListener('keydown', e => {
      // Ctrl+S / Cmd+S → sauvegarder
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveDraft();
        toast('Brouillon sauvegardé', 'success');
      }
      // Échap → fermer historique
      if (e.key === 'Escape') closeHistory();
    });
  }

  /* ============================================================
     INITIALISATION
     ============================================================ */
  function init() {
    cacheRefs();
    bindEvents();
    loadDraft();
    recalculate();
    ensureOneRow();
    populateClientDatalist();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
