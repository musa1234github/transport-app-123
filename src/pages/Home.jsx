import React from "react";
import { signOut } from "firebase/auth";
import { Link, Outlet } from "react-router-dom";
import { auth } from "../firebaseConfig";


const Home = ({ user, userRole }) => {
  const canUploadDispatch = userRole === "admin" || userRole === "dispatcher";
  const canUploadBilling = userRole === "admin";
  const isAdmin = userRole === "admin";


  const handleLogout = async () => {
    await signOut(auth);
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
            <span style={{ color: "#22c55e" }}>
              (
              {userRole === "admin"
                ? "Admin"
                : userRole === "dispatcher"
                  ? "Dispatcher"
                  : "User"}
              )
            </span>
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
            flexWrap: "wrap"
          }}
        >
          {canUploadDispatch && (
            <>
              <li>
                <Link to="/upload-dispatch" style={menuLink}>
                  🚚 Dispatch Upload
                </Link>
              </li>
              <li>
                <Link to="/bag-short-update" style={menuLink}>
                  🎒 Bag Short Update
                </Link>
              </li>
            </>
          )}

          {canUploadBilling && (
            <>
              <li>
                <Link to="/bill-upload" style={menuLink}>
                  🧾 Bill Upload
                </Link>
              </li>
              <li>
                <Link to="/payment-upload" style={menuLink}>
                  🧾 Payment Upload
                </Link>
              </li>
              <li>
                <Link to="/gst-upload" style={menuLink}>
                  🧾 GST Upload
                </Link>
              </li>
            </>
          )}

          {isAdmin && (
            <>
              <li><Link to="/vehicle-master" style={menuLink}>🗺️ Vehicle Master</Link></li>
            </>

          )}
          {isAdmin && (
            <li>
              <Link to="/show-billed-challan" style={menuLink}>
                🗺️ Show Billed Challan
              </Link>
            </li>
          )}
          {/* ================= CONTENT ================= */}
          {isAdmin && (
            <div style={{ marginBottom: "20px" }}>
              <Link to="/dispatch-export">Dispatch Export</Link>
            </div>
          )}
          <li><Link to="/factories" style={menuLink}>🏭 Factories</Link></li>
          <li><Link to="/show-dispatch" style={menuLink}>📦 Show Dispatch</Link></li>
          <li><Link to="/show-bill" style={menuLink}>📑 Show Bills</Link></li>
          <li><Link to="/show-payment" style={menuLink}>📑 Show Payments</Link></li>
          <li><Link to="/monthly-qty-report" style={menuLink}>📊 Monthly Qty</Link></li>
          <li><Link to="/daily-qty-report" style={menuLink}>📊 Daily Qty</Link></li>
        </ul>
      </nav>

      <div style={{ padding: "25px" }}>
        {userRole === "viewer" && (
          <p style={{ color: "red" }}>
            You are logged in as a normal user. Restricted actions are hidden.
          </p>
        )}

        <Outlet context={{ userRole }} />

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

const menuLink = {
  textDecoration: "none",
  color: "#1f2937",
  fontWeight: "500",
  padding: "6px 10px",
  borderRadius: "4px"
};

export default Home;
