/**
 * Producer Production Dashboard - frontend logic.
 *
 * Talks to the Apps Script backend via JSONP (see Code.gs for why:
 * fetch() to an Apps Script /exec URL is blocked by CORS, but a
 * <script src="..."> request is not).
 */

let sessionToken = null;
let currentUser = null; // { role, producerId, name, email }
let hoursChart = null;

// ===================== JSONP TRANSPORT =====================

function jsonpCallbackName() {
  return '__pdCallback_' + Date.now() + '_' + Math.random().toString(36).slice(2);
}

function callBackend(action, extraPayload) {
  return new Promise(function (resolve, reject) {
    const callbackName = jsonpCallbackName();
    const script = document.createElement('script');
    let settled = false;

    function cleanup() {
      try { delete window[callbackName]; } catch (e) { window[callbackName] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    window[callbackName] = function (result) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    script.onerror = function () {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Failed to reach the dashboard backend.'));
    };

    const payload = Object.assign({ sessionToken: sessionToken }, extraPayload || {});

    script.src = CONFIG.APPS_SCRIPT_URL +
      '?jsonp=1' +
      '&action=' + encodeURIComponent(action) +
      '&callback=' + encodeURIComponent(callbackName) +
      '&data=' + encodeURIComponent(JSON.stringify(payload)) +
      '&_=' + Date.now();

    document.body.appendChild(script);
  });
}

// ===================== STATUS / ERRORS =====================

function showStatus(message, type) {
  const el = document.getElementById('statusArea');
  el.textContent = message;
  el.className = 'statusArea ' + (type || 'info');
  el.classList.remove('hidden');
}

function hideStatus() {
  document.getElementById('statusArea').classList.add('hidden');
}

// ===================== AUTH =====================

/**
 * Plain OAuth2 "Authorization Code" redirect - no Google JS SDK, no
 * popup, at all. Two earlier approaches were tried and both had
 * mobile-specific failure modes: google.accounts.id's button flow POSTs
 * its popup-blocked fallback back to this page via response_mode=
 * form_post, which GitHub Pages (a static host) can't receive, silently
 * losing the sign-in; google.accounts.oauth2.initTokenClient avoids that
 * specific bug but still depends on a popup reliably handing a result
 * back to its opener - confirmed broken on mobile Chrome (same failure
 * whether opened via a direct link or one shared through another app,
 * so not an in-app-browser problem - the popup/opener handoff itself).
 *
 * This has none of that: clicking the button just navigates the whole
 * page to Google, same as following any link. Google redirects back to
 * Code.gs (not here) once the user picks an account, because Code.gs is
 * a real backend that can receive that redirect and do the token
 * exchange server-side; Code.gs then bounces the browser here one more
 * time with an opaque session token in the URL fragment.
 */
function initGoogleSignIn() {
  const container = document.getElementById('googleSignInButton');
  container.innerHTML = '';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'googleSignInBtn';
  btn.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">' +
    '<path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>' +
    '<path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.87-3.04.87-2.34 0-4.32-1.58-5.03-3.71H.96v2.33A9 9 0 0 0 9 18z"/>' +
    '<path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.69 9c0-.6.1-1.18.28-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z"/>' +
    '<path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.59-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>' +
    '</svg>' +
    '<span>Sign in with Google</span>';

  btn.addEventListener('click', function () {
    const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' +
      'client_id=' + encodeURIComponent(CONFIG.GOOGLE_CLIENT_ID) +
      '&redirect_uri=' + encodeURIComponent(CONFIG.APPS_SCRIPT_URL) +
      '&response_type=code' +
      '&scope=' + encodeURIComponent('openid email profile') +
      '&prompt=select_account';

    window.location.href = authUrl;
  });

  container.appendChild(btn);
}

/**
 * Reads #session=... or #error=... left in the URL by Code.gs's
 * redirectToFrontend_, then strips it so it doesn't linger in the
 * address bar or get shared/bookmarked with a (short-lived, but still)
 * live session token in it. Called once on page load.
 */
function consumeAuthRedirect_() {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return null;

  const params = new URLSearchParams(hash);
  const session = params.get('session');
  const error = params.get('error');

  if (session || error) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  return { session: session, error: error };
}

function completeSignIn_(token) {
  sessionToken = token;
  showStatus('Signing in...', 'info');

  callBackend('whoami', {})
    .then(function (result) {
      if (!result.success) throw new Error(result.error || 'Sign-in failed.');

      currentUser = {
        role: result.role,
        producerId: result.producerId,
        name: result.name,
        email: result.email
      };

      document.getElementById('signedOutView').classList.add('hidden');
      document.getElementById('signedInView').classList.remove('hidden');
      document.getElementById('userLabel').textContent =
        currentUser.name + (currentUser.role === 'admin' ? ' (admin)' : '');

      document.getElementById('app').classList.remove('hidden');
      hideStatus();

      setupForRole();
      setDefaultDateRange();
      loadFilterOptions().then(loadSummary);
    })
    .catch(function (err) {
      sessionToken = null;
      showStatus(err.message, 'error');
    });
}

function signOut() {
  if (sessionToken) {
    callBackend('signOut', {}).catch(function () { /* best effort */ });
  }

  sessionToken = null;
  currentUser = null;

  document.getElementById('app').classList.add('hidden');
  document.getElementById('signedInView').classList.add('hidden');
  document.getElementById('signedOutView').classList.remove('hidden');
}

function setupForRole() {
  const producerField = document.getElementById('producerFilterField');
  const producerColHeader = document.getElementById('producerColHeader');
  const projectField = document.getElementById('projectFilterField');

  if (currentUser.role === 'admin') {
    producerField.classList.remove('hidden');
    producerColHeader.classList.remove('hidden');
    projectField.classList.remove('hidden');
  } else {
    producerField.classList.add('hidden');
    producerColHeader.classList.add('hidden');
    projectField.classList.add('hidden');
  }
}

// ===================== FILTERS =====================

function setDefaultDateRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 6);

  document.getElementById('toDate').value = formatDateInput(to);
  document.getElementById('fromDate').value = formatDateInput(from);
}

function formatDateInput(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function loadFilterOptions() {
  return callBackend('getFilterOptions', {})
    .then(function (result) {
      if (!result.success) throw new Error(result.error || 'Could not load filters.');

      const producerSelect = document.getElementById('producerSelect');
      producerSelect.innerHTML = '';

      if (currentUser.role === 'admin') {
        const allOpt = document.createElement('option');
        allOpt.value = '';
        allOpt.textContent = 'All producers';
        producerSelect.appendChild(allOpt);
      }

      result.data.producers.forEach(function (p) {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        producerSelect.appendChild(opt);
      });

      if (currentUser.role === 'admin') {
        const projectSelect = document.getElementById('projectSelect');
        projectSelect.innerHTML = '';

        const allProjectsOpt = document.createElement('option');
        allProjectsOpt.value = '';
        allProjectsOpt.textContent = 'All projects';
        projectSelect.appendChild(allProjectsOpt);

        (result.data.projects || []).forEach(function (p) {
          const opt = document.createElement('option');
          opt.value = p;
          opt.textContent = p;
          projectSelect.appendChild(opt);
        });
      }

      // Seed a placeholder until the first getSummary response supplies the
      // real, date/producer-scoped task list (see updateTaskOptions).
      updateTaskOptions([]);
    })
    .catch(function (err) {
      showStatus(err.message, 'error');
    });
}

/**
 * The task dropdown's options depend on the current date range (and, for
 * admins, the selected producer) - a task only shows up if it was actually
 * performed within that scope. Called after every getSummary response with
 * the scoped list the backend just computed from the same row scan.
 * Preserves the current selection when it's still valid; otherwise falls
 * back to "All tasks" rather than silently keeping a now-nonexistent filter.
 */
function updateTaskOptions(taskOptions) {
  const taskSelect = document.getElementById('taskSelect');
  const previousValue = taskSelect.value;

  taskSelect.innerHTML = '';

  const allOpt = document.createElement('option');
  allOpt.value = '';
  allOpt.textContent = 'All tasks';
  taskSelect.appendChild(allOpt);

  (taskOptions || []).forEach(function (t) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    taskSelect.appendChild(opt);
  });

  const stillValid = Array.prototype.some.call(taskSelect.options, function (o) {
    return o.value === previousValue;
  });
  taskSelect.value = stillValid ? previousValue : '';
}

// ===================== SUMMARY LOAD + RENDER =====================

function loadSummary() {
  const from = document.getElementById('fromDate').value;
  const to = document.getElementById('toDate').value;
  const producerId = currentUser.role === 'admin' ? document.getElementById('producerSelect').value : '';
  const project = currentUser.role === 'admin' ? document.getElementById('projectSelect').value : '';
  const taskId = document.getElementById('taskSelect').value;

  showStatus('Loading...', 'info');

  return callBackend('getSummary', { from: from, to: to, producerId: producerId, project: project, taskId: taskId })
    .then(function (result) {
      if (!result.success) throw new Error(result.error || 'Could not load data.');

      hideStatus();
      updateTaskOptions(result.data.taskOptions);
      renderSummaryCards(result.data.rows);
      renderOverallRejectionBreakdown(result.data.overallRejectionCategories);
      renderTable(result.data.rows);

      try {
        renderChart(result.data.rows);
      } catch (chartErr) {
        console.error('Chart rendering failed:', chartErr);
      }
    })
    .catch(function (err) {
      showStatus(err.message, 'error');
    });
}

function renderSummaryCards(rows) {
  const totals = rows.reduce(function (acc, r) {
    acc.total += r.totalHours;
    acc.approved += r.approvedHours;
    acc.pending += r.pendingHours;
    acc.rejected += r.rejectedHours;
    return acc;
  }, { total: 0, approved: 0, pending: 0, rejected: 0 });

  const inspected = totals.approved + totals.rejected;
  const rejectionRate = inspected > 0 ? (totals.rejected / inspected) * 100 : 0;

  const cards = [
    { label: 'Total Production Hours', value: totals.total.toFixed(2) },
    { label: 'Approved Hours', value: totals.approved.toFixed(2) },
    { label: 'QC Pending Hours', value: totals.pending.toFixed(2) },
    { label: 'Rejected Hours', value: totals.rejected.toFixed(2) },
    { label: 'Rejection Rate', value: rejectionRate.toFixed(1) + '%' }
  ];

  const container = document.getElementById('summaryCards');
  container.innerHTML = '';

  cards.forEach(function (c) {
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = '<div class="cardLabel">' + c.label + '</div><div class="cardValue">' + c.value + '</div>';
    container.appendChild(div);
  });
}

function renderChart(rows) {
  const byDate = {};

  rows.forEach(function (r) {
    if (!byDate[r.date]) {
      byDate[r.date] = { approved: 0, pending: 0, rejected: 0 };
    }
    byDate[r.date].approved += r.approvedHours;
    byDate[r.date].pending += r.pendingHours;
    byDate[r.date].rejected += r.rejectedHours;
  });

  const dates = Object.keys(byDate).sort();

  const data = {
    labels: dates,
    datasets: [
      { label: 'Approved', data: dates.map(function (d) { return round2(byDate[d].approved); }), backgroundColor: '#22a06b' },
      { label: 'QC Pending', data: dates.map(function (d) { return round2(byDate[d].pending); }), backgroundColor: '#d29922' },
      { label: 'Rejected', data: dates.map(function (d) { return round2(byDate[d].rejected); }), backgroundColor: '#d9463c' }
    ]
  };

  if (hoursChart) {
    hoursChart.data = data;
    hoursChart.update();
    return;
  }

  const ctx = document.getElementById('hoursChart').getContext('2d');
  hoursChart = new Chart(ctx, {
    type: 'bar',
    data: data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true },
        y: { stacked: true, title: { display: true, text: 'Hours' } }
      },
      plugins: { legend: { position: 'bottom' } }
    }
  });
}

function round2(n) { return Math.round(n * 100) / 100; }

function renderTable(rows) {
  const tbody = document.getElementById('summaryTableBody');
  tbody.innerHTML = '';

  document.getElementById('emptyState').classList.toggle('hidden', rows.length > 0);

  rows.forEach(function (r, index) {
    const inspected = r.approvedHours + r.rejectedHours;
    const rejPct = inspected > 0 ? (r.rejectedHours / inspected) * 100 : 0;

    const tr = document.createElement('tr');

    const producerCell = currentUser.role === 'admin'
      ? '<td data-label="Producer">' + escapeHtml(r.producer) + '</td>'
      : '<td class="hidden"></td>';

    tr.innerHTML =
      '<td data-label="Date">' + r.date + '</td>' +
      producerCell +
      '<td class="numCell" data-label="Total Hrs">' + r.totalHours.toFixed(2) + '</td>' +
      '<td class="numCell" data-label="Approved Hrs">' + r.approvedHours.toFixed(2) + '</td>' +
      '<td class="numCell" data-label="QC Pending Hrs">' + r.pendingHours.toFixed(2) + '</td>' +
      '<td class="numCell" data-label="Rejected Hrs">' + r.rejectedHours.toFixed(2) + '</td>' +
      '<td class="numCell rejectedPct' + (rejPct >= 20 ? ' high' : '') + '" data-label="Rejection %">' + rejPct.toFixed(1) + '%</td>' +
      '<td class="detailsCell"><button class="expandBtn" data-index="' + index + '">Details</button></td>';

    tbody.appendChild(tr);

    if (currentUser.role !== 'admin') {
      tr.children[1].classList.add('hidden');
    }

    const detailTr = document.createElement('tr');
    detailTr.className = 'detailRow hidden';
    const detailTd = document.createElement('td');
    detailTd.colSpan = 8;
    detailTd.appendChild(buildDetailContent(r));
    detailTr.appendChild(detailTd);
    tbody.appendChild(detailTr);

    tr.querySelector('.expandBtn').addEventListener('click', function () {
      detailTr.classList.toggle('hidden');
      this.textContent = detailTr.classList.contains('hidden') ? 'Details' : 'Hide';
    });
  });
}

function buildDetailContent(row) {
  return buildRejectionCategoryList(row.rejectionCategories);
}

function renderOverallRejectionBreakdown(categories) {
  const container = document.getElementById('rejectionBreakdown');
  container.innerHTML = '';
  container.appendChild(buildRejectionCategoryList(categories || []));
}

/**
 * Shared, collapsible category -> reason -> sample-records tree. Used by
 * both the period-wide "Rejection Breakdown" section and each per-row
 * "Details" expand panel, so the interaction is identical everywhere.
 * Categories and reasons start collapsed.
 *
 * When a reason carries a `taskBreakdown` (admin, period-wide view only -
 * see Code.gs), expanding it shows which task types it occurs on and,
 * within each task, which producers ("Major Culprits") are behind it,
 * instead of the flat sample list.
 */
function buildRejectionCategoryList(categories) {
  const wrapper = document.createElement('div');

  if (!categories || categories.length === 0) {
    wrapper.textContent = 'No rejections for the selected filters.';
    return wrapper;
  }

  categories.forEach(function (cat) {
    const block = document.createElement('div');
    block.className = 'categoryBlock';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'categoryToggle';
    toggle.innerHTML =
      '<span><span class="dot rejected"></span>' + escapeHtml(cat.category) + '</span>' +
      '<span>' + cat.hours.toFixed(2) + ' hrs &middot; ' + cat.count + ' task(s) <span class="chevron">&rsaquo;</span></span>';

    const panel = document.createElement('div');
    panel.className = 'reasonPanel hidden';

    cat.reasons.forEach(function (r) {
      panel.appendChild(buildReasonBlock(r));
    });

    toggle.addEventListener('click', function () {
      panel.classList.toggle('hidden');
      toggle.classList.toggle('open');
    });

    block.appendChild(toggle);
    block.appendChild(panel);
    wrapper.appendChild(block);
  });

  return wrapper;
}

function buildSubsectionLabel(text) {
  const label = document.createElement('div');
  label.className = 'subsectionLabel';
  label.textContent = text;
  return label;
}

function buildEmptyInline(text) {
  const div = document.createElement('div');
  div.className = 'emptyInline';
  div.textContent = text;
  return div;
}

function buildReasonBlock(r) {
  const block = document.createElement('div');
  block.className = 'reasonBlock';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'reasonToggle';
  toggle.innerHTML =
    '<span>' + escapeHtml(r.reason) + '</span>' +
    '<span>(' + r.count + ') <span class="chevron">&rsaquo;</span></span>';

  const hasTaskBreakdown = Array.isArray(r.taskBreakdown);

  // Admin, period-wide view: which task types this specific reason occurs
  // on, and which producers are behind each (nested toggles, like the
  // category panel) - not the flat sample list, which doesn't distinguish
  // "who" from "what". Everywhere else (producer role, per-row detail):
  // just the flat, styled sample box as before.
  const panel = document.createElement('div');
  panel.className = (hasTaskBreakdown ? 'reasonPanel' : 'sampleBox') + ' hidden';

  if (hasTaskBreakdown) {
    if (r.taskBreakdown.length === 0) {
      panel.appendChild(buildEmptyInline('No task breakdown available.'));
    } else {
      r.taskBreakdown.forEach(function (t) {
        panel.appendChild(buildTaskBlock(t));
      });
    }
  } else {
    appendSampleList(panel, r.samples);
  }

  toggle.addEventListener('click', function () {
    panel.classList.toggle('hidden');
    toggle.classList.toggle('open');
  });

  block.appendChild(toggle);
  block.appendChild(panel);
  return block;
}

/** Admin-only: one task type's share of a specific reason, expandable to its major culprits. */
function buildTaskBlock(t) {
  const block = document.createElement('div');
  block.className = 'taskBlock';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'reasonToggle taskToggle';
  toggle.innerHTML =
    '<span>' + escapeHtml(t.taskName) + ' <span class="taskIdTag">#' + escapeHtml(String(t.taskId || '?')) + '</span></span>' +
    '<span>' + t.percentOfReason.toFixed(1) + '% of this reason &middot; ' + t.hours.toFixed(2) + ' hrs &middot; ' + t.count + ' task(s) <span class="chevron">&rsaquo;</span></span>';

  const culpritPanel = document.createElement('div');
  culpritPanel.className = 'reasonPanel hidden';
  culpritPanel.appendChild(buildSubsectionLabel('Major Culprits'));

  if (!t.producers || t.producers.length === 0) {
    culpritPanel.appendChild(buildEmptyInline('No producer breakdown available.'));
  } else {
    t.producers.forEach(function (p) {
      culpritPanel.appendChild(buildCulpritBlock(p));
    });
  }

  toggle.addEventListener('click', function () {
    culpritPanel.classList.toggle('hidden');
    toggle.classList.toggle('open');
  });

  block.appendChild(toggle);
  block.appendChild(culpritPanel);
  return block;
}

/** Admin-only: one producer's share of a task within a category, expandable to sample records. */
function buildCulpritBlock(p) {
  const block = document.createElement('div');
  block.className = 'reasonBlock culpritBlock';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'reasonToggle culpritToggle';
  toggle.innerHTML =
    '<span>' + escapeHtml(p.producer) + '</span>' +
    '<span>' + p.count + ' task(s) &middot; ' + p.percentOfTask.toFixed(1) + '% of this task <span class="chevron">&rsaquo;</span></span>';

  const sampleBox = document.createElement('div');
  sampleBox.className = 'sampleBox hidden';
  appendSampleList(sampleBox, p.samples);

  toggle.addEventListener('click', function () {
    sampleBox.classList.toggle('hidden');
    toggle.classList.toggle('open');
  });

  block.appendChild(toggle);
  block.appendChild(sampleBox);
  return block;
}

/** Fills a sampleBox with copyable {dataName, taskName} rows, or an empty note. */
function appendSampleList(sampleBox, samples) {
  if (samples && samples.length > 0) {
    const label = document.createElement('div');
    label.className = 'sampleLabel';
    label.textContent = 'Latest ' + samples.length + ' record(s) from the sheet:';
    sampleBox.appendChild(label);

    const ul = document.createElement('ul');
    ul.className = 'sampleList';
    samples.forEach(function (sample) {
      ul.appendChild(buildCopyableSampleItem(sample));
    });
    sampleBox.appendChild(ul);
  } else {
    sampleBox.textContent = 'No sample records available.';
  }
}

function buildCopyableSampleItem(sample) {
  const li = document.createElement('li');
  li.className = 'sampleItem';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'copyBtn';

  const taskTag = sample.taskName
    ? '<span class="sampleTaskTag">(' + escapeHtml(sample.taskName) + ')</span>'
    : '';

  btn.innerHTML =
    '<span class="sampleTextWrap"><span class="sampleText">' + escapeHtml(sample.dataName) + '</span>' + taskTag + '</span>' +
    '<span class="copyLabel">Copy</span>';

  btn.addEventListener('click', function () {
    copyTextToClipboard(sample.dataName, btn.querySelector('.copyLabel'), btn);
  });

  li.appendChild(btn);
  return li;
}

function copyTextToClipboard(text, labelEl, btnEl) {
  const originalLabel = labelEl.textContent;

  function showCopied() {
    labelEl.textContent = 'Copied';
    if (btnEl) btnEl.classList.add('copied');
    setTimeout(function () {
      labelEl.textContent = originalLabel;
      if (btnEl) btnEl.classList.remove('copied');
    }, 1200);
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(showCopied).catch(function () {
      fallbackCopyToClipboard(text);
      showCopied();
    });
  } else {
    fallbackCopyToClipboard(text);
    showCopied();
  }
}

function fallbackCopyToClipboard(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try { document.execCommand('copy'); } catch (e) { /* best effort */ }
  document.body.removeChild(textarea);
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// ===================== WIRING =====================

document.getElementById('signOutBtn').addEventListener('click', signOut);
document.getElementById('applyFiltersBtn').addEventListener('click', loadSummary);

window.addEventListener('load', function () {
  initGoogleSignIn();

  const redirectResult = consumeAuthRedirect_();

  if (redirectResult && redirectResult.error) {
    showStatus(decodeURIComponent(redirectResult.error), 'error');
  } else if (redirectResult && redirectResult.session) {
    completeSignIn_(redirectResult.session);
  }
});
