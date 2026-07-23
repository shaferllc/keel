/**
 * The specimen page — every token and every `.keel-*` class on one screen.
 *
 * It is the kit's own fixture: change a token and this page tells you what you
 * changed, in both modes, in one look.
 *
 *   npm run build:specimen          # → public/specimen.html, then open it
 *
 * Apps can mount it too, since it is ordinary JSX with no Node imports:
 *
 *   Route.get("/_ui", () => SpecimenPage({ stylesheet: "/assets/app.css" }));
 */

import { raw } from "hono/html";
import { Badge } from "./Badge.js";
import { Brand } from "./Brand.js";
import { Button } from "./Button.js";
import { Card, CardBody, CardTitle } from "./Card.js";
import { Field } from "./Field.js";
import { Grain } from "./Grain.js";
import { Bar, Container, Divider, Footer, Grid, Stack } from "./Layout.js";
import { Alert, Notice } from "./Notice.js";
import { Panel } from "./Panel.js";
import { Muted, RowForm, SectionLabel } from "./Shell.js";
import { Code, Pre, Prose, Table } from "./Text.js";
import { ThemeScript, ThemeToggle } from "./Theme.js";
import { classes } from "./classes.js";

/** Every colour token, in declaration order. */
const COLOR_TOKENS = [
  "--color-ink",
  "--color-ink-soft",
  "--color-mist",
  "--color-foam",
  "--color-sea",
  "--color-sea-deep",
  "--color-brass",
  "--color-line",
  "--color-danger",
  "--color-warn",
  "--color-surface",
  "--color-surface-strong",
  "--color-on-accent",
  "--color-shadow",
] as const;

/** Local layout escapes — the specimen's own scaffolding, not part of the kit. */
function Box({ style, children }: { style: string; children?: unknown }) {
  return <div style={style}>{children as never}</div>;
}

function Row({ children }: { children?: unknown }) {
  return <Box style="display:flex;flex-wrap:wrap;gap:0.75rem;align-items:center">{children}</Box>;
}

function Section({ title, children }: { title: string; children?: unknown }) {
  return (
    <section style="margin-top:3rem">
      <SectionLabel>{title}</SectionLabel>
      <Box style="margin-top:0.875rem">{children}</Box>
    </section>
  );
}

function Swatch({ token }: { token: string }) {
  return (
    <Box style="border-radius:0.75rem;border:1px solid var(--color-line);background:color-mix(in oklab, var(--color-surface) 86%, transparent);padding:0.75rem">
      <Box
        style={`height:2.75rem;border-radius:0.5rem;border:1px solid var(--color-line);background:var(${token})`}
      />
      <Box style="margin-top:0.5rem">
        <code class={classes.code} style="font-size:0.72rem">
          {token}
        </code>
      </Box>
    </Box>
  );
}

export interface SpecimenPageProps {
  /** CSS text to inline in a <style> tag — what `build:specimen` passes. */
  styles?: string;
  /** Or a stylesheet URL to link instead, when mounting this inside an app. */
  stylesheet?: string;
  title?: string;
}

/** A complete HTML document exercising the whole kit. */
export function SpecimenPage({
  styles,
  stylesheet,
  title = "Keel UI — specimen",
}: SpecimenPageProps = {}) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <ThemeScript />
        {stylesheet ? <link rel="stylesheet" href={stylesheet} /> : null}
        {styles ? raw(`<style>${styles}</style>`) : null}
      </head>
      <body class={classes.body}>
        <Grain />

        <Bar>
          <Brand>Keel UI</Brand>
          <Row>
            <span class={classes.muted} style="font-size:0.8rem">
              specimen
            </span>
            <ThemeToggle />
          </Row>
        </Bar>

        <Container size="wide" as="main">
          <Box style="padding:2.5rem 0 1rem">
            <h1 class={classes.brand} style="font-size:2.5rem;margin:0">
              Every token, every class
            </h1>
            <Box style="max-width:38rem">
              <Muted>
                The kit renders here exactly as it renders in an app. Use the toggle to check both
                modes — nothing below is mode-specific markup.
              </Muted>
            </Box>
          </Box>

          <Section title="Colour tokens">
            <Grid cols={3}>
              {COLOR_TOKENS.map((token) => (
                <Swatch token={token} />
              ))}
            </Grid>
          </Section>

          <Section title="Type">
            <Stack>
              <p class={classes.brand} style="font-size:2.25rem;margin:0">
                Display — Syne 800
              </p>
              <p style="margin:0;font-size:1.05rem">
                Body — IBM Plex Sans. The quick brown fox jumps over the lazy dog, and{" "}
                <em>italics</em> come from the same family.
              </p>
              <Muted>Muted body copy, one step down in contrast.</Muted>
              <p style="margin:0">
                Inline <Code>keel-code</Code> sits in a sentence without shifting the line.
              </p>
            </Stack>
          </Section>

          <Section title="Buttons">
            <Row>
              <Button variant="primary">Primary</Button>
              <Button variant="sea">Sea</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="primary" disabled>
                Disabled
              </Button>
              <Button variant="ghost" href="#top">
                Link button
              </Button>
            </Row>
          </Section>

          <Section title="Forms">
            <Box style="max-width:26rem">
              <Stack>
                <Field name="email" type="email" placeholder="you@example.com" />
                <Field name="disabled" placeholder="Disabled" disabled />
                <RowForm>
                  <Field name="q" placeholder="Search the fleet" />
                  <Button variant="sea" type="submit">
                    Go
                  </Button>
                </RowForm>
              </Stack>
            </Box>
          </Section>

          <Section title="Badges">
            <Row>
              <Badge>neutral</Badge>
              <Badge tone="sea">v0.87.0</Badge>
              <Badge tone="brass">beta</Badge>
              <Badge tone="danger">failed</Badge>
            </Row>
          </Section>

          <Section title="Panels and cards">
            <Grid>
              <Panel>
                <strong>Panel</strong>
                <Muted>The plain surface. Everything else sits on one of these.</Muted>
              </Panel>
              <Card>
                <CardTitle>Card</CardTitle>
                <CardBody>
                  A card is a panel that expects a title and a body — and can be a link.
                </CardBody>
              </Card>
              <Card href="#top">
                <CardTitle>Card as a link</CardTitle>
                <CardBody>Hover it — the border warms and the whole surface lifts.</CardBody>
              </Card>
            </Grid>
            <Box style="margin-top:1rem;display:flex;justify-content:center">
              <Panel variant="auth">
                <p class={classes.brand} style="font-size:1.35rem;margin:0 0 1rem">
                  Sign in
                </p>
                <Stack gap="tight">
                  <Field name="email" placeholder="Email" />
                  <Field name="password" type="password" placeholder="Password" />
                  <Button variant="primary" type="submit">
                    Continue
                  </Button>
                </Stack>
              </Panel>
            </Box>
          </Section>

          <Section title="Messages">
            <Stack>
              <Notice>A notice — brass on surface, for things worth knowing.</Notice>
              <Alert>An alert — danger on surface, for things that went wrong.</Alert>
            </Stack>
          </Section>

          <Section title="Tables">
            <Panel>
              <Table>
                <thead>
                  <tr>
                    <th>Command</th>
                    <th>Does</th>
                    <th>Since</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <Code>keel serve</Code>
                    </td>
                    <td>Starts the HTTP server</td>
                    <td>
                      <Badge tone="sea">0.1.0</Badge>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <Code>keel ui:fonts</Code>
                    </td>
                    <td>Copies the kit's webfonts into public/fonts</td>
                    <td>
                      <Badge tone="brass">0.87.0</Badge>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <Code>keel kit:sync</Code>
                    </td>
                    <td>Refreshes untouched starter-kit files</td>
                    <td>
                      <Badge tone="sea">0.62.0</Badge>
                    </td>
                  </tr>
                </tbody>
              </Table>
            </Panel>
          </Section>

          <Section title="Code">
            <Pre>{`import { Card, CardTitle } from "@shaferllc/keel/ui";

export default function Page() {
  return (
    <Card href="/docs">
      <CardTitle>Read the docs</CardTitle>
    </Card>
  );
}`}</Pre>
          </Section>

          <Section title="Prose">
            <Prose as="article">
              <h2>Long-form copy</h2>
              <p>
                Prose styles unclassed markup, so rendered Markdown drops straight in. Headings take
                the display face; <a href="#top">links</a> take the sea accent with a soft underline
                that firms up on hover.
              </p>
              <ul>
                <li>Lists get their own rhythm.</li>
                <li>
                  So does <code>inline code</code>, without a class.
                </li>
              </ul>
              <blockquote>
                A quote is a left rule and a step down in contrast — nothing more.
              </blockquote>
            </Prose>
          </Section>

          <Divider />

          <Muted>
            Layout helpers on this page: <Code>keel-container</Code>, <Code>keel-bar</Code>,{" "}
            <Code>keel-stack</Code>, <Code>keel-grid</Code>, <Code>keel-divider</Code>,{" "}
            <Code>keel-footer</Code>.
          </Muted>
        </Container>

        <Footer>
          <Container size="wide">
            Keel UI specimen — generated by <Code>npm run build:specimen</Code>.
          </Container>
        </Footer>
      </body>
    </html>
  );
}
