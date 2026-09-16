const fs = require('fs');
const path = require('path');

const filePath = process.argv[2];
if (!filePath) {
  throw new Error('Usage: node e2e/seed-test-db.js <database-file>');
}

fs.mkdirSync(path.dirname(filePath), { recursive: true });

const db = {
  Users: [{
    UserID: 'USR-0001',
    Name: 'Playwright Administrator',
    Email: 'playwright.admin@example.com',
    Role: 'ADMIN',
    Status: 'Active',
    Permissions: ['*'],
    CompanyID: 'COMP-DEFAULT',
    BrokerageID: 'BRK-DEFAULT'
  }],
  Leads: [{
    LeadID: 'LEAD-0001',
    Name: 'Playwright Lead',
    Status: 'New',
    CompanyID: 'COMP-DEFAULT',
    BrokerageID: 'BRK-DEFAULT'
  }],
  Requirements: [{
    RequirementID: 'REQ-0001',
    LeadID: 'LEAD-0001',
    RequirementStatus: 'Active',
    Status: 'Active',
    CompanyID: 'COMP-DEFAULT',
    BrokerageID: 'BRK-DEFAULT'
  }]
};

fs.writeFileSync(filePath, JSON.stringify(db, null, 2));