import React, { useState, useEffect } from "react";
import { db } from "../firebaseConfig";
import { collection, addDoc, query, where, getDocs } from "firebase/firestore";
import * as XLSX from "xlsx";
import "./UploadDispatch.css";

/* ------------------ CONSTANTS ------------------ */

const FACTORY_NAME_FIXES = {
  MANIKGARH: "MANIGARH"
};

const FACTORY_COLUMN_MAPS = {
  ORIENT: "dynamic",
  ULTRATECH: "dynamic",
  MANIGARH: {
    DispatchDate: 5,
    Qty: 3,
    ChallanNo: 8,
    VehicleNo: 6,
    PartyName: 1,
    Destination: 2,
    Advance: 10,
    Diesel: 9
  },
  ACC: {
    DispatchDate: 0,
    Qty: 5,
    ChallanNo: 2,
    VehicleNo: 3,
    PartyName: 4,
    Destination: 6,
    Advance: 7,
    Diesel: 8
  },
  "ACC MARATHA": {
    DispatchDate: 0,
    Qty: 5,
    ChallanNo: 2,
    VehicleNo: 3,
    PartyName: 4,
    Destination: 6,
    Advance: 7,
    Diesel: 8
  },
  AMBUJA: {
    DispatchDate: 0,
    Qty: 5,
    ChallanNo: 2,
    VehicleNo: 3,
    PartyName: 4,
    Destination: 6,
    Advance: 7,
    Diesel: 8
  },
  DALMIA: {
    DispatchDate: 0,
    Qty: 5,
    ChallanNo: 2,
    VehicleNo: 3,
    PartyName: 4,
    Destination: 6,
    Advance: 7,
    Diesel: 8
  },
  "MP BIRLA": {
    DispatchDate: 0,
    Qty: 5,
    ChallanNo: 2,
    VehicleNo: 3,
    PartyName: 4,
    Destination: 6,
    Advance: 7,
    Diesel: 8
  },
  JSW: {
    VehicleNo: 0,
    Qty: 1,
    PartyName: 3,
    Destination: 4,
    ChallanNo: 6,
    DispatchDate: 7,
    Diesel: 8,
    Advance: 9
  }
};

/* ------------------ HELPERS ------------------ */

const parseExcelDate = (value) => {
  if (!value) return null;

  if (typeof value === "number") {
    const d = XLSX.SSF.parse_date_code(value);
    return d ? new Date(d.y, d.m - 1, d.d) : null;
  }

  if (typeof value === "string") {
    const parts = value
      .trim()
      .replace(/\./g, "-")
      .replace(/\//g, "-")
      .split("-");

    if (parts.length === 3) {
      let [a, b, c] = parts.map(Number);
      if (c < 100) c += 2000;

      const day = a > 12 ? a : b;
      const month = a > 12 ? b : a;

      return new Date(c, month - 1, day);
    }
  }

  return null;
};

const extractLast4Digits = (value = "") => {
  const m = value.toString().replace(/\s+/g, "").match(/(\d{4})$/);
  return m ? m[1] : null;
};

const normalizeChallan = (v) =>
  String(v || "").trim().toUpperCase();

/* ------------------ COMPONENT ------------------ */

const UploadDispatch = () => {
  const [factory, setFactory] = useState("");
  const [file, setFile] = useState(null);
  const [message, setMessage] = useState("");
  const [vehicles, setVehicles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    const loadVehicles = async () => {
      const snap = await getDocs(collection(db, "VehicleMaster"));
      const list = snap.docs.map(d => ({
        id: d.id,
        VehicleNo: d.data().VehicleNo,
        last4: extractLast4Digits(d.data().VehicleNo)
      }));
      setVehicles(list);
    };
    loadVehicles();
  }, []);

  const isDuplicate = async (challan, factoryName) => {
    const q = query(
      collection(db, "TblDispatch"),
      where("ChallanNo", "==", challan),
      where("FactoryName", "==", factoryName)
    );
    const snap = await getDocs(q);
    return !snap.empty;
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    setIsUploading(true);
    setMessage("");

    if (!file || !factory) {
      setMessage("❌ File and Factory required");
      setIsUploading(false);
      return;
    }

    let factoryName = factory.toUpperCase().trim();
    factoryName = FACTORY_NAME_FIXES[factoryName] || factoryName;

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      let dataRows = [];
      let colMap = null;

      /* 🔥 FIXED DYNAMIC LOGIC */
      if (FACTORY_COLUMN_MAPS[factoryName] === "dynamic") {

        const headerRowIndex = rows.findIndex(r =>
          r && r.some(c =>
            String(c).toUpperCase().includes("SOLD-TO")
          )
        );

        if (headerRowIndex === -1) {
          throw new Error("Header row not found");
        }

        const header = rows[headerRowIndex];
        colMap = {};

        header.forEach((h, i) => {
          if (h) colMap[String(h).trim().toUpperCase()] = i;
        });

        dataRows = rows.slice(headerRowIndex + 1);

      } else {
        colMap = FACTORY_COLUMN_MAPS[factoryName];
        dataRows = rows;
      }

      const challanSet = new Set();
      let uploaded = 0;

      for (const row of dataRows) {
        if (!row || row.every(v => !v)) continue;

        const qty = Number(row[colMap.Qty] || 0);
        if (qty <= 0) continue;

        const dispatchDate = parseExcelDate(row[colMap.DispatchDate]);
        if (!dispatchDate) continue;

        const vehicleLast4 = extractLast4Digits(row[colMap.VehicleNo]);
        const matchedVehicle = vehicles.find(v => v.last4 === vehicleLast4);
        if (!matchedVehicle) continue;

        const challanNo = normalizeChallan(row[colMap.ChallanNo]);
        if (!challanNo || challanSet.has(challanNo)) continue;
        if (await isDuplicate(challanNo, factoryName)) continue;
        challanSet.add(challanNo);

        let partyName = "";
        if (factoryName === "ULTRATECH") {
          partyName = row[colMap["SOLD-TO-PARTY NAME"]] || "";
        } else if (factoryName === "ORIENT") {
          partyName = row[colMap["SHIP TO PARTY NAME"]] || "";
        } else {
          partyName = row[colMap.PartyName] || "";
        }

        await addDoc(collection(db, "TblDispatch"), {
          DispatchDate: dispatchDate,
          ChallanNo: challanNo,
          VehicleNo: matchedVehicle.VehicleNo,
          VehicleId: matchedVehicle.id,
          PartyName: String(partyName).trim(),
          Destination: row[colMap.Destination],
          DispatchQuantity: qty,
          Advance: Number(row[colMap.Advance] || 0),
          Diesel: Number(row[colMap.Diesel] || 0),
          FactoryName: factoryName,
          CreatedOn: new Date()
        });

        uploaded++;
      }

      setMessage(`✅ ${uploaded} rows uploaded successfully`);
    } catch (err) {
      console.error(err);
      setMessage("❌ Upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="upload-container">
      <h3>Upload Dispatch Data</h3>

      {message && <div className="message">{message}</div>}

      <form onSubmit={handleUpload}>
        <select value={factory} onChange={e => setFactory(e.target.value)} required>
          <option value="">-- Select Factory --</option>
          <option>ACC MARATHA</option>
          <option>AMBUJA</option>
          <option>DALMIA</option>
          <option>MP BIRLA</option>
          <option>ORIENT</option>
          <option>MANIKGARH</option>
          <option>ULTRATECH</option>
          <option>JSW</option>
        </select>

        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={e => setFile(e.target.files[0])}
          required
        />

        <button type="submit" disabled={isUploading}>
          {isUploading ? "Uploading..." : "Upload"}
        </button>
      </form>
    </div>
  );
};

export default UploadDispatch;
