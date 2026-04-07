# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start       # Run production server (node server.js)
npm run dev     # Run development server with auto-reload (nodemon server.js)
```

No test suite is currently configured.

## Architecture

**YardlineIQ** is an NFL picks/analytics platform — a Node.js/Express backend serving static HTML frontend pages. Deployed on Vercel.

### Key Files

- `server.js` — Single-file Express server containing all active API logic, middleware, and route handlers
- `public/` — Static frontend: vanilla JS, no framework; Stripe.js for payments, Google Analytics
- `vercel.json` — Deployment config: builds server.js, serves `public/` as static, falls back to server.js

### Data Storage (Dual Pattern — Important)

There are two data layers that are **not integrated with each other**:

1. **Redis** (active, used in `server.js`): Stores email signups, customer records, and picks. All keys use `email:{email}`, `customer:{email}`, `pick:{id}` prefixes with sets `all_emails`, `all_customers`, `all_picks` for enumeration.

2. **MongoDB/Mongoose** (defined but inactive): `models/` and `routes/` directories exist with Mongoose-based implementations, but **these route files are never imported into server.js**. Any changes to `routes/auth.js`, `routes/picks.js`, etc. have no effect unless they are mounted in server.js.

### Authentication

- **Admin**: Bearer token check against env var or hardcoded fallback — look at server.js for current implementation
- **Members**: Email-based login, customer record looked up from Redis
- JWT is used in `routes/auth.js` but that file is not active

### API Endpoints (all in server.js)

```
POST /api/admin/login
POST /api/email/free-pick
POST /api/payments/create-payment-intent
POST /api/payments/payment-success
GET  /api/payments/customers        (admin)
POST /api/member/login
POST /api/picks                     (admin)
GET  /api/picks
GET  /api/admin/stats               (admin)
GET  /api/users                     (admin)
GET  /api/export/users              (admin CSV)
GET  /api/export/emails             (admin CSV)
```

### Required Environment Variables

| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe API key |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | JWT signing secret |
| `PORT` | Server port (defaults to 3000) |

## Brand & Business Context
YardlineIQ sells NFL ATS picks and analytics to serious sports bettors.
Trust and credibility are everything — performance transparency is a core value.
Target user is a serious bettor, not a casual fan. Avoid anything gimmicky or 
that makes exaggerated promises.

## Design Preferences
- Dark theme with bold, sharp sports analytics aesthetic
- Clean and modern — data-driven feel, not a typical "sports picks" site
- Mobile responsiveness is a priority
- [Add your specific colors/fonts here if you have them]

## Current Priorities
[Update this section at the start of each work session]
- Example: Improve homepage design and mobile responsiveness

## Things to Never Change Without Asking
- Stripe payment flows and webhook logic
- Redis data layer and key structure
- Any active authentication logic in server.js
- Environment variable references