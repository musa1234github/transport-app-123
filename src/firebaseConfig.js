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

/* 🔐 Firebase configuration – OLD PROJECT */
const firebaseConfig = {
  apiKey: "AIzaSyAd1bazB0rvrEhQwXWa-xUOkqLaCFZEjME",
  authDomain: "transport-app-c4674.firebaseapp.com",
  projectId: "transport-app-c4674",
  storageBucket: "transport-app-c4674.appspot.com",
  messagingSenderId: "612141820756",
  appId: "1:612141820756:web:a9a642e1da95ae61b9f6c1"
};

/* 🔥 Initialize Firebase */
const app = initializeApp(firebaseConfig);

/* 🔑 Auth */
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

/* 🗄️ Firestore */
const db = getFirestore(app);

/* =====================================================
   ✅ GOOGLE LOGIN (USE EXISTING USERS & ROLES)
   ===================================================== */
const loginWithGoogle = async () => {
  const result = await signInWithPopup(auth, googleProvider);
  const user = result.user;

  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  // IMPORTANT: do NOT overwrite existing roles
  if (!snap.exists()) {
    await setDoc(userRef, {
      email: user.email,
      role: "viewer",   // default for NEW users only
      createdAt: new Date()
    });
  }

  return user;
};

/* =====================================================
   ✅ GET USER ROLE
   ===================================================== */
const getUserRole = async (uid) => {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data().role : null;
};

/* 📦 Exports */
export {
  app,
  auth,
  googleProvider,
  db,
  loginWithGoogle,
  getUserRole
};
