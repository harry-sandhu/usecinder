import { Link } from 'react-router-dom';
import { PageMetadata } from '@/components/seo/PageMetadata';
import { Badge } from '@/components/ui/Badge';
import { Card, CardGrid } from '@/components/ui/Card';
import { ButtonLink } from '@/components/ui/ButtonLink';

const tiers = [
  {
    name: 'Tier 1 - Local resolution',
    price: 'Free, forever',
    description: 'Semantic tags, graph-aware local resolution, and DOM execution all run in the browser SDK. Nothing to meter, nothing to pay for.',
    docsHref: '/docs/concepts/local-resolution',
  },
  {
    name: 'Tier 2 - Embeddings',
    price: 'Free, forever',
    description: 'Local embedding-based matching for broader coverage, still entirely client-side. No server, no account, no cost.',
    docsHref: '/docs/concepts/tier-2-embeddings',
  },
  {
    name: 'Tier 3 - AI fallback',
    price: 'Usage-based',
    description:
      'When local resolution genuinely can’t resolve a command, Relay forwards it to a real AI provider and meters exactly what that call cost - nothing more.',
    docsHref: '/docs/relay',
  },
];

const howItWorks = [
  {
    title: 'Bring your own key, or let your users bring theirs',
    description:
      'A relay project is either "developer" (your own provider key, stored once, reused for every call) or "end_user" (your app’s own user supplies their key per request, never stored) - your choice per project, made once.',
  },
  {
    title: 'A wallet, not a subscription',
    description:
      'Top up a project’s balance and every real tier-3 call deducts exactly what it cost, priced from the provider’s own real token usage - not a flat fee, not a guess. A project at zero balance never reaches the AI provider at all, not even once.',
  },
  {
    title: 'A failed call is never billed',
    description:
      'The balance is only ever debited after a real, successful response comes back. An error on the provider’s side costs you nothing.',
  },
  {
    title: 'Self-host or let us run it',
    description:
      'Relay is the same open @cinder/server fallback pipeline, wrapped with real accounts, metering, and billing. Run cinder-relay yourself, or point your app at a hosted instance - your data, your choice.',
  },
];

export function RelayLandingPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
      <PageMetadata
        title="Cinder Relay"
        description="A hosted, metered tier-3 proxy for Cinder: tier 1 and tier 2 stay free, tier 3 AI fallback is usage-based, and you choose who supplies the AI provider key."
      />

      <div className="mb-12 text-center">
        <Badge tone="brand">@cinder/relay</Badge>
        <h1 className="mt-4 text-3xl font-semibold text-slate-950 sm:text-4xl dark:text-white">
          Tier 3 fallback, without running your own server
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-slate-600 dark:text-slate-400">
          Cinder resolves most commands locally for free. When it genuinely can&rsquo;t, Relay is a hosted proxy that
          forwards the call to a real AI provider and meters exactly what that call cost - nothing more, nothing
          flat, nothing guessed.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <ButtonLink href="/relay/login">Sign in or create an account</ButtonLink>
          <ButtonLink href="/docs/relay" variant="secondary">
            Read the docs
          </ButtonLink>
        </div>
      </div>

      <div className="mb-16">
        <h2 className="mb-5 text-center text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          What you pay for
        </h2>
        <CardGrid>
          {tiers.map((tier) => (
            <Card key={tier.name} title={tier.name}>
              <p className="text-lg font-semibold text-slate-950 dark:text-white">{tier.price}</p>
              <p>{tier.description}</p>
              <Link to={tier.docsHref} className="inline-block font-medium text-brand-700 hover:underline dark:text-brand-300">
                Learn more →
              </Link>
            </Card>
          ))}
        </CardGrid>
      </div>

      <div className="mb-16">
        <h2 className="mb-5 text-center text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          How it works
        </h2>
        <CardGrid>
          {howItWorks.map((item) => (
            <Card key={item.title} title={item.title}>
              <p>{item.description}</p>
            </Card>
          ))}
        </CardGrid>
      </div>

      <Card title="Honest status">
        <p>
          Relay is a real, working prototype of this billing/metering model, backed by a real Postgres database when
          you run it with <code>DATABASE_URL</code> set - not a mockup. It is not yet a hands-off managed service:
          see the{' '}
          <Link to="/docs/known-limitations" className="font-medium text-brand-700 hover:underline dark:text-brand-300">
            known limitations
          </Link>{' '}
          doc for exactly what that means before you put real money behind it.
        </p>
      </Card>
    </div>
  );
}
