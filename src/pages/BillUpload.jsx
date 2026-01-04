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

/* SAME FACTORY LIST AS UPLOAD DISPATCH */
const FACTORIES = [
  "ACC MARATHA",
  "AMBUJA",
  "DALMIA",
  "MP BIRLA",
  "ORIENT",
  "MANIKGARH",
  "ULTRATECH",
  "JSW"
];

const BillUpload = ({ isAdmin }) => {
  const [file, setFile] = useState(null);
  const [factory, setFactory] = useState("");
  const [loading, setLoading] = useState(false);

  /* ADMIN SAFETY */
  if (isAdmin === false) {
    return <p style={{ color: "red" }}>Access Denied</p>;
  }

  const handleUpload = async () => {
    if (!file || !factory) {
      alert("Please select Factory and Excel file");
      return;
    }

    setLoading(true);

    const reader = new FileReader();
    reader.onload = async (e) => {
      const workbook = XLSX.read(e.target.result, { type: "binary" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      let success = 0;
      let failed = [];
      const billCache = {};

      for (let i = 1; i < rows.length; i++) {
        try {
          const row = rows[i];
          if (!row || row.every(v => !v)) continue;

          const challanNo = String(row[0] || "").trim();
          if (!challanNo) continue;

          /* 🔥 CORRECT COLLECTION */
          const dispatchQ = query(
            collection(db, "TblDispatch"),
            where("ChallanNo", "==", challanNo),
            where("FactoryName", "==", factory)
          );

          const dispatchSnap = await getDocs(dispatchQ);
          if (dispatchSnap.empty) {
            failed.push(`${challanNo} (Dispatch Not Found)`);
            continue;
          }

          const dispatchDoc = dispatchSnap.docs[0];
          const dispatchData = dispatchDoc.data();

          if (dispatchData.BillID) {
            failed.push(`${challanNo} (Already Billed)`);
            continue;
          }

          const billNum = String(row[7] || "").trim();
          if (!billNum) {
            failed.push(`${challanNo} (Bill Number Missing)`);
            continue;
          }

          let billId = billCache[billNum];

          /* CREATE BILL ONLY ONCE */
          if (!billId) {
            const billQ = query(
              collection(db, "BillTable"),
              where("BillNum", "==", billNum)
            );

            const billSnap = await getDocs(billQ);
            if (!billSnap.empty) {
              failed.push(`${challanNo} (Bill ${billNum} Exists)`);
              continue;
            }

            const billRef = await addDoc(collection(db, "BillTable"), {
              BillNum: billNum,
              BillDate: row[8] ? new Date(row[8]) : new Date(),
              BillType: row[9] || "",
              FactoryName: factory,
              CreatedOn: serverTimestamp()
            });

            billId = billRef.id;
            billCache[billNum] = billId;
          }

          /* UPDATE DISPATCH */
          const updateData = {
            UnitPrice: Number(row[5]) || 0,
            FinalPrice: Number(row[6]) || 0,
            BillID: billId,
            UpdatedAt: serverTimestamp()
          };

          /* JSW SPECIAL */
          if (factory === "JSW") {
            updateData.Lr = row[9] || "";
            updateData.DeliveryNum = row[10] || "";
          }

          await updateDoc(doc(db, "TblDispatch", dispatchDoc.id), updateData);
          success++;
        } catch (err) {
          failed.push(`Row ${i + 1} (Exception)`);
        }
      }

      setLoading(false);
      alert(`Upload Completed\nSuccess: ${success}\nFailed: ${failed.length}`);
      console.log("Failed Records:", failed);
    };

    reader.readAsBinaryString(file);
  };

  return (
    <div style={{ maxWidth: 600, margin: "20px auto" }}>
      <h3>Upload Bill Excel</h3>

      <select value={factory} onChange={(e) => setFactory(e.target.value)}>
        <option value="">-- Select Factory --</option>
        {FACTORIES.map(f => (
          <option key={f} value={f}>{f}</option>
        ))}
      </select>

      <br /><br />

      <input
        type="file"
        accept=".xlsx,.xls"
        onChange={(e) => setFile(e.target.files[0])}
      />

      <br /><br />

      <button onClick={handleUpload} disabled={loading}>
        {loading ? "Uploading..." : "Import Bill"}
      </button>
    </div>
  );
};

export default BillUpload;
