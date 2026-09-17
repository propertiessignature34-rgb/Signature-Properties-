'use strict';

// Property Investment & Rental Return Intelligence — deterministic calculation
// engine. Pure functions, no I/O. Server-side authoritative. Never returns
// NaN / Infinity to callers (guarded via `safe`).

function num(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function safe(v) {
  return Number.isFinite(v) ? v : 0;
}
function round2(v) {
  return Math.round(safe(v) * 100) / 100;
}

// ── Rent escalation ─────────────────────────────────────────────────────────
function calculateRentProjection(monthlyRent, growthPct, years, frequency = 'annual') {
  const rent = Math.max(0, num(monthlyRent));
  const g = num(growthPct) / 100;
  const rows = [];
  let current = rent;
  const step = frequency === 'biennial' ? 2 : 1;
  for (let y = 1; y <= years; y++) {
    if (y > 1 && ((y - 1) % step === 0)) {
      current = current * (1 + g * step);
    }
    rows.push({ year: y, monthlyRent: current, annualRent: current * 12 });
  }
  return rows;
}

function calculateAnnualRent(monthlyRent) {
  return Math.max(0, num(monthlyRent)) * 12;
}

// ── Yields ──────────────────────────────────────────────────────────────────
function calculateRentalYield(annualRent, propertyValue) {
  const pv = num(propertyValue);
  if (pv <= 0) return 0;
  return (num(annualRent) / pv) * 100;
}

// ── Vacancy ───────────────────────────────────────────────────────────────
function calculateVacancyLoss(annualRent, monthlyRent, { method = 'percent', vacancyPct = 0, vacancyMonths = 0 } = {}) {
  if (method === 'months') {
    return Math.max(0, num(monthlyRent)) * Math.max(0, Math.min(12, num(vacancyMonths)));
  }
  const pct = Math.max(0, Math.min(100, num(vacancyPct)));
  return num(annualRent) * (pct / 100);
}

// ── NOI ───────────────────────────────────────────────────────────────────
function ownerAnnualExpenses(input) {
  const e = 0
    + (input.tenantPaysMaintenance ? 0 : num(input.ownerMaintenance))
    + (input.tenantPaysPropertyTax ? 0 : num(input.ownerPropertyTax))
    + num(input.insurance)
    + num(input.repairs)
    + num(input.otherAnnualExpenses);
  return Math.max(0, e);
}
function calculateNOI(grossAnnualRent, vacancyLoss, ownerExpenses) {
  return num(grossAnnualRent) - num(vacancyLoss) - num(ownerExpenses);
}

// ── Loan / EMI ──────────────────────────────────────────────────────────────
function calculateEMI(principal, annualRatePct, tenureYears) {
  const P = Math.max(0, num(principal));
  const n = Math.max(0, Math.round(num(tenureYears) * 12));
  const r = num(annualRatePct) / 12 / 100;
  if (P <= 0 || n <= 0) return 0;
  if (r === 0) return P / n;
  const pow = Math.pow(1 + r, n);
  return (P * r * pow) / (pow - 1);
}

function calculateLoanSchedule(principal, annualRatePct, tenureYears, holdingYears) {
  const P = Math.max(0, num(principal));
  const emi = calculateEMI(P, annualRatePct, tenureYears);
  const r = num(annualRatePct) / 12 / 100;
  const totalMonths = Math.max(0, Math.round(num(tenureYears) * 12));
  const byYear = [];
  let balance = P;
  const years = Math.max(1, Math.round(num(holdingYears)));
  let month = 0;
  let totalInterest = 0;
  for (let y = 1; y <= years; y++) {
    let interestY = 0;
    let principalY = 0;
    for (let m = 0; m < 12 && month < totalMonths; m++, month++) {
      const interest = balance * r;
      let principalPaid = emi - interest;
      if (principalPaid > balance) principalPaid = balance;
      balance = Math.max(0, balance - principalPaid);
      interestY += interest;
      principalY += principalPaid;
      totalInterest += interest;
    }
    byYear.push({ year: y, interest: interestY, principal: principalY, balance });
  }
  return { emi, byYear, endingBalanceByYear: byYear.map((r2) => r2.balance), totalInterest };
}

// ── Property appreciation ────────────────────────────────────────────────────
function calculatePropertyValueProjection(currentValue, appreciationPct, years) {
  const g = num(appreciationPct) / 100;
  const rows = [];
  let v = Math.max(0, num(currentValue));
  for (let y = 1; y <= years; y++) {
    v = v * (1 + g);
    rows.push({ year: y, value: v });
  }
  return rows;
}

// ── IRR / XIRR ───────────────────────────────────────────────────────────────
function npv(rate, cashflows) {
  return cashflows.reduce((acc, cf, i) => acc + cf / Math.pow(1 + rate, i), 0);
}
function calculateIRR(cashflows) {
  if (!Array.isArray(cashflows) || cashflows.length < 2) return null;
  const hasNeg = cashflows.some((c) => c < 0);
  const hasPos = cashflows.some((c) => c > 0);
  if (!hasNeg || !hasPos) return null;
  let lo = -0.9999, hi = 10;
  let fLo = npv(lo, cashflows), fHi = npv(hi, cashflows);
  if (fLo * fHi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid, cashflows);
    if (Math.abs(fMid) < 1e-7) return mid * 100;
    if (fLo * fMid < 0) { hi = mid; fHi = fMid; } else { lo = mid; fLo = fMid; }
  }
  const irr = (lo + hi) / 2;
  return Number.isFinite(irr) ? irr * 100 : null;
}
function xnpv(rate, flows) {
  const t0 = flows[0].date;
  return flows.reduce((acc, f) => {
    const days = (f.date - t0) / (1000 * 60 * 60 * 24);
    return acc + f.amount / Math.pow(1 + rate, days / 365);
  }, 0);
}
function calculateXIRR(flows) {
  if (!Array.isArray(flows) || flows.length < 2) return null;
  const parsed = flows.map((f) => ({ amount: num(f.amount), date: new Date(f.date).getTime() }));
  if (parsed.some((f) => !Number.isFinite(f.date))) return null;
  const hasNeg = parsed.some((f) => f.amount < 0);
  const hasPos = parsed.some((f) => f.amount > 0);
  if (!hasNeg || !hasPos) return null;
  let lo = -0.9999, hi = 10;
  let fLo = xnpv(lo, parsed), fHi = xnpv(hi, parsed);
  if (fLo * fHi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = xnpv(mid, parsed);
    if (Math.abs(fMid) < 1e-7) return mid * 100;
    if (fLo * fMid < 0) { hi = mid; fHi = fMid; } else { lo = mid; fLo = fMid; }
  }
  const r = (lo + hi) / 2;
  return Number.isFinite(r) ? r * 100 : null;
}

function calculateEquityMultiple(totalInflows, totalInvested) {
  const inv = num(totalInvested);
  if (inv <= 0) return 0;
  return num(totalInflows) / inv;
}

function calculateBreakEven(initialInvested, cumulativeInflowByYear) {
  const target = num(initialInvested);
  for (let i = 0; i < cumulativeInflowByYear.length; i++) {
    if (cumulativeInflowByYear[i] >= target) return i + 1;
  }
  return null;
}

// ── Validation ────────────────────────────────────────────────────────────
function validateInput(input = {}) {
  const errors = [];
  if (num(input.propertyValue ?? input.currentMarketValue ?? input.purchasePrice) <= 0) errors.push('Property value must be greater than 0');
  if (num(input.monthlyRent) < 0) errors.push('Rent cannot be negative');
  if (num(input.rentGrowthPct) < -100) errors.push('Rent growth cannot be below -100%');
  if (num(input.appreciationPct) < -100) errors.push('Appreciation cannot be below -100%');
  const vp = num(input.vacancyPct);
  if (vp < 0 || vp > 100) errors.push('Vacancy % must be between 0 and 100');
  if (num(input.interestRatePct) < 0) errors.push('Interest rate cannot be negative');
  if (num(input.loanAmount) < 0) errors.push('Loan amount cannot be negative');
  if (num(input.holdingYears) <= 0) errors.push('Holding period must be greater than 0');
  return { ok: errors.length === 0, errors };
}

// ── Main analysis ───────────────────────────────────────────────────────────
function analyze(rawInput = {}) {
  const input = { ...rawInput };
  const validation = validateInput(input);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const years = Math.max(1, Math.min(40, Math.round(num(input.holdingYears, 10))));
  const purchasePrice = num(input.purchasePrice ?? input.propertyValue);
  const currentValue = num(input.currentMarketValue ?? input.propertyValue ?? purchasePrice);
  const totalAcquisitionCost = Math.max(0,
    purchasePrice + num(input.stampDuty) + num(input.registration) + num(input.brokerage)
    + num(input.interior) + num(input.otherAcquisition));

  const rentRows = calculateRentProjection(input.monthlyRent, input.rentGrowthPct ?? 5, years, input.rentFrequency || 'annual');
  const valueRows = calculatePropertyValueProjection(currentValue, input.appreciationPct ?? 5, years);

  const year1Annual = calculateAnnualRent(input.monthlyRent);
  const grossYield = calculateRentalYield(year1Annual, currentValue);

  // Loan
  const loanAmount = num(input.loanAmount);
  const hasLoan = loanAmount > 0;
  const loanSchedule = hasLoan
    ? calculateLoanSchedule(loanAmount, input.interestRatePct, input.loanTenureYears, years)
    : { emi: 0, byYear: [], endingBalanceByYear: [], totalInterest: 0 };
  const ownerExp = ownerAnnualExpenses(input);

  const projection = [];
  let cumulativeGrossRent = 0;
  let cumulativeNetRent = 0;
  const equityCashflowByYear = [];
  for (let i = 0; i < years; i++) {
    const y = i + 1;
    const annualRent = rentRows[i].annualRent;
    const vacancyLoss = calculateVacancyLoss(annualRent, rentRows[i].monthlyRent, {
      method: input.vacancyMethod || 'percent',
      vacancyPct: input.vacancyPct,
      vacancyMonths: input.vacancyMonths
    });
    const noi = calculateNOI(annualRent, vacancyLoss, ownerExp);
    const loanYear = loanSchedule.byYear[i] || { interest: 0, principal: 0, balance: 0 };
    const debtService = hasLoan ? loanSchedule.emi * 12 : 0;
    const equityCashFlow = noi - debtService;
    cumulativeGrossRent += annualRent;
    cumulativeNetRent += noi;
    equityCashflowByYear.push(equityCashFlow);
    projection.push({
      year: y,
      monthlyRent: round2(rentRows[i].monthlyRent),
      annualRent: round2(annualRent),
      vacancy: round2(vacancyLoss),
      ownerExpenses: round2(ownerExp),
      noi: round2(noi),
      propertyValue: round2(valueRows[i].value),
      loanBalance: round2(hasLoan ? loanYear.balance : 0),
      loanInterest: round2(loanYear.interest),
      operatingCashFlow: round2(noi),
      debtService: round2(debtService),
      cashFlow: round2(equityCashFlow)
    });
  }

  const futureValue = valueRows[years - 1].value;
  const capitalAppreciation = futureValue - purchasePrice;
  const capitalGainPct = purchasePrice > 0 ? (capitalAppreciation / purchasePrice) * 100 : 0;

  // Sale
  const exitYear = Math.max(1, Math.min(years, Math.round(num(input.exitYear, years))));
  const expectedSellingPrice = num(input.expectedSellingPrice) > 0
    ? num(input.expectedSellingPrice)
    : valueRows[exitYear - 1].value;
  const sellingCosts = expectedSellingPrice * (num(input.sellingBrokeragePct) / 100) + num(input.otherSellingCosts);
  const outstandingLoanAtExit = hasLoan ? (loanSchedule.endingBalanceByYear[exitYear - 1] ?? 0) : 0;
  const netSaleProceeds = expectedSellingPrice - sellingCosts - outstandingLoanAtExit;

  const initialCashInvested = Math.max(0, (hasLoan ? (totalAcquisitionCost - loanAmount) : totalAcquisitionCost)
    + num(input.loanProcessingFee) + num(input.otherLoanCharges));

  // Cash flow series up to exit year for IRR
  const flowYears = exitYear;
  const cashflows = [-initialCashInvested];
  const cumulativeInflow = [];
  let runInflow = 0;
  for (let y = 1; y <= flowYears; y++) {
    let cf = equityCashflowByYear[y - 1] || 0;
    if (y === flowYears) cf += netSaleProceeds;
    cashflows.push(cf);
    runInflow += (equityCashflowByYear[y - 1] || 0) + (y === flowYears ? netSaleProceeds : 0);
    cumulativeInflow.push(runInflow);
  }

  const irr = calculateIRR(cashflows);

  // XIRR with dates if acquisitionDate provided
  let xirr = null;
  const acq = input.acquisitionDate ? new Date(input.acquisitionDate) : null;
  if (acq && Number.isFinite(acq.getTime())) {
    const flows = [{ amount: -initialCashInvested, date: acq }];
    for (let y = 1; y <= flowYears; y++) {
      const d = new Date(acq); d.setFullYear(d.getFullYear() + y);
      let cf = equityCashflowByYear[y - 1] || 0;
      if (y === flowYears) cf += netSaleProceeds;
      flows.push({ amount: cf, date: d });
    }
    xirr = calculateXIRR(flows);
  }

  const totalInflows = cumulativeInflow[cumulativeInflow.length - 1] + initialCashInvested; // inflows exclude the initial outflow
  const totalProfit = cumulativeNetRentUpTo(equityCashflowByYear, flowYears) + netSaleProceeds - initialCashInvested;
  const totalROI = initialCashInvested > 0 ? (totalProfit / initialCashInvested) * 100 : 0;
  const equityMultiple = calculateEquityMultiple(
    cumulativeNetRentUpTo(equityCashflowByYear, flowYears) + netSaleProceeds,
    initialCashInvested
  );
  const annualizedROI = (equityMultiple > 0 && flowYears > 0)
    ? (Math.pow(equityMultiple, 1 / flowYears) - 1) * 100
    : 0;
  const breakEvenYear = calculateBreakEven(initialCashInvested, cumulativeInflow);

  const noiYear1 = projection[0].noi;
  const netYieldOnCost = totalAcquisitionCost > 0 ? (noiYear1 / totalAcquisitionCost) * 100 : 0;
  const netYieldOnValue = currentValue > 0 ? (noiYear1 / currentValue) * 100 : 0;
  const annualCashFlowY1 = projection[0].cashFlow;
  const cashOnCash = initialCashInvested > 0 ? (annualCashFlowY1 / initialCashInvested) * 100 : 0;

  return {
    ok: true,
    metrics: {
      totalAcquisitionCost: round2(totalAcquisitionCost),
      currentValue: round2(currentValue),
      annualRentYear1: round2(year1Annual),
      grossYield: round2(grossYield),
      noiYear1: round2(noiYear1),
      netYieldOnCost: round2(netYieldOnCost),
      netYieldOnValue: round2(netYieldOnValue),
      annualCashFlowYear1: round2(annualCashFlowY1),
      monthlyCashFlowYear1: round2(annualCashFlowY1 / 12),
      cashOnCash: round2(cashOnCash),
      emi: round2(loanSchedule.emi),
      totalInterest: round2(loanSchedule.totalInterest),
      totalGrossRent: round2(cumulativeGrossRent),
      totalNetRent: round2(cumulativeNetRent),
      futureValue: round2(futureValue),
      capitalAppreciation: round2(capitalAppreciation),
      capitalGainPct: round2(capitalGainPct),
      netSaleProceeds: round2(netSaleProceeds),
      initialCashInvested: round2(initialCashInvested),
      totalProfit: round2(totalProfit),
      totalROI: round2(totalROI),
      annualizedROI: round2(annualizedROI),
      equityMultiple: round2(equityMultiple),
      irr: irr === null ? null : round2(irr),
      xirr: xirr === null ? null : round2(xirr),
      breakEvenYear,
      hasLoan,
      exitYear,
      holdingYears: years
    },
    projection,
    scenarios: buildScenarios(input),
    sensitivity: buildSensitivity(input),
    disclaimer: 'All projections are based on user-entered assumptions and are not guaranteed. Actual rent, vacancy, expenses, property values, taxes, financing costs and sale proceeds may differ.'
  };
}

function cumulativeNetRentUpTo(equityCashflowByYear, upToYear) {
  let s = 0;
  for (let y = 1; y <= upToYear; y++) s += equityCashflowByYear[y - 1] || 0;
  return s;
}

function buildScenarios(input) {
  const base = input;
  const mk = (rentAdj, apprAdj, vacAdj) => {
    const r = analyzeCore({
      ...base,
      rentGrowthPct: num(base.rentGrowthPct ?? 5) + rentAdj,
      appreciationPct: num(base.appreciationPct ?? 5) + apprAdj,
      vacancyPct: Math.max(0, num(base.vacancyPct) + vacAdj)
    });
    return r;
  };
  return {
    conservative: mk(-2, -2, +3),
    base: mk(0, 0, 0),
    optimistic: mk(+2, +2, -Math.min(num(input.vacancyPct), 2))
  };
}

// Lightweight version returning only headline metrics (avoids recursion of scenarios/sensitivity).
function analyzeCore(input) {
  const full = analyzeNoNesting(input);
  if (!full.ok) return { ok: false };
  const m = full.metrics;
  return {
    ok: true,
    totalROI: m.totalROI,
    annualizedROI: m.annualizedROI,
    irr: m.irr,
    totalNetRent: m.totalNetRent,
    futureValue: m.futureValue,
    grossYield: m.grossYield,
    netYieldOnCost: m.netYieldOnCost
  };
}

function buildSensitivity(input) {
  const apprValues = [3, 5, 7, 9];
  const rentValues = [3, 5, 7];
  const matrix = [];
  for (const appr of apprValues) {
    const row = { appreciation: appr, cells: [] };
    for (const rent of rentValues) {
      const r = analyzeNoNesting({ ...input, appreciationPct: appr, rentGrowthPct: rent, holdingYears: 10 });
      row.cells.push({
        rentGrowth: rent,
        totalReturn: r.ok ? r.metrics.totalProfit : 0,
        irr: r.ok ? r.metrics.irr : null,
        totalRent: r.ok ? r.metrics.totalGrossRent : 0,
        futureValue: r.ok ? r.metrics.futureValue : 0
      });
    }
    matrix.push(row);
  }
  return { appreciation: apprValues, rentGrowth: rentValues, matrix };
}

// analyze without scenario/sensitivity nesting to prevent infinite recursion
function analyzeNoNesting(rawInput) {
  const clone = { ...rawInput, __noNesting: true };
  const original = { scenarios: buildScenarios, sensitivity: buildSensitivity };
  // temporary shadow to skip nesting
  const r = analyzeMetricsOnly(clone);
  return r;
}

function analyzeMetricsOnly(input) {
  // Reuse analyze but strip nested arrays by calling a metrics-only path.
  const res = analyzeInternal(input);
  return res;
}

// Split core so scenarios/sensitivity can reuse metric computation without recursion.
function analyzeInternal(input) {
  const saved = { s: buildScenarios, sen: buildSensitivity };
  // Compute metrics via analyze() but disable nested by monkey-guard
  return analyzeGuarded(input);
}

let __inNested = false;
function analyzeGuarded(input) {
  if (__inNested) {
    return analyzeMetricsCompute(input);
  }
  __inNested = true;
  try {
    return analyzeMetricsCompute(input);
  } finally {
    __inNested = false;
  }
}

// The actual metric computation (no scenarios/sensitivity) — used by nested calls.
function analyzeMetricsCompute(rawInput) {
  const input = { ...rawInput };
  const validation = validateInput(input);
  if (!validation.ok) return { ok: false, errors: validation.errors };
  const years = Math.max(1, Math.min(40, Math.round(num(input.holdingYears, 10))));
  const purchasePrice = num(input.purchasePrice ?? input.propertyValue);
  const currentValue = num(input.currentMarketValue ?? input.propertyValue ?? purchasePrice);
  const totalAcquisitionCost = Math.max(0, purchasePrice + num(input.stampDuty) + num(input.registration) + num(input.brokerage) + num(input.interior) + num(input.otherAcquisition));
  const rentRows = calculateRentProjection(input.monthlyRent, input.rentGrowthPct ?? 5, years, input.rentFrequency || 'annual');
  const valueRows = calculatePropertyValueProjection(currentValue, input.appreciationPct ?? 5, years);
  const year1Annual = calculateAnnualRent(input.monthlyRent);
  const grossYield = calculateRentalYield(year1Annual, currentValue);
  const loanAmount = num(input.loanAmount);
  const hasLoan = loanAmount > 0;
  const loanSchedule = hasLoan ? calculateLoanSchedule(loanAmount, input.interestRatePct, input.loanTenureYears, years) : { emi: 0, byYear: [], endingBalanceByYear: [], totalInterest: 0 };
  const ownerExp = ownerAnnualExpenses(input);
  let cumulativeGrossRent = 0, cumulativeNetRent = 0;
  const equityCashflowByYear = [];
  for (let i = 0; i < years; i++) {
    const annualRent = rentRows[i].annualRent;
    const vacancyLoss = calculateVacancyLoss(annualRent, rentRows[i].monthlyRent, { method: input.vacancyMethod || 'percent', vacancyPct: input.vacancyPct, vacancyMonths: input.vacancyMonths });
    const noi = calculateNOI(annualRent, vacancyLoss, ownerExp);
    const debtService = hasLoan ? loanSchedule.emi * 12 : 0;
    equityCashflowByYear.push(noi - debtService);
    cumulativeGrossRent += annualRent;
    cumulativeNetRent += noi;
  }
  const futureValue = valueRows[years - 1].value;
  const capitalAppreciation = futureValue - purchasePrice;
  const exitYear = Math.max(1, Math.min(years, Math.round(num(input.exitYear, years))));
  const expectedSellingPrice = num(input.expectedSellingPrice) > 0 ? num(input.expectedSellingPrice) : valueRows[exitYear - 1].value;
  const sellingCosts = expectedSellingPrice * (num(input.sellingBrokeragePct) / 100) + num(input.otherSellingCosts);
  const outstandingLoanAtExit = hasLoan ? (loanSchedule.endingBalanceByYear[exitYear - 1] ?? 0) : 0;
  const netSaleProceeds = expectedSellingPrice - sellingCosts - outstandingLoanAtExit;
  const initialCashInvested = Math.max(0, (hasLoan ? (totalAcquisitionCost - loanAmount) : totalAcquisitionCost) + num(input.loanProcessingFee) + num(input.otherLoanCharges));
  const cashflows = [-initialCashInvested];
  for (let y = 1; y <= exitYear; y++) {
    let cf = equityCashflowByYear[y - 1] || 0;
    if (y === exitYear) cf += netSaleProceeds;
    cashflows.push(cf);
  }
  const irr = calculateIRR(cashflows);
  const cumNet = cumulativeNetRentUpTo(equityCashflowByYear, exitYear);
  const totalProfit = cumNet + netSaleProceeds - initialCashInvested;
  const totalROI = initialCashInvested > 0 ? (totalProfit / initialCashInvested) * 100 : 0;
  const equityMultiple = calculateEquityMultiple(cumNet + netSaleProceeds, initialCashInvested);
  const annualizedROI = (equityMultiple > 0 && exitYear > 0) ? (Math.pow(equityMultiple, 1 / exitYear) - 1) * 100 : 0;
  return {
    ok: true,
    metrics: {
      grossYield: round2(grossYield),
      netYieldOnCost: totalAcquisitionCost > 0 ? round2((cumulativeNetRent / years / totalAcquisitionCost) * 100) : 0,
      totalGrossRent: round2(cumulativeGrossRent),
      totalNetRent: round2(cumulativeNetRent),
      futureValue: round2(futureValue),
      capitalAppreciation: round2(capitalAppreciation),
      totalProfit: round2(totalProfit),
      totalROI: round2(totalROI),
      annualizedROI: round2(annualizedROI),
      irr: irr === null ? null : round2(irr)
    }
  };
}

module.exports = {
  analyze,
  validateInput,
  calculateAnnualRent,
  calculateRentProjection,
  calculateRentalYield,
  calculateVacancyLoss,
  calculateNOI,
  calculateEMI,
  calculateLoanSchedule,
  calculatePropertyValueProjection,
  calculateIRR,
  calculateXIRR,
  calculateEquityMultiple,
  calculateBreakEven,
  ownerAnnualExpenses
};
