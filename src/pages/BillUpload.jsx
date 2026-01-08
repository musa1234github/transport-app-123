import React, { useState } from "react";
import * as XLSX from "xlsx";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp
} from "firebase/firestore";
import { db } from "../firebaseConfig";

const FACTORIES = ["MANIGARH", "ULTRATECH", "JSW"];

/* ===== SAFE DATE ===== */
const safeDate = (v) => {
  if (!v) return null;

  // Excel serial number
  if (typeof v === "number") {
    return new Date(Math.round((v - 25569) * 86400 * 1000));
  }

  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

/* ===== SAFE NUMBER ===== */
const safeNum = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "string") v = v.replace(/,/g, "");
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
};

const BillUpload = ({ isAdmin }) => {
  const [file, setFile] = useState(null);
  const [factory, setFactory] = useState("");
  const [loading, setLoading] = useState(false);

  if (!isAdmin) {
    return <h3 style={{ color: "red" }}>Access Denied</h3>;
  }

  const handleUpload = async () => {
    if (!file || !factory) {
      alert("Select Factory and Excel file");
      return;
    }

    setLoading(true);

    const reader = new FileReader();

    reader.onload = async (e) => {
      const wb = XLSX.read(e.target.result, { type: "binary" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

      let success = 0;
      let skipped = 0;

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.every(v => v === null || v === "")) continue;

        /* ===== EXACT & CORRECT COLUMN MAPPING ===== */
        const challanNo = String(row[0] || "").trim();
        const quantity = safeNum(row[4]);
        const unitPrice = safeNum(row[6]); // may contain commas

        // 🔥 FINAL PRICE IS CALCULATED — NOT READ
        const finalPrice = quantity * unitPrice;

        const billNum = String(row[8] || "").trim();
        const billDate = safeDate(row[9]);
        const billType = String(row[10] || "").trim();
        const deliveryNum = String(row[11] || "").trim();

        if (!challanNo || !billNum || quantity === 0 || unitPrice === 0) {
          skipped++;
          continue;
        }

        /* ===== FIND DISPATCH ===== */
        const dq = query(
          collection(db, "TblDispatch"),
          where("ChallanNo", "==", challanNo),
          where("FactoryName", "==", factory)
        );

        const ds = await getDocs(dq);
        if (ds.empty) {
          skipped++;
          continue;
        }

        const dispatchDoc = ds.docs[0];
        const dispatch = dispatchDoc.data();

        if (dispatch.BillID) {
          skipped++;
          continue;
        }

        /* ===== FIND OR CREATE BILL (BillNum + Factory) ===== */
        let billId = null;

        const bq = query(
          collection(db, "BillTable"),
          where("BillNum", "==", billNum),
          where("FactoryName", "==", factory)
        );

        const bs = await getDocs(bq);

        if (!bs.empty) {
          billId = bs.docs[0].id;
        } else {
          const billRef = await addDoc(collection(db, "BillTable"), {
            BillNum: billNum,
            BillDate: billDate,
            BillType: billType,
            FactoryName: factory,
            CreatedOn: serverTimestamp()
          });
          billId = billRef.id;
        }

        /* ===== UPDATE DISPATCH (CORRECT VALUES) ===== */
        await updateDoc(doc(db, "TblDispatch", dispatchDoc.id), {
          DispatchQuantity: quantity,
          UnitPrice: unitPrice,
          FinalPrice: finalPrice, // ✅ REAL VALUE
          DeliveryNum: deliveryNum,
          BillID: billId,
          BillNum: billNum,
          UpdatedAt: serverTimestamp()
        });

        success++;
      }

      setLoading(false);
      alert(`Upload completed\nSuccess: ${success}\nSkipped: ${skipped}`);
    };

    reader.readAsBinaryString(file);
  };

  return (
    <div style={{ maxWidth: 500, margin: "30px auto" }}>
      <h3>Upload Bill</h3>

      <select value={factory} onChange={e => setFactory(e.target.value)}>
        <option value="">-- Select Factory --</option>
        {FACTORIES.map(f => (
          <option key={f} value={f}>{f}</option>
        ))}
      </select>

      <br /><br />

      <input
        type="file"
        accept=".xlsx,.xls"
        onChange={e => setFile(e.target.files[0])}
      />

      <br /><br />

      <button onClick={handleUpload} disabled={loading}>
        {loading ? "Uploading..." : "Upload Bill"}
      </button>
    </div>
  );
};

export default BillUpload;
