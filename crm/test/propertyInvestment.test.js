'use strict';
const test = require('node:test');
const assert = require('node:assert');
const calc = require('../src/services/propertyInvestmentCalculatorService');

const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;

test('annual rent', () => {
  assert.strictEqual(calc.calculateAnnualRent(76000), 912000);
});

test('gross rental yield 6.08%', () => {
  const y = calc.calculateRentalYield(912000, 15000000);
  assert.ok(near(y, 6.08, 0.01), `got ${y}`);
});

test('5% rent escalation year 2 & 3', () => {
  const rows = calc.calculateRentProjection(76000, 5, 3, 'annual');
  assert.strictEqual(Math.round(rows[0].monthlyRent), 76000);
  assert.strictEqual(Math.round(rows[1].monthlyRent), 79800);
  assert.strictEqual(Math.round(rows[2].monthlyRent), 83790);
});

test('vacancy percent & months', () => {
  assert.strictEqual(calc.calculateVacancyLoss(912000, 76000, { method: 'percent', vacancyPct: 5 }), 45600);
  assert.strictEqual(calc.calculateVacancyLoss(912000, 76000, { method: 'months', vacancyMonths: 1 }), 76000);
});

test('tenant-paid expenses excluded from owner expenses', () => {
  const withTenant = calc.ownerAnnualExpenses({ tenantPaysMaintenance: true, ownerMaintenance: 60000, tenantPaysPropertyTax: true, ownerPropertyTax: 20000 });
  assert.strictEqual(withTenant, 0);
  const withOwner = calc.ownerAnnualExpenses({ ownerMaintenance: 60000, insurance: 5000 });
  assert.strictEqual(withOwner, 65000);
});

test('NOI', () => {
  assert.strictEqual(calc.calculateNOI(912000, 45600, 0), 866400);
});

test('EMI zero-interest and standard', () => {
  assert.strictEqual(calc.calculateEMI(1200000, 0, 10), 10000);
  const emi = calc.calculateEMI(1000000, 8.5, 20);
  assert.ok(near(emi, 8678, 5), `got ${emi}`);
});

test('loan amortization reduces balance', () => {
  const s = calc.calculateLoanSchedule(1000000, 8.5, 20, 5);
  assert.ok(s.byYear[4].balance < 1000000);
  assert.ok(s.totalInterest > 0);
});

test('property appreciation 5%', () => {
  const rows = calc.calculatePropertyValueProjection(15000000, 5, 2);
  assert.strictEqual(Math.round(rows[0].value), 15750000);
  assert.strictEqual(Math.round(rows[1].value), 16537500);
});

test('IRR basic', () => {
  const irr = calc.calculateIRR([-1000, 1200]);
  assert.ok(near(irr, 20, 0.1), `got ${irr}`);
});

test('IRR no solution returns null', () => {
  assert.strictEqual(calc.calculateIRR([100, 200]), null);
});

test('XIRR basic', () => {
  const irr = calc.calculateXIRR([{ amount: -1000, date: '2020-01-01' }, { amount: 1200, date: '2021-01-01' }]);
  assert.ok(near(irr, 20, 0.5), `got ${irr}`);
});

test('equity multiple & break-even', () => {
  assert.strictEqual(calc.calculateEquityMultiple(2000, 1000), 2);
  assert.strictEqual(calc.calculateBreakEven(1000, [300, 700, 1100]), 3);
  assert.strictEqual(calc.calculateBreakEven(5000, [300, 700]), null);
});

test('full analyze — headline test case', () => {
  const r = calc.analyze({ propertyValue: 15000000, monthlyRent: 76000, rentGrowthPct: 5, appreciationPct: 5, holdingYears: 10, tenantPaysMaintenance: true, tenantPaysWater: true });
  assert.ok(r.ok);
  assert.strictEqual(r.metrics.annualRentYear1, 912000);
  assert.ok(near(r.metrics.grossYield, 6.08, 0.01));
  assert.strictEqual(r.projection.length, 10);
  assert.strictEqual(Math.round(r.projection[1].monthlyRent), 79800);
  assert.strictEqual(Math.round(r.projection[2].monthlyRent), 83790);
  assert.ok(r.metrics.futureValue > 15000000);
  assert.ok(Number.isFinite(r.metrics.totalROI));
  assert.ok(r.scenarios.base.ok);
  assert.ok(r.sensitivity.matrix.length === 4);
});

test('edge cases — no rent, zero appreciation, zero growth, no loan', () => {
  const r = calc.analyze({ propertyValue: 10000000, monthlyRent: 0, rentGrowthPct: 0, appreciationPct: 0, holdingYears: 5 });
  assert.ok(r.ok);
  assert.strictEqual(r.metrics.annualRentYear1, 0);
  assert.strictEqual(r.metrics.futureValue, 10000000);
  Object.values(r.metrics).forEach(v => { if (typeof v === 'number') assert.ok(Number.isFinite(v)); });
});

test('invalid input rejected', () => {
  const r = calc.analyze({ propertyValue: 0, monthlyRent: 100, holdingYears: 10 });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.length > 0);
});

test('no NaN/Infinity for extreme values', () => {
  const r = calc.analyze({ propertyValue: 1e12, monthlyRent: 1234.56, rentGrowthPct: 5, appreciationPct: 7, holdingYears: 40, loanAmount: 5e11, interestRatePct: 9, loanTenureYears: 30 });
  assert.ok(r.ok);
  Object.values(r.metrics).forEach(v => { if (typeof v === 'number') assert.ok(Number.isFinite(v)); });
  r.projection.forEach(row => Object.values(row).forEach(v => { if (typeof v === 'number') assert.ok(Number.isFinite(v)); }));
});
