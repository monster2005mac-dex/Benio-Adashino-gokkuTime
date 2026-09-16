# Gokaku (合格) • Waifu Productivity Command Center

A high-performance anime productivity command center featuring day-wise timetable, Sacred Gear focus timer, Evil Piece ranked quests, and Occult Research Club anime companions (Rias, , Hana, Yukino) with audio soundscapes.

---

## 🚀 Ways to Run the Website

### 1. Instant / Standalone Website (Zero Setup)
`index.html` is the Firebase login page, and `signup.html` is the registration page.
- **Run locally**: Open `index.html` to sign in, then continue to `profile.html`.
- **Deploy**: Host `index.html` directly on GitHub Pages, Vercel, Netlify, Cloudflare Pages, or any static file server.
- **AI Chat**: Uses Groq API client-side. Click the ⚙ icon in the chat to paste your free Groq API key (from [console.groq.com](https://console.groq.com)).

---

### 2. React & Firebase Application

#### Prerequisites
- Node.js (v18+)
- Firebase project with Email/Password Authentication and Firestore enabled

#### Frontend Setup
```bash
cd frontend
npm install
npm start
```
The React development server will start at `http://localhost:3000`.

Before starting the frontend, replace the `YOUR_...` values in `frontend/.env` with the Firebase Web app configuration from Firebase Console. Enable **Authentication → Sign-in method → Email/Password**. The React app uses Firebase Authentication for registration, login, logout, and ID tokens.

Before starting the frontend, replace the `YOUR_...` values in `frontend/.env` with the Firebase Web app configuration from Firebase Console. Enable **Authentication → Sign-in method → Email/Password** and create a Firestore database. The React app uses Firebase Authentication and Firestore directly, so the `backend/` directory is not required for the core app.

---

## 📁 Project Structure

```
.
├── index.html        # Firebase login page
├── frontend/         # React web application source code
│   ├── public/       # Static assets (including waifu character graphics)
│   ├── src/          # React components, hooks, auth, and styling
│   └── package.json  # NPM dependencies and scripts
├── .gitignore        # Git ignore rules
└── README.md         # Project documentation
```
