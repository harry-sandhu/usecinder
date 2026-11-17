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
- `packages/cli` — developer-run tagging audit and coding-agent integration tool (`@cinder/cli`)
- `apps/web` — docs/marketing website (usecinder.dev)
- `apps/react-formtest`, `apps/vue-formtest`, `apps/embeddings-formtest` — minimal real integration examples
- `docs/prompts/` — agent-runnable tagging/enrichment checklists referenced from the docs site

Tier 1 (local graph) and tier 2 (`@cinder/embeddings`) are entirely free and run in the browser.
Tier-3 AI fallback is available exclusively through **Cinder Relay**, a hosted, metered service -
see [the Relay docs](https://usecinder.dev/docs/relay). Relay's implementation is not part of
this repo.

## Main scripts

From the repo root:

- `npm run build`
- `npm run typecheck`
- `npm run validate:mvp`
- `npm run dev:web`
- `npm run validate:web`

## License

[Elastic License 2.0](./LICENSE) (ELv2) - see also [NOTICE](./NOTICE). You can see the source,
use it, and modify it. You cannot repackage this software (as-is or modified) and offer it to
others as your own hosted/managed service, and you cannot remove or obscure the license headers
in the source or compiled output.
