import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";

import { auth } from "./firebaseConfig";
import Login from "./Login";
import Home from "./Home";
import FactoryList from "./pages/FactoryList";

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  if (loading) {
    return <p style={{ padding: 20 }}>Loading...</p>;
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route
          path="/login"
          element={!user ? <Login /> : <Navigate to="/" />}
        />

        {/* Private */}
        <Route
          path="/"
          element={user ? <Home user={user} /> : <Navigate to="/login" />}
        />

        <Route
          path="/factories"
          element={user ? <FactoryList /> : <Navigate to="/login" />}
        />
      </Routes>
    </BrowserRouter>
  );
}
