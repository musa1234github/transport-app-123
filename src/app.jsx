import React, { useEffect, useState } from "react";
import { Routes, Route, BrowserRouter, Navigate } from "react-router-dom";
import Login from "./Login.jsx";
import Home from "./pages/Home.jsx";
import FactoryList from "./pages/FactoryList.jsx";
import UploadDispatch from "./pages/UploadDispatch.jsx";
import { auth, isAdminUser } from "./firebaseConfig";
import { onAuthStateChanged } from "firebase/auth";
import ShowDispatch from "./pages/ShowDispatch.jsx";

const App = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false); // NEW: track admin status

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);

      // 🔥 NEW: check if user is admin
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
        {/* Public route */}
        <Route path="/login" element={!user ? <Login /> : <Navigate to="/" />} />

        {/* Private routes */}
        <Route
          path="/"
          element={user ? <Home user={user} isAdmin={isAdmin} /> : <Navigate to="/login" />}
        >
          {/* Nested pages under Home */}
          <Route path="upload-dispatch" element={<UploadDispatch isAdmin={isAdmin} />} />
          <Route path="factories" element={<FactoryList isAdmin={isAdmin} />} />
          <Route path="show-dispatch" element={<ShowDispatch isAdmin={isAdmin} />} />
        </Route>

        {/* Fallback route */}
        <Route path="*" element={<Navigate to={user ? "/" : "/login"} />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
