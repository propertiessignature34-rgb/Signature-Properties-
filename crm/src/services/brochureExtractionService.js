'use strict';

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_BYTES = 15 * 1024 * 1024;

const EXTRACTION_PROMPT = `You are extracting structured data from a real-estate builder project brochure PDF for a Surat, Gujarat brokerage.
Read the document carefully and return STRICT JSON ONLY (no markdown fences, no explanation, no extra text) with exactly this shape:
{
  "ProjectName": string or null,
  "BuilderName": string or null,
  "Location1": string or null,
  "Address": string or null,
  "RERANumber": string or null,
  "Category": one of "Residential", "Commercial", "Industrial", "Land", or null,
  "ProjectStatus": one of "New Launch", "Under Construction", "Ready to Move", "Completed", or null,
  "TotalUnits": number or null,
  "PriceMin": number or null,
  "PriceMax": number or null,
  "PossessionDate": string in YYYY-MM-DD format or null,
  "Amenities": array of strings,
  "ConfigDetails": array of objects like {"Type": "2 BHK", "AreaSqft": number}, one entry per distinct unit configuration/size mentioned in the brochure
}
Prices must be plain numbers in INR (no commas, no "Cr"/"L" suffix; convert e.g. 1.2 Cr to 12000000). If a field is genuinely not present, use null (or an empty array for list fields). Do not invent or guess data that is not in the document.`;

function parseModelJson(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error('Could not parse AI response as JSON');
  }
}

async function extractBrochure(fileBase64) {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured on the server');

  const encoded = String(fileBase64 || '').replace(/^data:[^;]+;base64,/, '');
  let buffer;
  try {
    buffer = Buffer.from(encoded, 'base64');
  } catch (_) {
    throw new Error('Bad base64 payload');
  }
  if (!buffer.length) throw new Error('Empty file');
  if (buffer.length > MAX_BYTES) throw new Error('PDF too large (max 15 MB)');

  const response = await fetch(`${GEMINI_API_URL}/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: EXTRACTION_PROMPT },
          { inline_data: { mime_type: 'application/pdf', data: buffer.toString('base64') } }
        ]
      }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 }
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Gemini request failed (${response.status})`);
  }
  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
  if (!text) throw new Error('Gemini returned no extraction result');
  return parseModelJson(text);
}

module.exports = { extractBrochure };
