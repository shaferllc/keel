/**
 * One line of a subscription — a single price and its quantity. A single-price
 * subscription has exactly one item; a multi-product subscription has several.
 * Mirrors Cashier's `subscription_items` table.
 */

import { Model } from "../core/model.js";
import type { Casts } from "../core/casts.js";

export class SubscriptionItem extends Model {
  static table = "subscription_items";
  static timestamps = true;
  static casts: Casts = { quantity: "int" };

  declare id: number;
  declare subscription_id: number;
  declare provider_id: string;
  declare provider_product: string;
  declare provider_price: string;
  declare quantity: number | null;
}
