const { test, expect } = require('@playwright/test');

test.setTimeout(120000);

function uniqueMobile() {
  return `9${Date.now().toString().slice(-9)}`;
}

async function post(request, route, data) {
  const res = await request.post(route, { data });
  const body = await res.json();
  expect(res.ok(), `${route} failed: ${JSON.stringify(body)}`).toBeTruthy();
  expect(body.ok, `${route} returned ok:false`).toBeTruthy();
  return body.data;
}

async function get(request, route) {
  const res = await request.get(route);
  const body = await res.json();
  expect(res.ok(), `${route} failed: ${JSON.stringify(body)}`).toBeTruthy();
  expect(body.ok, `${route} returned ok:false`).toBeTruthy();
  return body.data;
}

async function setLeadStatus(page, status) {
  await page.locator('button[onclick="openEditModal()"]').click();
  await page.locator('#edit-status').selectOption(status);
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.locator('#edit-modal')).toHaveClass(/hidden/);
  await page.reload();
  await expect(page.locator('#client-status-badge')).toContainText(status);
}

async function ensureDetailsOpen(page) {
  const timelineTab = page.locator('.tab[data-tab="timeline"]');
  if (!(await timelineTab.isVisible())) {
    await page.locator('#details-toggle').click();
  }
}

test('full CRM workflow persists through Lead → Won with matching/shortlist/site-visit/negotiation/deal', async ({ page, request }) => {
  const lead = await post(request, '/api/v2/clients', {
    ClientName: 'Full CRM Lead',
    PrimaryMobile: uniqueMobile()
  });
  const leadId = lead.LeadID;

  await page.goto(`/client-workspace.html?id=${encodeURIComponent(leadId)}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#workspace')).toBeVisible();

  await setLeadStatus(page, 'Contacted');

  await page.locator('#sidebar-followups-card button').click();
  await page.locator('#fu-type').selectOption('Email');
  await page.locator('#fu-priority').selectOption('High');
  await page.locator('#fu-date').fill('2026-12-31');
  await page.locator('#fu-time').fill('17:30');
  await page.locator('#fu-notes').fill('full-crm follow-up');
  await page.locator('#followup-modal button.btn-primary').click();
  await expect(page.locator('#followup-modal')).toHaveClass(/hidden/);
  await page.reload();
  await page.locator('#details-toggle').click();
  await page.locator('.tab[data-tab="followups"]').click();
  await expect(page.locator('#followups-list')).toContainText('full-crm follow-up');
  await expect(page.locator('#followups-list')).toContainText('Email');

  const followups = await get(request, `/api/v2/followups?leadId=${encodeURIComponent(leadId)}`);
  const scheduled = followups.find((f) => String(f.notes || f.Notes || '').includes('full-crm follow-up'));
  expect(scheduled).toBeTruthy();
  await post(request, `/api/v2/followups/${encodeURIComponent(scheduled.id || scheduled.FollowUpID)}/complete`, {});
  await page.reload();
  await page.locator('#details-toggle').click();
  await page.locator('.tab[data-tab="followups"]').click();
  await expect(page.locator('#followups-list')).toContainText('Completed');

  await setLeadStatus(page, 'Follow-up');
  await setLeadStatus(page, 'Qualified');

  const txn = await post(request, `/api/v2/clients/${encodeURIComponent(leadId)}/transactions`, { TransactionType: 'Rent' });
  const requirement = await post(request, `/api/v2/transactions/${encodeURIComponent(txn.TransactionID)}/requirements`, {
    LeadID: leadId,
    TransactionType: 'Rent',
    Category: 'Commercial',
    SubCategory: 'Office',
    RequirementStatus: 'Active',
    BudgetMax: 60000,
    Location1: 'Vesu',
    RequiredAreaMin: 1000,
    RequiredAreaMax: 1500,
    Furnishing: 'Furnished',
    SeatingRequired: true,
    SeatingCapacity: 25,
    CabinsRequired: true,
    CabinCount: 3,
    ConferenceRoomRequired: true,
    ConferenceRoomCount: 1,
    ParkingRequired: true,
    ParkingCarCount: 5
  });
  const reqId = requirement.RequirementID;

  await setLeadStatus(page, 'Requirement Created');

  const good = await post(request, '/api/inventory', {
    transactionType: 'Rent',
    category: 'Commercial',
    subCategory: 'Office',
    propertyType: 'Office',
    project: 'Good Office Inventory',
    location: 'Vesu',
    city: 'Surat',
    area: 1250,
    price: 55000,
    furnishingType: 'Furnished',
    seatingCapacity: 30,
    cabinCount: 3,
    conferenceRoomCount: 1,
    parkingCarCount: 6,
    status: 'Available'
  });
  const poor = await post(request, '/api/inventory', {
    transactionType: 'Rent',
    category: 'Commercial',
    subCategory: 'Office',
    propertyType: 'Office',
    project: 'Poor Office Inventory',
    location: 'Vesu',
    city: 'Surat',
    area: 700,
    price: 55000,
    furnishingType: 'Unfurnished',
    seatingCapacity: 15,
    cabinCount: 1,
    conferenceRoomCount: 0,
    parkingCarCount: 1,
    status: 'Available'
  });

  await page.reload();
  await page.getByTestId(`req-matches-${reqId}`).click();
  const goodCard = page.getByTestId(`mm-card-${good.PropertyID}`);
  const poorCard = page.getByTestId(`mm-card-${poor.PropertyID}`);
  await expect(goodCard).toBeVisible();
  await expect(poorCard).toBeVisible();
  const goodScore = Number(await page.getByTestId(`mm-score-${good.PropertyID}`).textContent());
  const poorScore = Number(await page.getByTestId(`mm-score-${poor.PropertyID}`).textContent());
  expect(goodScore).toBeGreaterThan(poorScore);

  await page.getByTestId(`mm-shortlist-${good.PropertyID}`).click();
  await expect(page.getByTestId(`mm-shortlist-${good.PropertyID}`)).toContainText('Shortlisted');
  await page.getByTestId(`req-shortlist-${reqId}`).click();
  await expect(page.getByTestId(`sl-remove-${good.PropertyID}`)).toBeVisible();

  await page.getByTestId(`sv-schedule-${reqId}`).click();
  await page.getByTestId(`sv-date`).fill('2026-12-20');
  await page.getByTestId(`sv-time`).fill('11:00');
  await page.locator('#sv-submit-btn').click();
  const booking = page.locator(`[data-testid^="booking-"]`).first();
  await expect(booking).toBeVisible();
  await page.locator(`[data-testid^="sv-complete-"]`).first().click();
  await expect(booking).toContainText('Completed');
  await setLeadStatus(page, 'Site Visit');

  const shortlistRows = await get(request, `/api/v2/shortlist/${encodeURIComponent(reqId)}?status=Active`);
  expect(shortlistRows.length).toBeGreaterThan(0);
  const shortlist = shortlistRows[0];

  const negotiation = await post(request, '/api/negotiations', {
    LeadID: leadId,
    RequirementID: reqId,
    TransactionID: txn.TransactionID,
    PropertyID: good.PropertyID,
    MatchID: shortlist.MatchID,
    AskingPrice: 55000,
    CurrentOffer: 54000,
    AgreedPrice: 54500,
    Status: 'AGREED',
    Notes: 'Full CRM negotiation'
  });
  await setLeadStatus(page, 'Negotiation');

  const token = await post(request, '/api/tokens', {
    NegotiationID: negotiation.NegotiationID,
    LeadID: leadId,
    RequirementID: reqId,
    PropertyID: good.PropertyID,
    TokenAmount: 100000,
    Status: 'PENDING'
  });
  const deal = await post(request, '/api/deals', {
    LeadID: leadId,
    RequirementID: reqId,
    PropertyID: good.PropertyID,
    NegotiationID: negotiation.NegotiationID,
    TokenID: token.TokenID,
    FinalPrice: 54500,
    Brokerage: 1090,
    Status: 'OPEN'
  });

  await page.reload();
  await page.locator('#details-toggle').click();
  await page.locator('.tab[data-tab="deals"]').click();
  await expect(page.locator('#deals-list')).toContainText(deal.DealID);

  await setLeadStatus(page, 'Won');
  const reqAfterWon = await get(request, `/api/v2/requirements/${encodeURIComponent(reqId)}`);
  expect(String(reqAfterWon.RequirementStatus || reqAfterWon.Status)).toBe('Active');

  await ensureDetailsOpen(page);
  await page.locator('.tab[data-tab="timeline"]').click();
  await expect(page.locator('#timeline-list')).toContainText('Follow-up scheduled');
  await expect(page.locator('#timeline-list')).toContainText('Lead status changed');
});

test('lost/reactivate keeps linked records intact and requirement status independent', async ({ page, request }) => {
  const lead = await post(request, '/api/v2/clients', {
    ClientName: 'Lost Reactivate Lead',
    PrimaryMobile: uniqueMobile()
  });
  const leadId = lead.LeadID;

  const txn = await post(request, `/api/v2/clients/${encodeURIComponent(leadId)}/transactions`, { TransactionType: 'Rent' });
  const requirement = await post(request, `/api/v2/transactions/${encodeURIComponent(txn.TransactionID)}/requirements`, {
    LeadID: leadId,
    TransactionType: 'Rent',
    Category: 'Commercial',
    SubCategory: 'Office',
    RequirementStatus: 'Active',
    BudgetMax: 60000,
    Location1: 'Vesu'
  });
  const reqId = requirement.RequirementID;

  const prop = await post(request, '/api/inventory', {
    transactionType: 'Rent',
    category: 'Commercial',
    subCategory: 'Office',
    propertyType: 'Office',
    project: 'Lost Path Inventory',
    location: 'Vesu',
    city: 'Surat',
    area: 1250,
    price: 55000,
    status: 'Available'
  });

  const matchRun = await post(request, '/api/matching/run', { requirementId: reqId });
  const match = (matchRun.matches || []).find((m) => m.PropertyID === prop.PropertyID);
  expect(match).toBeTruthy();

  const shortlist = await post(request, '/api/shortlist', {
    requirementId: reqId,
    propertyId: prop.PropertyID,
    matchId: match.MatchID,
    priority: 'High'
  });
  await post(request, '/api/v2/site-visit-bookings', {
    requirementId: reqId,
    propertyIds: [prop.PropertyID],
    visitDate: '2026-12-22',
    visitTime: '12:00',
    duration: '90 mins',
    meetingPoint: 'Main gate',
    notes: 'Lost path booking'
  });

  await page.goto(`/client-workspace.html?id=${encodeURIComponent(leadId)}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#workspace')).toBeVisible();

  await page.locator('#sidebar-followups-card button').click();
  await page.locator('#fu-type').selectOption('Call');
  await page.locator('#fu-priority').selectOption('Medium');
  await page.locator('#fu-date').fill('2026-12-25');
  await page.locator('#fu-time').fill('10:00');
  await page.locator('#fu-notes').fill('lost-path follow-up');
  await page.locator('#followup-modal button.btn-primary').click();
  await expect(page.locator('#followup-modal')).toHaveClass(/hidden/);

  await page.locator('#btn-mark-lost').click();
  await expect(page.locator('#lead-lost-modal')).not.toHaveClass(/hidden/);
  await page.locator('#lead-lost-reason').fill('No response');
  await page.locator('#lead-lost-note').fill('Stopped responding');
  await page.locator('#lead-lost-modal button.btn-primary').click();
  await expect(page.locator('#lead-lost-modal')).toHaveClass(/hidden/);
  await page.reload();
  await expect(page.locator('#client-status-badge')).toContainText('Lost');

  await ensureDetailsOpen(page);
  await expect(page.locator('#transactions-list .txn-card').first()).toBeVisible();
  await expect(page.locator('#needs-list')).toContainText(reqId);

  await page.getByTestId(`req-shortlist-${reqId}`).click();
  await expect(page.getByTestId(`sl-remove-${prop.PropertyID}`)).toBeVisible();
  await expect(page.locator(`[data-testid^="booking-"]`).first()).toBeVisible();

  await ensureDetailsOpen(page);
  await page.locator('.tab[data-tab="timeline"]').click();
  await expect(page.locator('#timeline-list')).toContainText('Lead marked Lost');

  await page.locator('#btn-reactivate-lead').click();
  await page.reload();
  await expect(page.locator('#client-status-badge')).not.toContainText('Lost');

  const reqAfterReactivate = await get(request, `/api/v2/requirements/${encodeURIComponent(reqId)}`);
  expect(String(reqAfterReactivate.RequirementStatus || reqAfterReactivate.Status)).toBe('Active');
});
