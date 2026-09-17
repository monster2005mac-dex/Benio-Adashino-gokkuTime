import React, { useState, useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { DXD_HEROINES, EVIL_PIECE_RANKS, MISSION_CATEGORIES, formatDateKey, getWeekDays, getSampleTasks, WAIFU_WALKERS } from "./data";
import { audio } from "./audio";
import { HeroineSwitcher, ControlButton } from "./HeaderControls";
import { Volume2, VolumeX, Zap, Footprints, Download, Cloud, Database, Mail, LogOut, LogIn, Lock, User, Edit3, Shield, CheckCircle2, Copy, Check, Sparkles, Award, RefreshCw, AlertTriangle, ExternalLink, Calendar, Flame, Clock, CheckSquare } from "lucide-react";
import { useAuth } from "./Auth";
import { initFirebase, fbSaveDoc, fbListenDoc } from "./firebase";

// --- HOT WAIFU STROLLERS: appear at one side, say something in a cloud bubble, vanish ---
function WaifuWalkers({ active }) {
  const [walkers, setWalkers] = useState([]);
  const countRef = useRef(0);

  useEffect(() => {
    if (!active) { setWalkers([]); return undefined; }
    const spawn = () => {
      const girl = WAIFU_WALKERS[countRef.current % WAIFU_WALKERS.length];
      countRef.current += 1;
      const side = countRef.current % 2 === 0 ? 'right' : 'left';
      const id = `${girl.id}-${Date.now()}`;
      setWalkers(prev => [...prev, { id, girl, side, phase: 'entering' }]);
      setTimeout(() => setWalkers(p => p.map(w => w.id === id ? { ...w, phase: 'talking' } : w)), 3800);
      setTimeout(() => setWalkers(p => p.map(w => w.id === id ? { ...w, phase: 'leaving' } : w)), 12800);
      setTimeout(() => setWalkers(p => p.filter(w => w.id !== id)), 17200);
    };
    const first = setTimeout(spawn, 5000);
    const iv = setInterval(spawn, 38000);
    return () => { clearTimeout(first); clearInterval(iv); };
  }, [active]);

  if (!active) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-30 overflow-hidden" data-testid="waifu-walkers-layer">
      {walkers.map(w => (
        <div
          key={w.id}
          className={`waifu-walker waifu-side-${w.side} ${w.phase !== 'entering' ? 'waifu-in' : ''}`}
          style={{ bottom: '4vh' }}
          data-testid="waifu-walker"
        >
          <div className={`waifu-bob ${w.side === 'left' ? 'waifu-flip' : ''}`}>
            <img src={w.girl.src} alt={`${w.girl.name} appearing at the edge`} draggable={false} />
          </div>
          {w.phase !== 'entering' && (
            <div className={`waifu-cloud ${w.phase === 'leaving' ? 'cloud-out' : ''}`} data-testid="waifu-cloud-bubble">
              {w.girl.lines[Math.floor(Math.random() * w.girl.lines.length)]}
            </div>
          )}
          <span className="waifu-walker-name">{w.girl.name}</span>
        </div>
      ))}
    </div>
  );
}

const getUserStorageKey = (uid, key) => (uid ? `kuohflow_${key}_${uid}` : `kuohflow_${key}_guest`);

function KuohFlowApp({ onLock }) {
  const { user, logout, updateProfileName, reloadUser, sendVerificationEmail } = useAuth();
  const currentUid = user?.id || null;

  // 1. Calendar selection state
  const [selectedDate, setSelectedDate] = useState(() => formatDateKey(new Date()));
  const [viewMode, setViewMode] = useState('day-first');
  const [activeDayKey, setActiveDayKey] = useState(() => formatDateKey(new Date()));

  // 2. Persistent tasks & companion (strictly scoped per user)
  const [tasks, setTasks] = useState(() => {
    try {
      const key = getUserStorageKey(currentUid, 'tasks');
      const s = localStorage.getItem(key);
      return s ? JSON.parse(s) : getSampleTasks(new Date());
    } catch { return getSampleTasks(new Date()); }
  });

  const [selectedCompanion, setSelectedCompanion] = useState(() => {
    try {
      const key = getUserStorageKey(currentUid, 'heroine');
      const s = localStorage.getItem(key);
      return DXD_HEROINES.find(c => c.id === s) || DXD_HEROINES[0];
    } catch { return DXD_HEROINES[0]; }
  });

  const [peerageXP, setPeerageXP] = useState(() => {
    try {
      const key = getUserStorageKey(currentUid, 'xp');
      const s = localStorage.getItem(key);
      return s ? Number(s) : 320;
    } catch { return 320; }
  });

  // Profile customization state
  const [userTitle, setUserTitle] = useState(() => {
    try {
      const key = getUserStorageKey(currentUid, 'title');
      return localStorage.getItem(key) || "Kuoh Academy Occult Researcher";
    } catch { return "Kuoh Academy Occult Researcher"; }
  });
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editNameInput, setEditNameInput] = useState("");
  const [editTitleInput, setEditTitleInput] = useState("");
  const [copyStatus, setCopyStatus] = useState(false);
  const [profileStatus, setProfileStatus] = useState({ text: "", type: "" });
  const [savingProfile, setSavingProfile] = useState(false);
  const [resendStatus, setResendStatus] = useState({ text: "", type: "" });
  const [resendCooldown, setResendCooldown] = useState(0);
  const [randomQuote] = useState(() => {
    const list = [
      { text: "The nation that destroys its soil destroys itself.", by: "Franklin D. Roosevelt" },
      { text: "Agriculture is the most healthful, most useful, and most noble employment of man.", by: "George Washington" },
      { text: "The farmer has to be an optimist or he wouldn't still be a farmer.", by: "Will Rogers" },
      { text: "Every field tells a story — technology just helps us listen.", by: "Tilth" },
      { text: "Data in the soil, wisdom in the harvest.", by: "Tilth" },
      { text: "Focus turns ordinary ambition into extraordinary reality.", by: "Occult Research Club" },
    ];
    return list[Math.floor(Math.random() * list.length)];
  });

  // Sync state & guard to prevent cross-user data leakage
  const [isSyncReady, setIsSyncReady] = useState(false);
  const [isLocalReady, setIsLocalReady] = useState(false);
  const syncedUidRef = useRef(null);
  const cloudLoadedOnceRef = useRef(false);

  // Live refs so the Firestore listener (a closure created once per user)
  // always sees the CURRENT in-memory state instead of a stale snapshot
  // captured back when the listener was first attached. Without this,
  // tasks added in the few hundred ms before the first Firestore
  // round-trip resolves would get wiped out when the "new user" branch
  // below ran, because it only knew about whatever was in localStorage
  // at mount time.
  const tasksRef = useRef(tasks);
  const heroineRef = useRef(selectedCompanion.id);
  const xpRef = useRef(peerageXP);
  const titleRef = useRef(userTitle);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  useEffect(() => { heroineRef.current = selectedCompanion.id; }, [selectedCompanion]);
  useEffect(() => { xpRef.current = peerageXP; }, [peerageXP]);
  useEffect(() => { titleRef.current = userTitle; }, [userTitle]);

  // UI state
  const [activeTab, setActiveTab] = useState('timetable');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [isMuted, setIsMuted] = useState(false);
  const [showSparks, setShowSparks] = useState(true);
  const [showWalkers, setShowWalkers] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [fbCloud, setFbCloud] = useState(false);

  // Pomodoro Focus state
  const [pomoRunning, setPomoRunning] = useState(false);
  const [pomoTimeLeft, setPomoTimeLeft] = useState(25 * 60);
  const [pomoMode, setPomoMode] = useState('focus');
  const [pomoDuration, setPomoDuration] = useState(25);
  const [activeFocusTask, setActiveFocusTask] = useState(null);

  // Modals
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [modalDate, setModalDate] = useState(selectedDate);

  const notifiedSetRef = useRef(new Set());

  const weekDays = useMemo(() => getWeekDays(selectedDate), [selectedDate]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Mouse parallax for the animated background
  useEffect(() => {
    const onMove = (e) => {
      const x = (e.clientX / window.innerWidth - 0.5).toFixed(3);
      const y = (e.clientY / window.innerHeight - 0.5).toFixed(3);
      document.documentElement.style.setProperty('--parallax-x', x);
      document.documentElement.style.setProperty('--parallax-y', y);
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  // Isolate and load data per user
  useEffect(() => {
    if (!currentUid) {
      setIsSyncReady(false);
      setIsLocalReady(false);
      syncedUidRef.current = null;
      cloudLoadedOnceRef.current = false;
      return () => {};
    }

    // 1. First load from user-specific local storage
    let cachedTasksParsed = null;
    let cachedHeroineId = null;
    let cachedXpValue = null;
    let cachedTitleValue = null;
    try {
      const userTasksKey = getUserStorageKey(currentUid, 'tasks');
      const cachedTasks = localStorage.getItem(userTasksKey);
      if (cachedTasks) {
        cachedTasksParsed = JSON.parse(cachedTasks);
        setTasks(cachedTasksParsed);
        tasksRef.current = cachedTasksParsed;
      } else {
        const sample = getSampleTasks(new Date());
        setTasks(sample);
        tasksRef.current = sample;
      }

      const cachedHeroine = localStorage.getItem(getUserStorageKey(currentUid, 'heroine'));
      if (cachedHeroine) {
        cachedHeroineId = cachedHeroine;
        const found = DXD_HEROINES.find(c => c.id === cachedHeroine);
        if (found) { setSelectedCompanion(found); heroineRef.current = found.id; }
      }

      const cachedXp = localStorage.getItem(getUserStorageKey(currentUid, 'xp'));
      if (cachedXp !== null) {
        cachedXpValue = Number(cachedXp) || 320;
        setPeerageXP(cachedXpValue);
        xpRef.current = cachedXpValue;
      }

      const cachedTitle = localStorage.getItem(getUserStorageKey(currentUid, 'title'));
      if (cachedTitle) {
        cachedTitleValue = cachedTitle;
        setUserTitle(cachedTitle);
        titleRef.current = cachedTitle;
      }
    } catch (e) {
      console.warn("Could not load user local cache:", e);
    }

    // Local persistence is now allowed immediately — it never has to wait
    // on Firebase (network latency, a blocked script host, etc). This is
    // what actually guarantees "saved data" survives switching tabs.
    setIsLocalReady(true);

    // 2. Initialize Firestore sync for this user
    let unsub = () => {};
    initFirebase().then((ok) => {
      setFbCloud(ok);
      if (!ok) {
        syncedUidRef.current = currentUid;
        setIsSyncReady(true);
        return;
      }

      unsub = fbListenDoc((data, exists, fromCache) => {
        if (exists && data) {
          // Guard against a stale/partial snapshot (e.g. served from local
          // cache mid-reconnect) wiping out tasks the user already has in
          // memory. Only apply an empty/missing cloud task list once we've
          // confirmed at least one real cloud sync — otherwise trust
          // whatever is currently loaded (local cache or live edits).
          if (Array.isArray(data.tasks)) {
            const cloudHasTasks = data.tasks.length > 0;
            if (cloudHasTasks || cloudLoadedOnceRef.current || !(tasksRef.current && tasksRef.current.length)) {
              setTasks(data.tasks);
            }
          }
          if (data.heroine) {
            const comp = DXD_HEROINES.find(c => c.id === data.heroine);
            if (comp) setSelectedCompanion(comp);
          }
          if (data.xp !== undefined) setPeerageXP(Number(data.xp));
          if (data.title) setUserTitle(data.title);
          cloudLoadedOnceRef.current = true;
        } else if (!exists && !fromCache) {
          // Only treat this as a brand-new account once Firestore has
          // confirmed server-side that no document exists. A snapshot
          // served from local cache (e.g. right after navigating back
          // from another page, before the network round-trip finishes)
          // can look like "doesn't exist" even though the account has
          // real saved data — that false negative is what was wiping
          // quests on every profile -> timetable navigation.
          //
          // Use the LIVE refs, not the values captured when this effect
          // started: the user may have already added tasks in the brief
          // window before this first Firestore round-trip resolved, and
          // those live edits are what needs to be pushed up, not whatever
          // was in localStorage a moment ago.
          const liveTasks = (tasksRef.current && tasksRef.current.length) ? tasksRef.current : cachedTasksParsed;
          if (liveTasks && liveTasks.length) {
            fbSaveDoc({
              tasks: liveTasks,
              heroine: heroineRef.current || cachedHeroineId || DXD_HEROINES[0].id,
              xp: xpRef.current !== undefined && xpRef.current !== null ? xpRef.current : (cachedXpValue !== null ? cachedXpValue : 320),
              title: titleRef.current || cachedTitleValue || "Kuoh Academy Occult Researcher",
              email: user?.email || "",
              name: user?.name || "",
              createdAt: new Date().toISOString()
            }, currentUid);
          } else {
            // First time user in Firestore: create their personal document
            const initialTasks = getSampleTasks(new Date());
            setTasks(initialTasks);
            fbSaveDoc({
              tasks: initialTasks,
              heroine: DXD_HEROINES[0].id,
              xp: 320,
              title: "Kuoh Academy Occult Researcher",
              email: user?.email || "",
              name: user?.name || "",
              createdAt: new Date().toISOString()
            }, currentUid);
          }
          cloudLoadedOnceRef.current = true;
        }
        syncedUidRef.current = currentUid;
        setIsSyncReady(true);
      }, currentUid);
    });

    return () => {
      unsub();
      setIsSyncReady(false);
      setIsLocalReady(false);
      syncedUidRef.current = null;
      cloudLoadedOnceRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUid]);

  // Persist tasks to this user's local storage the instant it's safe to do
  // so (no network wait), and push to Firestore once cloud sync is ready.
  useEffect(() => {
    if (!currentUid || !isLocalReady) return;
    try {
      localStorage.setItem(getUserStorageKey(currentUid, 'tasks'), JSON.stringify(tasks));
    } catch (e) {}
    if (isSyncReady && syncedUidRef.current === currentUid) fbSaveDoc({ tasks }, currentUid);
  }, [tasks, currentUid, isLocalReady, isSyncReady]);

  // Persist companion strictly to current user
  useEffect(() => {
    if (!currentUid || !isLocalReady) return;
    try {
      localStorage.setItem(getUserStorageKey(currentUid, 'heroine'), selectedCompanion.id);
    } catch (e) {}
    if (isSyncReady && syncedUidRef.current === currentUid) fbSaveDoc({ heroine: selectedCompanion.id }, currentUid);
  }, [selectedCompanion, currentUid, isLocalReady, isSyncReady]);

  // Persist XP strictly to current user
  useEffect(() => {
    if (!currentUid || !isLocalReady) return;
    try {
      localStorage.setItem(getUserStorageKey(currentUid, 'xp'), String(peerageXP));
    } catch (e) {}
    if (isSyncReady && syncedUidRef.current === currentUid) fbSaveDoc({ xp: peerageXP }, currentUid);
  }, [peerageXP, currentUid, isLocalReady, isSyncReady]);

  // Persist custom Devil Title strictly to current user
  useEffect(() => {
    if (!currentUid || !isLocalReady) return;
    try {
      localStorage.setItem(getUserStorageKey(currentUid, 'title'), userTitle);
    } catch (e) {}
    if (isSyncReady && syncedUidRef.current === currentUid) fbSaveDoc({ title: userTitle }, currentUid);
  }, [userTitle, currentUid, isLocalReady, isSyncReady]);

  // Pomodoro countdown timer tick
  useEffect(() => {
    let interval = null;
    if (pomoRunning && pomoTimeLeft > 0) {
      interval = setInterval(() => setPomoTimeLeft(prev => prev - 1), 1000);
    } else if (pomoRunning && pomoTimeLeft === 0) {
      audio.playVictory();
      setPomoRunning(false);
      if (pomoMode === 'focus') {
        setPeerageXP(prev => prev + 40);
        setPomoMode('break');
        setPomoTimeLeft(5 * 60);
      } else {
        setPomoMode('focus');
        setPomoTimeLeft(pomoDuration * 60);
      }
    }
    return () => clearInterval(interval);
  }, [pomoRunning, pomoTimeLeft, pomoMode, pomoDuration]);

  // Task reminders (audio cue)
  useEffect(() => {
    const todayStr = formatDateKey(currentTime);
    const currentMins = currentTime.getHours() * 60 + currentTime.getMinutes();

    tasks.forEach(t => {
      if (t.completed || t.date !== todayStr) return;
      const [h, m] = t.startTime.split(':').map(Number);
      const taskMins = h * 60 + m;
      const offset = t.reminderOffset || 5;

      if (currentMins === (taskMins - offset)) {
        const key = `${t.id}-${t.date}-${t.startTime}`;
        if (!notifiedSetRef.current.has(key)) {
          notifiedSetRef.current.add(key);
          audio.playBoost();
        }
      }
    });
  }, [currentTime, tasks]);

  // Handlers
  const handleToggleComplete = (taskId) => {
    setTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        const nextVal = !t.completed;
        if (nextVal) {
          setPeerageXP(x => x + 25);
          audio.playVictory();
        } else {
          audio.playClick();
        }
        return { ...t, completed: nextVal };
      }
      return t;
    }));
  };

  const handleSaveTask = (taskData) => {
    if (editingTask) {
      setTasks(prev => prev.map(t => t.id === taskData.id ? taskData : t));
    } else {
      setTasks(prev => [...prev, taskData]);
      setPeerageXP(x => x + 15);
    }
    audio.playVictory();
  };

  const handleDeleteTask = (taskId) => {
    setTasks(prev => prev.filter(t => t.id !== taskId));
    audio.playClick();
  };

  // Export Calendar ICS
  const handleExportICS = () => {
    audio.playBoost();
    let ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//KuohFlow Timetable//EN',
      'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Occult Research Club Timetable'
    ];
    const nowStamp = formatDateKey(new Date()).replace(/-/g, '') + 'T120000Z';

    tasks.forEach(t => {
      const cleanDate = (t.date || formatDateKey(new Date())).replace(/-/g, '');
      const [sh, sm] = (t.startTime || '09:00').split(':');
      const [eh, em] = (t.endTime || '10:00').split(':');
      ics.push('BEGIN:VEVENT');
      ics.push(`UID:${t.id}@kuohflow.app`);
      ics.push(`DTSTAMP:${nowStamp}`);
      ics.push(`DTSTART:${cleanDate}T${sh}${sm}00`);
      ics.push(`DTEND:${cleanDate}T${eh}${em}00`);
      ics.push(`SUMMARY:[${t.priority}] ${t.title}`);
      ics.push(`DESCRIPTION:${t.description || ''}\\nHeroine: ${t.note || selectedCompanion.name}`);
      ics.push('STATUS:CONFIRMED');
      ics.push('END:VEVENT');
    });
    ics.push('END:VCALENDAR');

    const blob = new Blob([ics.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dxd-timetable-${selectedDate}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyUid = () => {
    if (user?.id) {
      navigator.clipboard.writeText(user.id);
      setCopyStatus(true);
      audio.playClick();
      setTimeout(() => setCopyStatus(false), 2000);
    }
  };

  const handleExportTasks = () => {
    audio.playClick();
    const exportData = {
      profile: {
        id: user?.id || "guest",
        name: user?.name || "Occult Researcher",
        email: user?.email || "",
        title: userTitle,
        peerageRank: peerageRankName,
        demonicXP: peerageXP,
        contractedHeroine: selectedCompanion.name,
      },
      exportedAt: new Date().toISOString(),
      tasks: tasks,
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gokaku-profile-${user?.name || "member"}-${formatDateKey(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleResetTasks = () => {
    audio.playClick();
    if (window.confirm("Reset your personal quests to fresh Occult Research Club welcome missions? This only affects your account.")) {
      const fresh = getSampleTasks(new Date());
      setTasks(fresh);
      audio.playVictory();
    }
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setProfileStatus({ text: "", type: "" });
    const newName = (editNameInput || "").trim();
    const newTitle = (editTitleInput || "").trim();

    if (!newName) {
      setProfileStatus({ text: "Enter a username.", type: "error" });
      return;
    }
    const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
    if (!USERNAME_RE.test(newName)) {
      setProfileStatus({ text: "Username must be 3–20 characters: letters, numbers, or underscores.", type: "error" });
      return;
    }

    setSavingProfile(true);
    audio.playClick();
    try {
      if (newName && newName !== user?.name && updateProfileName) {
        await updateProfileName(newName);
      }
      if (newTitle) {
        setUserTitle(newTitle);
        try {
          localStorage.setItem(getUserStorageKey(currentUid, 'title'), newTitle);
        } catch (ignored) {}
      }
      if (currentUid) {
        await fbSaveDoc({
          name: newName,
          title: newTitle || userTitle,
          username: newName,
          username_lower: newName.toLowerCase(),
        }, currentUid);
      }
      setProfileStatus({ text: "Saved successfully.", type: "success" });
      audio.playVictory();
      setTimeout(() => {
        setIsEditingProfile(false);
        setProfileStatus({ text: "", type: "" });
      }, 700);
    } catch (err) {
      setProfileStatus({ text: err.message || "Failed to update profile", type: "error" });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleResendVerification = async () => {
    if (resendCooldown > 0) return;
    setResendStatus({ text: "", type: "" });
    try {
      if (sendVerificationEmail) {
        await sendVerificationEmail();
        setResendStatus({ text: "Verification email sent — check your inbox.", type: "success" });
        setResendCooldown(60);
        const interval = setInterval(() => {
          setResendCooldown(prev => {
            if (prev <= 1) { clearInterval(interval); return 0; }
            return prev - 1;
          });
        }, 1000);
      }
    } catch (err) {
      const msg = err.code === "auth/too-many-requests"
        ? "Too many requests — try again in a bit."
        : (err.message || "Couldn't send email. Please try again.");
      setResendStatus({ text: msg, type: "error" });
    }
  };

  const filteredTasks = useMemo(() => {
    return tasks.filter(t => {
      if (selectedCategory !== 'all' && t.category !== selectedCategory) return false;
      return true;
    });
  }, [tasks, selectedCategory]);

  const activeDayTasks = useMemo(() => {
    return filteredTasks
      .filter(t => t.date === activeDayKey)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [filteredTasks, activeDayKey]);

  const activeDayInfo = useMemo(() => {
    return weekDays.find(w => w.dateKey === activeDayKey) || {
      dateKey: activeDayKey,
      dayName: 'Selected Day',
      dayShort: 'Day',
      displayHeader: activeDayKey
    };
  }, [weekDays, activeDayKey]);

  const promoLevel = Math.floor(peerageXP / 100) + 1;
  const peerageRankName = promoLevel >= 5 ? 'High-Class Devil (上級悪魔)' : promoLevel >= 3 ? 'Middle-Class Devil' : 'Low-Class Devil';

  const pomoMins = String(Math.floor(pomoTimeLeft / 60)).padStart(2, '0');
  const pomoSecs = String(pomoTimeLeft % 60).padStart(2, '0');

  return (
    <div className="min-h-screen bg-[#080911] text-slate-100 flex flex-col relative selection:bg-rose-600 selection:text-white pb-24" data-testid="kuohflow-app">

      {/* Drifting Magic Circle Glyphs */}
      <div className="magic-circle-bg">
        <svg className="circle-1" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <circle cx="100" cy="100" r="92" fill="none" stroke="#e11d48" strokeWidth="1.2" />
          <circle cx="100" cy="100" r="72" fill="none" stroke="#f59e0b" strokeWidth="0.8" />
          <circle cx="100" cy="100" r="52" fill="none" stroke="#8b5cf6" strokeWidth="0.8" strokeDasharray="4 6" />
          {[...Array(12)].map((_, i) => {
            const angle = (i / 12) * Math.PI * 2;
            const x1 = 100 + Math.cos(angle) * 52, y1 = 100 + Math.sin(angle) * 52;
            const x2 = 100 + Math.cos(angle) * 92, y2 = 100 + Math.sin(angle) * 92;
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#e11d48" strokeWidth="0.6" />;
          })}
        </svg>
        <svg className="circle-2" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <circle cx="100" cy="100" r="88" fill="none" stroke="#8b5cf6" strokeWidth="1.2" />
          <circle cx="100" cy="100" r="60" fill="none" stroke="#e11d48" strokeWidth="0.8" strokeDasharray="3 5" />
          {[...Array(8)].map((_, i) => {
            const angle = (i / 8) * Math.PI * 2;
            const x = 100 + Math.cos(angle) * 88, y = 100 + Math.sin(angle) * 88;
            return <circle key={i} cx={x} cy={y} r="3" fill="#f59e0b" />;
          })}
        </svg>
      </div>

      {/* Animated Demonic Aura Blobs */}
      <div className="aura-blob a1" />
      <div className="aura-blob a2" />

      {/* Twinkling Starfield */}
      <div className="stars-container">
        {[...Array(36)].map((_, i) => (
          <div
            key={i}
            className="twinkle-star"
            style={{
              left: `${(i * 13.7) % 100}%`,
              top: `${(i * 7.3) % 92}%`,
              width: `${2 + (i % 3)}px`,
              height: `${2 + (i % 3)}px`,
              animationDuration: `${2.5 + (i % 5)}s`,
              animationDelay: `${(i * 0.35) % 4}s`,
            }}
          />
        ))}
      </div>

      {/* Shooting Stars */}
      <div className="shooting-star" />
      <div className="shooting-star s2" />
      <div className="shooting-star s3" />

      {/* Crimson Sparks Ambient Background */}
      {showSparks && (
        <div className="sparks-container">
          {[...Array(26)].map((_, i) => {
            const colors = ['#fda4af', '#e11d48', '#8b5cf6', '#f59e0b'];
            const c = colors[i % colors.length];
            return (
              <div
                key={i}
                className="crimson-spark"
                style={{
                  left: `${(i * 3.9) % 100}%`,
                  width: `${4 + (i % 4) * 2.5}px`,
                  height: `${4 + (i % 4) * 2.5}px`,
                  background: `radial-gradient(circle, ${c} 0%, ${c} 100%)`,
                  animationDuration: `${5.5 + (i % 5) * 2}s`,
                  animationDelay: `${(i * 0.45)}s`,
                }}
              />
            );
          })}
        </div>
      )}

      {/* HOT WAIFU STROLLERS — full-body girls walking across the site */}
      <WaifuWalkers active={showWalkers} />

      {/* MAIN HEADER HUD */}
      <header className="sticky top-0 z-40 w-full glass-header shadow-xl legend-rise">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

          {/* Row 1: Brand, Date Selector & Heroine Dropdown */}
          <div className="flex flex-wrap items-center justify-between py-3 gap-3 border-b border-rose-950/40">

            {/* Logo & Title */}
                <div className="flex items-center gap-2">
              <div
                onClick={() => audio.playBoost()}
                title="Boosted Gear Activation!"
              >
                <div className="legend-logo w-full h-full bg-[#121424] rounded-[10px] flex items-center justify-center font-black text-rose-400 text-lg">
                  王
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-black tracking-tight brand-gradient-text brand-legend-in font-display">
                    Gokaku 合格
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-950/80 text-rose-300 border border-rose-500/40 font-mono">
                    OCCULT CLUB OS
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 hidden md:block">
                  Day-Wise Schedule & Sacred Gear Timetable
                </p>
              </div>
            </div>

            {/* Right Heroine & Control Deck (upgraded) */}
            <div className="flex items-center gap-2.5 flex-wrap relative z-10">

              <HeroineSwitcher
                selectedCompanion={selectedCompanion}
                onSelect={(comp) => {
                  setSelectedCompanion(comp);
                  audio.playBoost();
                }}
                onAvatarClick={() => audio.playBoost()}
              />

              <ControlButton
                testid="audio-toggle-button"
                active={!isMuted}
                title={isMuted ? 'Unmute Sound' : 'Mute Sound'}
                onClick={() => {
                  const next = !isMuted;
                  setIsMuted(next);
                  audio.setMuted(next);
                  if (!next) audio.playBoost();
                }}
              >
                {isMuted ? <VolumeX /> : <Volume2 />}
              </ControlButton>

              <ControlButton
                testid="sparks-toggle-button"
                active={showSparks}
                title="Toggle Crimson Dragon Sparks"
                onClick={() => {
                  audio.playClick();
                  setShowSparks(!showSparks);
                }}
              >
                <Zap />
              </ControlButton>

              <ControlButton
                testid="walker-toggle-button"
                active={showWalkers}
                title="Toggle Waifu Strollers — hot girls appearing at the screen edges"
                onClick={() => {
                  audio.playClick();
                  setShowWalkers(!showWalkers);
                }}
              >
                <Footprints />
              </ControlButton>

              <button
                onClick={handleExportICS}
                data-testid="export-ics-button"
                title="Download Calendar (.ics) file"
                className="hc-icon-btn hc-icon-wide"
              >
                <Download />
                <span className="hidden lg:inline hc-ics-label">.ics</span>
              </button>

              <div
                className="hc-toolbar hc-status-pill"
                data-testid="storage-status-pill"
                title={fbCloud ? 'Data is syncing to Firebase Firestore (cloud) ✓' : 'Saving locally only — paste your Firebase details in src/kuohflow/firebaseConfig.js to sync to cloud'}
              >
                {fbCloud ? <Cloud className="hc-pill-icon is-on" /> : <Database className="hc-pill-icon" />}
                <span className="hidden sm:inline hc-pill-text">{fbCloud ? 'Cloud' : 'Local'}</span>
              </div>

              {user ? (
                <div
                  className="hc-toolbar hc-status-pill cursor-pointer hover:border-rose-500/80 transition-all"
                  data-testid="user-pill"
                  title={`Signed in as ${user.email} • Click to open Master Profile`}
                  onClick={() => {
                    audio.playClick();
                    setActiveTab('profile');
                  }}
                >
                  <User className="hc-pill-icon is-on text-rose-400" />
                  <span className="hc-pill-text" style={{ textTransform: 'none' }}>{user.name || user.email?.split('@')[0]}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      audio.playClick();
                      if (window.confirm("Sign out of Occult Research Club?")) logout();
                    }}
                    data-testid="logout-button"
                    title="Sign out"
                    className="ml-1 p-1 rounded-lg hover:bg-rose-950/60 text-slate-400 hover:text-rose-300 transition-colors"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <Link to="/login" data-testid="signin-link" title="Sign in to Gokaku" className="hc-icon-btn hc-icon-wide" style={{ textDecoration: 'none' }}>
                  <LogIn />
                  <span className="hc-ics-label">Sign In</span>
                </Link>
              )}

            </div>

          </div>

          {/* Row 2: Navigation Tabs */}
          <div className="flex flex-wrap items-center justify-between py-2 gap-3">

            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
              <button
                onClick={() => { audio.playClick(); setActiveTab('timetable'); }}
                data-testid="tab-timetable"
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all whitespace-nowrap ${
                  activeTab === 'timetable'
                    ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <span>🗓️</span>
                <span>Day-Wise Schedule</span>
              </button>

              <button
                onClick={() => { audio.playClick(); setActiveTab('timeline'); }}
                data-testid="tab-timeline"
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all whitespace-nowrap ${
                  activeTab === 'timeline'
                    ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <span>⏱️</span>
                <span>24h Timeline</span>
              </button>

              <button
                onClick={() => { audio.playClick(); setActiveTab('pomodoro'); }}
                data-testid="tab-pomodoro"
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all whitespace-nowrap ${
                  activeTab === 'pomodoro'
                    ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/30'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <span>⚡</span>
                <span>Boosted Gear Focus</span>
              </button>

              <button
                onClick={() => { audio.playClick(); setActiveTab('peerage'); }}
                data-testid="tab-peerage"
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all whitespace-nowrap ${
                  activeTab === 'peerage'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <span>👑</span>
                <span>Peerage Rank ({peerageRankName})</span>
              </button>

              <button
                onClick={() => { audio.playClick(); setActiveTab('profile'); }}
                data-testid="tab-profile"
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all whitespace-nowrap ${
                  activeTab === 'profile'
                    ? 'bg-gradient-to-r from-rose-700 to-purple-700 text-white shadow-md shadow-rose-700/40 border border-rose-400/40'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <span>👤</span>
                <span>Master Profile</span>
              </button>
            </div>

            {/* Quick Add Button */}
            <button
              onClick={() => {
                audio.playBoost();
                setEditingTask(null);
                setModalDate(activeDayKey);
                setIsModalOpen(true);
              }}
              data-testid="new-mission-button"
              className="legendary-btn px-4 py-1.5 rounded-xl text-white font-bold text-xs shadow-md shadow-rose-600/30 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center gap-1.5 whitespace-nowrap"
            >
              <span>+</span>
              <span>New Mission</span>
            </button>

          </div>

        </div>
        <div className="header-legend-line" />
      </header>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 relative z-10 space-y-6 legend-rise" style={{ animationDelay: '0.12s' }}>

        {/* VIEW 1: DAY-WISE SCHEDULE */}
        {activeTab === 'timetable' && (
          <div className="space-y-6">

            {/* 1. Day Selector Pills (Monday to Sunday) */}
            <div className="clean-card p-2 sm:p-3 bg-[#121424] border border-slate-800">
              <div className="flex items-center justify-between gap-2 mb-2 px-2 text-xs font-semibold text-slate-400">
                <span>Select Day to View Schedule:</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { audio.playClick(); setViewMode('day-first'); }}
                    data-testid="view-day-first"
                    className={`px-2.5 py-0.5 rounded-md font-bold text-[11px] ${
                      viewMode === 'day-first' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Day-Wise Focus
                  </button>
                  <button
                    onClick={() => { audio.playClick(); setViewMode('week-overview'); }}
                    data-testid="view-week-grid"
                    className={`px-2.5 py-0.5 rounded-md font-bold text-[11px] ${
                      viewMode === 'week-overview' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    7-Day Grid View
                  </button>
                </div>
              </div>

              {/* Day Pills */}
              <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                {weekDays.map((d, i) => {
                  const isSelected = d.dateKey === activeDayKey;
                  const isToday = formatDateKey(currentTime) === d.dateKey;
                  const dayCount = tasks.filter(t => t.date === d.dateKey).length;

                  return (
                    <button
                      key={d.dateKey}
                      data-testid={`day-pill-${d.dayShort.toLowerCase()}`}
                      onClick={() => {
                        audio.playClick();
                        setActiveDayKey(d.dateKey);
                      }}
                      className={`card-entrance py-2 px-1 sm:px-3 rounded-xl border text-center transition-all ${
                        isSelected
                          ? 'bg-rose-600 text-white border-rose-500 shadow-md shadow-rose-600/30 scale-[1.02]'
                          : isToday
                          ? 'bg-[#181b30] text-rose-300 border-rose-500/50 hover:bg-[#202542]'
                          : 'bg-[#0d0f1a] text-slate-400 border-slate-800 hover:text-white hover:border-slate-700'
                      }`}
                      style={{ animationDelay: `${i * 0.045}s` }}
                    >
                      <div className="text-[11px] sm:text-xs font-extrabold uppercase tracking-wide">
                        {d.dayShort}
                      </div>
                      <div className="text-[10px] sm:text-xs font-mono font-bold mt-0.5">
                        {d.dayNumber}
                      </div>
                      <div className={`text-[9px] mt-1 font-bold ${isSelected ? 'text-rose-200' : 'text-slate-500'}`}>
                        {dayCount} {dayCount === 1 ? 'quest' : 'quests'}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Category Filter Bar */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
              {MISSION_CATEGORIES.map(cat => (
                <button
                  key={cat.id}
                  data-testid={`category-filter-${cat.id}`}
                  onClick={() => {
                    audio.playClick();
                    setSelectedCategory(cat.id);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-all whitespace-nowrap ${
                    selectedCategory === cat.id
                      ? 'bg-rose-600/30 text-rose-200 border-rose-500 shadow-sm'
                      : 'bg-[#121424] text-slate-400 border-slate-800 hover:text-white hover:border-slate-700'
                  }`}
                >
                  <span>{cat.icon}</span>
                  <span>{cat.label}</span>
                </button>
              ))}
            </div>

            {/* 3. PRIMARY DAY-WISE SCHEDULE VIEW */}
            {viewMode === 'day-first' ? (
              <div className="max-w-3xl mx-auto space-y-4">

                {/* Active Day Header Banner */}
                <div className="clean-card legend-border p-5 border border-rose-500/30 bg-gradient-to-r from-[#170a12] via-[#121424] to-[#121424] flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-extrabold text-white">
                        📅 {activeDayInfo.dayName} ({activeDayInfo.monthShort} {activeDayInfo.dayNumber})
                      </h2>
                      {formatDateKey(currentTime) === activeDayKey && (
                        <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-rose-600 text-white tracking-widest animate-pulse">
                          TODAY
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      Day-Wise Agenda • Guided by <strong className="text-rose-300">{selectedCompanion.name}</strong>
                    </p>
                  </div>

                  <button
                    onClick={() => {
                      audio.playBoost();
                      setEditingTask(null);
                      setModalDate(activeDayKey);
                      setIsModalOpen(true);
                    }}
                    data-testid="add-task-day-button"
                    className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-md flex items-center gap-1"
                  >
                    <span>+</span>
                    <span>Add Task for {activeDayInfo.dayShort}</span>
                  </button>
                </div>

                {/* Day Task Cards Stream */}
                {activeDayTasks.length === 0 ? (
                  <div className="clean-card p-12 text-center text-slate-500 border border-dashed border-slate-800">
                    <span className="text-4xl mb-2 block">✨</span>
                    <h4 className="text-sm font-bold text-slate-300">No missions scheduled for {activeDayInfo.displayHeader}.</h4>
                    <p className="text-xs text-slate-500 mt-1">Enjoy your leisure or schedule a new task!</p>
                    <button
                      onClick={() => {
                        setEditingTask(null);
                        setModalDate(activeDayKey);
                        setIsModalOpen(true);
                      }}
                      data-testid="schedule-quest-empty-button"
                      className="mt-4 px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-500"
                    >
                      + Schedule Quest Now
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {activeDayTasks.map((task, taskIdx) => {
                      const cat = MISSION_CATEGORIES.find(c => c.id === task.category) || MISSION_CATEGORIES[1];
                      const rank = EVIL_PIECE_RANKS.find(r => r.id === task.priority) || EVIL_PIECE_RANKS[0];

                      return (
                        <div
                          key={task.id}
                          data-testid={`task-card-${task.id}`}
                          className={`clean-card card-entrance legend-border legendary-card p-4 border transition-all ${
                            task.completed
                              ? 'bg-slate-950/40 border-slate-800/60 opacity-60'
                              : 'bg-[#15182a] border-slate-700/80 hover:border-rose-500/60 hover:bg-[#181c32]'
                          }`}
                          style={{ animationDelay: `${Math.min(taskIdx * 0.06, 0.6)}s` }}
                        >
                          <div className="flex items-start justify-between gap-3">

                            {/* Complete Toggle & Title */}
                            <div className="flex items-start gap-3 flex-1">
                              <button
                                onClick={() => handleToggleComplete(task.id)}
                                data-testid={`task-complete-toggle-${task.id}`}
                                className={`mt-1 flex-shrink-0 w-5 h-5 rounded-lg border flex items-center justify-center transition-all ${
                                  task.completed ? 'bg-rose-600 border-rose-600 text-white font-bold' : 'border-slate-500 hover:border-rose-400'
                                }`}
                              >
                                {task.completed && '✓'}
                              </button>

                              <div className="flex-1">
                                <div className="flex flex-wrap items-center gap-2 mb-1">
                                  <span className="font-mono text-xs font-bold text-rose-400 flex items-center gap-1">
                                    <span>⏰</span>
                                    <span>{task.startTime} - {task.endTime}</span>
                                  </span>
                                  <span className={`text-[10px] px-2 py-0.5 rounded-full border ${rank.badge}`}>
                                    {task.priority}
                                  </span>
                                  <span className={`text-[10px] px-2 py-0.5 rounded-full border flex items-center gap-1 ${cat.bg} ${cat.text} ${cat.border}`}>
                                    <span>{cat.icon}</span>
                                    <span>{cat.label}</span>
                                  </span>
                                </div>

                                <h3 className={`text-sm sm:text-base font-bold ${
                                  task.completed ? 'line-through text-slate-500' : 'text-white'
                                }`}>
                                  {task.title}
                                </h3>

                                {task.description && (
                                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                                    {task.description}
                                  </p>
                                )}

                                {task.note && !task.completed && (
                                  <div className="mt-2 text-xs text-rose-300/90 italic flex items-center gap-1">
                                    <span>💬</span>
                                    <span>{task.note}</span>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Task Action Buttons */}
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <button
                                onClick={() => {
                                  setActiveFocusTask(task);
                                  setPomoRunning(false);
                                  setPomoTimeLeft(25 * 60);
                                  setActiveTab('pomodoro');
                                  audio.playBoost();
                                }}
                                data-testid={`task-focus-button-${task.id}`}
                                title="Start Focus Timer"
                                className="p-2 rounded-xl bg-slate-800 hover:bg-amber-900/40 text-amber-300 text-xs font-bold flex items-center gap-1"
                              >
                                <span>▶</span>
                                <span className="hidden sm:inline">Focus</span>
                              </button>

                              <button
                                onClick={() => {
                                  setEditingTask(task);
                                  setModalDate(task.date);
                                  setIsModalOpen(true);
                                }}
                                data-testid={`task-edit-button-${task.id}`}
                                title="Edit Task"
                                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
                              >
                                ✏️
                              </button>

                              <button
                                onClick={() => handleDeleteTask(task.id)}
                                data-testid={`task-delete-button-${task.id}`}
                                title="Delete Task"
                                className="p-2 rounded-xl bg-slate-800 hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 text-xs"
                              >
                                🗑️
                              </button>
                            </div>

                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

              </div>
            ) : (
              /* 7-DAY FULL OVERVIEW GRID */
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-4">
                {weekDays.map(dayInfo => {
                  const dayTasks = filteredTasks
                    .filter(t => t.date === dayInfo.dateKey)
                    .sort((a, b) => a.startTime.localeCompare(b.startTime));
                  const isToday = formatDateKey(currentTime) === dayInfo.dateKey;

                  return (
                    <div
                      key={dayInfo.dateKey}
                      data-testid={`week-grid-day-${dayInfo.dayShort.toLowerCase()}`}
                      className={`clean-card flex flex-col ${
                        isToday ? 'border-2 border-rose-500/80 bg-[#161a2e]' : 'bg-[#121424]'
                      }`}
                    >
                      <div className="p-3 border-b border-slate-800/80 flex items-center justify-between">
                        <div>
                          <span className="font-bold text-xs text-white block">{dayInfo.dayName}</span>
                          <span className="text-[10px] text-slate-400 font-mono">{dayInfo.monthShort} {dayInfo.dayNumber}</span>
                        </div>
                        <button
                          onClick={() => {
                            setEditingTask(null);
                            setModalDate(dayInfo.dateKey);
                            setIsModalOpen(true);
                          }}
                          data-testid={`week-grid-add-${dayInfo.dayShort.toLowerCase()}`}
                          className="text-xs text-rose-400 font-bold hover:text-white"
                        >
                          +
                        </button>
                      </div>

                      <div className="p-2.5 space-y-2 flex-1 min-h-[180px]">
                        {dayTasks.map(t => (
                          <div key={t.id} className="p-2 rounded-lg bg-[#181b30] border border-slate-700 text-xs">
                            <div className="text-[10px] font-mono text-rose-300">{t.startTime} - {t.endTime}</div>
                            <div className="font-bold text-white truncate mt-0.5">{t.title}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

          </div>
        )}

        {/* VIEW 2: 24h CHRONOLOGICAL TIMELINE */}
        {activeTab === 'timeline' && (
          <div className="space-y-6 max-w-4xl mx-auto">
            <div className="clean-card legend-border p-5 border border-purple-500/30 bg-gradient-to-r from-[#121424] via-[#1b1029] to-[#121424]">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-300 text-xl font-bold">
                  ⏱️
                </div>
                <div>
                  <div className="text-xs font-mono font-bold text-purple-400 uppercase tracking-wider">
                    Sacred Gear Radar • Date: {activeDayKey}
                  </div>
                  <h3 className="text-base sm:text-lg font-bold text-white mt-0.5">
                    Chronological Quest Flow with {selectedCompanion.name}
                  </h3>
                  <p className="text-xs text-slate-400">Current Local Time: {currentTime.toLocaleTimeString()}</p>
                </div>
              </div>
            </div>

            <div className="clean-card p-6">
              <div className="relative pl-6 sm:pl-8 border-l-2 border-rose-800/60 space-y-6">
                {activeDayTasks.length === 0 ? (
                  <div className="py-10 text-center text-slate-500">
                    <p className="text-sm font-bold text-slate-300">No quests on this timeline.</p>
                  </div>
                ) : (
                  activeDayTasks.map(task => (
                    <div key={task.id} className="relative group">
                      <div className={`absolute -left-[31px] sm:-left-[39px] top-3 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        task.completed ? 'bg-rose-600 border-rose-400 text-white font-bold text-xs' : 'bg-slate-900 border-rose-400'
                      }`}>
                        {task.completed ? '✓' : <div className="w-1.5 h-1.5 rounded-full bg-rose-400" />}
                      </div>

                      <div className="p-4 rounded-2xl bg-[#181b30] border border-slate-700/80">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="font-mono text-xs font-bold text-rose-300">⏰ {task.startTime} - {task.endTime}</span>
                          <button
                            onClick={() => handleToggleComplete(task.id)}
                            data-testid={`timeline-toggle-${task.id}`}
                            className={`px-2.5 py-1 rounded-xl text-xs font-bold border ${
                              task.completed ? 'bg-rose-600/30 text-rose-200 border-rose-500/50' : 'bg-slate-800 text-slate-300'
                            }`}
                          >
                            {task.completed ? 'Cleared! ✓' : 'Mark Done'}
                          </button>
                        </div>
                        <h4 className={`text-sm font-bold ${task.completed ? 'line-through text-slate-500' : 'text-white'}`}>
                          {task.title}
                        </h4>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* VIEW 3: BOOSTED GEAR POMODORO FOCUS */}
        {activeTab === 'pomodoro' && (
          <div className="max-w-2xl mx-auto clean-card p-6 sm:p-8 text-center space-y-6 bg-gradient-to-b from-[#1b0a13] via-[#121424] to-[#0d0f1a] border border-rose-500/40">
            <div className="flex items-center justify-center gap-3">
              <div
                className="w-14 h-14 rounded-2xl overflow-hidden border-2 border-rose-500/60 shadow-lg shadow-rose-500/20"
                dangerouslySetInnerHTML={{ __html: selectedCompanion.avatarSvg }}
              />
              <div className="text-left">
                <h3 className="text-base font-bold font-display text-rose-300">
                  Boosted Gear Chamber • {selectedCompanion.name}
                </h3>
                <p className="text-xs text-slate-400">
                  {pomoMode === 'focus' ? selectedCompanion.dialogues.onPomodoro : 'Rest and replenish your stamina!'}
                </p>
              </div>
            </div>

            {activeFocusTask && (
              <div className="p-3 rounded-2xl bg-rose-950/40 border border-rose-500/40 text-xs text-rose-200">
                Active Target: <strong>{activeFocusTask.title}</strong>
              </div>
            )}

            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => {
                  setPomoRunning(false);
                  setPomoMode('focus');
                  setPomoDuration(25);
                  setPomoTimeLeft(25 * 60);
                  audio.playClick();
                }}
                data-testid="pomo-25-button"
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold ${
                  pomoMode === 'focus' && pomoDuration === 25 ? 'bg-rose-600 text-white font-black' : 'bg-slate-800 text-slate-400'
                }`}
              >
                25m Dragon Boost
              </button>
              <button
                onClick={() => {
                  setPomoRunning(false);
                  setPomoMode('focus');
                  setPomoDuration(50);
                  setPomoTimeLeft(50 * 60);
                  audio.playClick();
                }}
                data-testid="pomo-50-button"
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold ${
                  pomoMode === 'focus' && pomoDuration === 50 ? 'bg-purple-600 text-white font-black' : 'bg-slate-800 text-slate-400'
                }`}
              >
                50m Welsh Dragon Flow
              </button>
              <button
                onClick={() => {
                  setPomoRunning(false);
                  setPomoMode('break');
                  setPomoDuration(5);
                  setPomoTimeLeft(5 * 60);
                  audio.playClick();
                }}
                data-testid="pomo-break-button"
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold ${
                  pomoMode === 'break' ? 'bg-emerald-500 text-slate-950 font-black' : 'bg-slate-800 text-slate-400'
                }`}
              >
                5m Twilight Rest
              </button>
            </div>

            <div className={`w-56 h-56 mx-auto rounded-full border-8 border-rose-500/40 flex flex-col items-center justify-center relative shadow-2xl shadow-rose-500/20 bg-[#101322] ${pomoRunning ? 'legend-timer-running' : ''}`}>
              <span className="text-5xl font-mono font-black text-white" data-testid="pomo-timer-display">{pomoMins}:{pomoSecs}</span>
              <span className="text-[10px] font-bold tracking-widest uppercase text-rose-400 mt-2 font-mono">
                {pomoRunning ? 'BOOSTING ACTIVE' : 'PAUSED'}
              </span>
            </div>

            <div className="flex items-center justify-center gap-4">
              <button
                onClick={() => {
                  setPomoRunning(false);
                  setPomoTimeLeft(pomoDuration * 60);
                  audio.playClick();
                }}
                data-testid="pomo-reset-button"
                className="p-3.5 rounded-2xl bg-slate-800 text-slate-300 hover:bg-slate-700"
                title="Reset"
              >
                🔄
              </button>
              <button
                onClick={() => {
                  if (!pomoRunning) audio.playBoost();
                  else audio.playClick();
                  setPomoRunning(!pomoRunning);
                }}
                data-testid="pomo-start-button"
                className="px-8 py-3.5 rounded-2xl bg-gradient-to-r from-rose-600 via-purple-600 to-amber-500 text-white font-bold text-sm shadow-lg hover:scale-105 transition-all"
              >
                {pomoRunning ? 'Pause Boost' : 'Commence Boosted Focus'}
              </button>
            </div>
          </div>
        )}

        {/* VIEW 4: PEERAGE RANK & STATS */}
        {activeTab === 'peerage' && (
          <div className="space-y-6 max-w-4xl mx-auto">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div className="clean-card legend-border p-5 border border-rose-500/30">
                <span className="text-xs text-slate-400">Peerage Quests</span>
                <div className="text-2xl font-black text-white mt-1" data-testid="stat-total-quests">{tasks.length} Missions</div>
              </div>
              <div className="clean-card legend-border p-5 border border-purple-500/30">
                <span className="text-xs text-slate-400">Accomplished</span>
                <div className="text-2xl font-black text-purple-300 mt-1" data-testid="stat-cleared-quests">
                  {tasks.filter(t => t.completed).length} Cleared
                </div>
              </div>
              <div className="clean-card legend-border p-5 border border-amber-500/30">
                <span className="text-xs text-slate-400">Devil Rank</span>
                <div className="text-xl font-black text-amber-300 mt-1" data-testid="stat-devil-rank">{peerageRankName}</div>
              </div>
              <div className="clean-card legend-border p-5 border border-emerald-500/30">
                <span className="text-xs text-slate-400">Total Demonic XP</span>
                <div className="text-2xl font-black text-emerald-300 mt-1" data-testid="stat-total-xp">{peerageXP} XP ⚡</div>
              </div>
            </div>

            <div className="clean-card p-6">
              <h3 className="text-sm font-bold text-white mb-4">👑 Evil Pieces Balance</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {EVIL_PIECE_RANKS.map(rank => {
                  const count = tasks.filter(t => t.priority === rank.id).length;
                  return (
                    <div key={rank.id} className="p-3.5 rounded-xl bg-[#181b30] border border-slate-700 flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-200">{rank.label.split('•')[0]}</span>
                      <span className="text-xs font-mono font-bold text-rose-400">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* VIEW 5: MASTER PROFILE (OCCULT RESEARCH CLUB MEMBER DOSSIER) */}
        {activeTab === 'profile' && (
          <div className="space-y-6 max-w-4xl mx-auto" data-testid="master-profile-view">
            
            {/* PROFILE HEADER CARD */}
            <div className="clean-card p-6 md:p-8 relative overflow-hidden border border-rose-500/40 shadow-2xl bg-gradient-to-br from-[#15172b] via-[#121424] to-[#0a0b16]">
              <div className="absolute top-0 right-0 w-80 h-80 bg-rose-600/10 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute bottom-0 left-0 w-64 h-64 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />

              <div className="relative z-10 flex flex-col md:flex-row items-center md:items-start gap-6">
                
                {/* Heroine / Devil Avatar Crest */}
                <div className="relative group">
                  <div className="w-28 h-28 md:w-32 md:h-32 rounded-3xl p-1 bg-gradient-to-tr from-rose-600 via-purple-600 to-amber-500 shadow-xl shadow-rose-600/30 flex items-center justify-center">
                    <div
                      className="w-full h-full rounded-[22px] bg-[#0c0e1a] overflow-hidden flex items-center justify-center p-2"
                      dangerouslySetInnerHTML={{ __html: selectedCompanion.avatarSvg }}
                      title={`Pact Heroine: ${selectedCompanion.name}`}
                    />
                  </div>
                  <div className="absolute -bottom-2 -right-2 bg-rose-600 text-white text-[10px] font-black px-2.5 py-1 rounded-full border border-rose-300 shadow-md uppercase tracking-wider flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-amber-300" />
                    <span>Lv.{promoLevel}</span>
                  </div>
                </div>

                {/* Profile Details */}
                <div className="flex-1 text-center md:text-left space-y-3">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center justify-center md:justify-start gap-2.5">
                        <h2 className="text-2xl md:text-3xl font-black text-white" style={{ fontFamily: "Cinzel, serif" }}>
                          {user?.name || user?.email?.split('@')[0] || "Occult Researcher"}
                        </h2>
                        <button
                          onClick={() => {
                            audio.playClick();
                            setEditNameInput(user?.name || user?.email?.split('@')[0] || "");
                            setEditTitleInput(userTitle);
                            setIsEditingProfile(!isEditingProfile);
                          }}
                          data-testid="edit-profile-button"
                          className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-rose-950 text-slate-300 hover:text-rose-300 border border-slate-700 transition-colors"
                          title="Edit Name & Devil Title"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <p className="text-xs text-rose-400 font-semibold tracking-wide mt-0.5 flex items-center justify-center md:justify-start gap-1.5">
                        <Flame className="w-3.5 h-3.5 text-rose-500" />
                        <span>{userTitle}</span>
                      </p>
                    </div>

                    {/* Sync Status Badge */}
                    <div className="flex items-center justify-center md:justify-end gap-2">
                      <div className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 ${
                        fbCloud
                          ? "bg-emerald-950/40 border-emerald-500/50 text-emerald-300"
                          : "bg-amber-950/40 border-amber-500/50 text-amber-300"
                      }`}>
                        {fbCloud ? <Cloud className="w-3.5 h-3.5 text-emerald-400" /> : <Database className="w-3.5 h-3.5 text-amber-400" />}
                        <span>{fbCloud ? "Cloud Synced (Isolated)" : "Local Storage"}</span>
                      </div>
                    </div>
                  </div>

                  {/* Account Metadata Row */}
                  <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 pt-1 text-xs">
                    <div className="px-3 py-1 rounded-lg bg-slate-900/80 border border-slate-700/70 text-slate-300 flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5 text-slate-400" />
                      <span>{user?.email || "No email"}</span>
                    </div>

                    <div className="px-3 py-1 rounded-lg bg-slate-900/80 border border-slate-700/70 text-slate-300 flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5 text-rose-400" />
                      <span className="font-mono text-[11px] text-slate-400">UID:</span>
                      <span className="font-mono text-[11px] text-rose-200">
                        {user?.id ? `${user.id.slice(0, 10)}...${user.id.slice(-4)}` : "Guest"}
                      </span>
                      {user?.id && (
                        <button
                          onClick={handleCopyUid}
                          className="ml-1 text-slate-400 hover:text-white transition-colors"
                          title="Copy Full UID"
                        >
                          {copyStatus ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        </button>
                      )}
                    </div>

                    <div className="px-3 py-1 rounded-lg bg-slate-900/80 border border-slate-700/70 text-slate-300 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />
                      <span>Gremory Peerage Verified</span>
                    </div>
                  </div>

                  {/* Inline Profile Edit Form */}
                  {isEditingProfile && (
                    <form onSubmit={handleSaveProfile} className="mt-4 p-4 rounded-2xl bg-[#090b14] border border-rose-500/40 space-y-3">
                      <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                        <Edit3 className="w-3.5 h-3.5 text-rose-400" />
                        <span>Update Occult Identity</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-400 mb-1">Display Name</label>
                          <input
                            type="text"
                            value={editNameInput}
                            onChange={(e) => setEditNameInput(e.target.value)}
                            placeholder="Your Name"
                            className="w-full px-3 py-1.5 bg-[#121424] border border-slate-700 rounded-xl text-white text-xs focus:outline-none focus:border-rose-500"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-400 mb-1">Devil Title / Bio</label>
                          <input
                            type="text"
                            value={editTitleInput}
                            onChange={(e) => setEditTitleInput(e.target.value)}
                            placeholder="e.g. Red Dragon Emperor"
                            className="w-full px-3 py-1.5 bg-[#121424] border border-slate-700 rounded-xl text-white text-xs focus:outline-none focus:border-rose-500"
                          />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setIsEditingProfile(false)}
                          className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-md shadow-rose-600/30 transition-colors"
                        >
                          Save Changes
                        </button>
                      </div>
                    </form>
                  )}
                </div>

              </div>
            </div>

            {/* TWO COLUMN GRID: PEERAGE LEVEL & ACTIVE HEROINE */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              
              {/* PEERAGE RANK PROGRESSION */}
              <div className="clean-card p-6 border border-amber-500/30 space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">👑</span>
                    <h3 className="font-bold text-sm text-white">Peerage Rank & Mastery</h3>
                  </div>
                  <span className="text-xs font-mono font-bold text-amber-400 bg-amber-950/50 px-2.5 py-1 rounded-lg border border-amber-600/40">
                    Level {promoLevel}
                  </span>
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs text-slate-400 font-medium">Demonic Status:</span>
                    <span className="text-sm font-black text-amber-300">{peerageRankName}</span>
                  </div>

                  {/* Progress Bar */}
                  <div>
                    <div className="flex justify-between text-[11px] text-slate-400 mb-1 font-mono">
                      <span>Demonic XP: {peerageXP}</span>
                      <span>Next Level: {(promoLevel) * 100} XP</span>
                    </div>
                    <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden p-0.5 border border-slate-700">
                      <div
                        className="h-full bg-gradient-to-r from-amber-500 to-rose-500 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, (peerageXP % 100))}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1.5">
                      Earn <span className="text-rose-400 font-bold">+{100 - (peerageXP % 100)} XP</span> to advance your peerage standing.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 text-xs">
                  <div className="p-2.5 rounded-xl bg-[#17192d] border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Focus Sessions</span>
                    <span className="font-mono font-black text-white text-base">
                      {Math.floor(peerageXP / 40)} Cycles ⚡
                    </span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#17192d] border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Missions Cleared</span>
                    <span className="font-mono font-black text-emerald-400 text-base">
                      {tasks.filter(t => t.completed).length} Quests ✓
                    </span>
                  </div>
                </div>
              </div>

              {/* CONTRACTED HEROINE PACT */}
              <div className="clean-card p-6 border border-rose-500/30 space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">💋</span>
                    <h3 className="font-bold text-sm text-white">Active Devil Contract</h3>
                  </div>
                  <span className="text-[11px] font-bold text-rose-400 bg-rose-950/50 px-2 py-0.5 rounded-lg border border-rose-600/40">
                    {selectedCompanion.piece}
                  </span>
                </div>

                <div className="flex items-center gap-4">
                  <div
                    className="w-16 h-16 rounded-2xl bg-[#0c0e1a] p-1.5 border border-rose-500/40 shrink-0"
                    dangerouslySetInnerHTML={{ __html: selectedCompanion.avatarSvg }}
                  />
                  <div>
                    <h4 className="font-black text-white text-base">{selectedCompanion.name}</h4>
                    <p className="text-xs text-rose-300 italic">"{selectedCompanion.quote}"</p>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800/80">
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1.5">
                    Switch Active Contracted Companion:
                  </label>
                  <select
                    value={selectedCompanion.id}
                    onChange={(e) => {
                      const comp = DXD_HEROINES.find(c => c.id === e.target.value);
                      if (comp) {
                        setSelectedCompanion(comp);
                        audio.playVictory();
                      }
                    }}
                    className="w-full px-3 py-2 bg-[#17192d] border border-slate-700 rounded-xl text-white text-xs focus:outline-none focus:border-rose-500 font-semibold"
                  >
                    {DXD_HEROINES.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name} — {c.piece}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

            </div>

            {/* QUEST CODEX & DATA ISOLATION STATS */}
            <div className="clean-card p-6 border border-purple-500/30 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="text-xl">📊</span>
                  <h3 className="font-bold text-sm text-white">Personal Quest Codex & Productivity</h3>
                </div>
                <span className="text-xs text-purple-300 font-mono">
                  {tasks.length ? Math.round((tasks.filter(t => t.completed).length / tasks.length) * 100) : 0}% Complete
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-xl bg-[#17192d] border border-slate-800 text-center">
                  <span className="text-[11px] text-slate-400 block">Total Quests</span>
                  <span className="text-xl font-black text-white mt-0.5 block">{tasks.length}</span>
                </div>
                <div className="p-3 rounded-xl bg-[#17192d] border border-slate-800 text-center">
                  <span className="text-[11px] text-slate-400 block">Accomplished</span>
                  <span className="text-xl font-black text-emerald-400 mt-0.5 block">
                    {tasks.filter(t => t.completed).length}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-[#17192d] border border-slate-800 text-center">
                  <span className="text-[11px] text-slate-400 block">In Progress</span>
                  <span className="text-xl font-black text-amber-400 mt-0.5 block">
                    {tasks.filter(t => !t.completed).length}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-[#17192d] border border-slate-800 text-center">
                  <span className="text-[11px] text-slate-400 block">Sacred Boost</span>
                  <span className="text-xl font-black text-purple-400 mt-0.5 block">
                    {tasks.filter(t => t.category === "sacred-gear").length}
                  </span>
                </div>
              </div>

              {/* Evil Piece distribution */}
              <div className="pt-2">
                <h4 className="text-xs font-bold text-slate-300 mb-2.5">Evil Piece Distribution in Your Codex:</h4>
                <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                  {EVIL_PIECE_RANKS.map(rank => {
                    const count = tasks.filter(t => t.priority === rank.id).length;
                    return (
                      <div key={rank.id} className="p-2.5 rounded-xl bg-[#101221] border border-slate-800 text-center">
                        <span className="text-[10px] text-slate-400 block">{rank.label.split('•')[0]}</span>
                        <span className="text-sm font-bold text-rose-400 mt-0.5 block">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* DATA PRIVACY & VAULT MANAGEMENT */}
            <div className="clean-card p-6 border border-slate-700/60 bg-[#0d0f1c] space-y-4">
              <div className="flex items-center gap-2.5 text-sm font-bold text-white">
                <Shield className="w-4 h-4 text-emerald-400" />
                <span>Private Vault & Account Actions</span>
              </div>

              <div className="p-3.5 rounded-xl bg-[#14172a] border border-emerald-500/20 text-xs text-slate-300 space-y-1.5">
                <p className="font-semibold text-emerald-300 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Strict Per-User Cloud Isolation Active</span>
                </p>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Your timetable missions, contracted heroine, and demonic XP are uniquely tied to your UID:
                  <span className="font-mono text-slate-200 ml-1">kuohflow_users/{user?.id || "guest"}</span>.
                  No other user can read or modify your missions.
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={handleExportTasks}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold flex items-center gap-1.5 border border-slate-700 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5 text-rose-400" />
                    <span>Export Missions (JSON)</span>
                  </button>
                  <button
                    onClick={handleResetTasks}
                    className="px-4 py-2 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 text-xs font-bold flex items-center gap-1.5 border border-rose-800/40 transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Reset to Welcome Quests</span>
                  </button>
                </div>

                <button
                  onClick={() => {
                    audio.playClick();
                    if (window.confirm("Sign out of Occult Research Club?")) logout();
                  }}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-rose-600/30 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign Out</span>
                </button>
              </div>
            </div>

          </div>
        )}

      </main>

      {/* TASK CREATION & EDIT MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="clean-card modal-pop rounded-3xl w-full max-w-md p-6 bg-[#121424] border border-rose-500/50 shadow-2xl">
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-800">
              <h3 className="font-bold text-base text-white flex items-center gap-2">
                <span>👑</span>
                <span>{editingTask ? 'Edit Peerage Mission' : 'Schedule New Quest'}</span>
              </h3>
              <button onClick={() => setIsModalOpen(false)} data-testid="modal-close-button" className="text-slate-400 hover:text-white text-base">✕</button>
            </div>

            <form onSubmit={(e) => {
              e.preventDefault();
              const f = e.target;
              handleSaveTask({
                id: editingTask ? editingTask.id : 'task-' + Date.now(),
                title: f.title.value.trim(),
                description: f.description.value.trim(),
                date: f.date.value,
                startTime: f.startTime.value,
                endTime: f.endTime.value,
                category: f.category.value,
                priority: f.priority.value,
                reminderOffset: Number(f.reminderOffset.value),
                completed: editingTask ? editingTask.completed : false,
                note: f.note.value.trim() || `${selectedCompanion.name}: Fight with pride!`
              });
              setIsModalOpen(false);
            }} className="space-y-3.5 text-xs" data-testid="task-form">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Quest Title *</label>
                <input name="title" required defaultValue={editingTask?.title || ''} placeholder="e.g. Master Boosted Gear Architecture" className="w-full px-3.5 py-2.5 bg-[#0a0b14] border border-slate-700 rounded-xl text-white focus:outline-none focus:border-rose-500" />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Objectives</label>
                <input name="description" defaultValue={editingTask?.description || ''} placeholder="Optional notes..." className="w-full px-3 py-2 bg-[#0a0b14] border border-slate-700 rounded-xl text-white focus:outline-none focus:border-rose-500" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Calendar Date *</label>
                  <input type="date" name="date" required defaultValue={editingTask?.date || modalDate} className="w-full px-3 py-2 bg-[#0a0b14] border border-slate-700 rounded-xl text-white font-mono" />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Domain</label>
                  <select name="category" defaultValue={editingTask?.category || 'sacred-gear'} className="w-full px-3 py-2 bg-[#0a0b14] border border-slate-700 rounded-xl text-white">
                    {MISSION_CATEGORIES.filter(c => c.id !== 'all').map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Start Time</label>
                  <input type="time" name="startTime" defaultValue={editingTask?.startTime || '09:00'} className="w-full px-3 py-2 bg-[#0a0b14] border border-slate-700 rounded-xl text-white font-mono" />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">End Time</label>
                  <input type="time" name="endTime" defaultValue={editingTask?.endTime || '10:30'} className="w-full px-3 py-2 bg-[#0a0b14] border border-slate-700 rounded-xl text-white font-mono" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Evil Piece Rank</label>
                  <select name="priority" defaultValue={editingTask?.priority || 'King'} className="w-full px-3 py-2 bg-[#0a0b14] border border-slate-700 rounded-xl text-white">
                    {EVIL_PIECE_RANKS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Reminder</label>
                  <select name="reminderOffset" defaultValue={editingTask?.reminderOffset !== undefined ? editingTask.reminderOffset : 5} className="w-full px-3 py-2 bg-[#0a0b14] border border-slate-700 rounded-xl text-white">
                    <option value="0">At time of mission</option>
                    <option value="5">5 mins before</option>
                    <option value="10">10 mins before</option>
                    <option value="15">15 mins before</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Heroine Note</label>
                <input name="note" defaultValue={editingTask?.note || `${selectedCompanion.name}: Fight with pride!`} className="w-full px-3.5 py-2 bg-[#0a0b14] border border-slate-700 rounded-xl text-rose-300 focus:outline-none focus:border-rose-500" />
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-800">
                <button type="button" onClick={() => setIsModalOpen(false)} data-testid="modal-cancel-button" className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 font-semibold">
                  Cancel
                </button>
                <button type="submit" data-testid="modal-save-button" className="kf-btn-primary px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl shadow-lg shadow-rose-600/30">
                  {editingTask ? 'Update Mission' : 'Save Mission'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

export default KuohFlowApp;
