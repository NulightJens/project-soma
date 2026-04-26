/**
 * Astro content collection — pulls markdown directly from ../docs/wiki/.
 *
 * No duplication: docs/wiki/*.md remains the canonical source-of-truth.
 * Starlight reads from this collection and renders each .md as a route.
 *
 * We use Astro's raw `glob` loader rather than Starlight's `docsLoader`
 * because the latter hardcodes its base directory to `src/content/docs/`
 * (see node_modules/@astrojs/starlight/loaders.ts). The Starlight schema
 * still applies via `docsSchema()`, so the collection behaves identically
 * for sidebar/navigation/frontmatter purposes.
 *
 * Pattern explicitly excludes README.md — that file is the GitHub-facing
 * TOC and would shadow our Starlight splash (index.mdx).
 */

import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

export const collections = {
  docs: defineCollection({
    loader: glob({
      pattern: ['**/[^_]*.{md,mdx}', '!README.md'],
      base: '../docs/wiki',
    }),
    schema: docsSchema(),
  }),
};
