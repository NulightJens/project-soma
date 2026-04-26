# SOMA docs site

[Astro Starlight](https://starlight.astro.build) renders [`../docs/wiki/`](../docs/wiki/) as a static documentation site. The wiki markdown is the canonical source — this directory just builds the HTML around it.

## Structure

```
docs-site/
├── astro.config.mjs               # Starlight config: title, sidebar, llms.txt plugin, theme CSS
├── package.json                   # @astrojs/starlight + starlight-llms-txt + astro
├── src/
│   ├── content.config.ts          # docsLoader → ../docs/wiki/*.md (excludes README.md)
│   ├── assets/soma-mark.svg       # logo
│   └── styles/soma-theme.css      # SOMA monochrome theme overrides
└── public/
    └── favicon.svg                # served at /favicon.svg
```

## Local development

```bash
cd docs-site
npm install
npm run dev                        # serves at http://localhost:4321
```

The dev server hot-reloads on changes to `../docs/wiki/*.md` — edit the markdown source, watch the rendered page update.

## Build

```bash
npm run build                      # outputs to dist/
npm run preview                    # serves dist/ locally
```

## Deploy

CI deploys to GitHub Pages on push to `main` via [.github/workflows/docs-deploy.yml](../.github/workflows/docs-deploy.yml). The workflow builds `docs-site/` and uploads `dist/` as a Pages artifact.

**Repo settings step (one-time):** in the GitHub repo's **Settings → Pages**, set **Source = "GitHub Actions"**. Without that the workflow runs successfully but no site goes live.

## Agent-friendly outputs

The `starlight-llms-txt` plugin generates three files at build time:

- `/llms.txt` — TOC + summary, suitable for context-limited agents
- `/llms-full.txt` — full corpus inlined
- `/llms-small.txt` — filtered subset

Plus every page is reachable as raw markdown by appending `.md` to the URL — Claude Code and other agents that send `Accept: text/markdown` get the source instead of the rendered HTML.

## Adding a new wiki page

1. Drop a new `.md` or `.mdx` file in `../docs/wiki/`.
2. Add an entry to the `sidebar` array in `astro.config.mjs`.
3. Local `npm run dev` to verify; the build will pick it up automatically.

## Editing the theme

Override Starlight's CSS variables in `src/styles/soma-theme.css`. The full variable list is in [Starlight's CSS-variables docs](https://starlight.astro.build/guides/css-and-tailwind/#css-variables).
