import { KUOHFLOW_FIREBASE_CONFIG, isFirebaseConfigured } from "./firebaseConfig";

// Optional Firebase cloud-sync layer (compat SDK loaded lazily only when configured).
let ready = false;
let db = null;
let userId = null;

const SCRIPTS = [
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js",
];

const loadScript = (src) =>
  new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(s);
  });

export const initFirebase = async () => {
  if (ready) return true;
  if (!isFirebaseConfigured()) return false;
  try {
    for (const src of SCRIPTS) await loadScript(src);
    /* global firebase */
    firebase.initializeApp(KUOHFLOW_FIREBASE_CONFIG);
    db = firebase.firestore();
    ready = true;
    return true;
  } catch (e) {
    console.warn("KuohFlow Firebase init failed:", e.message);
    return false;
  }
};

export const getFirebaseAuth = async () => {
  const ok = await initFirebase();
  return ok ? firebase.auth() : null;
};

export const getFirebaseIdToken = async () => {
  const auth = await getFirebaseAuth();
  return auth?.currentUser ? auth.currentUser.getIdToken() : "";
};

export const fbGetDoc = async (field) => {
  if (!ready || !firebase.auth().currentUser) return null;
  try {
    const uid = firebase.auth().currentUser.uid;
    const snap = await db.collection("kuohflow_users").doc(uid).get();
    if (!snap.exists) return null;
    return field ? (snap.data()[field] ?? null) : snap.data();
  } catch (e) {
    console.warn("Firebase read failed:", e.message);
    return null;
  }
};

export const fbSaveDoc = async (fields, targetUid) => {
  if (!ready || !firebase.auth().currentUser) return false;
  const uid = targetUid || firebase.auth().currentUser.uid;
  if (!uid) return false;
  try {
    await db.collection("kuohflow_users").doc(uid).set(fields, { merge: true });
    return true;
  } catch (e) {
    console.warn("Firebase write failed:", e.message);
    return false;
  }
};

export const fbListenDoc = (callback, targetUid) => {
  if (!ready || !firebase.auth().currentUser) return () => {};
  const uid = targetUid || firebase.auth().currentUser.uid;
  if (!uid) return () => {};
  return db.collection("kuohflow_users").doc(uid).onSnapshot(
    (snap) => {
      if (snap.exists) {
        callback(snap.data(), true, snap.metadata.fromCache);
      } else {
        callback(null, false, snap.metadata.fromCache);
      }
    },
    (e) => console.warn("Firebase listener error:", e.message)
  );
};