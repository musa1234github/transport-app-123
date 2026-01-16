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
    <div style={{ minHeight: "100vh", background: "#f5f7fa" }}>
      {/* ================= TOP NAVBAR ================= */}
      <div
        style={{
          background: "#1f2937",
          color: "#fff",
          padding: "15px 30px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
        }}
      >
         <h2 style={{ margin: 0 }}>🚛 Transport App</h2>

        {user && (
          <div style={{ fontSize: "14px" }}>
            {user.email}{" "}
            {isAdmin ? (
              <span style={{ color: "#22c55e" }}>(Admin)</span>
            ) : (
              <span style={{ color: "#f87171" }}>(User)</span>
            )}
          </div>
        )}
      </div>

      {/* ================= MENU BAR ================= */}
      <nav
        style={{
          background: "#ffffff",
          padding: "12px 30px",
          boxShadow: "0 2px 6px rgba(0,0,0,0.1)"
        }}
      >
        <ul
          style={{
            listStyle: "none",
            display: "flex",
            gap: "25px",
            margin: 0,
            padding: 0,
            alignItems: "center",
            flexWrap: "wrap"
          }}
        >
          {isAdmin && (
            <li>
              
              <Link to="/upload-dispatch" style={menuLink}>

                🚚 Dispatch Upload
              </Link>
            </li>
          )}

          {isAdmin && (
            <li>
              <Link to="/bill-upload" style={menuLink}>
                🧾 Bill Upload
              </Link>
            </li>
          )}

           {isAdmin && (
            <li>
              <Link to="/payment-upload" style={menuLink}>
                🧾 Payment Upload
              </Link>
            </li>
          )}


           
          <li>
            <Link to="/show-bill" style={menuLink}>
              📑 Show Bills
            </Link>
          </li>
           <li>
            <Link to="/show-payment" style={menuLink}>
              📑 Show Payments
            </Link>
          </li>

          {isAdmin && (
            <li>
              <Link to="/destination-master" style={menuLink}>
                🗺️ Destination Master
              </Link>
            </li>
          )}
          {isAdmin && (
            <li>
              <Link to="/show-billed-challan" style={menuLink}>
                🗺️ Show Billed Challan
              </Link>
            </li>
          )}

          {isAdmin && (
            <li>
              <Link to="/vehicle-master" style={menuLink}>
                🚛 Vehicle Master
              </Link>
            </li>
          )}
          {isAdmin && ( // Add this block
            <li>
              <Link to="/monthly-qty-report" style={menuLink}>
                📊 Monthly Quantity Report
              </Link>
            </li>
          )}
          
          {isAdmin && (
            <li>
              <Link to="/daily-qty-report" style={menuLink}>
                📊 Day Quantity Report
              </Link>
            </li>
          )}


          <li>
            <Link to="/factories" style={menuLink}>
              🏭 Factories
            </Link>
          </li>

          <li>
            <Link to="/show-dispatch" style={menuLink}>
              📦 Show Dispatch
            </Link>
          </li>

          {isAdmin && (
            <li>
              <Link to="/delete-dispatch" style={{ ...menuLink, color: "red" }}>
                ❌ Delete Dispatch
              </Link>
            </li>

          )}
          {isAdmin && (
            <li>
              <Link to="/delete-duplicate-challan" style={{ ...menuLink, color: "red" }}>
                ❌ Delete Duplicate Dispatch
              </Link>
            </li>
          )}

        </ul>
      </nav>

      {/* ================= CONTENT AREA ================= */}
      <div style={{ padding: "25px" }}>
        {!isAdmin && (
          <p style={{ color: "red", marginBottom: "10px" }}>
            You are logged in as a normal user. Restricted actions are hidden.
          </p>
        )}

        <Outlet />

        <br />

        <button
          onClick={handleLogout}
          style={{
            padding: "8px 16px",
            background: "#ef4444",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer"
          }}
        >
          Logout
        </button>
      </div>
    </div>
  );
};

/* ================= MENU LINK STYLE ================= */
const menuLink = {
  textDecoration: "none",
  color: "#1f2937",
  fontWeight: "500",
  padding: "6px 10px",
  borderRadius: "4px",
  transition: "background 0.2s",
};

export default Home;
