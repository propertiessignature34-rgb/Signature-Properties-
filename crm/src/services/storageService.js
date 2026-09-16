class StorageProvider {
  async upload() {
    throw new Error('StorageProvider.upload() must be implemented');
  }

  async get() {
    throw new Error('StorageProvider.get() must be implemented');
  }

  async exists() {
    throw new Error('StorageProvider.exists() must be implemented');
  }

  async delete() {
    throw new Error('StorageProvider.delete() must be implemented');
  }

  async getPublicUrl() {
    throw new Error('StorageProvider.getPublicUrl() must be implemented');
  }
}

class TestStorageProvider extends StorageProvider {
  constructor() {
    super();
    this.items = new Map();
  }

  async upload(key, value, metadata = {}) {
    const item = {
      key,
      value,
      metadata,
      createdAt: new Date().toISOString()
    };
    this.items.set(key, item);
    return { ok: true, data: item };
  }

  async get(key) {
    const item = this.items.get(key);
    if (!item) return { ok: false, error: 'Storage item not found' };
    return { ok: true, data: item };
  }

  async exists(key) {
    return { ok: true, data: this.items.has(key) };
  }

  async delete(key) {
    const hadItem = this.items.has(key);
    this.items.delete(key);
    return { ok: true, data: hadItem };
  }

  async getPublicUrl(key) {
    return { ok: true, data: `/storage/${encodeURIComponent(key)}` };
  }
}

module.exports = {
  StorageProvider,
  TestStorageProvider
};
