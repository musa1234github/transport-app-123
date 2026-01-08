import React, { useState } from "react";
import {
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  doc
} from "firebase/firestore";
import { db } from "../firebaseConfig";

const FixBrokenBills = () => {
  const [billNum, setBillNum] = useState("");
  const [factory, setFactory] = useState("");
  const [loading, setLoading] = useState(false);

  const handleFix = async () => {
    if (!billNum || !factory) {
      alert("Please enter Bill Number and select Factory");
      return;
    }

    setLoading(true);

    try {
      /* =========================
         1️⃣ FIND CORRECT BILL
      ========================== */
      const billQ = query(
        collection(db, "BillTable"),
        where("BillNum", "==", billNum),
        where("FactoryName", "==", factory)
      );

      const billSnap = await getDocs(billQ);

      if (billSnap.empty) {
        alert("Bill not found in BillTable");
        setLoading(false);
        return;
      }

      const correctBillDoc = billSnap.docs[0];
      const correctBillId = correctBillDoc.id;

      /* =========================
         2️⃣ FIND DISPATCH ROWS
      ========================== */
      const dispQ = query(
        collection(db, "TblDispatch"),
        where("BillNum", "==", billNum),
        where("FactoryName", "==", factory)
      );

      const dispSnap = await getDocs(dispQ);

      if (dispSnap.empty) {
        alert("No dispatch rows found for this bill");
        setLoading(false);
        return;
      }

      /* =========================
         3️⃣ UPDATE BILLID
      ========================== */
      let updated = 0;

      for (const d of dispSnap.docs) {
        await updateDoc(doc(db, "TblDispatch", d.id), {
          BillID: correctBillId
        });
        updated++;
      }

      alert(
        `✅ FIX COMPLETED SUCCESSFULLY\n\nBill: ${billNum}\nFactory: ${factory}\nDispatch Rows Updated: ${updated}`
      );
    } catch (err) {
      console.error(err);
      alert("Error occurred. Check console.");
    }

    setLoading(false);
  };

  return (
    <div
      style={{
        maxWidth: 450,
        margin: "40px auto",
        padding: 20,
        border: "1px solid #ccc"
      }}
    >
      <h3>Fix Broken Bill Link</h3>

      <label>Bill Number</label>
      <input
        type="text"
        value={billNum}
        onChange={e => setBillNum(e.target.value)}
        style={{ width: "100%", marginBottom: 10 }}
      />

      <label>Factory</label>
      <select
        value={factory}
        onChange={e => setFactory(e.target.value)}
        style={{ width: "100%", marginBottom: 20 }}
      >
        <option value="">-- Select Factory --</option>
        <option value="ULTRATECH">ULTRATECH</option>
        <option value="MANIGARH">MANIGARH</option>
        <option value="JSW">JSW</option>
      </select>

      <button
        onClick={handleFix}
        disabled={loading}
        style={{ width: "100%", padding: 10 }}
      >
        {loading ? "Fixing..." : "Fix Bill Link"}
      </button>

      <p style={{ marginTop: 15, color: "red" }}>
        ⚠️ Run this only once per bill.  
        Remove this page after fixing.
      </p>
    </div>
  );
};

export default FixBrokenBills;
