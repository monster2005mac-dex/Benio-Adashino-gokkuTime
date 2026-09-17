import React, { createContext, useContext, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Mail, Lock, User as UserIcon, Heart, Loader2, LogIn, UserPlus, Crown } from "lucide-react";
import { getFirebaseAuth, getFirebaseIdToken, initFirebase } from "./firebase";

export const getToken = () => getFirebaseIdToken();
const OWNER_PIN = process.env.REACT_APP_OWNER_PIN || "739184";
// This app is meant for a single owner. Set REACT_APP_OWNER_EMAIL in
// frontend/.env to your own login email and nobody else — even someone
// who has the PIN, or who registered an account before this was added —
// will be able to sign in or create a new account.
const OWNER_EMAIL = (process.env.REACT_APP_OWNER_EMAIL || "").trim().toLowerCase();
const isOwnerEmail = (email) => !OWNER_EMAIL || (email || "").trim().toLowerCase() === OWNER_EMAIL;
const PIN_SESSION_KEY = "gokaku_pin_verified";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    let unsubscribe = () => {};
    initFirebase().then(async (configured) => {
      if (!configured) {
        setAuthError("Firebase is not configured. Add the REACT_APP_FIREBASE_* values to frontend/.env.");
        setUser(false);
        return;
      }
      const auth = await getFirebaseAuth();
      unsubscribe = auth.onAuthStateChanged((firebaseUser) => {
        if (firebaseUser && !isOwnerEmail(firebaseUser.email)) {
          // A non-owner account (e.g. someone who registered before the
          // owner-email restriction was added, or who found the PIN).
          // Never grant access, and kick them out of the session.
          sessionStorage.removeItem(PIN_SESSION_KEY);
          auth.signOut();
          setAuthError("This app is private. Only the owner account may sign in.");
          setUser(false);
          return;
        }
        if (firebaseUser && sessionStorage.getItem(PIN_SESSION_KEY) === "1") {
          setUser({
            id: firebaseUser.uid,
            email: firebaseUser.email || "",
            name: firebaseUser.displayName || firebaseUser.email?.split("@")[0] || "",
            photoURL: firebaseUser.photoURL || "",
            emailVerified: Boolean(firebaseUser.emailVerified),
            providerData: firebaseUser.providerData || [],
            metadata: {
              creationTime: firebaseUser.metadata?.creationTime || null,
              lastSignInTime: firebaseUser.metadata?.lastSignInTime || null,
            },
          });
        } else {
          setUser(false);
        }
      });
    }).catch((error) => {
      setAuthError(error.message || "Firebase authentication could not start.");
      setUser(false);
    });
    return () => unsubscribe();
  }, []);

  const reloadUser = async () => {
    const auth = await getFirebaseAuth();
    if (auth && auth.currentUser) {
      await auth.currentUser.reload();
      const fbUser = auth.currentUser;
      setUser({
        id: fbUser.uid,
        email: fbUser.email || "",
        name: fbUser.displayName || fbUser.email?.split("@")[0] || "",
        photoURL: fbUser.photoURL || "",
        emailVerified: Boolean(fbUser.emailVerified),
        providerData: fbUser.providerData || [],
        metadata: {
          creationTime: fbUser.metadata?.creationTime || null,
          lastSignInTime: fbUser.metadata?.lastSignInTime || null,
        },
      });
    }
  };

  const sendVerificationEmail = async () => {
    const auth = await getFirebaseAuth();
    if (!auth || !auth.currentUser) throw new Error("No user is currently signed in.");
    await auth.currentUser.sendEmailVerification();
  };

  const login = async (email, password, pin) => {
    if (pin !== OWNER_PIN) throw new Error("Invalid owner PIN.");
    if (!isOwnerEmail(email)) throw new Error("This app is private. Only the owner account may sign in.");
    const auth = await getFirebaseAuth();
    if (!auth) throw new Error("Firebase is not configured.");
    sessionStorage.setItem(PIN_SESSION_KEY, "1");
    try {
      const result = await auth.signInWithEmailAndPassword(email.trim(), password);
      const fbUser = result.user;
      setUser({
        id: fbUser.uid,
        email: fbUser.email || "",
        name: fbUser.displayName || fbUser.email?.split("@")[0] || "",
        photoURL: fbUser.photoURL || "",
        emailVerified: Boolean(fbUser.emailVerified),
        providerData: fbUser.providerData || [],
        metadata: {
          creationTime: fbUser.metadata?.creationTime || null,
          lastSignInTime: fbUser.metadata?.lastSignInTime || null,
        },
      });
    } catch (error) {
      sessionStorage.removeItem(PIN_SESSION_KEY);
      throw error;
    }
  };

  const register = async (email, password, name, pin) => {
    if (pin !== OWNER_PIN) throw new Error("Invalid owner PIN.");
    if (!isOwnerEmail(email)) throw new Error("This app is private. Only the owner account may register.");
    const auth = await getFirebaseAuth();
    if (!auth) throw new Error("Firebase is not configured.");
    sessionStorage.setItem(PIN_SESSION_KEY, "1");
    try {
      const result = await auth.createUserWithEmailAndPassword(email.trim(), password);
      if (name.trim()) await result.user.updateProfile({ displayName: name.trim() });
      const fbUser = result.user;
      setUser({
        id: fbUser.uid,
        email: fbUser.email || "",
        name: name.trim() || fbUser.email?.split("@")[0] || "",
        photoURL: fbUser.photoURL || "",
        emailVerified: Boolean(fbUser.emailVerified),
        providerData: fbUser.providerData || [],
        metadata: {
          creationTime: fbUser.metadata?.creationTime || null,
          lastSignInTime: fbUser.metadata?.lastSignInTime || null,
        },
      });
    } catch (error) {
      sessionStorage.removeItem(PIN_SESSION_KEY);
      throw error;
    }
  };

  const updateProfileName = async (newName) => {
    const trimmed = (newName || "").trim();
    if (!trimmed) throw new Error("Display name cannot be empty.");
    const auth = await getFirebaseAuth();
    if (auth && auth.currentUser) {
      await auth.currentUser.updateProfile({ displayName: trimmed });
    }
    setUser((prev) => (prev ? { ...prev, name: trimmed } : prev));
  };

  const logout = async () => {
    sessionStorage.removeItem(PIN_SESSION_KEY);
    const auth = await getFirebaseAuth();
    if (auth) await auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, login, register, logout, updateProfileName, reloadUser, sendVerificationEmail, authError }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

export function Protected({ children }) {
  const { user, authError } = useAuth();
  if (user === null) return <div className="min-h-screen bg-[#080911] flex items-center justify-center" data-testid="auth-loading"><Loader2 className="w-8 h-8 text-rose-500 animate-spin" /></div>;
  if (user === false) return <div className="min-h-screen bg-[#080911] flex items-center justify-center p-4"><div className="text-center"><p className="text-sm text-slate-300 mb-3">{authError || "Please sign in to enter the Occult Research Club."}</p><Link to="/login" className="px-5 py-2.5 rounded-xl bg-rose-600 text-white text-xs font-black">Sign In</Link></div></div>;
  return children;
}

export function AuthPage() {
  const { user, login, register, authError } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (user) navigate("/", { replace: true }); }, [user, navigate]);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "login") await login(email, password, pin);
      else await register(email, password, name, pin);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.code === "auth/invalid-credential" ? "Invalid email or password." : err.message || "Something went wrong.");
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-[#080911] flex items-center justify-center p-4 relative overflow-hidden" data-testid="auth-page">
      <div className="magic-circle-bg"><div className="aura-blob a1" /><div className="aura-blob a2" /></div>
      <div className="clean-card modal-pop w-full max-w-sm p-7 bg-[#121424]/95 border border-rose-500/50 shadow-2xl relative z-10">
        <div className="text-center mb-5"><span className="text-2xl font-black brand-gradient-text" style={{ fontFamily: "Cinzel, serif" }}>Gokaku 合格</span><p className="text-[11px] text-slate-400 mt-1 flex items-center justify-center gap-1"><Heart className="w-3 h-3 text-rose-500 fill-rose-500" />{mode === "login" ? "Welcome back, darling." : "Join the Gremory peerage."}</p></div>
        <div className="flex gap-1 mb-5 p-1 bg-[#0a0b14] rounded-xl border border-slate-800">
          <button type="button" onClick={() => { setMode("login"); setError(""); }} data-testid="auth-tab-login" className={`flex-1 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider ${mode === "login" ? "bg-rose-600 text-white" : "text-slate-400"}`}>Sign In</button>
          <button type="button" onClick={() => { setMode("register"); setError(""); }} data-testid="auth-tab-register" className={`flex-1 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider ${mode === "register" ? "bg-rose-600 text-white" : "text-slate-400"}`}>Create Account</button>
        </div>
        <form onSubmit={submit} className="space-y-3.5 text-xs" data-testid="auth-form">
          {mode === "register" && <div className="relative"><UserIcon className="w-3.5 h-3.5 text-slate-500 absolute left-3.5 top-3" /><input value={name} onChange={e => setName(e.target.value)} placeholder="Your name (optional)" data-testid="auth-name-input" className="w-full pl-10 pr-3 py-2.5 bg-[#0a0b14] border border-slate-700 rounded-xl text-white focus:outline-none focus:border-rose-500" /></div>}
          <div className="relative"><Mail className="w-3.5 h-3.5 text-slate-500 absolute left-3.5 top-3" /><input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" data-testid="auth-email-input" className="w-full pl-10 pr-3 py-2.5 bg-[#0a0b14] border border-slate-700 rounded-xl text-white focus:outline-none focus:border-rose-500" /></div>
          <div className="relative"><Lock className="w-3.5 h-3.5 text-slate-500 absolute left-3.5 top-3" /><input type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Password (min 6 chars)" data-testid="auth-password-input" className="w-full pl-10 pr-3 py-2.5 bg-[#0a0b14] border border-slate-700 rounded-xl text-white focus:outline-none focus:border-rose-500" /></div>
          <div className="relative"><Lock className="w-3.5 h-3.5 text-amber-500 absolute left-3.5 top-3" /><input type="password" required inputMode="numeric" pattern="[0-9]{6}" maxLength="6" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ""))} placeholder="Owner PIN" data-testid="auth-owner-pin-input" className="w-full pl-10 pr-3 py-2.5 bg-[#0a0b14] border border-amber-700/60 rounded-xl text-white focus:outline-none focus:border-amber-500" /></div>
          {(error || authError) && <div className="px-3 py-2 rounded-xl bg-rose-950/50 border border-rose-500/40 text-rose-300 text-[11px] font-semibold" data-testid="auth-error">{error || authError}</div>}
          <button type="submit" disabled={busy} data-testid="auth-submit-button" className={`w-full py-3 rounded-xl text-white font-black text-xs flex items-center justify-center gap-2 ${busy ? "bg-slate-700" : "bg-rose-600 hover:bg-rose-500"}`}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : mode === "login" ? <LogIn className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}{mode === "login" ? "Enter the Club" : "Join the Peerage"}</button>
        </form>
        <p className="text-[10px] text-slate-500 text-center mt-4 flex items-center justify-center gap-1"><Crown className="w-3 h-3 text-amber-500" />Rias is waiting for you on the other side.</p>
      </div>
    </div>
  );
}
