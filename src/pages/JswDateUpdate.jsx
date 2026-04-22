import React, { useState } from "react";
import { db } from "../firebaseConfig";
import {
  collection,
  doc,
  getDocs,
  writeBatch,
  Timestamp,
  query,
  where,
} from "firebase/firestore";
import * as XLSX from "xlsx";

/* ── Reused helpers (same as UploadDispatch) ── */
const parseExcelDate = (value) => {
  if (!value) return null;
  if (typeof value === "number") {
    const d = XLSX.SSF.parse_date_code(value);
    return d ? new Date(d.y, d.m - 1, d.d) : null;
  }
  if (typeof value === "string") {
    const v = value.trim();
    if (v.match(/^\d{2}\.\d{2}\.\d{4}$/)) {
      const [day, month, year] = v.split(".").map(Number);
      return new Date(year, month - 1, day);
    } else if (v.match(/^\d{2}-\d{2}-\d{4}$/)) {
      const [day, month, year] = v.split("-").map(Number);
      return new Date(year, month - 1, day);
    } else if (v.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
      const [day, month, year] = v.split("/").map(Number);
      return new Date(year, month - 1, day);
    } else if (v.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const [year, month, day] = v.split("-").map(Number);
      return new Date(year, month - 1, day);
    }
  }
  return null;
};

const normalizeChallan = (v) => {
  if (v === null || v === undefined) return "";
  return String(v).trim().replace(/^0+/, "").toUpperCase();
};

/* ─────────────────────────────────────────────────────────────
   Component — JSW only, no factory dropdown needed
───────────────────────────────────────────────────────────── */
const FACTORY_NAME = "JSW";

const JswDateUpdate = () => {
  const [file, setFile] = useState(null);
  const [message, setMessage] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);

  const handleUpdate = async (e) => {
    e.preventDefault();
    setMessage("");
    setIsUpdating(true);

    if (!file) {
      setMessage("❌ Please choose an Excel file.");
      setIsUpdating(false);
      return;
    }

    let updated = 0;
    let notFound = [];
    let invalidDate = [];
    let totalParsed = 0;

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      /* ── Auto-detect header row ─────────────────────────────── */
      const HEADER_KEYWORDS = ["CHALLAN", "DATE", "LR", "DELIVERY", "DC", "DISPATCH"];
      const headerRowIndex = rows.findIndex(
        (row) =>
          Array.isArray(row) &&
          row.some((cell) =>
            HEADER_KEYWORDS.some((k) =>
              String(cell || "").toUpperCase().includes(k)
            )
          )
      );

      if (headerRowIndex === -1) {
        setMessage(
          "❌ Could not find header row. Make sure the Excel has 'Challan' and 'Date' column headers."
        );
        setIsUpdating(false);
        return;
      }

      /* ── Map column indices ──────────────────────────────────── */
      let challanCol;
      let dateCol;

      rows[headerRowIndex].forEach((h, i) => {
        if (!h) return;
        const name = String(h).toUpperCase().replace(/[^A-Z]/g, "");
        if (
          name.includes("CHALLAN") ||
          name.includes("LR") ||
          name.includes("DELIVERY") ||
          name.includes("DCNO") ||
          name.includes("DELVNO")
        ) {
          challanCol = i;
        }
        if (
          name === "DISPATCHDATE" ||
          name === "DISPATCHDT" ||
          name === "DESPATCHDATE" ||
          name === "EXDATE" ||
          name === "EXDT" ||
          ((name.includes("DISPATCH") || name.includes("DESPATCH") || name.includes("EX")) &&
            (name.includes("DATE") || name.includes("DT")))
        ) {
          dateCol = i;
        } else if (dateCol === undefined && (name === "DATE" || name === "DT")) {
          dateCol = i;
        }
      });

      if (challanCol === undefined || dateCol === undefined) {
        setMessage(
          `❌ Could not locate required columns.\n` +
          `  Challan column: ${challanCol !== undefined ? "✅ found" : "❌ not found"}\n` +
          `  Date column   : ${dateCol !== undefined ? "✅ found" : "❌ not found"}\n\n` +
          `Expected headers like: "Challan No" / "LR No" / "DC No"  and  "Date" / "Dispatch Date"`
        );
        setIsUpdating(false);
        return;
      }

      /* ── Collect rows ───────────────────────────────────────── */
      const dataRows = rows.slice(headerRowIndex + 1);
      const seen = new Set();
      const toProcess = []; // { challanNo, newDate }

      for (const row of dataRows) {
        if (!row || !Array.isArray(row)) continue;
        const isEmpty = row.every(
          (v) => v === null || v === "" || (typeof v === "string" && v.trim() === "")
        );
        if (isEmpty) continue;

        const challanNo = normalizeChallan(row[challanCol]);
        if (!challanNo || seen.has(challanNo)) continue;
        seen.add(challanNo);
        totalParsed++;

        const newDate = parseExcelDate(row[dateCol]);
        if (!newDate) {
          invalidDate.push({ challanNo, raw: String(row[dateCol] ?? "") });
          continue;
        }

        toProcess.push({ challanNo, newDate });
      }

      if (toProcess.length === 0) {
        setMessage(
          `⚠️ No valid rows to process.\n` +
          `Total parsed: ${totalParsed}  |  Invalid dates: ${invalidDate.length}`
        );
        setIsUpdating(false);
        return;
      }

      /* ── Fetch matching doc IDs from Firestore ──────────────── */
      const challanArr = toProcess.map((r) => r.challanNo);
      const docIdMap = new Map(); // challanNo → docId

      for (let i = 0; i < challanArr.length; i += 30) {
        const chunk = challanArr.slice(i, i + 30);
        const q = query(
          collection(db, "TblDispatch"),
          where("FactoryName", "==", FACTORY_NAME),
          where("ChallanNo", "in", chunk)
        );
        const snap = await getDocs(q);
        snap.forEach((d) => {
          docIdMap.set(d.data().ChallanNo, d.id);
        });
      }

      /* ── Batch update only DispatchDate ─────────────────────── */
      const updateItems = [];
      for (const { challanNo, newDate } of toProcess) {
        const docId = docIdMap.get(challanNo);
        if (!docId) {
          notFound.push(challanNo);
          continue;
        }
        updateItems.push({ docId, newDate });
      }

      const BATCH_LIMIT = 499;
      for (let start = 0; start < updateItems.length; start += BATCH_LIMIT) {
        const chunk = updateItems.slice(start, start + BATCH_LIMIT);
        const batch = writeBatch(db);
        chunk.forEach(({ docId, newDate }) => {
          batch.update(doc(db, "TblDispatch", docId), {
            DispatchDate: Timestamp.fromDate(newDate),
          });
        });
        await batch.commit();
        updated += chunk.length;
      }

      /* ── Build result message ───────────────────────────────── */
      let msg = "";
      msg += `📊 Total records in file  : ${totalParsed}\n`;
      msg += `✅ Dispatch dates updated : ${updated}\n`;

      if (notFound.length > 0) {
        msg += `\nℹ️ Challan not found in JSW records (${notFound.length} skipped):\n`;
        msg += "-".repeat(48) + "\n";
        notFound.slice(0, 30).forEach((c) => {
          msg += `  • ${c}\n`;
        });
        if (notFound.length > 30) msg += `  … and ${notFound.length - 30} more\n`;
      }

      if (invalidDate.length > 0) {
        msg += `\n❌ Invalid / missing date (${invalidDate.length} skipped):\n`;
        invalidDate.forEach(({ challanNo, raw }) => {
          msg += `  • Challan ${challanNo}: "${raw}"\n`;
        });
      }

      setMessage(msg.trim());
    } catch (err) {
      console.error("JSW Date update error:", err);
      setMessage(`❌ Failed: ${err.message}`);
    } finally {
      setIsUpdating(false);
    }
  };

  /* ── UI ────────────────────────────────────────────────────── */
  return (
    <div style={{ maxWidth: 560, margin: "32px auto", fontFamily: "Inter, sans-serif" }}>
      <h3 style={{ marginBottom: 4 }}>🗓️ JSW — Update Dispatch Date</h3>
      <p style={{ color: "#6b7280", fontSize: "0.85rem", marginBottom: 16 }}>
        Upload an Excel with exactly <strong>2 key columns</strong>:{" "}
        <strong>Challan No</strong> and <strong>Date</strong>.<br />
        Only the <em>DispatchDate</em> field will be patched on matching JSW
        records. No new records will be created.
      </p>

      {isUpdating && (
        <div
          style={{
            background: "#fef9c3",
            border: "1px solid #fbbf24",
            borderRadius: 6,
            padding: "8px 14px",
            marginBottom: 12,
            fontSize: "0.9rem",
          }}
        >
          ⏳ Updating dates, please wait…
        </div>
      )}

      {message && (
        <pre
          style={{
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            padding: "14px 16px",
            fontSize: "0.8rem",
            whiteSpace: "pre-wrap",
            marginBottom: 20,
            color: "#1e293b",
            lineHeight: 1.6,
          }}
        >
          {message}
        </pre>
      )}

      <form onSubmit={handleUpdate}>
        <div style={{ marginBottom: 16 }}>
          <label
            style={{
              display: "block",
              fontWeight: 600,
              marginBottom: 6,
              fontSize: "0.9rem",
              color: "#374151",
            }}
          >
            📁 Choose Excel File (Challan + Date):
          </label>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setFile(e.target.files[0])}
            required
            disabled={isUpdating}
            style={{ fontSize: "0.9rem" }}
          />
        </div>

        <button
          type="submit"
          disabled={isUpdating}
          style={{
            padding: "10px 24px",
            background: isUpdating ? "#9ca3af" : "#b45309",
            color: "#fff",
            border: "none",
            borderRadius: 7,
            fontWeight: 600,
            fontSize: "0.95rem",
            cursor: isUpdating ? "not-allowed" : "pointer",
            transition: "background 0.2s",
          }}
        >
          {isUpdating ? "⏳ Updating…" : "🗓️ Update JSW Dispatch Dates"}
        </button>
      </form>
    </div>
  );
};

export default JswDateUpdate;
