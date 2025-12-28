import React, { useEffect, useState } from "react";
import { Routes, Route, BrowserRouter, Navigate } from "react-router-dom";
import Login from "./Login.jsx";
import Home from "./pages/Home.jsx";
import FactoryList from "./pages/FactoryList.jsx";
import UploadDispatch from "./pages/UploadDispatch.jsx";
import { auth } from "./firebaseConfig";
import { onAuthStateChanged } from "firebase/auth";
import ShowDispatch from "./pages/ShowDispatch.jsx";
import TestFirebase from "./pages/TestFirebase.jsx";

<Route path="/test-firebase" element={<TestFirebase />} />


const App = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
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
          element={user ? <Home user={user} /> : <Navigate to="/login" />}
        >
          {/* Nested pages under Home */}
          <Route path="upload-dispatch" element={<UploadDispatch />} />
          <Route path="factories" element={<FactoryList />} />
          <Route path="show-dispatch" element={<ShowDispatch />} />
         </Route>

        {/* Fallback route */}
        <Route path="*" element={<Navigate to={user ? "/" : "/login"} />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
