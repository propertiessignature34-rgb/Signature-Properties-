const { formRegistry } = require('../data/schema');

class DynamicFormEngine {
  constructor(registry = formRegistry) {
    this.registry = registry;
  }

  resolveRegistry() {
    if (typeof this.registry === 'function') {
      return this.registry() || {};
    }
    return this.registry || {};
  }

  normalizeFormType(formType) {
    if (!formType) return 'residential';
    return String(formType).toLowerCase();
  }

  getFormConfig(formType) {
    const key = this.normalizeFormType(formType);
    const registry = this.resolveRegistry();
    const config = registry[key];
    if (!config) {
      throw new Error(`Form config not found: ${formType}`);
    }
    return config;
  }

  getRegistrationFields(formType) {
    return this.getFormConfig(formType).fields;
  }

  getField(fieldId, formType) {
    const config = this.getFormConfig(formType);
    return config.fields[fieldId] || null;
  }

  validate(formType, payload) {
    const config = this.getFormConfig(formType);
    const errors = [];

    for (const [fieldId, field] of Object.entries(config.fields)) {
      if (field.Active === false || field.active === false) {
        continue;
      }
      const value = payload[fieldId] ?? payload[field.FieldID];

      if (field.Required && Object.prototype.hasOwnProperty.call(payload, fieldId) && (value === undefined || value === null || value === '')) {
        errors.push(`${field.FieldLabel} is required`);
      }

      if (field.ValidationRule) {
        if (field.ValidationRule === 'required-mobile' && value !== undefined && value !== null && value !== '' && !this.isValidMobile(value)) {
          errors.push(`${field.FieldLabel} must be a valid mobile number`);
        }
        if (field.ValidationRule === 'required-email' && value !== undefined && value !== null && value !== '' && !this.isValidEmail(value)) {
          errors.push(`${field.FieldLabel} must be a valid email address`);
        }
        if (field.ValidationRule === 'required-number' && value !== undefined && value !== null && value !== '' && Number.isNaN(Number(value))) {
          errors.push(`${field.FieldLabel} must be numeric`);
        }
        if (field.ValidationRule === 'required-currency' && value !== undefined && value !== null && value !== '' && Number.isNaN(Number(value))) {
          errors.push(`${field.FieldLabel} must be numeric`);
        }
      }
    }

    if (payload.budgetMin !== undefined && payload.budgetMax !== undefined && Number(payload.budgetMin) > Number(payload.budgetMax)) {
      errors.push('BudgetMin must be less than or equal to BudgetMax');
    }

    if (payload.areaMin !== undefined && payload.areaMax !== undefined && Number(payload.areaMin) > Number(payload.areaMax)) {
      errors.push('AreaMin must be less than or equal to AreaMax');
    }

    return errors;
  }

  isValidMobile(value) {
    return /^[+]?\d{10,15}$/.test(String(value).replace(/\s/g, ''));
  }

  isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value));
  }
}

module.exports = { DynamicFormEngine };
