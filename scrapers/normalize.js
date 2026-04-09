'use strict';

// Normalized incident type categories.
// Each entry: { type: 'NormalizedName', keywords: [...lowercase substrings] }
// First match wins, so order from specific → general.
const CATEGORIES = [
  {
    type: 'Brandmeldeanlage',
    keywords: ['bma', 'brandmeldeanlage', 'rauchmelder', 'täuschungsalarm', 'täuschung', 'fehlalarm bma', 'automatische'],
  },
  {
    type: 'Brand',
    keywords: ['brand', 'explosion', 'verpuffung', 'kamin', 'esse'],
  },
  {
    type: 'Technische Hilfe',
    keywords: ['techn', 'thl', 'hilfeleis', 'unfall', 'verkehr', 'bergung', 'fahrzeug', 'klemmt', 'eingeklemmt', 'absicherung', 'absturzsichers', 'sturzsicher'],
  },
  {
    type: 'Öl / Chemie',
    keywords: ['öl', 'oel', 'chemie', 'gefahrgut', 'treibstoff', 'benzin', 'diesel', 'gas', 'gasaustritt', 'ammoniak'],
  },
  {
    type: 'Rettung',
    keywords: ['rettung', 'person', 'tier', 'katze', 'hund', 'vermisst', 'suche'],
  },
  {
    type: 'Wasserschaden / Elementar',
    keywords: ['wasser', 'hochwasser', 'überschwemmung', 'elementar', 'sturm', 'wind', 'schnee', 'eis', 'übermurung', 'murgang', 'keller'],
  },
  {
    type: 'Falschalarm',
    keywords: ['falschalarm', 'böswillig', 'mutwillig', 'absichtlich'],
  },
  {
    type: 'First Responder',
    keywords: ['first responder', 'firstresponder', 'first-responder', 'traghilfe', 'partnerorganisation'],
  },
  {
    type: 'Stützpunkt',
    keywords: ['Stützpunkt', 'Hubretter', 'Strassenrettung'],
  },
  {
    type: '144',
    keywords: ['144', 'Patientenrettung'],
  },
];

/**
 * Normalize a raw incident type string to a standard category.
 * @param {string} raw - The raw type string from any department.
 * @returns {string} Normalized category name.
 */
function normalizeType(raw) {
  if (!raw) return 'Sonstiges';
  const lower = raw.toLowerCase();
  for (const cat of CATEGORIES) {
    if (cat.keywords.some(kw => lower.includes(kw))) {
      return cat.type;
    }
  }
  return 'Sonstiges';
}

module.exports = { normalizeType, CATEGORIES };
