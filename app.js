const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).formatToParts(Number(value) || 0).map(part => part.type === 'currency' ? `${part.value} ` : part.value).join('');
const moneyPrecise = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).formatToParts(Number(value) || 0).map(part => part.type === 'currency' ? `${part.value} ` : part.value).join('');
const number = value => Number(value) || 0;
const todayIso = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
const ASSETS = {
  stock: { label: 'Stocks', short: 'Stock', icon: '↗', color: '#a5ca5c' },
  mf: { label: 'Mutual funds', short: 'Mutual fund', icon: '◉', color: '#8989c6' },
  ppf: { label: 'PPF', short: 'PPF', icon: '⌂', color: '#d6ad63' },
  fd: { label: 'Fixed deposit', short: 'Fixed deposit', icon: '▣', color: '#6aa39d' },
  rd: { label: 'Recurring deposit', short: 'Recurring deposit', icon: '◷', color: '#c48679' },
  epf: { label: 'EPF', short: 'EPF', icon: '◩', color: '#5e9aaa' }
};
let user = null, holdings = [], insurancePolicies = [], loans = [], collapsedLoans = new Set(), activeType = 'stock', authMode = 'login', filterType = 'all', editingId = null, editingPolicyId = null, editingLoanId = null;

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
function showToast(message) { const toast = $('#toast'); toast.textContent = message; toast.classList.add('show'); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('show'), 2800); }
let dashboardValuesVisible = false;
function setDashboardValuesVisible(visible) {
  dashboardValuesVisible = visible;
  $('#dashboard').classList.toggle('values-hidden', !visible);
  const button = $('#toggle-dashboard-values');
  button.classList.toggle('is-visible', visible);
  button.setAttribute('aria-pressed', String(visible));
  const label = visible ? 'Hide investment values' : 'Show investment values';
  button.setAttribute('aria-label', label); button.title = label;
}
$('#toggle-dashboard-values').addEventListener('click', () => setDashboardValuesVisible(!dashboardValuesVisible));
function setAuth(mode) { authMode = mode; $('#auth-title').textContent = mode === 'login' ? 'Welcome back.' : 'Start building wealth.'; $('#auth-subtitle').textContent = mode === 'login' ? 'Sign in to your private investment dashboard.' : 'Create a local account for your portfolio.'; $('#auth-submit').innerHTML = mode === 'login' ? 'Sign in <span>→</span>' : 'Create account <span>→</span>'; $('#auth-toggle').innerHTML = mode === 'login' ? 'New here? <button type="button">Create an account</button>' : 'Already have an account? <button type="button">Sign in</button>'; $('#auth-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password'; const confirmLabel = $('#confirm-password-label'), confirmPassword = $('#auth-confirm-password'); confirmLabel.hidden = mode === 'login'; confirmPassword.required = mode === 'register'; confirmPassword.value = ''; $('#auth-error').textContent = ''; }
function openApp(nextUser) { user = nextUser; setDashboardValuesVisible(false); $('#auth-view').hidden = true; $('#app').hidden = false; $('#profile-name').textContent = user.username; $('#avatar').textContent = user.username.slice(0, 1).toUpperCase(); $('#greeting-date').textContent = new Intl.DateTimeFormat('en-IN', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()).toUpperCase(); refreshHoldings(); refreshInsurance(); refreshLoans(); }
function openAuth() { $('#app').hidden = true; $('#auth-view').hidden = false; }
$('#auth-toggle').addEventListener('click', e => { if (e.target.tagName === 'BUTTON') setAuth(authMode === 'login' ? 'register' : 'login'); });
$('#auth-form').addEventListener('submit', async e => { e.preventDefault(); $('#auth-error').textContent = ''; if (authMode === 'register' && $('#auth-password').value !== $('#auth-confirm-password').value) { $('#auth-error').textContent = 'Passwords do not match.'; $('#auth-confirm-password').focus(); return; } const button = $('#auth-submit'); button.disabled = true; try { const result = await api(`/api/${authMode}`, { method: 'POST', body: JSON.stringify({ username: $('#auth-username').value, password: $('#auth-password').value }) }); openApp(result.user); } catch (error) { $('#auth-error').textContent = error.message; } finally { button.disabled = false; } });
$('#logout-button').addEventListener('click', async () => { try { await api('/api/logout', { method: 'POST', body: '{}' }); } finally { user = null; holdings = []; insurancePolicies = []; loans = []; openAuth(); } });
function hasMutualFunds() { return holdings.some(item => item.type === 'mf'); }
function hasEpf() { return holdings.some(item => item.type === 'epf'); }
function portfolioRefreshAvailable() { return hasMutualFunds() || hasEpf() || loans.length > 0; }
let portfolioRefreshRunning = false;
function updatePortfolioRefreshButtons() {
  const dashboardButton = $('#refresh-navs'), investmentsButton = $('#refresh-navs-investments');
  if (dashboardButton) dashboardButton.disabled = portfolioRefreshRunning || !portfolioRefreshAvailable();
  if (investmentsButton) investmentsButton.disabled = portfolioRefreshRunning || (!hasMutualFunds() && !hasEpf());
}
async function refreshPortfolioData(button, includeLoans) {
  if (portfolioRefreshRunning) return;
  const hasFunds = hasMutualFunds(), hasEpfHoldings = hasEpf(), hasLoans = includeLoans && loans.length > 0;
  if (!hasFunds && !hasEpfHoldings && !hasLoans) { showToast('There are no mutual funds, EPF accounts or loans to refresh.'); return; }
  portfolioRefreshRunning = true; updatePortfolioRefreshButtons();
  button.innerHTML = '↻ <span class="refresh-label">Refreshing…</span>';
  const statuses = [];
  try {
    if (hasFunds) {
      try {
        const result = await api('/api/refresh-navs', { method: 'POST', body: '{}' });
        holdings = result.holdings; render();
        const failed = result.failed || [];
        statuses.push(failed.length ? `MF NAVs updated: ${result.updated}; ${result.sipAdded} SIPs added; ${failed.length} failed (${failed[0].name})` : `MF NAVs updated: ${result.updated}${result.sipAdded ? `; ${result.sipAdded} SIPs added` : ''}`);
      } catch (error) { statuses.push(`MF refresh failed: ${error.message}`); }
    }
    if (hasEpfHoldings) {
      try {
        const result = await api('/api/refresh-epf', { method: 'POST', body: '{}' });
        holdings = result.holdings; render();
        statuses.push(result.updated ? `EPF contributions added: ${money(result.contributionsAdded)} through ${dateLabel(result.asOf)}.` : 'No EPF contributions were due.');
      } catch (error) { statuses.push(`EPF refresh failed: ${error.message}`); }
    }
    if (hasLoans) {
      try {
        const result = await api('/api/refresh-loans', { method: 'POST', body: '{}' });
        loans = result.loans; renderLoans();
        statuses.push(`Loan balances updated through ${dateLabel(result.asOf)}.`);
      } catch (error) { statuses.push(`Loan refresh failed: ${error.message}`); }
    }
    showToast(statuses.join(' · '));
  } finally { button.innerHTML = '↻ <span class="refresh-label">Refresh</span>'; portfolioRefreshRunning = false; updatePortfolioRefreshButtons(); }
}
$('#refresh-navs').addEventListener('click', event => refreshPortfolioData(event.currentTarget, true));
$('#refresh-navs-investments').addEventListener('click', event => refreshPortfolioData(event.currentTarget, false));

async function refreshHoldings() { try { holdings = (await api('/api/holdings')).holdings; render(); } catch (error) { if (error.message === 'Please sign in.') openAuth(); else showToast(error.message); } }
function estimatedValue(item) {
  if (item.type === 'stock' || item.type === 'mf') return number(item.units) * number(item.price);
  if (item.type === 'epf') return number(item.balance);
  if (item.type === 'ppf') return ppfBalance(item);
  if (item.type === 'fd') return number(item.amount) * Math.pow(1 + number(item.rate) / 100 / 4, 4 * number(item.tenure) / 12);
  if (item.type === 'rd') {
    const installments = rdInstallments(item), monthlyRate = number(item.rate) / 1200;
    if (!monthlyRate) return number(item.monthly) * installments;
    let value = 0;
    for (let i = 0; i < installments; i++) value += number(item.monthly) * Math.pow(1 + monthlyRate, installments - i - 1);
    return value;
  }
  return 0;
}
function ppfInstallments(item) {
  if (!item.monthlyEnabled || !item.monthlyStartDate || number(item.monthlyAmount) <= 0) return 0;
  const start = new Date(`${item.monthlyStartDate}T00:00:00`), today = new Date(`${todayIso()}T00:00:00`);
  if (Number.isNaN(start.getTime()) || today < start) return 0;
  let count = (today.getFullYear() - start.getFullYear()) * 12 + today.getMonth() - start.getMonth() + 1;
  const dueDay = Math.min(start.getDate(), new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate());
  if (today.getDate() < dueDay) count--;
  return Math.max(0, count);
}
function ppfBalance(item) { return number(item.balance) + number(item.monthlyAmount) * ppfInstallments(item); }
function rdInstallments(item) {
  if (!item.openDate || !item.tenure) return 0;
  const start = new Date(`${item.openDate}T00:00:00`), today = new Date(`${todayIso()}T00:00:00`);
  if (Number.isNaN(start.getTime()) || today < start) return 0;
  let count = (today.getFullYear() - start.getFullYear()) * 12 + today.getMonth() - start.getMonth() + 1;
  const dueDay = Math.min(start.getDate(), new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate());
  if (today.getDate() < dueDay) count--;
  return Math.max(0, Math.min(number(item.tenure), count));
}
function investedValue(item) { if (item.type === 'stock' || item.type === 'mf') return number(item.invested) > 0 ? number(item.invested) : number(item.units) * number(item.price); if (item.type === 'ppf') return ppfBalance(item); if (item.type === 'fd') return number(item.amount); if (item.type === 'rd') return number(item.monthly) * rdInstallments(item); if (item.type === 'epf') return number(item.balance); return 0; }
function monthlyContribution(item) {
  const today = todayIso();
  if (item.type === 'mf' && item.sipEnabled && item.sipStartDate && item.sipStartDate <= today) return number(item.sipAmount);
  if (item.type === 'ppf' && item.monthlyEnabled && item.monthlyStartDate && item.monthlyStartDate <= today) return number(item.monthlyAmount);
  if (item.type === 'rd' && item.openDate && item.openDate <= today && rdInstallments(item) < number(item.tenure)) return number(item.monthly);
  if (item.type === 'epf' && item.salaryDate) return number(item.employeeContribution) + number(item.employerContribution);
  return 0;
}
function activeMonthlyInvestments() { return holdings.reduce((sum, item) => sum + monthlyContribution(item), 0); }
function render() {
  updateMaturityNotifications();
  const visible = holdings.filter(item => filterType === 'all' || item.type === filterType);
  const totalValue = holdings.reduce((sum, item) => sum + estimatedValue(item), 0);
  $('#net-worth').textContent = money(totalValue); $('#donut-total').textContent = money(totalValue); $('#networth-holdings').textContent = `${holdings.length} investment${holdings.length === 1 ? '' : 's'}`; $('#holding-count').textContent = holdings.length; $('#nav-count').textContent = holdings.length; $('#monthly-investment-total').textContent = money(activeMonthlyInvestments());
  const assetTotals = Object.keys(ASSETS).map((type, index) => { const group = holdings.filter(item => item.type === type); const value = group.reduce((sum, item) => sum + estimatedValue(item), 0); $(`#value-${type}`).textContent = money(value); const unit = type === 'ppf' || type === 'epf' ? 'account' : type === 'stock' || type === 'mf' ? 'holding' : 'deposit'; $(`#count-${type}`).textContent = `${group.length} ${unit}${group.length === 1 ? '' : 's'}`; return { type, value, index }; }); const mainGrid = $('.main-stat-grid'); mainGrid.append($('.networth-card'), $('#loans-stat'), $('#insurance-stat')); const investmentGrid = $('.investment-stat-grid'); assetTotals.sort((a, b) => b.value - a.value || a.index - b.index).forEach(asset => { investmentGrid.append($(`[data-asset-type="${asset.type}"]`)); }); updatePortfolioRefreshButtons();
  $('#empty-state').classList.toggle('show', holdings.length === 0); $('#holdings-body').innerHTML = '';
  Object.keys(ASSETS).forEach(type => {
    const group = visible.filter(item => item.type === type);
    if (!group.length) return;
    const groupValue = group.reduce((sum, item) => sum + estimatedValue(item), 0);
    const groupRow = document.createElement('tr'); groupRow.className = 'holding-group-row';
    groupRow.innerHTML = `<td colspan="7"><div class="holding-group-heading"><span class="group-name"><i style="background:${ASSETS[type].color}"></i>${ASSETS[type].label}<small>${group.length} ${group.length === 1 ? 'investment' : 'investments'}</small></span><strong>${money(groupValue)}</strong></div></td>`;
    $('#holdings-body').append(groupRow);
    group.forEach(item => {
      const value = estimatedValue(item);
      let quantity = '';
      if (item.type === 'stock' || item.type === 'mf') quantity = `${Number(item.units).toLocaleString('en-IN', { maximumFractionDigits: 4 })} units`;
      else if (item.type === 'ppf' || item.type === 'epf') quantity = 'Balance'; else if (item.type === 'fd') quantity = `${item.tenure} months · ${item.rate}%`; else quantity = `₹${Number(item.monthly).toLocaleString('en-IN')}/mo`;
      const maturity = ['ppf', 'fd', 'rd'].includes(item.type) ? renderInvestmentMaturity(item) : '';
      const row = document.createElement('tr'); row.innerHTML = `<td><div class="asset-name"><span class="asset-icon ${item.type}">${ASSETS[item.type].icon}</span>${escapeHtml(item.name)}</div></td><td>${item.accountNumber ? escapeHtml(item.accountNumber) : '<span class="muted-value">—</span>'}</td><td>${quantity}</td><td>${money(monthlyContribution(item))}</td><td><strong>${money(value)}</strong></td><td>${maturity}</td><td><div class="row-actions"><button class="row-edit" data-edit="${item.id}" aria-label="Edit ${escapeHtml(item.name)}" title="Edit">✎</button><button class="row-delete" data-delete="${item.id}" aria-label="Remove ${escapeHtml(item.name)}" title="Remove">×</button></div></td>`;
      $('#holdings-body').append(row);
    });
  });
  const types = [...new Set(holdings.map(item => item.type))]; renderAllocation(totalValue, types); renderBars(); $('#last-saved').textContent = holdings.length ? `UPDATED ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }).toUpperCase()}` : 'NO INVESTMENTS YET';
}
function escapeHtml(value) { const el = document.createElement('span'); el.textContent = value; return el.innerHTML; }
function pdfAscii(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/₹/g, 'Rs ').replace(/[–—]/g, '-').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7E]/g, '');
}
function pdfEscape(value) { return pdfAscii(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
function pdfWrap(value, maxChars) {
  const words = pdfAscii(value).split(/\s+/); const lines = []; let line = '';
  for (const word of words) {
    if (!word) continue;
    if (word.length > maxChars) {
      if (line) { lines.push(line); line = ''; }
      for (let i = 0; i < word.length; i += maxChars) lines.push(word.slice(i, i + maxChars));
      continue;
    }
    if ((line ? line.length + 1 : 0) + word.length > maxChars) { lines.push(line); line = word; }
    else line += `${line ? ' ' : ''}${word}`;
  }
  if (line || !lines.length) lines.push(line);
  return lines;
}
function makePdfPage(title, subtitle, columns, rows) {
  const pageWidth = 792, pageHeight = 612, left = 36, right = 36, tableWidth = pageWidth - left - right;
  const widths = columns.map(column => column.width * tableWidth / columns.reduce((sum, item) => sum + item.width, 0));
  const commands = ['0.12 0.20 0.15 rg', `BT /F1 20 Tf ${left} ${pageHeight - 42} Td (${pdfEscape(title)}) Tj ET`, '0.38 0.42 0.37 rg', `BT /F1 9 Tf ${left} ${pageHeight - 60} Td (${pdfEscape(subtitle)}) Tj ET`];
  let y = pageHeight - 86, pageIndex = 1; const pageStreams = [];
  const drawTableHeader = () => {
    commands.push('0.91 0.94 0.88 rg', `${left} ${y - 20} ${tableWidth} 24 re f`, '0.16 0.22 0.17 rg');
    let x = left;
    columns.forEach((column, index) => { commands.push(`BT /F2 7 Tf ${x + 5} ${y - 11} Td (${pdfEscape(column.label.toUpperCase())}) Tj ET`); x += widths[index]; });
    x = left;
    widths.slice(0, -1).forEach(width => { x += width; commands.push(`0.82 0.86 0.80 RG 0.5 w ${x} ${y - 20} m ${x} ${y + 4} l S`); });
    y -= 28;
  };
  drawTableHeader();
  rows.forEach((row, rowIndex) => {
    const cells = columns.map((column, index) => pdfWrap(row[index], Math.max(8, Math.floor((widths[index] - 10) / 4.2))));
    const lineCount = Math.max(...cells.map(lines => lines.length)); const rowHeight = Math.max(23, lineCount * 10 + 10);
    if (y - rowHeight < 42) {
      commands.push('0.38 0.42 0.37 rg', `BT /F1 7 Tf ${pageWidth - 92} 22 Td (Page ${pageIndex}) Tj ET`);
      pageStreams.push(commands.join('\n')); commands.length = 0;
      pageIndex++; y = pageHeight - 54;
      commands.push('0.12 0.20 0.15 rg', `BT /F2 10 Tf ${left} ${y} Td (${pdfEscape(title)} - continued) Tj ET`); y -= 22; drawTableHeader();
    }
    if (rowIndex % 2 === 1) commands.push('0.97 0.98 0.96 rg', `${left} ${y - rowHeight + 4} ${tableWidth} ${rowHeight} re f`);
    commands.push('0.88 0.90 0.86 RG 0.5 w', `${left} ${y - rowHeight + 4} m ${left + tableWidth} ${y - rowHeight + 4} l S`, '0.18 0.21 0.18 rg');
    let x = left;
    cells.forEach((lines, colIndex) => {
      lines.forEach((line, lineIndex) => commands.push(`BT /F1 8 Tf ${x + 5} ${y - 10 - lineIndex * 10} Td (${pdfEscape(line)}) Tj ET`));
      if (colIndex < cells.length - 1) commands.push(`0.91 0.92 0.90 RG 0.4 w ${x + widths[colIndex]} ${y - rowHeight + 4} m ${x + widths[colIndex]} ${y + 4} l S`);
      x += widths[colIndex];
    });
    y -= rowHeight;
  });
  if (!rows.length) {
    commands.push('0.42 0.45 0.41 rg', `BT /F1 9 Tf ${left + 5} ${y - 9} Td (No ${pdfEscape(title.toLowerCase())} recorded.) Tj ET`);
    y -= 24;
  }
  commands.push('0.38 0.42 0.37 rg', `BT /F1 7 Tf ${pageWidth - 92} 22 Td (Page ${pageIndex}) Tj ET`);
  pageStreams.push(commands.join('\n'));
  return pageStreams;
}
function downloadPortfolioPdf() {
  const confirmed = window.confirm('Download a PDF containing your Investments, Insurance, and Loans details?');
  if (!confirmed) return;
  const formatDate = value => value ? dateLabel(value) : '';
  const pages = [
    ...makePdfPage('Investments', `Finspire portfolio - generated ${dateLabel(todayIso())}`, [
      { label: 'Asset Name', width: 2.1 }, { label: 'Account Number', width: 1.2 }, { label: 'Maturity Date', width: 1.2 }
    ], holdings.map(item => [item.name || ASSETS[item.type]?.label || item.type, item.accountNumber || '', formatDate(investmentMaturityDate(item))])),
    ...makePdfPage('Insurance', `Finspire portfolio - generated ${dateLabel(todayIso())}`, [
      { label: 'Insured Person', width: 1.2 }, { label: 'Type', width: .7 }, { label: 'Insurance Company', width: 1.3 }, { label: 'Policy Number', width: 1.15 }, { label: 'Sum Insured', width: 1 }, { label: 'Maturity Date', width: .95 }, { label: 'Yearly Premium', width: 1 }
    ], insurancePolicies.map(policy => [policy.insuredPerson, policy.type, policy.company, policy.policyNumber, money(policy.sumInsured), formatDate(policy.toDate), money(policy.premium)])),
    ...makePdfPage('Loans', `Finspire portfolio - generated ${dateLabel(todayIso())}`, [
      { label: 'Loan Type', width: 1 }, { label: 'Underlying Asset', width: 1.35 }, { label: 'Outstanding Principal', width: 1.4 }, { label: 'Interest Rate', width: .9 }, { label: 'Monthly EMI', width: 1 }, { label: 'EMI Date', width: 1 }
    ], loans.map(loan => [loan.loanType, loan.underlyingAsset, money(loan.outstandingPrincipal), `${Number(loan.interestRate).toLocaleString('en-IN', { maximumFractionDigits: 3 })}%`, money(loan.monthlyEmi), formatDate(loan.emiStartDate)]))
  ];
  const objects = [];
  const addObject = value => { objects.push(value); return objects.length; };
  const catalogId = addObject(''); const pagesId = addObject('');
  const regularFontId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const boldFontId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const pageIds = [];
  pages.forEach(content => {
    const streamId = addObject(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 792 612] /Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${streamId} 0 R >>`);
    pageIds.push(pageId);
  });
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  let pdf = '%PDF-1.4\n%Finspire\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xrefOffset = pdf.length; pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  const blob = new Blob([pdf], { type: 'application/pdf' }); const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = `finspire-portfolio-${todayIso()}.pdf`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$$('.export-pdf').forEach(button => button.addEventListener('click', downloadPortfolioPdf));

function updateMaturityNotifications() {
  const utcDay = value => {
    const [year, month, day] = String(value || '').split('-').map(Number);
    return year && month && day ? Date.UTC(year, month - 1, day) : NaN;
  };
  const today = utcDay(todayIso());
  const daysUntil = date => Number.isFinite(utcDay(date)) ? Math.round((utcDay(date) - today) / 86400000) : null;
  const notificationItems = [
    ...holdings.filter(item => ['fd', 'rd', 'ppf'].includes(item.type)).map(item => ({ name: item.name, category: ASSETS[item.type].short, days: daysUntil(investmentMaturityDate(item)) })),
    ...insurancePolicies.map(policy => ({ name: policy.insuredPerson, category: 'Insurance', days: daysUntil(policy.toDate) }))
  ].filter(item => item.days !== null && item.days <= 7).sort((a, b) => a.days - b.days || a.name.localeCompare(b.name));
  const notificationCount = notificationItems.length;
  const button = $('#notification-button'), count = $('#notification-count'), popover = $('#notification-popover');
  button.classList.toggle('has-notifications', notificationCount > 0);
  button.setAttribute('aria-label', notificationCount ? `${notificationCount} items maturing within 7 days` : 'Notifications');
  button.title = notificationCount ? `${notificationCount} items maturing within 7 days` : 'Notifications';
  count.hidden = notificationCount === 0;
  count.textContent = notificationCount > 9 ? '9+' : String(notificationCount);
  const entries = notificationItems.map(item => {
    const timing = item.days < 0 ? `Matured ${Math.abs(item.days)} day${Math.abs(item.days) === 1 ? '' : 's'} ago` : item.days === 0 ? 'Matures today' : `Matures in ${item.days} day${item.days === 1 ? '' : 's'}`;
    return `<li><span>${escapeHtml(item.name)}</span><small>${escapeHtml(item.category)}</small><em>${timing}</em></li>`;
  });
  popover.innerHTML = notificationCount
    ? `<strong>Maturing Soon</strong><ul>${entries.join('')}</ul>`
    : '<p>No new notification</p>';
}
$('#notification-button').addEventListener('click', () => {
  const button = $('#notification-button'), popover = $('#notification-popover');
  const willOpen = popover.hidden;
  popover.hidden = !willOpen;
  button.setAttribute('aria-expanded', String(willOpen));
});
document.addEventListener('click', event => {
  if (event.target.closest('.notification-wrap')) return;
  $('#notification-popover').hidden = true;
  $('#notification-button').setAttribute('aria-expanded', 'false');
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  $('#notification-popover').hidden = true;
  $('#notification-button').setAttribute('aria-expanded', 'false');
});
function renderAllocation(total, types) {
  const segments = $('#donut-segments'), legend = $('#allocation-legend'); segments.innerHTML = ''; legend.innerHTML = '';
  if (!total) { legend.innerHTML = '<div class="empty-chart-label">Add investments<br>to see your allocation</div>'; return; }
  let offset = 0; const circumference = 2 * Math.PI * 70;
  types.forEach(type => { const value = holdings.filter(item => item.type === type).reduce((sum, item) => sum + estimatedValue(item), 0), length = value / total * circumference, circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); circle.setAttribute('cx', 90); circle.setAttribute('cy', 90); circle.setAttribute('r', 70); circle.setAttribute('fill', 'none'); circle.setAttribute('stroke', ASSETS[type].color); circle.setAttribute('stroke-width', 21); circle.setAttribute('stroke-dasharray', `${Math.max(0, length - 2)} ${circumference - length + 2}`); circle.setAttribute('stroke-dashoffset', -offset); circle.setAttribute('stroke-linecap', 'butt'); segments.append(circle); offset += length; const item = document.createElement('div'); item.className = 'legend-item'; item.innerHTML = `<i style="background:${ASSETS[type].color}"></i><span>${ASSETS[type].label}</span><b class="dashboard-number">${(value / total * 100).toFixed(0)}%</b>`; legend.append(item); });
}
function renderBars() {
  const host = $('#chart-bars'), groups = [{ label: 'Stocks', types: ['stock'] }, { label: 'Mutual funds', types: ['mf'] }, { label: 'PPF', types: ['ppf'] }, { label: 'EPF', types: ['epf'] }, { label: 'Fixed income', types: ['fd', 'rd'] }]; host.innerHTML = '';
  if (!holdings.length) { host.innerHTML = '<div class="chart-empty">Your portfolio will appear here</div>'; return; }
  const max = Math.max(1, ...groups.map(group => holdings.filter(item => group.types.includes(item.type)).reduce((sum, item) => sum + estimatedValue(item), 0)));
  groups.forEach(group => { const items = holdings.filter(item => group.types.includes(item.type)), sum = items.reduce((a, item) => a + estimatedValue(item), 0), div = document.createElement('div'); div.className = 'bar-group'; const stack = document.createElement('div'); stack.className = 'bar-stack'; stack.style.height = `${sum / max * 82}%`; items.forEach(item => { const fill = document.createElement('i'); fill.className = 'bar-fill'; fill.style.height = `${sum ? estimatedValue(item) / sum * 100 : 0}%`; fill.style.background = ASSETS[item.type].color; stack.append(fill); }); div.innerHTML = `<span class="bar-amount dashboard-number">${sum ? money(sum) : ''}</span>`; div.append(stack); host.append(div); });
}

const fields = {
  stock: `<div class="form-field full-width"><label for="f-name">Stock name / ticker</label><input id="f-name" required placeholder="e.g. Reliance Industries"></div><div class="form-field"><label for="f-units">Units to add</label><input id="f-units" type="number" min="0.000001" step="any" required placeholder="10"></div><div class="form-field"><label for="f-price">Price per share (₹)</label><input id="f-price" type="number" min="0.01" step="any" required placeholder="Enter share price"></div><div class="form-field full-width" id="basis-field" hidden><label for="f-existing-cost">Total invested amount (₹)</label><input id="f-existing-cost" type="number" min="0" step="any" placeholder="Auto from units × price"></div><p class="form-hint full-width">Enter the units in this purchase. Matching stock entries are combined and the invested amount is recalculated using this price.</p>`,
  mf: `<div class="form-field full-width"><label for="f-code">AMFI scheme code</label><div class="inline-input"><input id="f-code" inputmode="numeric" required placeholder="e.g. 120503"><button type="button" class="btn btn-small" id="fetch-nav">Fetch NAV</button></div><p class="form-hint" id="nav-status">Latest NAV is fetched from mfapi.in when you save.</p></div><div class="form-field full-width"><label for="f-name">Fund name</label><input id="f-name" required placeholder="Fetched from scheme code"></div><div class="form-field"><label for="f-units">Units to add</label><input id="f-units" type="number" min="0.000001" step="any" required placeholder="10"></div><div class="form-field"><label for="f-nav">Latest NAV (₹)</label><input id="f-nav" type="number" min="0.0001" step="any" required placeholder="Fetched automatically"></div><div class="form-field full-width" id="basis-field" hidden><label for="f-existing-cost">Total invested amount (₹)</label><input id="f-existing-cost" type="number" min="0" step="any" placeholder="Auto from units × NAV"></div><label class="sip-toggle full-width"><input id="f-sip-enabled" type="checkbox"><span class="toggle-track"><i></i></span><span class="sip-toggle-copy"><strong>Set up a monthly SIP</strong><small>Buy units automatically on each scheduled date when you refresh</small></span></label><div class="sip-fields full-width" id="sip-fields" hidden><div class="form-field"><label for="f-sip-amount">SIP amount per month (₹)</label><input id="f-sip-amount" type="number" min="0.01" step="any" placeholder="5000"></div><div class="form-field"><label for="f-sip-start-date">First SIP date</label><input id="f-sip-start-date" type="date"></div><p class="form-hint full-width">On each refresh, the app uses the NAV on the SIP date or the next available NAV date. Processed installments are not added twice.</p></div><p class="form-hint full-width">Enter the units in this purchase. Matching fund entries are combined using the latest NAV.</p>`,
  ppf: `<div class="form-field full-width"><label for="f-name">Account label</label><input id="f-name" required value="PPF account" placeholder="e.g. PPF — primary"></div><div class="form-field full-width"><label for="f-contribution">One-time contribution (₹)</label><input id="f-contribution" type="number" min="0.01" step="any" required placeholder="150000"></div><div class="form-field full-width"><label for="f-date">Account open date (for maturity tracking)</label><input id="f-date" type="date"></div><label class="sip-toggle full-width"><input id="f-ppf-monthly-enabled" type="checkbox"><span class="toggle-track"><i></i></span><span class="sip-toggle-copy"><strong>Set up a monthly investment</strong><small>Add a recurring contribution to this PPF account</small></span></label><div class="sip-fields full-width" id="ppf-monthly-fields" hidden><div class="form-field"><label for="f-ppf-monthly-amount">Monthly amount (₹)</label><input id="f-ppf-monthly-amount" type="number" min="0.01" step="any" placeholder="5000"></div><div class="form-field"><label for="f-ppf-monthly-start-date">Start date</label><input id="f-ppf-monthly-start-date" type="date"></div><p class="form-hint full-width">Monthly contributions are counted from the start date through the latest scheduled date up to today.</p></div><p class="form-hint full-width">The one-time contribution is added to the matching PPF account balance.</p>`,
  fd: `<div class="form-field full-width"><label for="f-name">Deposit label</label><input id="f-name" required placeholder="e.g. HDFC Bank FD"></div><div class="form-field"><label for="f-amount">Principal amount (₹)</label><input id="f-amount" type="number" min="1" step="any" required placeholder="500000"></div><div class="form-field"><label for="f-rate">Annual interest rate (%)</label><input id="f-rate" type="number" min="0.01" step="any" required placeholder="7.25"></div><div class="form-field"><label for="f-tenure">Tenure (months)</label><input id="f-tenure" type="number" min="1" step="1" required placeholder="24"></div><div class="form-field"><label for="f-date">Start date</label><input id="f-date" type="date" value="${todayIso()}" required></div><p class="form-hint full-width">A fixed deposit is a one-time investment. Use Edit to update its details.</p>`,
  rd: `<div class="form-field full-width"><label for="f-name">Deposit label</label><input id="f-name" required placeholder="e.g. SBI Recurring Deposit"></div><div class="form-field"><label for="f-monthly">Monthly deposit (₹)</label><input id="f-monthly" type="number" min="1" step="any" required placeholder="10000"></div><div class="form-field"><label for="f-rate">Annual interest rate (%)</label><input id="f-rate" type="number" min="0" step="any" required placeholder="6.5"></div><div class="form-field"><label for="f-tenure">Tenure (months)</label><input id="f-tenure" type="number" min="1" step="1" required placeholder="36"></div><div class="form-field"><label for="f-date">Open date</label><input id="f-date" type="date" value="${todayIso()}" required></div><p class="form-hint full-width">Use Edit to update this recurring deposit. Invested amount counts installments due from the open date.</p>`,
  epf: `<div class="form-field full-width"><label for="f-epf-name">Account label</label><input id="f-epf-name" required maxlength="100" placeholder="e.g. EPF — current employer"></div><div class="form-field full-width"><label for="f-epf-balance">Current balance (₹)</label><input id="f-epf-balance" type="number" min="0" step="any" required placeholder="750000"></div><div class="form-field"><label for="f-epf-employee">Employee EPF (12% · ₹/month)</label><input id="f-epf-employee" type="number" min="0" step="any" required placeholder="6000"></div><div class="form-field"><label for="f-epf-employer">Employer EPF (3.67% · ₹/month)</label><input id="f-epf-employer" type="number" min="0" step="any" required placeholder="1835"></div><div class="form-field full-width"><label for="f-epf-salary-date">Next salary date (after current balance)</label><input id="f-epf-salary-date" type="date" required></div><p class="form-hint full-width">Enter the monthly contribution amounts from your payslip. Refresh adds both contributions on each salary date from the date above.</p>`
};
function syncRecurringFields(toggleId, panelId) {
  const toggle = $(`#${toggleId}`), panel = $(`#${panelId}`);
  if (!toggle || !panel) return;
  panel.hidden = !toggle.checked;
  panel.querySelectorAll('input').forEach(input => { input.disabled = !toggle.checked; });
}
function setType(type) { activeType = type; $$('.asset-tab').forEach(tab => tab.classList.toggle('selected', tab.dataset.type === type)); $('#form-fields').innerHTML = fields[type]; const accountField = `<div class="form-field full-width"><label for="f-account-number">Account Number (optional)</label><input id="f-account-number" maxlength="100" autocomplete="off" placeholder="Enter account number"></div>`; const accountLabel = $('#form-fields #f-epf-name') || $('#form-fields #f-name'); accountLabel.closest('.form-field').insertAdjacentHTML('afterend', accountField); syncRecurringFields('f-sip-enabled', 'sip-fields'); syncRecurringFields('f-ppf-monthly-enabled', 'ppf-monthly-fields'); $('#modal-title').textContent = editingId ? `Edit ${ASSETS[type].label.toLowerCase()}` : `Add ${ASSETS[type].label.toLowerCase()}`; $('#save-investment').innerHTML = editingId ? 'Save changes <span>→</span>' : 'Add to portfolio <span>→</span>'; $('#asset-tabs').classList.toggle('editing', Boolean(editingId)); const unitsLabel = $('#form-fields label[for="f-units"]'); if (unitsLabel && editingId) unitsLabel.textContent = 'Total units held'; const ppfLabel = $('#form-fields label[for="f-contribution"]'); if (ppfLabel && editingId) ppfLabel.textContent = 'Current total balance (₹)'; const basisField = $('#basis-field'); if (basisField) basisField.hidden = !editingId; $('#modal-error').textContent = ''; }
function openModal(item = null) { editingId = item?.id || null; $('#modal-backdrop').hidden = false; setType(item?.type || activeType); if (item) {
  const set = (id, value) => { const input = $(`#f-${id}`); if (input) input.value = value ?? ''; };
  set('name', item.name);
  set('account-number', item.accountNumber);
  if (item.type === 'stock' || item.type === 'mf') { set('code', item.schemeCode); set('units', item.units); set('existing-cost', investedValue(item)); set(item.type === 'stock' ? 'price' : 'nav', item.type === 'stock' ? item.price : item.nav || item.price); if (item.type === 'mf') { $('#f-sip-enabled').checked = Boolean(item.sipEnabled); set('sip-amount', item.sipAmount); set('sip-start-date', item.sipStartDate); $('#sip-fields').hidden = !item.sipEnabled; } }
  if (item.type === 'ppf') { set('contribution', item.balance); set('date', item.openDate); $('#f-ppf-monthly-enabled').checked = Boolean(item.monthlyEnabled); set('ppf-monthly-amount', item.monthlyAmount); set('ppf-monthly-start-date', item.monthlyStartDate); $('#ppf-monthly-fields').hidden = !item.monthlyEnabled; }
  if (item.type === 'fd') { set('amount', item.amount); set('rate', item.rate); set('tenure', item.tenure); set('date', item.openDate); }
  if (item.type === 'rd') { set('monthly', item.monthly); set('rate', item.rate); set('tenure', item.tenure); set('date', item.openDate); }
  if (item.type === 'epf') { set('epf-name', item.name); set('epf-balance', item.balance); set('epf-employee', item.employeeContribution); set('epf-employer', item.employerContribution); set('epf-salary-date', item.salaryDate); }
  syncRecurringFields('f-sip-enabled', 'sip-fields'); syncRecurringFields('f-ppf-monthly-enabled', 'ppf-monthly-fields');
}
const first = $('#f-name') || $('#f-code') || $('#f-epf-name'); first?.focus(); }
function closeModal() { $('#modal-backdrop').hidden = true; $('#investment-form').reset(); editingId = null; $('#asset-tabs').classList.remove('editing'); }
['#add-inline', '#empty-add'].forEach(selector => $(selector).addEventListener('click', () => openModal()));
$('#add-investment-page').addEventListener('click', () => openModal());
$('#modal-close').addEventListener('click', closeModal); $('#cancel-add').addEventListener('click', closeModal); $('#modal-backdrop').addEventListener('click', e => { if (e.target === $('#modal-backdrop')) closeModal(); }); document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeInsuranceModal(); closeLoanModal(); } });
$('#asset-tabs').addEventListener('click', e => { const button = e.target.closest('[data-type]'); if (button) setType(button.dataset.type); });
async function fetchNav() { const code = $('#f-code').value.trim(); if (!code) { $('#nav-status').textContent = 'Enter an AMFI scheme code first.'; return; } const button = $('#fetch-nav'); button.disabled = true; $('#nav-status').textContent = 'Fetching latest NAV…'; try { const data = await api(`/api/mf/${encodeURIComponent(code)}`); $('#f-name').value = data.name; $('#f-nav').value = data.nav; $('#nav-status').textContent = `NAV ₹${data.nav} · as of ${data.date}`; } catch (error) { $('#nav-status').textContent = error.message; } finally { button.disabled = false; } }
$('#form-fields').addEventListener('click', e => { if (e.target.id === 'fetch-nav') fetchNav(); });
$('#form-fields').addEventListener('change', e => { if (e.target.id === 'f-sip-enabled') syncRecurringFields('f-sip-enabled', 'sip-fields'); if (e.target.id === 'f-ppf-monthly-enabled') syncRecurringFields('f-ppf-monthly-enabled', 'ppf-monthly-fields'); });
$('#investment-form').addEventListener('submit', async e => {
  e.preventDefault(); const get = id => $(`#f-${id}`)?.value; let item, beforeSave = null;
  try {
    let mergeTarget = null;
    if (activeType === 'stock') {
      const name = get('name').trim(), units = number(get('units')), price = number(get('price'));
      if (!price || !units) throw new Error('Enter the units and share price.');
      if (editingId) item = { type: 'stock', name, units, price, invested: number(get('existing-cost')) || units * price };
      else {
        const match = holdings.find(holding => holding.type === 'stock' && holding.name.trim().toLowerCase() === name.toLowerCase());
        if (match) { mergeTarget = match.id; item = { ...match, name, units: number(match.units) + units, price, invested: investedValue(match) + units * price }; }
        else item = { type: 'stock', name, units, price, invested: units * price };
      }
    }
    if (activeType === 'mf') {
      let nav = number(get('nav')), schemeCode = get('code').trim();
      if (!nav) { const data = await api(`/api/mf/${encodeURIComponent(schemeCode)}`); nav = data.nav; $('#f-nav').value = nav; if (!get('name').trim()) $('#f-name').value = data.name; }
      const name = get('name').trim(), units = number(get('units')), sipEnabled = $('#f-sip-enabled').checked;
      const sipAmount = sipEnabled ? number(get('sip-amount')) : 0, sipStartDate = sipEnabled ? get('sip-start-date') || '' : '';
      if (!units) throw new Error('Enter the number of units.');
      if (sipEnabled && (!sipAmount || !sipStartDate)) throw new Error('Enter a monthly SIP amount and first SIP date.');
      const previous = editingId ? holdings.find(holding => holding.id === editingId) : null;
      const sipConfig = { sipEnabled, sipAmount: sipAmount || 0, sipStartDate, sipPurchases: previous?.sipPurchases || [] };
      if (editingId) item = { type: 'mf', name, units, price: nav, nav, schemeCode, invested: number(get('existing-cost')) || units * nav, ...sipConfig, updatedAt: new Date().toISOString() };
      else {
        const match = holdings.find(holding => holding.type === 'mf' && (schemeCode && holding.schemeCode ? holding.schemeCode === schemeCode : holding.name.trim().toLowerCase() === name.toLowerCase()));
        if (match) {
          mergeTarget = match.id;
          const mergedSip = sipEnabled ? sipConfig : { sipEnabled: Boolean(match.sipEnabled), sipAmount: match.sipAmount || 0, sipStartDate: match.sipStartDate || '', sipPurchases: match.sipPurchases || [] };
          item = { ...match, name, schemeCode, units: number(match.units) + units, price: nav, nav, invested: investedValue(match) + units * nav, ...mergedSip, updatedAt: new Date().toISOString() };
        } else item = { type: 'mf', name, units, price: nav, nav, schemeCode, invested: units * nav, ...sipConfig, updatedAt: new Date().toISOString() };
      }
    }
    if (activeType === 'ppf') {
      const name = get('name').trim(), amount = number(get('contribution')), monthlyEnabled = $('#f-ppf-monthly-enabled').checked;
      const monthlyAmount = number(get('ppf-monthly-amount')), monthlyStartDate = get('ppf-monthly-start-date') || '';
      if (!amount) throw new Error('Enter a contribution amount.');
      if (monthlyEnabled && (!monthlyAmount || !monthlyStartDate)) throw new Error('Enter a monthly investment amount and start date.');
      const monthlyConfig = { monthlyEnabled, monthlyAmount: monthlyEnabled ? monthlyAmount : 0, monthlyStartDate: monthlyEnabled ? monthlyStartDate : '' };
      if (editingId) item = { type: 'ppf', name, balance: amount, invested: amount, openDate: get('date') || '', ...monthlyConfig };
      else {
        const match = holdings.find(holding => holding.type === 'ppf' && holding.name.trim().toLowerCase() === name.toLowerCase());
        if (match) { mergeTarget = match.id; const config = monthlyEnabled ? monthlyConfig : { monthlyEnabled: Boolean(match.monthlyEnabled), monthlyAmount: number(match.monthlyAmount), monthlyStartDate: match.monthlyStartDate || '' }; item = { ...match, name, balance: number(match.balance) + amount, invested: number(match.invested || match.balance) + amount, openDate: get('date') || match.openDate || '', ...config }; }
        else item = { type: 'ppf', name, balance: amount, invested: amount, openDate: get('date') || '', ...monthlyConfig };
      }
    }
    if (activeType === 'fd') item = { type: 'fd', name: get('name').trim(), amount: number(get('amount')), rate: number(get('rate')), tenure: number(get('tenure')), openDate: get('date') };
    if (activeType === 'rd') item = { type: 'rd', name: get('name').trim(), monthly: number(get('monthly')), rate: number(get('rate')), tenure: number(get('tenure')), openDate: get('date') };
    if (activeType === 'epf') {
      const name = get('epf-name').trim(), balance = number(get('epf-balance')), employeeContribution = number(get('epf-employee')), employerContribution = number(get('epf-employer')), salaryDate = get('epf-salary-date');
      if (!name) throw new Error('Enter an account label.');
      if (employeeContribution + employerContribution <= 0) throw new Error('Enter a monthly employee or employer EPF contribution.');
      if (!salaryDate) throw new Error('Enter the next salary date.');
      const existing = editingId ? null : holdings.find(holding => holding.type === 'epf' && holding.name.trim().toLowerCase() === name.toLowerCase());
      if (existing) mergeTarget = existing.id;
      item = { type: 'epf', name, balance, employeeContribution, employerContribution, salaryDate };
    }
    if (!item.name) throw new Error('Enter a name for this investment.');
    const accountNumber = get('account-number').trim();
    if (editingId || accountNumber) item.accountNumber = accountNumber;
    beforeSave = holdings;
    const savedItem = { id: editingId || mergeTarget || crypto.randomUUID(), ...item };
    holdings = editingId || mergeTarget ? holdings.map(holding => holding.id === savedItem.id ? savedItem : holding) : [...holdings, savedItem];
    const data = await api('/api/holdings', { method: 'PUT', body: JSON.stringify({ holdings }) }); holdings = data.holdings;
    const wasEditing = Boolean(editingId), wasMerged = Boolean(mergeTarget); closeModal(); render();
    showToast(activeType === 'epf' ? (wasEditing || wasMerged ? 'EPF details updated.' : 'EPF added to your portfolio.') : wasEditing ? `${ASSETS[activeType].short} updated.` : wasMerged ? `${ASSETS[activeType].short} units added to the existing holding.` : `${ASSETS[activeType].short} added to your portfolio.`);
  } catch (error) { if (beforeSave) holdings = beforeSave; $('#modal-error').textContent = error.message; }
});
$('#holdings-body').addEventListener('click', async e => { const editButton = e.target.closest('[data-edit]'); if (editButton) { const item = holdings.find(holding => holding.id === editButton.dataset.edit); if (item) openModal(item); return; } const button = e.target.closest('[data-delete]'); if (!button) return; const target = holdings.find(item => item.id === button.dataset.delete); if (!target || !window.confirm(`Delete investment "${target.name}"?`)) return; const before = holdings; holdings = holdings.filter(item => item.id !== button.dataset.delete); try { const data = await api('/api/holdings', { method: 'PUT', body: JSON.stringify({ holdings }) }); holdings = data.holdings; render(); showToast('Investment removed.'); } catch (error) { holdings = before; showToast(error.message); } });
$('#filter-button').addEventListener('click', () => { const types = ['all', ...Object.keys(ASSETS)], next = types[(types.indexOf(filterType) + 1) % types.length]; filterType = next; $('#filter-button').innerHTML = `${next === 'all' ? 'All assets' : ASSETS[next].label} <span>⌄</span>`; render(); });
(async function init() { try { const data = await api('/api/me'); openApp(data.user); } catch { openAuth(); setAuth('login'); } })();

function showView(view, scrollTarget = '') {
  const isInsurance = view === 'insurance', isInvestments = view === 'investments', isDebt = view === 'debt';
  $('#dashboard').hidden = isInsurance || isInvestments || isDebt; $('#investments-page').hidden = !isInvestments; $('#insurance-page').hidden = !isInsurance; $('#debt-page').hidden = !isDebt;
  $('#breadcrumb-current').textContent = isInsurance ? 'Insurance' : isInvestments ? 'Investments' : isDebt ? 'Debt' : 'Overview';
  $$('.nav-link').forEach(link => link.classList.toggle('active', link.dataset.view === view));
  if (scrollTarget) requestAnimationFrame(() => $(`#${scrollTarget}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}
$$('.nav-link').forEach(link => link.addEventListener('click', e => { e.preventDefault(); showView(link.dataset.view, link.dataset.scroll || ''); }));

async function refreshInsurance() {
  try { insurancePolicies = (await api('/api/insurance')).policies.map(policy => policy.type === 'Car' ? { ...policy, type: 'Vehicle' } : policy); renderInsurance(); }
  catch (error) { if (error.message === 'Please sign in.') openAuth(); else showToast(error.message); }
}
function dateLabel(value) {
  if (!value) return '—';
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(year, month - 1, day));
}
function addMonthsToIso(value, months) {
  const [year, month, day] = String(value || '').split('-').map(Number);
  if (!year || !month || !day) return '';
  const target = new Date(year, month - 1 + months, 1);
  target.setDate(Math.min(day, new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()));
  return todayIsoFromDate(target);
}
function investmentMaturityDate(item) {
  if (item.type === 'fd' || item.type === 'rd') return addMonthsToIso(item.openDate, number(item.tenure));
  const [year, month] = String(item.openDate || item.monthlyStartDate || '').split('-').map(Number);
  if (!year || !month) return '';
  const financialYearStart = year - (month < 4 ? 1 : 0);
  return `${financialYearStart + 16}-04-01`;
}
function renderInvestmentMaturity(item) {
  const today = todayIso();
  let startDate = '', endDate = '', description = '';
  if (item.type === 'fd') {
    startDate = item.openDate;
    endDate = addMonthsToIso(startDate, number(item.tenure));
    description = 'FD maturity';
  } else if (item.type === 'rd') {
    startDate = item.openDate;
    endDate = addMonthsToIso(startDate, number(item.tenure));
    description = 'RD maturity';
  } else {
    startDate = item.openDate || item.monthlyStartDate;
    const [ppfStartYear, ppfStartMonth] = String(startDate || '').split('-').map(Number);
    if (!ppfStartYear || !ppfStartMonth) return '';
    const financialYearStart = ppfStartYear - (ppfStartMonth < 4 ? 1 : 0);
    startDate = `${financialYearStart}-04-01`;
    endDate = `${financialYearStart + 16}-04-01`;
    description = 'PPF maturity';
  }
  if (!endDate) return '';
  const utcDay = value => { const [year, month, day] = String(value || '').split('-').map(Number); return year && month && day ? Date.UTC(year, month - 1, day) : NaN; };
  const dayMs = 86400000, start = utcDay(startDate), end = utcDay(endDate), current = utcDay(today);
  const totalDays = Math.max(1, Math.round((end - start) / dayMs) + 1);
  const expired = !Number.isFinite(end) || current > end;
  const daysLeft = expired ? 0 : Math.max(1, Math.ceil((end - current) / dayMs) + 1);
  const remainingPercent = expired ? 0 : Math.min(100, daysLeft / totalDays * 100);
  const radius = 18, circumference = 2 * Math.PI * radius, offset = circumference * (1 - remainingPercent / 100);
  const centerLabel = daysLeft > 999 ? `${Math.round(daysLeft / 365)}y` : `${daysLeft}d`;
  const label = expired ? `${description} date passed` : `${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining until ${description.toLowerCase()}`;
  return `<div class="investment-maturity"><span class="maturity-ring${expired ? ' expired' : ''}" role="img" aria-label="${label}; ${Math.round(remainingPercent)}% of term remaining"><svg viewBox="0 0 44 44" aria-hidden="true"><circle class="maturity-track" cx="22" cy="22" r="${radius}"/><circle class="maturity-progress" cx="22" cy="22" r="${radius}" stroke-dasharray="${circumference.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" transform="rotate(-90 22 22)"/></svg><span>${centerLabel}</span></span><span class="maturity-copy"><strong>${expired ? 'Matured' : `${daysLeft} day${daysLeft === 1 ? '' : 's'}`}</strong><small>${expired ? 'Maturity date passed' : 'until maturity'}</small></span></div>`;
}
function todayIsoFromDate(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function renderPolicyMaturity(policy) {
  const utcDay = value => { const [year, month, day] = String(value || '').split('-').map(Number); return year && month && day ? Date.UTC(year, month - 1, day) : NaN; };
  const dayMs = 86400000, start = utcDay(policy.fromDate), end = utcDay(policy.toDate), today = utcDay(todayIso());
  const totalDays = Math.max(1, Math.round((end - start) / dayMs) + 1);
  const expired = !Number.isFinite(end) || today > end;
  const daysLeft = expired ? 0 : Math.max(1, Math.ceil((end - today) / dayMs) + 1);
  const remainingPercent = expired ? 0 : Math.min(100, daysLeft / totalDays * 100);
  const radius = 18, circumference = 2 * Math.PI * radius, offset = circumference * (1 - remainingPercent / 100);
  const centerLabel = daysLeft > 999 ? `${Math.round(daysLeft / 365)}y` : `${daysLeft}d`;
  const label = expired ? 'Policy expired' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining until maturity`;
  return `<div class="insurance-maturity"><span class="maturity-ring${expired ? ' expired' : ''}" role="img" aria-label="${label}; ${Math.round(remainingPercent)}% of policy term remaining"><svg viewBox="0 0 44 44" aria-hidden="true"><circle class="maturity-track" cx="22" cy="22" r="${radius}"/><circle class="maturity-progress" cx="22" cy="22" r="${radius}" stroke-dasharray="${circumference.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" transform="rotate(-90 22 22)"/></svg><span>${centerLabel}</span></span><span class="maturity-copy"><strong>${expired ? 'Expired' : `${daysLeft} day${daysLeft === 1 ? '' : 's'}`}</strong><small>${expired ? 'Policy ended' : 'remaining'}</small></span></div>`;
}
function renderInsurance() {
  const yearlyPremium = insurancePolicies.reduce((sum, policy) => sum + number(policy.premium), 0);
  $('#annual-premium-total').textContent = money(yearlyPremium);
  $('#insurance-count').textContent = insurancePolicies.length;
  $('#value-insurance').textContent = insurancePolicies.length;
  $('#count-insurance').textContent = `${insurancePolicies.length} ${insurancePolicies.length === 1 ? 'policy' : 'policies'}`;
  $('#policy-count').textContent = insurancePolicies.length;
  $('#insurance-empty').classList.toggle('show', insurancePolicies.length === 0);
  $('#insurance-body').innerHTML = insurancePolicies.map(policy => `<tr><td><strong>${escapeHtml(policy.insuredPerson)}</strong></td><td><span class="type-pill">${escapeHtml(policy.type)}</span></td><td>${escapeHtml(policy.company)}</td><td>${escapeHtml(policy.policyNumber)}</td><td>${money(policy.sumInsured)}</td><td>${dateLabel(policy.toDate)}</td><td>${renderPolicyMaturity(policy)}</td><td>${money(policy.premium)}</td><td>${policy.documentName ? `<a class="policy-document-link" href="/api/insurance/document?policyId=${encodeURIComponent(policy.id)}" target="_blank" rel="noopener" aria-label="View PDF for ${escapeHtml(policy.insuredPerson)}" title="View ${escapeHtml(policy.documentName)}">View PDF</a>` : '<span class="muted-value">—</span>'}</td><td><div class="row-actions"><button class="row-edit" data-policy-edit="${escapeHtml(policy.id)}" aria-label="Edit policy for ${escapeHtml(policy.insuredPerson)}" title="Edit">✎</button><button class="row-delete" data-policy-delete="${escapeHtml(policy.id)}" aria-label="Remove policy for ${escapeHtml(policy.insuredPerson)}" title="Remove">×</button></div></td></tr>`).join('');
  updateMaturityNotifications();
}
function openInsuranceModal(policy = null) {
  editingPolicyId = policy?.id || null;
  $('#insurance-form').reset(); $('#insurance-error').textContent = '';
  $('#insurance-modal-title').textContent = editingPolicyId ? 'Edit insurance policy' : 'Add insurance policy';
  $('#insurance-save').innerHTML = editingPolicyId ? 'Save changes <span>→</span>' : 'Save policy <span>→</span>';
  $('#policy-document-current').hidden = true;
  $('#policy-document-current').removeAttribute('href');
  if (policy) {
    $('#policy-insured').value = policy.insuredPerson; $('#policy-type').value = policy.type === 'Car' ? 'Vehicle' : policy.type; $('#policy-company').value = policy.company;
    $('#policy-number').value = policy.policyNumber; $('#policy-sum').value = policy.sumInsured; $('#policy-premium').value = policy.premium;
    $('#policy-from').value = policy.fromDate; $('#policy-to').value = policy.toDate;
    if (policy.documentName) {
      const currentDocument = $('#policy-document-current');
      currentDocument.href = `/api/insurance/document?policyId=${encodeURIComponent(policy.id)}`;
      currentDocument.textContent = `View current PDF · ${policy.documentName}`;
      currentDocument.hidden = false;
    }
  }
  $('#insurance-modal-backdrop').hidden = false; $('#policy-insured').focus();
}
function closeInsuranceModal() { const backdrop = $('#insurance-modal-backdrop'); if (!backdrop) return; backdrop.hidden = true; $('#insurance-form').reset(); editingPolicyId = null; }
$('#add-policy').addEventListener('click', () => openInsuranceModal());
$('#insurance-empty-add').addEventListener('click', () => openInsuranceModal());
$('#insurance-modal-close').addEventListener('click', closeInsuranceModal); $('#insurance-cancel').addEventListener('click', closeInsuranceModal);
$('#insurance-modal-backdrop').addEventListener('click', e => { if (e.target === $('#insurance-modal-backdrop')) closeInsuranceModal(); });
$('#insurance-body').addEventListener('click', async e => {
  const edit = e.target.closest('[data-policy-edit]');
  if (edit) { const policy = insurancePolicies.find(item => item.id === edit.dataset.policyEdit); if (policy) openInsuranceModal(policy); return; }
  const remove = e.target.closest('[data-policy-delete]'); if (!remove) return;
  const target = insurancePolicies.find(item => item.id === remove.dataset.policyDelete); if (!target || !window.confirm(`Delete the ${target.type} insurance policy for ${target.insuredPerson}?`)) return;
  const before = insurancePolicies; insurancePolicies = insurancePolicies.filter(item => item.id !== remove.dataset.policyDelete);
  try { insurancePolicies = (await api('/api/insurance', { method: 'PUT', body: JSON.stringify({ policies: insurancePolicies }) })).policies; renderInsurance(); showToast('Insurance policy removed.'); }
  catch (error) { insurancePolicies = before; renderInsurance(); showToast(error.message); }
});
$('#insurance-form').addEventListener('submit', async e => {
  e.preventDefault(); $('#insurance-error').textContent = '';
  const fromDate = $('#policy-from').value, toDate = $('#policy-to').value;
  if (toDate < fromDate) { $('#insurance-error').textContent = 'To Date must be on or after From Date.'; return; }
  const documentFile = $('#policy-document').files[0];
  if (documentFile && (!documentFile.name.toLowerCase().endsWith('.pdf') || (documentFile.type && documentFile.type !== 'application/pdf'))) { $('#insurance-error').textContent = 'Choose a PDF policy document.'; return; }
  if (documentFile && documentFile.size > 10 * 1024 * 1024) { $('#insurance-error').textContent = 'Policy PDFs must be 10 MB or smaller.'; return; }
  const policy = { id: editingPolicyId || crypto.randomUUID(), insuredPerson: $('#policy-insured').value.trim(), type: $('#policy-type').value, company: $('#policy-company').value.trim(), policyNumber: $('#policy-number').value.trim(), sumInsured: number($('#policy-sum').value), fromDate, toDate, premium: number($('#policy-premium').value) };
  const before = insurancePolicies, wasEditing = Boolean(editingPolicyId);
  insurancePolicies = (editingPolicyId ? insurancePolicies.map(item => item.id === editingPolicyId ? policy : item) : [...insurancePolicies, policy]).map(item => item.type === 'Car' ? { ...item, type: 'Vehicle' } : item);
  const saveButton = $('#insurance-save'); saveButton.disabled = true;
  try {
    insurancePolicies = (await api('/api/insurance', { method: 'PUT', body: JSON.stringify({ policies: insurancePolicies }) })).policies;
    if (documentFile) {
      try {
        const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Could not read the selected PDF.')); reader.readAsDataURL(documentFile); });
        const result = await api('/api/insurance/document', { method: 'POST', body: JSON.stringify({ policyId: policy.id, fileName: documentFile.name, data: dataUrl.slice(dataUrl.indexOf(',') + 1) }) });
        insurancePolicies = insurancePolicies.map(item => item.id === policy.id ? result.policy : item);
      } catch (error) {
        closeInsuranceModal(); renderInsurance();
        showToast(`Policy saved, but PDF upload failed. Edit the policy to retry. ${error.message}`);
        return;
      }
    }
    closeInsuranceModal(); renderInsurance(); showToast(wasEditing ? 'Insurance policy updated.' : 'Insurance policy added.');
  }
  catch (error) { insurancePolicies = before; renderInsurance(); $('#insurance-error').textContent = error.message; }
  finally { saveButton.disabled = false; }
});

async function refreshLoans() {
  try { loans = (await api('/api/loans')).loans; await refreshLoanBalances(true); }
  catch (error) { if (error.message === 'Please sign in.') openAuth(); else showToast(error.message); }
}
async function refreshLoanBalances(silent = false) {
  const button = $('#refresh-loans'); if (button) button.disabled = true;
  try {
    const result = await api('/api/refresh-loans', { method: 'POST', body: '{}' }); loans = result.loans; renderLoans();
    if (!silent) showToast(`Updated loan balances through ${dateLabel(result.asOf)}.`);
  } catch (error) { if (!silent) showToast(error.message); else throw error; }
  finally { if (button) button.disabled = false; }
}
function emiDate(startValue, monthOffset) {
  const [year, month, day] = startValue.split('-').map(Number), first = new Date(year, month - 1 + monthOffset, 1);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(day, lastDay));
}
function loanEstimate(loan) {
  if (loan.status === 'Closed') return { count: 0, totalInterest: 0, closure: null, closed: true };
  const [year, month, day] = todayIso().split('-').map(Number), today = new Date(year, month - 1, day);
  const [startYear, startMonth] = loan.emiStartDate.split('-').map(Number);
  let nextIndex = Math.max(0, (today.getFullYear() - startYear) * 12 + today.getMonth() - (startMonth - 1));
  while (emiDate(loan.emiStartDate, nextIndex) < today) nextIndex++;
  let balance = number(loan.outstandingPrincipal), totalInterest = 0, count = 0;
  const monthlyRate = number(loan.interestRate) / 1200, payment = number(loan.monthlyEmi);
  while (balance > 0.005 && count < 1200) {
    const interest = balance * monthlyRate;
    if (payment <= interest + 0.000001) return { unpayable: true };
    totalInterest += interest; balance = Math.max(0, balance + interest - Math.min(payment, balance + interest)); count++;
  }
  if (balance > 0.005) return { unpayable: true };
  return { count, totalInterest, closure: count ? emiDate(loan.emiStartDate, nextIndex + count - 1) : null };
}
function todayIsoFromDate(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function renderLoans() {
  $('#debt-count').textContent = loans.length; $('#loan-count').textContent = loans.length;
  const activeLoans = loans.filter(loan => loan.status !== 'Closed'), outstandingTotal = activeLoans.reduce((sum, loan) => sum + number(loan.outstandingPrincipal), 0);
  $('#value-loans').textContent = money(outstandingTotal); $('#debt-outstanding-total').textContent = money(outstandingTotal); $('#count-loans').textContent = `${activeLoans.length} active ${activeLoans.length === 1 ? 'loan' : 'loans'}`;
  updatePortfolioRefreshButtons();
  $('#debt-empty').classList.toggle('show', loans.length === 0);
  $('#loans-body').innerHTML = loans.map(loan => {
    const estimate = loanEstimate(loan), count = estimate.unpayable ? 'EMI too low' : `${estimate.count} ${estimate.count === 1 ? 'EMI' : 'EMIs'}`, closure = estimate.closed ? 'Closed' : estimate.unpayable ? '—' : dateLabel(estimate.closure ? todayIsoFromDate(estimate.closure) : '');
    const expanded = !collapsedLoans.has(loan.id);
    return `<tr class="loan-main-row"><td><span class="loan-name-cell"><button class="loan-expand" data-loan-toggle="${escapeHtml(loan.id)}" aria-expanded="${expanded}" aria-label="${expanded ? 'Hide' : 'Show'} repayment summary for ${escapeHtml(loan.loanType)}">${expanded ? '⌃' : '⌄'}</button><strong>${escapeHtml(loan.loanType)}</strong></span></td><td>${escapeHtml(loan.underlyingAsset)}</td><td>${moneyPrecise(loan.outstandingPrincipal)}</td><td class="emi-breakdown"><span class="emi-hover-trigger" tabindex="0" aria-label="Monthly EMI ${money(loan.monthlyEmi)}. Hover or focus for paid principal and interest totals.">${money(loan.monthlyEmi)}<span class="emi-tooltip" role="tooltip"><span><small>Principal paid to date</small><strong>${moneyPrecise(loan.principalPaid)}</strong></span><span><small>Interest paid to date</small><strong>${moneyPrecise(loan.interestPaid)}</strong></span></span></span></td><td>${Number(loan.interestRate).toLocaleString('en-IN', { maximumFractionDigits: 3 })}%</td><td>${dateLabel(loan.emiStartDate)}</td><td><span class="loan-status ${loan.status === 'Closed' ? 'closed' : ''}">${escapeHtml(loan.status || 'Active')}</span></td><td><div class="row-actions"><button class="row-edit" data-loan-edit="${escapeHtml(loan.id)}" aria-label="Edit ${escapeHtml(loan.loanType)}" title="Edit">✎</button><button class="row-delete" data-loan-delete="${escapeHtml(loan.id)}" aria-label="Remove ${escapeHtml(loan.loanType)}" title="Remove">×</button></div></td></tr><tr class="loan-subrow" ${expanded ? '' : 'hidden'}><td colspan="8"><div class="loan-dropdown"><div class="loan-subrow-grid"><div><span>EMIS LEFT</span><strong>${count}</strong></div><div><span>EST. CLOSURE</span><strong>${closure}</strong></div></div></div></td></tr>`;
  }).join('');
}
function openLoanModal(loan = null) {
  editingLoanId = loan?.id || null; $('#loan-form').reset(); $('#loan-error').textContent = '';
  $('#loan-modal-title').textContent = editingLoanId ? 'Edit loan' : 'Add loan';
  $('#loan-save').innerHTML = editingLoanId ? 'Save changes <span>→</span>' : 'Save loan <span>→</span>';
  if (loan) { $('#loan-type').value = loan.loanType; $('#loan-asset').value = loan.underlyingAsset; $('#loan-status').value = loan.status || 'Active'; $('#loan-principal').value = loan.principalAtStart ?? loan.outstandingPrincipal; $('#loan-emi').value = loan.monthlyEmi; $('#loan-rate').value = loan.interestRate; $('#loan-start-date').value = loan.emiStartDate; }
  $('#loan-modal-backdrop').hidden = false; $('#loan-type').focus();
}
function closeLoanModal() { const backdrop = $('#loan-modal-backdrop'); if (!backdrop) return; backdrop.hidden = true; $('#loan-form').reset(); editingLoanId = null; }
$('#add-loan').addEventListener('click', () => openLoanModal()); $('#debt-empty-add').addEventListener('click', () => openLoanModal());
$('#refresh-loans').addEventListener('click', () => refreshLoanBalances());
$('#loan-modal-close').addEventListener('click', closeLoanModal); $('#loan-cancel').addEventListener('click', closeLoanModal);
$('#loan-modal-backdrop').addEventListener('click', e => { if (e.target === $('#loan-modal-backdrop')) closeLoanModal(); });
$('#loans-body').addEventListener('click', async e => {
  const toggle = e.target.closest('[data-loan-toggle]');
  if (toggle) { const id = toggle.dataset.loanToggle; collapsedLoans.has(id) ? collapsedLoans.delete(id) : collapsedLoans.add(id); renderLoans(); return; }
  const edit = e.target.closest('[data-loan-edit]');
  if (edit) { const loan = loans.find(item => item.id === edit.dataset.loanEdit); if (loan) openLoanModal(loan); return; }
  const remove = e.target.closest('[data-loan-delete]'); if (!remove) return;
  const target = loans.find(item => item.id === remove.dataset.loanDelete); if (!target || !window.confirm(`Delete the ${target.loanType} loan for ${target.underlyingAsset}?`)) return;
  const before = loans; loans = loans.filter(item => item.id !== remove.dataset.loanDelete);
  try { loans = (await api('/api/loans', { method: 'PUT', body: JSON.stringify({ loans }) })).loans; renderLoans(); showToast('Loan removed.'); }
  catch (error) { loans = before; renderLoans(); showToast(error.message); }
});
$('#loan-form').addEventListener('submit', async e => {
  e.preventDefault(); $('#loan-error').textContent = '';
  const loan = { id: editingLoanId || crypto.randomUUID(), loanType: $('#loan-type').value.trim(), underlyingAsset: $('#loan-asset').value.trim(), status: $('#loan-status').value, outstandingPrincipal: number($('#loan-principal').value), monthlyEmi: number($('#loan-emi').value), interestRate: number($('#loan-rate').value), emiStartDate: $('#loan-start-date').value };
  const existingLoan = editingLoanId ? loans.find(item => item.id === editingLoanId) : null;
  if (loan.status === 'Closed') {
    loan.outstandingPrincipal = 0;
    loan.principalAtStart = existingLoan ? number(existingLoan.principalAtStart ?? existingLoan.outstandingPrincipal) : 0;
    loan.principalPaid = number(existingLoan?.principalPaid); loan.interestPaid = number(existingLoan?.interestPaid); loan.processedEmis = number(existingLoan?.processedEmis);
  }
  if (loan.status === 'Active' && loan.outstandingPrincipal <= 0) { $('#loan-error').textContent = 'Enter an outstanding principal for an active loan.'; return; }
  if (loan.status === 'Active' && loan.monthlyEmi <= loan.outstandingPrincipal * loan.interestRate / 1200) { $('#loan-error').textContent = 'The monthly EMI must be higher than the monthly interest to repay this loan.'; return; }
  if (loan.status === 'Active') { loan.principalAtStart = loan.outstandingPrincipal; loan.principalPaid = 0; loan.interestPaid = 0; loan.processedEmis = 0; }
  const before = loans, wasEditing = Boolean(editingLoanId);
  loans = wasEditing ? loans.map(item => item.id === editingLoanId ? loan : item) : [...loans, loan];
  try { loans = (await api('/api/loans', { method: 'PUT', body: JSON.stringify({ loans }) })).loans; await refreshLoanBalances(true); closeLoanModal(); renderLoans(); showToast(wasEditing ? 'Loan updated and repayment history recalculated.' : 'Loan added and repayments calculated through today.'); }
  catch (error) { loans = before; renderLoans(); $('#loan-error').textContent = error.message; }
});
