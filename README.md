# 🕹️ Brain Arcade

Tiny steps, big wins, good friends. An ADHD-friendly quest app for iPhone (it also works on Android and desktop), with **Quest Proof**: optional photo evidence you can share with one trusted friend, who can cheer you on.

- **Quests**: break a task into tiny steps. Every step earns coins, and doing *some* of a quest counts too.
- **Quest Proof 📸**: optional before and after photos, a comparison slider, crop and hide tools, and a caption. You send it to *one* friend you choose.
- **Friends 💛**: invite codes, a list of proofs waiting for you, approvals, reactions, comments, bonus coins, badges, kind questions, team challenges, and a leaderboard you can turn off.
- **Kind by design**: coins are never taken away. You never need a friend's approval to finish a quest, and there are no shame messages.

---

## Setup (about 15 minutes, one time only)

### 1. Create the Supabase project
1. Go to <https://supabase.com>, sign in, and click **New project**. The free tier is fine.
2. When it's ready, open **SQL Editor → New query**, paste in the whole of [`supabase/schema.sql`](supabase/schema.sql), and click **Run**.
   This creates the tables, the security rules, the private `quest-proof` photo bucket and the live-update settings.

### 2. Turn on sign-in with an emailed code
Brain Arcade uses a 6-digit email code instead of a magic link. On an iPhone, a magic link opens in Safari instead of the home-screen app, so codes work better.

1. **Authentication → Sign In / Providers → Email**: make sure Email is enabled.
2. **Authentication → Emails → Templates**: in both **Magic Link** and **Confirm signup**, add the code to the message, for example:
   ```html
   <h2>Your Brain Arcade code</h2>
   <p>Type this code into the app: <strong>{{ .Token }}</strong></p>
   ```
3. **Authentication → URL Configuration**: set **Site URL** to the address where you'll host the app (see step 4).
4. Supabase's built-in email sender only allows a few emails an hour. Before inviting real friends, add your own email sender under **Project Settings → Authentication → SMTP Settings**. Resend, Postmark and Brevo all have free tiers.

### 3. Connect the app
Open [`js/config.js`](js/config.js) and paste in your project details from **Project Settings → API**:
```js
export const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
export const SUPABASE_ANON_KEY = 'your anon / publishable key';
export const APP_URL = 'https://gabifav.github.io/brain-arcade/';
```
The anon key is meant to be public, because the security rules in the database protect the data. **Never** paste the `service_role` or secret key here.

### 4. Host it
Go to **GitHub → this repo → Settings → Pages**. Under **Build and deployment**, choose *Deploy from a branch*, then `main` and `/ (root)`. After a minute it's live at `https://gabifav.github.io/brain-arcade/`.

### 5. Install it on an iPhone
Open the address in **Safari**, tap **Share → Add to Home Screen**, then open Brain Arcade from the home screen.

---

## How privacy and security work

| Rule | How it's enforced |
|---|---|
| Photos stay on your phone until you share them | Before and after photos are kept in the phone's own storage (IndexedDB). They upload only when you press **Send**, and only the ones you ticked. |
| Hidden details really are hidden | Hiding paints solid blocks over the area, not a blur. Every photo is re-drawn before upload, which also strips hidden location (GPS) data. |
| Only the friend you chose can see a proof | Database rules (Row Level Security) only show a proof and its photos to the owner and that one friend, and only while you're still friends and nobody is blocked. |
| Photos are never public | The storage bucket is private. Each photo opens through a link that expires after an hour. Friends can only open files attached to a proof sent to them. |
| Invite codes can't be abused | You have to be signed in to use a code. Each code works once, expires after 7 days, and only creates the friendship. Wrong guesses are limited to 10 an hour. |
| Disconnecting or blocking is permanent for old proofs | It switches off the friend's access to everything you sent them, even if you reconnect later. |
| Coins can't be faked or lost | Only server functions can add coins. The app can't write them, and nothing ever subtracts them. Bonuses are capped at 25 per proof. |
| Approval is never required | Finishing a quest pays out straight away. A friend's question never removes coins. |
| You can delete things | You can delete a single photo, a whole submission, all your shared photos, or the photos saved on your phone. |

Security tests are in [`supabase/tests/`](supabase/tests). They run against Postgres with stand-ins for Supabase's sign-in and storage, and cover strangers, blocked users, reused codes, forged coins and more.

## Files
```
index.html            app shell (iPhone safe areas, home-screen app)
css/app.css           arcade styles
js/app.js             start-up, tabs, live sync, "QUEST VERIFIED!" celebration
js/api.js             every Supabase call
js/quests.js          Quests tab
js/proof.js           Quest Proof wizard, before/after slider, review/approve
js/photo-editor.js    crop / hide / rotate
js/photo-store.js     on-phone photo storage + image clean-up
js/friends.js         Friends dashboard, invites, challenges, leaderboard
js/me.js              coins, badges, settings, privacy controls
js/mascots.js         Bleep, Coinny, Zap and Pip
supabase/schema.sql   database, security rules, storage, functions
```
