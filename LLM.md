# LLM.md - Hanzo Models

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
