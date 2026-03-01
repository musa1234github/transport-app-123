import React, { useState, useRef, useEffect } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

/* ─────────────────────────────────────────────
   Dropdown menu component
───────────────────────────────────────────── */
const DropdownMenu = ({ label, icon, items, accentColor }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const location = useLocation();

  // Close when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Close when route changes
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const isActive = items.some((item) =>
    location.pathname.startsWith("/" + item.to)
  );

  return (
    <li ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          ...dropdownTrigger,
          background: isActive || open ? accentColor + "18" : "transparent",
          color: isActive || open ? accentColor : "#374151",
          borderColor: isActive || open ? accentColor : "transparent",
        }}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <span>{icon}</span>
        <span>{label}</span>
        <span
          style={{
            display: "inline-block",
            transition: "transform 0.25s ease",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            fontSize: "10px",
            marginLeft: "2px",
          }}
        >
          ▼
        </span>
      </button>

      {/* Dropdown panel */}
      <div
        style={{
          position: "absolute",
          top: "calc(100% + 8px)",
          left: 0,
          minWidth: "200px",
          background: "#fff",
          borderRadius: "10px",
          boxShadow: "0 8px 30px rgba(0,0,0,0.13)",
          border: "1px solid #e5e7eb",
          overflow: "hidden",
          zIndex: 1000,
          opacity: open ? 1 : 0,
          transform: open ? "translateY(0px)" : "translateY(-8px)",
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.22s ease, transform 0.22s ease",
        }}
      >
        {/* Colour bar at top */}
        <div style={{ height: "3px", background: accentColor }} />
        <ul style={{ listStyle: "none", margin: 0, padding: "6px 0" }}>
          {items.map(({ to, label: itemLabel, icon: itemIcon }) => {
            const active = location.pathname.startsWith("/" + to);
            return (
              <li key={to}>
                <Link
                  to={`/${to}`}
                  style={{
                    ...dropdownItem,
                    background: active ? accentColor + "12" : "transparent",
                    color: active ? accentColor : "#374151",
                    fontWeight: active ? "600" : "500",
                  }}
                >
                  <span style={{ fontSize: "16px" }}>{itemIcon}</span>
                  <span>{itemLabel}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </li>
  );
};

/* ─────────────────────────────────────────────
   Home component
───────────────────────────────────────────── */
const Home = () => {
  /* ── Read session from AuthContext (no prop drilling) ── */
  const { user, userRole, logout, canUploadDispatch, canUploadBilling, isAdmin } = useAuth();

  const location = useLocation();

  // ── Transaction sub-links (role-filtered) ──────────────────
  const transactionLinks = [
    ...(canUploadDispatch
      ? [
        { to: "upload-dispatch", label: "Dispatch Upload", icon: "🚚" },
        { to: "bag-short-update", label: "Bag Short Update", icon: "🎒" },
      ]
      : []),
    ...(canUploadBilling
      ? [
        { to: "bill-upload", label: "Bill Upload", icon: "🧾" },
        { to: "payment-upload", label: "Payment Upload", icon: "💳" },
        { to: "gst-upload", label: "GST Upload", icon: "📤" },
      ]
      : []),
  ];

  // ── Report sub-links ───────────────────────────────────────
  const reportLinks = [
    { to: "show-dispatch", label: "Show Dispatch", icon: "📦" },
    { to: "show-bill", label: "Show Bills", icon: "📑" },
    { to: "show-payment", label: "Show Payments", icon: "💰" },
    { to: "monthly-qty-report", label: "Monthly Qty", icon: "📊" },
    { to: "daily-qty-report", label: "Daily Qty", icon: "📅" },
    ...(canUploadBilling
      ? [{ to: "gst-report", label: "GST Report", icon: "📋" }]
      : []),
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#f5f7fa" }}>
      {/* ================= TOP NAVBAR ================= */}
      <div
        style={{
          background: "linear-gradient(135deg, #1f2937 0%, #111827 100%)",
          color: "#fff",
          padding: "14px 28px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "20px", letterSpacing: "0.3px" }}>
          🚛 Transport App
        </h2>

        {user && (
          <div style={{ fontSize: "13px", color: "#d1d5db" }}>
            {user.email}{" "}
            <span
              style={{
                color: "#4ade80",
                fontWeight: "600",
                background: "rgba(74,222,128,0.12)",
                padding: "2px 8px",
                borderRadius: "20px",
                fontSize: "12px",
              }}
            >
              {userRole === "admin"
                ? "Admin"
                : userRole === "dispatcher"
                  ? "Dispatcher"
                  : "User"}
            </span>
          </div>
        )}
      </div>

      {/* ================= MENU BAR ================= */}
      <nav
        style={{
          background: "#ffffff",
          padding: "0 28px",
          boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
          borderBottom: "1px solid #f0f0f0",
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        <ul
          style={{
            listStyle: "none",
            display: "flex",
            gap: "4px",
            margin: 0,
            padding: 0,
            alignItems: "center",
            flexWrap: "wrap",
            minHeight: "52px",
          }}
        >
          {/* ── Factories (always visible) ── */}
          <li>
            <NavLink to="/factories" label="🏭 Factories" />
          </li>

          {/* ── Transactions dropdown ── */}
          {transactionLinks.length > 0 && (
            <DropdownMenu
              label="Transactions"
              icon="📝"
              items={transactionLinks}
              accentColor="#6366f1"
            />
          )}

          {/* ── Reports dropdown ── */}
          <DropdownMenu
            label="Reports"
            icon="📊"
            items={reportLinks}
            accentColor="#0ea5e9"
          />

          {/* ── Admin-only standalone links ── */}
          {isAdmin && (
            <>
              <li>
                <NavLink to="/vehicle-master" label="🗺️ Vehicle Master" />
              </li>
              <li>
                <NavLink to="/show-billed-challan" label="📄 Billed Challan" />
              </li>
              <li>
                <NavLink to="/dispatch-export" label="⬇️ Dispatch Export" />
              </li>
              <li>
                <NavLink to="/backfill-monthly" label="🗄️ Backfill Monthly" />
              </li>
            </>
          )}
        </ul>
      </nav>

      {/* ================= PAGE CONTENT ================= */}
      <div style={{ padding: "25px" }}>
        {userRole === "viewer" && (
          <p style={{ color: "#ef4444", fontWeight: "500" }}>
            You are logged in as a normal user. Restricted actions are hidden.
          </p>
        )}

        <Outlet context={{ userRole }} />

        <br />

        <button
          onClick={logout}
          style={{
            padding: "8px 20px",
            background: "linear-gradient(135deg, #ef4444, #dc2626)",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            fontWeight: "500",
            fontSize: "14px",
            boxShadow: "0 2px 6px rgba(239,68,68,0.35)",
          }}
        >
          🔓 Logout
        </button>
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────────
   Simple nav link (non-dropdown)
───────────────────────────────────────────── */
const NavLink = ({ to, label }) => {
  const location = useLocation();
  const active = location.pathname === to || location.pathname.startsWith(to + "/");
  return (
    <Link
      to={to}
      style={{
        textDecoration: "none",
        color: active ? "#6366f1" : "#374151",
        fontWeight: active ? "600" : "500",
        padding: "14px 12px",
        display: "inline-block",
        fontSize: "14px",
        borderBottom: active ? "3px solid #6366f1" : "3px solid transparent",
        transition: "color 0.18s, border-color 0.18s",
      }}
    >
      {label}
    </Link>
  );
};

/* ─────────────────────────────────────────────
   Shared styles
───────────────────────────────────────────── */
const dropdownTrigger = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  padding: "13px 12px",
  fontSize: "14px",
  fontWeight: "500",
  cursor: "pointer",
  border: "none",
  borderRadius: "0",
  background: "transparent",
  color: "#374151",
  outline: "none",
  borderBottom: "3px solid transparent",
  transition: "background 0.18s, color 0.18s",
  whiteSpace: "nowrap",
};

const dropdownItem = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  padding: "10px 18px",
  textDecoration: "none",
  fontSize: "14px",
  transition: "background 0.15s, color 0.15s",
  borderRadius: "0",
};

export default Home;
