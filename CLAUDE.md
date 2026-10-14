# Working in this repository

SkillSwap is a peer-to-peer skill exchange with real-time learning rooms. npm workspaces:
`shared` (zod schemas, constants, types), `server` (Express 5, Mongoose 9, Socket.IO, Yjs),
`client` (React 19, Vite 8, Tailwind 4), `e2e` (Playwright). README.md has the architecture overview.

## Commands

```bash
npm run dev            # API :5000 + client :5173; no config needed (in-memory MongoDB, demo data)
npm run check          # lint + format check + typecheck + unit/integration tests + build (what CI runs)
npm test               # Vitest in shared, server and client
npm run build && npm run e2e   # Playwright needs the build; it starts its own server on :5055
npx vitest run --root server test/exchanges.test.ts   # one server test file
npx vitest run --root client src/room/textSync.test.ts
npm run e2e -w e2e -- exchange-flow --project=desktop  # one e2e spec
npm run lint:fix && npm run format
```

A pre-commit hook runs ESLint and Prettier on staged files. Lint allows zero warnings.

## Conventions

**Shared contract**

- Every request body and query is defined once as a zod schema in `shared/src/schemas.ts` and used by
  the server (`parse(schema, req.body)`) and by client forms (`zodResolver(schema)`).
- Every API response shape is a type in `shared/src/types.ts`. Server code builds responses only through
  `server/src/serializers.ts`. Never send a Mongoose document to the client.
- The client imports from `@skillswap/shared`. The package is marked side-effect free except
  `schemas.ts`, so startup code must not import schemas (that would pull zod into the first bundle).

**Server**

- Layers: `routes/` (parse, call, respond) → `services/` (authorisation, rules, notifications) →
  `models/`. Keep rules out of routes.
- Throw `AppError` helpers from `lib/errors.ts` (`notFound`, `forbidden`, `conflict`, …). Anything else
  becomes a generic 500. Do not `res.status(500).json(err.message)`.
- Authorisation pattern: load the resource *for a member* (`loadSessionForParticipant`,
  `loadContractForParty`, `loadForParty`). Non-members get the same 404 as a missing id.
- State changes that must happen once use a conditional update
  (`findOneAndUpdate({ _id, status: 'ACTIVE' }, …)`), not read-then-write.
- Never trust identity from a request body or socket payload; use `req.user` / `socket.data.user`.
- User text that goes into a query as a pattern must pass through `escapeRegExp`.
- Ratings and counters are recomputed from source documents (`recomputeUserStats`), never incremented.
- New env vars go through `config/env.ts` (validated) and `.env.example`.

**Client**

- Use the components in `client/src/components/ui`; do not restyle raw elements per page. Colours are
  semantic tokens (`bg-surface`, `text-muted`, `bg-teach-bg`, …) defined in `styles/index.css` for both
  themes. If you add or change a token, `styles/tokens.test.ts` must still pass (WCAG contrast).
- Teal means "teaches", amber means "wants to learn", everywhere (`SkillChip`). Do not reuse them for
  unrelated meanings.
- Server state goes through TanStack Query. After a mutation, invalidate with
  `invalidateExchangeData(queryClient)` or the specific key. Show failures with `ErrorState`, `Notice` or
  a toast; never only `console.error`.
- Forms: react-hook-form + shared schema; map server field errors with `applyServerErrors`.
- Every data view needs loading (skeleton), empty and error states. Destructive or irreversible actions
  go through `ConfirmDialog`.
- Accessibility is tested: label every control (`Input`, `Select`, `IconButton label=…`), keep heading
  levels in order, keep touch targets at least 24 px (controls are 36–44 px), and do not convey meaning
  by colour alone.
- Do not show a number the server did not compute. No fallbacks like `value || 4.9`.

**Tests**

- A bug fix comes with a regression test. Server integration tests use `createTestApp()` and the helpers
  in `server/test/helpers.ts` (`signUp`, `tradingPair`, `acceptedContract`, `schedule`).
- E2E tests create their own members through the API (`createMember`) so they can run in parallel; only
  read-only tours use the seeded demo accounts.

## Gotchas

- **Lean queries and binary fields**: `.lean()` returns a BSON `Binary`, not a `Buffer`. Use `toBytes()`
  from `realtime/rooms.ts` when reading `Session.collabState`.
- **Content-Security-Policy** is strict (`script-src 'self'`, no inline scripts, no `data:` fonts):
  - Vite must not inline assets (`assetsInlineLimit: 0`).
  - zod runs with `jitless: true` because its eval probe is reported as a violation.
  - The theme bootstrap is the external file `client/public/theme-init.js`.
  - The code sandbox page `client/public/sandbox/runner.html` gets its own policy in `server/src/web.ts`.
- **Vite processes `<link href>` in `index.html`**: the canonical link is injected by the server instead.
- **Precompressed assets**: the client build (`productionAssets` in `vite.config.ts`) writes `.br` and `.gz`
  copies of hashed assets and injects the font preload; `web.ts` sends those copies before falling back
  to `express.static` + `compression`.
- **Demo data in production** is opt-in: `SEED_DEMO_DATA` seeds an empty database at startup and
  `DEMO_RESET_HOURS` wipes and re-seeds it on a schedule (`refreshDemoData` in `seed/demo.ts`). Demo
  accounts cannot change their shared password.
- **The in-memory development database** lives in a temporary directory of about 200 MB that is removed
  on a clean shutdown (Ctrl+C, SIGTERM). Killing the server with SIGKILL leaves `/tmp/mongo-mem-*`
  behind; delete those if `/tmp` fills up.
- **Chrome blocks some ports** (for example 5060/5061). Do not use them for local servers or tests.
- **`/api/auth/me`** answers 200 with `user: null` when signed out, on purpose (no console error for
  visitors). Protected endpoints answer 401.
- **Room state is in memory** on one process (`RoomStore`). Running several instances needs a Socket.IO
  adapter and shared document storage first.
- **The WebRTC hook** creates a new `RTCPeerConnection` each time both participants are present
  (`peerEpoch`). Signals that arrive before it exists are queued. Keep the polite/impolite roles.
- **Dialogs** are native `<dialog>` elements mounted only while open; `Dialog` restores focus itself.
- **Sessions only count when both members joined** (`joinedBy`). Tests that need a completed session call
  `markBothJoined()` or join through sockets.
- **Parallel shell commands that `cd`** have interfered with each other in this environment; prefer
  absolute paths or `npm --prefix` / `-w`.
- TypeScript is pinned to 6.0.x and ESLint to 9.x because the lint plugins do not support TypeScript 7 or
  ESLint 10 yet.

## Chart colours

Admin charts use `--chart-1` and `--chart-2`, validated for colour-blind separation against the card
surface in both themes. If you change them, re-validate (the dataviz skill's `validate_palette.js`) and
keep legends, direct labels and the table view.
