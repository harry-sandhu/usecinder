# Cinder

Cinder is a semantic runtime for websites you control. Tag the app, build a local application
graph from that structure, resolve speech/text commands locally, and fall back to AI only when
genuinely needed.

Docs and the full product site: **https://usecinder.dev**

## Install

```bash
npm install usecinder
```

```ts
import { Cinder } from 'usecinder';

await Cinder.init({ ai: { enabled: false, mode: 'local' } });
await Cinder.scan(document);
await Cinder.run('open reports', document);
```

See [the quick start](https://usecinder.dev/docs/quick-start) for a real first integration.

## Workspace overview

- `packages/shared` — shared contracts, graph primitives, tags, intents, and config types
- `packages/cinder` — core runtime implementation, published to npm as `usecinder`
- `packages/cinder-embeddings` — optional tier 2: a free, client-side embedding model (`@cinder/embeddings`)
- `packages/server` — optional, self-hosted tier-3 fallback server (`@cinder/server`)
- `packages/cli` — developer-run tagging audit and coding-agent integration tool (`@cinder/cli`)
- `apps/web` — docs/marketing website (usecinder.dev)
- `apps/react-formtest`, `apps/vue-formtest`, `apps/embeddings-formtest` — minimal real integration examples
- `docs/prompts/` — agent-runnable tagging/enrichment checklists referenced from the docs site

Cinder Relay (`@cinder/relay`), a separately hosted and metered tier-3 proxy, lives in a private
repo - see [the Relay docs](https://usecinder.dev/docs/relay) for what it does and how to use it.
Nothing here depends on it; `config.ai.endpoint` can point at a self-hosted `@cinder/server`
instance just as well.

## Main scripts

From the repo root:

- `npm run build`
- `npm run typecheck`
- `npm run validate:mvp`
- `npm run dev:web`
- `npm run validate:web`

## License

MIT - see [LICENSE](./LICENSE).
