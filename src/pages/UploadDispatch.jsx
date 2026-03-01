import React, { useState, useEffect } from "react";
import { db } from "../firebaseConfig";
import { collection, addDoc, query, where, getDocs } from "firebase/firestore";
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
  return String(v).trim().toUpperCase();
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
  MANIGARH: {
    DispatchDate: 5, Qty: 3, ChallanNo: 8, VehicleNo: 6, PartyName: 1, Destination: 2, Advance: 10, Diesel: 9
  },
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
        rows[headerRowIndex].forEach((h, i) => {
          if (h) colMap[String(h).trim().toUpperCase()] = i;
        });
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

      // Process each row
      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        if (!row || !Array.isArray(row)) continue;

        const isEmptyRow = row.every(v =>
          v === null || v === undefined || v === "" || (typeof v === "string" && v.trim() === "")
        );
        if (isEmptyRow) continue;

        const challanNo = normalizeChallan(row[colMap.ChallanNo]);
        if (!challanNo) continue;

        // Skip summary/total rows
        if (factoryName === "ACC MARATHA" || factoryName === "AMBUJA") {
          const partyName = row[colMap.PartyName];
          if (typeof partyName === "string") {
            const upperPartyName = partyName.toUpperCase();
            if (upperPartyName.includes("TOTAL") || upperPartyName.includes("GRAND") ||
              upperPartyName.includes("SUMMARY") || upperPartyName === "") {
              continue;
            }
          }
        }

        // Check if already in database
        if (await isDuplicate(challanNo, factoryName)) {
          alreadyExistInDB.push(challanNo);
          continue;
        }

        // Check quantity - accept 0 for split loads
        const rawQty = row[colMap.Qty];
        const qty = parseQuantity(rawQty);
        if (qty < 0) {
          otherFailures.push({ challanNo, reason: `Invalid quantity: ${rawQty}` });
          continue;
        }

        // Check date
        const rawDate = row[colMap.DispatchDate];
        const dispatchDate = parseExcelDate(rawDate);
        if (!dispatchDate) {
          otherFailures.push({ challanNo, reason: `Invalid date: ${rawDate}` });
          continue;
        }

        // Check vehicle
        const rawVehicle = row[colMap.VehicleNo];
        let matchedVehicle = null;
        let vehicleId = "";
        let vehicleNoToStore = rawVehicle || "";

        // Only check for vehicle if rawVehicle exists
        if (rawVehicle && String(rawVehicle).trim() !== "") {
          const last4 = extractLast4Digits(rawVehicle);
          if (last4) {
            matchedVehicle = vehicles.find(v => v.last4 === last4);
            if (matchedVehicle) {
              vehicleNoToStore = matchedVehicle.VehicleNo;
              vehicleId = matchedVehicle.id;
            } else {
              // Vehicle not found in master
              vehicleNotFound.push({
                challanNo,
                vehicleNo: rawVehicle
              });
            }
          }
        }

        // All checks passed - upload
        const dto = {
          DispatchDate: dispatchDate,
          ChallanNo: challanNo,
          VehicleNo: vehicleNoToStore,
          VehicleId: vehicleId,
          PartyName: row[colMap.PartyName] ? String(row[colMap.PartyName]).trim() : "",
          Destination: row[colMap.Destination] ? String(row[colMap.Destination]).trim() : "",
          DispatchQuantity: qty,
          Advance: parseQuantity(row[colMap.Advance]),
          Diesel: parseQuantity(row[colMap.Diesel]),
          FactoryName: factoryName,
          CreatedOn: new Date()
        };

        // Add additional fields for AMBUJA
        if (factoryName === "AMBUJA") {
          dto.GrNo = row[colMap.GrNo] ? String(row[colMap.GrNo]).trim() : "";
          dto.Bilty = parseQuantity(row[colMap.Bilty]);
          dto.Rate85 = parseQuantity(row[colMap.Rate85]);
          dto.AdbDsl = parseQuantity(row[colMap.AdbDsl]);
          dto.LrSt = row[colMap.LrSt] ? String(row[colMap.LrSt]).trim() : "";
        }

        // Add GrNo for ACC MARATHA if available
        if (factoryName === "ACC MARATHA" && colMap.GrNo !== undefined) {
          dto.GrNo = row[colMap.GrNo] ? String(row[colMap.GrNo]).trim() : "";
        }

        await addDoc(collection(db, "TblDispatch"), dto);
        // ✅ Keep monthly summary in sync (ultra-cheap atomic increment)
        await updateMonthlySummary(dto);
        uploaded++;
      }

      // Display results
      let resultMessage = "";

      // Show successful uploads
      if (uploaded > 0) {
        resultMessage += `✅ New records uploaded: ${uploaded}\n\n`;
      } else {
        resultMessage += `⚠️ No new records uploaded.\n\n`;
      }

      // Show existing records (only if all were duplicates)
      if (alreadyExistInDB.length > 0 && uploaded === 0 && otherFailures.length === 0) {
        resultMessage += `ℹ️ All ${alreadyExistInDB.length} challans already exist in database.\n\n`;
      }

      // Show other failures
      if (otherFailures.length > 0) {
        resultMessage += `❌ Failed to upload (${otherFailures.length} challans):\n`;
        resultMessage += "════════════════════════════════════════\n";
        otherFailures.forEach(failure => {
          resultMessage += `  • Challan ${failure.challanNo}: ${failure.reason}\n`;
        });
        resultMessage += "\n";
      }

      // Show vehicle not found warnings
      if (vehicleNotFound.length > 0) {
        resultMessage += `⚠️  Vehicle not found in master (${vehicleNotFound.length} records uploaded without vehicle link):\n`;
        resultMessage += "════════════════════════════════════════\n";
        vehicleNotFound.forEach(item => {
          resultMessage += `  • Challan ${item.challanNo}: Vehicle "${item.vehicleNo}" not found\n`;
        });
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

      {isUploading && (
        <div className="upload-status">
          ⏳ Processing file... Please wait.
        </div>
      )}

      <pre className="message-display">{message}</pre>

      <form onSubmit={handleUpload} className="upload-form">
        <div className="form-group">
          <label>🏭 Select Factory:</label>
          <select
            value={factory}
            onChange={e => setFactory(e.target.value)}
            required
            disabled={isUploading}
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
        </div>

        <div className="form-group">
          <label>📁 Choose Excel File:</label>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={e => setFile(e.target.files[0])}
            required
            disabled={isUploading}
          />
        </div>

        <button
          type="submit"
          disabled={isUploading}
          className="upload-button"
        >
          {isUploading ? '⏳ Uploading...' : '📤 Upload'}
        </button>
      </form>
    </div>
  );
};

export default UploadDispatch;