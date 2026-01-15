import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import "./utils/migrateDates";

/* 🔒 Firebase config */
const firebaseConfig = {
  apiKey: "AIzaSyAd1bazB0rvrEhQwXWa-xUOkqLaCFZEjME",
  authDomain: "transport-app-c4674.firebaseapp.com",
  projectId: "transport-app-c4674",
  storageBucket: "transport-app-c4674.firebasestorage.app",
  messagingSenderId: "612141820756",
  appId: "1:612141820756:web:a9a642e1da95ae61b9f6c1",
  measurementId: "G-2KW1848NFH"
};

/* 🔥 Init Firebase */
const app = initializeApp(firebaseConfig);

/* 📊 Analytics (browser only) */
let analytics;
if (typeof window !== "undefined") {
  analytics = getAnalytics(app);
}

/* 🔑 Auth */
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

/* 🗄️ Firestore */
const db = getFirestore(app);

/* ✅ ADMIN CHECK — SPARK SAFE */
const isAdminUser = async (user) => {
  if (!user) return false;

  const snap = await getDoc(doc(db, "Users", user.uid));
  if (!snap.exists()) return false;

  return snap.data().role === "admin";
};

/* ✅ EXPORTS */
export { app, analytics, auth, googleProvider, db, isAdminUser };
