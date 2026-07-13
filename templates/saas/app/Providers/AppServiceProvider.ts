import { ServiceProvider, setUserProvider } from "@shaferllc/keel/core";

import { User } from "../Models/User.js";
import { registerBillableResolver } from "../Controllers/BillingController.js";

export class AppServiceProvider extends ServiceProvider {
  register(): void {}

  boot(): void {
    // How `auth().user()` loads the signed-in user from the id in the session.
    setUserProvider((id) => User.find(Number(id)));

    // Webhooks look up the Team by billing_customer_id.
    registerBillableResolver();
  }
}
