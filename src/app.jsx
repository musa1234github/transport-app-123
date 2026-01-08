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

        {/* ================= PRIVATE ROUTES ================= */}
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
          <Route path="upload-dispatch" element={<UploadDispatch isAdmin={isAdmin} />} />
          <Route path="bill-upload" element={<BillUpload isAdmin={isAdmin} />} />
          <Route path="destination-master" element={<DestinationMaster isAdmin={isAdmin} />} />
          <Route path="factories" element={<FactoryList isAdmin={isAdmin} />} />
          <Route path="show-dispatch" element={<ShowDispatch isAdmin={isAdmin} />} />
          <Route path="vehicle-master" element={<VehicleMaster />} />
          <Route path="show-bill" element={<ShowBill />} />
          <Route path="delete-dispatch" element={<DeleteDispatch />} />
          
        </Route>

        {/* ================= FALLBACK ================= */}
        <Route path="*" element={<Navigate to={user ? "/" : "/login"} />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
