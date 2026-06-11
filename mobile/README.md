# HanZi AI Mobile

Standalone Expo React Native app for HanZi AI. The website remains in the root project; this app lives only in `mobile/`.

## Environment

Create `mobile/.env` with the same Supabase project values used by the website:

```bash
EXPO_PUBLIC_SUPABASE_URL=your_supabase_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

Only the Supabase anon key belongs in the mobile app. Do not add service role keys or other secrets.

## Run

```bash
cd mobile
npm install
npm start
```

`npm start` uses Expo Tunnel mode by default, so Expo Go can open the app even when your phone is on mobile data, hotspot, or a different network.

You can also run the explicit mobile-data command:

```bash
npm run start:mobile-data
```

If you specifically want LAN mode, your phone and computer must be on the same reachable Wi-Fi/local network:

```bash
npm run start:lan
```

## Data Sync

The app uses Supabase Auth for the same user accounts as the website, and reads/writes shared profile, progress, subscription, and learning tables. Progress from mobile can appear on the website when both clients use the same Supabase tables.
