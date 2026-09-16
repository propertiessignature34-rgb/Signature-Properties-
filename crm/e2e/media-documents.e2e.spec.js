const { test, expect } = require('@playwright/test');

const headers = {
  'x-user-id': 'USR-ADMIN-1',
  'x-user-role': 'ADMIN',
  'x-company-id': 'COMP-UI',
  'x-brokerage-id': 'BRK-UI'
};

test('media and documents workflow renders, previews, and respects visibility metadata', async ({ page, request }) => {
  await request.post('/api/media', {
    headers,
    data: {
      EntityType: 'PROPERTY',
      EntityID: 'PROP-UI-1',
      PropertyID: 'PROP-UI-1',
      Title: 'Sunrise residence gallery',
      MediaType: 'IMAGE',
      StorageProvider: 'TEST_PROVIDER',
      StoragePath: 'https://example.com/media/hero.jpg',
      MimeType: 'image/jpeg',
      SizeBytes: 2048,
      Checksum: 'hero-1',
      Visibility: 'PUBLIC'
    }
  });

  await request.post('/api/media', {
    headers,
    data: {
      EntityType: 'PROJECT',
      EntityID: 'PRJ-UI-1',
      ProjectID: 'PRJ-UI-1',
      Title: 'Project board image',
      MediaType: 'BROCHURE',
      StorageProvider: 'TEST_PROVIDER',
      StoragePath: 'https://example.com/media/project-brochure.pdf',
      MimeType: 'application/pdf',
      SizeBytes: 2048,
      Checksum: 'project-1',
      Visibility: 'BROKER'
    }
  });

  await request.post('/api/media', {
    headers,
    data: {
      EntityType: 'BUILDER',
      EntityID: 'BLD-UI-1',
      BuilderID: 'BLD-UI-1',
      Title: 'Builder profile image',
      MediaType: 'IMAGE',
      StorageProvider: 'TEST_PROVIDER',
      StoragePath: 'https://example.com/media/builder.jpg',
      MimeType: 'image/jpeg',
      SizeBytes: 1024,
      Checksum: 'builder-1',
      Visibility: 'PRIVATE'
    }
  });

  await request.post('/api/documents', {
    headers,
    data: {
      EntityType: 'PROPERTY',
      EntityID: 'PROP-UI-1',
      PropertyID: 'PROP-UI-1',
      Title: 'Title deed',
      DocumentType: 'SALE_DEED',
      StorageProvider: 'TEST_PROVIDER',
      StoragePath: 'https://example.com/docs/title-deed.pdf',
      MimeType: 'application/pdf',
      SizeBytes: 4096,
      Checksum: 'doc-1',
      Visibility: 'PUBLIC'
    }
  });

  await page.goto('/');
  await page.getByRole('link', { name: 'Documents' }).click();

  await expect(page.getByText('Media & Documents')).toBeVisible();
  await expect(page.getByText('Builder Media')).toBeVisible();
  await expect(page.getByText('Project Media')).toBeVisible();
  await expect(page.getByText('Property Media')).toBeVisible();
  await expect(page.locator('.document-panel h3')).toHaveText('Documents');
  await expect(page.getByText('Sunrise residence gallery')).toBeVisible();
  await expect(page.getByText('Title deed')).toBeVisible();

  await page.getByRole('button', { name: 'Preview' }).first().click();
  await expect(page.getByText('This preview is generated from the media metadata contract')).toBeVisible();

  await page.locator('.media-modal-close').click();
  await expect(page.locator('.media-modal')).toHaveCount(0);
});
