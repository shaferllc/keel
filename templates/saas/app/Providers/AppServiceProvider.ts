import { ServiceProvider, setUserProvider } from "@shaferllc/keel/core";

import { User } from "../Models/User.js";

export class AppServiceProvider extends ServiceProvider {
  register(): void {}

  boot(): void {
    // How `auth().user()` loads the signed-in user from the id in the session.
    setUserProvider((id) => User.find(Number(id)));
  }
}
