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

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);

      if (currentUser) {
        const adminStatus = await isAdminUser(currentUser);
        setIsAdmin(adminStatus);
      } else {
        setIsAdmin(false);
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
