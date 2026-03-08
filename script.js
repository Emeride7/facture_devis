(function() {
  // ==================== CONFIGURATION ====================
  const STORAGE = {
    draft: 'invoiceDraft.v3',
    history: 'invoiceHistory.v3',
    counters: 'invoiceCounters.v3',
    clients: 'invoiceClients.v3',
    items: 'invoiceItems.v3'
  };

  const state = {
    mode: 'devis',
    logoDataURL: null,
    draftId: crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now(),
    _saveTimer: null,
    lastFocused: null,
    archiveButtonDisabled: false,
    draggedRow: null
  };

  // ==================== UTILITAIRES ====================
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function formatMoney(amount) {
    return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  }

  function clampNumber(n, min = 0) {
    const x = Number(n);
    return Number.isFinite(x) ? Math.max(min, x) : min;
  }

  function todayISO() {
    return new Date().toISOString().split('T')[0];
  }

  function showToast(msg, type = 'info', duration = 2500) {
    const toast = $('#toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.style.background = type === 'error' ? '#7f1d1d' : type === 'success' ? '#14532d' : 'var(--primary)';
    toast.classList.add('show');
    clearTimeout(window.toastTimer);
    window.toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
  }

  // ==================== RÉFÉRENCES DOM ====================
  const refs = {
    btnDevis: $('#btnDevis'),
    btnFacture: $('#btnFacture'),
    btnHistory: $('#btnHistory'),
    btnArchive: $('#btnArchive'),
    btnNew: $('#btnNew'),
    btnPdf: $('#btnPdf'),
    btnExcel: $('#btnExcel'),
    btnCloseHistory: $('#btnCloseHistory'),
    historyOverlay: $('#historyOverlay'),
    historySearch: $('#historySearch'),
    historyList: $('#historyList'),
    itemsBody: $('#itemsBody'),
    addRow: $('#addRow'),
    vatRate: $('#vatRate'),
    vatRateDisplay: $('#vatRateDisplay'),
    vatRow: $('#vatRow'),
    currency: $('#currency'),
    docTitle: $('#docTitle'),
    docNumber: $('#docNumber'),
    docDate: $('#docDate'),
    emitterName: $('#emitterName'),
    emitterAddress: $('#emitterAddress'),
    emitterExtra: $('#emitterExtra'),
    emitterTel: $('#emitterTel'),
    emitterEmail: $('#emitterEmail'),
    clientName: $('#clientName'),
    clientAddress: $('#clientAddress'),
    clientExtra: $('#clientExtra'),
    clientSiret: $('#clientSiret'),
    clientTel: $('#clientTel'),
    clientEmail: $('#clientEmail'),
    logoUpload: $('#logoUpload'),
    logoPreview: $('#logoPreview'),
    logoPlaceholder: $('#logoPlaceholder'),
    paymentTerms: $('#paymentTerms'),
    documentNotes: $('#documentNotes'),
    placeOfIssue: $('#placeOfIssue'),
    currentDate: $('#currentDate'),
    toast: $('#toast')
  };

  // ==================== GESTIONNAIRES DE DRAG & DROP ====================
  function handleDragStart(e) {
    if (!e.target.closest('.drag-handle')) {
      e.preventDefault();
      return false;
    }
    state.draggedRow = this;
    e.dataTransfer.effectAllowed = 'move';
    this.style.opacity = '0.5';
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (this !== state.draggedRow && this.tagName === 'TR') {
      const rect = this.getBoundingClientRect();
      const next = (e.clientY - rect.top) > (rect.height / 2);
      this.parentNode.insertBefore(state.draggedRow, next ? this.nextSibling : this);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    this.style.opacity = '1';
    updateTotals();
    scheduleSave();
  }

  function handleDragEnd(e) {
    this.style.opacity = '1';
    state.draggedRow = null;
  }

  // ==================== CRÉATION DE LIGNE (SANS NOTE) ====================
  function createItemRow(item = {}) {
    const tr = document.createElement('tr');
    tr.dataset.itemId = item.id || crypto.randomUUID();
    tr.draggable = true;

    // Poignée
    const tdDrag = document.createElement('td');
    tdDrag.className = 'drag-handle';
    tdDrag.innerHTML = '<i class="fas fa-grip-vertical"></i>';
    tr.appendChild(tdDrag);

    // Désignation (anciennement Description)
    const tdDesignation = document.createElement('td');
    const inpDesignation = document.createElement('input');
    inpDesignation.type = 'text';
    inpDesignation.className = 'item-input';
    inpDesignation.placeholder = 'Désignation';
    inpDesignation.value = item.designation || '';
    inpDesignation.setAttribute('data-field', 'designation');
    tdDesignation.appendChild(inpDesignation);
    tr.appendChild(tdDesignation);

    // Quantité
    const tdQty = document.createElement('td');
    const inpQty = document.createElement('input');
    inpQty.type = 'number';
    inpQty.className = 'item-input num';
    inpQty.min = '0';
    inpQty.step = '0.01';
    inpQty.value = item.qty ?? 1;
    inpQty.setAttribute('data-field', 'qty');
    tdQty.appendChild(inpQty);
    tr.appendChild(tdQty);

    // Prix
    const tdPrice = document.createElement('td');
    const inpPrice = document.createElement('input');
    inpPrice.type = 'number';
    inpPrice.className = 'item-input num';
    inpPrice.min = '0';
    inpPrice.step = '0.01';
    inpPrice.value = item.price ?? 0;
    inpPrice.setAttribute('data-field', 'price');
    tdPrice.appendChild(inpPrice);
    tr.appendChild(tdPrice);

    // Total
    const tdTotal = document.createElement('td');
    tdTotal.className = 'line-total-cell';
    tdTotal.textContent = formatMoney((item.qty || 0) * (item.price || 0));
    tr.appendChild(tdTotal);

    // Supprimer
    const tdActions = document.createElement('td');
    const btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.className = 'remove-row-btn';
    btnDel.innerHTML = '<i class="fas fa-trash"></i>';
    btnDel.setAttribute('data-action', 'remove-row');
    tdActions.appendChild(btnDel);
    tr.appendChild(tdActions);

    // Écouteurs
    tr.addEventListener('dragstart', handleDragStart);
    tr.addEventListener('dragover', handleDragOver);
    tr.addEventListener('drop', handleDrop);
    tr.addEventListener('dragend', handleDragEnd);

    return tr;
  }

  function addItemRow(item = {}, options = {}) {
    const row = createItemRow({
      id: crypto.randomUUID(),
      designation: '',
      qty: 1,
      price: 0,
      ...item
    });
    refs.itemsBody.appendChild(row);
    if (options.focus) row.querySelector('input')?.focus();
    updateTotals();
    scheduleSave();
  }

  function ensureAtLeastOneRow() {
    if (refs.itemsBody.children.length === 0) {
      addItemRow({});
    }
  }

  // ==================== CALCULS ====================
  function computeSubtotal() {
    let total = 0;
    for (const tr of refs.itemsBody.rows) {
      const qty = clampNumber(tr.querySelector('[data-field="qty"]')?.value);
      const price = clampNumber(tr.querySelector('[data-field="price"]')?.value);
      total += qty * price;
    }
    return total;
  }

  function updateTotals() {
    for (const tr of refs.itemsBody.rows) {
      const qty = clampNumber(tr.querySelector('[data-field="qty"]')?.value);
      const price = clampNumber(tr.querySelector('[data-field="price"]')?.value);
      tr.querySelector('.line-total-cell').textContent = formatMoney(qty * price);
    }

    const subtotal = computeSubtotal();
    const vatRate = clampNumber(refs.vatRate?.value);
    if (refs.vatRateDisplay) refs.vatRateDisplay.textContent = vatRate;

    const tax = subtotal * vatRate / 100;
    const total = subtotal + tax;

    if ($('#subtotal')) $('#subtotal').textContent = formatMoney(subtotal);
    if ($('#totalTax')) $('#totalTax').textContent = formatMoney(tax);
    if ($('#grandTotal')) $('#grandTotal').textContent = formatMoney(total);
    if (refs.vatRow) refs.vatRow.style.display = vatRate > 0 ? '' : 'none';

    // Mise à jour des devises
    const curr = refs.currency?.value || '€';
    $$('.curr').forEach(el => el.textContent = curr);
  }

  // ==================== MODE DEVIS/FACTURE ====================
  function setMode(mode) {
    state.mode = mode;
    if (refs.docTitle) refs.docTitle.textContent = mode === 'facture' ? 'FACTURE' : 'DEVIS';
    if (refs.btnDevis && refs.btnFacture) {
      refs.btnDevis.classList.toggle('active', mode === 'devis');
      refs.btnFacture.classList.toggle('active', mode === 'facture');
    }

    // Générer un numéro si vide
    if (!refs.docNumber.value) {
      refs.docNumber.value = generateNextNumber(mode);
    }
  }

  function generateNextNumber(mode) {
    const prefix = mode === 'facture' ? 'F' : 'D';
    const year = new Date().getFullYear();
    const counters = JSON.parse(localStorage.getItem(STORAGE.counters) || '{}');
    const key = `${mode}-${year}`;
    const next = (counters[key] || 0) + 1;
    counters[key] = next;
    localStorage.setItem(STORAGE.counters, JSON.stringify(counters));
    return `${prefix}${year.toString().slice(-2)}-${String(next).padStart(4, '0')}`;
  }

  // ==================== PERSISTANCE ====================
  function collectData() {
    const items = [];
    for (const tr of refs.itemsBody.rows) {
      items.push({
        id: tr.dataset.itemId,
        designation: tr.querySelector('[data-field="designation"]')?.value || '',
        qty: clampNumber(tr.querySelector('[data-field="qty"]')?.value),
        price: clampNumber(tr.querySelector('[data-field="price"]')?.value)
      });
    }

    return {
      id: state.draftId,
      mode: state.mode,
      docNumber: refs.docNumber?.value || '',
      docDate: refs.docDate?.value || todayISO(),
      currency: refs.currency?.value || '€',
      vatRate: clampNumber(refs.vatRate?.value),
      paymentTerms: refs.paymentTerms?.value || '',
      documentNotes: refs.documentNotes?.value || '',
      placeOfIssue: refs.placeOfIssue?.value || '',
      emitt
