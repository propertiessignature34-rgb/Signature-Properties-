/**
 * PHASE 10 — Static Dependency Configuration
 */

'use strict';

const DEPENDENCY_CONFIG_VERSION = '2.0';

const STATE = {
  RELEVANT: 'RELEVANT',
  NOT_RELEVANT: 'NOT_RELEVANT',
  HIDDEN: 'HIDDEN',
  VISIBLE: 'VISIBLE'
};

const OP = {
  EQUALS: 'EQUALS',
  NOT_EQUALS: 'NOT_EQUALS',
  IN: 'IN',
  NOT_IN: 'NOT_IN',
  EXISTS: 'EXISTS',
  NOT_EXISTS: 'NOT_EXISTS',
  GREATER_THAN: 'GREATER_THAN',
  GREATER_THAN_OR_EQUAL: 'GREATER_THAN_OR_EQUAL',
  LESS_THAN: 'LESS_THAN',
  LESS_THAN_OR_EQUAL: 'LESS_THAN_OR_EQUAL',
  CONTAINS: 'CONTAINS',
  NOT_CONTAINS: 'NOT_CONTAINS'
};

let _idx = 1;
function rule(opts) {
  const id = `DEP-${String(_idx++).padStart(3, '0')}`;
  return {
    DependencyID: id,
    FormKey: opts.formKey || null,
    TransactionType: opts.transactionType !== undefined ? opts.transactionType : null,
    Category: opts.category !== undefined ? opts.category : null,
    SubCategory: opts.subCategory !== undefined ? opts.subCategory : null,
    SourceField: opts.sourceField !== undefined ? opts.sourceField : null,
    Operator: opts.operator !== undefined ? opts.operator : null,
    ExpectedValue: opts.expectedValue !== undefined ? opts.expectedValue : null,
    TargetField: opts.targetField,
    ResultState: opts.resultState,
    Priority: opts.priority !== undefined ? opts.priority : 50,
    IsActive: opts.isActive !== false,
    Version: DEPENDENCY_CONFIG_VERSION,
    CreatedAt: '2026-01-01T00:00:00.000Z',
    UpdatedAt: '2026-01-01T00:00:00.000Z',
    _v2: true
  };
}

function conditionalCountRules(scope, sourceField, targetField, priority) {
  return [
    rule({ ...scope, sourceField, operator: OP.NOT_EXISTS, targetField, resultState: STATE.HIDDEN, priority }),
    rule({ ...scope, sourceField, operator: OP.EQUALS, expectedValue: true, targetField, resultState: STATE.RELEVANT, priority }),
    rule({ ...scope, sourceField, operator: OP.EQUALS, expectedValue: false, targetField, resultState: STATE.NOT_RELEVANT, priority })
  ];
}

const STATIC_DEPENDENCY_RULES = [
  // Transaction type
  rule({ transactionType: 'Rent', targetField: 'TenantType', resultState: STATE.RELEVANT, priority: 10 }),
  rule({ transactionType: 'Rent', targetField: 'Deposit', resultState: STATE.RELEVANT, priority: 10 }),
  rule({ transactionType: 'Rent', targetField: 'MaintenanceCharges', resultState: STATE.RELEVANT, priority: 10 }),
  rule({ transactionType: 'Rent', targetField: 'PetAllowed', resultState: STATE.RELEVANT, priority: 10 }),
  rule({ transactionType: 'Rent', targetField: 'MoveInDate', resultState: STATE.RELEVANT, priority: 10 }),
  rule({ transactionType: 'Rent', category: 'Residential', targetField: 'FoodPreference', resultState: STATE.RELEVANT, priority: 10 }),
  rule({ transactionType: 'Rent', category: 'Residential', targetField: 'PetsAllowed', resultState: STATE.RELEVANT, priority: 10 }),

  rule({ transactionType: 'Rent Out', targetField: 'TenantType', resultState: STATE.RELEVANT, priority: 10 }),
  rule({ transactionType: 'Rent Out', targetField: 'Deposit', resultState: STATE.RELEVANT, priority: 10 }),
  rule({ transactionType: 'Rent Out', targetField: 'MaintenanceCharges', resultState: STATE.RELEVANT, priority: 10 }),
  rule({ transactionType: 'Rent Out', targetField: 'PetAllowed', resultState: STATE.RELEVANT, priority: 10 }),
  rule({ transactionType: 'Rent Out', targetField: 'MoveInDate', resultState: STATE.RELEVANT, priority: 10 }),

  rule({ transactionType: 'Lease', targetField: 'LeaseDuration', resultState: STATE.RELEVANT, priority: 10 }),
  rule({ transactionType: 'Lease', targetField: 'SecurityDeposit', resultState: STATE.RELEVANT, priority: 10 }),
  rule({ transactionType: 'Lease', targetField: 'LockInPeriod', resultState: STATE.RELEVANT, priority: 10 }),
  rule({ transactionType: 'Lease', targetField: 'LeasePeriodMonths', resultState: STATE.RELEVANT, priority: 10 }),
  rule({ transactionType: 'Lease', targetField: 'EscalationPercent', resultState: STATE.RELEVANT, priority: 10 }),
  rule({ transactionType: 'Lease', targetField: 'GSTRequired', resultState: STATE.RELEVANT, priority: 10 }),
  rule({ transactionType: 'Lease', targetField: 'MaintenanceCharges', resultState: STATE.RELEVANT, priority: 10 }),
  rule({ transactionType: 'Lease', targetField: 'MoveInDate', resultState: STATE.RELEVANT, priority: 10 }),

  rule({ transactionType: 'Lease Out', targetField: 'LeaseDuration', resultState: STATE.RELEVANT, priority: 10 }),
  rule({ transactionType: 'Lease Out', targetField: 'SecurityDeposit', resultState: STATE.RELEVANT, priority: 10 }),
  rule({ transactionType: 'Lease Out', targetField: 'LockInPeriod', resultState: STATE.RELEVANT, priority: 10 }),
  rule({ transactionType: 'Lease Out', targetField: 'LeasePeriodMonths', resultState: STATE.RELEVANT, priority: 10 }),
  rule({ transactionType: 'Lease Out', targetField: 'EscalationPercent', resultState: STATE.RELEVANT, priority: 10 }),
  rule({ transactionType: 'Lease Out', targetField: 'GSTRequired', resultState: STATE.RELEVANT, priority: 10 }),

  rule({ transactionType: 'Purchase', targetField: 'PropertyPreference', resultState: STATE.RELEVANT, priority: 10 }),
  rule({ transactionType: 'Sale', targetField: 'PropertyPreference', resultState: STATE.RELEVANT, priority: 10 }),
  rule({ transactionType: 'Rent', targetField: 'PropertyPreference', resultState: STATE.NOT_RELEVANT, priority: 10 }),
  rule({ transactionType: 'Rent Out', targetField: 'PropertyPreference', resultState: STATE.NOT_RELEVANT, priority: 10 }),
  rule({ transactionType: 'Lease', targetField: 'PropertyPreference', resultState: STATE.NOT_RELEVANT, priority: 10 }),
  rule({ transactionType: 'Lease Out', targetField: 'PropertyPreference', resultState: STATE.NOT_RELEVANT, priority: 10 }),

  rule({ transactionType: 'Purchase', targetField: 'TenantType', resultState: STATE.NOT_RELEVANT, priority: 10 }),
  rule({ transactionType: 'Purchase', targetField: 'Deposit', resultState: STATE.NOT_RELEVANT, priority: 10 }),
  rule({ transactionType: 'Purchase', targetField: 'MaintenanceCharges', resultState: STATE.NOT_RELEVANT, priority: 10 }),
  rule({ transactionType: 'Purchase', targetField: 'PetAllowed', resultState: STATE.NOT_RELEVANT, priority: 10 }),
  rule({ transactionType: 'Sale', targetField: 'TenantType', resultState: STATE.NOT_RELEVANT, priority: 10 }),
  rule({ transactionType: 'Sale', targetField: 'Deposit', resultState: STATE.NOT_RELEVANT, priority: 10 }),

  // Category level
  rule({ category: 'Residential', targetField: 'BHKMin', resultState: STATE.RELEVANT, priority: 20 }),
  rule({ category: 'Residential', targetField: 'BHKMax', resultState: STATE.RELEVANT, priority: 20 }),
  rule({ category: 'Residential', targetField: 'Furnishing', resultState: STATE.RELEVANT, priority: 20 }),
  rule({ category: 'Residential', targetField: 'CarpetAreaMin', resultState: STATE.RELEVANT, priority: 20 }),
  rule({ category: 'Residential', targetField: 'CarpetAreaMax', resultState: STATE.RELEVANT, priority: 20 }),
  rule({ category: 'Residential', targetField: 'BuiltUpAreaMin', resultState: STATE.RELEVANT, priority: 20 }),
  rule({ category: 'Residential', targetField: 'BuiltUpAreaMax', resultState: STATE.RELEVANT, priority: 20 }),
  rule({ category: 'Residential', targetField: 'ParkingRequired', resultState: STATE.RELEVANT, priority: 20 }),

  rule({ category: 'Commercial', targetField: 'BusinessType', resultState: STATE.RELEVANT, priority: 20 }),
  rule({ category: 'Commercial', targetField: 'RequiredAreaMin', resultState: STATE.RELEVANT, priority: 20 }),
  rule({ category: 'Commercial', targetField: 'RequiredAreaMax', resultState: STATE.RELEVANT, priority: 20 }),
  rule({ category: 'Commercial', targetField: 'AreaMin', resultState: STATE.RELEVANT, priority: 20 }),
  rule({ category: 'Commercial', targetField: 'AreaMax', resultState: STATE.RELEVANT, priority: 20 }),
  rule({ category: 'Commercial', targetField: 'BHKMin', resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Commercial', targetField: 'BHKMax', resultState: STATE.NOT_RELEVANT, priority: 20 }),

  rule({ category: 'Industrial', targetField: 'BuiltUpAreaMin', resultState: STATE.RELEVANT, priority: 20 }),
  rule({ category: 'Industrial', targetField: 'BuiltUpAreaMax', resultState: STATE.RELEVANT, priority: 20 }),
  rule({ category: 'Industrial', targetField: 'PowerLoadKVA', resultState: STATE.RELEVANT, priority: 20 }),
  rule({ category: 'Industrial', targetField: 'RoadWidthFeet', resultState: STATE.RELEVANT, priority: 20 }),
  rule({ category: 'Industrial', targetField: 'BHKMin', resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Industrial', targetField: 'BHKMax', resultState: STATE.NOT_RELEVANT, priority: 20 }),

  rule({ category: 'Land', targetField: 'LandType', resultState: STATE.RELEVANT, priority: 20 }),
  rule({ category: 'Land', targetField: 'PlotAreaMin', resultState: STATE.RELEVANT, priority: 20 }),
  rule({ category: 'Land', targetField: 'PlotAreaMax', resultState: STATE.RELEVANT, priority: 20 }),
  rule({ category: 'Land', targetField: 'AreaUnit', resultState: STATE.RELEVANT, priority: 20 }),
  rule({ category: 'Land', targetField: 'TitleClear', resultState: STATE.RELEVANT, priority: 20 }),
  rule({ category: 'Land', targetField: 'BHKMin', resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Land', targetField: 'BHKMax', resultState: STATE.NOT_RELEVANT, priority: 20 }),

  rule({ category: 'Agriculture', targetField: 'BHKMin', resultState: STATE.NOT_RELEVANT, priority: 20 }),
  rule({ category: 'Agriculture', targetField: 'BHKMax', resultState: STATE.NOT_RELEVANT, priority: 20 }),

  // Sub-category defaults
  rule({ category: 'Commercial', subCategory: 'Office', targetField: 'SeatingRequired', resultState: STATE.RELEVANT, priority: 30 }),
  rule({ category: 'Commercial', subCategory: 'Office', targetField: 'CabinsRequired', resultState: STATE.RELEVANT, priority: 30 }),
  rule({ category: 'Commercial', subCategory: 'Office', targetField: 'ConferenceRoomRequired', resultState: STATE.RELEVANT, priority: 30 }),
  rule({ category: 'Commercial', subCategory: 'Office', targetField: 'ReceptionRequired', resultState: STATE.RELEVANT, priority: 30 }),
  rule({ category: 'Commercial', subCategory: 'Office', targetField: 'PowerBackupRequired', resultState: STATE.RELEVANT, priority: 30 }),
  rule({ category: 'Commercial', subCategory: 'Office', targetField: 'InternetFiberRequired', resultState: STATE.RELEVANT, priority: 30 }),

  rule({ category: 'Commercial', subCategory: 'Shop', targetField: 'FrontageFeet', resultState: STATE.RELEVANT, priority: 30 }),
  rule({ category: 'Commercial', subCategory: 'Shop', targetField: 'GroundFloorRequired', resultState: STATE.RELEVANT, priority: 30 }),
  rule({ category: 'Commercial', subCategory: 'Shop', targetField: 'DisplayWindowRequired', resultState: STATE.RELEVANT, priority: 30 }),
  rule({ category: 'Commercial', subCategory: 'Shop', targetField: 'FootfallPreference', resultState: STATE.RELEVANT, priority: 30 }),

  rule({ category: 'Commercial', subCategory: 'Warehouse', targetField: 'BuiltUpAreaMin', resultState: STATE.RELEVANT, priority: 30 }),
  rule({ category: 'Commercial', subCategory: 'Warehouse', targetField: 'BuiltUpAreaMax', resultState: STATE.RELEVANT, priority: 30 }),
  rule({ category: 'Commercial', subCategory: 'Warehouse', targetField: 'OpenAreaMin', resultState: STATE.RELEVANT, priority: 30 }),
  rule({ category: 'Commercial', subCategory: 'Warehouse', targetField: 'OpenAreaMax', resultState: STATE.RELEVANT, priority: 30 }),
  rule({ category: 'Commercial', subCategory: 'Warehouse', targetField: 'ClearHeightFeet', resultState: STATE.RELEVANT, priority: 30 }),
  rule({ category: 'Commercial', subCategory: 'Warehouse', targetField: 'LoadingDockRequired', resultState: STATE.RELEVANT, priority: 30 }),
  rule({ category: 'Commercial', subCategory: 'Warehouse', targetField: 'ContainerMovementRequired', resultState: STATE.RELEVANT, priority: 30 }),
  rule({ category: 'Commercial', subCategory: 'Warehouse', targetField: 'TruckAccessRequired', resultState: STATE.RELEVANT, priority: 30 }),

  rule({ category: 'Residential', subCategory: 'Flat', targetField: 'Bathrooms', resultState: STATE.RELEVANT, priority: 30 }),
  rule({ category: 'Residential', subCategory: 'Flat', targetField: 'Balcony', resultState: STATE.RELEVANT, priority: 30 }),
  rule({ category: 'Residential', subCategory: 'Flat', targetField: 'TotalFloors', resultState: STATE.RELEVANT, priority: 30 }),
  rule({ category: 'Residential', subCategory: 'Flat', targetField: 'SocietyProject', resultState: STATE.RELEVANT, priority: 30 }),
  rule({ category: 'Residential', subCategory: 'Villa', targetField: 'PlotAreaMin', resultState: STATE.RELEVANT, priority: 30 }),
  rule({ category: 'Residential', subCategory: 'Villa', targetField: 'PlotAreaMax', resultState: STATE.RELEVANT, priority: 30 }),
  rule({ category: 'Residential', subCategory: 'Villa', targetField: 'GardenRequired', resultState: STATE.RELEVANT, priority: 30 }),
  rule({ category: 'Residential', subCategory: 'Villa', targetField: 'ServantRoomRequired', resultState: STATE.RELEVANT, priority: 30 }),
  rule({ category: 'Residential', subCategory: 'Villa', targetField: 'TerraceRequired', resultState: STATE.RELEVANT, priority: 30 }),
  rule({ category: 'Residential', subCategory: 'Villa', targetField: 'PoolRequired', resultState: STATE.RELEVANT, priority: 30 }),

  // Existing value-driven rules kept
  rule({ category: 'Residential', sourceField: 'Parking', operator: OP.EXISTS, targetField: 'ParkingType', resultState: STATE.RELEVANT, priority: 40 }),
  rule({ category: 'Residential', sourceField: 'BHKMin', operator: OP.GREATER_THAN_OR_EQUAL, expectedValue: 3, targetField: 'SwimmingPool', resultState: STATE.RELEVANT, priority: 40 }),
  rule({ category: 'Residential', sourceField: 'BHKMin', operator: OP.GREATER_THAN_OR_EQUAL, expectedValue: 4, targetField: 'Gym', resultState: STATE.RELEVANT, priority: 40 }),
  rule({ transactionType: 'Rent', sourceField: 'TenantType', operator: OP.EQUALS, expectedValue: 'Company', targetField: 'GSTRequired', resultState: STATE.RELEVANT, priority: 40 }),
  rule({ transactionType: 'Rent Out', sourceField: 'TenantType', operator: OP.EQUALS, expectedValue: 'Company', targetField: 'GSTRequired', resultState: STATE.RELEVANT, priority: 40 }),
  rule({ category: 'Residential', sourceField: 'Furnishing', operator: OP.IN, expectedValue: ['Furnished', 'Fully Furnished', 'Semi Furnished', 'Semi-Furnished'], targetField: 'Appliances', resultState: STATE.RELEVANT, priority: 40 }),
  rule({ category: 'Residential', sourceField: 'Furnishing', operator: OP.EQUALS, expectedValue: 'Unfurnished', targetField: 'Appliances', resultState: STATE.NOT_RELEVANT, priority: 40 }),
  rule({ category: 'Commercial', sourceField: 'BusinessType', operator: OP.NOT_IN, expectedValue: ['Retail', 'Showroom'], targetField: 'FrontageWidth', resultState: STATE.NOT_RELEVANT, priority: 40 }),
  rule({ sourceField: 'BudgetMax', operator: OP.NOT_EXISTS, targetField: 'BudgetFlexibility', resultState: STATE.RELEVANT, priority: 40 }),
  rule({ sourceField: 'BudgetMax', operator: OP.EXISTS, targetField: 'BudgetFlexibility', resultState: STATE.HIDDEN, priority: 40 }),

  // Progressive child-question rules
  ...conditionalCountRules({ category: 'Residential' }, 'ParkingRequired', 'ParkingCount', 45),
  ...conditionalCountRules({ category: 'Commercial' }, 'ParkingRequired', 'ParkingCarCount', 45),
  ...conditionalCountRules({ category: 'Commercial' }, 'ParkingRequired', 'ParkingBikeCount', 45),
  ...conditionalCountRules({ category: 'Commercial' }, 'WashroomRequired', 'WashroomCount', 45),
  ...conditionalCountRules({ category: 'Commercial', subCategory: 'Office' }, 'SeatingRequired', 'SeatingCapacity', 45),
  ...conditionalCountRules({ category: 'Commercial', subCategory: 'Office' }, 'CabinsRequired', 'CabinCount', 45),
  ...conditionalCountRules({ category: 'Commercial', subCategory: 'Office' }, 'ConferenceRoomRequired', 'ConferenceRoomCount', 45),
  ...conditionalCountRules({ category: 'Commercial', subCategory: 'Office' }, 'MeetingRoomRequired', 'MeetingRoomCount', 45),

  // Plot area only becomes important for villa/land/industrial plot style needs
  rule({ category: 'Residential', subCategory: 'Flat', targetField: 'PlotAreaMin', resultState: STATE.NOT_RELEVANT, priority: 46 }),
  rule({ category: 'Residential', subCategory: 'Flat', targetField: 'PlotAreaMax', resultState: STATE.NOT_RELEVANT, priority: 46 }),
  rule({ category: 'Commercial', subCategory: 'Office', targetField: 'FrontageFeet', resultState: STATE.NOT_RELEVANT, priority: 46 }),
  rule({ category: 'Commercial', subCategory: 'Office', targetField: 'GroundFloorRequired', resultState: STATE.NOT_RELEVANT, priority: 46 }),
  rule({ category: 'Commercial', subCategory: 'Office', targetField: 'DisplayWindowRequired', resultState: STATE.NOT_RELEVANT, priority: 46 })
];

module.exports = {
  STATIC_DEPENDENCY_RULES,
  DEPENDENCY_CONFIG_VERSION,
  STATE,
  OP
};
