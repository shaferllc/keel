import { btnGhost, muted } from "../ui.js";
import { configuredProviders } from "../../../app/Controllers/SocialAuthController.js";

const LABELS: Record<string, string> = {
  github: "Continue with GitHub",
  google: "Continue with Google",
};

/**
 * The social sign-in buttons — or nothing at all.
 *
 * `configuredProviders()` is the same function the controller gates its routes on, so
 * the page can't offer a button that the callback would refuse. An app with no OAuth
 * credentials renders no buttons and no divider, and looks exactly as it did before
 * social login existed.
 */
export function SocialButtons() {
  const providers = configuredProviders();
  if (!providers.length) return null;

  return (
    <>
      <div class="mt-6 flex items-center gap-3">
        <span class="h-px flex-1 bg-line" />
        <span class={`${muted} text-xs uppercase tracking-wider`}>or</span>
        <span class="h-px flex-1 bg-line" />
      </div>

      <div class="mt-4 flex flex-col gap-2">
        {providers.map((provider) => (
          <a class={btnGhost} href={`/auth/${provider}`}>
            {LABELS[provider] ?? provider}
          </a>
        ))}
      </div>
    </>
  );
}
