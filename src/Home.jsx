import React from "react";
import { auth } from "./firebaseConfig";
import { signOut } from "firebase/auth";
import { Link } from "react-router-dom"; // ✅ Add this

const Home = ({ user }) => {
  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  return (
    <div style={{ padding: "20px" }}>
      <h2>Transport App Dashboard</h2>
      {user ? (
        <p>Logged in as: <b>{user.email}</b></p>
      ) : (
        <p>Loading user info...</p>
      )}

      <hr />

      <ul style={{ listStyle: "none", padding: 0 }}>
        <li>🚚 Dispatch Management (Coming soon)</li>
        <li>📄 Bills & Invoices (Coming soon)</li>
        <li>🏭 <Link to="/factories" style={{ color: "blue", textDecoration: "underline" }}>Factories</Link></li>
        <li>📊 Reports (Coming soon)</li>
      </ul>

      <br />

      <button onClick={handleLogout}>Logout</button>
    </div>
  );
};

export default Home;
