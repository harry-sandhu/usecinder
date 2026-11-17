// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import { Link } from 'react-router-dom';
import { CinderHomepageDemo } from '@/components/cinder/CinderHomepageDemo';
import { PageMetadata } from '@/components/seo/PageMetadata';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { CopyButton } from '@/components/ui/CopyButton';
import { PageLinkCard } from '@/components/ui/PageLinkCard';
import { getWebCinderRouteAttributes } from '@/lib/cinder/routes';
import { SITE_GITHUB_URL } from '@/lib/seo/site';

const AGENT_INSTALL_PROMPT = 'Install usecinder in this project (npm install usecinder), then fetch https://usecinder.dev/get-started/prompt.md and follow it completely.';

const capabilityCards = [
  {
    title: 'Tag-first runtime',
    description: 'Describe routes, contexts, actions, fields, filters, outputs, and data with semantic tags instead of wiring every command by hand.',
  },
  {
    title: 'Graph-aware local resolution',
    description: 'Build a scoped application graph and resolve many commands locally with route/context awareness before fallback is considered.',
  },
  {
    title: 'Optional local embeddings (tier 2)',
    description: 'A free, client-side model (@usecinder/embeddings) recovers typos and paraphrases of a page’s own routes/outputs/actions - still before any network call.',
  },
  {
    title: 'Real DOM execution',
    description: 'Dispatch into standard browser behavior for navigation, form input, submit flows, search actions, and output reveal paths.',
  },
  {
    title: 'Safe extensibility',
    description: 'Add routes, DOM adapters, custom intents, context providers, and runtime events without hiding domain logic inside the SDK core.',
  },
  {
    title: 'Bounded fallback',
    description: 'Use fallback only when local resolution is unknown or weak, with timeout, classification, normalization, and telemetry built in.',
  },
  {
    title: 'Honest failure modes',
    description: 'Reject ambiguous duplicates, preserve scope, isolate callback failures, and expose debug-friendly state instead of silently picking wrong targets.',
  },
];

const firstWinSteps = [
  'Install the browser SDK and initialize it in local mode.',
  'Tag one real route, one context, and one action, field, or output.',
  'Run scan, inspect graph state, and execute a first command through Cinder.run().',
];

const docsCards = [
  {
    href: '/docs/installation',
    title: 'Installation',
    description: 'Set up the browser SDK first, then add the server package only if you want bounded fallback inference.',
  },
  {
    href: '/docs/quick-start',
    title: 'Quick Start',
    description: 'Go from install to first tag-only command flow with the shortest useful integration path.',
  },
  {
    href: '/docs/concepts/semantic-tags',
    title: 'Semantic Tags',
    description: 'Learn the V1 semantic model that turns DOM structure into graph-aware application meaning.',
  },
  {
    href: '/docs/api',
    title: 'API Overview',
    description: 'See the full runtime surface for scan, graph, dispatch, speech, extension points, and lifecycle control.',
  },
  {
    href: '/docs/architecture',
    title: 'Architecture',
    description: 'Understand the full path from semantic tags to graph, planners, dispatch, and optional fallback.',
  },
  {
    href: '/docs/guides/debugging',
    title: 'Debugging',
    description: 'Inspect scan results, graph state, active route/context, dispatch output, and fallback metadata when something is off.',
  },
  {
    href: '/docs/cli',
    title: 'CLI',
    description: 'Crawl a real running app and audit every page for tagging gaps, then teach your coding agent to keep up automatically.',
  },
];

const extensionCards = [
  {
    title: 'Route registry',
    description: 'Register route activators and active-state logic when plain anchors and path metadata are not enough.',
  },
  {
    title: 'DOM adapters',
    description: 'Handle custom controls and framework widgets only when standard DOM execution is insufficient.',
  },
  {
    title: 'Custom intents + presets',
    description: 'Extend local resolution with explicit matchers and domain presets instead of burying domain behavior inside the core runtime.',
  },
  {
    title: 'Runtime context + events',
    description: 'Inject app state and observe scan, resolve, dispatch, fallback, and speech events without breaking the core execution pipeline.',
  },
];

const boundaryPoints = [
  'Cinder is strongest on websites you control, not arbitrary untagged pages.',
  'Local resolution is practical and deterministic, but it is not a broad natural-language agent.',
  'Fallback exists as a bounded secondary path, not the product core.',
  'Custom widgets may still need DOM adapters when standard browser behaviors do not apply cleanly.',
];

export function HomePage() {
  return (
    <>
      <PageMetadata
        title="Cinder: semantic runtime for websites you control"
        description="Add semantic tags to the websites you control, build a local app graph, resolve commands locally, and use bounded fallback only when needed."
      />

      <div id="home-page" data-page="home" {...getWebCinderRouteAttributes('/')}>
        <section cinder-context="home-hero" className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-14">
          <div className="space-y-8">
            <div className="inline-flex rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300">
              Semantic runtime for websites you control
            </div>

            <div className="space-y-5">
              <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl lg:text-6xl dark:text-white">
                Install the SDK, add tags, and make your app commandable.
              </h1>
              <p className="max-w-3xl text-base leading-8 text-slate-600 sm:text-lg dark:text-slate-300">
                Cinder turns tagged application structure into a graph-aware runtime. It resolves many commands locally,
                dispatches real DOM behavior, and falls back only when local understanding is insufficient.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <ButtonLink href="/docs/installation" aria-label="Open installation guide">
                Get Started
              </ButtonLink>
              <ButtonLink href="/docs/quick-start" variant="secondary" aria-label="Open quick start guide">
                Quick Start
              </ButtonLink>
              <ButtonLink href="/docs/api" variant="secondary" aria-label="Open API overview">
                API Overview
              </ButtonLink>
              <ButtonLink href={SITE_GITHUB_URL} variant="secondary" target="_blank" rel="noreferrer" aria-label="Open GitHub repository">
                GitHub
              </ButtonLink>
            </div>

            <div className="rounded-2xl border border-brand-200 bg-brand-50/60 p-4 dark:border-brand-500/30 dark:bg-brand-500/10">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-700 dark:text-brand-300">Using a coding agent?</p>
                <CopyButton value={AGENT_INSTALL_PROMPT} />
              </div>
              <p className="mt-2 text-sm leading-7 text-slate-700 dark:text-slate-300">Paste this to your agent - it installs, tags, and configures Cinder on its own:</p>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-xl bg-slate-950 px-4 py-3 text-sm leading-7 text-slate-100">{AGENT_INSTALL_PROMPT}</pre>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Best fit</p>
                <p className="mt-2 text-sm leading-7 text-slate-700 dark:text-slate-300">Tagged dashboards, forms, internal tools, admin apps, and other structured websites you control.</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Primary path</p>
                <p className="mt-2 text-sm leading-7 text-slate-700 dark:text-slate-300">Semantic scan → graph → local resolution → DOM dispatch → reflex feedback.</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Fallback policy</p>
                <p className="mt-2 text-sm leading-7 text-slate-700 dark:text-slate-300">Optional, timeout-bounded, scope-aware, and observable through structured fallback telemetry.</p>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-soft sm:p-6 dark:border-slate-800 dark:bg-slate-900">
            <div className="space-y-4 rounded-2xl bg-slate-950 p-5 text-sm text-slate-100">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-400">5-minute first win</div>
              <pre className="overflow-x-auto whitespace-pre-wrap leading-7">
{`import { Cinder } from 'usecinder';

await Cinder.init({
  semantic: { scanOnInit: false, observeMutations: true },
  ai: { enabled: false, mode: 'local', endpoint: '', apiKey: '' },
});

await Cinder.scan(document);
console.log(Cinder.graph());

const result = await Cinder.run('open reports', document);
console.log(result.intent, result.dispatch, result.reflex);`}
              </pre>
            </div>
            <div className="mt-5 grid gap-3">
              {firstWinSteps.map((step, index) => (
                <div key={step} className="flex gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/60">
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white dark:bg-brand-500 dark:text-slate-950">
                    {index + 1}
                  </span>
                  <p className="text-sm leading-7 text-slate-700 dark:text-slate-300">{step}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <CinderHomepageDemo />

        <section cinder-context="home-capabilities" className="border-y border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-950/60">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
            <div className="mb-8 max-w-3xl space-y-3">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-700 dark:text-brand-300">What works today</p>
              <h2 className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">
                A local-first SDK, not a generic chatbot wrapper
              </h2>
              <p className="text-base leading-8 text-slate-600 dark:text-slate-300">
                The current SDK already supports semantic scan, scoped graph construction, route/context-aware local
                resolution, DOM-native execution, browser speech hooks, optional fallback, and hardened failure handling.
              </p>
            </div>

            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {capabilityCards.map((feature) => (
                <article key={feature.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="text-lg font-semibold text-slate-950 dark:text-white">{feature.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">{feature.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section cinder-context="home-architecture" className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
          <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
            <div className="space-y-4">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-700 dark:text-brand-300">How the runtime works</p>
              <h2 className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">
                Describe the app, then let the runtime use that structure
              </h2>
              <p className="text-base leading-8 text-slate-600 dark:text-slate-300">
                Cinder is strongest when the application exposes meaning directly. Tags become semantic scan records,
                scan records become graph nodes, and the graph drives planners, dispatch, and optional fallback.
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                <ButtonLink href="/docs/concepts/semantic-tags" variant="secondary">Semantic Tags</ButtonLink>
                <ButtonLink href="/docs/concepts/application-graph" variant="secondary">Application Graph</ButtonLink>
                <ButtonLink href="/docs/concepts/local-resolution" variant="secondary">Local Resolution</ButtonLink>
              </div>
            </div>

            <div className="grid gap-4">
              {[
                {
                  title: '1. Scan tagged DOM',
                  description: 'Capture semantic entries, metadata hints, warnings, and active route/context signals from the browser surface.',
                },
                {
                  title: '2. Build the app graph',
                  description: 'Create scoped node identity, route/context relationships, indexes, and runtime state used by local reasoning.',
                },
                {
                  title: '3. Resolve locally first',
                  description: 'Use planners, graph queries, active route/context, and optional runtime context before cloud fallback is considered.',
                },
                {
                  title: '4. Dispatch real app behavior',
                  description: 'Trigger route navigation, form updates, submit flows, action clicks, output reveal, adapters, or bindings.',
                },
                {
                  title: '5. Fall back only when needed',
                  description: 'Use the server path only for unknown or weak local understanding, then normalize the response back into the same dispatch pipeline.',
                },
              ].map((step) => (
                <div key={step.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="text-lg font-semibold text-slate-950 dark:text-white">{step.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">{step.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section cinder-context="home-extension-points" className="border-y border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950/60">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-6 sm:py-16 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div className="space-y-4">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-700 dark:text-brand-300">Extension points</p>
              <h2 className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">Keep the core reusable, move app-specific behavior to explicit hooks</h2>
              <p className="text-base leading-8 text-slate-600 dark:text-slate-300">
                The SDK now has real extension points for route activation, custom controls, custom intent matchers,
                runtime context injection, speech handlers, and runtime event observation. Domain-specific behavior no
                longer has to hide inside the core runtime.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {extensionCards.map((item) => (
                <article key={item.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="text-base font-semibold text-slate-950 dark:text-white">{item.title}</h3>
                  <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">{item.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section cinder-context="home-relay" className="border-y border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950/60">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-6 sm:py-16 lg:grid-cols-[1fr_0.9fr] lg:items-start">
            <div className="space-y-4">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-700 dark:text-brand-300">Tier 3, hosted</p>
              <h2 className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">
                When local resolution genuinely can&rsquo;t, Relay is the fallback - without running your own server
              </h2>
              <p className="text-base leading-8 text-slate-600 dark:text-slate-300">
                Tier 1 and{' '}
                <Link to="/docs/concepts/tier-2-embeddings" className="font-medium text-brand-700 hover:underline dark:text-brand-300">
                  tier 2
                </Link>{' '}
                stay free - they run entirely in the browser. <code>@cinder/relay</code> is a hosted, metered proxy
                for tier 3: top up a wallet, and every real fallback call deducts exactly what it cost. Bring your
                own AI provider key, or let your app&rsquo;s own users bring theirs.
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                <ButtonLink href="/relay">See pricing &amp; sign in</ButtonLink>
                <ButtonLink href="/docs/relay" variant="secondary">
                  Read the docs
                </ButtonLink>
              </div>
            </div>

            <div className="grid gap-4">
              {[
                { title: 'Usage-based, not a subscription', description: 'Priced from the provider’s real token usage, not a flat fee or a character-count guess.' },
                { title: 'A failed call is never billed', description: 'The balance is only debited after a real, successful response comes back.' },
                { title: 'A hosted fallback pipeline', description: 'Real accounts, real metering, and real billing, already wired up - point your app at it and go.' },
              ].map((point) => (
                <div key={point.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="text-base font-semibold text-slate-950 dark:text-white">{point.title}</h3>
                  <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">{point.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section cinder-context="home-docs-paths" className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
          <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="max-w-3xl space-y-3">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-700 dark:text-brand-300">Best next docs</p>
              <h2 className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">Start with the docs that create a real first integration</h2>
              <p className="text-base leading-8 text-slate-600 dark:text-slate-300">
                The docs should move you from install to a real command path quickly: tag the UI, scan it, inspect the
                graph, run a command, then debug or extend the runtime only where necessary.
              </p>
            </div>
            <Link to="/docs" aria-label="Open all documentation pages" {...getWebCinderRouteAttributes('/docs')} className="text-sm font-medium text-brand-700 hover:text-brand-800 dark:text-brand-300 dark:hover:text-brand-200">
              Open all docs →
            </Link>
          </div>

          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {docsCards.map((link) => (
              <PageLinkCard key={link.href} href={link.href} title={link.title} description={link.description} />
            ))}
          </div>
        </section>

        <section cinder-context="home-boundaries" className="border-y border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-950/60">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
            <div className="mb-8 max-w-3xl space-y-3">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-700 dark:text-brand-300">Current boundary</p>
              <h2 className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">Strong MVP, honest scope</h2>
              <p className="text-base leading-8 text-slate-600 dark:text-slate-300">
                Cinder is now a real SDK for websites you control, but it should still be positioned honestly. It is not
                trying to be a universal web agent, and that focus is one of its strengths.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {boundaryPoints.map((point) => (
                <div key={point} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <p className="text-sm leading-7 text-slate-700 dark:text-slate-300">{point}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section cinder-context="home-final-cta" className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
          <div className="rounded-3xl border border-slate-200 bg-slate-950 px-6 py-10 text-white shadow-soft sm:px-10 dark:border-slate-800 dark:bg-slate-900">
            <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
              <div className="space-y-3">
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-200 dark:text-brand-300">Start with the smallest useful proof</p>
                <h2 className="text-3xl font-semibold tracking-tight">Install Cinder, tag one page, inspect one graph, run one command.</h2>
                <p className="max-w-3xl text-base leading-8 text-slate-300">
                  That is the right first milestone. Once the local-first path works on a real page, you can add bindings,
                  route registry hooks, DOM adapters, custom intents, or fallback only where the app actually needs them.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <ButtonLink href="/docs/installation">Installation</ButtonLink>
                <ButtonLink href="/docs/quick-start" variant="secondary">
                  Quick Start
                </ButtonLink>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
