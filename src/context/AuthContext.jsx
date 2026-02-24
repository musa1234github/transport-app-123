import { createContext, useContext, useEffect, useRef, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebaseConfig";

/* ─────────────────────────────────────────
   ⏱️ IDLE TIMEOUT CONFIG
   Change IDLE_TIMEOUT_MS to adjust the idle limit.
   Change WARN_BEFORE_MS to adjust when the warning appears.
───────────────────────────────────────── */
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;  // 5 minutes → auto logout
const WARN_BEFORE_MS = 1 * 60 * 1000;  // warn 1 minute before logout

/* Events that count as "user activity" */
const ACTIVITY_EVENTS = [
    "mousemove", "mousedown", "keydown",
    "scroll", "touchstart", "click",
];

/* ─────────────────────────────────────────
   1. Create the context
───────────────────────────────────────── */
const AuthContext = createContext(null);

/* ─────────────────────────────────────────
   2. Custom hook — use this in any component
      const { user, userRole, loading, logout } = useAuth();
───────────────────────────────────────── */
export const useAuth = () => {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
    return ctx;
};

/* ─────────────────────────────────────────
   3. Provider — wraps the whole app in app.jsx
      Manages session restore + role loading + idle timeout
───────────────────────────────────────── */
export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [userRole, setUserRole] = useState(null); // "admin" | "dispatcher" | "viewer"
    const [loading, setLoading] = useState(true);
    const [showIdleWarn, setShowIdleWarn] = useState(false); // warning toast state

    /* Refs so timers don't cause re-renders */
    const logoutTimer = useRef(null);
    const warnTimer = useRef(null);

    /* ── Logout helper ── */
    const logout = async () => {
        clearTimeout(logoutTimer.current);
        clearTimeout(warnTimer.current);
        setShowIdleWarn(false);
        try {
            await signOut(auth);
        } catch (err) {
            console.error("❌ Logout failed:", err);
        }
    };

    /* ── Reset idle timers on every activity event ── */
    const resetIdleTimer = () => {
        /* Only run timers when a user is logged in */
        if (!auth.currentUser) return;

        setShowIdleWarn(false);
        clearTimeout(logoutTimer.current);
        clearTimeout(warnTimer.current);

        /* Warning fires 1 min before logout */
        warnTimer.current = setTimeout(() => {
            setShowIdleWarn(true);
        }, IDLE_TIMEOUT_MS - WARN_BEFORE_MS);

        /* Auto-logout after full idle period */
        logoutTimer.current = setTimeout(async () => {
            setShowIdleWarn(false);
            console.warn("⏱️ Session expired due to inactivity.");
            await signOut(auth);
        }, IDLE_TIMEOUT_MS);
    };

    /* ── Attach / detach activity listeners when user changes ── */
    useEffect(() => {
        if (user) {
            /* Start timers immediately when user logs in */
            resetIdleTimer();

            /* Listen for any activity */
            ACTIVITY_EVENTS.forEach((evt) =>
                window.addEventListener(evt, resetIdleTimer, { passive: true })
            );
        } else {
            /* Clear everything when logged out */
            clearTimeout(logoutTimer.current);
            clearTimeout(warnTimer.current);
            setShowIdleWarn(false);
            ACTIVITY_EVENTS.forEach((evt) =>
                window.removeEventListener(evt, resetIdleTimer)
            );
        }

        return () => {
            clearTimeout(logoutTimer.current);
            clearTimeout(warnTimer.current);
            ACTIVITY_EVENTS.forEach((evt) =>
                window.removeEventListener(evt, resetIdleTimer)
            );
        };
    }, [user]); // re-run whenever user logs in or out

    /* ── Firebase auth state listener (session restore) ── */
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            setUser(currentUser);

            if (currentUser) {
                try {
                    const snap = await getDoc(doc(db, "users", currentUser.uid));
                    setUserRole(snap.exists() ? snap.data().role : null);
                } catch (err) {
                    console.error("❌ Failed to fetch user role:", err);
                    setUserRole(null);
                }
            } else {
                setUserRole(null);
            }

            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    /* ── Derived permission flags ── */
    const isAdmin = userRole === "admin";
    const isDispatcher = userRole === "dispatcher";
    const canUploadDispatch = isAdmin || isDispatcher;
    const canUploadBilling = isAdmin;
    const isViewer = !isAdmin && !isDispatcher;

    const value = {
        user, userRole, loading, logout,
        isAdmin, isDispatcher, isViewer,
        canUploadDispatch, canUploadBilling,
    };

    return (
        <AuthContext.Provider value={value}>
            {children}

            {/* ── Idle Warning Toast ── */}
            {showIdleWarn && (
                <div style={{
                    position: "fixed",
                    bottom: "30px",
                    right: "30px",
                    zIndex: 9999,
                    background: "linear-gradient(135deg, #1f2937, #111827)",
                    color: "#fff",
                    padding: "18px 24px",
                    borderRadius: "14px",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                    minWidth: "300px",
                    border: "1px solid rgba(239,68,68,0.4)",
                    animation: "slideUp 0.3s ease",
                }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span style={{ fontSize: "22px" }}>⏱️</span>
                        <div>
                            <p style={{ margin: 0, fontWeight: "700", fontSize: "15px", color: "#fca5a5" }}>
                                Session Expiring Soon
                            </p>
                            <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#9ca3af" }}>
                                You will be logged out in <strong style={{ color: "#fbbf24" }}>1 minute</strong> due to inactivity.
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={resetIdleTimer}
                        style={{
                            background: "linear-gradient(135deg, #6366f1, #4f46e5)",
                            color: "#fff",
                            border: "none",
                            borderRadius: "8px",
                            padding: "9px 16px",
                            cursor: "pointer",
                            fontWeight: "600",
                            fontSize: "13px",
                            letterSpacing: "0.3px",
                        }}
                    >
                        ✅ Stay Logged In
                    </button>
                </div>
            )}

            {/* Slide-up animation */}
            <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0);    }
        }
      `}</style>
        </AuthContext.Provider>
    );
};
