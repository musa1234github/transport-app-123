import React, { useState, useEffect } from "react";
import { db } from "../firebaseConfig";
import { collection, addDoc, query, where, getDocs } from "firebase/firestore";
import * as XLSX from "xlsx";

/* ------------------ CONSTANTS ------------------ */

const DATE_FORMATS = ["dd.mm.yyyy", "dd/mm/yyyy", "mm/dd/yyyy", "yyyy-mm-dd"];

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

      let day, month;
      if (a > 12) {
        day = a;
        month = b;
      } else if (b > 12) {
        day = b;
        month = a;
      } else {
        day = a;
        month = b;
      }

      return new Date(c, month - 1, day);
    }
  }

  return null;
};

const normalizeVehicle = (value = "") =>
  value.toString().replace(/\s+/g, "").toUpperCase();

const extractLast4Digits = (value = "") => {
  const match = normalizeVehicle(value).match(/(\d{4})$/);
  return match ? match[1] : null;
};

const normalizeChallan = (v) =>
  String(v || "").trim().toUpperCase();

/* ------------------ COMPONENT ------------------ */

const UploadDispatch = () => {
  const [factory, setFactory] = useState("");
  const [file, setFile] = useState(null);
  const [message, setMessage] = useState("");
  const [vehicles, setVehicles] = useState([]);

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
    setMessage("");

    if (!file || !factory) {
      setMessage("❌ File and Factory required");
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

      if (FACTORY_COLUMN_MAPS[factoryName] === "dynamic") {
        const header = rows[1];
        colMap = {};
        header.forEach((h, i) => {
          if (h) colMap[String(h).trim().toUpperCase()] = i;
        });
        dataRows = rows.slice(2);
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

        const rawDate = row[colMap.DispatchDate];
        const dispatchDate = parseExcelDate(rawDate);
        if (!dispatchDate) continue;

        const vehicleLast4 = extractLast4Digits(row[colMap.VehicleNo]);
        if (!vehicleLast4) continue;

        const matchedVehicle = vehicles.find(v => v.last4 === vehicleLast4);
        if (!matchedVehicle) continue;

        const challanNo = normalizeChallan(row[colMap.ChallanNo]);
        if (!challanNo) continue;

        if (challanSet.has(challanNo)) continue;
        if (await isDuplicate(challanNo, factoryName)) continue;
        challanSet.add(challanNo);

        /* ✅ PARTY NAME IS OPTIONAL */
        let partyName = "";
        if (factoryName === "ORIENT") {
          partyName = row[colMap["SHIP TO PARTY NAME"]] || "";
        } else if (factoryName === "ULTRATECH") {
          partyName = row[colMap["SOLD-TO-PARTY NAME"]] || "";
        } else {
          partyName = row[colMap.PartyName] || "";
        }

        const dto = {
          DispatchDate: dispatchDate,
          ChallanNo: challanNo,
          VehicleNo: matchedVehicle.VehicleNo,
          VehicleId: matchedVehicle.id,
          PartyName: String(partyName).trim(), // empty allowed
          Destination: row[colMap.Destination],
          DispatchQuantity: qty,
          Advance: Number(row[colMap.Advance] || 0),
          Diesel: Number(row[colMap.Diesel] || 0),
          FactoryName: factoryName,
          CreatedOn: new Date()
        };

        await addDoc(collection(db, "TblDispatch"), dto);
        uploaded++;
      }

      setMessage(`✅ ${uploaded} rows uploaded successfully`);
    } catch (err) {
      console.error(err);
      setMessage("❌ Upload failed");
    }
  };

  return (
    <div style={{ maxWidth: 600, margin: "20px auto" }}>
      <h3>Upload Dispatch Excel</h3>
      {message && <div>{message}</div>}

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

        <br /><br />

        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={e => setFile(e.target.files[0])}
          required
        />

        <br /><br />
        <button type="submit">Upload</button>
      </form>
    </div>
  );
};

export default UploadDispatch;
