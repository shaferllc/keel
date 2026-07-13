import Layout from "./layout.js";
import { brand, hero, heroGlow, heroInner, muted, rise, rise1, rise2, rise3 } from "./ui.js";

export default function Welcome({ name }: { name: string }) {
  return (
    <Layout title="Keel">
      <main class={hero}>
        <div class={heroGlow} aria-hidden="true" />
        <div class={heroInner}>
          <p class={`${rise} ${muted} mb-4 text-sm tracking-[0.2em] uppercase`}>Minimal starter</p>
          <h1 class={`${brand} ${rise1} text-[clamp(3.5rem,12vw,6.5rem)] text-ink`}>Hello, {name}.</h1>
          <p class={`${rise2} mt-5 max-w-md text-lg leading-relaxed text-ink-soft`}>
            Routes, a controller, and a JSX view. No database — edit{" "}
            <code class="rounded-md bg-white/70 px-1.5 py-0.5 text-sm text-ink">
              resources/views/welcome.tsx
            </code>
            .
          </p>
          <p class={`${rise3} mt-10 flex flex-wrap gap-4 text-sm text-ink-soft`}>
            <a class="underline underline-offset-4" href="/health">
              /health
            </a>
            <a class="underline underline-offset-4" href="/hello/world">
              /hello/:name
            </a>
          </p>
        </div>
      </main>
    </Layout>
  );
}
