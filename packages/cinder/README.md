# usecinder

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

## License

[Elastic License 2.0](https://usecinder.dev) (ELv2) - see `LICENSE` and `NOTICE` in this
package. You can see the source, use it, and modify it. You cannot repackage this software and
offer it to others as your own hosted/managed service, and you cannot remove or obscure the
license notices.
