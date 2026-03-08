Je vois le problème : les montants utilisent des virgules et des slashs alors qu'ils devraient être formatés avec des espaces et sans décimales. Le problème vient du formatage dans la fonction formatMoney.

Remplacer la fonction formatMoney par celle-ci :

```javascript
function formatMoney(amount) {
  // Arrondir à l'entier le plus proche
  const rounded = Math.round(amount);
  // Formater avec séparateur de milliers (espace)
  return rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
```

Et dans la fonction exportPDF, au moment d'ajouter les montants, il faut utiliser cette fonction :

```javascript
// Exemple dans le tableau
const qty = clampNumber(tr.querySelector('[data-field="qty"]')?.value);
const price = clampNumber(tr.querySelector('[data-field="price"]')?.value);
tableData.push([
  tr.querySelector('[data-field="designation"]')?.value || '',
  String(qty),
  formatMoney(price),      // ICI
  formatMoney(qty * price) // ICI
]);
```

Voici le fichier complet avec toutes les corrections :

```javascript
(function() {
  // ==================== CONFIGURATION ====================
  const STORAGE = {
    draft: 'invoiceDraft.v4',
    history: 'invoiceHistory.v4',
    counters: 'invoiceCounters.v4',
    clients: 'invoiceClients.v4',
    items: 'invoiceItems.v4'
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
    // Arrondir à l'entier le plus proche
    const rounded = Math.round(amount);
    // Formater avec séparateur de milliers (espace)
    return rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
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
    vatEnabled: $('#vatEnabled'),
    vatRate: $('#vatRate'),
    vatRateDisplay: $('#vatRateDisplay'),
    vatRow: $('#vatRow'),
    vatInputContainer: $('#vatInputContainer'),
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

  // ==================== CRÉATION DE LIGNE ====================
  function createItemRow(item = {}) {
    const tr = document.createElement('tr');
    tr.dataset.itemId = item.id || crypto.randomUUID();
    tr.draggable = true;

    // Poignée
    const tdDrag = document.createElement('td');
    tdDrag.className = 'drag-handle';
    tdDrag.innerHTML = '<i class="fas fa-grip-vertical"></i>';
    tr.appendChild(tdDrag);

    // Désignation
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
    inpQty.step = '1';
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
    inpPrice.step = '1';
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
    if (!refs.itemsBody || refs.itemsBody.children.length === 0) {
      addItemRow({});
    }
  }

  // ==================== CALCULS ====================
  function computeSubtotal() {
    let total = 0;
    if (!refs.itemsBody) return total;
    for (const tr of refs.itemsBody.rows) {
      const qty = clampNumber(tr.querySelector('[data-field="qty"]')?.value);
      const price = clampNumber(tr.querySelector('[data-field="price"]')?.value);
      total += qty * price;
    }
    return total;
  }

  function updateTotals() {
    if (!refs.itemsBody) return;
    
    for (const tr of refs.itemsBody.rows) {
      const qty = clampNumber(tr.querySelector('[data-field="qty"]')?.value);
      const price = clampNumber(tr.querySelector('[data-field="price"]')?.value);
      tr.querySelector('.line-total-cell').textContent = formatMoney(qty * price);
    }

    const subtotal = computeSubtotal();
    
    // Gestion TVA
    const vatEnabled = refs.vatEnabled?.checked || false;
    const vatRate = vatEnabled ? clampNumber(refs.vatRate?.value) : 0;
    
    if (refs.vatRateDisplay) refs.vatRateDisplay.textContent = vatRate;
    if (refs.vatInputContainer) {
      refs.vatInputContainer.style.display = vatEnabled ? 'flex' : 'none';
    }

    const tax = subtotal * vatRate / 100;
    const total = subtotal + tax;

    const subtotalEl = $('#subtotal');
    const taxEl = $('#totalTax');
    const totalEl = $('#grandTotal');
    
    if (subtotalEl) subtotalEl.textContent = formatMoney(subtotal);
    if (taxEl) taxEl.textContent = formatMoney(tax);
    if (totalEl) totalEl.textContent = formatMoney(total);
    
    if (refs.vatRow) refs.vatRow.style.display = vatEnabled ? '' : 'none';

    // Mise à jour des devises
    const curr = refs.currency?.value || 'CFA';
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
    if (!refs.docNumber?.value) {
      refs.docNumber.value = generateNextNumber(mode);
    }
  }

  function generateNextNumber(mode) {
    const prefix = mode === 'facture' ? 'F' : 'D';
    const year = new Date().getFullYear().toString().slice(-2);
    const counters = JSON.parse(localStorage.getItem(STORAGE.counters) || '{}');
    const key = `${mode}-${year}`;
    const next = (counters[key] || 0) + 1;
    counters[key] = next;
    localStorage.setItem(STORAGE.counters, JSON.stringify(counters));
    return `${prefix}${year}-${String(next).padStart(4, '0')}`;
  }

  // ==================== PERSISTANCE ====================
  function collectData() {
    const items = [];
    if (refs.itemsBody) {
      for (const tr of refs.itemsBody.rows) {
        items.push({
          id: tr.dataset.itemId,
          designation: tr.querySelector('[data-field="designation"]')?.value || '',
          qty: clampNumber(tr.querySelector('[data-field="qty"]')?.value),
          price: clampNumber(tr.querySelector('[data-field="price"]')?.value)
        });
      }
    }

    return {
      id: state.draftId,
      mode: state.mode,
      docNumber: refs.docNumber?.value || '',
      docDate: refs.docDate?.value || todayISO(),
      currency: refs.currency?.value || 'CFA',
      vatEnabled: refs.vatEnabled?.checked || false,
      vatRate: clampNumber(refs.vatRate?.value),
      placeOfIssue: refs.placeOfIssue?.value || '',
      emitter: {
        name: refs.emitterName?.value || '',
        address: refs.emitterAddress?.value || '',
        extra: refs.emitterExtra?.value || '',
        tel: refs.emitterTel?.value || '',
        email: refs.emitterEmail?.value || ''
      },
      client: {
        name: refs.clientName?.value || '',
        address: refs.clientAddress?.value || '',
        extra: refs.clientExtra?.value || '',
        siret: refs.clientSiret?.value || '',
        tel: refs.clientTel?.value || '',
        email: refs.clientEmail?.value || ''
      },
      logo: state.logoDataURL,
      items,
      updatedAt: new Date().toISOString()
    };
  }

  function applyData(data) {
    if (!data) return;

    state.draftId = data.id || crypto.randomUUID();
    state.logoDataURL = data.logo || null;

    // Émetteur
    if (refs.emitterName) refs.emitterName.value = data.emitter?.name || '';
    if (refs.emitterAddress) refs.emitterAddress.value = data.emitter?.address || '';
    if (refs.emitterExtra) refs.emitterExtra.value = data.emitter?.extra || '';
    if (refs.emitterTel) refs.emitterTel.value = data.emitter?.tel || '';
    if (refs.emitterEmail) refs.emitterEmail.value = data.emitter?.email || '';

    // Client
    if (refs.clientName) refs.clientName.value = data.client?.name || '';
    if (refs.clientAddress) refs.clientAddress.value = data.client?.address || '';
    if (refs.clientExtra) refs.clientExtra.value = data.client?.extra || '';
    if (refs.clientSiret) refs.clientSiret.value = data.client?.siret || '';
    if (refs.clientTel) refs.clientTel.value = data.client?.tel || '';
    if (refs.clientEmail) refs.clientEmail.value = data.client?.email || '';

    // Document
    if (refs.docNumber) refs.docNumber.value = data.docNumber || '';
    if (refs.docDate) refs.docDate.value = data.docDate || todayISO();
    if (refs.currency) refs.currency.value = data.currency || 'CFA';
    if (refs.vatEnabled) refs.vatEnabled.checked = data.vatEnabled !== false;
    if (refs.vatRate) refs.vatRate.value = data.vatRate ?? 18;
    if (refs.placeOfIssue) refs.placeOfIssue.value = data.placeOfIssue || '';

    // Logo
    if (data.logo && refs.logoPreview && refs.logoPlaceholder) {
      refs.logoPreview.src = data.logo;
      refs.logoPreview.style.display = 'block';
      refs.logoPlaceholder.style.display = 'none';
    } else if (refs.logoPreview && refs.logoPlaceholder) {
      refs.logoPreview.style.display = 'none';
      refs.logoPlaceholder.style.display = 'flex';
    }

    // Tableau
    if (refs.itemsBody) {
      refs.itemsBody.innerHTML = '';
      if (Array.isArray(data.items) && data.items.length) {
        data.items.forEach(item => {
          const adaptedItem = {
            ...item,
            designation: item.designation || item.description || ''
          };
          refs.itemsBody.appendChild(createItemRow(adaptedItem));
        });
      } else {
        addItemRow({});
      }
    }

    setMode(data.mode || 'devis');
    updateTotals();
  }

  function saveDraft() {
    const data = collectData();
    localStorage.setItem(STORAGE.draft, JSON.stringify(data));
  }

  function scheduleSave() {
    clearTimeout(state._saveTimer);
    state._saveTimer = setTimeout(saveDraft, 500);
  }

  function loadDraft() {
    const saved = localStorage.getItem(STORAGE.draft);
    if (saved) {
      try {
        applyData(JSON.parse(saved));
      } catch (e) {
        console.error('Erreur chargement brouillon', e);
        resetToNew();
      }
    } else {
      resetToNew();
    }
  }

  function resetToNew() {
    state.draftId = crypto.randomUUID();
    if (refs.docDate) refs.docDate.value = todayISO();
    setMode('devis');
    if (refs.docNumber) refs.docNumber.value = generateNextNumber('devis');
    if (refs.currency) refs.currency.value = 'CFA';
    if (refs.vatEnabled) refs.vatEnabled.checked = true;
    if (refs.vatRate) refs.vatRate.value = 18;
    if (refs.itemsBody) {
      refs.itemsBody.innerHTML = '';
      addItemRow({});
    }
    if (refs.currentDate) refs.currentDate.textContent = new Date().toLocaleDateString('fr-FR');
    if (refs.placeOfIssue) refs.placeOfIssue.value = '';
    updateTotals();
  }

  // ==================== HISTORIQUE ====================
  function getHistory() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE.history)) || [];
    } catch {
      return [];
    }
  }

  function saveHistory(hist) {
    localStorage.setItem(STORAGE.history, JSON.stringify(hist.slice(0, 50)));
  }

  function archiveCurrentDocument() {
    const data = collectData();
    data.savedAt = new Date().toISOString();
    const hist = getHistory();
    const exists = hist.some(item => item.docNumber === data.docNumber && item.updatedAt === data.updatedAt);
    if (!exists) {
      hist.unshift(data);
      saveHistory(hist);
      showToast('Document archivé', 'success');
    }
  }

  function renderHistory() {
    if (!refs.historyList) return;
    const q = (refs.historySearch?.value || '').toLowerCase();
    const hist = getHistory().filter(item => {
      return !q || 
        (item.client?.name && item.client.name.toLowerCase().includes(q)) ||
        (item.docNumber && item.docNumber.toLowerCase().includes(q));
    });

    refs.historyList.innerHTML = '';

    if (hist.length === 0) {
      refs.historyList.innerHTML = '<div class="history-empty">Aucun document archivé</div>';
      return;
    }

    hist.forEach((item, index) => {
      const date = new Date(item.savedAt).toLocaleString('fr-FR');
      const total = item.items.reduce((sum, it) => sum + (it.qty * it.price), 0);
      const vatEnabled = item.vatEnabled !== false;
      const vatRate = item.vatRate || 0;
      const ttc = vatEnabled ? total * (1 + vatRate / 100) : total;

      const div = document.createElement('div');
      div.className = 'history-item';
      div.innerHTML = `
        <div class="hi-title">${item.mode === 'facture' ? 'FACTURE' : 'DEVIS'} ${item.docNumber}</div>
        <div class="hi-sub"><i class="fas fa-user"></i> ${item.client?.name || 'Client inconnu'}</div>
        <div class="hi-sub"><i class="fas fa-calendar"></i> ${item.docDate}</div>
        <div class="hi-amount">${formatMoney(ttc)} ${item.currency || 'CFA'}</div>
        <div class="history-item-actions">
          <button class="btn-load" data-index="${index}"><i class="fas fa-download"></i> Charger</button>
          <button class="btn-del-hist" data-index="${index}"><i class="fas fa-trash"></i> Supprimer</button>
        </div>
      `;
      refs.historyList.appendChild(div);
    });

    // Écouteurs
    refs.historyList.querySelectorAll('.btn-load').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = e.currentTarget.dataset.index;
        const hist = getHistory();
        if (hist[idx] && confirm('Charger ce document ? Les données actuelles seront remplacées.')) {
          applyData(hist[idx]);
          closeHistory();
          showToast('Document chargé', 'success');
        }
      });
    });

    refs.historyList.querySelectorAll('.btn-del-hist').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = e.currentTarget.dataset.index;
        const hist = getHistory();
        if (hist[idx] && confirm('Supprimer ce document ?')) {
          hist.splice(idx, 1);
          saveHistory(hist);
          renderHistory();
        }
      });
    });
  }

  function openHistory() {
    renderHistory();
    if (refs.historyOverlay) refs.historyOverlay.classList.add('open');
  }

  function closeHistory() {
    if (refs.historyOverlay) refs.historyOverlay.classList.remove('open');
  }

  // ==================== EXPORT PDF (CORRIGÉ) ====================
  function exportPDF() {
    try {
      if (!refs.itemsBody || refs.itemsBody.rows.length === 0) {
        showToast('Ajoutez au moins une ligne', 'error');
        return;
      }

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();
      
      // ===== EN-TÊTE =====
      doc.setFillColor(30, 60, 114);
      doc.rect(0, 0, 210, 40, 'F');
      
      // Logo (si présent)
      let leftX = 45;
      if (state.logoDataURL) {
        try {
          doc.addImage(state.logoDataURL, 'JPEG', 15, 8, 25, 25, undefined, 'FAST');
          leftX = 45;
        } catch (e) {}
      }
      
      // Informations prestataire
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text(refs.emitterName?.value || 'Votre entreprise', leftX, 15);
      
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.text(refs.emitterAddress?.value || '', leftX, 22);
      doc.text(refs.emitterExtra?.value || '', leftX, 27);
      doc.text(`${refs.emitterTel?.value || ''} ${refs.emitterEmail?.value || ''}`.trim(), leftX, 32);
      
      // Titre du document
      doc.setFontSize(20);
      doc.setFont('helvetica', 'bold');
      doc.text(refs.docTitle?.textContent || 'DOCUMENT', 195, 20, { align: 'right' });
      
      // Références
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(`N° ${refs.docNumber?.value || ''}`, 195, 28, { align: 'right' });
      doc.text(`Date : ${refs.docDate?.value || ''}`, 195, 34, { align: 'right' });
      
      // ===== CLIENT =====
      let y = 50;
      doc.setTextColor(0, 0, 0);
      doc.setFillColor(232, 238, 255);
      doc.roundedRect(15, y, 180, 30, 3, 3, 'F');
      doc.setDrawColor(42, 82, 152);
      doc.setLineWidth(0.5);
      doc.line(15, y, 15, y + 30);
      
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(42, 82, 152);
      doc.text('CLIENT', 19, y + 6);
      
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text(refs.clientName?.value || 'Client', 19, y + 13);
      
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(refs.clientAddress?.value || '', 19, y + 19);
      doc.text(refs.clientExtra?.value || '', 19, y + 24);
      
      y += 40;
      
      // ===== TABLEAU =====
      const tableData = [];
      for (const tr of refs.itemsBody.rows) {
        const qty = clampNumber(tr.querySelector('[data-field="qty"]')?.value);
        const price = clampNumber(tr.querySelector('[data-field="price"]')?.value);
        tableData.push([
          tr.querySelector('[data-field="designation"]')?.value || '',
          String(qty),
          formatMoney(price),
          formatMoney(qty * price)
        ]);
      }

      doc.autoTable({
        head: [['Désignation', 'Qté', 'Prix HT', 'Total HT']],
        body: tableData,
        startY: y,
        margin: { left: 15, right: 15 },
        styles: { fontSize: 9, cellPadding: 4 },
        headStyles: { fillColor: [30, 60, 114], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 255] },
        columnStyles: {
          0: { cellWidth: 'auto' },
          1: { halign: 'right', cellWidth: 25 },
          2: { halign: 'right', cellWidth: 35 },
          3: { halign: 'right', cellWidth: 35 }
        }
      });

      // ===== TOTAUX =====
      let finalY = doc.lastAutoTable.finalY + 10;
      const curr = refs.currency?.value || 'CFA';
      const subtotal = computeSubtotal();
      const vatEnabled = refs.vatEnabled?.checked || false;
      const vatRate = vatEnabled ? clampNumber(refs.vatRate?.value) : 0;
      const tax = subtotal * vatRate / 100;
      const total = subtotal + tax;

      // Fond pour les totaux
      doc.setFillColor(232, 238, 255);
      doc.roundedRect(120, finalY - 2, 75, vatEnabled ? 35 : 25, 3, 3, 'F');
      
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(90, 90, 120);
      doc.text('Sous-total HT', 124, finalY + 4);
      if (vatEnabled) {
        doc.text(`TVA (${vatRate}%)`, 124, finalY + 11);
      }
      
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(30, 60, 114);
      doc.text('Total TTC', 124, finalY + (vatEnabled ? 23 : 15));
      
      // Montants alignés à droite
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(0, 0, 0);
      doc.text(`${formatMoney(subtotal)} ${curr}`, 190, finalY + 4, { align: 'right' });
      if (vatEnabled) {
        doc.text(`${formatMoney(tax)} ${curr}`, 190, finalY + 11, { align: 'right' });
      }
      
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(30, 60, 114);
      doc.text(`${formatMoney(total)} ${curr}`, 190, finalY + (vatEnabled ? 23 : 15), { align: 'right' });

      // ===== SIGNATURE =====
      let sigY = finalY + (vatEnabled ? 45 : 35);
      doc.setDrawColor(42, 82, 152);
      doc.setLineWidth(0.5);
      doc.line(15, sigY, 80, sigY);
      
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(90, 90, 120);
      doc.text('Cachet et signature', 15, sigY + 5);
      
      if (refs.placeOfIssue?.value) {
        doc.text(`Fait à ${refs.placeOfIssue.value}, le ${new Date().toLocaleDateString('fr-FR')}`, 120, sigY + 5);
      }

      // ===== SAUVEGARDE =====
      doc.save(`${refs.docTitle?.textContent || 'document'}_${refs.docNumber?.value || 'sans-numero'}.pdf`);
      showToast('PDF généré', 'success');
      
    } catch (e) {
      console.error('Erreur PDF:', e);
      showToast('Erreur lors de la génération du PDF', 'error');
    }
  }

  // ==================== EXPORT EXCEL ====================
  function exportExcel() {
    try {
      if (!refs.itemsBody || refs.itemsBody.rows.length === 0) {
        showToast('Ajoutez au moins une ligne', 'error');
        return;
      }

      const wb = XLSX.utils.book_new();
      const data = [
        [refs.docTitle?.textContent || 'DOCUMENT'],
        [],
        ['N°', refs.docNumber?.value || '', 'Date', refs.docDate?.value || ''],
        [],
        ['Client'],
        [refs.clientName?.value || ''],
        [refs.clientAddress?.value || ''],
        [],
        ['Désignation', 'Quantité', 'Prix HT', 'Total HT']
      ];

      for (const tr of refs.itemsBody.rows) {
        const qty = clampNumber(tr.querySelector('[data-field="qty"]')?.value);
        const price = clampNumber(tr.querySelector('[data-field="price"]')?.value);
        data.push([
          tr.querySelector('[data-field="designation"]')?.value || '',
          qty,
          price,
          qty * price
        ]);
      }

      const subtotal = computeSubtotal();
      const vatEnabled = refs.vatEnabled?.checked || false;
      const vatRate = vatEnabled ? clampNumber(refs.vatRate?.value) : 0;
      const tax = subtotal * vatRate / 100;
      const total = subtotal + tax;

      data.push([]);
      data.push(['Sous-total HT', '', '', formatMoney(subtotal)]);
      if (vatEnabled) {
        data.push([`TVA (${vatRate}%)`, '', '', formatMoney(tax)]);
      }
      data.push(['Total TTC', '', '', formatMoney(total)]);

      const ws = XLSX.utils.aoa_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, 'Document');
      XLSX.writeFile(wb, `${refs.docTitle?.textContent || 'document'}_${refs.docNumber?.value || 'sans-numero'}.xlsx`);
      showToast('Excel généré', 'success');
    } catch (e) {
      console.error('Erreur Excel:', e);
      showToast('Erreur lors de la génération Excel', 'error');
    }
  }

  // ==================== GESTIONNAIRES D'ÉVÉNEMENTS ====================
  function bindEvents() {
    // Boutons mode
    if (refs.btnDevis) {
      refs.btnDevis.addEventListener('click', () => setMode('devis'));
    }
    if (refs.btnFacture) {
      refs.btnFacture.addEventListener('click', () => setMode('facture'));
    }

    // Actions principales
    if (refs.btnHistory) {
      refs.btnHistory.addEventListener('click', openHistory);
    }
    if (refs.btnCloseHistory) {
      refs.btnCloseHistory.addEventListener('click', closeHistory);
    }
    if (refs.historyOverlay) {
      refs.historyOverlay.addEventListener('click', (e) => {
        if (e.target === refs.historyOverlay) closeHistory();
      });
    }
    if (refs.historySearch) {
      refs.historySearch.addEventListener('input', renderHistory);
    }

    if (refs.btnArchive) {
      refs.btnArchive.addEventListener('click', () => {
        archiveCurrentDocument();
        showToast('Document sauvegardé', 'success');
      });
    }

    if (refs.btnNew) {
      refs.btnNew.addEventListener('click', () => {
        if (confirm('Nouveau document ? Les données actuelles seront perdues.')) {
          resetToNew();
        }
      });
    }

    if (refs.btnPdf) {
      refs.btnPdf.addEventListener('click', exportPDF);
    }
    if (refs.btnExcel) {
      refs.btnExcel.addEventListener('click', exportExcel);
    }

    // Ajout ligne
    if (refs.addRow) {
      refs.addRow.addEventListener('click', () => addItemRow({}, { focus: true }));
    }

    // Suppression ligne
    if (refs.itemsBody) {
      refs.itemsBody.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action="remove-row"]');
        if (!btn) return;
        const tr = btn.closest('tr');
        if (tr) {
          if (refs.itemsBody.children.length > 1) {
            tr.remove();
          } else {
            // Remettre à zéro la ligne
            const designationInput = tr.querySelector('[data-field="designation"]');
            const qtyInput = tr.querySelector('[data-field="qty"]');
            const priceInput = tr.querySelector('[data-field="price"]');
            if (designationInput) designationInput.value = '';
            if (qtyInput) qtyInput.value = '1';
            if (priceInput) priceInput.value = '0';
          }
          updateTotals();
          scheduleSave();
        }
      });

      // Saisie
      refs.itemsBody.addEventListener('input', (e) => {
        const field = e.target.dataset.field;
        if (field === 'qty' || field === 'price') {
          e.target.value = clampNumber(e.target.value);
        }
        updateTotals();
        scheduleSave();
      });
    }

    // TVA toggle
    if (refs.vatEnabled) {
      refs.vatEnabled.addEventListener('change', () => {
        updateTotals();
        scheduleSave();
      });
    }

    // Autres champs
    const inputs = [
      refs.emitterName, refs.emitterAddress, refs.emitterExtra, refs.emitterTel, refs.emitterEmail,
      refs.clientName, refs.clientAddress, refs.clientExtra, refs.clientSiret, refs.clientTel, refs.clientEmail,
      refs.docNumber, refs.docDate, refs.currency, refs.vatRate, refs.placeOfIssue
    ];
    inputs.forEach(input => {
      if (input) {
        input.addEventListener('input', scheduleSave);
        if (input === refs.currency) {
          input.addEventListener('input', updateTotals);
        }
        if (input === refs.vatRate) {
          input.addEventListener('input', updateTotals);
        }
      }
    });

    // Logo
    if (refs.logoPlaceholder) {
      refs.logoPlaceholder.addEventListener('click', () => refs.logoUpload?.click());
    }

    if (refs.logoUpload) {
      refs.logoUpload.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          state.logoDataURL = ev.target.result;
          if (refs.logoPreview) {
            refs.logoPreview.src = ev.target.result;
            refs.logoPreview.style.display = 'block';
          }
          if (refs.logoPlaceholder) refs.logoPlaceholder.style.display = 'none';
          scheduleSave();
        };
        reader.readAsDataURL(file);
      });
    }

    // Date du jour
    if (refs.currentDate) {
      refs.currentDate.textContent = new Date().toLocaleDateString('fr-FR');
    }

    // Raccourci Ctrl+S
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveDraft();
        showToast('Brouillon sauvegardé', 'success');
      }
    });
  }

  // ==================== INITIALISATION ====================
  function init() {
    bindEvents();
    loadDraft();
    updateTotals();
    ensureAtLeastOneRow();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
```

Les montants s'afficheront maintenant correctement : 20 000 au lieu de 20 / 000.
