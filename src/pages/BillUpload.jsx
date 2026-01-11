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

/* ===== SAFE NUMBER ===== */
const safeNum = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "string") v = v.replace(/,/g, "");
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
};

/* ===== PARSE dd-mm-yy FORMAT (UPDATED TO HANDLE 4-DIGIT YEARS) ===== */
const parseDDMMYY = (v) => {
  if (!v) return null;
  
  // If it's already a Date object or Excel serial number
  if (v instanceof Date) return v;
  if (typeof v === "number") {
    // Excel serial number (days since 1900-01-00)
    return new Date(Math.round((v - 25569) * 86400 * 1000));
  }
  
  const str = String(v).trim();
  
  // Try parsing dd-mm-yyyy or dd-mm-yy format (e.g., "09-01-2026" or "09-01-26")
  const match = str.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})$/);
  if (match) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1; // JavaScript months are 0-11
    let year = parseInt(match[3], 10);
    
    // If year is 2 digits, convert to 4 digits
    if (year < 100) {
      // Assuming years 00-50 are 2000-2050, 51-99 are 1951-1999
      year = year >= 0 && year <= 50 ? year + 2000 : year + 1900;
    }
    
    const date = new Date(year, month, day);
    // Check if date is valid
    if (!isNaN(date.getTime()) && 
        date.getDate() === day && 
        date.getMonth() === month) {
      return date;
    }
  }
  
  // Try parsing other common formats
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }
  
  console.warn(`Could not parse date: ${v}`);
  return null;
};

const BillUpload = ({ isAdmin }) => {
  const [file, setFile] = useState(null);
  const [factory, setFactory] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadLog, setUploadLog] = useState([]);

  if (!isAdmin) {
    return <h3 style={{ color: "red" }}>Access Denied</h3>;
  }

  const addLog = (message, type = "info") => {
    const timestamp = new Date().toLocaleTimeString();
    setUploadLog(prev => [...prev, { timestamp, message, type }].slice(-20)); // Keep last 20 logs
  };

  const handleUpload = async () => {
    if (!file || !factory) {
      alert("Select Factory and Excel file");
      return;
    }

    setLoading(true);
    setUploadLog([]);
    addLog(`Starting upload for ${factory} factory...`, "info");

    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

        let success = 0;
        let skipped = 0;
        let failed = 0;

        addLog(`Found ${rows.length - 1} rows in Excel file`, "info");

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.every(v => v === null || v === "")) continue;

          /* ===== EXACT & CORRECT COLUMN MAPPING ===== */
          const challanNo = String(row[0] || "").trim();
          const quantity = safeNum(row[4]);
          const unitPrice = safeNum(row[6]);
          const finalPrice = safeNum(row[7]); // DEDUCTION VALUE
          const billNum = String(row[8] || "").trim();
          const billDate = parseDDMMYY(row[9]); // Using dd-mm-yy parser (now supports 4-digit years)
          const billType = String(row[10] || "").trim();
          const deliveryNum = String(row[11] || "").trim();

          // Log current row processing
          addLog(`Processing row ${i}: Bill ${billNum}, Date: ${billDate ? billDate.toLocaleDateString() : 'Invalid'}`);

          // Validate required fields
          if (!challanNo) {
            addLog(`Row ${i} skipped: Missing Challan No`, "warning");
            skipped++;
            continue;
          }

          if (!billNum) {
            addLog(`Row ${i} skipped: Missing Bill Number`, "warning");
            skipped++;
            continue;
          }

          if (quantity === 0) {
            addLog(`Row ${i} skipped: Quantity is 0`, "warning");
            skipped++;
            continue;
          }

          if (unitPrice === 0) {
            addLog(`Row ${i} skipped: Unit Price is 0`, "warning");
            skipped++;
            continue;
          }

          if (!billDate) {
            addLog(`Row ${i} skipped: Invalid Bill Date (${row[9]})`, "warning");
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
            addLog(`Row ${i} skipped: Dispatch not found for Challan ${challanNo}`, "warning");
            skipped++;
            continue;
          }

          const dispatchDoc = ds.docs[0];
          const dispatchData = dispatchDoc.data();

          // Check if already has BillID
          if (dispatchData.BillID) {
            addLog(`Row ${i} skipped: Challan ${challanNo} already linked to Bill ${dispatchData.BillNum || dispatchData.BillID}`, "warning");
            skipped++;
            continue;
          }

          /* ===== FIND OR CREATE BILL ===== */
          let billId = null;
          let billExists = false;

          const bq = query(
            collection(db, "BillTable"),
            where("BillNum", "==", billNum),
            where("FactoryName", "==", factory)
          );

          const bs = await getDocs(bq);

          if (!bs.empty) {
            billId = bs.docs[0].id;
            billExists = true;
            addLog(`Row ${i}: Bill ${billNum} already exists, using existing bill`, "info");
          } else {
            const billRef = await addDoc(collection(db, "BillTable"), {
              BillNum: billNum,
              BillDate: billDate,
              BillType: billType,
              FactoryName: factory,
              CreatedOn: serverTimestamp()
            });
            billId = billRef.id;
            addLog(`Row ${i}: Created new Bill ${billNum}`, "success");
          }

          /* ===== UPDATE DISPATCH ===== */
          try {
            await updateDoc(doc(db, "TblDispatch", dispatchDoc.id), {
              DispatchQuantity: quantity,
              UnitPrice: unitPrice,
              FinalPrice: finalPrice,
              DeliveryNum: deliveryNum,
              BillID: billId,
              BillNum: billNum,
              UpdatedAt: serverTimestamp()
            });

            success++;
            addLog(`Row ${i}: Updated Dispatch ${challanNo} with Bill ${billNum}`, "success");
          } catch (error) {
            failed++;
            addLog(`Row ${i}: Failed to update Dispatch ${challanNo}: ${error.message}`, "error");
          }
        }

        setLoading(false);
        const summary = `Upload completed:\nSuccess: ${success}\nSkipped: ${skipped}\nFailed: ${failed}`;
        addLog(summary, "info");
        alert(summary);
      } catch (error) {
        setLoading(false);
        addLog(`Upload failed: ${error.message}`, "error");
        alert(`Upload failed: ${error.message}`);
      }
    };

    reader.onerror = () => {
      setLoading(false);
      addLog("Error reading file", "error");
      alert("Error reading file");
    };

    reader.readAsBinaryString(file);
  };

  const downloadTemplate = () => {
    // Create sample data for template
    const sampleData = [
      ["ChallanNo", "col2", "col3", "col4", "Quantity", "col6", "UnitPrice", "FinalPrice", "BillNum", "BillDate", "BillType", "DeliveryNum"],
      ["CH-001", "", "", "", 100, "", 50, 4800, "BILL-001", "09-01-26", "Regular", "DEL-001"],
      ["CH-002", "", "", "", 200, "", 75, 14700, "BILL-002", "10-01-26", "Regular", "DEL-002"],
      ["CH-003", "", "", "", 150, "", 60, 8820, "BILL-003", "11-01-26", "Regular", "DEL-003"]
    ];

    const ws = XLSX.utils.aoa_to_sheet(sampleData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    
    // Create download link
    XLSX.writeFile(wb, `Bill_Upload_Template_${factory || 'Generic'}.xlsx`);
    addLog("Template downloaded", "info");
  };

  return (
    <div style={{ maxWidth: 800, margin: "30px auto", padding: "0 20px" }}>
      <h3>Upload Bill</h3>
      
      <div style={{ 
        backgroundColor: "#f8f9fa", 
        padding: "15px", 
        borderRadius: "5px", 
        marginBottom: "20px",
        border: "1px solid #dee2e6"
      }}>
        <h4>Instructions:</h4>
        <ul style={{ margin: "10px 0", paddingLeft: "20px" }}>
          <li>Excel file must have columns in this order: ChallanNo, col2, col3, col4, Quantity, col6, UnitPrice, FinalPrice, BillNum, BillDate, BillType, DeliveryNum</li>
          <li>BillDate must be in <strong>dd-mm-yy</strong> or <strong>dd-mm-yyyy</strong> format (e.g., 09-01-26 or 09-01-2026 for 9th January 2026)</li>
          <li>Columns marked "col" can be left empty or contain any data</li>
          <li>Download template for reference</li>
        </ul>
      </div>

      <div style={{ marginBottom: "15px" }}>
        <label style={{ display: "block", marginBottom: "5px", fontWeight: "bold" }}>
          Select Factory:
        </label>
        <select 
          value={factory} 
          onChange={e => setFactory(e.target.value)}
          style={{ 
            width: "100%", 
            padding: "10px", 
            borderRadius: "4px", 
            border: "1px solid #ced4da",
            fontSize: "16px"
          }}
        >
          <option value="">-- Select Factory --</option>
          {FACTORIES.map(f => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: "15px" }}>
        <label style={{ display: "block", marginBottom: "5px", fontWeight: "bold" }}>
          Select Excel File:
        </label>
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={e => {
            setFile(e.target.files[0]);
            if (e.target.files[0]) {
              addLog(`Selected file: ${e.target.files[0].name}`, "info");
            }
          }}
          style={{ 
            width: "100%", 
            padding: "10px", 
            borderRadius: "4px", 
            border: "1px solid #ced4da"
          }}
        />
      </div>

      <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
        <button 
          onClick={handleUpload} 
          disabled={loading || !file || !factory}
          style={{
            padding: "10px 20px",
            backgroundColor: loading || !file || !factory ? "#cccccc" : "#28a745",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: loading || !file || !factory ? "not-allowed" : "pointer",
            fontSize: "16px",
            flex: 1
          }}
        >
          {loading ? "Uploading..." : "Upload Bill"}
        </button>
        
        <button 
          onClick={downloadTemplate}
          style={{
            padding: "10px 20px",
            backgroundColor: "#6c757d",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "16px",
            flex: 1
          }}
        >
          Download Template
        </button>
      </div>

      {/* Upload Log */}
      {uploadLog.length > 0 && (
        <div style={{ 
          marginTop: "30px", 
          border: "1px solid #dee2e6", 
          borderRadius: "5px",
          overflow: "hidden"
        }}>
          <div style={{ 
            backgroundColor: "#343a40", 
            color: "white", 
            padding: "10px 15px",
            fontWeight: "bold"
          }}>
            Upload Log
          </div>
          <div style={{ 
            maxHeight: "300px", 
            overflowY: "auto", 
            backgroundColor: "#f8f9fa"
          }}>
            {uploadLog.map((log, index) => (
              <div 
                key={index} 
                style={{
                  padding: "8px 15px",
                  borderBottom: "1px solid #dee2e6",
                  fontFamily: "monospace",
                  fontSize: "12px",
                  color: log.type === "error" ? "#dc3545" : 
                         log.type === "warning" ? "#ffc107" : 
                         log.type === "success" ? "#28a745" : "#6c757d"
                }}
              >
                <span style={{ color: "#6c757d", marginRight: "10px" }}>
                  [{log.timestamp}]
                </span>
                {log.message}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default BillUpload;