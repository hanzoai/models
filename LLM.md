# Hanzo Models

## Overview
Model registry API for models.hanzo.ai — discovers available models from zen-gateway + OpenRouter

## Tech Stack
- **Language**: TypeScript/JavaScript

## Build & Run
```bash
npm install && npm run build
npm test
```

## Structure
```
models/
  Dockerfile
  compose.yml
  data/
  k8s/
  package-lock.json
  package.json
  src/
```

## Key Files
- `package.json` -- Dependencies and scripts
- `Dockerfile` -- Container build
- `compose.yml` -- Docker Compose services

## License

Relicensed from BSD-3-Clause to the dual `MIT OR Apache-2.0` grant under
HIP-0137 ("One License", `hanzoai/hips`). `LICENSE` states the dual grant;
`LICENSE-MIT` and `LICENSE-APACHE` carry the full texts. The original BSD
copyright line — `2026, Hanzo AI, Inc.` — carries over verbatim into
`LICENSE-MIT`: the relicense changes the grant, not the copyright record.
