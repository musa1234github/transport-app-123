import React from "react";
import { collection, getDocs, deleteDoc, doc } from "firebase/firestore";
import { db } from "../firebaseConfig";

const deleteDuplicateByChallanNo = async () => {
  console.log("Delete Duplicate Challan button clicked");

  if (!window.confirm("Delete duplicate challans?")) return;

  const snapshot = await getDocs(collection(db, "TblDispatch"));
  console.log("Total records in DB:", snapshot.size);

  const seen = new Set();
  const duplicates = [];

  snapshot.docs.forEach(ds => {
    const challan = (ds.data().ChallanNo || "").trim();
    if (!challan) return;

    if (seen.has(challan)) {
      duplicates.push(ds.id);
    } else {
      seen.add(challan);
    }
  });

  console.log("Duplicate challans found:", duplicates.length);

  if (duplicates.length === 0) {
    alert("No duplicate challan numbers found.");
    return;
  }

  for (const id of duplicates) {
    await deleteDoc(doc(db, "TblDispatch", id));
  }

  alert(`Deleted ${duplicates.length} duplicate challans.`);
};

const DelDuplicateChallan = () => {
  return (
    <div style={{ padding: "20px" }}>
      <h2>Delete Duplicate Challans</h2>

      <button
        onClick={() => deleteDuplicateByChallanNo()}
        style={{
          padding: "10px 20px",
          backgroundColor: "#dc3545",
          color: "#fff",
          border: "none",
          borderRadius: "4px",
          cursor: "pointer"
        }}
      >
        Delete Duplicate Challans
      </button>
    </div>
  );
};

export default DelDuplicateChallan;
