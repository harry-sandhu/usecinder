# @usecinder/embeddings

Optional tier 2 for Cinder: a free, client-side embedding model that recovers typos and
paraphrases of a page's own routes/outputs/actions before any network call - no server, no
account, no cost.

Docs and the full product site: **https://usecinder.dev/docs/concepts/tier-2-embeddings**

## Install

```bash
npm install @usecinder/embeddings
```

```ts
import { Cinder } from 'usecinder';
import { createEmbeddingLlmCore } from '@usecinder/embeddings';

Cinder.setLlmCore(createEmbeddingLlmCore(), { requiresNetwork: false });
```

## License

Elastic License 2.0 (ELv2) - see `LICENSE` and `NOTICE` in this package.
