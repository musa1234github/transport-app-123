import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import "./utils/migrateDates";

// 🔒 KEEP your existing config intact
const firebaseConfig = {
  apiKey: "AIzaSyAd1bazB0rvrEhQwXWa-xUOkqLaCFZEjME",
  authDomain: "transport-app-c4674.firebaseapp.com",
  projectId: "transport-app-c4674",
  storageBucket: "transport-app-c4674.firebasestorage.app",
  messagingSenderId: "612141820756",
  appId: "1:612141820756:web:a9a642e1da95ae61b9f6c1",
  measurementId: "G-2KW1848NFH"
};

// Initialize Firebase app
const app = initializeApp(firebaseConfig);

// Initialize analytics only in browser
let analytics;
if (typeof window !== "undefined") {
  analytics = getAnalytics(app);
}

// 🔑 Authentication setup
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// 🔥 Firestore database reference
const db = getFirestore(app);

// ✅ Helper function to check if logged-in user is admin
const isAdminUser = async (user) => {
  if (!user) return false;
  const token = await user.getIdTokenResult();
  return token.claims.admin === true;
};

// ✅ Export everything
export { app, analytics, auth, googleProvider, db, isAdminUser };
