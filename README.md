# Matrix

A responsive learning superapp inspired by Thea's study workflow, with a distinct Matrix identity.

The canonical independent deployment is [Matrix](https://matrix-study.barri857.workers.dev). It runs in the owner's Cloudflare account and uses Matrix accounts, with no ChatGPT account or subscription requirement. See [INDEPENDENT.md](INDEPENDENT.md) for standalone build, migration, deployment, Google sign-in, and full workspace-transfer instructions. The unqualified commands below describe the retained legacy Sites build.

## Included
- AI study kits from pasted notes, PDF, DOCX, text, captions, or a described topic
- Six bring-your-own-key providers: OpenAI, Anthropic, Gemini, OpenRouter, Groq, and DeepSeek
- Editable Markdown guides, summaries, read-aloud, flashcards with spaced review, practice questions, timed tests, and contextual AI tutoring
- Course and exam hub, planner, notebook, bookmarks, grade calculator, and focus timer
- Onyx, Light, Amber, Iris, and Emerald themes with independent accents
- Public guest access, optional ChatGPT sign-in, owner-scoped cloud storage, and revocable shared study kits
- Kit import and export, responsive mobile navigation, and home-screen web-app metadata

## Local development
Requires Node 22.13+.

1. `npm ci`
2. `npm run build`
3. Apply the SQL migration in `drizzle/` to the local D1 binding using Wrangler and `dist/server/wrangler.json`.
4. `npm run dev`

The starter provides local-only simulated sign-in on loopback. Hosted sign-in is owned by Sites.

## Checks
- `npx tsc --noEmit`
- `node --experimental-strip-types --test scripts/study.test.mjs scripts/workspace.test.mjs tests/ai.test.mjs tests/library.test.mjs`
- `npm run build`

## Privacy and boundaries
API keys are supplied by each visitor. They are held in session storage by default, with an explicit device-storage option. Keys are never stored in D1 or included in exported/shared kits. The server forwards each request to a fixed provider endpoint and returns redacted errors. No live provider key is bundled.

Signed-in kits and module records are stored in D1 with owner checks. Guests use local browser storage. Sharing explicitly publishes a kit's source and generated study content through an unguessable, revocable link; personal review history is omitted.

PDFs must contain extractable text; scanned PDFs need OCR first. Video study uses pasted or uploaded transcripts. AI outputs need review against source material. Provider model IDs are editable and model availability depends on the visitor's account. There are no shared platform AI credits or billing subscriptions.

Course practice variants remix the available question bank; they do not promise unique questions when the bank is small. Local focus and daily-review counters are device-specific. Hosted storage is last-write-wins per record/workspace, not collaborative simultaneous editing.

## Hosting
`.openai/hosting.json` identifies the Matrix Site and declares the D1 binding. Keep the same Site identity when publishing updates. The source is built with Vinext, React and Cloudflare Workers using the bundled Sites integration.
