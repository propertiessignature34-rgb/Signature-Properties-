const modelSchema = {
  entityDefinitions: {
    Users: ['UserID', 'Name', 'Mobile', 'Role', 'Email', 'Status', 'Permissions', 'CreatedAt', 'UpdatedAt', 'LastLoginAt'],
    Roles: ['RoleID', 'Name', 'Description', 'Permissions', 'Status', 'SystemRole', 'CreatedAt', 'UpdatedAt'],
    Leads: ['LeadID', 'ClientName', 'City', 'Phone', 'Email', 'LeadStatus', 'AssignedAgentID', 'CreatedAt', 'UpdatedAt', 'ArchiveFlag'],
    Transactions: ['TransactionID', 'LeadID', 'Type', 'Status', 'UpdatedAt'],
    Requirements: ['RequirementID', 'RequirementCode', 'LeadID', 'TransactionID', 'TransactionType', 'Category', 'SubCategory', 'PropertyType', 'BudgetMin', 'BudgetMax', 'Location1', 'Location2', 'Location3', 'BHKMin', 'BHKMax', 'AreaMin', 'AreaMax', 'Possession', 'Urgency', 'SpecialNotes', 'Status', 'CreatedAt', 'UpdatedAt'],
    RequirementHistory: ['RequirementHistoryID', 'RequirementID', 'Status', 'UpdatedBy', 'UpdatedAt'],
    Inventory: ['PropertyID', 'TransactionType', 'Category', 'SubCategory', 'PropertyType', 'Project', 'Location', 'City', 'BHK', 'Area', 'Price', 'Possession', 'Status', 'OwnerID', 'BrokerID', 'BuilderID'],
    Activities: ['ActivityID', 'LeadID', 'TransactionID', 'ActivityType', 'Notes', 'CreatedAt'],
    Timeline: ['TimelineID', 'LeadID', 'EntityType', 'EntityID', 'EventType', 'EventTitle', 'EventDate', 'Payload'],
    FollowUps: ['FollowUpID', 'LeadID', 'TransactionID', 'Date', 'Time', 'Type', 'Priority', 'Notes', 'Status', 'AssignedTo'],
    Brokers: ['BrokerID', 'BrokerName', 'BrokerType', 'Company', 'Status'],
    BrokerShares: ['BrokerShareID', 'RequirementID', 'BrokerID', 'ShareCode', 'Status', 'CreatedAt'],
    BrokerSubmissions: ['BrokerSubmissionID', 'LeadID', 'RequirementID', 'BrokerID', 'Status', 'RejectReason', 'Version', 'SubmittedAt'],
    Matches: ['MatchID', 'RequirementID', 'PropertyID', 'LeadID', 'Score', 'MatchLevel', 'MatchedCriteria', 'FailedCriteria', 'UnknownCriteria', 'ScoreBreakdown', 'Explanation', 'Status', 'AlgorithmVersion', 'CreatedAt', 'UpdatedAt'],
    Shortlists: ['ShortlistID', 'LeadID', 'TransactionID', 'RequirementID', 'PropertyID', 'CreatedAt', 'Status'],
    SiteVisits: ['VisitID', 'LeadID', 'TransactionID', 'RequirementID', 'PropertyID', 'AgentID', 'Date', 'Time', 'Status', 'Feedback'],
    Negotiations: ['NegotiationID', 'LeadID', 'RequirementID', 'TransactionID', 'PropertyID', 'MatchID', 'ShortlistID', 'SiteVisitID', 'AskingPrice', 'InitialOffer', 'CurrentOffer', 'CounterOffer', 'FinalOffer', 'AgreedPrice', 'BrokerageType', 'BrokeragePercent', 'BrokerageAmount', 'BrokeragePayer', 'TokenAmount', 'TokenDate', 'PaymentTerms', 'PossessionDate', 'AgreementDate', 'RegistrationDate', 'SpecialTerms', 'Notes', 'AssignedAgentID', 'CreatedBy', 'UpdatedBy', 'Status', 'CreatedAt', 'UpdatedAt', 'ClosedAt', 'History'],
    NegotiationHistory: ['NegotiationHistoryID', 'NegotiationID', 'Action', 'PreviousStatus', 'NewStatus', 'PreviousOffer', 'NewOffer', 'User', 'Timestamp', 'Notes'],
    Deals: ['DealID', 'Buyer', 'Seller', 'Property', 'Transaction', 'Price', 'Brokerage', 'Token', 'Agreement', 'Registration', 'Commission', 'Documents'],
    Commission: ['CommissionID', 'DealID', 'TokenID', 'NegotiationID', 'TransactionID', 'LeadID', 'RequirementID', 'PropertyID', 'AgentID', 'BrokerID', 'ReferralID', 'CommissionType', 'CommissionBasis', 'CommissionRate', 'FixedCommission', 'BaseAmount', 'CommissionAmount', 'GrossCommission', 'BrokerageSide', 'BuyerSide', 'SellerSide', 'RentLeaseBrokerage', 'AgentSharePercent', 'CompanySharePercent', 'ReferralSharePercent', 'AgentShareAmount', 'CompanyShareAmount', 'ReferralShareAmount', 'GSTRate', 'GSTAmount', 'TDSRate', 'TDSAmount', 'OtherDeductions', 'DeductionsTotal', 'NetPayable', 'ReceivedAmount', 'PendingAmount', 'Status', 'DueDate', 'ReceivedDate', 'PaymentReference', 'Notes', 'CreatedAt', 'UpdatedAt'],
    CommissionLedger: ['LedgerID', 'CommissionID', 'DealID', 'TokenID', 'NegotiationID', 'TransactionID', 'LeadID', 'PropertyID', 'EntryType', 'EntryDate', 'EntryValue', 'Status', 'PaymentID', 'Notes', 'Payload'],
    Closings: ['ClosingID', 'DealID', 'TokenID', 'NegotiationID', 'TransactionID', 'LeadID', 'RequirementID', 'PropertyID', 'Status', 'Checklist', 'StartedAt', 'CompletedAt', 'ClosedAt', 'Notes', 'CreatedBy', 'UpdatedBy', 'CreatedAt', 'UpdatedAt'],
    ClosingHistory: ['ClosingHistoryID', 'ClosingID', 'DealID', 'LeadID', 'EventType', 'EventDate', 'Actor', 'Notes', 'Payload'],
    Documents: ['DocumentID', 'LeadID', 'EntityType', 'EntityID', 'DocumentType', 'StorageURL', 'Status'],
    Reports: ['ReportID', 'ReportName', 'Category', 'Schedule', 'Status'],
    Permissions: ['PermissionID', 'Role', 'Module', 'Action', 'Scope'],
    Audit: ['AuditID', 'Timestamp', 'UserID', 'UserName', 'Action', 'Module', 'EntityType', 'EntityID', 'Before', 'After', 'IP', 'Device', 'Result'],
    Settings: ['SettingsID', 'Key', 'Value', 'Version', 'UpdatedAt'],
    Masters: ['MasterID', 'MasterType', 'Value', 'Label', 'Active', 'UsedCount', 'Metadata', 'CreatedAt', 'UpdatedAt'],
    PipelineConfig: ['PipelineConfigID', 'Module', 'Stages', 'Transitions', 'Version', 'Active', 'CreatedAt', 'UpdatedAt'],
    Notifications: ['NotificationID', 'Event', 'Channels', 'Enabled', 'Template', 'UpdatedAt'],
    Backups: ['BackupID', 'CreatedAt', 'CreatedBy', 'Size', 'Status', 'Checksum', 'Label'],
    ConfigurationHistory: ['ConfigurationHistoryID', 'Scope', 'ScopeID', 'Version', 'Before', 'After', 'CreatedAt'],
    FormConfig: ['FormConfigID', 'FormType', 'Version', 'FormRegistryID', 'Active', 'Fields', 'UpdatedAt'],
    FormRegistry: ['FormRegistryID', 'FormType', 'FormName', 'EntityType', 'Category', 'MetadataVersion', 'Active', 'Fields', 'UpdatedAt'],
    Sessions: ['SessionID', 'UserID', 'Role', 'CompanyID', 'BrokerageID', 'Permissions', 'PrincipalType', 'IssuedAt', 'ExpiresAt']
  },
  transactionTypes: ['Sale', 'Purchase', 'Rent', 'Rent Out', 'Lease', 'Lease Out'],
  transactionLifecycle: ['Draft', 'Matching', 'Shortlisted', 'Site Visit', 'Negotiation', 'Token', 'Agreement', 'Registration', 'Completed', 'Cancelled'],
  requirementStatuses: ['Active', 'Matched', 'On Hold', 'Closed', 'Cancelled'],
  leadStatuses: ['New', 'Verified', 'Active', 'Inactive', 'Blacklisted'],
  propertyLifecycle: ['Draft', 'Available', 'Shortlisted', 'Site Visit', 'Negotiation', 'Token', 'Booked', 'Sold', 'Withdrawn', 'Expired', 'Inactive'],
  brokerSubmissionStatuses: ['Draft', 'Submitted', 'Approved', 'Rejected'],
  brokerRejectReasons: ['Wrong Budget', 'Already Sold', 'Duplicate', 'Incomplete Information', 'Other']
};

const formRegistry = {
  residential: {
    formName: 'Residential Requirement Form',
    fields: {
      bhkMin: { FieldID: 'bhkMin', FieldLabel: 'BHK Min', QuestionLabel: 'Minimum BHK requirement', FieldType: 'Number', Section: 'Residential', Category: 'Residential', Required: true, ValidationRule: 'required-number', DisplayOrder: 1, Priority: 'P1', Active: true },
      bhkMax: { FieldID: 'bhkMax', FieldLabel: 'BHK Max', QuestionLabel: 'Maximum BHK requirement', FieldType: 'Number', Section: 'Residential', Category: 'Residential', Required: true, ValidationRule: 'required-number', DisplayOrder: 2, Priority: 'P1', Active: true },
      furnishing: { FieldID: 'furnishing', FieldLabel: 'Furnishing', QuestionLabel: 'Preferred furnishing', FieldType: 'Dropdown', Section: 'Residential', Category: 'Residential', Required: false, Options: ['Unfurnished', 'Semi furnished', 'Fully furnished'], ValidationRule: 'optional-dropdown', DisplayOrder: 3, Priority: 'P2', Active: true },
      parking: { FieldID: 'parking', FieldLabel: 'Parking', QuestionLabel: 'Parking requirement', FieldType: 'Checkbox', Section: 'Residential', Category: 'Residential', Required: false, Options: ['2 Wheeler', 'Car'], ValidationRule: 'optional-checkbox', DisplayOrder: 4, Priority: 'P2', Active: true },
      facing: { FieldID: 'facing', FieldLabel: 'Facing', QuestionLabel: 'Preferred facing', FieldType: 'Dropdown', Section: 'Residential', Category: 'Residential', Required: false, Options: ['East', 'West', 'North', 'South'], ValidationRule: 'optional-dropdown', DisplayOrder: 5, Priority: 'P3', Active: true }
    }
  },
  commercial: {
    formName: 'Commercial Requirement Form',
    fields: {
      areaMin: { FieldID: 'areaMin', FieldLabel: 'Area Min', QuestionLabel: 'Minimum area', FieldType: 'Area', Section: 'Commercial', Category: 'Commercial', Required: true, ValidationRule: 'required-area', DisplayOrder: 1, Priority: 'P1', Active: true },
      areaMax: { FieldID: 'areaMax', FieldLabel: 'Area Max', QuestionLabel: 'Maximum area', FieldType: 'Area', Section: 'Commercial', Category: 'Commercial', Required: true, ValidationRule: 'required-area', DisplayOrder: 2, Priority: 'P1', Active: true },
      businessType: { FieldID: 'businessType', FieldLabel: 'Business Type', QuestionLabel: 'Type of business', FieldType: 'Dropdown', Section: 'Commercial', Category: 'Commercial', Required: true, Options: ['Retail', 'Office', 'Hospitality'], ValidationRule: 'required-dropdown', DisplayOrder: 3, Priority: 'P1', Active: true },
      powerLoad: { FieldID: 'powerLoad', FieldLabel: 'Power Load', QuestionLabel: 'Power load required', FieldType: 'Number', Section: 'Commercial', Category: 'Commercial', Required: false, ValidationRule: 'optional-number', DisplayOrder: 4, Priority: 'P2', Active: true },
      fireNoc: { FieldID: 'fireNoc', FieldLabel: 'Fire NOC', QuestionLabel: 'Fire NOC requirement', FieldType: 'Checkbox', Section: 'Commercial', Category: 'Commercial', Required: false, ValidationRule: 'optional-checkbox', DisplayOrder: 5, Priority: 'P2', Active: true },
      frontageWidth: { FieldID: 'frontageWidth', FieldLabel: 'Frontage Width', QuestionLabel: 'Required frontage width', FieldType: 'Number', Section: 'Commercial', Category: 'Commercial', Required: false, ValidationRule: 'optional-number', DisplayOrder: 6, Priority: 'P3', Active: true }
    }
  },
  land: {
    formName: 'Land Requirement Form',
    fields: {
      plotMin: { FieldID: 'plotMin', FieldLabel: 'Plot Area Min', QuestionLabel: 'Minimum plot area', FieldType: 'Area', Section: 'Land', Category: 'Land', Required: true, ValidationRule: 'required-area', DisplayOrder: 1, Priority: 'P1', Active: true },
      plotMax: { FieldID: 'plotMax', FieldLabel: 'Plot Area Max', QuestionLabel: 'Maximum plot area', FieldType: 'Area', Section: 'Land', Category: 'Land', Required: true, ValidationRule: 'required-area', DisplayOrder: 2, Priority: 'P1', Active: true },
      zoning: { FieldID: 'zoning', FieldLabel: 'Zoning', QuestionLabel: 'Zoning requirement', FieldType: 'Dropdown', Section: 'Land', Category: 'Land', Required: true, Options: ['Residential', 'Commercial', 'Mixed Use'], ValidationRule: 'required-dropdown', DisplayOrder: 3, Priority: 'P1', Active: true },
      approachRoad: { FieldID: 'approachRoad', FieldLabel: 'Approach Road', QuestionLabel: 'Approach road width requirement', FieldType: 'Number', Section: 'Land', Category: 'Land', Required: false, ValidationRule: 'optional-number', DisplayOrder: 4, Priority: 'P2', Active: true },
      waterLine: { FieldID: 'waterLine', FieldLabel: 'Water Line', QuestionLabel: 'Water line connectivity available', FieldType: 'Checkbox', Section: 'Land', Category: 'Land', Required: false, ValidationRule: 'optional-checkbox', DisplayOrder: 5, Priority: 'P3', Active: true }
    }
  },
  industrial: {
    formName: 'Industrial Requirement Form',
    fields: {
      areaMin: { FieldID: 'areaMin', FieldLabel: 'Area Min', QuestionLabel: 'Minimum area', FieldType: 'Area', Section: 'Industrial', Category: 'Industrial', Required: true, ValidationRule: 'required-area', DisplayOrder: 1, Priority: 'P1', Active: true },
      areaMax: { FieldID: 'areaMax', FieldLabel: 'Area Max', QuestionLabel: 'Maximum area', FieldType: 'Area', Section: 'Industrial', Category: 'Industrial', Required: true, ValidationRule: 'required-area', DisplayOrder: 2, Priority: 'P1', Active: true },
      zoneType: { FieldID: 'zoneType', FieldLabel: 'Zone Type', QuestionLabel: 'Industrial zone profile', FieldType: 'Dropdown', Section: 'Industrial', Category: 'Industrial', Required: true, Options: ['Warehouse', 'Manufacturing', 'Logistics'], ValidationRule: 'required-dropdown', DisplayOrder: 3, Priority: 'P1', Active: true },
      powerLoad: { FieldID: 'powerLoad', FieldLabel: 'Power Load', QuestionLabel: 'Power load requirement', FieldType: 'Number', Section: 'Industrial', Category: 'Industrial', Required: true, ValidationRule: 'required-number', DisplayOrder: 4, Priority: 'P1', Active: true },
      loadingBay: { FieldID: 'loadingBay', FieldLabel: 'Loading Bay', QuestionLabel: 'Loading bay required', FieldType: 'Checkbox', Section: 'Industrial', Category: 'Industrial', Required: false, ValidationRule: 'optional-checkbox', DisplayOrder: 5, Priority: 'P2', Active: true }
    }
  }
};

module.exports = {
  modelSchema,
  formRegistry
};
