import React from "react";
import "./pages/ShowBill.css";
import { Routes, Route, BrowserRouter, Navigate } from "react-router-dom";

/* ── AuthProvider + hook ── */
import { AuthProvider, useAuth } from "./context/AuthContext";

/* ── Pages ── */
import Login from "./pages/Login.jsx";
import Home from "./pages/Home.jsx";
import FactoryList from "./pages/FactoryList.jsx";
import UploadDispatch from "./pages/UploadDispatch.jsx";
import BagShortUpdate from "./pages/BagShortUpdate.jsx";
import ShowDispatch from "./pages/ShowDispatch.jsx";
import VehicleMaster from "./pages/VehicleMaster.jsx";
import BillUpload from "./pages/BillUpload.jsx";
import ShowBill from "./pages/ShowBill.jsx";
import ShoBilledChallan from "./pages/ShoBilledChallan.jsx";
import ShowQtyByMonth from "./pages/ShowQtyByMonth.jsx";
import ShowDayQty from "./pages/ShowDayQty.jsx";
import PaymentUpload from "./pages/PaymentUpload.jsx";
import ShowPayment from "./pages/ShowPayment.jsx";
import DispatchExport from "./pages/DispatchExport.jsx";
import GstUpload from "./pages/GstUpload.jsx";
import GstReport from "./pages/GstReport.jsx";

/* ─────────────────────────────────────────
   Inner app — reads auth state from context
───────────────────────────────────────── */
const AppRoutes = () => {
  const {
    user,
    userRole,
    loading,
    canUploadDispatch,
    canUploadBilling,
  } = useAuth();

  /* ── PRO: Block render until Firebase has confirmed auth state ── */
  if (loading) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        gap: "16px",
        background: "#f9fafb",
        color: "#374151",
        fontFamily: "Inter, sans-serif",
      }}>
        <div style={{
          width: "40px", height: "40px",
          border: "4px solid #e5e7eb",
          borderTop: "4px solid #6366f1",
          borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
        }} />
        <p style={{ fontSize: "14px", color: "#6b7280" }}>Restoring session…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <Routes>
      {/* ═══ PUBLIC ═══ */}
      <Route
        path="/login"
        element={!user ? <Login /> : <Navigate to="/" />}
      />

      {/* ═══ PRIVATE ═══ */}
      <Route
        path="/"
        element={
          user
            ? <Home />
            : <Navigate to="/login" />
        }
      >
        {/* ── DISPATCH (admin + dispatcher) ── */}
        {canUploadDispatch && (
          <>
            <Route path="upload-dispatch" element={<UploadDispatch />} />
            <Route path="bag-short-update" element={<BagShortUpdate />} />
          </>
        )}

        {/* ── BILLING + PAYMENT (admin only) ── */}
        {canUploadBilling && (
          <>
            <Route path="bill-upload" element={<BillUpload />} />
            <Route path="payment-upload" element={<PaymentUpload />} />
            <Route path="gst-upload" element={<GstUpload />} />
            <Route path="gst-report" element={<GstReport userRole={userRole} />} />
            <Route path="dispatch-export" element={<DispatchExport />} />
          </>
        )}

        {/* ── COMMON (all roles) ── */}
        <Route path="factories" element={<FactoryList />} />
        <Route path="show-dispatch" element={<ShowDispatch />} />
        <Route path="vehicle-master" element={<VehicleMaster />} />
        <Route path="show-bill" element={<ShowBill userRole={userRole} />} />
        <Route path="show-payment" element={<ShowPayment userRole={userRole} />} />
        <Route path="show-billed-challan" element={<ShoBilledChallan />} />
        <Route path="monthly-qty-report" element={<ShowQtyByMonth />} />
        <Route path="daily-qty-report" element={<ShowDayQty />} />
      </Route>

      {/* ═══ FALLBACK ═══ */}
      <Route path="*" element={<Navigate to={user ? "/" : "/login"} />} />
    </Routes>
  );
};

/* ─────────────────────────────────────────
   Root App — wraps everything in AuthProvider + Router
───────────────────────────────────────── */
const App = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;