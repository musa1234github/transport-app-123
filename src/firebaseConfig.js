import { initializeApp } from "firebase/app";
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

// Firebase configuration pulled from Vite environment variables.
// Make sure to define these in your .env file as:
// VITE_FIREBASE_API_KEY=...
// VITE_FIREBASE_AUTH_DOMAIN=...
// VITE_FIREBASE_PROJECT_ID=...
// VITE_FIREBASE_STORAGE_BUCKET=...
// VITE_FIREBASE_MESSAGING_SENDER_ID=...
// VITE_FIREBASE_APP_ID=...
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Auth
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

// Firestore
const db = getFirestore(app);

// GOOGLE LOGIN (USE EXISTING USERS & ROLES)
const loginWithGoogle = async () => {
  const result = await signInWithPopup(auth, googleProvider);
  const user = result.user;

  try {
    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);

    // Do NOT overwrite existing roles
    if (!snap.exists()) {
      await setDoc(userRef, {
        email: user.email,
        role: "viewer",
        createdAt: new Date()
      });
    }
  } catch (err) {
    console.warn("⚠️ Failed to read/write user doc (likely rule issue):", err);
  }

  return user;
};

// GET USER ROLE
const getUserRole = async (uid) => {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data().role : null;
};

export {
  app,
  auth,
  googleProvider,
  db,
  loginWithGoogle,
  getUserRole
};
