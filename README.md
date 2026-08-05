# Burger Club 🍔

A private ratings map for your burger club. Friends log in, you (the admin)
add places, everyone rates and comments, and it all shows up on a map —
hover a pin to see who ate there and what they scored it.

Hosting is free (GitHub Pages) and the backend is free (Firebase's Spark
plan, which comfortably covers a friend-group-sized app).

---

## 1. Create your Firebase project (~5 min)

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project** → name it (e.g. `burger-club`) → skip Google Analytics if you want, it's not needed.
2. In the left sidebar: **Build → Authentication → Get started → Sign-in method → Email/Password → Enable**.
3. **Build → Firestore Database → Create database** → start in **production mode** → pick any region close to you.
4. Once created, go to the **Rules** tab and paste in the contents of `firestore.rules` from this project (edit the email in it first — see below). Click **Publish**.
5. Go to **Project settings** (gear icon) → scroll to **Your apps** → click the **</>** (web) icon → register an app (any nickname) → you don't need Firebase Hosting, just copy the `firebaseConfig` object it shows you.

## 2. Wire up the config

Open `js/firebase-config.js` and:
- Paste your real values into `firebaseConfig`.
- Put your own email (and any co-admins) in `ADMIN_EMAILS`.

Open `firestore.rules` and put the **same** email(s) into the `isAdmin()` list.
Re-publish the rules in the Firebase console after editing.

> Nothing in `firebase-config.js` is secret — it just tells the app which
> Firebase project to talk to. The actual access control lives in
> `firestore.rules`, which only lets your admin email(s) write to
> `restaurants`, and only lets each person write their own review.

## 3. Add your friends as users

There's intentionally no public sign-up page (so randoms can't join). Instead:

1. Firebase console → **Authentication → Users → Add user**.
2. Enter each friend's email and a temporary password.
3. Send them their login. They can log in as-is — there's no "change password"
   flow built in, so pick something they're fine using, or add one later if
   you want.

## 4. Run it locally to test (optional)

You can just open `index.html` in a browser, but ES module imports work
better served over http. Easiest way:

```bash
cd burger-club
python3 -m http.server 8000
# visit http://localhost:8000
```

## 5. Put it on GitHub Pages (free hosting)

1. Create a new **public** repo on GitHub (private repos need a paid plan for
   Pages on personal accounts).
2. Push this folder's contents to it:
   ```bash
   cd burger-club
   git init
   git add .
   git commit -m "Burger club v1"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Source → Deploy from a branch → `main` / `/ (root)`** → Save.
4. Give it a minute — your site will be live at
   `https://YOUR_USERNAME.github.io/YOUR_REPO/`.

You're set. Log in as admin, click **+ Add a place**, type in an address
(it geocodes automatically via OpenStreetMap), and it'll drop a pin.
Everyone else logs in, clicks a pin or a card in the sidebar, and leaves
their rating.

---

## How it's built

- **Hosting**: static files on GitHub Pages — no server to maintain.
- **Auth**: Firebase Authentication, email/password, accounts created by you.
- **Database**: Firestore, two collections:
  - `restaurants` — the places (name, address, lat/lng, who added it)
  - `reviews` — one doc per person per place, id'd as `{restaurantId}_{uid}`
    so re-rating a place just overwrites your own review.
- **Map**: Leaflet.js + OpenStreetMap tiles — free, no API key or billing
  account required (unlike Google Maps).
- **Geocoding**: OpenStreetMap's Nominatim API turns the address you type
  into map coordinates automatically.

## Extending it later

- Want photo uploads per review? Add Firebase Storage (also free tier) and
  an `<input type="file">` in the review form.
- Want a leaderboard of top-rated burgers or most active reviewer? That's a
  straightforward addition to `app.js` — the data's already there in
  `restaurants` and `reviews`.
- Want friends to self-serve password resets? Add a "Forgot password" link
  using Firebase's `sendPasswordResetEmail`.
