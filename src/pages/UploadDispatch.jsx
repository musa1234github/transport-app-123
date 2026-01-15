import React, { useState, useEffect } from "react";
import { db } from "../firebaseConfig";
import { collection, addDoc, query, where, getDocs } from "firebase/firestore";
import * as XLSX from "xlsx";
import "./UploadDispatch.css"; // Add this import at the top

/* ================= CONSTANTS ================= */

const FACTORY_NAME_FIXES = {
  MANIKGARH: "MANIGARH"
};

const FACTORY_COLUMN_MAPS = {
  ORIENT: "dynamic",
  ULTRATECH: {
    DispatchDate: 2,      // PGI Date (3rd column, index 2)
    Qty: 11,              // Quantity (MT) - index 11
    ChallanNo: 1,         // Delivery No - index 1
    VehicleNo: 20,        // Truck No - index 20
    PartyName: 7,         // Sold-to-Party Name - index 7
    Destination: 10,      // City Code Description - index 10
    Advance: 22,          // ADV - index 22
    Diesel: 21            // DSL - index 21
  },
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

/* ================= HELPERS ================= */

const parseExcelDate = (value) => {
  if (!value) return null;

  if (typeof value === "number") {
    const d = XLSX.SSF.parse_date_code(value);
    return d ? new Date(d.y, d.m - 1, d.d) : null;
  }

  if (typeof value === "string") {
    const v = value.trim().replace(/\./g, "-").replace(/\//g, "-");
    const parts = v.split("-");
    
    if (parts.length === 3) {
      let [a, b, c] = parts.map(Number);
      
      // Handle 2-digit year
      if (c < 100) c += 2000;
      
      // Check for DD-MM-YYYY format (common in Indian dates)
      if (a > 31 && a <= 99) {
        // a might be Excel serial date
        return null;
      }
      
      // Try to determine format
      if (a > 12 && a <= 31) {
        // DD-MM-YYYY
        return new Date(c, b - 1, a);
      } else if (b > 12 && b <= 31) {
        // MM-DD-YYYY
        return new Date(c, a - 1, b);
      } else {
        // Ambiguous, try both
        try {
          // Try DD-MM-YYYY first (more common for Indian dates)
          const date1 = new Date(c, b - 1, a);
          // Try MM-DD-YYYY second
          const date2 = new Date(c, a - 1, b);
          
          // Check which date is valid
          if (date1.getDate() === a && date1.getMonth() === b - 1) {
            return date1;
          } else if (date2.getDate() === b && date2.getMonth() === a - 1) {
            return date2;
          }
          
          // If neither matches exactly, return the first valid date
          if (date1 instanceof Date && !isNaN(date1)) return date1;
          if (date2 instanceof Date && !isNaN(date2)) return date2;
        } catch (e) {
          return null;
        }
      }
    }
  }
  return null;
};

const normalizeVehicle = (v = "") =>
  v.toString().replace(/[^A-Z0-9]/gi, "").toUpperCase();

const extractLast4Digits = (v = "") => {
  const m = normalizeVehicle(v).match(/(\d{4})$/);
  return m ? m[1] : null;
};

const normalizeChallan = (v) =>
  String(v || "").trim().toUpperCase();

/* ================= COMPONENT ================= */

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

    let factoryName = FACTORY_NAME_FIXES[factory] || factory;
    factoryName = factoryName.toUpperCase().trim();

    let uploaded = 0;
    let vehicleMiss = 0;
    let dateMiss = 0;
    let dupMiss = 0;
    let skippedRows = 0;

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      let colMap = {};
      let dataRows = [];

      /* ===== DYNAMIC HEADER DETECTION (ORIENT) ===== */
      if (FACTORY_COLUMN_MAPS[factoryName] === "dynamic") {
        const HEADER_KEYWORDS = [
          "CHALLAN",
          "LR",
          "VEHICLE",
          "TRUCK",
          "DISPATCH",
          "SOLD"
        ];

        const headerRowIndex = rows.findIndex(row =>
          row.some(cell =>
            HEADER_KEYWORDS.some(key =>
              String(cell || "").toUpperCase().includes(key)
            )
          )
        );

        if (headerRowIndex === -1) {
          setMessage("❌ Header row not found (ORIENT format)");
          return;
        }

        rows[headerRowIndex].forEach((h, i) => {
          if (h) colMap[String(h).trim().toUpperCase()] = i;
        });

        dataRows = rows.slice(headerRowIndex + 1);
      } else {
        colMap = FACTORY_COLUMN_MAPS[factoryName];
        // Skip header rows for all fixed-mapping factories
        dataRows = rows.slice(1);
      }

      const challanSet = new Set();

      for (const row of dataRows) {
        if (!row || row.every(v => v === null || String(v).trim() === "")) {
          skippedRows++;
          continue;
        }

        const qty = Number(row[colMap.Qty] || 0);
        if (qty <= 0) {
          skippedRows++;
          continue;
        }

        const dispatchDate = parseExcelDate(row[colMap.DispatchDate]);
        if (!dispatchDate) {
          dateMiss++;
          continue;
        }

        const last4 = extractLast4Digits(row[colMap.VehicleNo]);
        const matchedVehicle = vehicles.find(v => v.last4 === last4);
        if (!matchedVehicle) {
          vehicleMiss++;
          continue;
        }

        const challanNo = normalizeChallan(row[colMap.ChallanNo]);
        if (!challanNo) {
          skippedRows++;
          continue;
        }

        if (challanSet.has(challanNo) || await isDuplicate(challanNo, factoryName)) {
          dupMiss++;
          continue;
        }

        challanSet.add(challanNo);

        const dto = {
          DispatchDate: dispatchDate,
          ChallanNo: challanNo,
          VehicleNo: matchedVehicle.VehicleNo,
          VehicleId: matchedVehicle.id,
          PartyName: row[colMap.PartyName] || "",
          Destination: row[colMap.Destination] || "",
          DispatchQuantity: qty,
          Advance: Number(row[colMap.Advance] || 0),
          Diesel: Number(row[colMap.Diesel] || 0),
          FactoryName: factoryName,
          CreatedOn: new Date()
        };

        await addDoc(collection(db, "TblDispatch"), dto);
        uploaded++;
      }

      setMessage(
        `✅ Uploaded: ${uploaded}
⚠️ Vehicle not found: ${vehicleMiss}
⚠️ Invalid date: ${dateMiss}
⚠️ Duplicate challan: ${dupMiss}
⚠️ Skipped rows: ${skippedRows}`
      );

    } catch (err) {
      console.error(err);
      setMessage(`❌ Upload failed: ${err.message}`);
    }
  };

  return (
    <div className="upload-container"> {/* Change from style to className */}
      <h3>Upload Dispatch Excel</h3>
      <pre className="message-display">{message}</pre> {/* Add className */}

      <form onSubmit={handleUpload} className="upload-form"> {/* Add className */}
        <select 
          value={factory} 
          onChange={e => setFactory(e.target.value)} 
          className="factory-select"
          required
        >
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
          className="file-input"
          required
        />

        <br /><br />
        <button type="submit" className="upload-button">Upload</button>
      </form>
    </div>
  );
};

export default UploadDispatch;