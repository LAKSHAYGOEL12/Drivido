# Chat API – Backend spec

Chat is stored on the backend so it survives app reinstall and device changes. The app calls these endpoints (with `Authorization: Bearer <token>`).

---

## What needs to be implemented (summary)

| Command / step | What to do |
|----------------|------------|
| **1. Mount chat routes** | In your Express app: `app.use('/api/chat', authMiddleware, chatRoutes)` |
| **2. GET /api/chat/conversations** | Return list of conversations for `req.user.id` (threadKey, ride, otherUserId, otherUserName, lastMessage, lastMessageAt, lastMessageSenderId, unreadCount). Optional: `deletedFor: string[]` — user ids who removed the thread; app hides those rows for that user. Sort by **last activity** (e.g. `lastMessageAt` desc) on the server if possible; app also sorts client-side. |
| **3. GET /api/chat/messages?rideId=&otherUserId=** | Compute `threadKey = [rideId, req.user.id, otherUserId].sort().join('|')`, return `{ messages }` for that thread (oldest first) |
| **4. POST /api/chat/messages** | Body: `{ rideId, otherUserId, text }`. Create/update conversation, insert message, return created message `{ id, text, sentAt, senderUserId, status }` |

**Commands to run your backend** (from your backend project folder):

```bash
cd path/to/your/backend
npm install
node server.js
# or: npm run dev
```

Server must listen on the same host/port as in the app’s `EXPO_PUBLIC_API_URL` in `.env` (single source: `src/config/apiBaseUrl.ts`). If these chat endpoints return 404, the app still works with local-only chat; once implemented, inbox and messages load from the server.

---

## 1. List conversations (Inbox)

**GET** `/api/chat/conversations`

**Response** (200):

```json
{
  "conversations": [
    {
      "threadKey": "ride123|userA|userB",
      "ride": { "id": "ride123", "from": "...", "to": "...", "scheduledAt": "...", ... },
      "otherUserId": "userB",
      "otherUserName": "Shivam",
      "lastMessage": "See you at 5",
      "lastMessageAt": 1710000000000,
      "lastMessageSenderId": "userA",
      "unreadCount": 2,
      "deletedFor": []
    }
  ]
}
```

- Optional **`deleted` / soft-delete**: include `deletedFor: ["userId"]` for users who cleared the thread from their inbox; omit the conversation for that user or return with `deletedFor` and let the app filter.

### Soft-delete must not affect messages for the other user

- **`GET /api/chat/messages`** must return the **full** message history for the thread. Do **not** filter out messages because the **sender** appears in `deletedFor` (inbox hide is per-user, not “delete my messages for everyone”).
- **`DELETE` inbox** should only update thread metadata (`deletedFor` / `hiddenForUserIds`), **never** delete `Message` documents for that action.

### Recipient must see the thread again when the other person sends

- If User A hid the thread (`deletedFor` contains A), **`GET /conversations` for A** will not return it until A is removed from `deletedFor`.
- On **`POST /api/chat/messages`**, when **User B** sends a message, the backend should **remove the recipient (A) from `deletedFor`** (and legacy hidden list) so the conversation **reappears in A’s inbox**. Removing only the **sender** from `deletedFor` is not enough when **B** writes after **A** deleted.
- `threadKey`: deterministic key = `[rideId, userId1, userId2].sort().join('|')`
- `ride`: same shape as `RideListItem` (id, from, to, scheduledAt, etc.)
- `otherUserId` / `otherUserName`: the other participant (from current user’s perspective)
- `unreadCount`: messages in this thread not yet read by current user

---

## 2. Get messages for a thread

**GET** `/api/chat/messages?rideId=ride123&otherUserId=userB`

**Response** (200):

```json
{
  "messages": [
    {
      "id": "msg_abc",
      "text": "Hi",
      "sentAt": 1709900000000,
      "senderUserId": "userA",
      "status": "delivered"
    }
  ]
}
```

- Order: oldest first (or document that order; app can sort by `sentAt`).
- `senderUserId`: so the app can set `isFromMe = (senderUserId === currentUser.id)`.

---

## 3. Send a message

**POST** `/api/chat/messages`

**Body:**

```json
{
  "rideId": "ride123",
  "otherUserId": "userB",
  "text": "See you at 5"
}
```

**Response** (201):

```json
{
  "id": "msg_xyz",
  "text": "See you at 5",
  "sentAt": 1710000000000,
  "senderUserId": "currentUserId",
  "status": "sent"
}
```

- Backend creates the message, stores it in the thread identified by `threadKey(rideId, currentUser.id, otherUserId)`.
- Return the created message so the app can show it immediately.

### Chat closed after ride completion (enforcement)

- The app treats messaging as **read-only** when the ride is **completed** and more than **2 hours** have passed since **`completedAt`** (or, if `completedAt` is missing, since the ride’s scheduled departure — client fallback).
- Include on each ride in conversation payloads: **`status`** (e.g. `completed`) and preferably **`completedAt`** (ISO 8601).
- **Recommended:** `POST /api/chat/messages` returns **403** with a clear error if the ride is completed and outside the 2-hour window, and the same for **cancelled** rides if you disallow messaging entirely.

### Inbox delete UI

- The app **does not** call `DELETE /chat/conversations` from the UI; threads stay listed unless your API omits them for other reasons.

---

## Backend implementation (Node + Express + MongoDB)

### 1. Model (e.g. `models/ChatMessage.js` or `models/Conversation.js`)

**Option A – One collection per thread (e.g. `chat_threads`):**

- `threadKey` (string, unique index)
- `ride` (object – ride snapshot)
- `participantIds` [string]
- `participantNames` { [userId]: string }
- `lastMessage`, `lastMessageAt`, `lastMessageSenderId`
- `messages` array: `{ id, text, sentAt, senderUserId, status }`
- `unreadFor` { [userId]: number }

**Option B – Two collections (recommended for scaling):**

**`conversations`** (one doc per thread):

- `threadKey` (string, unique)
- `ride` (object)
- `participantIds` [string]
- `participantNames` { [userId]: string }
- `lastMessage`, `lastMessageAt`, `lastMessageSenderId`
- `unreadFor` { [userId]: number }

**`chat_messages`**:

- `threadKey` (string, index)
- `id` (string, unique) or use `_id`
- `text`, `sentAt`, `senderUserId`, `status`

---

### 2. Routes (pseudo-code)

```js
// GET /api/chat/conversations
// - Get current user id from req.user (set by auth middleware)
// - Find all conversations where participantIds includes currentUser
// - Return list with otherUser, lastMessage, lastMessageAt, unreadCount

// GET /api/chat/messages?rideId=&otherUserId=
// - threadKey = [rideId, currentUser.id, otherUserId].sort().join('|')
// - Find messages for threadKey, sort by sentAt ascending
// - Return { messages }

// POST /api/chat/messages  body: { rideId, otherUserId, text }
// - threadKey = [rideId, currentUser.id, otherUserId].sort().join('|')
// - Upsert conversation (create if not exists) with ride snapshot, participant names
// - Insert message: id, text, sentAt: Date.now(), senderUserId: currentUser.id, status: 'sent'
// - Update conversation: lastMessage, lastMessageAt, lastMessageSenderId; increment unreadFor[otherUserId]
// - Return created message
```

---

### 3. Commands to add these to your backend

If your backend is in the same repo (e.g. `backend/` or `server/`):

```bash
# From project root, if backend is in ./backend
cd backend
npm install   # if needed
# Add the routes and model as above, then:
node server.js   # or: npm run dev
```

If the backend is a separate repo, add a new file e.g. `routes/chat.js` and mount it:

```js
// In your main app (e.g. server.js or app.js)
const chatRoutes = require('./routes/chat');
app.use('/api/chat', authMiddleware, chatRoutes);
```

---

### 4. Mark as read (**required for cross-device unread**)

**POST** `/api/chat/conversations/read`

**Body:** `{ "rideId": "ride123", "otherUserId": "userB" }`

- Set `unreadFor[currentUserId] = 0` for that thread (and persist so **GET /chat/conversations** returns `unreadCount: 0`).

The app calls this when the user opens a thread or marks all read, and **trusts** `unreadCount` from **GET /chat/conversations** when merging — so reading on one device clears the badge on others after the next inbox fetch.
