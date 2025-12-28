// src/firebase.js

// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getAnalytics } from "firebase/analytics";

// Your web app's Firebase configuration
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
export const analytics = getAnalytics(app);

// Export Firestore and Auth for use in your React app
export const db = getFirestore(app);
export const auth = getAuth(app);
