import React, { useEffect, useState } from "react";
import { Routes, Route, BrowserRouter, Navigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import Login from "./pages/Login.jsx";
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
import ShowPayment from "./pages/ShowPayment.jsx";
import { auth, db } from "./firebaseConfig";
import { doc, getDoc } from "firebase/firestore";
import DispatchExport from "./pages/DispatchExport";

const App = () => {
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState(null); // admin | dispatcher | viewer
  const [loading, setLoading] = useState(true);
  const [userUid, setUserUid] = useState("");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);

      if (currentUser) {
        console.log("🔥 User UID:", currentUser.uid);
        console.log("📧 User Email:", currentUser.email);
        setUserUid(currentUser.uid);

        // 🔑 READ ROLE FROM FIRESTORE (ONLY SOURCE OF TRUTH)
        const snap = await getDoc(doc(db, "users", currentUser.uid));

        console.log("🔥 Firestore user doc exists:", snap.exists());
        console.log("🔥 Firestore data:", snap.data());
        console.log("Provider:", currentUser.providerData);

        if (snap.exists()) {
          setUserRole(snap.data().role);
        } else {
          setUserRole(null);
        }

        // DEV helper
        if (process.env.NODE_ENV === "development") {
          alert(
            `DEV MODE\n\nUID: ${currentUser.uid}\nRole: ${snap.data()?.role}`
          );
        }
      } else {
        setUserRole(null);
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

  const canUploadDispatch = userRole === "admin" || userRole === "dispatcher";
  const canUploadBilling = userRole === "admin";

  const canSeeCrudControls = userRole === "admin"; // Only admin should see CRUD controls

  return (
    <BrowserRouter>
      {/* DEV UID BANNER */}
      {process.env.NODE_ENV === "development" && userUid && (
        <div
          style={{
            backgroundColor: "#ffeb3b",
            padding: "5px 10px",
            fontSize: "12px",
            textAlign: "center",
            borderBottom: "1px solid #ccc",
            fontFamily: "monospace",
            wordBreak: "break-all"
          }}
        >
          🔥 DEV UID: <strong>{userUid}</strong> | ROLE:{" "}
          <strong>{userRole}</strong> | CRUD: {canSeeCrudControls ? "✅" : "❌"}
        </div>
      )}

      <Routes>
        {/* ================= PUBLIC ================= */}
        <Route
          path="/login"
          element={!user ? <Login /> : <Navigate to="/" />}
        />

        {/* ================= PRIVATE ================= */}
        <Route
          path="/"
          element={
            user ? (
              <Home user={user} userRole={userRole} />
            ) : (
              <Navigate to="/login" />
            )
          }
        >
          {/* ===== UPLOAD / MASTER (ADMIN + DISPATCHER) ===== */}
          {/* ===== DISPATCH UPLOAD ===== */}
          {canUploadDispatch && (
            <Route path="upload-dispatch" element={<UploadDispatch />} />
          )}

          {/* ===== BILL + PAYMENT (ADMIN ONLY) ===== */}
          {canUploadBilling && (
            <>
              <Route path="bill-upload" element={<BillUpload />} />
              <Route path="payment-upload" element={<PaymentUpload />} />
            </>
          )}

          {/* ===== COMMON (ALL ROLES) ===== */}
          {/* Pass userRole to components that need to show/hide CRUD controls */}
          <Route path="factories" element={<FactoryList />} />
          <Route path="show-dispatch" element={<ShowDispatch />} />
          <Route path="vehicle-master" element={<VehicleMaster />} />
          <Route
            path="show-bill"
            element={<ShowBill userRole={userRole} />}
          />
          <Route
            path="show-payment"
            element={<ShowPayment userRole={userRole} />}
          />
          <Route path="show-billed-challan" element={<ShoBilledChallan />} />
          <Route path="monthly-qty-report" element={<ShowQtyByMonth />} />
          <Route path="daily-qty-report" element={<ShowDayQty />} />
          <Route path="/dispatch-export" element={<DispatchExport />} />
        </Route>

        {/* ================= FALLBACK ================= */}
        <Route path="*" element={<Navigate to={user ? "/" : "/login"} />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;