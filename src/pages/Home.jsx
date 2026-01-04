import React from "react";
import { signOut } from "firebase/auth";
import { Link, Outlet } from "react-router-dom";
import { auth } from "../firebaseConfig";

const Home = ({ user, isAdmin }) => {
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
        <p>
          Logged in as: <b>{user.email}</b>{" "}
          {!isAdmin && <span style={{ color: "red" }}>(Normal User)</span>}
          {isAdmin && <span style={{ color: "green" }}>(Admin)</span>}
        </p>
      ) : (
        <p>Loading user info...</p>
      )}

      <hr />

      <ul style={{ listStyle: "none", padding: 0 }}>
        {/* Upload Dispatch → ONLY ADMIN */}
        {isAdmin && (
          <li>
            🚚{" "}
            <Link to="/upload-dispatch" style={{ color: "blue", textDecoration: "underline" }}>
              Dispatch Upload
            </Link>
          </li>
        )}

        {/* Bill Upload → ONLY ADMIN */}
        {isAdmin && (
          <li>
            🧾{" "}
            <Link to="/bill-upload" style={{ color: "blue", textDecoration: "underline" }}>
              Bill Upload
            </Link>
          </li>
        )}

        {/* Destination Master → ONLY ADMIN */}
        {isAdmin && (
          <li>
            🗺️{" "}
            <Link to="/destination-master" style={{ color: "blue", textDecoration: "underline" }}>
              Destination Master
            </Link>
          </li>
        )}

        {/* Vehicle Master → ONLY ADMIN */}
        {isAdmin && (
          <li>
            🚛{" "}
            <Link to="/vehicle-master" style={{ color: "blue", textDecoration: "underline" }}>
              Vehicle Master
            </Link>
          </li>
        )}

        <li>
          🏭{" "}
          <Link to="/factories" style={{ color: "blue", textDecoration: "underline" }}>
            Factories
          </Link>
        </li>

        <li>
          📦{" "}
          <Link to="/show-dispatch" style={{ color: "blue", textDecoration: "underline" }}>
            Show Dispatch
          </Link>
        </li>
      </ul>

      {!isAdmin && (
        <p style={{ marginTop: 10, color: "red" }}>
          You are logged in as a normal user. Restricted actions are hidden.
        </p>
      )}

      <hr />

      <Outlet />
      <br />
      <button onClick={handleLogout}>Logout</button>
    </div>
  );
};

export default Home;
