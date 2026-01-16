import React, { useEffect, useState } from "react";
import { Routes, Route, BrowserRouter, Navigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";

import Login from "./Login.jsx";
import Home from "./pages/Home.jsx";
import FactoryList from "./pages/FactoryList.jsx";
import UploadDispatch from "./pages/UploadDispatch.jsx";
import DestinationMaster from "./pages/DestinationMaster.jsx";
import ShowDispatch from "./pages/ShowDispatch.jsx";
import VehicleMaster from "./pages/VehicleMaster.jsx";
import BillUpload from "./pages/BillUpload.jsx";
import ShowBill from "./pages/ShowBill.jsx";
import DeleteDispatch from "./pages/DeleteDispatch.jsx";
import DeleteDuplicateChallan from "./pages/DelDuplicateChallan.jsx";
import ShoBilledChallan from "./pages/ShoBilledChallan.jsx";
import ShowQtyByMonth from "./pages/ShowQtyByMonth.jsx";
import ShowDayQty from "./pages/ShowDayQty.jsx";
import PaymentUpload from "./pages/PaymentUpload.jsx";

import { auth, isAdminUser } from "./firebaseConfig";

const App = () => {
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userUid, setUserUid] = useState(""); // NEW: Store user UID

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);

      if (currentUser) {
        // LOG USER UID TO CONSOLE - IMPORTANT FOR FIREBASE RULES
        console.log("🔥 User UID (Copy this for Firestore rules):", currentUser.uid);
        console.log("📧 User Email:", currentUser.email);
        setUserUid(currentUser.uid);
        
        const adminStatus = await isAdminUser(currentUser);
        setIsAdmin(adminStatus);
        
        // Temporary: Display UID on screen for easy copying (remove in production)
        if (process.env.NODE_ENV === "development") {
          alert(`Development Mode: Your UID is ${currentUser.uid}\n\nCopy this UID and replace "YOUR_ADMIN_UID_HERE" in firestore.rules`);
        }
      } else {
        setIsAdmin(false);
        setUserUid("");
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div style={{ textAlign: "center", marginTop: "50px" }}>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <BrowserRouter>
      {/* DEVELOPMENT BANNER - Shows UID for easy copying */}
      {process.env.NODE_ENV === "development" && userUid && (
        <div style={{
          backgroundColor: "#ffeb3b",
          padding: "5px 10px",
          fontSize: "12px",
          textAlign: "center",
          borderBottom: "1px solid #ccc",
          fontFamily: "monospace",
          wordBreak: "break-all"
        }}>
          🔥 DEV: Your UID: <strong>{userUid}</strong> - Copy this for Firestore rules
        </div>
      )}
      
      <Routes>
        {/* ================= PUBLIC ================= */}
        <Route
          path="/login"
          element={!user ? <Login /> : <Navigate to="/" />}
        />

        {/* ================= PRIVATE LAYOUT ================= */}
        <Route
          path="/"
          element={
            user ? (
              <Home user={user} isAdmin={isAdmin} />
            ) : (
              <Navigate to="/login" />
            )
          }
        >
          {/* ===== ADMIN / PROTECTED PAGES ===== */}
          <Route path="upload-dispatch" element={<UploadDispatch isAdmin={isAdmin} />} />
          <Route path="bill-upload" element={<BillUpload isAdmin={isAdmin} />} />
          <Route path="payment-upload" element={<PaymentUpload isAdmin={isAdmin} />} />
          <Route path="destination-master" element={<DestinationMaster isAdmin={isAdmin} />} />
          <Route path="delete-dispatch" element={<DeleteDispatch />} />
          <Route path="delete-duplicate-challan" element={<DeleteDuplicateChallan />} />

          {/* ===== COMMON PAGES ===== */}
          <Route path="factories" element={<FactoryList isAdmin={isAdmin} />} />
          <Route path="show-dispatch" element={<ShowDispatch isAdmin={isAdmin} />} />
          <Route path="vehicle-master" element={<VehicleMaster />} />
          <Route path="show-bill" element={<ShowBill />} />
          <Route path="show-billed-challan" element={<ShoBilledChallan />} />
          <Route path="monthly-qty-report" element={<ShowQtyByMonth />} />
          <Route path="daily-qty-report" element={<ShowDayQty />} />
        </Route>

        {/* ================= FALLBACK ================= */}
        <Route path="*" element={<Navigate to={user ? "/" : "/login"} />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;