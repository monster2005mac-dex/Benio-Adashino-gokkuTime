// ════════════════════════════════════════════════════════════════════
// 🔥 FIREBASE CONFIGURATION — PASTE YOUR FIREBASE DETAILS HERE
// ════════════════════════════════════════════════════════════════════
// This is THE place for your Firebase details. Steps:
//   1. Go to https://console.firebase.google.com/
//   2. Create a project (or open an existing one)
//   3. Add app → Web (</> icon) → copy the firebaseConfig values
//   4. In Firebase Console enable Firestore:
//      Build → Firestore Database → Create database → Start in test mode
//   5. Replace the "YOUR_..." values below and save this file.
//   6. The header pill flips from 💾 Local to 🔥 Cloud and your tasks,
//      heroine choice and XP sync to Firestore in real time.
//
// (The Groq API key does NOT go here — it lives in /app/backend/.env
//  as GROQ_API_KEY=gsk_... — see README note in that file's section.)
// ════════════════════════════════════════════════════════════════════

export const KUOHFLOW_FIREBASE_CONFIG = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY || "YOUR_API_KEY",
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN || "YOUR_AUTH_DOMAIN",
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID || "YOUR_PROJECT_ID",
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || "YOUR_STORAGE_BUCKET",
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID || "YOUR_MESSAGING_SENDER_ID",
  appId: process.env.REACT_APP_FIREBASE_APP_ID || "YOUR_APP_ID",
  measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID || "G-ZEP7313V76"
};

export const isFirebaseConfigured = () => {
  const c = KUOHFLOW_FIREBASE_CONFIG;
  return Boolean(c && c.apiKey && !c.apiKey.startsWith("YOUR_"));
};