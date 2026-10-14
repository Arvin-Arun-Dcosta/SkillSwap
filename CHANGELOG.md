# Changelog

## 2.0.0 (2026-10-11)

A full rebuild of the 1.0 prototype.

### Security

- Removed the hard-coded fallback JWT secret; production refuses to start without a strong `JWT_SECRET`.
- Demo sign-in works only in demo mode and only for seeded demo accounts; it is off in production by
  default.
- Sessions use a signed `httpOnly`, `SameSite=Lax` cookie with server-side revocation instead of a token in
  `localStorage`; changing a password or being suspended signs other devices out.
- Every socket is authenticated from the session cookie; only a session's two participants can join its
  room, and identities are never taken from client payloads.
- Sessions, contracts, exchanges, files and notifications are only readable and writable by their members;
  everyone else gets a 404.
- Code from the shared editor runs in an opaque-origin sandbox without network access and with a timeout,
  never in the app's own origin.
- Shared files are stored privately under random names, restricted to an allow-list that excludes HTML and
  SVG, and served only to participants as downloads.
- Input is validated on the server with schemas shared with the client; search text is matched literally.
  Profile updates use a strict whitelist, so ratings and roles cannot be set by members.
- Public profiles no longer include email, role or status.
- Rate limiting on sign-in, the API and uploads; origin checks on state-changing requests; a strict
  Content-Security-Policy and related headers.
- One error format that never exposes internal messages or stack traces.

### Fixed

- Ending a session no longer crashes the app.
- Counter-offers: the other member decides, and the countered terms are applied.
- Sessions can be scheduled for the whole contract, not just the first one.
- A session completes once, counts once towards its contract, and can be reviewed once per member; ratings
  are recomputed from stored reviews.
- All fabricated numbers are gone: default ratings, reliability, streaks, "mastery" bars, fake admin charts
  and invented fallbacks. New members show "No reviews yet".
- Video calls no longer reconnect when the camera becomes available, and early ICE candidates are not
  dropped; either side can renegotiate.
- Code, notes and the whiteboard are saved automatically, merged without losing concurrent edits, and
  restored for late joiners.
- The whiteboard draws where you point at any size and works with touch and pen.
- Mobile layouts no longer overflow; the learning room is usable on a phone.
- Onboarding no longer pre-fills someone else's skills.
- Discover ranks before paginating, offers every weekday, and shows no invented score to visitors.
- Presence reflects real connections. Unknown URLs return a real 404.

### Added

- Reporting a member from their profile, with a working moderation queue.
- Settings page (profile, skills, availability, password) separate from onboarding.
- Ending a contract early; cancelling a scheduled session; withdrawing an offer.
- Light and dark themes; a design system with accessible components; WCAG 2.2 AA checks in CI.
- Real-time notifications; unread counts; toasts for confirmations and errors.
- Structured logging with request ids; liveness and readiness health checks; graceful shutdown.
- `robots.txt`, sitemap, Open Graph tags, structured data, per-profile link previews.
- Zero-configuration development mode with an in-memory database and demo data.
- Optional public demo in production: `SEED_DEMO_DATA` seeds an empty database and `DEMO_RESET_HOURS`
  re-seeds it on a schedule; demo accounts cannot change their shared password.
- Brotli and gzip copies of client assets built ahead of time, and a preload for the UI font.
- Idempotent migration script for 1.x databases.
- Tests: 224 unit and integration tests, 27 end-to-end tests including a two-browser call.
- TypeScript (strict) everywhere, ESLint, Prettier, pre-commit hooks, CI workflow, Dockerfile.

### Changed

- Monorepo with npm workspaces: `shared`, `server`, `client`, `e2e`.
- Express 4 → 5, Mongoose 8 → 9, React 18 → 19, Vite 6 → 8, Tailwind 3 → 4, React Router 6 → 7.
- Monaco editor → CodeMirror 6 (smaller, works on touch devices, no third-party CDN).
- Match scores no longer have a floor: a dimension with nothing in common scores zero.
- Accepting an exchange creates a contract but no automatic session.
- The API changed throughout.

### Removed

- Unauthenticated skill creation; the public `/uploads` folder; the fake multi-language code runner
 ; testimonials and unsupported marketing claims.
- Dependencies: axios, recharts, `@monaco-editor/react`, canvas-confetti, morgan, cors, dotenv, nodemon.
- Hot-linked stock photos and Google Fonts; fonts are self-hosted.

## 1.0.0

Initial prototype.
