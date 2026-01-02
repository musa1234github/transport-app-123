// src/pages/Login.jsx
import React, { useState } from "react";
import { auth } from "../firebaseConfig";
import { signInWithEmailAndPassword } from "firebase/auth";
import { useNavigate } from "react-router-dom";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();

  // List of admin emails
  const adminEmails = ["79mohammedkhan@gmail.com"];

  const handleLogin = async () => {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const loggedInEmail = userCredential.user.email;
      console.log("Logged in:", loggedInEmail);

      // Check if the user is admin
      const isAdmin = adminEmails.includes(loggedInEmail);

      if (isAdmin) {
        console.log("Admin user logged in!");
        // Optionally store admin flag in sessionStorage/localStorage
        sessionStorage.setItem("isAdmin", "true");
      } else {
        sessionStorage.setItem("isAdmin", "false");
      }

      // Redirect to dashboard
      navigate("/dashboard");
    } catch (error) {
      console.error("Login error:", error);
      alert(error.message);
    }
  };

  return (
    <div style={{ maxWidth: "400px", margin: "50px auto" }}>
      <h2>Login</h2>
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{ width: "100%", padding: "10px", margin: "10px 0" }}
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={{ width: "100%", padding: "10px", margin: "10px 0" }}
      />
      <button onClick={handleLogin} style={{ width: "100%", padding: "10px" }}>
        Login
      </button>
    </div>
  );
}
