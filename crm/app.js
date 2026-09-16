const modules = [
  { key: 'dashboard', label: 'Dashboard', icon: '▦', route: '/dashboard' },
  { key: 'leads', label: 'Leads', icon: '◎', route: '/leads' },
  { key: 'workspace', label: 'Lead Workspace', icon: '◇', route: '/workspace' },
  { key: 'requirements', label: 'Requirements', icon: '◌', route: '/requirements' },
  { key: 'inventory', label: 'Inventory', icon: '▥', route: '/inventory' },
  { key: 'matching', label: 'Matching Engine', navLabel: 'Matching', icon: '✧', route: '/matching' },
  { key: 'shortlist', label: 'Shortlist', icon: '☍', route: '/shortlist' },
  { key: 'sitevisits', label: 'Site Visits', icon: '⌁', route: '/site-visits' },
  { key: 'negotiation', label: 'Negotiation', icon: '☄', route: '/negotiation' },
  { key: 'dealcenter', label: 'Deal Center', navLabel: 'Deals', icon: '◈', route: '/deal-center' },
  { key: 'commission', label: 'Commission', icon: '◍', route: '/commission' },
  { key: 'followups', label: 'Follow-up Center', navLabel: 'Follow-ups', icon: '☎', route: '/followups' },
  { key: 'calendar', label: 'Calendar', icon: '◫', route: '/calendar' },
  { key: 'reports', label: 'Reports', icon: '▣', route: '/reports' },
  { key: 'broker', label: 'Broker Collaboration', icon: '☏', route: '/broker' },
  { key: 'documents', label: 'Documents', icon: '▤', route: '/documents' },
  { key: 'users', label: 'Users', icon: '♢', route: '/users' },
  { key: 'settings', label: 'Settings', icon: '⚙', route: '/settings' },
  { key: 'admin', label: 'Admin Panel', icon: '✦', route: '/admin' }
];

const dashboardKpis = [
  { label: 'Total Leads', value: '126', delta: '+12.4% vs last week' },
  { label: 'New Leads', value: '08', delta: '+03 today' },
  { label: 'Follow-ups Due', value: '24', delta: '06 overdue' },
  { label: 'Active Requirements', value: '31', delta: '12 matching' },
  { label: 'Pipeline Pulse', value: '76%', delta: '+04% confidence' }
];

const leads = [
  { name: 'Rohan Verma', city: 'Bengaluru', phone: '+91 98765 43210', email: 'rohan.v@example.com', status: 'Active', req: 2, lastActivity: 'Today, 10:30', agent: 'Asha Menon', source: 'Web' },
  { name: 'Meera Iyer', city: 'Mumbai', phone: '+91 98220 11888', email: 'meera.i@example.com', status: 'New', req: 1, lastActivity: 'Yesterday', agent: 'Kabir Shah', source: 'Referral' },
  { name: 'Karan & Priya', city: 'Pune', phone: '+91 99001 77440', email: 'karan.priya@example.com', status: 'Verified', req: 3, lastActivity: '2 days ago', agent: 'Jatin Sharma', source: 'Builder' },
  { name: 'Sana Khan', city: 'Hyderabad', phone: '+91 98102 91822', email: 'sana.k@example.com', status: 'Blacklisted', req: 0, lastActivity: '18 Mar 2026', agent: 'Asha Menon', source: 'Broker' }
];

const ADMIN_SESSION = {
  userId: 'USR-0001',
  role: 'ADMIN'
};

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

async function adminRequest(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'x-user-id': ADMIN_SESSION.userId,
    'x-user-role': ADMIN_SESSION.role,
    ...(options.headers || {})
  };

  return fetch(url, { ...options, headers });
}

const renderNavigation = () => {
  const nav = document.getElementById('app-navigation');
  nav.innerHTML = '';

  // Clients — hard navigation to V2 client page
  const clientsLink = document.createElement('a');
  clientsLink.href = '/clients';
  clientsLink.className = 'nav-link' + (window.location.pathname.startsWith('/client') ? ' active' : '');
  clientsLink.innerHTML = `<i>◉</i><span>Clients</span>`;
  nav.appendChild(clientsLink);

  // Agent-facing module nav — only show relevant operational modules
  const VISIBLE_KEYS = ['dashboard','inventory','matching','sitevisits','dealcenter','commission','followups','calendar','reports','settings'];

  modules.filter(m => VISIBLE_KEYS.includes(m.key)).forEach((module, index) => {
    const link = document.createElement('a');
    link.href = '#';
    link.dataset.key = module.key;
    link.className = 'nav-link nav-module-link' + (index === 0 ? ' active' : '');
    link.innerHTML = `<i>${module.icon}</i><span>${module.navLabel || module.label}</span>`;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      renderModule(module.key);
    });
    nav.appendChild(link);
  });
};

function renderModule(key) {
  const pageMap = {
    dashboard: renderDashboard,
    leads: renderLeads,
    workspace: renderLeadWorkspace,
    requirements: renderRequirements,
    inventory: renderInventory,
    matching: renderMatching,
    shortlist: renderShortlist,
    sitevisits: renderSiteVisits,
    negotiation: renderNegotiation,
    dealcenter: renderDealCenter,
    commission: renderCommission,
    followups: renderFollowups,
    calendar: renderCalendar,
    reports: renderReports,
    broker: renderBrokers,
    documents: renderDocuments,
    users: renderUsers,
    settings: renderSettings,
    admin: renderAdmin
  };

  const module = modules.find((m) => m.key === key) || modules[0];
  const title = pageMap[key] || renderDashboard;
  document.getElementById('page-title').textContent = module.label;
  document.getElementById('page-kicker').textContent = 'SIGNATURE PROPERTIES / ' + module.label.toUpperCase();

  document.querySelectorAll('#app-navigation .nav-module-link').forEach(link => {
    link.classList.toggle('active', link.dataset.key === key);
  });

  title();
}

async function renderDashboard() {
  const content = document.getElementById('app-content');

  try {
    const response = await fetch('/api/dashboard');
    const payload = await response.json();

    const summary = payload.data || {};
    const kpiCards = [
      { label: 'Total Leads', value: summary.totalLeads || 0, delta: 'Live CRM' },
      { label: 'New Leads', value: summary.newLeads || 0, delta: 'Today' },
      { label: 'Follow-ups Due', value: summary.followUpsDue || 0, delta: 'Due now' },
      { label: 'Active Requirements', value: summary.activeRequirements || 0, delta: 'Open' },
      { label: 'Pipeline Pulse', value: `${summary.pipelinePulse || 0}%`, delta: 'Health' }
    ];

    content.innerHTML = `
      <section class="kpi-grid">
        ${kpiCards.map((item) => `
          <article class="kpi-card">
            <div class="label">${item.label}</div>
            <div class="value">${item.value}</div>
            <div class="delta">${item.delta}</div>
          </article>
        `).join('')}
      </section>

      <section class="metrics-row">
        <article class="card-section">
          <div class="card-header">
            <h2>Pipeline Pulse</h2>
            <span class="subtle">MAY 2026</span>
          </div>
          <div class="chart-panel">
            <div class="chart-block">
              ${[62, 88, 62, 118, 94, 120, 74].map((height, idx) => `<div class="bar-item"><div class="bar" style="height:${height}px"></div><div class="bar-label">${['M','T','W','T','F','S','S'][idx]}</div></div>`).join('')}
            </div>
          </div>
        </article>

        <aside class="card-section">
          <div class="card-header">
            <h2>Follow-up Focus</h2>
            <span class="badge green">Live</span>
          </div>
          <div class="empty-state">
            <div class="status-line"><span class="status-dot"></span> ${summary.followUpsDue || 0} follow-ups due at the brokerage</div>
            <div class="tiny">Asha Menon • Verma Residence • Negotiation</div>
          </div>
        </aside>
      </section>

      <section class="card-section">
        <div class="card-header">
          <h2>Workspace Health</h2>
          <span class="badge slate">Operating</span>
        </div>
        <div class="workspace-summary">
          <div class="summary-card">
            <div class="title">Network Health</div>
            <div class="big">91%</div>
            <div class="status-line"><span class="status-dot"></span> Lead intake and matching synchronized</div>
          </div>
          <div class="summary-card">
            <div class="title">Critical Tasks</div>
            <div class="big">03</div>
            <div class="status-line"><span class="status-dot"></span> Deal stage missing document set</div>
          </div>
        </div>
      </section>
    `;
  } catch (error) {
    content.innerHTML = `<div class="empty-state">Dashboard API error: ${error.message}</div>`;
  }
}

async function renderLeads() {
  const content = document.getElementById('app-content');

  try {
    const response = await fetch('/api/leads');
    const payload = await response.json();
    const leads = payload.data || [];

    content.innerHTML = `
      <section class="card-section">
        <div class="card-header">
          <h2>Leads</h2>
          <div class="top-actions">
            <button class="btn btn-soft">Filters</button>
            <button class="btn btn-primary" id="createLeadBtn">+ Create Lead</button>
          </div>
        </div>
        <table class="leads-table">
          <thead>
            <tr>
              <th>Client</th>
              <th>City</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Status</th>
              <th>Requirements</th>
              <th>Last Activity</th>
              <th>Assigned Agent</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${leads.map((lead) => `
              <tr>
                <td><strong>${lead.ClientName || lead.clientName}</strong></td>
                <td>${lead.City || lead.city}</td>
                <td>${lead.Phone || lead.phone}</td>
                <td>${lead.Email || lead.email}</td>
                <td><span class="badge ${lead.LeadStatus === 'Blacklisted' ? 'red' : lead.LeadStatus === 'New' ? 'gold' : 'green'}">${lead.LeadStatus || lead.leadStatus}</span></td>
                <td>${lead.RequirementCount || 0}</td>
                <td>${lead.last_activity_at || lead.lastActivityAt || '—'}</td>
                <td>${lead.AssignedAgentID || lead.assignedAgentId || '—'}</td>
                <td><button class="btn btn-soft open-lead" data-lead-id="${lead.LeadID || lead.leadId}">Open</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </section>
    `;

    document.getElementById('createLeadBtn').addEventListener('click', () => {
      renderCreateLeadForm();
    });

    document.querySelectorAll('[data-lead-id]').forEach((button) => {
      button.addEventListener('click', () => renderLeadWorkspace(button.dataset.leadId));
    });
  } catch (error) {
    content.innerHTML = `<div class="empty-state">Could not load leads: ${error.message}</div>`;
  }
}

async function renderLeadWorkspace(leadId = null) {
  try {
    if (!leadId) {
      const leadListResponse = await fetch('/api/leads');
      const leadListPayload = await leadListResponse.json();
      const firstLead = (leadListPayload.data || [])[0];
      if (!firstLead) {
        const content = document.getElementById('app-content');
        content.innerHTML = `<div class="empty-state">No leads found to open workspace</div>`;
        return;
      }
      leadId = firstLead.LeadID || firstLead.leadId;
    }

    const response = await fetch(`/api/leads/${leadId}/workspace`);
    const payload = await response.json();
    if (!payload.ok) {
      throw new Error(payload.error || 'Could not open workspace');
    }

    const workspace = payload.data;
    const lead = workspace.lead;
    document.body.dataset.currentLeadId = lead.LeadID || lead.leadId || '';

    const content = document.getElementById('app-content');
    content.innerHTML = `
      <section class="card-section">
        <div class="card-header">
          <h2>Lead Workspace</h2>
          <div class="top-actions">
            <button class="btn btn-soft back-to-leads">Back to Leads</button>
            <span class="badge green">Lead ID: ${lead.LeadID}</span>
          </div>
        </div>
        <div class="workspace-summary">
          <div class="summary-card">
            <div class="title">Lead Summary</div>
            <div class="big">${lead.ClientName}</div>
            <p class="tiny">${lead.City} • ${lead.LeadStatus} • Phone ${lead.Phone} • ${lead.Email}</p>
            <div class="status-line"><span class="status-dot"></span> Status: ${lead.LeadStatus}</div>
          </div>
          <div class="summary-card">
            <div class="title">Workspace Health</div>
            <div class="big">Healthy</div>
            <div class="status-line"><span class="status-dot"></span> ${workspace.transactions.length} transactions • ${workspace.requirements.length} requirements</div>
          </div>
        </div>
      </section>

      <section class="reports-grid">
        <article class="report-box">
          <h3>Transactions</h3>
          <div class="number">${workspace.transactions.length}</div>
          <div class="tiny">${workspace.transactions.map((t) => t.Type).join(', ') || 'No transactions'}</div>
        </article>
        <article class="report-box">
          <h3>Requirements</h3>
          <div class="number">${workspace.requirements.length}</div>
          <div class="tiny">${workspace.requirements.map((r) => r.Status).join(', ') || 'None'}</div>
        </article>
        <article class="report-box">
          <h3>Shortlist</h3>
          <div class="number">${workspace.shortlist.length}</div>
          <div class="tiny">${workspace.shortlist.length} saved selections</div>
        </article>
      </section>

      <section class="card-section">
        <div class="card-header">
          <h2>Requirements</h2>
          <button class="btn btn-primary add-requirement" data-lead-id="${lead.LeadID}">+ Add Requirement</button>
        </div>
        <table class="leads-table">
          <thead><tr><th>Requirement</th><th>Category</th><th>Budget</th><th>Location</th><th>Status</th><th>Transaction</th><th>Action</th></tr></thead>
          <tbody>
            ${workspace.requirements.map((req) => `
              <tr>
                <td>${req.RequirementCode || req.RequirementID}</td>
                <td>${req.Category}</td>
                <td>${req.BudgetMin || req.budgetMin} - ${req.BudgetMax || req.budgetMax}</td>
                <td>${req.Location1 || req.location1}</td>
                <td><span class="badge ${req.Status === 'Cancelled' ? 'red' : req.Status === 'On Hold' ? 'gold' : 'green'}">${req.Status}</span></td>
                <td>${req.TransactionType || req.transactionType}</td>
                <td>
                  <div class="req-actions-row" data-requirement-id="${req.RequirementID}">
                    <button class="btn btn-soft edit-requirement" data-requirement-id="${req.RequirementID}">Edit</button>
                    <button class="btn btn-soft action-btn" data-action="match" data-requirement-id="${req.RequirementID}" title="Run Matching">Match</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </section>
    `;

    document.querySelector('.back-to-leads').addEventListener('click', () => renderLeads());
    document.querySelector('[data-lead-id]').addEventListener('click', () => { renderRequirementForm(leadId); });
    document.querySelectorAll('[data-requirement-id]').forEach((btn) => {
      btn.addEventListener('click', () => renderRequirementEdit(btn.dataset.requirementId));
    });
    document.querySelectorAll('[data-action="match"]').forEach((button) => {
      button.addEventListener('click', () => renderMatching(button.dataset.requirementId));
    });
  } catch (error) {
    document.getElementById('app-content').innerHTML = `<div class="empty-state">Could not open workspace: ${error.message}</div>`;
  }
}

async function renderRequirements() {
  const content = document.getElementById('app-content');

  try {
    const response = await fetch('/api/requirements');
    const payload = await response.json();
    const requirements = payload.data || [];

    content.innerHTML = `
      <section class="card-section">
        <div class="card-header">
          <h2>Requirements</h2>
          <div class="top-actions">
            <button class="btn btn-soft">Filters</button>
            <button class="btn btn-primary" id="createRequirementBtn">+ New Requirement</button>
          </div>
        </div>
        <table class="leads-table">
          <thead>
            <tr>
              <th>Requirement Code</th>
              <th>Lead</th>
              <th>Transaction</th>
              <th>Category</th>
              <th>Location</th>
              <th>Status</th>
              <th>Budget</th>
              <th>Updated</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${requirements.map((req) => `
              <tr>
                <td>${req.RequirementCode || req.RequirementID}</td>
                <td>${req.LeadID || req.leadId || '—'}</td>
                <td>${req.TransactionType || req.transactionType || req.TransactionID || '—'}</td>
                <td>${req.Category || req.category || '—'}</td>
                <td>${req.Location1 || req.location1 || '—'}</td>
                <td><span class="badge ${req.Status === 'Cancelled' ? 'red' : req.Status === 'On Hold' ? 'gold' : 'green'}">${req.Status || 'Active'}</span></td>
                <td>${req.BudgetMin || req.budgetMin || '—'} - ${req.BudgetMax || req.budgetMax || '—'}</td>
                <td>${req.UpdatedAt || req.updatedAt || '—'}</td>
                <td>
                  <div class="req-actions-row" data-requirement-id="${req.RequirementID || req.requirementId}">
                    <button class="btn btn-soft action-btn" title="Edit Requirement" data-action="edit" data-requirement-id="${req.RequirementID || req.requirementId}">Edit</button>
                    <button class="btn btn-soft action-btn" title="Duplicate Requirement" data-action="duplicate" data-requirement-id="${req.RequirementID || req.requirementId}">Duplicate</button>
                    <button class="btn btn-soft action-btn" title="Status" data-action="status" data-requirement-id="${req.RequirementID || req.requirementId}">Status</button>
                    <button class="btn btn-soft action-btn" title="Requirement History" data-action="history" data-requirement-id="${req.RequirementID || req.requirementId}">History</button>
                    <button class="btn btn-soft action-btn" title="Share to Broker" data-action="share" data-requirement-id="${req.RequirementID || req.requirementId}">Share</button>
                    <button class="btn btn-soft action-btn" title="Archive Requirement" data-action="archive" data-requirement-id="${req.RequirementID || req.requirementId}">Archive</button>
                    <button class="btn btn-soft action-btn" title="Run Matching" data-action="match" data-requirement-id="${req.RequirementID || req.requirementId}">Match</button>
                  </div>
                </td>
              </tr>
            `).join('') || `<tr><td colspan="9"><div class="empty-state">No requirements found</div></td></tr>`}
          </tbody>
        </table>
      </section>
      <div id="share-sheet-overlay" class="share-sheet-overlay" hidden>
        <div id="share-sheet-panel" class="share-sheet-panel">
          <div class="share-sheet-header">
            <h3>Share Requirement</h3>
            <button class="btn btn-soft" id="close-share-sheet">Close</button>
          </div>
          <div class="share-sheet-content">
            <div class="field-group">
              <label class="field">
                <span>Select Broker(s)</span>
                <select><option>Astra Realty Co.</option><option>Urban Crest Brokers</option></select>
              </label>
            </div>
            <div class="field-group">
              <label class="field">
                <span>Link Expiry</span>
                <select><option>24 hours</option><option>72 hours</option></select>
              </label>
            </div>
            <div class="field-group">
              <label class="field">
                <span>Message Template</span>
                <textarea>Hi, please review this requirement shortlist.</textarea>
              </label>
            </div>
            <div class="top-actions">
              <button class="btn btn-primary" id="sendShare">Send to ... Brokers</button>
            </div>
          </div>
        </div>
      </div>
    `;

    const createBtn = document.getElementById('createRequirementBtn');
    if (createBtn) {
      createBtn.addEventListener('click', () => renderRequirementForm());
    }

    document.querySelectorAll('[data-action="edit"]').forEach((button) => {
      button.addEventListener('click', () => renderRequirementEdit(button.dataset.requirementId));
    });

    document.querySelectorAll('[data-action="duplicate"]').forEach((button) => {
      button.addEventListener('click', async () => {
        const response = await fetch(`/api/requirements/${button.dataset.requirementId}/duplicate`);
        const result = await response.json();
        if (result.ok) {
          renderRequirements();
        }
      });
    });

    document.querySelectorAll('[data-action="archive"]').forEach((button) => {
      button.addEventListener('click', async () => {
        const response = await fetch(`/api/requirements/${button.dataset.requirementId}/archive`, { method: 'POST' });
        const result = await response.json();
        if (result.ok) {
          renderRequirements();
        }
      });
    });

    document.querySelectorAll('[data-action="match"]').forEach((button) => {
      button.addEventListener('click', () => renderMatching(button.dataset.requirementId));
    });

    document.querySelectorAll('[data-action="history"]').forEach((button) => {
      button.addEventListener('click', async () => {
        const response = await fetch(`/api/requirements/${button.dataset.requirementId}`);
        const payload = await response.json();
        const requirement = payload.data || payload;
        alert(`Version History: ${requirement.RequirementID || requirement.RequirementCode}`);
      });
    });

    document.querySelectorAll('[title="Share to Broker"]').forEach((button) => {
      button.addEventListener('click', () => {
        const overlay = document.getElementById('share-sheet-overlay');
        const panel = document.getElementById('share-sheet-panel');
        if (overlay && panel) {
          overlay.hidden = false;
          overlay.style.display = 'flex';
        }
      });
    });

    const closeShare = document.getElementById('close-share-sheet');
    if (closeShare) {
      closeShare.addEventListener('click', () => {
        const overlay = document.getElementById('share-sheet-overlay');
        if (overlay) {
          overlay.hidden = true;
          overlay.style.display = 'none';
        }
      });
    }
  } catch (error) {
    content.innerHTML = `<div class="empty-state">Could not load requirements: ${error.message}</div>`;
  }
}

function renderCreateLeadForm() {
  const content = document.getElementById('app-content');
  content.innerHTML = `
    <section class="card-section">
      <div class="card-header">
        <h2>Create Lead</h2>
        <button class="btn btn-soft back-to-leads">Back to Leads</button>
      </div>
      <form id="lead-form" class="form-stack">
        <div class="two-col">
          <label class="field">
            <span>Client Name</span>
            <input name="clientName" required />
          </label>
          <label class="field">
            <span>City</span>
            <input name="city" required />
          </label>
          <label class="field">
            <span>Phone</span>
            <input name="phone" required />
          </label>
          <label class="field">
            <span>Email</span>
            <input name="email" type="email" required />
          </label>
          <label class="field">
            <span>Status</span>
            <select name="leadStatus">
              <option>New</option>
              <option>Qualified</option>
              <option>Verified</option>
              <option>Active</option>
              <option>Blacklisted</option>
            </select>
          </label>
          <label class="field">
            <span>Assigned Agent</span>
            <input name="assignedAgentId" value="USR-0001" />
          </label>
        </div>
        <div class="top-actions">
          <button class="btn btn-primary" type="submit">Save Lead</button>
          <button class="btn btn-soft" type="button" id="cancelLead">Cancel</button>
        </div>
      </form>
    </section>
  `;

  document.querySelector('.back-to-leads').addEventListener('click', () => renderLeads());
  document.getElementById('cancelLead').addEventListener('click', () => renderLeads());

  const form = document.getElementById('lead-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(form).entries());

    const response = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (result.ok) {
      renderLeads();
    } else {
      content.innerHTML = `<div class="empty-state">Could not create lead: ${result.error || 'Validation failed'}</div>`;
    }
  });
}

function renderRequirementForm(leadId = null) {
  const content = document.getElementById('app-content');
  content.innerHTML = `
    <section class="card-section">
      <div class="card-header">
        <h2>${leadId ? 'Create Requirement' : 'Create Requirement'}</h2>
        <button class="btn btn-soft back-to-requirements">Back to Requirements</button>
      </div>
      <form id="requirement-form" class="form-stack">
        <div class="two-col">
          <label class="field">
            <span>Lead ID</span>
            <input name="leadId" value="${leadId || 'LEAD-0001'}" required />
          </label>
          <label class="field">
            <span>Transaction Type</span>
            <select name="transactionType">
              <option value="Purchase" selected>Purchase</option>
              <option value="Rent">Rent</option>
              <option value="Rent Out">Rent Out</option>
              <option value="Sale">Sale</option>
            </select>
          </label>
          <label class="field">
            <span>Category</span>
            <select name="category">
              <option value="Residential" selected>Residential</option>
              <option value="Commercial">Commercial</option>
              <option value="Land">Land</option>
              <option value="Industrial">Industrial</option>
            </select>
          </label>
          <label class="field">
            <span>Property Type</span>
            <input name="propertyType" value="Apartment" />
          </label>
          <label class="field">
            <span>Sub Category</span>
            <input name="subCategory" value="Apartment" />
          </label>
          <label class="field">
            <span>Location 1</span>
            <input name="location1" value="Bengaluru East" />
          </label>
          <label class="field">
            <span>Location 2</span>
            <input name="location2" value="Whitefield" />
          </label>
          <label class="field">
            <span>Location 3</span>
            <input name="location3" value="ITPL" />
          </label>
          <label class="field">
            <span>Budget Min</span>
            <input name="budgetMin" type="number" value="12000000" />
          </label>
          <label class="field">
            <span>Budget Max</span>
            <input name="budgetMax" type="number" value="15000000" />
          </label>
          <label class="field">
            <span>Possession</span>
            <input name="possession" value="Ready" />
          </label>
          <label class="field">
            <span>Urgency</span>
            <select name="urgency">
              <option value="High" selected>High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
          </label>
          <label class="field wide">
            <span>Special Notes</span>
            <textarea name="specialNotes">Need immediate shortlist</textarea>
          </label>
        </div>
        <div class="top-actions">
          <button class="btn btn-primary" type="submit">Save Requirement</button>
          <button class="btn btn-soft" type="button" id="cancelRequirement">Cancel</button>
        </div>
      </form>
    </section>
  `;

  document.querySelector('.back-to-requirements').addEventListener('click', () => renderRequirements());
  document.getElementById('cancelRequirement').addEventListener('click', () => renderRequirements());

  const form = document.getElementById('requirement-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(form).entries());

    const response = await fetch('/api/requirements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (result.ok) {
      renderRequirements();
    } else {
      content.innerHTML = `<div class="empty-state">Requirement could not be created: ${JSON.stringify(result.errors || result.error)}</div>`;
    }
  });
}

async function renderRequirementEdit(requirementId) {
  const content = document.getElementById('app-content');

  try {
    const response = await fetch(`/api/requirements/${requirementId}`);
    const payload = await response.json();
    const requirement = payload.data || payload;

    content.innerHTML = `
      <section class="card-section">
        <div class="card-header">
          <h2>Edit Requirement ${requirement.RequirementCode || requirement.RequirementID}</h2>
          <button class="btn btn-soft back-to-requirements">Back to Requirements</button>
        </div>
        <form id="edit-requirement-form" class="form-stack">
          <input type="hidden" name="requirementId" value="${requirement.RequirementID}" />
          <div class="two-col">
            <label class="field">
              <span>Lead ID</span>
              <input name="leadId" value="${requirement.LeadID || ''}" required />
            </label>
            <label class="field">
              <span>Transaction Type</span>
              <select name="transactionType">
                <option value="Purchase" ${requirement.TransactionType === 'Purchase' ? 'selected' : ''}>Purchase</option>
                <option value="Rent" ${requirement.TransactionType === 'Rent' ? 'selected' : ''}>Rent</option>
                <option value="Rent Out" ${requirement.TransactionType === 'Rent Out' ? 'selected' : ''}>Rent Out</option>
                <option value="Sale" ${requirement.TransactionType === 'Sale' ? 'selected' : ''}>Sale</option>
              </select>
            </label>
            <label class="field">
              <span>Category</span>
              <select name="category">
                <option value="Residential" ${requirement.Category === 'Residential' ? 'selected' : ''}>Residential</option>
                <option value="Commercial" ${requirement.Category === 'Commercial' ? 'selected' : ''}>Commercial</option>
                <option value="Land" ${requirement.Category === 'Land' ? 'selected' : ''}>Land</option>
                <option value="Industrial" ${requirement.Category === 'Industrial' ? 'selected' : ''}>Industrial</option>
              </select>
            </label>
            <label class="field">
              <span>Property Type</span>
              <input name="propertyType" value="${requirement.PropertyType || ''}" />
            </label>
            <label class="field">
              <span>Sub Category</span>
              <input name="subCategory" value="${requirement.SubCategory || ''}" />
            </label>
            <label class="field">
              <span>Location 1</span>
              <input name="location1" value="${requirement.Location1 || ''}" />
            </label>
            <label class="field">
              <span>Location 2</span>
              <input name="location2" value="${requirement.Location2 || ''}" />
            </label>
            <label class="field">
              <span>Location 3</span>
              <input name="location3" value="${requirement.Location3 || ''}" />
            </label>
            <label class="field">
              <span>Budget Min</span>
              <input name="budgetMin" type="number" value="${requirement.BudgetMin || ''}" />
            </label>
            <label class="field">
              <span>Budget Max</span>
              <input name="budgetMax" type="number" value="${requirement.BudgetMax || ''}" />
            </label>
            <label class="field">
              <span>Possession</span>
              <input name="possession" value="${requirement.Possession || ''}" />
            </label>
            <label class="field">
              <span>Urgency</span>
              <select name="urgency">
                <option value="High" ${requirement.Urgency === 'High' ? 'selected' : ''}>High</option>
                <option value="Medium" ${requirement.Urgency === 'Medium' ? 'selected' : ''}>Medium</option>
                <option value="Low" ${requirement.Urgency === 'Low' ? 'selected' : ''}>Low</option>
              </select>
            </label>
            <label class="field">
              <span>Status</span>
              <select name="status">
                <option value="Active" ${requirement.Status === 'Active' ? 'selected' : ''}>Active</option>
                <option value="On Hold" ${requirement.Status === 'On Hold' ? 'selected' : ''}>On Hold</option>
                <option value="Negotiation" ${requirement.Status === 'Negotiation' ? 'selected' : ''}>Negotiation</option>
                <option value="Cancelled" ${requirement.Status === 'Cancelled' ? 'selected' : ''}>Cancelled</option>
              </select>
            </label>
            <label class="field wide">
              <span>Special Notes</span>
              <textarea name="specialNotes">${requirement.SpecialNotes || ''}</textarea>
            </label>
          </div>
          <div class="top-actions">
            <button class="btn btn-primary" type="submit">Update Requirement</button>
            <button class="btn btn-soft" type="button" id="cancelEdit">Cancel</button>
          </div>
        </form>
      </section>
    `;

    document.querySelector('.back-to-requirements').addEventListener('click', () => renderRequirements());
    document.getElementById('cancelEdit').addEventListener('click', () => renderRequirements());

    const form = document.getElementById('edit-requirement-form');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = Object.fromEntries(new FormData(form).entries());

      const response = await fetch(`/api/requirements/${requirement.RequirementID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      if (result.ok) {
        renderRequirements();
      } else {
        content.innerHTML = `<div class="empty-state">Requirement could not be updated: ${JSON.stringify(result.errors || result.error)}</div>`;
      }
    });
  } catch (error) {
    content.innerHTML = `<div class="empty-state">Could not load requirement: ${error.message}</div>`;
  }
}

async function renderInventory() {
  const content = document.getElementById('app-content');

  try {
    const response = await fetch('/api/inventory');
    const payload = await response.json();
    const inventory = payload.data || [];

    content.innerHTML = `
      <section class="card-section">
        <div class="card-header">
          <h2>Inventory</h2>
          <button class="btn btn-primary">+ Add Property</button>
        </div>
        <table class="leads-table">
          <thead>
            <tr>
              <th>Property ID</th>
              <th>Project</th>
              <th>Category</th>
              <th>Location</th>
              <th>Area</th>
              <th>Price</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${inventory.map((property) => `
              <tr>
                <td>${property.PropertyID || property.propertyId || '—'}</td>
                <td>${property.Project || property.project || '—'}</td>
                <td>${property.Category || property.category || '—'}</td>
                <td>${property.Location || property.location || '—'}</td>
                <td>${property.Area || property.area || '—'}</td>
                <td>${property.Price || property.price || '—'}</td>
                <td><span class="badge ${property.Status === 'Available' ? 'green' : property.Status === 'Shortlisted' ? 'gold' : 'slate'}">${property.Status || property.status || '—'}</span></td>
              </tr>
            `).join('') || '<tr><td colspan="7"><div class="empty-state">No inventory found</div></td></tr>'}
          </tbody>
        </table>
      </section>
    `;
  } catch (error) {
    content.innerHTML = `<div class="empty-state">Could not load inventory: ${error.message}</div>`;
  }
}

function renderMatchCriteriaList(items, tone = 'matched') {
  if (!items || items.length === 0) {
    return `<div class="match-criteria-empty">None</div>`;
  }

  return items.map((item) => `<span class="criterion-pill ${tone}">${escapeHtml(item)}</span>`).join('');
}

function renderMatchCard(match, shortlist = null) {
  const breakdown = match.ScoreBreakdown || {};
  const matched = match.MatchedCriteria || [];
  const failed = match.FailedCriteria || [];
  const unknown = match.UnknownCriteria || [];
  const scoreLevelClass = match.MatchLevel === 'Excellent' ? 'green' : match.MatchLevel === 'Strong' ? 'gold' : 'slate';
  const propertyType = match.PropertyType || match.propertyType || '—';
  const location = match.Location || match.location || '—';
  const price = match.Price || match.price || '—';
  const area = match.Area || match.area || '—';
  const bhk = match.BHK || match.bhk || '—';
  const isShortlisted = shortlist && shortlist.Status === 'Active';
  const shortlistState = isShortlisted ? 'shortlisted' : 'not-shortlisted';
  const shortlistButtonText = isShortlisted ? '✓ Shortlisted' : 'Add to Shortlist';
  const shortlistPriority = shortlist?.Priority || 'Medium';
  const shortlistNotes = shortlist?.Notes || '';

  return `
    <article class="match-card" data-match-id="${escapeHtml(match.MatchID)}" data-property-id="${escapeHtml(match.PropertyID)}" data-score="${escapeHtml(String(match.Score))}" data-level="${escapeHtml(match.MatchLevel)}" data-shortlist-state="${escapeHtml(shortlistState)}" data-shortlist-id="${escapeHtml(shortlist?.ShortlistID || '')}">
      <div class="match-card-top">
        <div>
          <div class="match-id">${escapeHtml(match.MatchID)}</div>
          <div class="match-property">${escapeHtml(match.PropertyID)}</div>
        </div>
        <div class="match-score-badge ${scoreLevelClass}">${escapeHtml(String(match.Score))} / 100</div>
      </div>
      <div class="match-property-name">${escapeHtml(propertyType)}</div>
      <div class="match-property-meta">${escapeHtml(location)} • ₹${escapeHtml(String(price))} • ${escapeHtml(String(area))} sq.ft • BHK ${escapeHtml(String(bhk))}</div>
      <div class="match-level ${scoreLevelClass}">${escapeHtml(match.MatchLevel)}</div>
      <div class="match-section">
        <div class="match-section-title">Matched Criteria</div>
        <div class="match-criteria-list">${renderMatchCriteriaList(matched, 'matched')}</div>
      </div>
      <div class="match-section">
        <div class="match-section-title">Failed Criteria</div>
        <div class="match-criteria-list">${renderMatchCriteriaList(failed, 'failed')}</div>
      </div>
      <div class="match-section">
        <div class="match-section-title">Unknown Criteria</div>
        <div class="match-criteria-list">${renderMatchCriteriaList(unknown, 'unknown')}</div>
      </div>
      <div class="match-breakdown">
        ${Object.entries(breakdown).map(([key, value]) => `
          <div class="breakdown-row">
            <span>${escapeHtml(key)}</span>
            <span>${escapeHtml(value.status || 'unknown')} • ${escapeHtml(String(value.points ?? 0))}/${escapeHtml(String(value.weight ?? 0))}</span>
          </div>
        `).join('')}
      </div>
      <div class="match-explanation">${escapeHtml(match.Explanation || '')}</div>
      <div class="match-shortlist-controls">
        <label class="field compact">
          <span>Priority</span>
          <select class="shortlist-priority" data-property-id="${escapeHtml(match.PropertyID)}">
            <option value="High" ${shortlistPriority === 'High' ? 'selected' : ''}>High</option>
            <option value="Medium" ${shortlistPriority === 'Medium' ? 'selected' : ''}>Medium</option>
            <option value="Low" ${shortlistPriority === 'Low' ? 'selected' : ''}>Low</option>
          </select>
        </label>
        <label class="field compact grow">
          <span>Notes</span>
          <input class="shortlist-notes" data-property-id="${escapeHtml(match.PropertyID)}" value="${escapeHtml(shortlistNotes)}" placeholder="Optional shortlist note" />
        </label>
        <button class="btn ${isShortlisted ? 'btn-soft' : 'btn-primary'} add-shortlist-btn" data-requirement-id="${escapeHtml(match.RequirementID)}" data-match-id="${escapeHtml(match.MatchID)}" data-property-id="${escapeHtml(match.PropertyID)}" ${isShortlisted ? 'disabled' : ''}>${shortlistButtonText}</button>
      </div>
    </article>
  `;
}

async function loadActiveShortlistByRequirement(requirementId) {
  const response = await fetch(`/api/requirements/${requirementId}/shortlist?status=Active`);
  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(payload.error || 'Could not load shortlist');
  }

  const byProperty = new Map();
  for (const item of payload.data || []) {
    byProperty.set(item.PropertyID, item);
  }
  return byProperty;
}

function attachMatchingShortlistActions(requirementId, shortlistMap, onShortlistChange) {
  const buttons = document.querySelectorAll('.add-shortlist-btn');
  buttons.forEach((button) => {
    button.addEventListener('click', async () => {
      const propertyId = button.dataset.propertyId;
      const matchId = button.dataset.matchId;
      const priority = document.querySelector(`.shortlist-priority[data-property-id="${propertyId}"]`)?.value || 'Medium';
      const notes = document.querySelector(`.shortlist-notes[data-property-id="${propertyId}"]`)?.value || '';

      button.disabled = true;
      const oldText = button.textContent;
      button.textContent = 'Saving...';

      try {
        const response = await fetch('/api/shortlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requirementId,
            propertyId,
            matchId,
            priority,
            notes
          })
        });

        const payload = await response.json();
        if (!payload.ok) {
          throw new Error(payload.error || 'Could not add shortlist');
        }

        shortlistMap.set(propertyId, payload.data);
        button.classList.remove('btn-primary');
        button.classList.add('btn-soft');
        button.textContent = '✓ Shortlisted';
        button.disabled = true;
        button.closest('.match-card')?.setAttribute('data-shortlist-state', 'shortlisted');
        button.closest('.match-card')?.setAttribute('data-shortlist-id', payload.data.ShortlistID);
        if (onShortlistChange) {
          onShortlistChange(shortlistMap);
        }
      } catch (error) {
        button.textContent = oldText;
        button.disabled = false;
        const results = document.getElementById('matchingResults');
        if (results) {
          results.insertAdjacentHTML('afterbegin', `<div class="match-error">Could not add shortlist: ${escapeHtml(error.message)}</div>`);
        }
      }
    });
  });
}

async function renderMatching(requirementId = null) {
  const content = document.getElementById('app-content');
  content.innerHTML = `<section class="card-section"><div class="empty-state">Finding matching properties...</div></section>`;

  try {
    let activeRequirementId = requirementId;

    if (!activeRequirementId) {
      const requirementListResponse = await fetch('/api/requirements');
      const requirementListPayload = await requirementListResponse.json();
      const firstRequirement = (requirementListPayload.data || [])[0];
      if (!firstRequirement) {
        content.innerHTML = `<section class="card-section"><div class="empty-state">No requirements available for matching.</div></section>`;
        return;
      }
      activeRequirementId = firstRequirement.RequirementID || firstRequirement.requirementId;
    }

    const requirementResponse = await fetch(`/api/requirements/${activeRequirementId}`);
    const requirementPayload = await requirementResponse.json();
    if (!requirementPayload.ok) {
      throw new Error(requirementPayload.error || 'Could not load requirement');
    }

    const requirement = requirementPayload.data;
    const matchesResponse = await fetch(`/api/requirements/${activeRequirementId}/matches`);
    const matchesPayload = await matchesResponse.json();
    const existingMatches = matchesPayload.data?.matches || matchesPayload.data || [];
    const shortlistMap = await loadActiveShortlistByRequirement(activeRequirementId);

    content.innerHTML = `
      <section class="card-section matching-shell">
        <div class="card-header matching-header">
          <div>
            <h2>Matching Engine</h2>
            <div class="tiny">Requirement ${escapeHtml(requirement.RequirementCode || requirement.RequirementID)} • ${escapeHtml(requirement.Category || '—')} • ${escapeHtml(requirement.PropertyType || '—')}</div>
          </div>
          <div class="top-actions matching-actions">
            <button class="btn btn-soft" id="backToRequirements">Back to Requirements</button>
            <button class="btn btn-soft" id="backToWorkspace">Back to Workspace</button>
            <button class="btn btn-soft" id="openShortlist">Open Shortlist</button>
            <button class="btn btn-primary" id="runMatchingBtn">Run Matching</button>
          </div>
        </div>

        <section class="matching-summary-grid">
          <article class="summary-card">
            <div class="title">Requirement Summary</div>
            <div class="big">${escapeHtml(requirement.RequirementCode || requirement.RequirementID)}</div>
            <p class="tiny">${escapeHtml(requirement.Category || '—')} • ${escapeHtml(requirement.TransactionType || 'Purchase')} • ${escapeHtml(requirement.Location1 || '—')}</p>
            <div class="status-line"><span class="status-dot"></span> Budget ${escapeHtml(String(requirement.BudgetMin || '—'))} - ${escapeHtml(String(requirement.BudgetMax || '—'))}</div>
          </article>
          <article class="summary-card">
            <div class="title">Current Matches</div>
            <div class="big" id="matchingCount">${existingMatches.length}</div>
            <div class="status-line"><span class="status-dot"></span> Match records are persisted in JSON repository</div>
          </article>
        </section>

        <section class="matching-results" id="matchingResults">
          ${existingMatches.length ? existingMatches.map((match) => renderMatchCard(match, shortlistMap.get(match.PropertyID))).join('') : '<div class="match-empty">No matching properties found. Run matching to evaluate inventory against this requirement.</div>'}
        </section>
      </section>
    `;

    document.getElementById('backToRequirements').addEventListener('click', () => renderRequirements());
    document.getElementById('backToWorkspace').addEventListener('click', () => renderLeadWorkspace(requirement.LeadID));
    document.getElementById('openShortlist').addEventListener('click', () => renderShortlist(activeRequirementId));
    attachMatchingShortlistActions(activeRequirementId, shortlistMap);

    const runButton = document.getElementById('runMatchingBtn');
    const results = document.getElementById('matchingResults');
    const count = document.getElementById('matchingCount');

    runButton.addEventListener('click', async () => {
      runButton.disabled = true;
      runButton.textContent = 'Finding matching properties...';
      results.innerHTML = '<div class="match-loading">Finding matching properties...</div>';

      try {
        const response = await fetch('/api/matching/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requirementId: activeRequirementId })
        });
        const result = await response.json();
        if (!result.ok) {
          throw new Error(result.error || 'Matching failed');
        }

        const matches = result.data.matches || [];
        const refreshedShortlist = await loadActiveShortlistByRequirement(activeRequirementId);
        count.textContent = String(result.data.total ?? matches.length);

        if (!matches.length) {
          results.innerHTML = `<div class="match-empty">No matching properties found. ${escapeHtml(result.data.reason || 'Criteria may be too restrictive or no inventory is compatible.')}</div>`;
        } else {
          results.innerHTML = matches.map((match) => renderMatchCard(match, refreshedShortlist.get(match.PropertyID))).join('');
          attachMatchingShortlistActions(activeRequirementId, refreshedShortlist);
        }
      } catch (error) {
        results.innerHTML = `<div class="match-error">Could not run matching: ${escapeHtml(error.message)}</div>`;
      } finally {
        runButton.disabled = false;
        runButton.textContent = 'Run Matching';
      }
    });
  } catch (error) {
    content.innerHTML = `<section class="card-section"><div class="empty-state">Could not load matching: ${escapeHtml(error.message)}</div></section>`;
  }
}

async function renderShortlist(requirementId = null) {
  const content = document.getElementById('app-content');
  content.innerHTML = `<section class="card-section"><div class="empty-state">Loading shortlist...</div></section>`;

  try {
    const query = requirementId ? `?requirementId=${encodeURIComponent(requirementId)}&status=Active` : '?status=Active';
    const response = await fetch(`/api/shortlist${query}`);
    const payload = await response.json();
    if (!payload.ok) {
      throw new Error(payload.error || 'Could not load shortlist');
    }

    const shortlist = payload.data || [];
    content.innerHTML = `
      <section class="card-section">
        <div class="card-header">
          <h2>Shortlist</h2>
          <div class="top-actions">
            <button class="btn btn-soft" id="backToMatchingFromShortlist">Back to Matching</button>
            <button class="btn btn-soft">Compare</button>
          </div>
        </div>
        <div class="shortlist-table-wrap">
        <table class="leads-table shortlist-desktop-table">
          <thead>
            <tr>
              <th>Shortlist ID</th>
              <th>Requirement</th>
              <th>Property</th>
              <th>Match ID</th>
              <th>Score</th>
              <th>Match Level</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Location</th>
              <th>Price</th>
              <th>BHK/Area</th>
              <th>Created</th>
              <th>Notes</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${shortlist.map((item) => `
              <tr data-shortlist-id="${escapeHtml(item.ShortlistID)}" data-lead-id="${escapeHtml(item.LeadID || '')}" data-property-id="${escapeHtml(item.PropertyID)}" data-match-id="${escapeHtml(item.MatchID || '')}" data-requirement-id="${escapeHtml(item.RequirementID)}" data-priority="${escapeHtml(item.Priority || 'Medium')}" data-status="${escapeHtml(item.Status || 'Active')}">
                <td>${escapeHtml(item.ShortlistID)}</td>
                <td>${escapeHtml(item.RequirementCode || item.RequirementID)}</td>
                <td><div class="cell-wrap">${escapeHtml(item.PropertyName || item.PropertyID)}</div><div class="tiny cell-wrap">${escapeHtml(item.PropertyID)}</div></td>
                <td><div class="cell-wrap">${escapeHtml(item.MatchID || '—')}</div></td>
                <td>${escapeHtml(String(item.MatchScore ?? '—'))}</td>
                <td><span class="badge ${item.MatchLevel === 'Excellent' ? 'green' : item.MatchLevel === 'Strong' ? 'gold' : 'slate'}">${escapeHtml(item.MatchLevel || '—')}</span></td>
                <td>
                  <select class="shortlist-priority-update" data-shortlist-id="${escapeHtml(item.ShortlistID)}">
                    <option value="High" ${item.Priority === 'High' ? 'selected' : ''}>High</option>
                    <option value="Medium" ${item.Priority === 'Medium' ? 'selected' : ''}>Medium</option>
                    <option value="Low" ${item.Priority === 'Low' ? 'selected' : ''}>Low</option>
                  </select>
                </td>
                <td>${escapeHtml(item.Status || 'Active')}</td>
                <td>${escapeHtml(item.Location || '—')}</td>
                <td>${escapeHtml(String(item.Price ?? '—'))}</td>
                <td><div class="cell-wrap">${escapeHtml(String(item.BHK ?? '—'))} / ${escapeHtml(String(item.Area ?? '—'))}</div></td>
                <td><div class="cell-wrap">${escapeHtml(item.CreatedAt || '—')}</div></td>
                <td><input class="shortlist-notes-update" data-shortlist-id="${escapeHtml(item.ShortlistID)}" value="${escapeHtml(item.Notes || '')}" placeholder="Optional notes" /></td>
                <td>
                  <div class="shortlist-row-actions">
                    <button class="btn btn-soft save-shortlist-btn" data-shortlist-id="${escapeHtml(item.ShortlistID)}">Save</button>
                    <button class="btn btn-soft remove-shortlist-btn" data-shortlist-id="${escapeHtml(item.ShortlistID)}">Remove</button>
                    <button class="btn btn-primary schedule-site-visit-btn" data-shortlist-id="${escapeHtml(item.ShortlistID)}" data-lead-id="${escapeHtml(item.LeadID || '')}" data-property-id="${escapeHtml(item.PropertyID)}" data-match-id="${escapeHtml(item.MatchID || '')}" data-requirement-id="${escapeHtml(item.RequirementID)}">Schedule Visit</button>
                    <button class="btn btn-secondary start-negotiation-btn" data-shortlist-id="${escapeHtml(item.ShortlistID)}" data-lead-id="${escapeHtml(item.LeadID || '')}" data-property-id="${escapeHtml(item.PropertyID)}" data-match-id="${escapeHtml(item.MatchID || '')}" data-requirement-id="${escapeHtml(item.RequirementID)}">Start Negotiation</button>
                  </div>
                </td>
              </tr>
            `).join('') || '<tr><td colspan="14"><div class="empty-state">No shortlisted properties found.</div></td></tr>'}
          </tbody>
        </table>
        </div>

        <section class="shortlist-mobile-grid">
          ${shortlist.map((item) => `
            <article class="shortlist-mobile-card" data-shortlist-id="${escapeHtml(item.ShortlistID)}" data-lead-id="${escapeHtml(item.LeadID || '')}" data-property-id="${escapeHtml(item.PropertyID)}" data-match-id="${escapeHtml(item.MatchID || '')}" data-requirement-id="${escapeHtml(item.RequirementID)}" data-priority="${escapeHtml(item.Priority || 'Medium')}" data-status="${escapeHtml(item.Status || 'Active')}">
              <div class="shortlist-mobile-head">
                <div>
                  <div class="tiny">Shortlist ID</div>
                  <div class="shortlist-mobile-id">${escapeHtml(item.ShortlistID)}</div>
                </div>
                <span class="badge ${item.MatchLevel === 'Excellent' ? 'green' : item.MatchLevel === 'Strong' ? 'gold' : 'slate'}">${escapeHtml(item.MatchLevel || '—')}</span>
              </div>
              <div class="shortlist-mobile-row"><span>Requirement</span><span class="cell-wrap">${escapeHtml(item.RequirementCode || item.RequirementID)}</span></div>
              <div class="shortlist-mobile-row"><span>Property</span><span class="cell-wrap">${escapeHtml(item.PropertyName || item.PropertyID)} (${escapeHtml(item.PropertyID)})</span></div>
              <div class="shortlist-mobile-row"><span>Match</span><span class="cell-wrap">${escapeHtml(item.MatchID || '—')}</span></div>
              <div class="shortlist-mobile-row"><span>Score</span><span>${escapeHtml(String(item.MatchScore ?? '—'))}</span></div>
              <div class="shortlist-mobile-row"><span>Status</span><span>${escapeHtml(item.Status || 'Active')}</span></div>
              <div class="shortlist-mobile-row"><span>Location</span><span class="cell-wrap">${escapeHtml(item.Location || '—')}</span></div>
              <div class="shortlist-mobile-row"><span>Price</span><span>${escapeHtml(String(item.Price ?? '—'))}</span></div>
              <div class="shortlist-mobile-row"><span>BHK/Area</span><span>${escapeHtml(String(item.BHK ?? '—'))} / ${escapeHtml(String(item.Area ?? '—'))}</span></div>
              <div class="shortlist-mobile-row"><span>Created</span><span class="cell-wrap">${escapeHtml(item.CreatedAt || '—')}</span></div>
              <div class="shortlist-mobile-controls">
                <label class="field compact">
                  <span>Priority</span>
                  <select class="shortlist-priority-update" data-shortlist-id="${escapeHtml(item.ShortlistID)}">
                    <option value="High" ${item.Priority === 'High' ? 'selected' : ''}>High</option>
                    <option value="Medium" ${item.Priority === 'Medium' ? 'selected' : ''}>Medium</option>
                    <option value="Low" ${item.Priority === 'Low' ? 'selected' : ''}>Low</option>
                  </select>
                </label>
                <label class="field compact grow">
                  <span>Notes</span>
                  <input class="shortlist-notes-update" data-shortlist-id="${escapeHtml(item.ShortlistID)}" value="${escapeHtml(item.Notes || '')}" placeholder="Optional notes" />
                </label>
                <div class="shortlist-row-actions">
                  <button class="btn btn-soft save-shortlist-btn" data-shortlist-id="${escapeHtml(item.ShortlistID)}">Save</button>
                  <button class="btn btn-soft remove-shortlist-btn" data-shortlist-id="${escapeHtml(item.ShortlistID)}">Remove</button>
                  <button class="btn btn-primary schedule-site-visit-btn" data-shortlist-id="${escapeHtml(item.ShortlistID)}" data-lead-id="${escapeHtml(item.LeadID || '')}" data-property-id="${escapeHtml(item.PropertyID)}" data-match-id="${escapeHtml(item.MatchID || '')}" data-requirement-id="${escapeHtml(item.RequirementID)}">Schedule Visit</button>
                  <button class="btn btn-secondary start-negotiation-btn" data-shortlist-id="${escapeHtml(item.ShortlistID)}" data-lead-id="${escapeHtml(item.LeadID || '')}" data-property-id="${escapeHtml(item.PropertyID)}" data-match-id="${escapeHtml(item.MatchID || '')}" data-requirement-id="${escapeHtml(item.RequirementID)}">Start Negotiation</button>
                </div>
              </div>
            </article>
          `).join('') || '<div class="empty-state">No shortlisted properties found.</div>'}
        </section>
      </section>
    `;

    document.getElementById('backToMatchingFromShortlist')?.addEventListener('click', () => renderMatching(requirementId));

    document.querySelectorAll('.save-shortlist-btn').forEach((button) => {
      button.addEventListener('click', async () => {
        const shortlistId = button.dataset.shortlistId;
        const priority = document.querySelector(`.shortlist-priority-update[data-shortlist-id="${shortlistId}"]`)?.value || 'Medium';
        const notes = document.querySelector(`.shortlist-notes-update[data-shortlist-id="${shortlistId}"]`)?.value || '';

        button.disabled = true;
        const oldText = button.textContent;
        button.textContent = 'Saving...';

        try {
          const response = await fetch(`/api/shortlist/${shortlistId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ priority, notes })
          });

          const result = await response.json();
          if (!result.ok) {
            throw new Error(result.error || 'Could not update shortlist');
          }

          button.textContent = 'Saved';
          setTimeout(() => {
            button.textContent = oldText;
            button.disabled = false;
          }, 700);
        } catch (error) {
          button.textContent = oldText;
          button.disabled = false;
          content.insertAdjacentHTML('afterbegin', `<div class="match-error">Could not update shortlist: ${escapeHtml(error.message)}</div>`);
        }
      });
    });

    document.querySelectorAll('.remove-shortlist-btn').forEach((button) => {
      button.addEventListener('click', async () => {
        const shortlistId = button.dataset.shortlistId;
        button.disabled = true;
        const oldText = button.textContent;
        button.textContent = 'Removing...';

        try {
          const response = await fetch(`/api/shortlist/${shortlistId}/remove`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ removedBy: 'ui-user' })
          });

          const result = await response.json();
          if (!result.ok) {
            throw new Error(result.error || 'Could not remove shortlist');
          }

          renderShortlist(requirementId);
        } catch (error) {
          button.textContent = oldText;
          button.disabled = false;
          content.insertAdjacentHTML('afterbegin', `<div class="match-error">Could not remove shortlist: ${escapeHtml(error.message)}</div>`);
        }
      });
    });

    document.querySelectorAll('.schedule-site-visit-btn').forEach((button) => {
      button.addEventListener('click', () => {
        const payload = {
          leadId: button.dataset.leadId || document.body.dataset.currentLeadId || '',
          requirementId: button.dataset.requirementId || requirementId || '',
          propertyId: button.dataset.propertyId || '',
          matchId: button.dataset.matchId || '',
          shortlistId: button.dataset.shortlistId || null
        };
        renderSiteVisits(payload);
      });
    });

    document.querySelectorAll('.start-negotiation-btn').forEach((button) => {
      button.addEventListener('click', () => {
        const payload = {
          leadId: button.dataset.leadId || document.body.dataset.currentLeadId || '',
          requirementId: button.dataset.requirementId || requirementId || '',
          propertyId: button.dataset.propertyId || '',
          matchId: button.dataset.matchId || '',
          shortlistId: button.dataset.shortlistId || null
        };
        renderNegotiation(payload);
      });
    });
  } catch (error) {
    content.innerHTML = `<section class="card-section"><div class="match-error">Could not load shortlist: ${escapeHtml(error.message)}</div></section>`;
  }
}

async function renderSiteVisits(defaultContext = null) {
  const content = document.getElementById('app-content');
  try {
    const response = await fetch('/api/site-visits');
    const payload = await response.json();
    const visits = payload.data || [];

    content.innerHTML = `
      <section class="card-section">
        <div class="card-header">
          <h2>Site Visits</h2>
          <button class="btn btn-primary" id="createVisitBtn">+ Create Visit</button>
        </div>
        <div class="form-stack" id="visitComposer" hidden></div>
        <div class="shortlist-table-wrap">
        <table class="leads-table shortlist-desktop-table">
          <thead><tr><th>Visit ID</th><th>Lead</th><th>Property</th><th>Date</th><th>Time</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${visits.map((visit) => `
              <tr data-visit-id="${escapeHtml(visit.VisitID)}" data-lead-id="${escapeHtml(visit.LeadID || '')}" data-requirement-id="${escapeHtml(visit.RequirementID || '')}" data-property-id="${escapeHtml(visit.PropertyID)}" data-match-id="${escapeHtml(visit.MatchID || '')}" data-shortlist-id="${escapeHtml(visit.ShortlistID || '')}" data-status="${escapeHtml(visit.Status || '')}" data-visit-date="${escapeHtml(visit.VisitDate || '')}" data-visit-time="${escapeHtml(visit.VisitTime || '')}">
                <td>${escapeHtml(visit.VisitID)}</td>
                <td>${escapeHtml(visit.LeadID)}</td>
                <td>${escapeHtml(visit.PropertyID)}</td>
                <td>${escapeHtml(visit.VisitDate || '—')}</td>
                <td>${escapeHtml(visit.VisitTime || '—')}</td>
                <td><span class="badge ${visit.Status === 'Completed' ? 'green' : visit.Status === 'Confirmed' ? 'gold' : visit.Status === 'Cancelled' ? 'red' : 'slate'}">${escapeHtml(visit.Status || 'Scheduled')}</span></td>
                <td>
                  <div class="shortlist-row-actions">
                    <button class="btn btn-soft visit-action" data-action="confirm" data-visit-id="${escapeHtml(visit.VisitID)}">Confirm</button>
                    <button class="btn btn-soft visit-action" data-action="reschedule" data-visit-id="${escapeHtml(visit.VisitID)}">Reschedule</button>
                    <button class="btn btn-soft visit-action" data-action="complete" data-visit-id="${escapeHtml(visit.VisitID)}">Complete</button>
                    <button class="btn btn-soft visit-action" data-action="cancel" data-visit-id="${escapeHtml(visit.VisitID)}">Cancel</button>
                    <button class="btn btn-soft visit-action" data-action="no-show" data-visit-id="${escapeHtml(visit.VisitID)}">No Show</button>
                    <button class="btn btn-secondary start-negotiation-visit-btn" data-visit-id="${escapeHtml(visit.VisitID)}" data-lead-id="${escapeHtml(visit.LeadID || '')}" data-requirement-id="${escapeHtml(visit.RequirementID || '')}" data-property-id="${escapeHtml(visit.PropertyID)}" data-match-id="${escapeHtml(visit.MatchID || '')}" data-shortlist-id="${escapeHtml(visit.ShortlistID || '')}">Start Negotiation</button>
                  </div>
                </td>
              </tr>
            `).join('') || '<tr><td colspan="7"><div class="empty-state">No site visits found yet.</div></td></tr>'}
          </tbody>
        </table>
        </div>

        <section class="shortlist-mobile-grid">
          ${visits.map((visit) => `
            <article class="shortlist-mobile-card" data-visit-id="${escapeHtml(visit.VisitID)}" data-lead-id="${escapeHtml(visit.LeadID || '')}" data-requirement-id="${escapeHtml(visit.RequirementID || '')}" data-property-id="${escapeHtml(visit.PropertyID)}" data-match-id="${escapeHtml(visit.MatchID || '')}" data-shortlist-id="${escapeHtml(visit.ShortlistID || '')}" data-status="${escapeHtml(visit.Status || '')}" data-visit-date="${escapeHtml(visit.VisitDate || '')}" data-visit-time="${escapeHtml(visit.VisitTime || '')}">
              <div class="shortlist-mobile-head">
                <div>
                  <div class="tiny">Visit ID</div>
                  <div class="shortlist-mobile-id">${escapeHtml(visit.VisitID)}</div>
                </div>
                <span class="badge ${visit.Status === 'Completed' ? 'green' : visit.Status === 'Confirmed' ? 'gold' : visit.Status === 'Cancelled' ? 'red' : 'slate'}">${escapeHtml(visit.Status || 'Scheduled')}</span>
              </div>
              <div class="shortlist-mobile-row"><span>Lead</span><span class="cell-wrap">${escapeHtml(visit.LeadID)}</span></div>
              <div class="shortlist-mobile-row"><span>Property</span><span class="cell-wrap">${escapeHtml(visit.PropertyID)}</span></div>
              <div class="shortlist-mobile-row"><span>Date</span><span>${escapeHtml(visit.VisitDate || '—')}</span></div>
              <div class="shortlist-mobile-row"><span>Time</span><span>${escapeHtml(visit.VisitTime || '—')}</span></div>
              <div class="shortlist-row-actions">
                <button class="btn btn-soft visit-action" data-action="confirm" data-visit-id="${escapeHtml(visit.VisitID)}">Confirm</button>
                <button class="btn btn-soft visit-action" data-action="reschedule" data-visit-id="${escapeHtml(visit.VisitID)}">Reschedule</button>
                <button class="btn btn-soft visit-action" data-action="complete" data-visit-id="${escapeHtml(visit.VisitID)}">Complete</button>
                <button class="btn btn-soft visit-action" data-action="cancel" data-visit-id="${escapeHtml(visit.VisitID)}">Cancel</button>
                <button class="btn btn-soft visit-action" data-action="no-show" data-visit-id="${escapeHtml(visit.VisitID)}">No Show</button>
                <button class="btn btn-secondary start-negotiation-visit-btn" data-visit-id="${escapeHtml(visit.VisitID)}" data-lead-id="${escapeHtml(visit.LeadID || '')}" data-requirement-id="${escapeHtml(visit.RequirementID || '')}" data-property-id="${escapeHtml(visit.PropertyID)}" data-match-id="${escapeHtml(visit.MatchID || '')}" data-shortlist-id="${escapeHtml(visit.ShortlistID || '')}">Start Negotiation</button>
              </div>
            </article>
          `).join('') || '<div class="empty-state">No site visits found yet.</div>'}
        </section>
      </section>
    `;

    document.getElementById('createVisitBtn').addEventListener('click', () => {
      renderSiteVisitComposer(defaultContext || null);
    });

    if (defaultContext) {
      renderSiteVisitComposer(defaultContext);
    }

    document.querySelectorAll('.visit-action').forEach((button) => {
      button.addEventListener('click', async () => {
        const visitId = button.dataset.visitId;
        const action = button.dataset.action;
        let endpoint = `/api/site-visits/${visitId}/${action}`;
        let body = null;
        if (action === 'no-show') {
          endpoint = `/api/site-visits/${visitId}/no-show`;
        }
        if (action === 'reschedule') {
          const date = new Date();
          date.setDate(date.getDate() + 1);
          const nextDay = date.toISOString().slice(0, 10);
          endpoint = `/api/site-visits/${visitId}/reschedule`;
          body = JSON.stringify({ visitDate: nextDay, visitTime: '11:00' });
        }

        const response = await fetch(endpoint, {
          method: 'PATCH',
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body
        });
        const payload = await response.json();
        if (payload.ok) {
          renderSiteVisits();
        }
      });
    });

    document.querySelectorAll('.start-negotiation-visit-btn').forEach((button) => {
      button.addEventListener('click', () => {
        renderNegotiation({
          leadId: button.dataset.leadId || '',
          requirementId: button.dataset.requirementId || '',
          propertyId: button.dataset.propertyId || '',
          matchId: button.dataset.matchId || '',
          shortlistId: button.dataset.shortlistId || null,
          siteVisitId: button.dataset.visitId || null
        });
      });
    });
  } catch (error) {
    content.innerHTML = `<div class="empty-state">Could not load site visits: ${error.message}</div>`;
  }
}

function renderSiteVisitComposer(context = null) {
  const composer = document.getElementById('visitComposer');
  if (!composer) return;
  const source = context || {};
  composer.hidden = false;
  composer.innerHTML = `
    <section class="card-section">
      <div class="card-header">
        <h2>Schedule Site Visit</h2>
        <button class="btn btn-soft" id="closeVisitComposer">Close</button>
      </div>
      <form id="site-visit-form" class="form-stack">
        <div class="two-col">
          <label class="field">
            <span>Date</span>
            <input type="date" name="visitDate" required />
          </label>
          <label class="field">
            <span>Time</span>
            <input type="time" name="visitTime" required />
          </label>
          <label class="field">
            <span>Duration</span>
            <input name="duration" value="90 mins" />
          </label>
          <label class="field">
            <span>Meeting Point</span>
            <input name="meetingPoint" value="Lobby" />
          </label>
          <label class="field">
            <span>Assigned Agent</span>
            <input name="assignedAgentId" value="USR-0001" />
          </label>
          <label class="field">
            <span>Client Phone</span>
            <input name="clientPhone" value="" />
          </label>
          <label class="field wide">
            <span>Notes</span>
            <textarea name="notes"></textarea>
          </label>
        </div>
        <div class="top-actions">
          <button class="btn btn-primary" type="submit">Save Visit</button>
        </div>
      </form>
    </section>
  `;

  document.getElementById('closeVisitComposer').addEventListener('click', () => {
    composer.hidden = true;
    composer.innerHTML = '';
  });

  const form = document.getElementById('site-visit-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(form).entries());
    const shortlist = document.querySelector('[data-shortlist-id]');
    const leadId = source.leadId || document.body.dataset.currentLeadId || '';
    const requirementId = source.requirementId || shortlist?.dataset.requirementId || '';
    const propertyId = source.propertyId || shortlist?.dataset.propertyId || '';
    const matchId = source.matchId || shortlist?.dataset.matchId || '';
    const shortlistId = source.shortlistId || shortlist?.dataset.shortlistId || null;

    if (!leadId || !requirementId || !propertyId || !matchId) {
      composer.innerHTML = '<div class="empty-state">Open from shortlist to schedule a site visit with valid relationship IDs.</div>';
      return;
    }

    const response = await fetch('/api/site-visits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        leadId,
        requirementId,
        propertyId,
        matchId,
        shortlistId
      })
    });
    const result = await response.json();
    if (result.ok) {
      renderSiteVisits();
    } else {
      composer.innerHTML = `<div class="empty-state">${escapeHtml(result.error || 'Could not save visit')}</div>`;
    }
  });
}

function formatMoneyDisplay(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return '—';
  }
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 })}`;
}

function getNegotiationStatusClass(status) {
  if (['COMPLETED', 'AGREED', 'TOKEN_RECEIVED', 'AGREEMENT_DONE'].includes(status)) return 'green';
  if (['OFFER_MADE', 'COUNTER_OFFER', 'NEGOTIATING', 'TOKEN_PENDING', 'AGREEMENT_PENDING', 'REGISTRATION_PENDING'].includes(status)) return 'gold';
  if (['FAILED', 'CANCELLED'].includes(status)) return 'red';
  return 'slate';
}

function negotiationActionAllowed(status, action) {
  const allowed = {
    offer: ['OPEN', 'NEGOTIATING', 'COUNTER_OFFER', 'ON_HOLD'],
    counter: ['OPEN', 'OFFER_MADE', 'NEGOTIATING', 'ON_HOLD'],
    accept: ['OPEN', 'OFFER_MADE', 'COUNTER_OFFER', 'NEGOTIATING'],
    reject: ['OPEN', 'OFFER_MADE', 'COUNTER_OFFER', 'NEGOTIATING', 'ON_HOLD'],
    hold: ['OPEN', 'OFFER_MADE', 'COUNTER_OFFER', 'NEGOTIATING', 'AGREED', 'TOKEN_PENDING', 'TOKEN_RECEIVED', 'AGREEMENT_PENDING', 'AGREEMENT_DONE', 'REGISTRATION_PENDING'],
    resume: ['ON_HOLD'],
    agree: ['OPEN', 'OFFER_MADE', 'COUNTER_OFFER', 'NEGOTIATING', 'AGREED', 'ON_HOLD'],
    token: ['AGREED', 'TOKEN_PENDING', 'ON_HOLD'],
    agreement: ['TOKEN_RECEIVED', 'AGREEMENT_PENDING', 'ON_HOLD'],
    registration: ['AGREEMENT_DONE', 'ON_HOLD'],
    complete: ['REGISTRATION_PENDING', 'ON_HOLD'],
    cancel: ['OPEN', 'OFFER_MADE', 'COUNTER_OFFER', 'NEGOTIATING', 'AGREED', 'TOKEN_PENDING', 'TOKEN_RECEIVED', 'AGREEMENT_PENDING', 'AGREEMENT_DONE', 'REGISTRATION_PENDING', 'ON_HOLD']
  };

  return (allowed[action] || []).includes(status);
}

async function renderNegotiation(defaultContext = null) {
  const content = document.getElementById('app-content');
  content.innerHTML = `<section class="card-section"><div class="empty-state">Loading negotiations...</div></section>`;

  try {
    const response = await fetch('/api/negotiations');
    const payload = await response.json();
    if (!payload.ok) {
      throw new Error(payload.error || 'Could not load negotiations');
    }

    const negotiations = payload.data || [];
    const counts = {
      open: negotiations.filter((item) => ['OPEN', 'OFFER_MADE', 'COUNTER_OFFER'].includes(item.Status)).length,
      negotiating: negotiations.filter((item) => item.Status === 'NEGOTIATING').length,
      agreed: negotiations.filter((item) => item.Status === 'AGREED').length,
      tokenPending: negotiations.filter((item) => item.Status === 'TOKEN_PENDING').length,
      agreement: negotiations.filter((item) => ['AGREEMENT_PENDING', 'AGREEMENT_DONE'].includes(item.Status)).length,
      registration: negotiations.filter((item) => item.Status === 'REGISTRATION_PENDING').length,
      completed: negotiations.filter((item) => item.Status === 'COMPLETED').length,
      cancelled: negotiations.filter((item) => ['CANCELLED', 'FAILED'].includes(item.Status)).length
    };

    content.innerHTML = `
      <section class="card-section">
        <div class="card-header">
          <h2>Negotiation Workspace</h2>
          <div class="top-actions">
            <button class="btn btn-soft" id="refreshNegotiationBtn">Refresh</button>
            <button class="btn btn-primary" id="openNegotiationComposer">+ Start Negotiation</button>
          </div>
        </div>

        <div class="reports-grid negotiation-status-grid">
          <article class="report-box"><h3>Open</h3><div class="number">${counts.open}</div><div class="tiny">OPEN / OFFER / COUNTER</div></article>
          <article class="report-box"><h3>Negotiating</h3><div class="number">${counts.negotiating}</div><div class="tiny">Live discussion</div></article>
          <article class="report-box"><h3>Agreed</h3><div class="number">${counts.agreed}</div><div class="tiny">Awaiting token</div></article>
          <article class="report-box"><h3>Token Pending</h3><div class="number">${counts.tokenPending}</div><div class="tiny">Token in progress</div></article>
          <article class="report-box"><h3>Agreement</h3><div class="number">${counts.agreement}</div><div class="tiny">Agreement workflow</div></article>
          <article class="report-box"><h3>Registration</h3><div class="number">${counts.registration}</div><div class="tiny">Final paperwork</div></article>
          <article class="report-box"><h3>Completed</h3><div class="number">${counts.completed}</div><div class="tiny">Successfully closed</div></article>
          <article class="report-box"><h3>Cancelled/Failed</h3><div class="number">${counts.cancelled}</div><div class="tiny">Terminal exceptions</div></article>
        </div>

        <div class="form-stack" id="negotiationComposer" hidden></div>
        <div class="shortlist-table-wrap">
          <table class="leads-table shortlist-desktop-table">
            <thead>
              <tr>
                <th>Negotiation ID</th>
                <th>Client</th>
                <th>Requirement</th>
                <th>Property</th>
                <th>Match</th>
                <th>Shortlist</th>
                <th>Visit</th>
                <th>Asking</th>
                <th>Current</th>
                <th>Counter</th>
                <th>Agreed</th>
                <th>Brokerage</th>
                <th>Token</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${negotiations.map((item) => `
                <tr data-negotiation-id="${escapeHtml(item.NegotiationID)}" data-negotiation-status="${escapeHtml(item.Status || 'OPEN')}" data-lead-id="${escapeHtml(item.LeadID || '')}" data-requirement-id="${escapeHtml(item.RequirementID || '')}" data-property-id="${escapeHtml(item.PropertyID || '')}" data-match-id="${escapeHtml(item.MatchID || '')}" data-shortlist-id="${escapeHtml(item.ShortlistID || '')}" data-site-visit-id="${escapeHtml(item.SiteVisitID || '')}">
                  <td><div class="cell-wrap">${escapeHtml(item.NegotiationID)}</div></td>
                  <td>${escapeHtml(item.LeadID || '—')}</td>
                  <td>${escapeHtml(item.RequirementID || '—')}</td>
                  <td>${escapeHtml(item.PropertyID || '—')}</td>
                  <td>${escapeHtml(item.MatchID || '—')}</td>
                  <td>${escapeHtml(item.ShortlistID || '—')}</td>
                  <td>${escapeHtml(item.SiteVisitID || '—')}</td>
                  <td>${escapeHtml(formatMoneyDisplay(item.AskingPrice))}</td>
                  <td>${escapeHtml(formatMoneyDisplay(item.CurrentOffer))}</td>
                  <td>${escapeHtml(formatMoneyDisplay(item.CounterOffer))}</td>
                  <td>${escapeHtml(formatMoneyDisplay(item.AgreedPrice))}</td>
                  <td>${escapeHtml(formatMoneyDisplay(item.BrokerageAmount))}</td>
                  <td>${escapeHtml(formatMoneyDisplay(item.TokenAmount))}</td>
                  <td><span class="badge ${getNegotiationStatusClass(item.Status)}">${escapeHtml(item.Status || 'OPEN')}</span></td>
                  <td>
                    <div class="shortlist-row-actions negotiation-actions">
                      <button class="btn btn-soft neg-history-btn" data-negotiation-id="${escapeHtml(item.NegotiationID)}">History</button>
                      <button class="btn btn-soft neg-edit-btn" data-negotiation-id="${escapeHtml(item.NegotiationID)}">Edit</button>
                      <button class="btn btn-soft neg-action-btn" data-action="offer" data-negotiation-id="${escapeHtml(item.NegotiationID)}" ${negotiationActionAllowed(item.Status, 'offer') ? '' : 'disabled'}>Offer</button>
                      <button class="btn btn-soft neg-action-btn" data-action="counter" data-negotiation-id="${escapeHtml(item.NegotiationID)}" ${negotiationActionAllowed(item.Status, 'counter') ? '' : 'disabled'}>Counter</button>
                      <button class="btn btn-soft neg-action-btn" data-action="accept" data-negotiation-id="${escapeHtml(item.NegotiationID)}" ${negotiationActionAllowed(item.Status, 'accept') ? '' : 'disabled'}>Accept</button>
                      <button class="btn btn-soft neg-action-btn" data-action="reject" data-negotiation-id="${escapeHtml(item.NegotiationID)}" ${negotiationActionAllowed(item.Status, 'reject') ? '' : 'disabled'}>Reject</button>
                      <button class="btn btn-soft neg-action-btn" data-action="hold" data-negotiation-id="${escapeHtml(item.NegotiationID)}" ${negotiationActionAllowed(item.Status, 'hold') ? '' : 'disabled'}>Hold</button>
                      <button class="btn btn-soft neg-action-btn" data-action="resume" data-negotiation-id="${escapeHtml(item.NegotiationID)}" ${negotiationActionAllowed(item.Status, 'resume') ? '' : 'disabled'}>Resume</button>
                      <button class="btn btn-soft neg-action-btn" data-action="agree" data-negotiation-id="${escapeHtml(item.NegotiationID)}" ${negotiationActionAllowed(item.Status, 'agree') ? '' : 'disabled'}>Agree</button>
                      <button class="btn btn-soft neg-action-btn" data-action="token" data-negotiation-id="${escapeHtml(item.NegotiationID)}" ${negotiationActionAllowed(item.Status, 'token') ? '' : 'disabled'}>Token</button>
                      <button class="btn btn-soft neg-action-btn" data-action="agreement" data-negotiation-id="${escapeHtml(item.NegotiationID)}" ${negotiationActionAllowed(item.Status, 'agreement') ? '' : 'disabled'}>Agreement</button>
                      <button class="btn btn-soft neg-action-btn" data-action="registration" data-negotiation-id="${escapeHtml(item.NegotiationID)}" ${negotiationActionAllowed(item.Status, 'registration') ? '' : 'disabled'}>Registration</button>
                      <button class="btn btn-soft neg-action-btn" data-action="complete" data-negotiation-id="${escapeHtml(item.NegotiationID)}" ${negotiationActionAllowed(item.Status, 'complete') ? '' : 'disabled'}>Complete</button>
                      <button class="btn btn-soft neg-action-btn" data-action="cancel" data-negotiation-id="${escapeHtml(item.NegotiationID)}" ${negotiationActionAllowed(item.Status, 'cancel') ? '' : 'disabled'}>Cancel</button>
                    </div>
                  </td>
                </tr>
              `).join('') || '<tr><td colspan="15"><div class="empty-state">No negotiations found yet. Start one from shortlist/site visits or create manually.</div></td></tr>'}
            </tbody>
          </table>
        </div>

        <section class="shortlist-mobile-grid">
          ${negotiations.map((item) => `
            <article class="shortlist-mobile-card" data-negotiation-id="${escapeHtml(item.NegotiationID)}" data-negotiation-status="${escapeHtml(item.Status || 'OPEN')}">
              <div class="shortlist-mobile-head">
                <div>
                  <div class="tiny">Negotiation ID</div>
                  <div class="shortlist-mobile-id">${escapeHtml(item.NegotiationID)}</div>
                </div>
                <span class="badge ${getNegotiationStatusClass(item.Status)}">${escapeHtml(item.Status || 'OPEN')}</span>
              </div>
              <div class="shortlist-mobile-row"><span>Lead</span><span class="cell-wrap">${escapeHtml(item.LeadID || '—')}</span></div>
              <div class="shortlist-mobile-row"><span>Requirement</span><span class="cell-wrap">${escapeHtml(item.RequirementID || '—')}</span></div>
              <div class="shortlist-mobile-row"><span>Property</span><span class="cell-wrap">${escapeHtml(item.PropertyID || '—')}</span></div>
              <div class="shortlist-mobile-row"><span>Asking</span><span>${escapeHtml(formatMoneyDisplay(item.AskingPrice))}</span></div>
              <div class="shortlist-mobile-row"><span>Current</span><span>${escapeHtml(formatMoneyDisplay(item.CurrentOffer))}</span></div>
              <div class="shortlist-mobile-row"><span>Counter</span><span>${escapeHtml(formatMoneyDisplay(item.CounterOffer))}</span></div>
              <div class="shortlist-mobile-row"><span>Agreed</span><span>${escapeHtml(formatMoneyDisplay(item.AgreedPrice))}</span></div>
              <div class="shortlist-mobile-row"><span>Brokerage</span><span>${escapeHtml(formatMoneyDisplay(item.BrokerageAmount))}</span></div>
              <div class="shortlist-mobile-row"><span>Token</span><span>${escapeHtml(formatMoneyDisplay(item.TokenAmount))}</span></div>
              <div class="shortlist-row-actions negotiation-actions">
                <button class="btn btn-soft neg-history-btn" data-negotiation-id="${escapeHtml(item.NegotiationID)}">History</button>
                <button class="btn btn-soft neg-edit-btn" data-negotiation-id="${escapeHtml(item.NegotiationID)}">Edit</button>
                <button class="btn btn-soft neg-action-btn" data-action="offer" data-negotiation-id="${escapeHtml(item.NegotiationID)}" ${negotiationActionAllowed(item.Status, 'offer') ? '' : 'disabled'}>Offer</button>
                <button class="btn btn-soft neg-action-btn" data-action="counter" data-negotiation-id="${escapeHtml(item.NegotiationID)}" ${negotiationActionAllowed(item.Status, 'counter') ? '' : 'disabled'}>Counter</button>
                <button class="btn btn-soft neg-action-btn" data-action="accept" data-negotiation-id="${escapeHtml(item.NegotiationID)}" ${negotiationActionAllowed(item.Status, 'accept') ? '' : 'disabled'}>Accept</button>
                <button class="btn btn-soft neg-action-btn" data-action="hold" data-negotiation-id="${escapeHtml(item.NegotiationID)}" ${negotiationActionAllowed(item.Status, 'hold') ? '' : 'disabled'}>Hold</button>
                <button class="btn btn-soft neg-action-btn" data-action="resume" data-negotiation-id="${escapeHtml(item.NegotiationID)}" ${negotiationActionAllowed(item.Status, 'resume') ? '' : 'disabled'}>Resume</button>
                <button class="btn btn-soft neg-action-btn" data-action="agree" data-negotiation-id="${escapeHtml(item.NegotiationID)}" ${negotiationActionAllowed(item.Status, 'agree') ? '' : 'disabled'}>Agree</button>
                <button class="btn btn-soft neg-action-btn" data-action="token" data-negotiation-id="${escapeHtml(item.NegotiationID)}" ${negotiationActionAllowed(item.Status, 'token') ? '' : 'disabled'}>Token</button>
                <button class="btn btn-soft neg-action-btn" data-action="agreement" data-negotiation-id="${escapeHtml(item.NegotiationID)}" ${negotiationActionAllowed(item.Status, 'agreement') ? '' : 'disabled'}>Agreement</button>
                <button class="btn btn-soft neg-action-btn" data-action="registration" data-negotiation-id="${escapeHtml(item.NegotiationID)}" ${negotiationActionAllowed(item.Status, 'registration') ? '' : 'disabled'}>Registration</button>
                <button class="btn btn-soft neg-action-btn" data-action="complete" data-negotiation-id="${escapeHtml(item.NegotiationID)}" ${negotiationActionAllowed(item.Status, 'complete') ? '' : 'disabled'}>Complete</button>
                <button class="btn btn-soft neg-action-btn" data-action="cancel" data-negotiation-id="${escapeHtml(item.NegotiationID)}" ${negotiationActionAllowed(item.Status, 'cancel') ? '' : 'disabled'}>Cancel</button>
              </div>
            </article>
          `).join('') || '<div class="empty-state">No negotiations found yet.</div>'}
        </section>

        <section class="card-section" id="negotiationHistoryPanel">
          <div class="card-header"><h2>Negotiation History</h2><span class="badge slate">Select a record</span></div>
          <div class="empty-state">Choose any negotiation and click History to view persisted audit entries.</div>
        </section>
      </section>
    `;

    const composer = document.getElementById('negotiationComposer');
    const openComposer = (ctx = null) => {
      const source = ctx || {};
      composer.hidden = false;
      composer.innerHTML = `
        <section class="card-section">
          <div class="card-header">
            <h2>Create Negotiation</h2>
            <button class="btn btn-soft" id="closeNegotiationComposer">Close</button>
          </div>
          <form id="negotiation-form" class="form-stack">
            <div class="two-col">
              <label class="field"><span>Lead ID</span><input name="leadId" value="${escapeHtml(source.leadId || '')}" required /></label>
              <label class="field"><span>Requirement ID</span><input name="requirementId" value="${escapeHtml(source.requirementId || '')}" required /></label>
              <label class="field"><span>Property ID</span><input name="propertyId" value="${escapeHtml(source.propertyId || '')}" required /></label>
              <label class="field"><span>Match ID</span><input name="matchId" value="${escapeHtml(source.matchId || '')}" /></label>
              <label class="field"><span>Shortlist ID</span><input name="shortlistId" value="${escapeHtml(source.shortlistId || '')}" /></label>
              <label class="field"><span>Site Visit ID</span><input name="siteVisitId" value="${escapeHtml(source.siteVisitId || '')}" /></label>
              <label class="field"><span>Asking Price</span><input name="askingPrice" type="number" min="0" step="0.01" required /></label>
              <label class="field"><span>Initial Offer</span><input name="initialOffer" type="number" min="0" step="0.01" /></label>
              <label class="field"><span>Current Offer</span><input name="currentOffer" type="number" min="0" step="0.01" /></label>
              <label class="field"><span>Counter Offer</span><input name="counterOffer" type="number" min="0" step="0.01" /></label>
              <label class="field"><span>Brokerage Type</span>
                <select name="brokerageType">
                  <option value="">Auto</option>
                  <option value="PERCENT">Percent</option>
                  <option value="FIXED">Fixed</option>
                </select>
              </label>
              <label class="field"><span>Brokerage %</span><input name="brokeragePercent" type="number" min="0" step="0.01" /></label>
              <label class="field"><span>Brokerage Amount</span><input name="brokerageAmount" type="number" min="0" step="0.01" /></label>
              <label class="field"><span>Assigned Agent ID</span><input name="assignedAgentId" value="USR-0001" /></label>
              <label class="field wide"><span>Notes</span><textarea name="notes"></textarea></label>
            </div>
            <div class="top-actions">
              <button class="btn btn-primary" type="submit">Create Negotiation</button>
            </div>
          </form>
        </section>
      `;

      document.getElementById('closeNegotiationComposer').addEventListener('click', () => {
        composer.hidden = true;
        composer.innerHTML = '';
      });

      document.getElementById('negotiation-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = Object.fromEntries(new FormData(event.target).entries());
        const requestPayload = {
          ...formData,
          askingPrice: formData.askingPrice ? Number(formData.askingPrice) : null,
          initialOffer: formData.initialOffer ? Number(formData.initialOffer) : null,
          currentOffer: formData.currentOffer ? Number(formData.currentOffer) : null,
          counterOffer: formData.counterOffer ? Number(formData.counterOffer) : null,
          brokeragePercent: formData.brokeragePercent ? Number(formData.brokeragePercent) : null,
          brokerageAmount: formData.brokerageAmount ? Number(formData.brokerageAmount) : null
        };

        const createResponse = await fetch('/api/negotiations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestPayload)
        });
        const createPayload = await createResponse.json();

        if (!createPayload.ok) {
          composer.innerHTML = `<div class="empty-state">${escapeHtml(createPayload.error || 'Could not create negotiation')}</div>`;
          return;
        }

        renderNegotiation();
      });
    };

    const runAction = async (negotiationId, action) => {
      let endpoint = `/api/negotiations/${encodeURIComponent(negotiationId)}/${action}`;
      const actionPayload = {};

      if (action === 'offer') {
        const amount = window.prompt('Enter offer amount');
        if (amount === null) return;
        actionPayload.currentOffer = Number(amount);
      }

      if (action === 'counter') {
        const amount = window.prompt('Enter counter-offer amount');
        if (amount === null) return;
        actionPayload.counterOffer = Number(amount);
      }

      if (action === 'accept' || action === 'agree') {
        const amount = window.prompt('Enter agreed price');
        if (amount !== null && amount !== '') {
          actionPayload.agreedPrice = Number(amount);
        }
      }

      if (action === 'token') {
        const tokenAmount = window.prompt('Enter token amount');
        if (tokenAmount === null) return;
        actionPayload.tokenAmount = Number(tokenAmount);
        const tokenDate = window.prompt('Enter token date (YYYY-MM-DD)', new Date().toISOString().slice(0, 10));
        if (tokenDate) actionPayload.tokenDate = tokenDate;
      }

      if (action === 'agreement') {
        actionPayload.agreementDate = new Date().toISOString().slice(0, 10);
      }

      if (action === 'registration') {
        actionPayload.registrationDate = new Date().toISOString().slice(0, 10);
      }

      const actionResponse = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(actionPayload)
      });

      const actionResult = await actionResponse.json();
      if (!actionResult.ok) {
        content.insertAdjacentHTML('afterbegin', `<div class="match-error">${escapeHtml(actionResult.error || `Could not execute ${action}`)}</div>`);
        return;
      }

      renderNegotiation();
    };

    const showHistory = async (negotiationId) => {
      const panel = document.getElementById('negotiationHistoryPanel');
      const historyResponse = await fetch(`/api/negotiations/${encodeURIComponent(negotiationId)}/history`);
      const historyPayload = await historyResponse.json();

      if (!historyPayload.ok) {
        panel.innerHTML = `<div class="empty-state">${escapeHtml(historyPayload.error || 'Could not load history')}</div>`;
        return;
      }

      const rows = historyPayload.data || [];
      panel.innerHTML = `
        <div class="card-header">
          <h2>Negotiation History • ${escapeHtml(negotiationId)}</h2>
          <span class="badge slate">${rows.length} events</span>
        </div>
        <div class="shortlist-table-wrap">
          <table class="leads-table">
            <thead><tr><th>Time</th><th>Action</th><th>Status</th><th>Offer</th><th>User</th><th>Notes</th></tr></thead>
            <tbody>
              ${rows.map((row) => `
                <tr>
                  <td>${escapeHtml(row.Timestamp || '—')}</td>
                  <td>${escapeHtml(row.Action || '—')}</td>
                  <td><div class="cell-wrap">${escapeHtml(row.PreviousStatus || '—')} → ${escapeHtml(row.NewStatus || '—')}</div></td>
                  <td><div class="cell-wrap">${escapeHtml(formatMoneyDisplay(row.PreviousOffer))} → ${escapeHtml(formatMoneyDisplay(row.NewOffer))}</div></td>
                  <td>${escapeHtml(row.User || 'system')}</td>
                  <td><div class="cell-wrap">${escapeHtml(row.Notes || '')}</div></td>
                </tr>
              `).join('') || '<tr><td colspan="6"><div class="empty-state">No history entries</div></td></tr>'}
            </tbody>
          </table>
        </div>
      `;
    };

    document.getElementById('openNegotiationComposer').addEventListener('click', () => openComposer(defaultContext || null));
    document.getElementById('refreshNegotiationBtn').addEventListener('click', () => renderNegotiation(defaultContext || null));

    document.querySelectorAll('.neg-action-btn').forEach((button) => {
      button.addEventListener('click', async () => {
        const negotiationId = button.dataset.negotiationId;
        const action = button.dataset.action;
        await runAction(negotiationId, action);
      });
    });

    document.querySelectorAll('.neg-history-btn').forEach((button) => {
      button.addEventListener('click', async () => {
        await showHistory(button.dataset.negotiationId);
      });
    });

    document.querySelectorAll('.neg-edit-btn').forEach((button) => {
      button.addEventListener('click', async () => {
        const negotiationId = button.dataset.negotiationId;
        const notes = window.prompt('Update notes for this negotiation');
        if (notes === null) return;

        const patchResponse = await fetch(`/api/negotiations/${encodeURIComponent(negotiationId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes })
        });
        const patchPayload = await patchResponse.json();
        if (!patchPayload.ok) {
          content.insertAdjacentHTML('afterbegin', `<div class="match-error">${escapeHtml(patchPayload.error || 'Could not update negotiation')}</div>`);
          return;
        }
        renderNegotiation(defaultContext || null);
      });
    });

    if (defaultContext) {
      openComposer(defaultContext);
    }
  } catch (error) {
    content.innerHTML = `<section class="card-section"><div class="match-error">Could not load negotiation workspace: ${escapeHtml(error.message)}</div></section>`;
  }
}

function getCommissionStatusClass(status) {
  if (status === 'RECEIVED') return 'green';
  if (status === 'PARTIAL' || status === 'OVERDUE') return 'gold';
  if (status === 'CANCELLED') return 'red';
  return 'slate';
}

async function renderDealCenter() {
  const content = document.getElementById('app-content');
  content.innerHTML = '<section class="card-section"><div class="empty-state">Loading deal center...</div></section>';

  try {
    const [dealsResp, tokensResp, commissionsResp] = await Promise.all([
      fetch('/api/deals'),
      fetch('/api/tokens'),
      fetch('/api/commission')
    ]);

    const dealsPayload = await dealsResp.json();
    const tokensPayload = await tokensResp.json();
    const commissionsPayload = await commissionsResp.json();

    const deals = dealsPayload.data || [];
    const tokens = tokensPayload.data || [];
    const commissions = commissionsPayload.data || [];

    const latestDeal = deals[0] || null;
    const latestToken = latestDeal ? tokens.find((row) => row.TokenID === latestDeal.TokenID) : tokens[0] || null;
    const latestCommission = latestDeal ? commissions.find((row) => row.DealID === latestDeal.DealID) : commissions[0] || null;

    content.innerHTML = `
      <section class="card-section">
        <div class="card-header">
          <h2>Deal Center</h2>
          <span class="badge green">Token / Agreement / Registration</span>
        </div>
        <div class="reports-grid">
          <article class="report-box">
            <h3>Active Deal</h3>
            <div class="number">${escapeHtml(latestDeal?.DealID || '—')}</div>
            <div class="tiny">${escapeHtml((latestDeal?.PropertyID || 'No property') + ' • ' + (latestDeal?.Status || 'OPEN'))}</div>
          </article>
          <article class="report-box">
            <h3>Token Amount</h3>
            <div class="number">${formatMoneyDisplay(latestToken?.TokenAmount || 0)}</div>
            <div class="tiny">${escapeHtml((latestToken?.PaymentMode || '—') + (latestToken?.Reference ? ` • ${latestToken.Reference}` : ''))}</div>
          </article>
          <article class="report-box">
            <h3>Commission</h3>
            <div class="number">${formatMoneyDisplay(latestCommission?.GrossCommission || 0)}</div>
            <div class="tiny">${escapeHtml(latestCommission?.Status || 'Not generated')}</div>
          </article>
        </div>
      </section>

      <section class="card-section">
        <div class="card-header">
          <h2>Deal Lifecycle</h2>
          <button class="btn btn-primary" id="openCommissionWorkspace">Open Commission & Closing Workspace</button>
        </div>
        <div class="shortlist-table-wrap">
          <table class="leads-table">
            <thead><tr><th>Deal</th><th>Lead</th><th>Token</th><th>Negotiation</th><th>Final Price</th><th>Status</th><th>Commission</th></tr></thead>
            <tbody>
              ${(deals.map((deal) => {
                const commission = commissions.find((row) => row.DealID === deal.DealID);
                return `
                  <tr>
                    <td>${escapeHtml(deal.DealID)}</td>
                    <td>${escapeHtml(deal.LeadID || '—')}</td>
                    <td>${escapeHtml(deal.TokenID || '—')}</td>
                    <td>${escapeHtml(deal.NegotiationID || '—')}</td>
                    <td>${formatMoneyDisplay(deal.FinalPrice || 0)}</td>
                    <td><span class="badge ${deal.Status === 'CLOSED' ? 'green' : 'gold'}">${escapeHtml(deal.Status || 'OPEN')}</span></td>
                    <td>${commission ? `<span class="badge ${getCommissionStatusClass(commission.Status)}">${escapeHtml(commission.Status)}</span>` : '<span class="badge slate">NOT_GENERATED</span>'}</td>
                  </tr>
                `;
              }).join('')) || '<tr><td colspan="7"><div class="empty-state">No deals available yet.</div></td></tr>'}
            </tbody>
          </table>
        </div>
      </section>
    `;

    const openBtn = document.getElementById('openCommissionWorkspace');
    if (openBtn) {
      openBtn.addEventListener('click', () => renderCommission());
    }
  } catch (error) {
    content.innerHTML = `<section class="card-section"><div class="match-error">Could not load deal center: ${escapeHtml(error.message)}</div></section>`;
  }
}

async function renderCommission() {
  const content = document.getElementById('app-content');
  content.innerHTML = '<section class="card-section"><div class="empty-state">Loading commission workspace...</div></section>';

  try {
    const [summaryResp, dealsResp, commissionsResp] = await Promise.all([
      fetch('/api/commission/summary'),
      fetch('/api/deals'),
      fetch('/api/commission')
    ]);

    const summaryPayload = await summaryResp.json();
    const dealsPayload = await dealsResp.json();
    const commissionsPayload = await commissionsResp.json();

    const summary = summaryPayload.data || {};
    const deals = dealsPayload.data || [];
    const commissions = commissionsPayload.data || [];
    const selectedDeal = deals[0] || null;

    content.innerHTML = `
      <section class="card-section">
        <div class="card-header">
          <h2>Commission</h2>
          <div class="top-actions">
            <button class="btn btn-soft" id="refreshCommissionWorkspace">Refresh</button>
            <button class="btn btn-primary" id="openDealCenterBtn">Deal Center</button>
          </div>
        </div>
        <div class="kpi-grid commission-kpis">
          <article class="kpi-card"><div class="label">Total Commission</div><div class="value">${formatMoneyDisplay(summary.totalCommission || 0)}</div></article>
          <article class="kpi-card"><div class="label">Received</div><div class="value">${formatMoneyDisplay(summary.received || 0)}</div></article>
          <article class="kpi-card"><div class="label">Pending</div><div class="value">${formatMoneyDisplay(summary.pending || 0)}</div></article>
          <article class="kpi-card"><div class="label">This Month</div><div class="value">${formatMoneyDisplay(summary.thisMonth || 0)}</div></article>
          <article class="kpi-card"><div class="label">This Quarter</div><div class="value">${formatMoneyDisplay(summary.thisQuarter || 0)}</div></article>
        </div>
      </section>

      <section class="card-section">
        <div class="card-header"><h2>Commission Generator</h2><span class="badge slate">Deal-linked</span></div>
        <form id="commissionGeneratorForm" class="form-stack">
          <div class="two-col">
            <label class="field">
              <span>Deal ID</span>
              <select name="dealId">${deals.map((deal) => `<option value="${escapeHtml(deal.DealID)}">${escapeHtml(deal.DealID)} (${escapeHtml(deal.Status || 'OPEN')})</option>`).join('')}</select>
            </label>
            <label class="field">
              <span>Commission Type</span>
              <select name="commissionType"><option value="PERCENTAGE">PERCENTAGE</option><option value="FIXED">FIXED</option></select>
            </label>
            <label class="field"><span>Base Amount</span><input name="baseAmount" type="number" step="0.01" value="${Number(selectedDeal?.FinalPrice || 0)}"></label>
            <label class="field"><span>Commission Rate %</span><input name="commissionRate" type="number" step="0.01" value="2"></label>
            <label class="field"><span>Fixed Commission</span><input name="fixedCommission" type="number" step="0.01" value="0"></label>
            <label class="field"><span>Due Date</span><input name="dueDate" type="date"></label>
            <label class="field"><span>Agent Share %</span><input name="agentSharePercent" type="number" step="0.01" value="50"></label>
            <label class="field"><span>Referral Share %</span><input name="referralSharePercent" type="number" step="0.01" value="0"></label>
            <label class="field"><span>Company Share %</span><input name="companySharePercent" type="number" step="0.01" value="50"></label>
            <label class="field"><span>GST %</span><input name="gstRate" type="number" step="0.01" value="0"></label>
            <label class="field"><span>TDS %</span><input name="tdsRate" type="number" step="0.01" value="0"></label>
          </div>
          <div class="top-actions">
            <button class="btn btn-soft" type="button" id="calculateCommissionBtn">Calculate Commission</button>
            <button class="btn btn-primary" type="submit">Generate Commission</button>
          </div>
        </form>
        <div id="commissionCalculationPreview" class="tiny commission-preview"></div>
      </section>

      <section class="card-section">
        <div class="card-header"><h2>Commission Ledger</h2><span class="badge gold">${commissions.length} records</span></div>
        <div class="shortlist-table-wrap">
          <table class="leads-table">
            <thead><tr><th>Commission ID</th><th>Deal</th><th>Gross</th><th>Received</th><th>Pending</th><th>Status</th><th>Due</th><th>Actions</th></tr></thead>
            <tbody>
              ${(commissions.map((row) => `
                <tr data-commission-id="${escapeHtml(row.CommissionID)}" data-deal-id="${escapeHtml(row.DealID)}">
                  <td>${escapeHtml(row.CommissionID)}</td>
                  <td>${escapeHtml(row.DealID)}</td>
                  <td>${formatMoneyDisplay(row.GrossCommission || 0)}</td>
                  <td>${formatMoneyDisplay(row.ReceivedAmount || 0)}</td>
                  <td>${formatMoneyDisplay(row.PendingAmount || 0)}</td>
                  <td><span class="badge ${getCommissionStatusClass(row.Status)}">${escapeHtml(row.Status || 'PENDING')}</span></td>
                  <td>${escapeHtml(row.DueDate || '—')}</td>
                  <td>
                    <div class="req-actions-row">
                      <button class="btn btn-soft commission-payment-btn" data-commission-id="${escapeHtml(row.CommissionID)}" title="Record Payment">Record Payment</button>
                      <button class="btn btn-soft commission-history-btn" data-commission-id="${escapeHtml(row.CommissionID)}" title="View History">View History</button>
                      <button class="btn btn-soft commission-start-closing-btn" data-deal-id="${escapeHtml(row.DealID)}" title="Start Closing">Start Closing</button>
                    </div>
                  </td>
                </tr>
              `).join('')) || '<tr><td colspan="8"><div class="empty-state">No commission records generated yet.</div></td></tr>'}
            </tbody>
          </table>
        </div>
        <div id="commissionHistoryPanel" class="tiny"></div>
      </section>

      <section class="card-section">
        <div class="card-header"><h2>Closing Workspace</h2><span class="badge slate">Checklist + Closure</span></div>
        <div class="top-actions">
          <button class="btn btn-soft" id="loadClosingBtn">Load Closing</button>
          <button class="btn btn-soft" id="completeClosingBtn">Complete Closing</button>
          <button class="btn btn-primary" id="closeDealBtn">Close Deal</button>
        </div>
        <div id="closingWorkspacePanel" class="empty-state">Select a deal and start closing to view checklist.</div>
      </section>
    `;

    const dealSelect = content.querySelector('select[name="dealId"]');
    const generatorForm = document.getElementById('commissionGeneratorForm');
    const preview = document.getElementById('commissionCalculationPreview');

    const collectCommissionPayload = () => {
      const form = new FormData(generatorForm);
      return {
        DealID: form.get('dealId'),
        CommissionType: form.get('commissionType'),
        BaseAmount: Number(form.get('baseAmount') || 0),
        CommissionRate: Number(form.get('commissionRate') || 0),
        FixedCommission: Number(form.get('fixedCommission') || 0),
        AgentSharePercent: Number(form.get('agentSharePercent') || 0),
        ReferralSharePercent: Number(form.get('referralSharePercent') || 0),
        CompanySharePercent: Number(form.get('companySharePercent') || 0),
        GSTRate: Number(form.get('gstRate') || 0),
        TDSRate: Number(form.get('tdsRate') || 0),
        DueDate: form.get('dueDate') || null
      };
    };

    document.getElementById('refreshCommissionWorkspace').addEventListener('click', () => renderCommission());
    document.getElementById('openDealCenterBtn').addEventListener('click', () => renderDealCenter());

    document.getElementById('calculateCommissionBtn').addEventListener('click', async () => {
      const payload = collectCommissionPayload();
      const response = await fetch('/api/commission/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!result.ok) {
        preview.textContent = result.error || 'Could not calculate commission';
        return;
      }

      preview.innerHTML = `Gross: ${formatMoneyDisplay(result.data.GrossCommission)} • Agent: ${formatMoneyDisplay(result.data.AgentShareAmount)} • Referral: ${formatMoneyDisplay(result.data.ReferralShareAmount)} • Company: ${formatMoneyDisplay(result.data.CompanyShareAmount)} • Net Payable: ${formatMoneyDisplay(result.data.NetPayable)}`;
    });

    generatorForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = collectCommissionPayload();
      const response = await fetch('/api/commission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!result.ok) {
        preview.textContent = result.error || 'Could not generate commission';
        return;
      }
      renderCommission();
    });

    const showCommissionHistory = async (commissionId) => {
      const panel = document.getElementById('commissionHistoryPanel');
      const [historyResp, paymentsResp] = await Promise.all([
        fetch(`/api/commission/${encodeURIComponent(commissionId)}/history`),
        fetch(`/api/commission/${encodeURIComponent(commissionId)}/payments`)
      ]);
      const historyPayload = await historyResp.json();
      const paymentsPayload = await paymentsResp.json();
      if (!historyPayload.ok) {
        panel.innerHTML = `<div class="match-error">${escapeHtml(historyPayload.error || 'Could not load commission history')}</div>`;
        return;
      }
      const historyRows = historyPayload.data || [];
      const payments = paymentsPayload.data || [];
      panel.innerHTML = `
        <div class="card-header"><h2>Commission History • ${escapeHtml(commissionId)}</h2><span class="badge slate">${historyRows.length} events</span></div>
        <div class="shortlist-table-wrap">
          <table class="leads-table">
            <thead><tr><th>Event</th><th>Status</th><th>Value</th><th>Date</th><th>Notes</th></tr></thead>
            <tbody>
              ${historyRows.map((row) => `<tr><td>${escapeHtml(row.EntryType || '—')}</td><td>${escapeHtml(row.Status || '—')}</td><td>${formatMoneyDisplay(row.EntryValue || 0)}</td><td>${escapeHtml(row.EntryDate || '—')}</td><td><div class="cell-wrap">${escapeHtml(row.Notes || '')}</div></td></tr>`).join('') || '<tr><td colspan="5"><div class="empty-state">No history entries</div></td></tr>'}
            </tbody>
          </table>
        </div>
        <div class="tiny" style="margin-top:10px;">Payments: ${payments.map((item) => `${escapeHtml(item.PaymentID)} ${formatMoneyDisplay(item.Amount)} (${escapeHtml(item.PaymentMode)})`).join(' • ') || 'No payments yet'}</div>
      `;
    };

    document.querySelectorAll('.commission-history-btn').forEach((button) => {
      button.addEventListener('click', () => showCommissionHistory(button.dataset.commissionId));
    });

    document.querySelectorAll('.commission-payment-btn').forEach((button) => {
      button.addEventListener('click', async () => {
        const amountRaw = window.prompt('Enter payment amount');
        if (amountRaw === null) return;
        const amount = Number(amountRaw);
        if (!Number.isFinite(amount) || amount <= 0) return;
        const paymentMode = (window.prompt('Payment mode: CASH/BANK_TRANSFER/UPI/CHEQUE/OTHER', 'UPI') || 'UPI').toUpperCase();
        const reference = window.prompt('Reference number', '') || '';

        const response = await fetch(`/api/commission/${encodeURIComponent(button.dataset.commissionId)}/payment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ Amount: amount, PaymentMode: paymentMode, ReferenceNumber: reference })
        });
        const result = await response.json();
        if (!result.ok) {
          window.alert(result.error || 'Could not record payment');
          return;
        }
        renderCommission();
      });
    });

    document.querySelectorAll('.commission-start-closing-btn').forEach((button) => {
      button.addEventListener('click', async () => {
        const response = await fetch(`/api/closing/${encodeURIComponent(button.dataset.dealId)}/start`, { method: 'POST' });
        const result = await response.json();
        if (!result.ok && !String(result.error || '').includes('already started')) {
          window.alert(result.error || 'Could not start closing');
          return;
        }
        if (dealSelect) {
          dealSelect.value = button.dataset.dealId;
        }
        document.getElementById('loadClosingBtn').click();
      });
    });

    document.getElementById('loadClosingBtn').addEventListener('click', async () => {
      const dealId = dealSelect?.value;
      if (!dealId) return;
      const response = await fetch(`/api/closing/${encodeURIComponent(dealId)}`);
      const result = await response.json();
      const panel = document.getElementById('closingWorkspacePanel');
      if (!result.ok) {
        panel.innerHTML = `<div class="empty-state">${escapeHtml(result.error || 'Closing not started for this deal')}</div>`;
        return;
      }

      const closing = result.data;
      panel.innerHTML = `
        <div class="card-header"><h2>Closing • ${escapeHtml(closing.ClosingID)}</h2><span class="badge ${closing.Status === 'CLOSED' ? 'green' : 'gold'}">${escapeHtml(closing.Status)}</span></div>
        <div class="checklist-grid">
          ${(closing.Checklist || []).map((item) => `
            <div class="summary-card checklist-item" data-item-key="${escapeHtml(item.ItemKey)}">
              <div class="title">${escapeHtml(item.Label)}</div>
              <div class="status-line"><span class="status-dot"></span>${escapeHtml(item.Status)}</div>
              <div class="tiny">${escapeHtml(item.CompletedBy || '—')} ${escapeHtml(item.CompletedAt || '')}</div>
              <div class="top-actions">
                <button class="btn btn-soft checklist-mark-btn" data-item-key="${escapeHtml(item.ItemKey)}" data-status="COMPLETED">Complete</button>
                <button class="btn btn-soft checklist-mark-btn" data-item-key="${escapeHtml(item.ItemKey)}" data-status="PENDING">Reset</button>
              </div>
            </div>
          `).join('')}
        </div>
      `;

      panel.querySelectorAll('.checklist-mark-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const patchResponse = await fetch(`/api/closing/${encodeURIComponent(dealId)}/checklist`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ItemKey: btn.dataset.itemKey, Status: btn.dataset.status })
          });
          const patchPayload = await patchResponse.json();
          if (!patchPayload.ok) {
            window.alert(patchPayload.error || 'Could not update checklist');
            return;
          }
          document.getElementById('loadClosingBtn').click();
        });
      });
    });

    document.getElementById('completeClosingBtn').addEventListener('click', async () => {
      const dealId = dealSelect?.value;
      if (!dealId) return;
      const response = await fetch(`/api/closing/${encodeURIComponent(dealId)}/complete`, { method: 'POST' });
      const result = await response.json();
      if (!result.ok) {
        window.alert(result.error || 'Could not complete closing');
        return;
      }
      document.getElementById('loadClosingBtn').click();
      renderCommission();
    });

    document.getElementById('closeDealBtn').addEventListener('click', async () => {
      const dealId = dealSelect?.value;
      if (!dealId) return;
      const response = await fetch(`/api/closing/${encodeURIComponent(dealId)}/close`, { method: 'POST' });
      const result = await response.json();
      if (!result.ok) {
        window.alert(result.error || 'Could not close deal');
        return;
      }
      document.getElementById('loadClosingBtn').click();
      renderCommission();
    });
  } catch (error) {
    content.innerHTML = `<section class="card-section"><div class="match-error">Could not load commission workspace: ${escapeHtml(error.message)}</div></section>`;
  }
}

async function renderFollowups() {
  const content = document.getElementById('app-content');
  content.innerHTML = '<section class="card-section"><div class="empty-state">Loading follow-ups...</div></section>';

  try {
    const response = await fetch('/api/followups');
    const payload = await response.json();
    const rows = Array.isArray(payload?.data) ? payload.data : [];

    content.innerHTML = `
      <section class="card-section">
        <div class="card-header"><h2>Follow-up Center</h2><button class="btn btn-primary">+ Schedule Follow-up</button></div>
        <table class="leads-table">
          <thead><tr><th>Follow-up ID</th><th>Lead</th><th>Requirement</th><th>Date</th><th>Priority</th><th>Status</th><th>Assigned To</th><th>Notes</th></tr></thead>
          <tbody>
            ${rows.length ? rows.map((item) => `
              <tr>
                <td>${item.FollowUpID || '—'}</td>
                <td>${item.LeadID || '—'}</td>
                <td>${item.RequirementID || '—'}</td>
                <td>${item.DueDate ? new Date(item.DueDate).toLocaleDateString() : '—'}</td>
                <td><span class="badge ${item.Priority === 'High' ? 'red' : item.Priority === 'Medium' ? 'gold' : 'green'}">${item.Priority || 'Medium'}</span></td>
                <td><span class="badge ${item.Status === 'PENDING' ? 'gold' : 'green'}">${item.Status || 'PENDING'}</span></td>
                <td>${item.AssignedUser || '—'}</td>
                <td>${item.Notes || '—'}</td>
              </tr>
            `).join('') : '<tr><td colspan="8">No follow-ups scheduled.</td></tr>'}
          </tbody>
        </table>
      </section>
    `;
  } catch (error) {
    content.innerHTML = `<section class="card-section"><div class="match-error">Could not load follow-ups: ${escapeHtml(error.message)}</div></section>`;
  }
}

async function renderCalendar() {
  const content = document.getElementById('app-content');
  content.innerHTML = '<section class="card-section"><div class="empty-state">Loading calendar...</div></section>';

  try {
    const response = await fetch('/api/calendar');
    const payload = await response.json();
    const events = Array.isArray(payload?.data) ? payload.data : [];

    content.innerHTML = `
      <section class="card-section">
        <div class="card-header"><h2>Calendar</h2><span class="badge">${new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })}</span></div>
        <div class="reports-grid">
          ${events.length ? events.slice(0, 6).map((event) => `
            <article class="report-box">
              <h3>${event.DueDate ? new Date(event.DueDate).toLocaleDateString() : 'Upcoming'}</h3>
              <div class="tiny">${event.ActivityType || 'Follow-up'} • ${event.AssignedUser || 'Team'}</div>
              <div class="tiny">${event.Notes || 'No notes'} • ${event.Priority || 'Medium'} priority</div>
            </article>
          `).join('') : `
            <article class="report-box">
              <h3>No events</h3>
              <div class="tiny">No scheduled follow-ups or calendar events at the moment.</div>
            </article>
          `}
        </div>
      </section>
    `;
  } catch (error) {
    content.innerHTML = `<section class="card-section"><div class="match-error">Could not load calendar: ${escapeHtml(error.message)}</div></section>`;
  }
}

async function renderReports() {
  const content = document.getElementById('app-content');
  content.innerHTML = '<section class="card-section"><div class="empty-state">Loading Reporting Center...</div></section>';

  const readFilters = () => {
    const datePreset = document.getElementById('reportsDatePreset')?.value || 'thismonth';
    const dateFrom = document.getElementById('reportsDateFrom')?.value || '';
    const dateTo = document.getElementById('reportsDateTo')?.value || '';
    const agentId = document.getElementById('reportsAgentId')?.value?.trim() || '';
    const transactionType = document.getElementById('reportsTransactionType')?.value || '';
    const category = document.getElementById('reportsCategory')?.value || '';
    const location = document.getElementById('reportsLocation')?.value?.trim() || '';
    const leadSource = document.getElementById('reportsLeadSource')?.value || '';
    const dealStatus = document.getElementById('reportsDealStatus')?.value || '';
    const commissionStatus = document.getElementById('reportsCommissionStatus')?.value || '';

    const query = new URLSearchParams();
    query.set('datePreset', datePreset);
    if (dateFrom) query.set('dateFrom', dateFrom);
    if (dateTo) query.set('dateTo', dateTo);
    if (agentId) query.set('agentId', agentId);
    if (transactionType) query.set('transactionType', transactionType);
    if (category) query.set('category', category);
    if (location) query.set('location', location);
    if (leadSource) query.set('leadSource', leadSource);
    if (dealStatus) query.set('dealStatus', dealStatus);
    if (commissionStatus) query.set('commissionStatus', commissionStatus);
    return query.toString();
  };

  const downloadCsv = (type, query) => {
    const url = `/api/reports/export?type=${encodeURIComponent(type)}&format=csv${query ? `&${query}` : ''}`;
    window.open(url, '_blank');
  };

  const renderTableRows = (rows, columns, formatter = (value) => escapeHtml(value ?? '')) => {
    if (!rows || rows.length === 0) {
      return `<tr><td colspan="${columns.length}"><div class="empty-state">No data available</div></td></tr>`;
    }
    return rows.map((row) => `
      <tr>
        ${columns.map((column) => `<td>${formatter(row[column], column, row)}</td>`).join('')}
      </tr>
    `).join('');
  };

  const load = async () => {
    const query = readFilters();
    const endpoint = (path) => `${path}${query ? `?${query}` : ''}`;

    const [
      dashboardResp,
      leadsResp,
      requirementsResp,
      inventoryResp,
      matchingResp,
      shortlistResp,
      siteVisitsResp,
      negotiationsResp,
      tokensResp,
      dealsResp,
      commissionResp,
      closingResp,
      agentsResp,
      sourcesResp,
      locationsResp,
      buildersResp,
      financialResp
    ] = await Promise.all([
      fetch(endpoint('/api/reports/dashboard')),
      fetch(endpoint('/api/reports/leads')),
      fetch(endpoint('/api/reports/requirements')),
      fetch(endpoint('/api/reports/inventory')),
      fetch(endpoint('/api/reports/matching')),
      fetch(endpoint('/api/reports/shortlist')),
      fetch(endpoint('/api/reports/site-visits')),
      fetch(endpoint('/api/reports/negotiations')),
      fetch(endpoint('/api/reports/tokens')),
      fetch(endpoint('/api/reports/deals')),
      fetch(endpoint('/api/reports/commission')),
      fetch(endpoint('/api/reports/closing')),
      fetch(endpoint('/api/reports/agents')),
      fetch(endpoint('/api/reports/sources')),
      fetch(endpoint('/api/reports/locations')),
      fetch(endpoint('/api/reports/builders')),
      fetch(endpoint('/api/reports/financial'))
    ]);

    const dashboardPayload = await dashboardResp.json();
    const leadsPayload = await leadsResp.json();
    const requirementsPayload = await requirementsResp.json();
    const inventoryPayload = await inventoryResp.json();
    const matchingPayload = await matchingResp.json();
    const shortlistPayload = await shortlistResp.json();
    const siteVisitsPayload = await siteVisitsResp.json();
    const negotiationsPayload = await negotiationsResp.json();
    const tokensPayload = await tokensResp.json();
    const dealsPayload = await dealsResp.json();
    const commissionPayload = await commissionResp.json();
    const closingPayload = await closingResp.json();
    const agentsPayload = await agentsResp.json();
    const sourcesPayload = await sourcesResp.json();
    const locationsPayload = await locationsResp.json();
    const buildersPayload = await buildersResp.json();
    const financialPayload = await financialResp.json();

    if (!dashboardPayload.ok) {
      content.innerHTML = `<section class="card-section"><div class="match-error">${escapeHtml(dashboardPayload.error || 'Could not load reports')}</div></section>`;
      return;
    }

    const dashboard = dashboardPayload.data;
    const leads = leadsPayload.data || {};
    const requirements = requirementsPayload.data || {};
    const inventory = inventoryPayload.data || {};
    const matching = matchingPayload.data || {};
    const shortlist = shortlistPayload.data || {};
    const siteVisits = siteVisitsPayload.data || {};
    const negotiations = negotiationsPayload.data || {};
    const tokens = tokensPayload.data || {};
    const deals = dealsPayload.data || {};
    const commission = commissionPayload.data || {};
    const closing = closingPayload.data || {};
    const agents = agentsPayload.data || {};
    const sources = sourcesPayload.data || {};
    const locations = locationsPayload.data || {};
    const builders = buildersPayload.data || {};
    const financial = financialPayload.data || {};

    content.innerHTML = `
      <section class="card-section">
        <div class="card-header">
          <h2>Reporting Center</h2>
          <div class="top-actions">
            <button class="btn btn-soft" id="reportsRefreshBtn">Refresh</button>
            <button class="btn btn-soft reports-export-btn" data-type="leads">Export Leads CSV</button>
            <button class="btn btn-soft reports-export-btn" data-type="deals">Export Deals CSV</button>
            <button class="btn btn-soft reports-export-btn" data-type="commission">Export Commission CSV</button>
            <button class="btn btn-soft reports-export-btn" data-type="agents">Export Agents CSV</button>
          </div>
        </div>
        <form id="reportsFilterForm" class="form-stack">
          <div class="two-col">
            <label class="field"><span>Date Range</span>
              <select id="reportsDatePreset">
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="last7days">Last 7 Days</option>
                <option value="last30days">Last 30 Days</option>
                <option value="thismonth" selected>This Month</option>
                <option value="lastmonth">Last Month</option>
                <option value="thisquarter">This Quarter</option>
                <option value="thisyear">This Year</option>
                <option value="custom">Custom Range</option>
              </select>
            </label>
            <label class="field"><span>Date From</span><input id="reportsDateFrom" type="date"></label>
            <label class="field"><span>Date To</span><input id="reportsDateTo" type="date"></label>
            <label class="field"><span>Agent</span><input id="reportsAgentId" placeholder="USR-0001"></label>
            <label class="field"><span>Transaction</span>
              <select id="reportsTransactionType">
                <option value="">All</option>
                <option>Sale</option><option>Purchase</option><option>Rent</option><option>Rent Out</option><option>Lease</option><option>Lease Out</option>
              </select>
            </label>
            <label class="field"><span>Category</span>
              <select id="reportsCategory">
                <option value="">All</option>
                <option>Residential</option><option>Commercial</option><option>Industrial</option><option>Land</option><option>Agriculture</option>
              </select>
            </label>
            <label class="field"><span>Location</span><input id="reportsLocation" placeholder="Bengaluru"></label>
            <label class="field"><span>Lead Source</span>
              <select id="reportsLeadSource"><option value="">All</option><option>Manual</option><option>Bulk</option><option>WhatsApp</option><option>Reference</option><option>MagicBricks</option><option>99acres</option><option>Housing</option><option>Instagram</option><option>Facebook</option></select>
            </label>
            <label class="field"><span>Deal Status</span><input id="reportsDealStatus" placeholder="COMPLETED"></label>
            <label class="field"><span>Commission Status</span><input id="reportsCommissionStatus" placeholder="PENDING"></label>
          </div>
          <div class="top-actions">
            <button class="btn btn-primary" type="submit">Apply Filters</button>
          </div>
        </form>
      </section>

      <section class="card-section">
        <div class="card-header"><h2>Executive Dashboard</h2><span class="badge slate">Live Data</span></div>
        <div class="kpi-grid commission-kpis">
          <article class="kpi-card"><div class="label">Total Leads</div><div class="value">${dashboard.executive.totalLeads}</div></article>
          <article class="kpi-card"><div class="label">Active Leads</div><div class="value">${dashboard.executive.activeLeads}</div></article>
          <article class="kpi-card"><div class="label">New Leads</div><div class="value">${dashboard.executive.newLeads}</div></article>
          <article class="kpi-card"><div class="label">Hot Leads</div><div class="value">${dashboard.executive.hotLeads}</div></article>
          <article class="kpi-card"><div class="label">Converted Leads</div><div class="value">${dashboard.executive.convertedLeads}</div></article>
        </div>
        <div class="reports-grid" style="margin-top:14px;">
          <article class="report-box"><h3>Inventory</h3><div class="tiny">Total: ${dashboard.inventory.totalProperties}</div><div class="tiny">Available: ${dashboard.inventory.available}</div><div class="tiny">Negotiation: ${dashboard.inventory.underNegotiation}</div><div class="tiny">Tokenized: ${dashboard.inventory.tokenized}</div></article>
          <article class="report-box"><h3>Pipeline</h3><div class="tiny">Matching: ${dashboard.pipeline.matching}</div><div class="tiny">Shortlist: ${dashboard.pipeline.shortlist}</div><div class="tiny">Site Visit: ${dashboard.pipeline.siteVisit}</div><div class="tiny">Deal: ${dashboard.pipeline.deal}</div></article>
          <article class="report-box"><h3>Financial</h3><div class="tiny">Gross Brokerage: ${formatMoneyDisplay(dashboard.financial.grossBrokerage || 0)}</div><div class="tiny">Received: ${formatMoneyDisplay(dashboard.financial.receivedBrokerage || 0)}</div><div class="tiny">Pending: ${formatMoneyDisplay(dashboard.financial.pendingBrokerage || 0)}</div></article>
        </div>
      </section>

      <section class="card-section">
        <div class="card-header"><h2>Lead Conversion Funnel</h2><span class="badge gold">Lifecycle</span></div>
        <table class="leads-table">
          <thead><tr><th>Stage</th><th>Count</th><th>Conversion %</th><th>Drop-off %</th><th>Avg Time</th></tr></thead>
          <tbody>
            ${renderTableRows(leads.funnel || [], ['stage', 'count', 'conversionPercent', 'dropOffPercent', 'averageTimeToNext'], (value, key) => key.includes('Percent') ? `${Number(value || 0).toFixed(2)}%` : escapeHtml(value))}
          </tbody>
        </table>
      </section>

      <section class="card-section">
        <div class="card-header"><h2>Lead Sources</h2><span class="badge slate">Performance</span></div>
        <table class="leads-table">
          <thead><tr><th>Source</th><th>Leads</th><th>Deals</th><th>Conversion %</th><th>Brokerage</th></tr></thead>
          <tbody>
            ${renderTableRows(leads.sourceBreakdown || [], ['leadSource', 'leads', 'deals', 'conversionPercent', 'brokerageContribution'], (value, key) => key === 'brokerageContribution' ? formatMoneyDisplay(value || 0) : key === 'conversionPercent' ? `${Number(value || 0).toFixed(2)}%` : escapeHtml(value))}
          </tbody>
        </table>
      </section>

      <section class="card-section">
        <div class="card-header"><h2>Requirements & Inventory</h2><span class="badge">Distribution</span></div>
        <div class="reports-grid">
          <article class="report-box"><h3>Requirements</h3><div class="tiny">Total: ${requirements.totalRequirements || 0}</div><div class="tiny">Active: ${requirements.activeRequirements || 0}</div><div class="tiny">Archived: ${requirements.archivedRequirements || 0}</div><div class="tiny">Hot: ${requirements.hotRequirements || 0}</div></article>
          <article class="report-box"><h3>Inventory Status</h3><div class="tiny">Total: ${inventory.totalInventory || 0}</div><div class="tiny">Available: ${inventory.available || 0}</div><div class="tiny">Sold: ${inventory.sold || 0}</div><div class="tiny">Rented/Leased: ${(inventory.rented || 0) + (inventory.leased || 0)}</div></article>
          <article class="report-box"><h3>Pricing</h3><div class="tiny">Avg: ${formatMoneyDisplay(inventory.averagePrice || 0)}</div><div class="tiny">Min: ${formatMoneyDisplay(inventory.minimumPrice || 0)}</div><div class="tiny">Max: ${formatMoneyDisplay(inventory.maximumPrice || 0)}</div><div class="tiny">Avg Area: ${escapeHtml(inventory.averageArea || 0)}</div></article>
        </div>
      </section>

      <section class="card-section">
        <div class="card-header"><h2>Matching, Shortlist & Visits</h2><span class="badge">Conversion</span></div>
        <div class="reports-grid">
          <article class="report-box"><h3>Matching</h3><div class="tiny">Total: ${matching.totalMatches || 0}</div><div class="tiny">Strong: ${matching.strongMatches || 0}</div><div class="tiny">Good: ${matching.goodMatches || 0}</div><div class="tiny">No Match Req: ${matching.noMatchRequirements || 0}</div></article>
          <article class="report-box"><h3>Shortlist</h3><div class="tiny">Total: ${shortlist.totalShortlisted || 0}</div><div class="tiny">Active: ${shortlist.activeShortlist || 0}</div><div class="tiny">To Site Visit: ${Number(shortlist.conversion?.shortlistToSiteVisitPercent || 0).toFixed(2)}%</div><div class="tiny">To Deal: ${Number(shortlist.conversion?.shortlistToDealPercent || 0).toFixed(2)}%</div></article>
          <article class="report-box"><h3>Site Visits</h3><div class="tiny">Scheduled: ${siteVisits.scheduled || 0}</div><div class="tiny">Completed: ${siteVisits.completed || 0}</div><div class="tiny">Cancelled: ${siteVisits.cancelled || 0}</div><div class="tiny">To Negotiation: ${Number(siteVisits.conversionToNegotiationPercent || 0).toFixed(2)}%</div></article>
        </div>
      </section>

      <section class="card-section">
        <div class="card-header"><h2>Negotiation, Tokens, Deals</h2><span class="badge">Pipeline Finance</span></div>
        <div class="reports-grid">
          <article class="report-box"><h3>Negotiations</h3><div class="tiny">Total: ${negotiations.totalNegotiations || 0}</div><div class="tiny">Agreed: ${negotiations.agreed || 0}</div><div class="tiny">Completed: ${negotiations.completed || 0}</div><div class="tiny">Avg Discount: ${Number(negotiations.financial?.averageDiscountPercent || 0).toFixed(2)}%</div></article>
          <article class="report-box"><h3>Tokens</h3><div class="tiny">Count: ${tokens.tokenCount || 0}</div><div class="tiny">Amount: ${formatMoneyDisplay(tokens.financial?.totalTokenAmount || 0)}</div><div class="tiny">Received: ${formatMoneyDisplay(tokens.financial?.receivedToken || 0)}</div><div class="tiny">Pending: ${formatMoneyDisplay(tokens.financial?.pendingToken || 0)}</div></article>
          <article class="report-box"><h3>Deals</h3><div class="tiny">Total: ${deals.totalDeals || 0}</div><div class="tiny">Completed: ${deals.completed || 0}</div><div class="tiny">Total Value: ${formatMoneyDisplay(deals.financial?.totalDealValue || 0)}</div><div class="tiny">Avg Value: ${formatMoneyDisplay(deals.financial?.averageDealValue || 0)}</div></article>
        </div>
      </section>

      <section class="card-section">
        <div class="card-header"><h2>Commission & Closing</h2><span class="badge">Phase 4.7 Integrated</span></div>
        <div class="reports-grid">
          <article class="report-box"><h3>Commission</h3><div class="tiny">Gross: ${formatMoneyDisplay(commission.grossCommission || 0)}</div><div class="tiny">Received: ${formatMoneyDisplay(commission.received || 0)}</div><div class="tiny">Pending: ${formatMoneyDisplay(commission.pending || 0)}</div><div class="tiny">Overdue: ${commission.overdue || 0}</div></article>
          <article class="report-box"><h3>Closing</h3><div class="tiny">Started: ${closing.closingStarted || 0}</div><div class="tiny">Pending: ${closing.closingPending || 0}</div><div class="tiny">Completed: ${closing.closingCompleted || 0}</div><div class="tiny">Documents Pending: ${closing.documentsPending || 0}</div></article>
          <article class="report-box"><h3>Financial Snapshot</h3><div class="tiny">Gross Deal Value: ${formatMoneyDisplay(financial.grossDealValue || 0)}</div><div class="tiny">Gross Brokerage: ${formatMoneyDisplay(financial.grossBrokerage || 0)}</div><div class="tiny">Commission Pending: ${formatMoneyDisplay(financial.commissionPending || 0)}</div><div class="tiny">Commission Received: ${formatMoneyDisplay(financial.commissionReceived || 0)}</div></article>
        </div>
      </section>

      <section class="card-section">
        <div class="card-header"><h2>Performance Tables</h2><span class="badge">Agents, Sources, Locations, Builders</span></div>
        <div class="reports-grid">
          <article class="report-box">
            <h3>Top Agents</h3>
            <table class="leads-table">
              <thead><tr><th>Agent</th><th>Leads</th><th>Deals</th><th>Gross Brokerage</th></tr></thead>
              <tbody>${renderTableRows((agents.leaderboard || []).slice(0, 6), ['agentId', 'leads', 'deals', 'grossBrokerage'], (value, key) => key === 'grossBrokerage' ? formatMoneyDisplay(value || 0) : escapeHtml(value))}</tbody>
            </table>
          </article>
          <article class="report-box">
            <h3>Source Performance</h3>
            <table class="leads-table">
              <thead><tr><th>Source</th><th>Leads</th><th>Deals</th><th>Lead→Deal %</th></tr></thead>
              <tbody>${renderTableRows((sources.sources || []).slice(0, 6), ['source', 'leads', 'deals', 'leadToDealPercent'], (value, key) => key === 'leadToDealPercent' ? `${Number(value || 0).toFixed(2)}%` : escapeHtml(value))}</tbody>
            </table>
          </article>
          <article class="report-box">
            <h3>Location / Builder</h3>
            <table class="leads-table">
              <thead><tr><th>Location</th><th>Deals</th><th>Brokerage</th></tr></thead>
              <tbody>${renderTableRows((locations.locations || []).slice(0, 4), ['location', 'deals', 'brokerage'], (value, key) => key === 'brokerage' ? formatMoneyDisplay(value || 0) : escapeHtml(value))}</tbody>
            </table>
            <table class="leads-table" style="margin-top:10px;">
              <thead><tr><th>Builder</th><th>Project</th><th>Deals</th></tr></thead>
              <tbody>${renderTableRows((builders.builders || []).slice(0, 4), ['builderId', 'project', 'deals'])}</tbody>
            </table>
          </article>
        </div>
      </section>
    `;

    const filterForm = document.getElementById('reportsFilterForm');
    filterForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      await load();
    });

    document.getElementById('reportsRefreshBtn').addEventListener('click', async () => {
      await load();
    });

    document.querySelectorAll('.reports-export-btn').forEach((button) => {
      button.addEventListener('click', () => {
        downloadCsv(button.dataset.type, readFilters());
      });
    });
  };

  try {
    await load();
  } catch (error) {
    content.innerHTML = `<section class="card-section"><div class="match-error">Could not load reports: ${escapeHtml(error.message || 'Unknown error')}</div></section>`;
  }
}

function renderBrokers() {
  const content = document.getElementById('app-content');
  content.innerHTML = `
    <section class="card-section">
      <div class="card-header"><h2>Broker Collaboration</h2><button class="btn btn-primary">+ Share Requirement</button></div>
      <div class="reports-grid">
        <article class="report-box">
          <h3>Broker Database</h3>
          <div class="number">18</div>
          <div class="tiny">Active broker network</div>
        </article>
        <article class="report-box">
          <h3>Secure Shares</h3>
          <div class="number">04</div>
          <div class="tiny">Owner identity protected</div>
        </article>
        <article class="report-box">
          <h3>Submissions</h3>
          <div class="number">06</div>
          <div class="tiny">2 approved, 2 under review</div>
        </article>
      </div>
    </section>
  `;
}

function renderLoadingState(label = 'Loading') {
  return `
    <section class="card-section">
      <div class="empty-state">
        <div class="status-line"><span class="status-dot"></span> ${escapeHtml(label)}…</div>
      </div>
    </section>
  `;
}

function renderEmptyState(title, detail) {
  return `
    <div class="empty-state">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(detail)}</p>
    </div>
  `;
}

function renderErrorState(title, message) {
  return `
    <section class="card-section">
      <div class="empty-state">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
      </div>
    </section>
  `;
}

function renderVisibilityBadge(visibility = 'PUBLIC') {
  const normalized = String(visibility || 'PUBLIC').toUpperCase();
  const palette = {
    PUBLIC: 'green',
    BROKER: 'gold',
    INTERNAL: 'slate',
    PRIVATE: 'red'
  };
  return `<span class="badge ${palette[normalized] || 'slate'}">${escapeHtml(normalized)}</span>`;
}

function renderMediaPreview(media) {
  const mediaType = String(media.MediaType || media.mediaType || '').toUpperCase();
  const mimeType = String(media.MimeType || media.mimeType || '').toLowerCase();
  const safePath = String(media.StoragePath || media.storagePath || media.ThumbnailPath || media.thumbnailPath || '').trim();

  if (mediaType === 'IMAGE' || mimeType.startsWith('image/')) {
    if (safePath && /^https?:\/\//i.test(safePath)) {
      return `<div class="media-preview media-image"><img src="${escapeHtml(safePath)}" alt="${escapeHtml(media.Title || 'Media preview')}" /></div>`;
    }
    return `<div class="media-preview media-image placeholder"><span>${escapeHtml(mediaType || 'IMAGE')}</span></div>`;
  }

  if (mediaType === 'VIDEO' || mimeType.startsWith('video/')) {
    return `<div class="media-preview media-video placeholder"><span>${escapeHtml(mediaType || 'VIDEO')}</span></div>`;
  }

  if (mediaType === 'VIRTUAL_TOUR' || /virtual/i.test(mediaType) || /virtual/i.test(mimeType)) {
    return `<div class="media-preview media-virtual placeholder"><span>${escapeHtml('Virtual Tour')}</span></div>`;
  }

  if (mediaType === 'BROCHURE' || mimeType.includes('pdf') || mediaType === 'PDF') {
    return `<div class="media-preview media-pdf placeholder"><span>${escapeHtml('PDF')}</span></div>`;
  }

  return `<div class="media-preview media-unknown placeholder"><span>${escapeHtml(mediaType || 'MEDIA')}</span></div>`;
}

function renderMediaSection(title, items, entityLabel) {
  if (!Array.isArray(items) || items.length === 0) {
    return `
      <div class="media-section">
        <div class="card-header media-header">
          <h3>${escapeHtml(title)}</h3>
        </div>
        ${renderEmptyState(entityLabel || 'No media', 'No media is currently available for this entity.')}
      </div>
    `;
  }

  const cards = items.map((media) => {
    const createdAt = media.CreatedAt || media.createdAt;
    const createdLabel = createdAt ? new Date(createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Unknown date';
    const mediaType = String(media.MediaType || media.mediaType || 'MEDIA').toUpperCase();
    const mime = String(media.MimeType || media.mimeType || '—');

    return `
      <article class="media-card">
        ${renderMediaPreview(media)}
        <div class="media-body">
          <div class="media-topline">
            <h4>${escapeHtml(media.Title || 'Untitled media')}</h4>
            ${renderVisibilityBadge(media.Visibility || media.visibility || 'PUBLIC')}
          </div>
          <div class="media-meta-row">
            <span>${escapeHtml(mediaType)}</span>
            <span>${escapeHtml(mime)}</span>
            <span>${escapeHtml(createdLabel)}</span>
          </div>
          <div class="media-actions">
            <button type="button" class="btn btn-soft btn-small" data-media-title="${escapeHtml(media.Title || 'Media preview')}" data-media-type="${escapeHtml(mediaType)}" data-media-mime="${escapeHtml(mime)}">Preview</button>
            ${media.Visibility && String(media.Visibility).toUpperCase() === 'PRIVATE' ? '<span class="tiny muted">Private</span>' : ''}
          </div>
        </div>
      </article>
    `;
  }).join('');

  return `
    <div class="media-section">
      <div class="card-header media-header">
        <h3>${escapeHtml(title)}</h3>
      </div>
      <div class="media-gallery">${cards}</div>
    </div>
  `;
}

function renderDocumentPanel(title, items) {
  if (!Array.isArray(items) || items.length === 0) {
    return `
      <div class="document-panel">
        <div class="card-header media-header">
          <h3>${escapeHtml(title)}</h3>
        </div>
        ${renderEmptyState('No documents', 'No documents are available for this entity.')}
      </div>
    `;
  }

  const rows = items.map((doc) => {
    const type = String(doc.DocumentType || doc.documentType || 'OTHER').toUpperCase();
    const titleText = doc.Title || doc.title || 'Untitled document';
    const uploadedAt = doc.CreatedAt || doc.createdAt;
    const uploadedLabel = uploadedAt ? new Date(uploadedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Unknown date';
    const status = String(doc.Status || 'ACTIVE').toUpperCase();
    const sizeLabel = Number(doc.SizeBytes || doc.sizeBytes) > 0 ? `${Math.round(Number(doc.SizeBytes || doc.sizeBytes) / 1024)} KB` : '—';

    return `
      <article class="document-card">
        <div class="document-card-top">
          <div>
            <h4>${escapeHtml(titleText)}</h4>
            <div class="document-subtitle">${escapeHtml(type)}</div>
          </div>
          ${renderVisibilityBadge(doc.Visibility || doc.visibility || 'PUBLIC')}
        </div>
        <div class="document-info-row">
          <span><strong>Status:</strong> ${escapeHtml(status)}</span>
          <span><strong>Type:</strong> ${escapeHtml(String(doc.MimeType || doc.mimeType || 'Unknown').toUpperCase())}</span>
        </div>
        <div class="document-info-row">
          <span><strong>Uploaded:</strong> ${escapeHtml(uploadedLabel)}</span>
          <span><strong>Size:</strong> ${escapeHtml(sizeLabel)}</span>
        </div>
      </article>
    `;
  }).join('');

  return `
    <div class="document-panel">
      <div class="card-header media-header">
        <h3>${escapeHtml(title)}</h3>
      </div>
      <div class="document-list">${rows}</div>
    </div>
  `;
}

async function renderDocuments() {
  const content = document.getElementById('app-content');
  content.innerHTML = renderLoadingState('Loading media and documents');

  try {
    const [mediaResponse, documentsResponse] = await Promise.all([
      adminRequest('/api/media'),
      adminRequest('/api/documents')
    ]);

    if (!mediaResponse.ok) {
      throw new Error('Media API request failed');
    }
    if (!documentsResponse.ok) {
      throw new Error('Documents API request failed');
    }

    const mediaPayload = await mediaResponse.json();
    const documentsPayload = await documentsResponse.json();
    const mediaItems = Array.isArray(mediaPayload.data) ? mediaPayload.data : [];
    const documentItems = Array.isArray(documentsPayload.data) ? documentsPayload.data : [];

    const builderMedia = mediaItems.filter((item) => String(item.EntityType || '').toUpperCase() === 'BUILDER' || item.BuilderID);
    const projectMedia = mediaItems.filter((item) => String(item.EntityType || '').toUpperCase() === 'PROJECT' || item.ProjectID);
    const propertyMedia = mediaItems.filter((item) => String(item.EntityType || '').toUpperCase() === 'PROPERTY' || item.PropertyID);

    const builderDocuments = documentItems.filter((item) => String(item.EntityType || '').toUpperCase() === 'BUILDER' || item.BuilderID);
    const projectDocuments = documentItems.filter((item) => String(item.EntityType || '').toUpperCase() === 'PROJECT' || item.ProjectID);
    const propertyDocuments = documentItems.filter((item) => String(item.EntityType || '').toUpperCase() === 'PROPERTY' || item.PropertyID);

    content.innerHTML = `
      <section class="card-section media-workflow">
        <div class="card-header">
          <h2>Media &amp; Documents</h2>
          <button class="btn btn-primary" type="button">+ Upload</button>
        </div>
        ${renderMediaSection('Builder Media', builderMedia, 'Builder media')}
        ${renderMediaSection('Project Media', projectMedia, 'Project media')}
        ${renderMediaSection('Property Media', propertyMedia, 'Property media')}
        ${renderDocumentPanel('Documents', documentItems)}
      </section>
    `;

    const previewButtons = content.querySelectorAll('[data-media-title]');
    previewButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const title = button.dataset.mediaTitle || 'Media preview';
        const type = button.dataset.mediaType || 'MEDIA';
        const mime = button.dataset.mediaMime || '—';

        const modal = document.createElement('div');
        modal.className = 'media-modal';
        modal.innerHTML = `
          <div class="media-modal-card">
            <div class="card-header">
              <h3>${escapeHtml(title)}</h3>
              <button type="button" class="btn btn-soft btn-small media-modal-close">Close</button>
            </div>
            <div class="media-meta-row">
              <span>${escapeHtml(type)}</span>
              <span>${escapeHtml(mime)}</span>
            </div>
            <div class="media-preview-card">
              <div class="media-preview media-unknown placeholder"><span>${escapeHtml(type)}</span></div>
              <p class="tiny">This preview is generated from the media metadata contract and never exposes internal storage paths.</p>
            </div>
          </div>
        `;

        const closeButton = modal.querySelector('.media-modal-close');
        closeButton.addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (event) => {
          if (event.target === modal) {
            modal.remove();
          }
        });
        document.body.appendChild(modal);
      });
    });

    content.querySelector('.btn-primary')?.addEventListener('click', () => {
      content.innerHTML = renderErrorState('Upload workflow', 'Binary upload is not enabled for the current backend contract. This UI reflects the existing metadata API only.');
    });
  } catch (error) {
    content.innerHTML = renderErrorState('Media and documents unavailable', error.message || 'Unknown error');
  }
}

function renderUsers() {
  const content = document.getElementById('app-content');
  content.innerHTML = `
    <section class="card-section">
      <div class="card-header"><h2>Users</h2><button class="btn btn-primary">+ Invite User</button></div>
      <table class="leads-table">
        <thead><tr><th>User</th><th>Role</th><th>Modules</th><th>Status</th><th>Last Login</th></tr></thead>
        <tbody>
          <tr><td>Jatin Sharma</td><td>Admin</td><td>All Modules</td><td><span class="badge green">Active</span></td><td>Today</td></tr>
          <tr><td>Asha Menon</td><td>Agent</td><td>Leads, Site Visits, Negotiation</td><td><span class="badge green">Active</span></td><td>Today</td></tr>
          <tr><td>Rajiv Nair</td><td>Broker</td><td>Broker Portal</td><td><span class="badge slate">Invited</span></td><td>2d ago</td></tr>
        </tbody>
      </table>
    </section>
  `;
}

function renderSettings() {
  const content = document.getElementById('app-content');
  content.innerHTML = `
    <section class="card-section">
      <div class="card-header"><h2>Settings</h2><span class="badge">Configuration</span></div>
      <div class="workspace-summary">
        <div class="summary-card"><div class="title">Workflow</div><div class="big">Transaction Lifecycle</div><p class="tiny">Draft → Matching → Shortlisted → Site Visit → Negotiation → Token → Agreement → Registration → Completed</p></div>
        <div class="summary-card"><div class="title">Access</div><div class="big">Roles</div><p class="tiny">Admin, Manager, Agent, Broker</p></div>
      </div>
    </section>
  `;
}

async function renderAdmin() {
  const content = document.getElementById('app-content');
  content.innerHTML = `<section class="card-section"><div class="empty-state">Loading admin center...</div></section>`;

  try {
    const [overviewRes, usersRes, rolesRes, permissionsRes, settingsRes, mastersRes, pipelineRes, formsRes, notificationsRes, auditRes, backupsRes, healthRes, maintenanceRes] = await Promise.all([
      adminRequest('/api/admin/overview'),
      adminRequest('/api/admin/users'),
      adminRequest('/api/admin/roles'),
      adminRequest('/api/admin/permissions'),
      adminRequest('/api/admin/settings'),
      adminRequest('/api/admin/masters'),
      adminRequest('/api/admin/pipeline'),
      adminRequest('/api/admin/forms'),
      adminRequest('/api/admin/notifications'),
      adminRequest('/api/admin/audit'),
      adminRequest('/api/admin/backups'),
      adminRequest('/api/admin/health'),
      adminRequest('/api/admin/maintenance')
    ]);

    const overview = await overviewRes.json();
    const usersPayload = await usersRes.json();
    const rolesPayload = await rolesRes.json();
    const permissionsPayload = await permissionsRes.json();
    const settingsPayload = await settingsRes.json();
    const mastersPayload = await mastersRes.json();
    const pipelinePayload = await pipelineRes.json();
    const formsPayload = await formsRes.json();
    const notificationsPayload = await notificationsRes.json();
    const auditPayload = await auditRes.json();
    const backupsPayload = await backupsRes.json();
    const healthPayload = await healthRes.json();
    const maintenancePayload = await maintenanceRes.json();

    const users = usersPayload.data || [];
    const roles = rolesPayload.data || [];
    const permissions = permissionsPayload.data || [];
    const settings = settingsPayload.data || {};
    const masters = mastersPayload.data || [];
    const pipeline = pipelinePayload.data || [];
    const forms = formsPayload.data || {};
    const notifications = notificationsPayload.data || {};
    const audit = auditPayload.data || [];
    const backups = backupsPayload.data || [];
    const health = healthPayload.data || { status: 'ERROR', checks: {}, issues: [] };
    const maintenance = maintenancePayload.data || { totalIssues: 0, issues: [] };

    const formTypes = Object.keys(forms);
    const activeFormType = formTypes[0] || 'residential';
    const activeForm = forms[activeFormType] || { formName: 'Form', fields: {} };

    const userRows = users.map((user) => `
      <tr>
        <td>${escapeHtml(user.UserID)}</td>
        <td>${escapeHtml(user.Name)}</td>
        <td>${escapeHtml(user.Email || '')}</td>
        <td>${escapeHtml(user.Mobile || '')}</td>
        <td>${escapeHtml(user.Role || '')}</td>
        <td><span class="badge ${String(user.Status || '').toLowerCase() === 'active' ? 'green' : 'slate'}">${escapeHtml(user.Status || '')}</span></td>
        <td>${escapeHtml(user.LastLoginAt || '—')}</td>
        <td>
          <div class="admin-inline-actions">
            <button class="btn btn-soft admin-user-toggle" data-user-id="${escapeHtml(user.UserID)}" data-status="Active">Activate</button>
            <button class="btn btn-soft admin-user-toggle" data-user-id="${escapeHtml(user.UserID)}" data-status="Inactive">Deactivate</button>
          </div>
        </td>
      </tr>
    `).join('');

    const roleRows = roles.map((role) => `
      <tr>
        <td>${escapeHtml(role.Name || '')}</td>
        <td>${escapeHtml(role.Description || '')}</td>
        <td>${escapeHtml((role.Permissions || []).join(', '))}</td>
        <td>${escapeHtml(role.Status || '')}</td>
      </tr>
    `).join('');

    const masterRows = masters.map((master) => `
      <tr>
        <td>${escapeHtml(master.MasterID)}</td>
        <td>${escapeHtml(master.MasterType)}</td>
        <td>${escapeHtml(master.Label || master.Value || '')}</td>
        <td>${escapeHtml(master.Value || '')}</td>
        <td><span class="badge ${master.Active ? 'green' : 'slate'}">${master.Active ? 'Active' : 'Inactive'}</span></td>
        <td>
          <button class="btn btn-soft admin-master-toggle" data-master-id="${escapeHtml(master.MasterID)}" data-active="false">Deactivate</button>
        </td>
      </tr>
    `).join('');

    const auditRows = audit.map((entry) => `
      <tr>
        <td>${escapeHtml(entry.Timestamp)}</td>
        <td>${escapeHtml(entry.UserName || entry.UserID || '')}</td>
        <td>${escapeHtml(entry.Action || '')}</td>
        <td>${escapeHtml(entry.Module || '')}</td>
        <td>${escapeHtml(entry.EntityType || '')} ${escapeHtml(entry.EntityID || '')}</td>
        <td>${escapeHtml(entry.Result || '')}</td>
      </tr>
    `).join('');

    const backupRows = backups.map((backup) => `
      <tr>
        <td>${escapeHtml(backup.BackupID)}</td>
        <td>${escapeHtml(backup.CreatedAt)}</td>
        <td>${escapeHtml(backup.CreatedBy)}</td>
        <td>${escapeHtml(String(backup.Size || 0))}</td>
        <td>${escapeHtml(backup.Checksum || '')}</td>
        <td><span class="badge green">${escapeHtml(backup.Status || 'AVAILABLE')}</span></td>
        <td><button class="btn btn-primary admin-restore-btn" data-backup-id="${escapeHtml(backup.BackupID)}">Restore</button></td>
      </tr>
    `).join('');

    const formFieldRows = Object.entries(activeForm.fields || {}).map(([fieldId, field]) => `
      <tr>
        <td>${escapeHtml(fieldId)}</td>
        <td>${escapeHtml(field.FieldLabel || '')}</td>
        <td>${escapeHtml(field.FieldType || '')}</td>
        <td>${escapeHtml(field.Section || '')}</td>
        <td>${escapeHtml(field.Required ? 'Yes' : 'No')}</td>
        <td>${escapeHtml(field.Active === false ? 'Inactive' : 'Active')}</td>
        <td><button class="btn btn-soft admin-field-disable" data-form-type="${escapeHtml(activeFormType)}" data-field-id="${escapeHtml(fieldId)}">Deactivate</button></td>
      </tr>
    `).join('');

    content.innerHTML = `
      <section class="admin-shell">
        <header class="admin-hero card-section">
          <div class="admin-hero-copy">
            <div class="eyebrow">System Control Center</div>
            <h2>Admin / Settings / System Control</h2>
            <p class="tiny">Authenticated, persisted, audit-backed system operations for users, roles, settings, masters, forms, notifications, backups, health, and maintenance.</p>
          </div>
          <div class="admin-status-pill ${health.status === 'PASS' ? 'green' : health.status === 'WARNING' ? 'gold' : 'red'}">${escapeHtml(health.status || 'UNKNOWN')}</div>
        </header>

        <section class="admin-overview-grid">
          <article class="admin-kpi"><div class="label">Total Users</div><div class="value">${overview.data.totalUsers || 0}</div></article>
          <article class="admin-kpi"><div class="label">Active Users</div><div class="value">${overview.data.activeUsers || 0}</div></article>
          <article class="admin-kpi"><div class="label">Admin Users</div><div class="value">${overview.data.adminUsers || 0}</div></article>
          <article class="admin-kpi"><div class="label">Manager Users</div><div class="value">${overview.data.managerUsers || 0}</div></article>
          <article class="admin-kpi"><div class="label">Agent Users</div><div class="value">${overview.data.agentUsers || 0}</div></article>
          <article class="admin-kpi"><div class="label">Pending Commission</div><div class="value">${overview.data.pendingCommission || 0}</div></article>
        </section>

        <section class="admin-grid">
          <article class="card-section admin-section">
            <div class="card-header"><h3>Users</h3><span class="badge green">Persistent</span></div>
            <form id="adminUserForm" class="form-stack admin-form-grid">
              <input name="Name" placeholder="Name" required />
              <input name="Email" placeholder="Email" type="email" required />
              <input name="Mobile" placeholder="Mobile" />
              <select name="Role"><option>ADMIN</option><option>MANAGER</option><option selected>AGENT</option></select>
              <select name="Status"><option>Active</option><option>Inactive</option></select>
              <input name="Permissions" placeholder="Permissions comma separated" />
              <button class="btn btn-primary" type="submit">Create User</button>
            </form>
            <div class="table-scroll">
              <table class="leads-table">
                <thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Mobile</th><th>Role</th><th>Status</th><th>Last Login</th><th>Actions</th></tr></thead>
                <tbody>${userRows || '<tr><td colspan="8"><div class="empty-state">No users found</div></td></tr>'}</tbody>
              </table>
            </div>
          </article>

          <article class="card-section admin-section">
            <div class="card-header"><h3>Roles & Permissions</h3><span class="badge">RBAC</span></div>
            <form id="adminRoleForm" class="form-stack admin-form-grid">
              <input name="Name" placeholder="Role name" required />
              <input name="Description" placeholder="Description" />
              <input name="Permissions" placeholder="Permissions comma separated" />
              <button class="btn btn-primary" type="submit">Save Role</button>
            </form>
            <div class="table-scroll">
              <table class="leads-table">
                <thead><tr><th>Role</th><th>Description</th><th>Permissions</th><th>Status</th></tr></thead>
                <tbody>${roleRows || '<tr><td colspan="4"><div class="empty-state">No roles found</div></td></tr>'}</tbody>
              </table>
            </div>
            <div class="mini-list">
              ${permissions.map((perm) => `<div class="mini-chip">${escapeHtml(perm.PermissionCode || '')}</div>`).join('')}
            </div>
          </article>

          <article class="card-section admin-section">
            <div class="card-header"><h3>System Settings</h3><span class="badge slate">Version ${escapeHtml(String(settings.ConfigurationVersion || 1))}</span></div>
            <form id="adminSettingsForm" class="form-stack admin-form-grid">
              <input name="CompanyName" value="${escapeHtml(settings.CompanyName || '')}" placeholder="Company Name" />
              <input name="ApplicationName" value="${escapeHtml(settings.ApplicationName || '')}" placeholder="Application Name" />
              <input name="Timezone" value="${escapeHtml(settings.Timezone || '')}" placeholder="Timezone" />
              <input name="Currency" value="${escapeHtml(settings.Currency || '')}" placeholder="Currency" />
              <input name="DefaultCountry" value="${escapeHtml(settings.DefaultCountry || '')}" placeholder="Default Country" />
              <input name="DefaultState" value="${escapeHtml(settings.DefaultState || '')}" placeholder="Default State" />
              <input name="DefaultCity" value="${escapeHtml(settings.DefaultCity || '')}" placeholder="Default City" />
              <input name="DefaultPageSize" value="${escapeHtml(String(settings.DefaultPageSize || 25))}" placeholder="Page Size" type="number" />
              <input name="SessionTimeoutMinutes" value="${escapeHtml(String(settings.SessionTimeoutMinutes || 60))}" placeholder="Session Timeout" type="number" />
              <input name="CacheDurationMinutes" value="${escapeHtml(String(settings.CacheDurationMinutes || 15))}" placeholder="Cache Duration" type="number" />
              <input name="DefaultBrokeragePercent" value="${escapeHtml(String(settings.Business?.DefaultBrokeragePercent || 2))}" placeholder="Brokerage %" type="number" />
              <input name="DefaultCommissionPercent" value="${escapeHtml(String(settings.Business?.DefaultCommissionPercent || 2))}" placeholder="Commission %" type="number" />
              <button class="btn btn-primary" type="submit">Save Settings</button>
            </form>
          </article>

          <article class="card-section admin-section">
            <div class="card-header"><h3>Master Data</h3><span class="badge">No hard delete</span></div>
            <form id="adminMasterForm" class="form-stack admin-form-grid">
              <select name="MasterType">${['LeadSources', 'Categories', 'TransactionTypes', 'PropertyStatuses', 'DealStatuses', 'NegotiationStatuses', 'TokenStatuses', 'CommissionStatuses', 'ClosingStatuses', 'Locations', 'Builders', 'Projects'].map((type) => `<option value="${type}">${type}</option>`).join('')}</select>
              <input name="Value" placeholder="Value" required />
              <input name="Label" placeholder="Label" />
              <button class="btn btn-primary" type="submit">Add Master</button>
            </form>
            <div class="table-scroll">
              <table class="leads-table">
                <thead><tr><th>ID</th><th>Type</th><th>Label</th><th>Value</th><th>Status</th><th>Action</th></tr></thead>
                <tbody>${masterRows || '<tr><td colspan="6"><div class="empty-state">No master records found</div></td></tr>'}</tbody>
              </table>
            </div>
          </article>

          <article class="card-section admin-section">
            <div class="card-header"><h3>Pipeline Configuration</h3><span class="badge gold">Versioned</span></div>
            <form id="adminPipelineForm" class="form-stack">
              <textarea name="pipelineJson" rows="10">${escapeHtml(JSON.stringify(pipeline, null, 2))}</textarea>
              <button class="btn btn-primary" type="submit">Save Pipeline</button>
            </form>
          </article>

          <article class="card-section admin-section">
            <div class="card-header"><h3>Dynamic Form Builder</h3><span class="badge">FormRegistry</span></div>
            <form id="adminFormSelector" class="form-stack admin-form-grid">
              <select name="formType">${formTypes.map((type) => `<option value="${escapeHtml(type)}" ${type === activeFormType ? 'selected' : ''}>${escapeHtml(type)}</option>`).join('')}</select>
              <input name="formName" value="${escapeHtml(activeForm.formName || '')}" placeholder="Form Name" />
              <textarea name="formFieldsJson" rows="10">${escapeHtml(JSON.stringify(activeForm.fields || {}, null, 2))}</textarea>
              <button class="btn btn-primary" type="submit">Save Form Config</button>
            </form>
            <div class="table-scroll">
              <table class="leads-table">
                <thead><tr><th>Field ID</th><th>Label</th><th>Type</th><th>Section</th><th>Required</th><th>Status</th><th>Action</th></tr></thead>
                <tbody>${formFieldRows || '<tr><td colspan="7"><div class="empty-state">No fields available</div></td></tr>'}</tbody>
              </table>
            </div>
          </article>

          <article class="card-section admin-section">
            <div class="card-header"><h3>Notifications</h3><span class="badge">In-App / Email / WhatsApp</span></div>
            <form id="adminNotificationsForm" class="form-stack admin-form-grid">
              <label class="field-inline"><input type="checkbox" name="InApp" ${notifications.InApp ? 'checked' : ''} /> In-App</label>
              <label class="field-inline"><input type="checkbox" name="Email" ${notifications.Email ? 'checked' : ''} /> Email</label>
              <label class="field-inline"><input type="checkbox" name="WhatsApp" ${notifications.WhatsApp ? 'checked' : ''} /> WhatsApp</label>
              <button class="btn btn-primary" type="submit">Save Notification Settings</button>
            </form>
          </article>

          <article class="card-section admin-section">
            <div class="card-header"><h3>Audit Logs</h3><span class="badge green">Append-only</span></div>
            <div class="table-scroll">
              <table class="leads-table">
                <thead><tr><th>Timestamp</th><th>User</th><th>Action</th><th>Module</th><th>Entity</th><th>Result</th></tr></thead>
                <tbody>${auditRows || '<tr><td colspan="6"><div class="empty-state">No audit records found</div></td></tr>'}</tbody>
              </table>
            </div>
          </article>

          <article class="card-section admin-section">
            <div class="card-header"><h3>Backup & Restore</h3><span class="badge gold">Protected</span></div>
            <form id="adminBackupForm" class="form-stack admin-form-grid">
              <input name="Label" placeholder="Backup label" value="manual" />
              <button class="btn btn-primary" type="submit">Create Backup</button>
            </form>
            <div class="table-scroll">
              <table class="leads-table">
                <thead><tr><th>Backup ID</th><th>Created At</th><th>Created By</th><th>Size</th><th>Checksum</th><th>Status</th><th>Action</th></tr></thead>
                <tbody>${backupRows || '<tr><td colspan="7"><div class="empty-state">No backups available</div></td></tr>'}</tbody>
              </table>
            </div>
          </article>

          <article class="card-section admin-section">
            <div class="card-header"><h3>System Health</h3><span class="badge ${health.status === 'PASS' ? 'green' : health.status === 'WARNING' ? 'gold' : 'red'}">${escapeHtml(health.status || 'UNKNOWN')}</span></div>
            <div class="admin-health-grid">
              ${Object.entries(health.checks || {}).map(([key, value]) => `<div class="health-item"><div class="label">${escapeHtml(key)}</div><div class="value">${value ? 'PASS' : 'ERROR'}</div></div>`).join('')}
            </div>
            <div class="mini-list">${(health.issues || []).map((issue) => `<div class="mini-chip ${health.status === 'ERROR' ? 'red' : 'gold'}">${escapeHtml(issue)}</div>`).join('') || '<div class="empty-state">System checks are clean</div>'}</div>
          </article>

          <article class="card-section admin-section">
            <div class="card-header"><h3>Data Maintenance</h3><span class="badge">${escapeHtml(String(maintenance.totalIssues || 0))} issues</span></div>
            <div class="table-scroll">
              <table class="leads-table">
                <thead><tr><th>Issue</th><th>Entity</th><th>ID</th><th>Severity</th><th>Suggested Action</th></tr></thead>
                <tbody>${(maintenance.issues || []).map((issue) => `<tr><td>${escapeHtml(issue.issueType)}</td><td>${escapeHtml(issue.entity)}</td><td>${escapeHtml(issue.id)}</td><td>${escapeHtml(issue.severity)}</td><td>${escapeHtml(issue.suggestedAction)}</td></tr>`).join('') || '<tr><td colspan="5"><div class="empty-state">No maintenance issues detected</div></td></tr>'}</tbody>
              </table>
            </div>
          </article>
        </section>
      </section>
    `;

    document.getElementById('adminUserForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = Object.fromEntries(new FormData(event.target).entries());
      const payload = { ...formData, Permissions: String(formData.Permissions || '').split(',').map((item) => item.trim()).filter(Boolean) };
      const response = await adminRequest('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) });
      const result = await response.json();
      if (result.ok) renderAdmin();
    });

    document.getElementById('adminRoleForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = Object.fromEntries(new FormData(event.target).entries());
      const payload = { ...formData, Permissions: String(formData.Permissions || '').split(',').map((item) => item.trim()).filter(Boolean) };
      const response = await adminRequest('/api/admin/roles', { method: 'POST', body: JSON.stringify(payload) });
      const result = await response.json();
      if (result.ok) renderAdmin();
    });

    document.getElementById('adminSettingsForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = Object.fromEntries(new FormData(event.target).entries());
      const payload = {
        CompanyName: formData.CompanyName,
        ApplicationName: formData.ApplicationName,
        Timezone: formData.Timezone,
        Currency: formData.Currency,
        DefaultCountry: formData.DefaultCountry,
        DefaultState: formData.DefaultState,
        DefaultCity: formData.DefaultCity,
        DefaultPageSize: Number(formData.DefaultPageSize || 25),
        SessionTimeoutMinutes: Number(formData.SessionTimeoutMinutes || 60),
        CacheDurationMinutes: Number(formData.CacheDurationMinutes || 15),
        Business: {
          DefaultBrokeragePercent: Number(formData.DefaultBrokeragePercent || 2),
          DefaultCommissionPercent: Number(formData.DefaultCommissionPercent || 2)
        }
      };
      const response = await adminRequest('/api/admin/settings', { method: 'PATCH', body: JSON.stringify(payload) });
      const result = await response.json();
      if (result.ok) renderAdmin();
    });

    document.getElementById('adminMasterForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = Object.fromEntries(new FormData(event.target).entries());
      const response = await adminRequest('/api/admin/masters', { method: 'POST', body: JSON.stringify(formData) });
      const result = await response.json();
      if (result.ok) renderAdmin();
    });

    document.getElementById('adminPipelineForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = JSON.parse(event.target.pipelineJson.value);
      const response = await adminRequest('/api/admin/pipeline', { method: 'PATCH', body: JSON.stringify({ modules: Object.entries(payload).map(([module, stages]) => ({ Module: module, Stages: stages })) }) });
      const result = await response.json();
      if (result.ok) renderAdmin();
    });

    document.getElementById('adminFormSelector').addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(event.target);
      const formType = formData.get('formType');
      const formName = formData.get('formName');
      const fields = JSON.parse(formData.get('formFieldsJson'));
      const response = await adminRequest(`/api/admin/forms/${encodeURIComponent(formType)}`, { method: 'PATCH', body: JSON.stringify({ FormName: formName, Fields: fields }) });
      const result = await response.json();
      if (result.ok) renderAdmin();
    });

    document.getElementById('adminNotificationsForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(event.target);
      const payload = {
        InApp: formData.get('InApp') === 'on',
        Email: formData.get('Email') === 'on',
        WhatsApp: formData.get('WhatsApp') === 'on'
      };
      const response = await adminRequest('/api/admin/notifications', { method: 'PATCH', body: JSON.stringify(payload) });
      const result = await response.json();
      if (result.ok) renderAdmin();
    });

    document.getElementById('adminBackupForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = Object.fromEntries(new FormData(event.target).entries());
      const response = await adminRequest('/api/admin/backups', { method: 'POST', body: JSON.stringify(payload) });
      const result = await response.json();
      if (result.ok) renderAdmin();
    });

    document.querySelectorAll('.admin-user-toggle').forEach((button) => {
      button.addEventListener('click', async () => {
        const response = await adminRequest(`/api/admin/users/${button.dataset.userId}/status`, { method: 'PATCH', body: JSON.stringify({ status: button.dataset.status }) });
        const result = await response.json();
        if (result.ok) renderAdmin();
      });
    });

    document.querySelectorAll('.admin-master-toggle').forEach((button) => {
      button.addEventListener('click', async () => {
        const response = await adminRequest(`/api/admin/masters/${button.dataset.masterId}`, { method: 'PATCH', body: JSON.stringify({ Active: button.dataset.active === 'true' }) });
        const result = await response.json();
        if (result.ok) renderAdmin();
      });
    });

    document.querySelectorAll('.admin-restore-btn').forEach((button) => {
      button.addEventListener('click', async () => {
        if (!window.confirm('Restore selected backup?')) return;
        const confirmation = window.prompt('Type RESTORE to confirm');
        if (confirmation !== 'RESTORE') return;
        const response = await adminRequest('/api/admin/restore', { method: 'POST', body: JSON.stringify({ backupId: button.dataset.backupId, confirm: 'RESTORE' }) });
        const result = await response.json();
        if (result.ok) renderAdmin();
      });
    });

    document.querySelectorAll('.admin-field-disable').forEach((button) => {
      button.addEventListener('click', async () => {
        const response = await adminRequest(`/api/admin/forms/${encodeURIComponent(button.dataset.formType)}/fields/${encodeURIComponent(button.dataset.fieldId)}`, { method: 'PATCH', body: JSON.stringify({ Active: false }) });
        const result = await response.json();
        if (result.ok) renderAdmin();
      });
    });
  } catch (error) {
    content.innerHTML = `<section class="card-section"><div class="empty-state">Could not load admin center: ${escapeHtml(error.message)}</div></section>`;
  }
}

function initApp() {
  renderNavigation();
  renderModule('dashboard');
}

initApp();
