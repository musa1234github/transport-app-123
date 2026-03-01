import React, { useState } from "react";
import { db } from "../firebaseConfig";
import {
    collection, getDocs, doc, setDoc, query, orderBy
} from "firebase/firestore";

const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

const BackfillMonthly = () => {
    const [status, setStatus] = useState("idle");   // idle | running | done | error
    const [log, setLog] = useState([]);
    const [progress, setProgress] = useState({ read: 0, written: 0 });

    const addLog = (msg) => setLog(prev => [...prev, msg]);

    const runBackfill = async () => {
        if (!window.confirm(
            "This will read ALL TblDispatch records and rebuild TblDispatchMonthly.\n\nExisting summary data will be OVERWRITTEN.\n\nContinue?"
        )) return;

        setStatus("running");
        setLog([]);
        setProgress({ read: 0, written: 0 });

        try {
            // ── 1. Read all dispatch records ────────────────────────────────────────
            addLog("📥 Reading TblDispatch…");
            const snap = await getDocs(collection(db, "TblDispatch"));
            const total = snap.size;
            addLog(`✅ Found ${total} dispatch records.`);
            setProgress(p => ({ ...p, read: total }));

            // ── 2. Aggregate into a map: "{FACTORY}_{year}_{month}" → totals ────────
            addLog("🔢 Aggregating by factory + month…");
            const summaryMap = {};  // key → { year, month, factory, totalQty, billQty }

            snap.docs.forEach(d => {
                const data = d.data();

                // Parse date
                let date = null;
                if (data.DispatchDate?.seconds) {
                    date = new Date(data.DispatchDate.seconds * 1000);
                } else if (data.DispatchDate instanceof Date) {
                    date = data.DispatchDate;
                } else if (data.DispatchDate) {
                    date = new Date(data.DispatchDate);
                }
                if (!date || isNaN(date.getTime())) return;   // skip if no valid date

                const year = date.getFullYear();
                const month = date.getMonth() + 1;          // 1-based
                const factory = (
                    data.FactoryName || data.Factory ||
                    (data.DisVid === "10" ? "JSW" :
                        data.DisVid === "6" ? "MANIGAR" :
                            data.DisVid === "7" ? "ULTRATECH" :
                                data.DisVid ? `FACTORY_${data.DisVid}` : "UNKNOWN")
                ).toUpperCase().trim();

                const qty = Number(data.DispatchQuantity) || 0;
                const isBilled = Number(data.UnitPrice) > 0 ||
                    data.BillStatus === true ||
                    data.IsBilled === true ||
                    data.Billed === true;

                const key = `${factory}_${year}_${month}`;

                if (!summaryMap[key]) {
                    summaryMap[key] = { year, month, factory, totalQty: 0, billQty: 0 };
                }
                summaryMap[key].totalQty += qty;
                if (isBilled) summaryMap[key].billQty += qty;
            });

            const keys = Object.keys(summaryMap);
            addLog(`📊 ${keys.length} unique factory-month combinations found.`);

            // ── 3. Write each summary doc ───────────────────────────────────────────
            addLog("💾 Writing to TblDispatchMonthly…");
            let written = 0;

            for (const key of keys) {
                const entry = summaryMap[key];
                const ref = doc(db, "TblDispatchMonthly", key);
                await setDoc(ref, {
                    year: entry.year,
                    month: entry.month,
                    factory: entry.factory,
                    totalQty: entry.totalQty,
                    billQty: entry.billQty,
                });
                written++;
                setProgress({ read: total, written });
            }

            addLog(`✅ Done! ${written} summary documents written.`);
            addLog("🎉 TblDispatchMonthly is now fully populated.");
            addLog("👉 Go to 'Monthly Qty' report — factory dropdown will now be populated.");
            setStatus("done");

        } catch (err) {
            console.error("Backfill error:", err);
            addLog(`❌ Error: ${err.message}`);
            setStatus("error");
        }
    };

    return (
        <div style={{ padding: 24, maxWidth: 700 }}>
            <h2>🗄️ Backfill Monthly Summary</h2>
            <p style={{ color: "#555", marginBottom: 20 }}>
                This is a <strong>one-time setup</strong>. It reads all existing dispatch
                records from <code>TblDispatch</code> and writes aggregated monthly summaries
                to <code>TblDispatchMonthly</code>. After this, the Monthly Qty report will
                load in seconds with minimal Firebase reads.
            </p>

            {/* Progress */}
            {status !== "idle" && (
                <div style={{
                    backgroundColor: "#f8f9fa", border: "1px solid #dee2e6",
                    borderRadius: 6, padding: "14px 18px", marginBottom: 20,
                    fontFamily: "monospace", fontSize: 13
                }}>
                    <div style={{ marginBottom: 8, display: "flex", gap: 20 }}>
                        <span>📥 Read: <strong>{progress.read}</strong> docs</span>
                        <span>💾 Written: <strong>{progress.written}</strong> summaries</span>
                    </div>

                    {/* Log output */}
                    <div style={{
                        maxHeight: 260, overflowY: "auto",
                        backgroundColor: "#1e1e1e", color: "#d4d4d4",
                        borderRadius: 4, padding: "10px 14px"
                    }}>
                        {log.map((line, i) => (
                            <div key={i} style={{ lineHeight: 1.7 }}>{line}</div>
                        ))}
                        {status === "running" && (
                            <div style={{ color: "#4ec9b0" }}>⏳ Running…</div>
                        )}
                    </div>
                </div>
            )}

            {/* Action button */}
            {status !== "done" && (
                <button
                    onClick={runBackfill}
                    disabled={status === "running"}
                    style={{
                        padding: "11px 28px",
                        backgroundColor: status === "running" ? "#adb5bd" : "#dc3545",
                        color: "white",
                        border: "none", borderRadius: 5,
                        fontSize: 15, cursor: status === "running" ? "not-allowed" : "pointer",
                        fontWeight: 600
                    }}
                >
                    {status === "running" ? "⏳ Running Backfill…" : "▶ Run Backfill Now"}
                </button>
            )}

            {status === "done" && (
                <div style={{
                    padding: "14px 18px",
                    backgroundColor: "#d4edda", border: "1px solid #c3e6cb",
                    borderRadius: 6, color: "#155724", fontWeight: 500
                }}>
                    ✅ Backfill complete! You can now close this page and use the Monthly Qty report.
                </div>
            )}

            {status === "error" && (
                <button
                    onClick={runBackfill}
                    style={{
                        marginTop: 12, padding: "10px 24px",
                        backgroundColor: "#ffc107", color: "#212529",
                        border: "none", borderRadius: 5, cursor: "pointer", fontWeight: 600
                    }}
                >
                    🔄 Retry
                </button>
            )}
        </div>
    );
};

export default BackfillMonthly;
