# Hanzi AI

Hanzi AI is a modern Chinese learning platform designed for HSK learners. It combines vocabulary study, reading, listening, grammar, exercises, exams, AI tutoring, progress tracking, subscriptions, and a companion Expo mobile app that can share the same Supabase backend as the web platform.

## Live Demo

https://hanzhi-ai.vercel.app

## GitHub Repository

https://github.com/saadsaleme/hanzi-ai

## Features

- Supabase authentication with shared web and mobile user accounts
- HSK vocabulary, flashcards, grammar, reading, listening, exercises, and exams
- AI Tutor experience for guided practice
- Progress, XP, tokens, dashboard analytics, and learning activity tracking
- Subscription and plan screens
- Admin dashboard support for platform data
- Interactive reading and listening experiences
- Mobile Expo app in `mobile/` for iOS and Android development
- Dark premium Hanzi AI visual design

## Tech Stack

- React
- Vite
- JavaScript
- Supabase Auth and Database
- Vercel
- Expo
- React Native
- React Navigation
- Expo Speech

## Web Setup

Install dependencies from the project root:

```bash
npm install
```

Create a root `.env` file:

```bash
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

Run the web app locally:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

## Mobile App Setup

The mobile app lives in the separate `mobile/` folder and does not replace the web app.

Install mobile dependencies:

```bash
cd mobile
npm install
```

Create `mobile/.env`:

```bash
EXPO_PUBLIC_SUPABASE_URL=your_supabase_project_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

Start the Expo app:

```bash
npm start
```

For local network mode:

```bash
npm run start:lan
```

For mobile data or different networks:

```bash
npm run start:mobile-data
```

## Environment Variables

Do not commit real secrets or private keys.

Root web app:

```bash
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

Mobile app:

```bash
EXPO_PUBLIC_SUPABASE_URL=your_supabase_project_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

Server-only variables, when used:

```bash
OPENAI_API_KEY=your_server_only_openai_key
```

Never expose server-only keys with `VITE_` or `EXPO_PUBLIC_` prefixes.

## Project Structure

```text
.
├── api/                  # Serverless API routes
├── data/                 # Learning content and structured datasets
├── dist/                 # Web production build output
├── mobile/               # Expo React Native mobile app
│   ├── App.js
│   ├── app.json
│   ├── package.json
│   └── src/
├── src/                  # Web app source code
│   ├── HanZiApp.jsx
│   └── main.jsx
├── index.html
├── package.json
├── vite.config.js
└── README.md
```

## Contribution

Contributions are welcome. Please keep changes focused, avoid committing secrets, and test web or mobile flows before opening a pull request.

Recommended workflow:

```bash
git checkout -b feature/your-feature-name
npm install
npm run build
git commit -m "Describe your change"
git push origin feature/your-feature-name
```

## Contact

Project owner: Saad Saleme

GitHub: https://github.com/saadsaleme

Repository: https://github.com/saadsaleme/hanzi-ai
