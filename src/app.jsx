import React, { useEffect, useState } from "react";
import { Routes, Route, BrowserRouter, Navigate } from "react-router-dom";
import Login from "./Login.jsx";
import Home from "./pages/Home.jsx";
import FactoryList from "./pages/FactoryList.jsx";
import UploadDispatch from "./pages/UploadDispatch.jsx";
import DestinationMaster from "./pages/DestinationMaster.jsx";
import ShowDispatch from "./pages/ShowDispatch.jsx";
import VehicleMaster from "./pages/VehicleMaster";
import BillUpload from "./pages/BillUpload.jsx";
import ShowBill from "./pages/ShowBill.jsx";
import DeleteDispatch from "./pages/DeleteDispatch.jsx";
import { auth, isAdminUser } from "./firebaseConfig";
import { onAuthStateChanged } from "firebase/auth";
import DeleteDuplicateChallan from "./pages/DelDuplicateChallan.jsx";
import ShoBilledChallan from "./pages/ShoBilledChallan.jsx";
import ShowQtyByMonth from "./pages/ShowQtyByMonth.jsx";
import ShowDayQty from "./pages/ShowDayQty.jsx";
import PaymentUpload from "./pages/PaymentUpload.jsx";


const App = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

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
        {/* ================= PUBLIC ROUTE ================= */}
        <Route
          path="/login"
          element={!user ? <Login /> : <Navigate to="/" />}
        />

        {/* ================= HOME (LAYOUT) ================= */}
        <Route
          path="/"
          element={
            user ? (
              <Home user={user} isAdmin={isAdmin} />
            ) : (
              <Navigate to="/login" />
            )
          }
        />

        {/* ================= PRIVATE ROUTES ================= */}
        <Route
          path="/upload-dispatch"
          element={
            user ? (
              <UploadDispatch isAdmin={isAdmin} />
            ) : (
              <Navigate to="/login" />
            )
          }
        />

        <Route
          path="/bill-upload"
          element={
            user ? (
              <BillUpload isAdmin={isAdmin} />
            ) : (
              <Navigate to="/login" />
            )
          }
        />

        <Route
          path="/payment-upload"
          element={
            user ? (
              <PaymentUpload isAdmin={isAdmin} />
            ) : (
              <Navigate to="/login" />
            )
          }
        />

        <Route
          path="/destination-master"
          element={user ? <DestinationMaster isAdmin={isAdmin} /> : <Navigate to="/login" />}
        />

        <Route
          path="/factories"
          element={user ? <FactoryList isAdmin={isAdmin} /> : <Navigate to="/login" />}
        />

        <Route
          path="/show-dispatch"
          element={user ? <ShowDispatch isAdmin={isAdmin} /> : <Navigate to="/login" />}
        />

        <Route
          path="/vehicle-master"
          element={user ? <VehicleMaster /> : <Navigate to="/login" />}
        />

        <Route
          path="/show-bill"
          element={user ? <ShowBill /> : <Navigate to="/login" />}
        />

        <Route
          path="/show-billed-challan"
          element={user ? <ShoBilledChallan /> : <Navigate to="/login" />}
        />

        <Route
          path="/monthly-qty-report"
          element={user ? <ShowQtyByMonth /> : <Navigate to="/login" />}
        />

        <Route
          path="/daily-qty-report"
          element={user ? <ShowDayQty /> : <Navigate to="/login" />}
        />

        <Route
          path="/delete-dispatch"
          element={user ? <DeleteDispatch /> : <Navigate to="/login" />}
        />

        <Route
          path="/delete-duplicate-challan"
          element={user ? <DeleteDuplicateChallan /> : <Navigate to="/login" />}
        />

        {/* ================= FALLBACK ================= */}
        <Route path="*" element={<Navigate to={user ? "/" : "/login"} />} />
      </Routes>
    </BrowserRouter>

  );
};

export default App;
