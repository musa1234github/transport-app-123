import React, { useEffect, useState } from "react";
import { db } from "../firebaseConfig";
import { collection, addDoc, getDocs, query, where } from "firebase/firestore";
import * as XLSX from "xlsx";

/* ---------------- HELPERS ---------------- */

// Clean vehicle: remove everything except letters & numbers, uppercase
const cleanVehicle = (v = "") => v.toString().replace(/[^A-Z0-9]/gi, "").toUpperCase();

// Extract last 4 digits robustly
const extractLast4 = (v = "") => {
  const cleaned = cleanVehicle(v);
  const match = cleaned.match(/(\d{4})$/);
  return match ? match[1] : null;
};

// Robust Excel date parser
const parseExcelDate = (v) => {
  if (!v) return null;

  // Excel numeric date
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return new Date(d.y, d.m - 1, d.d);
    return null;
  }

  // String date
  const str = v.toString().trim();
  let date = new Date(str);
  if (!isNaN(date.getTime())) return date;

  // Try dd-mm-yyyy or dd/mm/yyyy
  const parts = str.split(/[-/]/);
  if (parts.length === 3) {
    const [d, m, y] = parts.map(Number);
    if (!isNaN(d) && !isNaN(m) && !isNaN(y)) return new Date(y, m - 1, d);
  }

  return null; // invalid
};

/* ---------------- FACTORY MAP ---------------- */

const FACTORY_MAP = {
  JSW: {
    VehicleNo: 0,
    Qty: 1,
    PartyName: 3,
    Destination: 4,
    ChallanNo: 6,
    DispatchDate: 7,
    Diesel: 8,
    Advance: 9
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
  }
};

/* ---------------- COMPONENT ---------------- */

const UploadDispatch = () => {
  const [file, setFile] = useState(null);
  const [factory, setFactory] = useState("");
  const [vehicles, setVehicles] = useState([]);
  const [msg, setMsg] = useState("");
  const [failedRows, setFailedRows] = useState([]);

  // Load VehicleMaster once
  useEffect(() => {
    const load = async () => {
      const snap = await getDocs(collection(db, "VehicleMaster"));
      const list = snap.docs.map(d => ({
        id: d.id,
        VehicleNo: d.data().VehicleNo
      }));
      setVehicles(list);
    };
    load();
  }, []);

  // Check for duplicate challan
  const isDuplicate = async (challan, factoryName) => {
    const q = query(
      collection(db, "TblDispatch"),
      where("ChallanNo", "==", challan),
      where("FactoryName", "==", factoryName)
    );
    const snap = await getDocs(q);
    return !snap.empty;
  };

  // Export failed rows to Excel
  const exportFailed = () => {
    if (!failedRows.length) return;
    const ws = XLSX.utils.json_to_sheet(failedRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "FailedRows");
    XLSX.writeFile(wb, "FailedDispatch.xlsx");
  };

  // Handle Upload
  const handleUpload = async (e) => {
    e.preventDefault();
    setMsg("");
    setFailedRows([]);

    if (!file || !factory) {
      setMsg("❌ File & Factory required");
      return;
    }

    const factoryName = factory.toUpperCase().trim();
    const map = FACTORY_MAP[factoryName];
    if (!map) {
      setMsg("❌ Factory mapping not found");
      return;
    }

    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    let uploaded = 0;
    let failed = [];

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.every(v => !v)) continue;

      const rawVehicle = r[map.VehicleNo];
      const last4 = extractLast4(rawVehicle);

      if (!last4) {
        failed.push({ row: i + 1, vehicle: rawVehicle, reason: "Invalid vehicle" });
        continue;
      }

      // ✅ Robust VehicleMaster check
      const exists = vehicles.some(v => extractLast4(v.VehicleNo) === last4);
      if (!exists) {
        failed.push({ row: i + 1, vehicle: rawVehicle, reason: "Vehicle not in master" });
        continue;
      }

      const date = parseExcelDate(r[map.DispatchDate]);
      if (!date) {
        failed.push({ row: i + 1, vehicle: rawVehicle, reason: "Invalid date" });
        continue;
      }

      const challan = r[map.ChallanNo];
      if (!challan) continue;

      if (await isDuplicate(challan, factoryName)) continue;

      await addDoc(collection(db, "TblDispatch"), {
        DispatchDate: date,
        ChallanNo: String(challan),
        VehicleNo: cleanVehicle(rawVehicle),
        DispatchQuantity: Number(r[map.Qty] || 0),
        PartyName: r[map.PartyName],
        Destination: r[map.Destination],
        Advance: Number(r[map.Advance] || 0),
        Diesel: Number(r[map.Diesel] || 0),
        FactoryName: factoryName,
        CreatedOn: new Date()
      });

      uploaded++;
    }

    setFailedRows(failed);
    setMsg(`✅ ${uploaded} uploaded | ❌ ${failed.length} failed`);
  };

  return (
    <div style={{ maxWidth: 700, margin: "auto" }}>
      <h3>Upload Dispatch</h3>

      {msg && <p>{msg}</p>}

      <form onSubmit={handleUpload}>
        <select value={factory} onChange={e => setFactory(e.target.value)} required>
          <option value="">-- Select Factory --</option>
          {Object.keys(FACTORY_MAP).map(f => (
            <option key={f}>{f}</option>
          ))}
        </select>

        <br /><br />

        <input type="file" accept=".xlsx,.xls" onChange={e => setFile(e.target.files[0])} required />
        <br /><br />
        <button type="submit">Upload</button>
      </form>

      {failedRows.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h4>Failed Rows</h4>
          <table border={1} cellPadding={5}>
            <thead>
              <tr>
                <th>Row</th>
                <th>Vehicle</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {failedRows.map((f, idx) => (
                <tr key={idx}>
                  <td>{f.row}</td>
                  <td>{f.vehicle}</td>
                  <td>{f.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={exportFailed} style={{ marginTop: 10 }}>
            Export Failed Rows
          </button>
        </div>
      )}
    </div>
  );
};

export default UploadDispatch;
