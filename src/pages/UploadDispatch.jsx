import React, { useState, useEffect } from "react";
import { db } from "../firebaseConfig";
import { collection, addDoc, query, where, getDocs } from "firebase/firestore";
import * as XLSX from "xlsx";
import "./UploadDispatch.css";

/* ================= CONSTANTS ================= */

const FACTORY_NAME_FIXES = {
  MANIKGARH: "MANIGARH"
};

const FACTORY_COLUMN_MAPS = {
  ORIENT: "dynamic",
  ULTRATECH: {
    DispatchDate: 2,      // PGI Date (3rd column, index 2)
    Qty: 12,              // Quantity (MT) - CHANGED from 11 to 12
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

  // Handle Excel serial numbers
  if (typeof value === "number") {
    const d = XLSX.SSF.parse_date_code(value);
    return d ? new Date(d.y, d.m - 1, d.d) : null;
  }

  if (typeof value === "string") {
    const v = value.trim();
    
    // Try different date formats
    let date = null;
    
    // Format 1: DD.MM.YYYY (with dots) - ULTRATECH format
    if (v.match(/^\d{2}\.\d{2}\.\d{4}$/)) {
      const [day, month, year] = v.split('.').map(Number);
      return new Date(year, month - 1, day);
    }
    // Format 2: DD-MM-YYYY (with dashes)
    else if (v.match(/^\d{2}-\d{2}-\d{4}$/)) {
      const [day, month, year] = v.split('-').map(Number);
      return new Date(year, month - 1, day);
    }
    // Format 3: DD/MM/YYYY (with slashes)
    else if (v.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
      const [day, month, year] = v.split('/').map(Number);
      return new Date(year, month - 1, day);
    }
    // Format 4: YYYY-MM-DD
    else if (v.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const [year, month, day] = v.split('-').map(Number);
      return new Date(year, month - 1, day);
    }
  }
  
  return null;
};

const parseQuantity = (value) => {
  if (value === null || value === undefined) {
    return 0;
  }
  
  // If it's already a number, return it
  if (typeof value === 'number') {
    return value;
  }
  
  // Convert to string and clean
  const str = String(value).trim();
  
  if (str === "") {
    return 0;
  }
  
  // Parse the number
  const num = parseFloat(str);
  
  if (isNaN(num)) {
    return 0;
  }
  
  return num;
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
    let qtyMiss = 0;
    let skippedRows = 0;

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      
      // Read the entire sheet as arrays
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      
      console.log(`=== Processing ${factoryName} file ===`);
      console.log(`Total rows: ${rows.length}`);

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
          Array.isArray(row) && row.some(cell =>
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
        // For ULTRATECH, we need to handle differently
        if (factoryName === "ULTRATECH") {
          // ULTRATECH files have a specific structure:
          // Row 0: Title "09.01.2026 ULTRATECH"
          // Row 1: Headers starting with "PGI Date"
          // Row 2+: Data rows
          
          // Find the header row (should contain "PGI Date")
          const headerRowIndex = rows.findIndex(row => 
            Array.isArray(row) && row.some(cell => 
              String(cell || "").includes("PGI Date")
            )
          );
          
          if (headerRowIndex !== -1) {
            console.log(`Found ULTRATECH header at row ${headerRowIndex}`);
            dataRows = rows.slice(headerRowIndex + 1);
          } else {
            // Fallback: skip first 2 rows
            console.log("Header not found, using fallback (skip 2 rows)");
            dataRows = rows.slice(2);
          }
          
          // Use the predefined column map
          colMap = FACTORY_COLUMN_MAPS[factoryName];
          
          // Log the expected columns for debugging
          console.log("ULTRATECH column mapping:", colMap);
        } else {
          // For other factories
          colMap = FACTORY_COLUMN_MAPS[factoryName];
          dataRows = rows.slice(1);
        }
      }

      console.log(`Processing ${dataRows.length} data rows`);
      
      // Debug: Show first data row
      if (dataRows.length > 0) {
        const firstRow = dataRows[0];
        console.log("First data row - key columns:");
        console.log(`  DispatchDate [${colMap.DispatchDate}]:`, firstRow[colMap.DispatchDate]);
        console.log(`  Qty [${colMap.Qty}]:`, firstRow[colMap.Qty], `type:`, typeof firstRow[colMap.Qty]);
        console.log(`  ChallanNo [${colMap.ChallanNo}]:`, firstRow[colMap.ChallanNo]);
        console.log(`  VehicleNo [${colMap.VehicleNo}]:`, firstRow[colMap.VehicleNo]);
      }

      const challanSet = new Set();

      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        
        // Check if row is empty or not an array
        if (!row || !Array.isArray(row)) {
          skippedRows++;
          continue;
        }
        
        // Check if all values in the row are empty
        const isEmptyRow = row.every(v => 
          v === null || 
          v === undefined || 
          v === "" ||
          (typeof v === 'string' && v.trim() === '')
        );
        
        if (isEmptyRow) {
          skippedRows++;
          continue;
        }

        // Get and validate quantity
        const rawQty = row[colMap.Qty];
        const qty = parseQuantity(rawQty);
        
        if (qty <= 0) {
          console.log(`Row ${i}: Invalid quantity. Raw: "${rawQty}", Parsed: ${qty}`);
          qtyMiss++;
          continue;
        }

        // Get and validate date
        const rawDate = row[colMap.DispatchDate];
        const dispatchDate = parseExcelDate(rawDate);
        
        if (!dispatchDate) {
          console.log(`Row ${i}: Invalid date: "${rawDate}"`);
          dateMiss++;
          continue;
        }

        // Get and validate vehicle
        const rawVehicle = row[colMap.VehicleNo];
        const last4 = extractLast4Digits(rawVehicle);
        
        if (!last4) {
          console.log(`Row ${i}: Could not extract last 4 digits from vehicle: "${rawVehicle}"`);
          vehicleMiss++;
          continue;
        }
        
        const matchedVehicle = vehicles.find(v => v.last4 === last4);
        if (!matchedVehicle) {
          console.log(`Row ${i}: Vehicle not found in master. Last4: ${last4}, Raw: "${rawVehicle}"`);
          vehicleMiss++;
          continue;
        }

        // Get and validate challan
        const rawChallan = row[colMap.ChallanNo];
        const challanNo = normalizeChallan(rawChallan);
        
        if (!challanNo) {
          skippedRows++;
          continue;
        }

        // Check for duplicates
        if (challanSet.has(challanNo)) {
          dupMiss++;
          continue;
        }

        const isDupInDb = await isDuplicate(challanNo, factoryName);
        if (isDupInDb) {
          dupMiss++;
          continue;
        }

        challanSet.add(challanNo);

        // Get other fields
        const partyName = row[colMap.PartyName] ? String(row[colMap.PartyName]).trim() : "";
        const destination = row[colMap.Destination] ? String(row[colMap.Destination]).trim() : "";
        const advance = parseQuantity(row[colMap.Advance]);
        const diesel = parseQuantity(row[colMap.Diesel]);

        const dto = {
          DispatchDate: dispatchDate,
          ChallanNo: challanNo,
          VehicleNo: matchedVehicle.VehicleNo,
          VehicleId: matchedVehicle.id,
          PartyName: partyName,
          Destination: destination,
          DispatchQuantity: qty,
          Advance: advance,
          Diesel: diesel,
          FactoryName: factoryName,
          CreatedOn: new Date()
        };

        console.log(`Row ${i}: Success - Uploading: Challan: ${challanNo}, Vehicle: ${matchedVehicle.VehicleNo}, Qty: ${qty}`);

        await addDoc(collection(db, "TblDispatch"), dto);
        uploaded++;
      }

      setMessage(
        `✅ Uploaded: ${uploaded}
⚠️ Vehicle not found: ${vehicleMiss}
⚠️ Invalid date: ${dateMiss}
⚠️ Invalid quantity: ${qtyMiss}
⚠️ Duplicate challan: ${dupMiss}
⚠️ Skipped rows: ${skippedRows}`
      );

    } catch (err) {
      console.error("Upload error:", err);
      setMessage(`❌ Upload failed: ${err.message}`);
    }
  };

  return (
    <div className="upload-container">
      <h3>Upload Dispatch Excel</h3>
      <pre className="message-display">{message}</pre>

      <form onSubmit={handleUpload} className="upload-form">
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