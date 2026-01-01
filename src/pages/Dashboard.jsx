// src/pages/Dashboard.jsx
import React, { useEffect, useState } from "react";
import { auth, isAdminUser } from "../firebaseConfig";
import { useNavigate } from "react-router-dom";

export default function Dashboard() {
  const [admin, setAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        const adminStatus = await isAdminUser(user);
        setAdmin(adminStatus);
        setLoading(false);
      } else {
        navigate("/login"); // redirect if not logged in
      }
    });
    return () => unsubscribe();
  }, [navigate]);

  const handleLogout = () => {
    auth.signOut();
    navigate("/login");
  };

  if (loading) return <p>Loading...</p>;

  return (
    <div style={{ padding: "20px" }}>
      <h1>Dashboard</h1>
      <p>Welcome {admin ? "Admin" : "User"}!</p>

      {admin ? (
        <div>
          <p>You can do CRUD operations here.</p>
          <button>Add Item</button>
          <button>Edit Item</button>
          <button>Delete Item</button>
        </div>
      ) : (
        <p>You have read-only access.</p>
      )}

      <button onClick={handleLogout} style={{ marginTop: "20px" }}>
        Logout
      </button>
    </div>
  );
}
