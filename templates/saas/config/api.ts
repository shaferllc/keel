/**
 * Keel API-resource defaults. `maxPerPage` is the ceiling `?perPage=` is clamped to —
 * the guard against "give me the whole table".
 */
export default {
  perPage: 25,
  maxPerPage: 100,
};
