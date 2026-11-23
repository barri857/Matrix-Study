# Matrix Study

Matrix is a study workspace for organizing course materials, reviewing flashcards, and preparing for exams.

Use [Matrix on the web](https://matrix-study.barri-nq.workers.dev). [Independent deployment](INDEPENDENT.md) covers setup, database migrations, Google sign-in, and workspace transfers.

## Included
- Study kits from notes, PDFs, Word and PowerPoint files, images, Markdown, captions, or a topic
- Browser-local PDF text extraction, with visual reading for scans, diagrams, and slides
- Multi-file drag and drop, per-file removal, Clear all, cancellation and resumable visual reading
- Six bring-your-own-key providers: OpenAI, Anthropic, Gemini, OpenRouter, Groq, and DeepSeek
- Editable Markdown guides, summaries, read-aloud, flashcards with spaced review, practice questions, timed tests, and contextual AI tutoring
- Course and exam hub with separate Midterm, Endterm, Final, and named Custom plans; planner, notebook, bookmarks, grade calculator, and custom focus timer
- English, Russian and Kazakh interface; saved page/kit navigation; collapsible sidebar
- Onyx, Dark, Light, Amber, Iris, and Emerald themes with independent accents
- Guest access, Google and email sign-in, private cloud workspaces, and revocable study kit links
- Kit import and export, responsive mobile navigation, and home-screen web-app metadata

## Local development
Requires Node 22.13+.

1. `npm ci`
2. `npm run build`
3. Apply the SQL migration in `drizzle/` to the local D1 binding using Wrangler and `dist/server/wrangler.json`.
4. `npm run dev`

Local development provides simulated sign-in on loopback. For independent accounts, follow the setup in [INDEPENDENT.md](INDEPENDENT.md).

## Checks
- `npx tsc --noEmit`
- `node --experimental-strip-types --test scripts/study.test.mjs scripts/workspace.test.mjs tests/ai.test.mjs tests/library.test.mjs`
- `npm run build`

## Privacy and boundaries
API keys are supplied by each visitor. They are held in session storage by default, with an explicit device-storage option. Keys are never stored in D1 or included in exported/shared kits. The server forwards each request to a fixed provider endpoint and returns redacted errors. No live provider key is bundled.

Signed-in kits and module records are stored in D1 with owner checks. Guests use local browser storage. Sharing explicitly publishes a kit's source and generated study content through an unguessable, revocable link; personal review history is omitted.

Matrix extracts selectable text from supported PDF pages in the browser. Visual reading uses the provider you connect. Scanned PDF pages are sent in groups of up to three, and blank pages are skipped. Original files and rendered page images stay out of the saved kit and export. Uploads support 20 files, 12 MB per file, and 200 pages or slides per document. Long material is saved as numbered kits.

The provider you connect handles visual reading, study guide generation, and tutor requests. Its usage and billing rules apply.

Course practice variants remix the available question bank; they do not promise unique questions when the bank is small. Local focus and daily-review counters are device-specific. Hosted storage is last-write-wins per record/workspace, not collaborative simultaneous editing.

## Hosting
Matrix uses React, Vinext, and Cloudflare Workers with D1. The Cloudflare deployment and local setup are documented in [INDEPENDENT.md](INDEPENDENT.md).
