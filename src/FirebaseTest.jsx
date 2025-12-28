import { useEffect } from "react";
import { db } from "./firebaseConfig";
import { collection, getDocs } from "firebase/firestore";

export default function FirebaseTest() {
  useEffect(() => {
    const testFirebase = async () => {
      try {
       const snapshot = await getDocs(collection(db, "factories"));

        console.log("✅ Firebase connected");
        console.log("Factory count:", snapshot.size);

        snapshot.forEach((doc) => {
          console.log(doc.id, doc.data());
        });
      } catch (error) {
        console.error("❌ Firebase error:", error);
      }
    };

    testFirebase();
  }, []);

  return (
    <div>
      <h2>Firebase Connection Test</h2>
      <p>Open browser console (F12)</p>
    </div>
  );
}
