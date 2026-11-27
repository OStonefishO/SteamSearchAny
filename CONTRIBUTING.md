# Contributing to Steam Lighthouse

Thanks for stopping by! This project is small and deliberately dependency-free, so contributing is simple.

[English](./CONTRIBUTING.md) | [简体中文](./CONTRIBUTING.zh.md)

## Ways to help

| What | How |
| --- | --- |
| 🐛 **Report a bug** | Open an issue: what you did, what happened, what you expected. Screenshots help |
| 💡 **Suggest a feature** | Open an issue and describe the use case, not just the feature |
| 🎮 **Suggest games** | Games are pulled from Valve's API automatically — but a curated list of hidden gems is always welcome in an issue |
| 🔤 **Improve the wording** | UI copy and README typos are fair game for a one-line PR |
| 🌍 **Translations** | The UI is Chinese-first; an English UI is on the roadmap — help is welcome |

## Local development

```bash
node server/index.mjs        # http://127.0.0.1:5173 — no npm install needed, Node 20+
node scripts/build-static.mjs # build the static site into dist/
```

Please keep pull requests small and focused. There is no build step for the frontend — plain ES modules, no bundler.

## Code style

- Vanilla JS, ES modules, no framework
- Comments in Chinese are fine
- No new runtime dependencies unless there is a strong reason

## Before you open a PR

1. `node --check` the files you touched
2. Run `node scripts/build-static.mjs` and make sure it finishes without errors
3. Describe what you changed and why
