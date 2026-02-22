import React, { useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { 
  Bell, 
  Settings, 
  LogOut, 
  Play, 
  Square, 
  CheckCircle2, 
  AlertCircle,
  Table,
  PhoneCall,
  Volume2,
  VolumeX
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import confetti from "canvas-confetti";

interface Lead {
  data: string[];
  timestamp: number;
}

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [status, setStatus] = useState<"idle" | "monitoring" | "error">("idle");
  
  const socketRef = useRef<Socket | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    checkAuthStatus();
    
    // Setup Socket.io
    socketRef.current = io();
    
    socketRef.current.on("new-leads", (data: { leads: string[][], total: number }) => {
      const newLeads = data.leads.map(row => ({
        data: row,
        timestamp: Date.now()
      }));
      
      setLeads(prev => [...newLeads, ...prev].slice(0, 50));
      
      if (!isMuted) {
        playNotification();
      }
      
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });
    });

    socketRef.current.on("monitoring-error", (data: { message: string }) => {
      setIsMonitoring(false);
      setStatus("error");
      alert(data.message);
    });

    // Cleanup
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  const checkAuthStatus = async () => {
    try {
      const res = await fetch("/api/auth/status");
      const data = await res.json();
      setAuthenticated(data.authenticated);
    } catch (e) {
      setAuthenticated(false);
    }
  };

  const handleConnect = async () => {
    try {
      const res = await fetch("/api/auth/url");
      const { url } = await res.json();
      
      const width = 600;
      const height = 700;
      const left = window.screenX + (window.innerWidth - width) / 2;
      const top = window.screenY + (window.innerHeight - height) / 2;
      
      const authWindow = window.open(
        url,
        "google_oauth",
        `width=${width},height=${height},left=${left},top=${top}`
      );

      if (!authWindow) {
        alert("Please allow popups to connect Google Sheets.");
        return;
      }

      const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === "OAUTH_AUTH_SUCCESS") {
          setAuthenticated(true);
          window.removeEventListener("message", handleMessage);
        }
      };
      window.addEventListener("message", handleMessage);
    } catch (e) {
      console.error("Auth error", e);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setAuthenticated(false);
    setIsMonitoring(false);
    if (socketRef.current) {
      socketRef.current.emit("stop-monitoring");
    }
  };

  const startMonitoring = () => {
    if (!spreadsheetId) {
      alert("Please enter a Spreadsheet ID");
      return;
    }
    
    // Extract ID from URL if user pasted the whole link
    let id = spreadsheetId;
    if (id.includes("/d/")) {
      id = id.split("/d/")[1].split("/")[0];
    }

    setIsMonitoring(true);
    setStatus("monitoring");
    
    // We need to pass tokens, but the server has them in session.
    // However, the socket connection doesn't automatically share the session tokens 
    // in a way that's easy for the background polling without re-fetching.
    // For simplicity in this demo, the server will handle session tokens.
    socketRef.current?.emit("start-monitoring", { 
      spreadsheetId: id,
      // The server will use the session tokens
      tokens: "SESSION_TOKENS" 
    });
  };

  const stopMonitoring = () => {
    setIsMonitoring(false);
    setStatus("idle");
    socketRef.current?.emit("stop-monitoring");
  };

  const playNotification = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(e => console.log("Audio play failed", e));
    }
  };

  if (authenticated === null) return <div className="min-h-screen bg-zinc-50 flex items-center justify-center">Loading...</div>;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 font-sans selection:bg-emerald-100">
      {/* Audio Element */}
      <audio ref={audioRef} src="https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3" preload="auto" />

      {/* Header */}
      <header className="bg-white border-b border-zinc-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center text-white">
              <PhoneCall size={22} />
            </div>
            <h1 className="text-xl font-bold tracking-tight">LeadRing</h1>
          </div>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setIsMuted(!isMuted)}
              className="p-2 hover:bg-zinc-100 rounded-lg transition-colors text-zinc-600"
            >
              {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>
            <button 
              onClick={playNotification}
              className="px-3 py-1.5 text-xs font-bold bg-zinc-100 text-zinc-600 rounded-lg hover:bg-zinc-200 transition-colors"
            >
              Test Sound
            </button>
            {authenticated && (
              <button 
                onClick={handleLogout}
                className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
              >
                <LogOut size={16} />
                <span className="hidden sm:inline">Logout</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {!authenticated ? (
          <div className="max-w-md mx-auto mt-12 text-center">
            <div className="mb-8 flex justify-center">
              <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-3xl flex items-center justify-center">
                <Table size={40} />
              </div>
            </div>
            <h2 className="text-3xl font-bold mb-4">Connect your Leads</h2>
            <p className="text-zinc-500 mb-8">
              Connect your Google Sheets to get real-time audio notifications whenever a new row is added.
            </p>
            <button 
              onClick={handleConnect}
              className="w-full py-4 px-6 bg-zinc-900 text-white rounded-2xl font-semibold text-lg hover:bg-zinc-800 transition-all shadow-xl shadow-zinc-200 flex items-center justify-center gap-3"
            >
              <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
              Connect Google Sheets
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Control Panel */}
            <div className="lg:col-span-1 space-y-6">
              <section className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
                <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400 mb-6 flex items-center gap-2">
                  <Settings size={14} />
                  Configuration
                </h3>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                      Spreadsheet ID or URL
                    </label>
                    <input 
                      type="text" 
                      value={spreadsheetId}
                      onChange={(e) => setSpreadsheetId(e.target.value)}
                      placeholder="https://docs.google.com/spreadsheets/d/..."
                      className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all outline-none text-sm"
                      disabled={isMonitoring}
                    />
                    <p className="mt-2 text-[10px] text-zinc-400 leading-relaxed">
                      Tip: Ensure the sheet is accessible to your account. We'll monitor the first sheet for new rows.
                    </p>
                  </div>

                  {!isMonitoring ? (
                    <button 
                      onClick={startMonitoring}
                      className="w-full py-3 px-4 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-100"
                    >
                      <Play size={18} fill="currentColor" />
                      Start Monitoring
                    </button>
                  ) : (
                    <button 
                      onClick={stopMonitoring}
                      className="w-full py-3 px-4 bg-zinc-900 text-white rounded-xl font-bold hover:bg-zinc-800 transition-all flex items-center justify-center gap-2 shadow-lg shadow-zinc-200"
                    >
                      <Square size={18} fill="currentColor" />
                      Stop Monitoring
                    </button>
                  )}
                </div>
              </section>

              <section className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
                <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400 mb-4">Status</h3>
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${isMonitoring ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-300'}`} />
                  <span className="font-medium text-zinc-700">
                    {isMonitoring ? 'Active & Listening' : 'System Idle'}
                  </span>
                </div>
                {isMonitoring && (
                  <p className="mt-2 text-xs text-zinc-400">
                    Polling Google Sheets every 5 seconds...
                  </p>
                )}
              </section>
            </div>

            {/* Leads Feed */}
            <div className="lg:col-span-2">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold flex items-center gap-3">
                  Recent Leads
                  {leads.length > 0 && (
                    <span className="bg-emerald-100 text-emerald-700 text-xs px-2 py-1 rounded-full">
                      {leads.length}
                    </span>
                  )}
                </h2>
                <button 
                  onClick={() => setLeads([])}
                  className="text-sm text-zinc-400 hover:text-zinc-600 transition-colors"
                >
                  Clear Feed
                </button>
              </div>

              <div className="space-y-4">
                <AnimatePresence initial={false}>
                  {leads.length === 0 ? (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="bg-white border border-dashed border-zinc-300 rounded-3xl p-12 text-center"
                    >
                      <div className="w-16 h-16 bg-zinc-50 rounded-full flex items-center justify-center mx-auto mb-4 text-zinc-300">
                        <Bell size={32} />
                      </div>
                      <p className="text-zinc-400 font-medium">No leads detected yet.</p>
                      <p className="text-xs text-zinc-300 mt-1">New leads will appear here in real-time.</p>
                    </motion.div>
                  ) : (
                    leads.map((lead, idx) => (
                      <motion.div
                        key={lead.timestamp + idx}
                        initial={{ opacity: 0, y: 20, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        className="bg-white p-5 rounded-2xl border border-zinc-200 shadow-sm hover:border-emerald-200 transition-colors group"
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-emerald-50 text-emerald-600 rounded-lg flex items-center justify-center">
                              <CheckCircle2 size={18} />
                            </div>
                            <div>
                              <span className="text-xs font-bold text-emerald-600 uppercase tracking-widest">New Lead</span>
                              <div className="text-[10px] text-zinc-400">
                                {new Date(lead.timestamp).toLocaleTimeString()}
                              </div>
                            </div>
                          </div>
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                            <button className="p-1.5 hover:bg-zinc-50 rounded-md text-zinc-400">
                              <AlertCircle size={14} />
                            </button>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                          {lead.data.map((cell, cIdx) => (
                            <div key={cIdx} className="overflow-hidden">
                              <div className="text-[10px] text-zinc-400 uppercase font-bold tracking-tighter mb-0.5">Column {cIdx + 1}</div>
                              <div className="text-sm font-medium text-zinc-800 truncate">{cell || '-'}</div>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    ))
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Mobile Bottom Bar (Simulated) */}
      <div className="sm:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-zinc-200 p-4 flex justify-around items-center">
        <button className="text-emerald-600 flex flex-col items-center gap-1">
          <Bell size={20} />
          <span className="text-[10px] font-bold uppercase">Feed</span>
        </button>
        <button className="text-zinc-400 flex flex-col items-center gap-1">
          <Settings size={20} />
          <span className="text-[10px] font-bold uppercase">Setup</span>
        </button>
      </div>
    </div>
  );
}
