import React, { useState, useEffect, useRef, useCallback } from "react";
import { Trash2, Send, Heart, Sparkles, MessageCircleHeart, X, ImagePlus } from "lucide-react";
import { GIRLFRIEND } from "./data";
import { getToken } from "./Auth";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const getSessionId = (user) => {
  if (user && user.id) return `user-${user.id}`;
  let sid = localStorage.getItem("kuohflow_gf_session");
  if (!sid) {
    sid = `gf-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    localStorage.setItem("kuohflow_gf_session", sid);
  }
  return sid;
};

const moodFromUserText = (t = "") => {
  const s = t.toLowerCase();
  if (/(miss you|love|cute|beautiful|gorgeous|pretty|kiss|hug|date)/.test(s)) return "shy";
  if (/(sad|tired|stressed|anxious|bad day|exhausted|depress|lonely)/.test(s)) return "sad";
  if (/(done|finished|completed|passed|won|promoted|cleared|level up)/.test(s)) return "happy";
  if (/(hi|hello|hey|yo|good morning|good evening|good night)/.test(s)) return "wink";
  return "idle";
};

export function LiveAvatar({ mood = "idle", speaking = false, className = "" }) {
  return (
    <div className={`gf-avatar gf-breathe ${speaking ? "gf-speaking" : ""} ${className}`} data-testid="gf-live-avatar">
      {Object.entries(GIRLFRIEND.images).map(([key, url]) => (
        <img
          key={key}
          src={url}
          alt="Rias Gremory — animated anime girlfriend"
          className={`gf-avatar-img ${mood === key ? "is-active" : ""}`}
          draggable={false}
        />
      ))}
      <div className="gf-avatar-shine" />
      <div className="gf-avatar-vignette" />
    </div>
  );
}

export default function GirlfriendChat({ audio, stats, user }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [mood, setMood] = useState("idle");
  const [unread, setUnread] = useState(0);
  const [bubbleText, setBubbleText] = useState("");
  const [hearts, setHearts] = useState([]);

  const isOpenRef = useRef(isOpen);
  const scrollRef = useRef(null);
  const streamAbortRef = useRef(null);
  const fileInputRef = useRef(null);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => { isOpenRef.current = isOpen; }, [isOpen]);

  const burstHearts = useCallback((n = 5) => {
    const batch = Array.from({ length: n }, (_, i) => ({
      id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      x: 10 + Math.random() * 72,
      delay: Math.random() * 0.35,
      scale: 0.7 + Math.random() * 0.7,
    }));
    setHearts((prev) => [...prev, ...batch]);
    setTimeout(() => setHearts((prev) => prev.filter((h) => !batch.some((b) => b.id === h.id))), 2800);
  }, []);

  useEffect(() => {
    (async () => {
      const fallback = [{ id: "welcome", role: "rias", content: "Finally~ You opened this. I was starting to think the club president would have to summon you herself, darling ♥" }];
      try {
        const res = await fetch(`${API}/chat/history?session_id=${encodeURIComponent(getSessionId(user))}`, { headers: { Authorization: `Bearer ${getToken()}` } });
        const data = await res.json();
        if (Array.isArray(data.messages) && data.messages.length) {
          setMessages(data.messages.map((m) => ({ id: m.id, role: m.role, content: m.content, image: m.image_path ? `${API}/files/${m.image_path}` : undefined })));
        } else {
          setMessages(fallback);
        }
      } catch {
        setMessages(fallback);
      }
    })();
  }, [user && user.id]);

  // Floating speech bubble — typewriter that cycles her whispers
  useEffect(() => {
    if (isOpen) return undefined;
    let lineIdx = 0;
    let charIdx = 0;
    let timer;
    const tick = () => {
      const line = GIRLFRIEND.bubbleLines[lineIdx];
      charIdx += 1;
      setBubbleText(line.slice(0, charIdx));
      if (charIdx < line.length) {
        timer = setTimeout(tick, 42);
      } else {
        timer = setTimeout(() => {
          lineIdx = (lineIdx + 1) % GIRLFRIEND.bubbleLines.length;
          charIdx = 0;
          setBubbleText("");
          tick();
        }, 4600);
      }
    };
    tick();
    return () => clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streamText, isTyping, isOpen]);

  const openChat = () => { audio.playBoost(); setIsOpen(true); setUnread(0); };
  const closeChat = () => { audio.playClick(); setIsOpen(false); };

  const clearChat = async () => {
    audio.playClick();
    const sid = getSessionId(user);
    localStorage.removeItem("kuohflow_gf_session");
    try { streamAbortRef.current?.abort(); } catch (e) {}
    try { await fetch(`${API}/chat/history?session_id=${encodeURIComponent(sid)}`, { method: "DELETE" }); } catch (e) {}
    setMessages([{ id: "welcome2", role: "rias", content: "A fresh page between us, darling. Where shall we begin? ♥" }]);
    setMood("wink");
  };

  const sendMessage = async (rawText, imagePath = "") => {
    const text = (rawText ?? input).trim();
    if ((!text && !imagePath) || isTyping) return;
    audio.playClick();
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", content: text || "📷 Photo", image: imagePath ? `${API}/files/${imagePath}` : undefined }]);
    setInput("");
    setIsTyping(true);
    setStreamText("");
    setMood(moodFromUserText(text));
    burstHearts(3);

    const controller = new AbortController();
    streamAbortRef.current = controller;
    let acc = "";

    try {
      const res = await fetch(`${API}/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          session_id: getSessionId(user),
          message: text || (imagePath ? "(sent you a photo — react to it!)" : ""),
          image_path: imagePath,
          total_tasks: stats.total,
          completed_tasks: stats.completed,
          xp: stats.xp,
          rank: stats.rank,
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error("stream unavailable");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const raw = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 2);
          if (!raw.startsWith("data:")) continue;
          const evt = JSON.parse(raw.slice(5).trim());
          if (evt.type === "delta") {
            acc += evt.delta;
            setStreamText(acc);
          } else if (evt.type === "done") {
            setMood(evt.mood || "happy");
          } else if (evt.type === "error") {
            acc = evt.message;
            setStreamText(acc);
          }
        }
      }

      if (acc) {
        setMessages((prev) => [...prev, { id: `r-${Date.now()}`, role: "rias", content: acc }]);
        audio.playBoost();
        burstHearts(5);
        if (!isOpenRef.current) setUnread((u) => u + 1);
      }
    } catch (e) {
      if (e?.name !== "AbortError") {
        setMessages((prev) => [...prev, { id: `e-${Date.now()}`, role: "rias", content: "The magic circle flickered and my reply was lost in the Devil's net, darling. Say that again for me?" }]);
      }
    } finally {
      setStreamText("");
      setIsTyping(false);
      streamAbortRef.current = null;
    }
  };

  const handleImagePick = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file || isTyping) return;
    if (file.size > 10 * 1024 * 1024) {
      setMessages((prev) => [...prev, { id: `w-${Date.now()}`, role: "rias", content: "That memory is too heavy for our magic circle, darling — keep photos under 10MB ♥" }]);
      return;
    }
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API}/upload`, { method: "POST", body: fd });
      if (!res.ok) throw new Error("upload failed");
      const data = await res.json();
      const caption = input.trim();
      await sendMessage(caption, data.path);
    } catch (err) {
      setMessages((prev) => [...prev, { id: `w2-${Date.now()}`, role: "rias", content: "The photo got lost crossing the magic circle, darling. Try again for me? ♥" }]);
    } finally {
      setIsUploading(false);
    }
  };

  const HeartsLayer = () => (
    <div className="pointer-events-none absolute inset-0 overflow-visible">
      {hearts.map((h) => (
        <span
          key={h.id}
          className="gf-heart"
          style={{ left: `${h.x}%`, animationDelay: `${h.delay}s` }}
        >
          <Heart style={{ transform: `scale(${h.scale})`, width: 14, height: 14 }} fill="currentColor" />
        </span>
      ))}
    </div>
  );

  return (
    <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end">
      {isOpen ? (
        <div className="gf-panel w-[min(380px,calc(100vw-2.5rem))] rounded-3xl overflow-hidden bg-[#121424]/97 border border-rose-500/50 shadow-2xl shadow-rose-950/50 backdrop-blur-xl relative" data-testid="gf-chat-panel">
          {/* HEADER — live animated anime girl */}
          <div className="relative flex items-center gap-3 p-4 bg-gradient-to-r from-[#2a0a16] via-[#16182a] to-[#1a1030] border-b border-rose-500/30">
            <LiveAvatar mood={mood} speaking={isTyping} className="w-16 h-16 rounded-2xl ring-2 ring-rose-500/70 shadow-lg shadow-rose-500/30 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-black text-white font-display">Rias Gremory</span>
                <Heart className="w-3.5 h-3.5 text-rose-400 fill-rose-500" />
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="text-[10px] text-slate-400 font-semibold">Online • Your Girlfriend</span>
              </div>
              <span className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-950/70 border border-rose-500/40 text-rose-300 font-mono" data-testid="gf-mood-chip">
                <Sparkles className="w-3 h-3" />
                {GIRLFRIEND.moodLabels[mood]}
              </span>
            </div>
            <div className="flex flex-col gap-1.5 flex-shrink-0">
              <button onClick={clearChat} data-testid="gf-clear-button" title="Clear conversation" className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-rose-950/60 text-slate-400 hover:text-rose-300 transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button onClick={closeChat} data-testid="gf-minimize-button" title="Close chat — back to normal" className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-rose-950/60 text-slate-400 hover:text-rose-300 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* MESSAGES */}
          <div ref={scrollRef} className="overflow-y-auto p-3 space-y-2.5 bg-[#0d0f1c]" style={{ maxHeight: "46vh", minHeight: "240px" }} data-testid="gf-messages">
            {messages.map((m) => (
              m.role === "user" ? (
                <div key={m.id} className="gf-msg-in flex justify-end" data-testid="gf-message-user">
                  <div className="max-w-[85%] px-3.5 py-2 rounded-2xl rounded-br-sm text-xs leading-relaxed bg-gradient-to-r from-rose-600 to-purple-600 text-white shadow-md shadow-rose-900/40">
                    {m.image && <img src={m.image} alt="Shared with Rias" className="gf-msg-image" data-testid="gf-message-image" draggable={false} />}
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={m.id} className="gf-msg-in flex justify-start" data-testid="gf-message-rias">
                  <div className="max-w-[88%] px-3.5 py-2 rounded-2xl rounded-bl-sm text-xs leading-relaxed bg-[#1b1e33] border border-rose-500/25 text-slate-100">
                    {m.content}
                  </div>
                </div>
              )
            ))}

            {isTyping && !streamText && (
              <div className="gf-msg-in flex justify-start" data-testid="gf-typing-indicator">
                <div className="px-4 py-3 rounded-2xl rounded-bl-sm bg-[#1b1e33] border border-rose-500/25 flex items-center gap-1.5">
                  <span className="gf-typing-dot" />
                  <span className="gf-typing-dot" style={{ animationDelay: "0.15s" }} />
                  <span className="gf-typing-dot" style={{ animationDelay: "0.3s" }} />
                </div>
              </div>
            )}

            {isTyping && streamText && (
              <div className="gf-msg-in flex justify-start">
                <div className="max-w-[88%] px-3.5 py-2 rounded-2xl rounded-bl-sm text-xs leading-relaxed bg-[#1b1e33] border border-rose-500/25 text-slate-100">
                  {streamText}
                  <span className="gf-caret" />
                </div>
              </div>
            )}
          </div>

          {/* QUICK PROMPTS */}
          {messages.length <= 2 && !isTyping && (
            <div
              className="flex gap-1.5 px-3 pb-1.5 pt-0.5 overflow-x-auto no-scrollbar bg-[#0d0f1c]"
              style={{ WebkitMaskImage: "linear-gradient(to right, black 80%, transparent 99%)", maskImage: "linear-gradient(to right, black 80%, transparent 99%)" }}
            >
              {GIRLFRIEND.quickPrompts.map((p) => (
                <button
                  key={p}
                  data-testid="gf-quick-chip"
                  onClick={() => sendMessage(p)}
                  className="flex-shrink-0 px-3 py-1.5 rounded-full text-[10.5px] font-bold bg-[#16182a] border border-rose-500/30 text-rose-200 hover:bg-rose-950/50 hover:border-rose-500/60 transition-all"
                >
                  {p}
                </button>
              ))}
            </div>
          )}

          {/* INPUT */}
          <form
            onSubmit={(e) => { e.preventDefault(); sendMessage(); }}
            className="flex items-center gap-2 p-3 border-t border-slate-800 bg-[#121424] relative"
          >
            <input
              type="file"
              accept="image/*"
              ref={fileInputRef}
              onChange={handleImagePick}
              data-testid="gf-image-input"
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isTyping || isUploading}
              data-testid="gf-image-button"
              title="Send her a photo ♥"
              className={`w-10 h-10 rounded-full grid place-items-center flex-shrink-0 transition-all ${
                isTyping || isUploading
                  ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                  : "bg-[#16182a] border border-rose-500/40 text-rose-300 hover:scale-110 hover:bg-rose-950/50 active:scale-95"
              }`}
            >
              <ImagePlus className={`w-4 h-4 ${isUploading ? "animate-pulse" : ""}`} />
            </button>
            <input
              data-testid="gf-message-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isUploading ? "Sending your photo..." : "Whisper to Rias..."}
              className="flex-1 px-4 py-2.5 bg-[#0a0b14] border border-slate-700 rounded-full text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-500 focus:shadow-[0_0_12px_rgba(225,29,72,0.25)] transition-all"
            />
            <button
              type="submit"
              data-testid="gf-send-button"
              disabled={(!input.trim() && !isUploading) || isTyping}
              className={`w-10 h-10 rounded-full grid place-items-center flex-shrink-0 transition-all ${
                input.trim() && !isTyping
                  ? "gf-send-pulse bg-gradient-to-tr from-rose-600 via-purple-600 to-amber-500 text-white hover:scale-110 active:scale-95"
                  : "bg-slate-800 text-slate-500 cursor-not-allowed"
              }`}
            >
              <Send className="w-4 h-4" />
            </button>
            <HeartsLayer />
          </form>
        </div>
      ) : (
        <>
          {/* FLOATING PART 1 — her whispered speech bubble */}
          <div className="gf-bubble mb-1 mr-1" data-testid="gf-floating-bubble">
            <div className="flex items-center justify-between mb-1">
              <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-rose-300 font-mono">
                <MessageCircleHeart className="w-3 h-3" />
                Rias whispers
              </span>
              <Heart className="w-3 h-3 text-rose-500 fill-rose-500 animate-pulse" />
            </div>
            <p>
              {bubbleText}
              <span className="gf-caret" />
            </p>
          </div>

          {/* FLOATING PART 2 — her living portrait orb */}
          <div className="gf-orb-bob relative">
            <div className="gf-orb-glow" />
            <button onClick={openChat} data-testid="gf-orb-button" title="Talk to Rias ♥" className="gf-orb block">
              <span className="gf-orb-ring" />
              <span className="gf-orb-ring-2" />
              <span className="gf-orb-inner">
                <LiveAvatar mood={mood} className="w-full h-full" />
              </span>
              {unread > 0 && (
                <span className="gf-unread" data-testid="gf-unread-badge">{unread > 9 ? "9+" : unread}</span>
              )}
            </button>
            <HeartsLayer />
          </div>
        </>
      )}
    </div>
  );
}