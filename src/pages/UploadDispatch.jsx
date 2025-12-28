import React, { useState } from "react";
import { db } from "../firebaseConfig";
import {
  collection,
  addDoc,
  query,
  where,
  getDocs
} from "firebase/firestore";
import * as XLSX from "xlsx";

const UploadDispatch = () => {
  const [factory, setFactory] = useState("10");
  const [file, setFile] = useState(null);
  const [message, setMessage] = useState("");

  /* ===============================
     FACTORY MAP
     =============================== */
  const factoryMap = {
    "10": "JSW",
    "6": "Manigar",
    "7": "Ultratech"
  };

  /* ===============================
     DUPLICATE CHECK (Challan + Factory)
     =============================== */
  const isDuplicate = async (challanNo, vid) => {
    const q = query(
      collection(db, "TblDispatch"),
      where("ChallanNo", "==", String(challanNo)),
      where("DisVid", "==", Number(vid))
    );

    const snap = await getDocs(q);
    return !snap.empty;
  };

  /* ===============================
     UPLOAD HANDLER
     =============================== */
  const handleUpload = async (e) => {
    e.preventDefault();
    setMessage("");

    if (!file) {
      setMessage("❌ Please select an Excel file");
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      if (rows.length <= 1) {
        setMessage("❌ No data found in Excel");
        return;
      }

      let uploaded = 0;
      const vid = Number(factory);
      const factoryName = factoryMap[factory];

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;

        /*
          Common format:
          JSW       : Challan, Dest, Vehicle, Date, Qty, Party
          Others    : Challan, Dest, Vehicle, Date, Qty
        */
        const ChallanNo = row[0];
        const Destination = row[1];
        const VehicleNo = row[2];
        const DispatchDate = row[3];   // KEEP AS-IS
        const DispatchQuantity = row[4];
        const PartyName = row[5];

        if (!ChallanNo || !VehicleNo) continue;

        const exists = await isDuplicate(ChallanNo, vid);
        if (exists) continue;

        const dispatchObj = {
          ChallanNo: String(ChallanNo),
          Destination: Destination || "",
          VehicleNo: VehicleNo || "",
          DispatchDate: DispatchDate ?? "", // ✅ NO DATE CONVERSION
          DispatchQuantity: DispatchQuantity || 0,
          DisVid: vid,
          FactoryName: factoryName,
          PartyName: vid === 10 ? PartyName || "" : null,
          CreatedOn: new Date()
        };

        await addDoc(collection(db, "TblDispatch"), dispatchObj);
        uploaded++;
      }

      setMessage(`✅ ${uploaded} record(s) uploaded successfully`);
      setFile(null);
    } catch (err) {
      console.error(err);
      setMessage("❌ Error while processing Excel file");
    }
  };

  return (
    <div style={{ maxWidth: "600px", margin: "20px auto" }}>
      <h2>Upload Dispatch</h2>

      {message && (
        <div
          style={{
            marginBottom: "10px",
            color: message.startsWith("✅") ? "green" : "red"
          }}
        >
          {message}
        </div>
      )}

      <form onSubmit={handleUpload}>
        {/* FACTORY DROPDOWN */}
        <div style={{ marginBottom: "10px" }}>
          <label>Factory: </label>
          <select
            value={factory}
            onChange={(e) => setFactory(e.target.value)}
          >
            <option value="10">JSW</option>
            <option value="6">Manigar</option>
            <option value="7">Ultratech</option>
          </select>
        </div>

        {/* FILE INPUT */}
        <div style={{ marginBottom: "10px" }}>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setFile(e.target.files[0])}
          />
        </div>

        <button type="submit">Upload</button>
      </form>
    </div>
  );
};

export default UploadDispatch;
