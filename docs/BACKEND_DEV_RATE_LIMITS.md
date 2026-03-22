# Fix HTTP 429 on login and API (backend)

The app only **displays** what the server returns. **`429 Too Many Requests`** means your **server** (or nginx, Cloudflare, etc.) is **rejecting** the request before your route handler runs.

## What to change (Node / Express example)

If you use **`express-rate-limit`** (or similar) **globally**, it often counts **every** request — including **`POST /api/auth/login`**. After a few tries (or parallel clients), login returns **429**.

### Option A — Skip auth routes from the global limiter (recommended for dev)

```js
import rateLimit from 'express-rate-limit';

const isDev = process.env.NODE_ENV !== 'production';

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 2000 : 100, // high in dev, stricter in prod
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply AFTER auth routes, OR use skip:
const limitUnlessAuth = rateLimit({
  windowMs: 60 * 1000,
  max: isDev ? 500 : 60,
  skip: (req) =>
    req.path.startsWith('/api/auth/') ||
    req.path.startsWith('/auth/'),
});

app.use('/api', limitUnlessAuth);
```

### Option B — Separate limiter for login (stricter on failures only)

Use a **low** limit for failed logins only (e.g. after invalid password), not for every attempt — or use **429** only after many failures from the same IP.

### Option C — Disable rate limiting in development

```js
if (process.env.NODE_ENV === 'production') {
  app.use('/api', apiLimiter);
}
```

## Checklist

1. Search the backend for: `rateLimit`, `429`, `too many`, `express-rate-limit`, `slowDown`.
2. Ensure **`POST .../auth/login`** and **`POST .../auth/register`** are not behind a **strict** global limit in **development**.
3. Restart the API server after changing middleware.
4. If you use **nginx** / **API gateway**, check their rate-limit rules too.

## After fixing

- Wait **1–2 minutes** if you’re already blocked (some limiters use a sliding window).
- Try login again from the app.
