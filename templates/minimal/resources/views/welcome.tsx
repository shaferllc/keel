import { Brand, Hero, HeroGlow, HeroInner, Muted, Rise } from "@shaferllc/keel/ui";
import Layout from "./layout.js";

export default function Welcome({ name }: { name: string }) {
  return (
    <Layout title="Keel">
      <Hero>
        <HeroGlow />
        <HeroInner>
          <Muted class="mb-4 text-sm tracking-[0.2em] uppercase">
            <Rise step={0} as="span">
              Minimal starter
            </Rise>
          </Muted>
          <Rise step={1} as="h1" class="text-[clamp(3.5rem,12vw,6.5rem)] text-ink">
            <Brand>Hello, {name}.</Brand>
          </Rise>
          <Rise step={2} as="p" class="mt-5 max-w-md text-lg leading-relaxed text-ink-soft">
            Routes, a controller, and a JSX view. No database — edit{" "}
            <code class="rounded-md bg-white/70 px-1.5 py-0.5 text-sm text-ink">
              resources/views/welcome.tsx
            </code>
            .
          </Rise>
          <Rise step={3} as="p" class="mt-10 flex flex-wrap gap-4 text-sm text-ink-soft">
            <a class="underline underline-offset-4" href="/health">
              /health
            </a>
            <a class="underline underline-offset-4" href="/hello/world">
              /hello/:name
            </a>
          </Rise>
        </HeroInner>
      </Hero>
    </Layout>
  );
}
