// src/pages/TestFirebase.jsx
import React, { useEffect } from "react";
import { db } from "../firebaseConfig";
import { collection, getDocs } from "firebase/firestore";

const TestFirebase = () => {
  useEffect(() => {
    const testFetch = async () => {
      try {
        console.log("Testing Firebase connection...");

        const snapshot = await getDocs(collection(db, "TblDispatch")); // use your collection name
        console.log("Snapshot received:", snapshot);

        const data = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        }));

        console.log("Documents fetched:", data);
      } catch (err) {
        console.error("Error fetching data:", err);
      }
    };

    testFetch();
  }, []);

  return (
    <div style={{ padding: "20px" }}>
      <h2>Firebase Test Component</h2>
      <p>Check the browser console for output.</p>
    </div>
  );
};

export default TestFirebase;
