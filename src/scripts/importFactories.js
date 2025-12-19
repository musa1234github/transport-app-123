import { collection, addDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebaseConfig";
import factories from "./factories.json";

const importFactories = async () => {
  try {
    const colRef = collection(db, "factories");

    for (const factory of factories) {
      // 🔒 prevent duplicates by code + name
      const q = query(
        colRef,
        where("code", "==", factory.code),
        where("factoryName", "==", factory.factoryName)
      );

      const existing = await getDocs(q);

      if (existing.empty) {
        await addDoc(colRef, {
          ...factory,
          createdOn: new Date()
        });
        console.log("Inserted:", factory.factoryName);
      } else {
        console.log("Skipped (already exists):", factory.factoryName);
      }
    }

    console.log("✅ Factory import completed");
  } catch (err) {
    console.error("❌ Import error:", err);
  }
};

export default importFactories;
