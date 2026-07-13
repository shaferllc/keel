import { Job, logger } from "@shaferllc/keel/core";
import { sendVerificationEmail } from "@shaferllc/keel/accounts";

import { User } from "../Models/User.js";

/**
 * Sends the "confirm your email" message after signup.
 *
 * Registration used to `await` this inline, which put a mail provider on the critical
 * path of every signup: a slow SMTP handshake became a slow signup, and a failing one
 * became a *failed registration* — the account was already created, so the user got a
 * 500 for something that had, in fact, worked.
 *
 * Queued, the account is committed, the user is logged in, and the email happens a
 * moment later. That is the entire argument for a queue, in one flow.
 *
 * It carries the user's id, not the user. A model would be a row that may have changed
 * (or been deleted) by the time the job runs, and it can't be serialized across a real
 * broker. An id is re-read against the database, which is the current truth.
 */
export class SendVerificationEmailJob extends Job {
  static override maxRetries = 3;

  constructor(private readonly userId: number) {
    super();
  }

  async handle(): Promise<void> {
    const user = await User.find<User>(this.userId);

    // Registered and then deleted before the queue drained. Nothing to send, and
    // nothing wrong — return rather than throwing into a retry that can never succeed.
    if (!user) return;

    await sendVerificationEmail(user as never);
  }

  /**
   * Out of retries. The account exists and is usable, but unverified, and nobody has
   * been told why — so this is logged loudly enough to act on.
   */
  async failed(error: unknown): Promise<void> {
    logger().error("verification email failed to send", {
      userId: this.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
