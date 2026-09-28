# pi-vertex-gemini

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A Google Vertex AI provider for the [Pi Coding Agent](https://pi.dev) — giving you access to Gemini, Claude, Llama, DeepSeek, Qwen, Mistral, and other MaaS models through a single provider, billed through your GCP project.

> **pi-vertex-gemini** is a rename of [`@lhl/pi-vertex`](https://github.com/lhl/pi-vertex),
> updated for **pi 0.87** (`@earendil-works/*` packages, `TranscriptContext`, and the
> `onPayload` / `onResponse` / `fetch` provider hooks) and switched to env-var-only
> configuration shared with `pi-vertex-anthropic`. It still also works on older pi
> releases. The provider id remains `vertex`, so existing `vertex/<model>` settings keep working.

## About this fork

This is a **fork** of [`@ssweens/pi-vertex`](https://github.com/ssweens/pi-packages/tree/main/pi-vertex). The original is excellent on features (43 models, unified streaming, tool calling, thinking/reasoning support) but is shipped as part of a mono-repo without tests, CI, placeholder npm scripts (`echo 'nothing to check'`).

This fork is created to add new models, fix some bugs, add tests, and to move out of a big combined mono-repo:

### What's been added

| Improvement | Details |
|-------------|---------|
| **88 unit tests** | `auth.ts`, `transcript.ts`, `utils.ts`, `models/`, `streaming/index.ts`, `streaming/gemini.ts`, `streaming/maas.ts`, `convertToGeminiMessages` — covering message conversion, tool call normalization, cost calculation, auth resolution, model validation |
| **GitHub Actions CI** | Type-check (`tsc --noEmit`), lint (`biome check`), test + coverage on every push/PR |
| **Biome linting/formatting** | Catches `noExplicitAny`, enforces import sorting, consistent formatting |
| **Real npm scripts** | `build`, `check`, `test`, `test:coverage`, `clean` |
| **Bug fixes** | Fixed Anthropic stream lifecycle so streams end exactly once; removed hardcoded `maxTokens / 2` halving; hardened Gemini message conversion, cache accounting, image tool results, missing tool results, and blocked-finish handling |
| **Standalone repo** | Filtered from the `ssweens/pi-packages` monorepo with `git filter-repo` for focused development |

### Fork provenance

- **Original upstream**: [`ssweens/pi-packages`](https://github.com/ssweens/pi-packages) (path: `pi-vertex/`)
- **Fork point**: v1.1.4 (commit `598534cf`, 2026-03-30)
- **Filtered with**: `git filter-repo --path pi-vertex/ --path-rename pi-vertex/:` (preserves full upstream git history)
- **This repo**: [`lhl/pi-vertex`](https://github.com/lhl/pi-vertex)

![pi-vertex model selector](https://raw.githubusercontent.com/lhl/pi-vertex/main/screenshot.png)

```bash
pi install /path/to/pi-vertex-gemini
export ANTHROPIC_VERTEX_PROJECT_ID=your-project-id
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json
```

Set your GCP project and credentials. Vertex AI models (Gemini, Claude, Llama, DeepSeek, Qwen, Mistral, and others) appear in pi's model selector, billed through your GCP project.

## Features

- **47 models** across 4 categories:
  - **Gemini** (13): 3.8 Flash, 3.7 Flash, 3.6 Flash, 3.5 Flash, 3.5 Flash-Lite, 3.1 Pro, 3.1 Flash-Lite, 3 Flash, 2.5 Pro, 2.5 Flash, 2.5 Flash-Lite, 2.0 Flash, and 2.0 Flash-Lite
  - **Claude** (10): Opus 4.7, Opus 4.6, Sonnet 4.6, 4.5, 4.1, 4, Haiku 4.5, 3.5 Sonnet v2
  - **Llama** (3): 4 Maverick, 4 Scout, 3.3 70B
  - **Other MaaS** (21): Grok, Gemma, Mistral, DeepSeek, Qwen, OpenAI GPT-OSS, Kimi, MiniMax, GLM

- **Unified streaming**: Single provider, multiple model families
- **Full tool calling support**: All models with multi-turn tool use and proper tool result handling
- **Thinking/reasoning**: Gemini 3 thinking levels, Gemini 2.5 thinking budgets, thought signature preservation
- **Automatic auth**: Uses Google Application Default Credentials
- **Region awareness**: Global endpoints where supported, regional where required
- **Pricing tracking**: Built-in cost per token for all models (including thinking tokens)

## Installation

```bash
git clone <this repo> pi-vertex-gemini
cd pi-vertex-gemini
npm install
pi install /path/to/pi-vertex-gemini
```

## Setup

Configuration is read **only from environment variables** (no `/login` flow, no config
file). The variable names match [`pi-vertex-anthropic`](https://github.com/skyfallsin/pi-vertex-anthropic),
so a single set of exports in your shell config serves both extensions.

```bash
# Add to ~/.zshrc or ~/.bashrc
export ANTHROPIC_VERTEX_PROJECT_ID="your-gcp-project-id"   # or VERTEX_PROJECT_ID
export CLOUD_ML_REGION="global"                              # or VERTEX_REGION (e.g. eu, us, europe-west1)
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"  # or VERTEX_SERVICE_ACCOUNT_KEY
```

### Recognized environment variables

| Setting | Primary | Aliases (in resolution order) |
|---------|---------|-------------------------------|
| GCP project (required) | `VERTEX_PROJECT_ID` | `ANTHROPIC_VERTEX_PROJECT_ID`, `GOOGLE_CLOUD_PROJECT`, `GCLOUD_PROJECT` |
| Region | `VERTEX_REGION` | `CLOUD_ML_REGION`, `GOOGLE_CLOUD_LOCATION` |
| Service account key | `VERTEX_SERVICE_ACCOUNT_KEY` | `GOOGLE_APPLICATION_CREDENTIALS` |

For each setting the first non-empty variable wins. If no region is set, each model's
default region is used (`global` for almost all models). If no key file is set, Google
Application Default Credentials are used (e.g. `gcloud auth application-default login`).

Multi-region locations `us` and `eu` are supported and routed to
`aiplatform.{us,eu}.rep.googleapis.com`.

If no project ID is found, the extension logs a warning and does not register the provider.

## Usage

### Command line

```bash
# Use any supported model
pi --provider vertex --model claude-opus-4-7
pi --provider vertex --model gemini-2.5-pro
pi --provider vertex --model llama-4-maverick
pi --provider vertex --model deepseek-v3.2

# With options
pi --provider vertex --model claude-sonnet-4-6 --reasoning high
```

### Shell alias (recommended)

Add to `~/.bashrc` or `~/.zshrc`:

```bash
# Claude 4.7 Opus
alias pic="VERTEX_PROJECT_ID=your-project pi --provider vertex --model claude-opus-4-7"

# Gemini 2.5 Pro
alias pig="VERTEX_PROJECT_ID=your-project pi --provider vertex --model gemini-2.5-pro"

# Llama 4 Maverick
alias pil="VERTEX_PROJECT_ID=your-project pi --provider vertex --model llama-4-maverick"
```

## Model Reference

### Gemini Models

| Model | Context | Max Tokens | Input | Reasoning | Price (in/out) |
|-------|---------|------------|-------|-----------|----------------|
| gemini-3.8-flash | 1M | 65,535 | text, image | ✅ | $0.75/$3.75 |
| gemini-3.7-flash | 1M | 65,535 | text, image | ✅ | $0.75/$3.75 |
| gemini-3.6-flash | 1M | 65,535 | text, image | ✅ | $0.75/$3.75 |
| gemini-3.5-flash | 1M | 65,535 | text, image | ✅ | $1.50/$9.00 |
| gemini-3.5-flash-lite | 1M | 65,535 | text, image | ✅ | $0.30/$2.50 |
| gemini-3.1-pro | 1M | 65,536 | text, image | ✅ | $2.00/$12.00 |
| gemini-3.1-flash-lite | 1M | 65,535 | text, image | ✅ | $0.25/$1.50 |
| gemini-3-flash | 1M | 65,536 | text, image | ✅ | $0.50/$3.00 |
| gemini-2.5-pro | 1M | 65,536 | text, image | ✅ | $1.25/$10.00 |
| gemini-2.5-flash | 1M | 65,536 | text, image | ✅ | $0.30/$2.50 |
| gemini-2.5-flash-lite | 1M | 65,536 | text, image | ✅ | $0.10/$0.40 |
| gemini-2.0-flash | 1M | 8,192 | text, image | ❌ | $0.15/$0.60 |
| gemini-2.0-flash-lite | 1M | 8,192 | text, image | ❌ | $0.075/$0.30 |

### Claude Models

Prices shown are for the **global** endpoint. Non-global Vertex regions use `costRegional` where Google publishes a regional premium.

| Model | Context | Max Tokens | Input | Reasoning | Price global (in/out) | Price regional (in/out) |
|-------|---------|------------|-------|-----------|------------------------|--------------------------|
| claude-opus-4-7 | 1M | 128,000 | text, image | ✅ | $5.00/$25.00 | $5.50/$27.50 |
| claude-opus-4-6 | 1M | 128,000 | text, image | ✅ | $5.00/$25.00 | $5.50/$27.50 |
| claude-sonnet-4-6 | 1M | 128,000 | text, image | ✅ | $3.00/$15.00 | $3.30/$16.50 |
| claude-opus-4-5 | 200K | 32,000 | text, image | ✅ | $5.00/$25.00 | $5.50/$27.50 |
| claude-sonnet-4-5 | 200K | 64,000 | text, image | ✅ | $3.00/$15.00 | $3.30/$16.50 |
| claude-haiku-4-5 | 200K | 64,000 | text, image | ✅ | $1.00/$5.00 | $1.10/$5.50 |
| claude-opus-4-1 | 200K | 32,000 | text, image | ✅ | $15.00/$75.00 | (uniform) |
| claude-opus-4 | 200K | 32,000 | text, image | ✅ | $15.00/$75.00 | (uniform) |
| claude-sonnet-4 | 200K | 64,000 | text, image | ✅ | $3.00/$15.00 | (uniform) |
| claude-3-5-sonnet-v2 | 200K | 8,192 | text, image | ❌ | $3.00/$15.00 | (uniform) |

### Llama Models

| Model | Context | Max Tokens | Input | Reasoning | Price (in/out) | Region |
|-------|---------|------------|-------|-----------|----------------|--------|
| llama-4-maverick | 524K | 32,000 | text | ✅ | $0.35/$1.15 | global |
| llama-4-scout | 1,310K | 32,000 | text | ✅ | $0.25/$0.70 | global |
| llama-3.3-70b | 128K | 8,192 | text | ❌ | $0.72/$0.72 | global |

### Other MaaS Models

| Model | Context | Publisher | Price (in/out) | Region |
|-------|---------|-----------|----------------|--------|
| grok-4.20-reasoning | 200K | xai | $1.25/$2.50 | global |
| grok-4.1-fast-reasoning | 128K | xai | $0.20/$0.50 | global |
| gemma-4-26b-a4b-it | 262K | google | $0.15/$0.60 | global |
| mistral-medium-3 | 128K | mistralai | $0.40/$2.00 | global |
| mistral-small-3.1 | 128K | mistralai | $0.10/$0.30 | global |
| mistral-ocr | 30 pages | mistralai | $0.0005/page | global |
| codestral-2 | 128K | mistralai | $0.30/$0.90 | global |
| deepseek-v3.2 | 163K | deepseek-ai | $0.56/$1.68 | global |
| deepseek-v3.1 | 163K | deepseek-ai | $0.60/$1.70 | global |
| deepseek-r1 | 163K | deepseek-ai | $1.35/$5.40 | global |
| deepseek-ocr | Varies | deepseek-ai | $0.0003/page | global |
| qwen3-235b | 262K | qwen | $0.22/$0.88 | global |
| qwen3-next-instruct | 262K | qwen | $0.15/$1.20 | global |
| qwen3-next-thinking | 262K | qwen | $0.15/$1.20 | global |
| qwen3-coder | 262K | qwen | $0.22/$1.80 | global |
| gpt-oss-120b | 131K | openai | $0.09/$0.36 | global |
| gpt-oss-20b | 131K | openai | $0.07/$0.25 | global |
| kimi-k2-thinking | 262K | moonshotai | $0.60/$2.50 | global |
| minimax-m2 | 196K | minimaxai | $0.30/$1.20 | global |
| glm-5 | 200K | zai-org | $1.00/$3.20 | global |
| glm-4.7 | 200K | zai-org | $0.60/$2.20 | global |

## Regional Endpoints

Models use different endpoints based on availability:

- **Global** (most models): `aiplatform.googleapis.com`
- **Regional** (older Claude models): `{region}-aiplatform.googleapis.com`

Default regions by model:
- Gemini: `global`
- Claude (all): `global`
- MaaS: `global`

Override with:
```bash
export VERTEX_REGION=us-central1   # or CLOUD_ML_REGION / GOOGLE_CLOUD_LOCATION
```

## Architecture

```
┌─────────────┐
│     Pi      │
└──────┬──────┘
       │ registerProvider("vertex")
       ▼
┌─────────────┐
│ pi-vertex-  │
│   gemini    │
└──────┬──────┘
       │ streamSimple(model, context, options)
       ▼
┌─────────────────────────────────────┐
│         Handler Dispatch            │
├──────────────┬──────────────────────┤
│   Gemini     │        MaaS          │
│  (@google/   │  (OpenAI-compatible  │
│   genai)     │   endpoint)          │
└──────────────┴──────────────────────┘
```

## Dependencies

- `@google/genai`: Google GenAI SDK for Gemini models
- `@anthropic-ai/vertex-sdk`: Official Anthropic-on-Vertex SDK for Claude models (native streaming)
- `google-auth-library`: service account / ADC authentication for all models
- `@earendil-works/pi-ai`: Peer dependency
- `@earendil-works/pi-coding-agent`: Peer dependency

## License

MIT
