// src/firebaseConfig.js
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore"; // Firestore

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAd1bazB0rvrEhQwXWa-xUOkqLaCFZEjME",
  authDomain: "transport-app-c4674.firebaseapp.com",
  projectId: "transport-app-c4674",
  storageBucket: "transport-app-c4674.firebasestorage.app",
  messagingSenderId: "612141820756",
  appId: "1:612141820756:web:a9a642e1da95ae61b9f6c1",
  measurementId: "G-2KW1848NFH"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Analytics (optional)
let analytics;
if (typeof window !== "undefined") {
  analytics = getAnalytics(app);
}

// Firebase Auth
const auth = getAuth(app);

// Google provider
const googleProvider = new GoogleAuthProvider();

// Firestore (only one declaration!)
const db = getFirestore(app);

// Export all
export { app, auth, googleProvider, db };
