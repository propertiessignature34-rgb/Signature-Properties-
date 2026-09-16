const { JsonRepository } = require('./repository');
const db = new JsonRepository();

const seed = db.read();
if (seed.Leads.length === 0) {
  seed.Leads.push({
    LeadID: 'LEAD-0001',
    ClientName: 'Rohan Verma',
    City: 'Bengaluru',
    Phone: '+91 9876543210',
    Email: 'rohan.v@example.com',
    LeadStatus: 'Active',
    AssignedAgentID: 'USR-0001',
    CreatedAt: new Date().toISOString(),
    UpdatedAt: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
    ArchiveFlag: false
  });

  seed.Requirements.push({
    RequirementID: 'REQ-0001',
    RequirementCode: 'REQ-0001',
    LeadID: 'LEAD-0001',
    TransactionID: 'TXN-0001',
    Category: 'Residential',
    SubCategory: 'Apartment',
    PropertyType: 'Apartment',
    BudgetMin: 17000000,
    BudgetMax: 20000000,
    Location1: 'Bengaluru East',
    Location2: 'Indiranagar',
    Location3: null,
    Possession: 'Ready',
    Urgency: 'High',
    SpecialNotes: 'Testing requirement',
    Status: 'Active',
    TransactionType: 'Purchase',
    CreatedAt: new Date().toISOString(),
    UpdatedAt: new Date().toISOString(),
    VersionNumber: 1
  });

  seed.Transactions.push({
    TransactionID: 'TXN-0001',
    LeadID: 'LEAD-0001',
    Type: 'Purchase',
    Status: 'Draft',
    UpdatedAt: new Date().toISOString()
  });

  seed.Activities.push({
    ActivityID: 'ACT-0001',
    LeadID: 'LEAD-0001',
    TransactionID: 'TXN-0001',
    ActivityType: 'Note',
    Notes: 'Bootstrap activity',
    CreatedAt: new Date().toISOString()
  });

  db.write(seed);
}

module.exports = { db };
