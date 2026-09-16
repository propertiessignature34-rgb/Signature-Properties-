'use strict';

const objectStorage = require('./objectStorageService');

const DEFAULT_PROFILE = {
  Name: 'Vikash Bhatter',
  Designation: 'Founder & Broker',
  Agency: 'Signature Properties',
  Mobile: '+91 90000 00001',
  Email: 'admin@sig.realty',
  PhotoUrl: null,
  LogoUrl: '/assets/signature-mark.svg'
};

class BrokerProfileService {
  constructor(repo) {
    this.repo = repo;
  }

  _get(db) {
    if (!db.BrokerProfile) db.BrokerProfile = { ...DEFAULT_PROFILE };
    return db.BrokerProfile;
  }

  getProfile() {
    const db = this.repo.read();
    return { ok: true, data: this._get(db) };
  }

  updateProfile(payload = {}) {
    const db = this.repo.read();
    const profile = this._get(db);
    ['Name', 'Designation', 'Agency', 'Mobile', 'Email'].forEach((key) => {
      if (payload[key] !== undefined && String(payload[key]).trim()) profile[key] = String(payload[key]).trim();
    });
    profile.UpdatedAt = new Date().toISOString();
    this.repo.write(db);
    return { ok: true, data: profile };
  }

  async updatePhoto(fileBase64) {
    if (!fileBase64) return { ok: false, error: 'fileBase64 required' };
    let buffer;
    try { buffer = Buffer.from(String(fileBase64).replace(/^data:[^;]+;base64,/, ''), 'base64'); }
    catch (e) { return { ok: false, error: 'Bad base64 payload' }; }
    let result;
    try { result = await objectStorage.putObject(`broker-profile/photo-${Date.now()}.jpg`, buffer, 'image/jpeg'); }
    catch (e) { return { ok: false, error: `Upload failed: ${e.message}` }; }
    const db = this.repo.read();
    const profile = this._get(db);
    profile.PhotoStoragePath = result.path;
    profile.PhotoUrl = '/api/v2/broker-profile/photo';
    profile.UpdatedAt = new Date().toISOString();
    this.repo.write(db);
    return { ok: true, data: profile };
  }

  async getPhotoFile() {
    const db = this.repo.read();
    const profile = this._get(db);
    if (!profile.PhotoStoragePath) return { ok: false, error: 'No photo set' };
    try {
      const { buffer, contentType } = await objectStorage.getObject(profile.PhotoStoragePath);
      return { ok: true, buffer, contentType };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
}

module.exports = { BrokerProfileService };
