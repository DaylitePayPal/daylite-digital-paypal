'use strict';

/**
 * Daylite Digital — DEMONSTRATION catalogue.
 *
 * Every entry below is demonstration data. These are not live listings, there is
 * no inventory connection, and prices are illustrative USD amounts used only to
 * exercise the AI -> PayPal Sandbox workflow. Namibian and international
 * destinations are mixed deliberately to show that one architecture can represent both;
 * none of them is live inventory.
 *
 * The server is the single source of truth for id, name, description, location,
 * price and currency. Neither the browser nor the AI model can change them.
 * Prices are stored as integer cents to avoid floating-point money errors.
 */

const CURRENCY = 'USD';
const MIN_TRAVELLERS = 1;
const MAX_TRAVELLERS = 10;

const CATALOG = Object.freeze([
  {
    id: 'osaka-culture-food',
    name: 'Osaka Culture & Street Food Day',
    location: 'Osaka, Japan',
    description:
      'A guided day through Osaka: a historic temple district in the morning, a tea-house tasting, and an evening street-food walk through Dotonbori.',
    themes: ['culture', 'food', 'city', 'history'],
    durationDays: 1,
    priceCents: 18900,
  },
  {
    id: 'new-york-city-icons',
    name: 'New York City Icons & Neighbourhoods',
    location: 'New York, United States',
    description:
      'Two days across Manhattan and Brooklyn: skyline viewpoints, a museum visit, and neighbourhood food stops.',
    themes: ['city', 'culture', 'food', 'architecture'],
    durationDays: 2,
    priceCents: 24900,
  },
  {
    id: 'luderitz-bucht-coast',
    name: 'Lüderitz Bucht Coastal Heritage Escape',
    location: 'Lüderitz, Namibia',
    description:
      'Two days on the Namibian coast: colonial-era architecture, a shoreline walk, and a fresh-seafood evening beside the bay.',
    themes: ['coastal', 'heritage', 'seafood', 'architecture', 'desert-coast'],
    durationDays: 2,
    priceCents: 12900,
  },
  {
    id: 'paris-art-and-cafes',
    name: 'Paris Art, Architecture & Café Culture',
    location: 'Paris, France',
    description:
      'Three days of galleries, riverside walks and neighbourhood cafés, with time to explore Paris at an unhurried pace.',
    themes: ['culture', 'art', 'city', 'food', 'architecture'],
    durationDays: 3,
    priceCents: 21900,
  },
  {
    id: 'sossusvlei-dunes',
    name: 'Sossusvlei Dunes at Sunrise',
    location: 'Sossusvlei, Namibia',
    description:
      'Two days in the Namib Desert: a sunrise climb on the dunes, a visit to the clay pan at Deadvlei, and a stargazing evening.',
    themes: ['desert', 'nature', 'adventure', 'photography', 'stargazing'],
    durationDays: 2,
    priceCents: 27900,
  },
  {
    id: 'cape-town-coast-and-table-mountain',
    name: 'Cape Town Coast & Table Mountain',
    location: 'Cape Town, South Africa',
    description:
      'Three days combining a Table Mountain outing, a scenic coastal drive along the peninsula, and a visit to a penguin colony.',
    themes: ['coastal', 'nature', 'city', 'adventure', 'wildlife'],
    durationDays: 3,
    priceCents: 15900,
  },
]);

const BY_ID = new Map(CATALOG.map((e) => [e.id, e]));

function formatCents(cents) {
  return (cents / 100).toFixed(2);
}

/** Look up an experience by id. Returns undefined for anything not in the catalogue. */
function getExperience(id) {
  if (typeof id !== 'string') return undefined;
  return BY_ID.get(id);
}

function listIds() {
  return CATALOG.map((e) => e.id);
}

/** Shape sent to the browser. Price comes from the server catalogue only. */
function toPublic(experience) {
  return {
    id: experience.id,
    name: experience.name,
    location: experience.location,
    description: experience.description,
    durationDays: experience.durationDays,
    pricePerTraveller: formatCents(experience.priceCents),
    currency: CURRENCY,
    demonstration: true,
  };
}

function listPublic() {
  return CATALOG.map(toPublic);
}

/** Returns an integer traveller count or null when the input is not acceptable. */
function parseTravellers(value) {
  let n = value;
  if (typeof n === 'string' && /^\d{1,3}$/.test(n.trim())) n = Number(n.trim());
  if (typeof n !== 'number' || !Number.isInteger(n)) return null;
  if (n < MIN_TRAVELLERS || n > MAX_TRAVELLERS) return null;
  return n;
}

/**
 * Authoritative price calculation. Takes a catalogue id and a traveller count
 * and returns amounts derived exclusively from server-side data.
 */
function calculateTotal(experienceId, travellers) {
  const experience = getExperience(experienceId);
  if (!experience) return null;
  const count = parseTravellers(travellers);
  if (count === null) return null;
  const unitCents = experience.priceCents;
  const totalCents = unitCents * count;
  return {
    experience,
    travellers: count,
    unitAmount: formatCents(unitCents),
    totalAmount: formatCents(totalCents),
    currency: CURRENCY,
  };
}

module.exports = {
  CATALOG,
  CURRENCY,
  MIN_TRAVELLERS,
  MAX_TRAVELLERS,
  getExperience,
  listIds,
  listPublic,
  toPublic,
  parseTravellers,
  calculateTotal,
  formatCents,
};
