import React, { useEffect, useState } from "react";
import { auth } from "../firebaseConfig";
import { signOut } from "firebase/auth";
import { Link, Outlet } from "react-router-dom";

const Home = ({ user }) => {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const checkAdmin = async () => {
      if (auth.currentUser) {
        const token = await auth.currentUser.getIdTokenResult();
        setIsAdmin(!!token.claims.admin);
      }
    };
    checkAdmin();
  }, []);

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
            <Link
              to="/upload-dispatch"
              style={{ color: "blue", textDecoration: "underline" }}
            >
              Dispatch Upload
            </Link>
          </li>
        )}

        <li>
          🏭{" "}
          <Link
            to="/factories"
            style={{ color: "blue", textDecoration: "underline" }}
          >
            Factories
          </Link>
        </li>

        <li>
          📦{" "}
          <Link
            to="/show-dispatch"
            style={{ color: "blue", textDecoration: "underline" }}
          >
            Show Dispatch
          </Link>
        </li>
      </ul>

      {!isAdmin && (
        <p style={{ marginTop: 10, color: "red" }}>
          You are logged in as a normal user. Dispatch upload is restricted.
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
