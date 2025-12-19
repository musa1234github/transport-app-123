import React, { useEffect, useState } from "react";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import { db } from "../firebaseConfig";

const FactoryList = () => {
  const [factories, setFactories] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadFactories = async () => {
      try {
        const q = query(collection(db, "factories"), orderBy("factoryName"));
        const snapshot = await getDocs(q);
        const data = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setFactories(data);
      } catch (error) {
        console.error("Error loading factories:", error);
      } finally {
        setLoading(false);
      }
    };

    loadFactories();
  }, []);

  if (loading) return <p>Loading factories...</p>;

  return (
    <div>
      <h2>Factories</h2>
      <ul>
        {factories.map(f => (
          <li key={f.id}>{f.factoryName}</li>
        ))}
      </ul>
    </div>
  );
};

// ✅ Must have this line
export default FactoryList;
