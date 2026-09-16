#!/usr/bin/env python3
"""Extracts structured builder-project fields from a brochure PDF using Gemini
(via emergentintegrations). Prints strict JSON to stdout. Invoked by Node.js
(brochureExtractionService.js) with a temp file path as argv[1]."""

import sys
import os
import json
import asyncio

from emergentintegrations.llm.chat import LlmChat, UserMessage, FileContentWithMimeType

EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY')

EXTRACTION_PROMPT = """You are extracting structured data from a real-estate builder project brochure PDF for a Surat, Gujarat brokerage.
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
Prices must be plain numbers in INR (no commas, no "Cr"/"L" suffix - convert e.g. 1.2 Cr to 12000000). If a field is genuinely not present in the document, use null (or an empty array for list fields). Do not invent or guess data that isn't in the document."""


async def main():
    file_path = sys.argv[1]
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"builder-project-brochure-extract-{os.path.basename(file_path)}",
        system_message="You extract structured real estate data from brochures and always reply with strict JSON only, matching the requested shape exactly."
    ).with_model("gemini", "gemini-3.1-pro-preview")

    pdf_file = FileContentWithMimeType(file_path=file_path, mime_type="application/pdf")
    response_text = await chat.send_message(UserMessage(text=EXTRACTION_PROMPT, file_contents=[pdf_file]))
    print(response_text)


if __name__ == "__main__":
    asyncio.run(main())
