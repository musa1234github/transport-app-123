import React, { useState, useEffect } from "react";
import { db } from "../firebaseConfig";
import { collection, doc, getDocs, setDoc, writeBatch, Timestamp } from "firebase/firestore";
import * as XLSX from "xlsx";
import "./UploadDispatch.css";
import { updateMonthlySummary } from "../utils/dispatchSummaryHelper";

/* ================= HELPER FUNCTIONS ================= */

const parseExcelDate = (value) => {
  if (!value) return null;
  if (typeof value === "number") {
    const d = XLSX.SSF.parse_date_code(value);
    return d ? new Date(d.y, d.m - 1, d.d) : null;
  }
  if (typeof value === "string") {
    const v = value.trim();
    if (v.match(/^\d{2}\.\d{2}\.\d{4}$/)) {
      const [day, month, year] = v.split('.').map(Number);
      return new Date(year, month - 1, day);
    }
    else if (v.match(/^\d{2}-\d{2}-\d{4}$/)) {
      const [day, month, year] = v.split('-').map(Number);
      return new Date(year, month - 1, day);
    }
    else if (v.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
      const [day, month, year] = v.split('/').map(Number);
      return new Date(year, month - 1, day);
    }
    else if (v.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const [year, month, day] = v.split('-').map(Number);
      return new Date(year, month - 1, day);
    }
  }
  return null;
};

const parseQuantity = (value) => {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  let str = String(value).trim();
  if (str === "") return 0;
  str = str.replace(/MT|TONS?/gi, "").replace(/,/g, "").trim();
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
};

const normalizeVehicle = (v = "") =>
  v.toString().replace(/[^A-Z0-9]/gi, "").toUpperCase();

const extractLast4Digits = (v = "") => {
  const m = normalizeVehicle(v).match(/(\d{4})$/);
  return m ? m[1] : null;
};

const normalizeChallan = (v) => {
  if (v === null || v === undefined) return "";
  // Removes leading zeros and trims
  return String(v).trim().replace(/^0+/, "").toUpperCase();
};

/* ================= CONSTANTS ================= */

const FACTORY_NAME_FIXES = {
  MANIKGARH: "MANIGARH"
};

const FACTORY_COLUMN_MAPS = {
  ORIENT: "dynamic",
  ULTRATECH: {
    DispatchDate: 2, Qty: 12, ChallanNo: 1, VehicleNo: 20, PartyName: 7, Destination: 10, Advance: 22, Diesel: 21
  },
  // SET TO DYNAMIC: Handles your 24.03.2026 MANIKGARH file perfectly regardless of column sequence
  MANIGARH: "dynamic",
  ACC: {
    DispatchDate: 0, Qty: 5, ChallanNo: 2, VehicleNo: 3, PartyName: 4, Destination: 6, Advance: 7, Diesel: 8
  },
  "ACC MARATHA": {
    DispatchDate: 0, Qty: 5, ChallanNo: 2, VehicleNo: 3, PartyName: 4, Destination: 6, Advance: 7, Diesel: 8,
    headerRowIndex: 1  // ADDED: header is at row index 1 (2nd row)
  },
  AMBUJA: {
    DispatchDate: 0, GrNo: 1, ChallanNo: 2, VehicleNo: 3, PartyName: 4, Qty: 5, Destination: 6, Advance: 7, Diesel: 8,
    Bilty: 9, Rate85: 10, AdbDsl: 11, LrSt: 12, headerRowIndex: 0
  },
  DALMIA: {
    DispatchDate: 0, Qty: 5, ChallanNo: 2, VehicleNo: 3, PartyName: 4, Destination: 6, Advance: 7, Diesel: 8
  },
  "MP BIRLA": {
    DispatchDate: 0, Qty: 5, ChallanNo: 2, VehicleNo: 3, PartyName: 4, Destination: 6, Advance: 7, Diesel: 8
  },
  JSW: {
    VehicleNo: 0, Qty: 1, PartyName: 3, Destination: 4, ChallanNo: 6, DispatchDate: 7, Diesel: 8, Advance: 9
  }
};

/* ================= COMPONENT ================= */

const UploadDispatch = () => {
  const [factory, setFactory] = useState("");
  const [file, setFile] = useState(null);
  const [message, setMessage] = useState("");
  const [vehicles, setVehicles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);

  /* ================= LOAD VEHICLES WITH CACHE ================= */
  useEffect(() => {
    const loadVehicles = async () => {
      try {
        const CACHE_KEY = 'vehicleMasterCache';
        const CACHE_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours
        
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          const { list, timestamp } = JSON.parse(cached);
          if (Date.now() - timestamp < CACHE_EXPIRY) {
            setVehicles(list);
            return;
          }
        }

        const snap = await getDocs(query(collection(db, "VehicleMaster"), limit(1000)));
        const list = snap.docs.map(d => ({
          id: d.id,
          VehicleNo: d.data().VehicleNo,
          last4: extractLast4Digits(d.data().VehicleNo)
        }));
        
        setVehicles(list);
        localStorage.setItem(CACHE_KEY, JSON.stringify({ list, timestamp: Date.now() }));
      } catch (err) {
        console.error("Vehicle load error:", err);
      }
    };
    loadVehicles();
  }, []);

  const handleUpload = async (e) => {
    e.preventDefault();
    setMessage("");
    setIsUploading(true);

    if (!file || !factory) {
      setMessage("❌ File and Factory required");
      setIsUploading(false);
      return;
    }

    let factoryName = FACTORY_NAME_FIXES[factory] || factory;
    factoryName = factoryName.toUpperCase().trim();

    let uploaded = 0;
    let alreadyExistInDB = [];
    let otherFailures = [];
    let vehicleNotFound = [];

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      let colMap = {};
      let dataRows = [];

      if (FACTORY_COLUMN_MAPS[factoryName] === "dynamic") {
        const HEADER_KEYWORDS = ["CHALLAN", "LR", "VEHICLE", "TRUCK", "DISPATCH", "SOLD"];
        const headerRowIndex = rows.findIndex(row =>
          Array.isArray(row) && row.some(cell =>
            HEADER_KEYWORDS.some(key => String(cell || "").toUpperCase().includes(key))
          )
        );
        if (headerRowIndex === -1) {
          setMessage("❌ Header row not found");
          setIsUploading(false);
          return;
        }
        console.log("✅ HEADER ROW DETECTED:", rows[headerRowIndex]);

        rows[headerRowIndex].forEach((h, i) => {
          if (!h) return;
          const name = String(h).toUpperCase().replace(/[^A-Z]/g, ""); // 🔥 removes dots, spaces, brackets

          // ✅ Challan No (supports aliases like LR, Delivery, DC, Doc)
          if (
            name.includes("CHALLAN") || 
            name.includes("LR") || 
            name.includes("DELIVERY") || 
            name.includes("DCNO") || 
            name.includes("DOCNO") ||
            name.includes("DELVNO")
          ) {
            colMap.ChallanNo = i;
          }
          
          // ✅ Invoice No
          if (name.includes("INVOICE") || name.includes("EXINV") || name.includes("INV")) {
            colMap.InvoiceNo = i;
          }

          // ✅ Vehicle No
          if (name.includes("VEHICLE") || name.includes("TRUCK") || name.includes("LORRY")) {
            colMap.VehicleNo = i;
          }

          // ✅ Dispatch Date - Strict Priority
          if (name === "DISPATCHDATE" || name === "DISPATCHDT" || name === "DESPATCHDATE" || name === "EXDATE" || name === "EXDT" ||
             ((name.includes("DISPATCH") || name.includes("DESPATCH") || name.includes("DISP") || name.includes("EX")) && (name.includes("DATE") || name.includes("DT")))) {
            colMap.DispatchDate = i;
          }
          else if (!colMap.DispatchDate && (name === "DATE" || name === "DT")) {
            colMap.DispatchDate = i;
          }

          // ✅ Qty
          if (name.includes("QTY") || name.includes("QUANTITY") || name === "WT" || name.includes("MT")) {
            colMap.Qty = i;
          }

          // ✅ Party
          if (name.includes("PARTY") || name.includes("SOLD") || name.includes("CONSIGNEE")) {
            colMap.PartyName = i;
          }

          // ✅ Others
          if (name.includes("DEST") || name.includes("ROUTE")) colMap.Destination = i;
          if (name.includes("ADVANCE") || name.includes("ADV")) colMap.Advance = i;
          if (name.includes("DIESEL") || name.includes("DSL") || name.includes("HSD")) {
            colMap.Diesel = i;
          }
        });
        
        console.log("🧠 Final Column Mapping Detected:", colMap);
        
        // 🛡️ SAFETY CHECK: Ensure minimum required columns are mapped
        if (colMap.ChallanNo === undefined || colMap.DispatchDate === undefined || colMap.Qty === undefined) {
          console.error("❌ Column mapping failed:", colMap);
          setMessage("❌ Column mapping failed! Please ensure the Excel has 'Challan', 'Date', and 'Qty' headers.");
          setIsUploading(false);
          return;
        }

        dataRows = rows.slice(headerRowIndex + 1);
      } else {
        colMap = { ...FACTORY_COLUMN_MAPS[factoryName] };

        // Check if factory has headerRowIndex property
        if (colMap.headerRowIndex !== undefined) {
          const startRow = colMap.headerRowIndex + 1;
          dataRows = rows.slice(startRow);
          delete colMap.headerRowIndex;
        } else {
          dataRows = rows.slice(1); // Default: skip first row
        }
      }

      const processedThisUpload = new Set();
      const uniqueChallansForDB = new Set();
      const rowsToProcess = [];

      // 1. First pass: Collect unique challans and validate basic row data
      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        if (!row || !Array.isArray(row)) continue;
        const isEmptyRow = row.every(v => v === null || v === "" || (typeof v === "string" && v.trim() === ""));
        if (isEmptyRow) continue;

        const challanNo = normalizeChallan(row[colMap.ChallanNo]);
        if (!challanNo) continue;
        
        // Skip file-level duplicates
        if (processedThisUpload.has(challanNo)) continue;
        processedThisUpload.add(challanNo);
        
        uniqueChallansForDB.add(challanNo);
        rowsToProcess.push({ challanNo, row });
      }

      // 2. Targeted Prefetch: check which challans already exist in DB
      const existingInDB = new Set();
      const challanArr = Array.from(uniqueChallansForDB);
      for (let i = 0; i < challanArr.length; i += 30) {
        const chunk = challanArr.slice(i, i + 30);
        const q = query(
          collection(db, "TblDispatch"),
          where("FactoryName", "==", factoryName),
          where("ChallanNo", "in", chunk)
        );
        const snap = await getDocs(q);
        snap.forEach(d => existingInDB.add(d.data().ChallanNo));
      }

      const validDtos = [];   // { docId, dto }

      for (const { challanNo, row } of rowsToProcess) {
        // Skip DB-level duplicates to save writes and provide clean feedback
        if (existingInDB.has(challanNo)) {
          alreadyExistInDB.push(challanNo);
          continue;
        }

        const rawQty = row[colMap.Qty];
        const qty = parseQuantity(rawQty);
        if (qty < 0) {
          otherFailures.push({ challanNo, reason: `Invalid quantity: ${rawQty}` });
          continue;
        }

        const rawDate = row[colMap.DispatchDate];
        const dispatchDate = parseExcelDate(rawDate);
        if (!dispatchDate) {
          otherFailures.push({ challanNo, reason: `Invalid date: ${rawDate}` });
          continue;
        }

        const rawVehicle = row[colMap.VehicleNo];
        let matchedVehicle = null;
        let vehicleId = "";
        let vehicleNoToStore = rawVehicle || "";

        if (rawVehicle && String(rawVehicle).trim() !== "") {
          const last4 = extractLast4Digits(rawVehicle);
          if (last4) {
            matchedVehicle = vehicles.find(v => v.last4 === last4);
            if (matchedVehicle) {
              vehicleNoToStore = matchedVehicle.VehicleNo;
              vehicleId = matchedVehicle.id;
            } else {
              vehicleNotFound.push({ challanNo, vehicleNo: rawVehicle });
            }
          }
        }

        // Build DTO
        const dto = {
          DispatchDate: Timestamp.fromDate(dispatchDate),
          ChallanNo: challanNo,
          VehicleNo: vehicleNoToStore,
          VehicleId: vehicleId,
          PartyName: row[colMap.PartyName] ? String(row[colMap.PartyName]).trim() : "",
          Destination: row[colMap.Destination] ? String(row[colMap.Destination]).trim() : "",
          DispatchQuantity: qty,
          Advance: parseQuantity(row[colMap.Advance]),
          Diesel: parseQuantity(row[colMap.Diesel]),
          FactoryName: factoryName,
          CreatedOn: Timestamp.now()
        };

        // ✅ InvoiceNo (Only for MANIGARH as requested)
        if (factoryName === "MANIGARH" && colMap.InvoiceNo !== undefined) {
          dto.InvoiceNo = row[colMap.InvoiceNo] ? String(row[colMap.InvoiceNo]).trim() : "";
        }

        if (factoryName === "AMBUJA") {
          dto.GrNo = row[colMap.GrNo] ? String(row[colMap.GrNo]).trim() : "";
          dto.Bilty = parseQuantity(row[colMap.Bilty]);
          dto.Rate85 = parseQuantity(row[colMap.Rate85]);
          dto.AdbDsl = parseQuantity(row[colMap.AdbDsl]);
          dto.LrSt = row[colMap.LrSt] ? String(row[colMap.LrSt]).trim() : "";
        }

        if (factoryName === "ACC MARATHA" && colMap.GrNo !== undefined) {
          dto.GrNo = row[colMap.GrNo] ? String(row[colMap.GrNo]).trim() : "";
        }

        const safeFactory = factoryName.replace(/[^A-Z0-9]/gi, "_");
        const safeChallan = challanNo.replace(/[^A-Z0-9]/gi, "_");
        const docId = `${safeFactory}_${safeChallan}`;

        validDtos.push({ docId, dto });
        processedThisUpload.add(challanNo);
      }

      const BATCH_LIMIT = 499;
      for (let start = 0; start < validDtos.length; start += BATCH_LIMIT) {
        const chunk = validDtos.slice(start, start + BATCH_LIMIT);
        const batch = writeBatch(db);
        chunk.forEach(({ docId, dto }) => {
          // Use merge: true to avoid overwriting partial data if needed, 
          // although here we are creating/overwriting full records.
          batch.set(doc(collection(db, "TblDispatch"), docId), dto, { merge: true });
        });
        await batch.commit();
      }

      await Promise.all(validDtos.map(({ dto }) => updateMonthlySummary(dto)));

      uploaded = validDtos.length;
      let resultMessage = "";

      if (uploaded > 0) {
        resultMessage += `✅ New records uploaded: ${uploaded}\n\n`;
      } else {
        resultMessage += `⚠️ No new records uploaded.\n\n`;
      }

      if (alreadyExistInDB.length > 0 && uploaded === 0 && otherFailures.length === 0) {
        resultMessage += `ℹ️ ${alreadyExistInDB.length} duplicate challan(s) skipped.\n\n`;
      }

      if (otherFailures.length > 0) {
        resultMessage += `❌ Failed to upload (${otherFailures.length} challans):\n`;
        otherFailures.forEach(failure => {
          resultMessage += `  • Challan ${failure.challanNo}: ${failure.reason}\n`;
        });
        resultMessage += "\n";
      }

      if (vehicleNotFound.length > 0) {
        resultMessage += `⚠️ Vehicle not found in master (${vehicleNotFound.length} records).\n`;
      }

      setMessage(resultMessage);

    } catch (err) {
      console.error("Upload error:", err);
      setMessage(`❌ Upload failed: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="upload-container">
      <h3>📤 Upload Dispatch Excel</h3>
      {isUploading && <div className="upload-status">⏳ Processing file...</div>}
      <pre className="message-display">{message}</pre>
      <form onSubmit={handleUpload} className="upload-form">
        <div className="form-group">
          <label>🏭 Select Factory:</label>
          <select value={factory} onChange={e => setFactory(e.target.value)} required disabled={isUploading}>
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
        </div>
        <div className="form-group">
          <label>📁 Choose Excel File:</label>
          <input type="file" accept=".xlsx,.xls" onChange={e => setFile(e.target.files[0])} required disabled={isUploading} />
        </div>
        <button type="submit" disabled={isUploading} className="upload-button">
          {isUploading ? '⏳ Uploading...' : '📤 Upload'}
        </button>
      </form>
    </div>
  );
};

export default UploadDispatch;