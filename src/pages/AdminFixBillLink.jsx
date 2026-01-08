import React, { useState } from "react";
import { db } from "../firebaseConfig";
import {
  collection,
  getDocs,
  updateDoc,
  doc
} from "firebase/firestore";

const AdminFixBillLink = ({ isAdmin }) => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");

  if (!isAdmin) {
    return <h3 style={{ color: "red" }}>Access Denied</h3>;
  }

  const fixBillLinks = async () => {
    setLoading(true);
    setResult("");

    try {
      /* ===== LOAD BILLS ===== */
      const billSnap = await getDocs(collection(db, "BillTable"));
      const billNumToId = {};

      billSnap.docs.forEach(b => {
        const bill = b.data();
        if (bill.BillNum) {
          billNumToId[bill.BillNum.trim()] = b.id;
        }
      });

      /* ===== LOAD DISPATCH ===== */
      const dispSnap = await getDocs(collection(db, "TblDispatch"));

      let fixed = 0;
      let skipped = 0;

      for (const d of dispSnap.docs) {
        const r = d.data();

        // already linked correctly
        if (r.BillID && billNumToId[r.BillNum] === r.BillID) {
          skipped++;
          continue;
        }

        // link using BillNum
        if (!r.BillID && r.BillNum && billNumToId[r.BillNum]) {
          await updateDoc(doc(db, "TblDispatch", d.id), {
            BillID: billNumToId[r.BillNum]
          });
          fixed++;
        }
      }

      setResult(
        `Fix Completed ✔️\n\nUpdated: ${fixed}\nSkipped: ${skipped}`
      );
    } catch (err) {
      console.error(err);
      setResult("Error occurred. Check console.");
    }

    setLoading(false);
  };

  return (
    <div style={{ padding: 30, maxWidth: 600 }}>
      <h2>Admin: Fix Bill ↔ Dispatch Link</h2>

      <p style={{ color: "darkred", fontWeight: "bold" }}>
        ⚠️ Run this ONLY ONCE.  
        It permanently fixes old broken BillID links.
      </p>

      <button
        onClick={fixBillLinks}
        disabled={loading}
        style={{ padding: 10 }}
      >
        {loading ? "Fixing..." : "Fix Bill Links"}
      </button>

      {result && (
        <pre
          style={{
            marginTop: 20,
            background: "#f5f5f5",
            padding: 15
          }}
        >
          {result}
        </pre>
      )}
    </div>
  );
};

export default AdminFixBillLink;
