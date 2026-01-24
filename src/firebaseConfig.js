// src/firebase.js

import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup
} from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc
} from "firebase/firestore";

import "./utils/migrateDates";

/* 🔐 Firebase config */
const firebaseConfig = {
  apiKey: "AIzaSyAd1bazB0rvrEhQwXWa-xUOkqLaCFZEjME",
  authDomain: "transport-app-c4674.firebaseapp.com",
  projectId: "transport-app-c4674",
  storageBucket: "transport-app-c4674.firebasestorage.app",
  messagingSenderId: "612141820756",
  appId: "1:612141820756:web:a9a642e1da95ae61b9f6c1",
  measurementId: "G-2KW1848NFH"
};

/* 🔥 Initialize Firebase */
const app = initializeApp(firebaseConfig);

/* 📊 Analytics (browser only – safe) */
let analytics;
if (typeof window !== "undefined") {
  analytics = getAnalytics(app);
}

/* 🔑 Firebase Authentication */
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: "select_account"
});

/* 🗄️ Firestore Database */
const db = getFirestore(app);

/* =====================================================
   ✅ GOOGLE LOGIN (AUTH + FIRESTORE USER CREATION)
   ===================================================== */
const loginWithGoogle = async () => {
  try {
    // 1️⃣ Google authentication (creates Auth user)
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;

    // 2️⃣ Firestore user reference (NEW standard: lowercase "users")
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    // 3️⃣ Create Firestore user ONLY if not exists
    if (!userSnap.exists()) {
      await setDoc(userRef, {
        email: user.email,
        role: "admin", // change to "user" later if needed
        createdAt: new Date()
      });
    }

    return user;
  } catch (error) {
    console.error("Google login failed:", error.code, error.message);
    throw error;
  }
};

/* =====================================================
   ✅ ADMIN CHECK (SUPPORTS OLD + NEW COLLECTIONS)
   ===================================================== */
const isAdminUser = async (user) => {
  if (!user) return false;

  // 1️⃣ Try NEW collection (lowercase)
  let snap = await getDoc(doc(db, "users", user.uid));
  if (snap.exists()) {
    return snap.data().role === "admin";
  }

  // 2️⃣ Fallback to OLD collection (capital U)
  snap = await getDoc(doc(db, "Users", user.uid));
  if (snap.exists()) {
    return snap.data().role === "admin";
  }

  return false;
};

/* =====================================================
   ✅ EXPORTS (USED IN REACT FILES)
   ===================================================== */
export {
  app,
  analytics,
  auth,
  googleProvider,
  db,
  loginWithGoogle,
  isAdminUser
};
